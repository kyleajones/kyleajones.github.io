import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// Grading Logic
function gradePick(pickValue, pickType, gameResult) {
    if (!gameResult) return 'PENDING';
    
    // Split the saved value (e.g. "Chiefs|-3.5" or "Over|44.5")
    const [selection, lineStr] = pickValue.split('|');
    let line = parseFloat(lineStr);
    
    // Handle "PK" (Pick 'em) which equals a 0 spread
    if (lineStr === "PK") line = 0;

    const scores = gameResult.scores;
    const awayTeam = gameResult.away_team;
    const homeTeam = gameResult.home_team;
    
    // Make sure we actually have scores for both teams
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
    container.innerHTML = `<div style="text-align: center; padding: 40px;">Loading Leaderboard & Picks...</div>`;

    try {
        // Fetch Results and Firebase Picks simultaneously
        const [resultsRes, querySnapshot] = await Promise.all([
            fetch('results.json').catch(() => ({ json: () => ({}) })),
            getDocs(query(collection(db, "picks"), orderBy("date", "desc")))
        ]);
        
        const resultsData = resultsRes.ok ? await resultsRes.json() : await resultsRes.json();
        
        const userStats = {};
        const allPickHistory = [];

		querySnapshot.forEach((doc) => {
            const record = doc.data();
            allPickHistory.push(record);
            
            // Extract the unique ID (falling back to username for older anonymous picks)
            const uid = record.userId || record.username || "Unknown";
            const userName = record.username || "Anonymous";
            
            // Create the stats tracker using the 'uid'
            if (!userStats[uid]) {
                userStats[uid] = { name: userName, w: 0, l: 0, p: 0, points: 0 };
            }

            // Grade each pick
            for (const [pickKey, pickValue] of Object.entries(record.picks)) {
                const gameId = pickKey.split('_')[1]; 
                const pickType = pickKey.startsWith('spread') ? 'Spread' : 'Over/Under';
                
                const status = gradePick(pickValue, pickType, resultsData[gameId]);
                
                // Add points/records to the specific 'uid'
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
        // Generate Leaderboard HTML
        const sortedUsers = Object.values(userStats).sort((a, b) => b.points - a.points);
        
        let html = `
            <div class="game-card" style="margin-bottom: 30px; border-top: 4px solid #007bff;">
                <h2 style="margin-top: 0; text-align: center;">Season Leaderboard</h2>
                <table style="width: 100%; text-align: left; border-collapse: collapse; margin-top: 15px;">
                    <tr style="border-bottom: 2px solid #ddd;">
                        <th style="padding: 10px 5px;">Rank</th>
                        <th style="padding: 10px 5px;">Player</th>
                        <th style="padding: 10px 5px;">Points</th>
                        <th style="padding: 10px 5px;">Record (W-L-T)</th>
                    </tr>
        `;
        
        sortedUsers.forEach((u, index) => {
            html += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 10px 5px; font-weight: bold;">#${index + 1}</td>
                    <td style="padding: 10px 5px;">${u.name}</td>
                    <td style="padding: 10px 5px; font-weight: bold; color: #28a745;">${u.points}</td>
                    <td style="padding: 10px 5px; color: #555;">${u.w} - ${u.l} - ${u.p}</td>
                </tr>
            `;
        });
        html += `</table></div><h2 style="margin-bottom: 20px;">Recent Pick Tickets</h2>`;

        // Generate Pick History Cards
        allPickHistory.forEach(record => {
            const dateSaved = new Date(record.date).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            });

            html += `
                <div class="game-card" style="margin-bottom: 20px;">
                    <div style="border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0;">${record.username || "Anonymous"} - Week ${record.week}</h3>
                        <span style="font-size: 0.85em; color: #888;">${dateSaved}</span>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            `;

            for (const [pickKey, pickValue] of Object.entries(record.picks)) {
                const gameId = pickKey.split('_')[1];
                const pickType = pickKey.startsWith('spread') ? 'Spread' : 'Over/Under';
                const status = gradePick(pickValue, pickType, resultsData[gameId]);
                
                // Format the displayed text nicely: "Chiefs (-3.5)"
                const [selection, lineStr] = pickValue.split('|');
                const lineDisplay = (lineStr > 0 && pickType === 'Spread') ? `+${lineStr}` : lineStr;
                const displayText = `${selection} (${lineDisplay})`;
                
                // Color code the result badge
                let badgeColor = '#6c757d'; // Pending grey
                if (status === 'WIN') badgeColor = '#28a745'; // Green
                if (status === 'LOSS') badgeColor = '#dc3545'; // Red
                if (status === 'PUSH') badgeColor = '#ffc107'; // Yellow

                html += `
                    <div style="background: #f9f9f9; padding: 10px; border-radius: 6px; border: 1px solid #eaeaea;">
                        <div style="font-size: 0.7em; color: #666; text-transform: uppercase; font-weight: bold; margin-bottom: 4px;">
                            ${pickType}
                        </div>
                        <div style="font-weight: bold; font-size: 1em; margin-bottom: 6px;">
                            ${displayText}
                        </div>
                        <span style="background: ${badgeColor}; color: ${status === 'PUSH' ? '#333' : '#fff'}; padding: 2px 6px; border-radius: 4px; font-size: 0.75em; font-weight: bold;">
                            ${status}
                        </span>
                    </div>
                `;
            }
            html += `</div></div>`;
        });

        container.innerHTML = html;

    } catch (error) {
        console.error("Error fetching data: ", error);
        container.innerHTML = `<div style="text-align: center; color: #d9534f; padding: 40px;">Error loading data.</div>`;
    }
});
