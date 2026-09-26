import { db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

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

document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('record-container');
    container.innerHTML = `
        <div id="leaderboard-section"><div style="text-align: center; padding: 40px; color: var(--color-text-muted);">Loading Leaderboard...</div></div>
    `;

    try {
        // Leaderboard is pre-computed server-side (update_leaderboard.py)
        // into a single trusted mirror doc, already in the exact
        // {uid: {name, points, w, l, p}} shape the rendering below
        // expects -- so no client-side aggregation is needed here.
        const leaderboardSnap = await getDoc(doc(db, "leaderboard", "current"));
        const userStats = leaderboardSnap.exists() ? leaderboardSnap.data() : {};

        const sortedUsers = Object.values(userStats).sort((a, b) => b.points - a.points);
        let lbHtml = `
            <div class="leaderboard">
                <h2>Season Leaderboard</h2>
                <div class="leaderboard-header-row">
                    <span>Rank</span>
                    <span>Player</span>
                    <span>Points</span>
                    <span>Record</span>
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
