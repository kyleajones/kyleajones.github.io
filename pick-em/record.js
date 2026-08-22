import { db, auth } from './firebase-config.js';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

// Grading Logic
function gradePick(pickValue, pickType, gameResult) {
    if (!gameResult) return 'PENDING';
    const [selection, lineStr] = pickValue.split('|');
    let line = parseFloat(lineStr);
    if (lineStr === "PK") line = 0;

    const scores = gameResult.scores;
    const awayTeam = gameResult.away_team;
    const homeTeam = gameResult.home_team;
    
    if (scores[awayTeam] === undefined || scores[homeTeam] === undefined) return 'PENDING';

    const awayScore = scores[awayTeam];
    const homeScore = scores[homeTeam];

    if (pickType === 'Spread') {
        const isAway = (selection === awayTeam);
        const pickedScore = isAway ? awayScore : homeScore;
        const opponentScore = isAway ? homeScore : awayScore;
        const adjustedScore = pickedScore + line;

        if (adjustedScore > opponentScore) return 'WIN';
        if (adjustedScore < opponentScore) return 'LOSS';
        return 'PUSH';
    } 
    else if (pickType === 'Over/Under') {
        const totalPoints = awayScore + homeScore;
        if (totalPoints === line) return 'PUSH';
        if (selection === 'Over') return totalPoints > line ? 'WIN' : 'LOSS';
        if (selection === 'Under') return totalPoints < line ? 'WIN' : 'LOSS';
    }
    return 'PENDING';
}

