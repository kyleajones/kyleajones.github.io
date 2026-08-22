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
        <div id="leaderboard-section"><div style="text-align: center; padding: 40px;">Loading Leaderboard...</div></div>
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
            <div class="game-card" style="margin-bottom: 30px; border-top: 4px solid #5d4037;">
                <h2 style="margin-top: 0; text-align: center; color: #5d4037;">Season Leaderboard</h2>
                <table style="width: 100%; text-align: left; border-collapse: collapse; margin-top: 15px;">
                    <tr style="border-bottom: 2px solid #ddd;">
                        <th style="padding: 10px 5px;">Rank</th>
                        <th style="padding: 10px 5px;">Player</th>
                        <th style="padding: 10px 5px;">Points</th>
                        <th style="padding: 10px 5px;">Record (W-L-T)</th>
                    </tr>
        `;
        sortedUsers.forEach((u, index) => {
            lbHtml += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 10px 5px; font-weight: bold;">#${index + 1}</td>
                    <td style="padding: 10px 5px;">${u.name}</td>
                    <td style="padding: 10px 5px; font-weight: bold; color: #28a745;">${u.points}</td>
                    <td style="padding: 10px 5px; color: #555;">${u.w} - ${u.l} - ${u.p}</td>
                </tr>
            `;
        });
        lbHtml += `</table></div>`;
        document.getElementById('leaderboard-section').innerHTML = lbHtml;

    } catch (error) {
        console.error("Error fetching data: ", error);
        document.getElementById('leaderboard-section').innerHTML = `<div style="text-align: center; color: #d9534f; padding: 40px;">Error loading leaderboard.</div>`;
    }

    // 2. Render Private Tickets Based on Auth State
    onAuthStateChanged(auth, (user) => {
        const ticketsContainer = document.getElementById('tickets-section');
        if (!user) {
            ticketsContainer.innerHTML = `
                <div style="background: #fff; padding: 20px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h3 style="color: #5d4037;">My Picks</h3>
                    <p style="color: #666;">Please log in on the 'Make Picks' page to view your history.</p>
                </div>
            `;
            return;
        }

        const myPicks = allPickHistory.filter(record => record.userId === user.uid);
        
        let tHtml = `<h2 style="margin-bottom: 20px; color: #ffffff; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);">My Picks</h2>`;
        
        if (myPicks.length === 0) {
            tHtml += `<p style="color: #ffffff;">You haven't submitted any picks yet.</p>`;
        } else {
            myPicks.forEach(record => {
                const dateSaved = new Date(record.date).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                });

                // Apply light yellow background, yellow bottom border, and brown fonts
                tHtml += `
                    <div class="game-card" style="margin-bottom: 15px; overflow: hidden; padding: 0;">
                        <div style="background: #fff9c4; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #fff59d;">
                            <h3 style="margin: 0; color: #5d4037; font-size: 1.1em;">Week ${record.week}</h3>
                            <span style="font-size: 0.8em; color: #6d4c41;">${dateSaved}</span>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 10px;">
                `;

                for (const [pickKey, pickValue] of Object.entries(record.picks)) {
                    const gameId = pickKey.split('_')[1];
                    const pickType = pickKey.startsWith('spread') ? 'Spread' : 'O/U'; // Shortened label
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
                    
                    let badgeColor = '#6c757d'; 
                    if (status === 'WIN') badgeColor = '#28a745'; 
                    if (status === 'LOSS') badgeColor = '#dc3545'; 
                    if (status === 'PUSH') badgeColor = '#ffc107'; 

                    // Tightened padding and font sizes for individual picks
                    tHtml += `
                        <div style="background: #f8f9fa; padding: 6px 8px; border-radius: 4px; border: 1px solid #e9ecef; display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-size: 0.65em; color: #6c757d; font-weight: bold; margin-bottom: 2px;">${pickType}</div>
                                <div style="font-weight: bold; font-size: 0.85em; color: #343a40;">${selection} (${lineDisplay})</div>
                            </div>
                            <span style="background: ${badgeColor}; color: ${status === 'PUSH' ? '#212529' : '#fff'}; padding: 2px 5px; border-radius: 3px; font-size: 0.7em; font-weight: bold;">${status}</span>
                        </div>
                    `;
                }
                tHtml += `</div></div>`;
            });
        }
        ticketsContainer.innerHTML = tHtml;
    });
});
