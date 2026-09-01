import { db, auth } from './firebase-config.js';
import { collection, getDocs, query, where, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

// Escape user-controlled strings (display names, pick values) before they're
// interpolated into innerHTML, so a crafted display name can't inject markup
// that executes in every visitor's browser.
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

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

    let resultsData = {};

    try {
        const [resultsRes, leaderboardSnap] = await Promise.all([
            fetch('results.json').catch(() => ({ json: () => ({}) })),
            getDoc(doc(db, "leaderboard", "current"))
        ]);

        resultsData = resultsRes.ok ? await resultsRes.json() : await resultsRes.json();

        // Leaderboard is pre-computed server-side (update_leaderboard.py)
        // into a single trusted mirror doc, already in the exact
        // {uid: {name, points, w, l, p}} shape the rendering below
        // expects -- so no client-side aggregation is needed here.
        const userStats = leaderboardSnap.exists() ? leaderboardSnap.data() : {};

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
                    <span class="leaderboard-name">${escapeHtml(u.name)}</span>
                    <span class="leaderboard-points">${u.points}</span>
                    <span class="leaderboard-record">${u.w}W-${u.l}L-${u.p}T</span>
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
    onAuthStateChanged(auth, async (user) => {
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

        let myPicks;
        try {
            // Scoped to just this user's own docs -- no orderBy here (see
            // pick-em.md's composite-index gotcha), so sort the small
            // (max ~18) result set client-side instead.
            const querySnapshot = await getDocs(query(collection(db, "picks"), where("userId", "==", user.uid)));
            myPicks = [];
            querySnapshot.forEach((docSnap) => myPicks.push(docSnap.data()));
            myPicks.sort((a, b) => new Date(b.date) - new Date(a.date));
        } catch (error) {
            console.error("Error fetching my picks: ", error);
            ticketsContainer.innerHTML = `<div style="text-align: center; color: var(--color-loss); padding: 40px;">Error loading your picks.</div>`;
            return;
        }

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
                    const isLocked = pickKey === record.lockedPick;

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
                    const typeLabel = isLocked ? `${pickType} 🔒` : pickType;

                    tHtml += `
                        <div class="pick-chip">
                            <div>
                                <div class="pick-chip-type">${typeLabel}</div>
                                <div class="pick-chip-selection">${escapeHtml(selection)} (${escapeHtml(lineDisplay)})</div>
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
