import { db, auth } from './firebase-config.js';
import { collection, getDocs, query, where, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { gradePick } from './grading.js';

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

function toDate(value) {
    return value?.toDate ? value.toDate() : new Date(value);
}

function isStarted(commenceTime) {
    return toDate(commenceTime) <= new Date();
}

function formatCommence(commenceTime) {
    return toDate(commenceTime).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
}

// Drops the city from a full team name (e.g. "Los Angeles Rams" -> "Rams")
// for compact display -- every NFL mascot name is a single word, so the
// last word is always the right answer, with no team-name data file needed.
function teamName(fullName) {
    return fullName.split(' ').pop();
}

let currentUser = null;
let currentWeekInfo = null;
let resultsData = {};

function renderBanner(games) {
    const bannerContainer = document.getElementById('week-banner');
    if (games.length === 0) {
        bannerContainer.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--color-text-muted);">No games found for this week.</div>`;
        return;
    }

    let html = '<div class="week-banner">';
    games.forEach((game) => {
        const result = resultsData[game.id];
        let scoreHtml;
        if (result) {
            const awayScore = result.scores?.[result.away_team];
            const homeScore = result.scores?.[result.home_team];
            scoreHtml = `<span class="banner-score">${awayScore} - ${homeScore}</span>`;
        } else if (isStarted(game.commenceTime)) {
            scoreHtml = `<span class="banner-pending">In Progress</span>`;
        } else {
            scoreHtml = `<span class="banner-kickoff">${escapeHtml(formatCommence(game.commenceTime))}</span>`;
        }

        html += `
            <div class="banner-game">
                <div class="banner-teams">${escapeHtml(teamName(game.away))} @ ${escapeHtml(teamName(game.home))}</div>
                ${scoreHtml}
            </div>
        `;
    });
    html += '</div>';
    bannerContainer.innerHTML = html;
}

function renderBadge(pickValue, pickType, gameId) {
    if (!pickValue) {
        return '';
    }

    const [selection, lineStr] = pickValue.split('|');
    const status = gradePick(pickValue, pickType, resultsData[gameId]);
    const statusClass = { WIN: 'win', LOSS: 'loss', PUSH: 'tie', PENDING: 'pending' }[status] || 'pending';
    const label = pickType === 'Spread' ? teamName(selection) : `${selection} ${lineStr}`;

    return `<span class="pick-badge pick-badge-${statusClass}" title="${escapeHtml(pickType)}">${escapeHtml(label)}</span>`;
}

function renderTable(games, players) {
    const tableContainer = document.getElementById('picks-table-container');
    const playerEntries = Object.entries(players)
        .sort((a, b) => (a[1].username || '').localeCompare(b[1].username || ''));

    if (playerEntries.length === 0) {
        tableContainer.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--color-text-muted);">No picks submitted yet for this week.</div>`;
        return;
    }

    let html = '<div class="picks-table-scroll"><table class="picks-table"><thead><tr><th>Player</th>';
    games.forEach((game) => {
        html += `<th>${escapeHtml(teamName(game.away))}<br>@ ${escapeHtml(teamName(game.home))}</th>`;
    });
    html += '</tr></thead><tbody>';

    playerEntries.forEach(([uid, player]) => {
        const isSelf = currentUser && uid === currentUser.uid;
        html += `<tr class="${isSelf ? 'picks-row-self' : ''}">`;
        html += `<td class="picks-row-name">${escapeHtml(player.username || 'Anonymous')}${isSelf ? ' (You)' : ''}</td>`;
        games.forEach((game) => {
            const picks = player.picks || {};
            html += `
                <td>
                    <div class="pick-cell">
                        ${renderBadge(picks[`spread_${game.id}`], 'Spread', game.id)}
                        ${renderBadge(picks[`ou_${game.id}`], 'Over/Under', game.id)}
                    </div>
                </td>
            `;
        });
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    tableContainer.innerHTML = html;
}

async function renderWeek(week) {
    const year = currentWeekInfo.year;
    const weekStr = `week${week}`;
    const yearStr = String(year);

    const bannerContainer = document.getElementById('week-banner');
    const tableContainer = document.getElementById('picks-table-container');
    bannerContainer.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--color-text-muted);">Loading Week ${week}...</div>`;
    tableContainer.innerHTML = '';

    try {
        const [matchupsSnap, boardSnap] = await Promise.all([
            getDocs(query(collection(db, 'matchups'), where('weekStr', '==', weekStr), where('yearStr', '==', yearStr))),
            getDoc(doc(db, 'weeklyPicks', `${yearStr}_${weekStr}`)),
        ]);

        const games = [];
        matchupsSnap.forEach((snap) => games.push({ id: snap.id, ...snap.data() }));
        games.sort((a, b) => toDate(a.commenceTime) - toDate(b.commenceTime));

        const board = boardSnap.exists() ? boardSnap.data() : { players: {} };
        const players = { ...(board.players || {}) };

        // Always show the logged-in user their own picks in full, even for
        // games that haven't started -- the weeklyPicks mirror redacts
        // those, so overlay directly from their own doc (already readable
        // by them per firestore.rules).
        if (currentUser) {
            const ownSnap = await getDoc(doc(db, 'picks', `${currentUser.uid}_week${week}_${year}`));
            if (ownSnap.exists()) {
                const own = ownSnap.data();
                players[currentUser.uid] = { username: own.username, picks: own.picks || {} };
            }
        }

        renderBanner(games);
        renderTable(games, players);
    } catch (error) {
        console.error('Error loading week board: ', error);
        bannerContainer.innerHTML = `<div style="text-align: center; color: var(--color-loss); padding: 40px;">Error loading this week.</div>`;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const weekSelect = document.getElementById('week-select');

    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        if (weekSelect.value) renderWeek(parseInt(weekSelect.value, 10));
    });

    try {
        const [currentWeekRes, resultsRes] = await Promise.all([
            fetch('current_week.json'),
            fetch('results.json').catch(() => ({ ok: false })),
        ]);
        currentWeekInfo = await currentWeekRes.json();
        resultsData = resultsRes.ok ? await resultsRes.json() : {};
    } catch (error) {
        console.error('Error loading current week info: ', error);
        document.getElementById('week-banner').innerHTML = `<div style="text-align: center; color: var(--color-loss); padding: 40px;">Unable to load this week's games.</div>`;
        return;
    }

    const currentWeek = currentWeekInfo.week;
    for (let w = currentWeek; w >= 1; w--) {
        const opt = document.createElement('option');
        opt.value = w;
        opt.textContent = `Week ${w}`;
        weekSelect.appendChild(opt);
    }
    weekSelect.value = currentWeek;
    weekSelect.addEventListener('change', () => renderWeek(parseInt(weekSelect.value, 10)));

    await renderWeek(currentWeek);

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
