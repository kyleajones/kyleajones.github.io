import { db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { compareStandings, rankStandings } from './grading.js';
import { escapeHtml, initHowToPlayModal } from './ui.js';

// `computedAt` arrives as a Firestore Timestamp (which needs .toDate())
// over the SDK, but as an ISO string if the doc is ever read from a
// plain JSON export -- same defensive conversion current-week.js's
// toDate() does for commenceTime.
function formatComputedAt(value) {
    const date = value?.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('record-container');
    container.innerHTML = `
        <div id="leaderboard-section"><div style="text-align: center; padding: 40px; color: var(--color-text-muted);">Loading Leaderboard...</div></div>
    `;

    try {
        // Leaderboard is pre-computed server-side (update_leaderboard.py)
        // into a single trusted mirror doc shaped
        // {players: {uid: {name, points, w, l, p}}, computedAt: <ts>},
        // already exactly what the rendering below expects -- so no
        // client-side aggregation is needed here.
        const leaderboardSnap = await getDoc(doc(db, "leaderboard", "current"));
        const leaderboardData = leaderboardSnap.exists() ? leaderboardSnap.data() : {};

        const userStats = leaderboardData.players || {};
        const computedAt = leaderboardData.computedAt || null;

        // Ranking rules live in grading.js so send_standings_email.py's
        // Python ports stay the single other copy: points desc, then more
        // wins, then fewer losses, with players still level on all three
        // sharing a rank badge.
        const sortedUsers = rankStandings(
            Object.values(userStats).sort(compareStandings)
        );
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
        sortedUsers.forEach((u) => {
            const rank = u.rank;
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

        // Explain the discrepancy a player hits when they compare this
        // page against the Results tab mid-week: these points come from
        // results.json as of the last nightly run, while Results overlays
        // live ESPN scores. Skipped when the doc doesn't exist yet, so an
        // empty leaderboard doesn't claim a bogus "updated" time.
        const computedAtText = computedAt ? formatComputedAt(computedAt) : '';
        if (computedAtText) {
            lbHtml += `
                <p class="leaderboard-note">
                    Points updated ${escapeHtml(computedAtText)}.
                    In-progress games are counted once they're final, so the
                    Results tab may show live picks this doesn't include yet.
                </p>
            `;
        }
        document.getElementById('leaderboard-section').innerHTML = lbHtml;

    } catch (error) {
        console.error("Error fetching data: ", error);
        document.getElementById('leaderboard-section').innerHTML = `<div style="text-align: center; color: var(--color-loss); padding: 40px;">Error loading leaderboard.</div>`;
    }

    initHowToPlayModal();
});