document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('record-container');
    container.innerHTML = `
        <div id="leaderboard-section"><div style="text-align: center; padding: 40px; color: var(--color-white);">Loading Leaderboard...</div></div>
        <div id="tickets-section" style="margin-top: 30px;"></div>
    `;

    let allPickHistory = [];
    let resultsData = {};

    try {
        const [resultsRes, querySnapshot] = await Promise.all([
            fetch('results.json').catch(() => ({ json: () => ({}) })),
            getDocs(query(collection(db, "picks"), orderBy("date", "desc")))
        ]);
        
        resultsData = resultsRes.ok ? await resultsRes.json() : await resultsRes.json();
        const userStats = {};

        querySnapshot.forEach((doc) => {
            const record = doc.data();
            allPickHistory.push(record);
            
            const uid = record.userId || record.username || "Unknown";
            const userName = record.username || "Anonymous";
            
            if (!userStats[uid]) {
                userStats[uid] = { name: userName, w: 0, l: 0, p: 0, points: 0 };
            }

            for (const [pickKey, pickValue] of Object.entries(record.picks)) {
                const gameId = pickKey.split('_')[1]; 
                const pickType = pickKey.startsWith('spread') ? 'Spread' : 'Over/Under';
                const status = gradePick(pickValue, pickType, resultsData[gameId]);
                
                if (status === 'WIN') {
                    userStats[uid].w += 1;
                    userStats[uid].points += 3;
                } else if (status === 'PUSH') {
                    userStats[uid].p += 1;
                    userStats[uid].points += 1;
                } else if (status === 'LOSS') {
                    userStats[uid].l += 1;
                }
            }
        });

        // 1. Render Global Leaderboard
        const sortedUsers = Object.values(userStats).sort((a, b) => b.points - a.points);
        let lbHtml = `
            <div class="game-card" style="margin-bottom: 30px; border-top: 4px solid var(--color-football-brown);">
                <h2 style="margin-top: 0; text-align: center; color: var(--color-football-brown);">Season Leaderboard</h2>
                <table style="width: 100%; text-align: left; border-collapse: collapse; margin-top: 15px;">
                    <tr style="border-bottom: 2px solid var(--color-border);">
                        <th style="padding: 10px 5px; color: var(--color-text-main);">Rank</th>
                        <th style="padding: 10px 5px; color: var(--color-text-main);">Player</th>
                        <th style="padding: 10px 5px; color: var(--color-text-main);">Points</th>
                        <th style="padding: 10px 5px; color: var(--color-text-main);">Record (W-L-T)</th>
                    </tr>
        `;
        sortedUsers.forEach((u, index) => {
            lbHtml += `
                <tr style="border-bottom: 1px solid var(--color-border);">
                    <td style="padding: 10px 5px; font-weight: bold; color: var(--color-text-main);">#${index + 1}</td>
                    <td style="padding: 10px 5px; color: var(--color-text-main);">${u.name}</td>
                    <td style="padding: 10px 5px; font-weight: bold; color: #28a745;">${u.points}</td>
                    <td style="padding: 10px 5px; color: var(--color-text-muted);">${u.w} - ${u.l} - ${u.p}</td>
                </tr>
            `;
        });
        lbHtml += `</table></div>`;
        document.getElementById('leaderboard-section').innerHTML = lbHtml;

    } catch (error) {
        console.error("Error fetching data: ", error);
        document.getElementById('leaderboard-section').innerHTML = `<div style="text-align: center; color: #dc3545; padding: 40px;">Error loading leaderboard.</div>`;
    }

    // 2. Render Private Tickets Based on Auth State
    onAuthStateChanged(auth, (user) => {
        const ticketsContainer = document.getElementById('tickets-section');
        if (!user) {
            ticketsContainer.innerHTML = `
                <div style="background: var(--color-bg-card); padding: 20px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h3 style="color: var(--color-football-brown);">My Picks</h3>
                    <p style="color: var(--color-text-muted);">Please log in on the 'Make Picks' page to view your history.</p>
                </div>
            `;
            return;
        }

        const myPicks = allPickHistory.filter(record => record.userId === user.uid);
        
        let tHtml = `<h2 style="margin-bottom: 20px; color: var(--color-white); text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);">My Picks</h2>`;
        
        if (myPicks.length === 0) {
            tHtml += `<p style="color: var(--color-white);">You haven't submitted any picks yet.</p>`;
        } else {
            myPicks.forEach(record => {
                const dateSaved = new Date(record.date).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                });

                tHtml += `
                    <div class="game-card" style="margin-bottom: 15px; overflow: hidden; padding: 0;">
                        <div style="background: #fff9c4; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #fff59d;">
                            <h3 style="margin: 0; color: var(--color-football-brown); font-size: 1.1em;">Week ${record.week}</h3>
                            <span style="font-size: 0.8em; color: var(--color-football-brown);">${dateSaved}</span>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 10px;">
                `;

                for (const [pickKey, pickValue] of Object.entries(record.picks)) {
                    const gameId = pickKey.split('_')[1];
                    const pickType = pickKey.startsWith('spread') ? 'Spread' : 'O/U'; 
                    const status = gradePick(pickValue, pickType === 'Spread' ? 'Spread' : 'Over/Under', resultsData[gameId]);
                    
                    const [selection, lineStr] = pickValue.split('|');
                    let lineDisplay = lineStr;
                    
                    if (pickType === 'Spread') {
                        if (lineStr === "PK" || lineStr === "0" || lineStr === "0.0") lineDisplay = "PK";
                        else {
                            const numLine = parseFloat(lineStr);
                            if (!isNaN(numLine)) lineDisplay = numLine > 0 ? `+${numLine}` : `${numLine}`;
                        }
                    }
                    
                    let badgeColor = 'var(--color-text-muted)'; 
                    if (status === 'WIN') badgeColor = '#28a745'; 
                    if (status === 'LOSS') badgeColor = '#dc3545'; 
                    if (status === 'PUSH') badgeColor = '#ffc107'; 

                    tHtml += `
                        <div style="background: var(--color-bg-offwhite); padding: 6px 8px; border-radius: 4px; border: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-size: 0.65em; color: var(--color-text-muted); font-weight: bold; margin-bottom: 2px;">${pickType}</div>
                                <div style="font-weight: bold; font-size: 0.85em; color: var(--color-text-main);">${selection} (${lineDisplay})</div>
                            </div>
                            <span style="background: ${badgeColor}; color: ${status === 'PUSH' ? 'var(--color-text-main)' : 'var(--color-white)'}; padding: 2px 5px; border-radius: 3px; font-size: 0.7em; font-weight: bold;">${status}</span>
                        </div>
                    `;
                }
                tHtml += `</div></div>`;
            });
        }
        ticketsContainer.innerHTML = tHtml;
    });
});
