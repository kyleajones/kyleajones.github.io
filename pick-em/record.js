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
        <div id="leaderboard-section"><div style="text-align: center; padding: 40px; color: var(--color-text-muted);">Loading Leaderboard...</div></div>
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
            <div class="leaderboard">
                <h2>Season Leaderboard</h2>
                <div class="leaderboard-header-row">
                    <span>Rank</span>
                    <span>Player</span>
                    <span>Points</span>
                    <span>W-L-T</span>
                </div>
        `;
        sortedUsers.forEach((u, index) => {
            const rank = index + 1;
            const rankClass = rank <= 3 ? ` rank-${rank}` : '';
            lbHtml += `
                <div class="leaderboard-row">
                    <span class="rank-badge${rankClass}">#${rank}</span>
                    <span class="leaderboard-name">${u.name}</span>
                    <span class="leaderboard-points">${u.points}</span>
                    <span class="leaderboard-record">${u.w} - ${u.l} - ${u.p}</span>
                </div>
            `;
        });
        lbHtml += `</div>`;
        document.getElementById('leaderboard-section').innerHTML = lbHtml;

    } catch (error) {
        console.error("Error fetching data: ", error);
        document.getElementById('leaderboard-section').innerHTML = `<div style="text-align: center; color: var(--color-loss); padding: 40px;">Error loading leaderboard.</div>`;
    }

    // 2. Render Private Tickets Based on Auth State
    onAuthStateChanged(auth, (user) => {
        const ticketsContainer = document.getElementById('tickets-section');
        if (!user) {
            ticketsContainer.innerHTML = `
                <div class="game-card" style="text-align: center;">
                    <h3 style="color: var(--color-text-main); margin-top: 0;">My Picks</h3>
                    <p style="color: var(--color-text-muted);">Please log in on the 'Make Picks' page to view your history.</p>
                </div>
            `;
            return;
        }

        const myPicks = allPickHistory.filter(record => record.userId === user.uid);

        let tHtml = `<h2 style="margin-bottom: 20px; color: var(--color-text-main);">My Picks</h2>`;

        if (myPicks.length === 0) {
            tHtml += `<p style="color: var(--color-text-muted);">You haven't submitted any picks yet.</p>`;
        } else {
            myPicks.forEach(record => {
                const dateSaved = new Date(record.date).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                });

                tHtml += `
                    <div class="ticket-card">
                        <div class="ticket-header">
                            <h3>Week ${record.week}</h3>
                            <span class="ticket-date">${dateSaved}</span>
                        </div>
                        <div class="ticket-picks">
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

                    const statusClass = `status-${status.toLowerCase()}`;

                    tHtml += `
                        <div class="pick-chip">
                            <div>
                                <div class="pick-chip-type">${pickType}</div>
                                <div class="pick-chip-selection">${selection} (${lineDisplay})</div>
                            </div>
                            <span class="status-pill ${statusClass}">${status}</span>
                        </div>
                    `;
                }
                tHtml += `</div></div>`;
            });
        }
        ticketsContainer.innerHTML = tHtml;
    });
    const modal = document.getElementById('how-to-play-modal');
    const openBtn = document.getElementById('how-to-play-link');
    const closeBtn = document.getElementById('modal-close-btn');

    if (openBtn && modal && closeBtn) {
        openBtn.addEventListener('click', (e) => {
            e.preventDefault();
            modal.style.display = 'flex';
        });

        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
});
