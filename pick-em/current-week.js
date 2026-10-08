import { db, auth } from './firebase-config.js';
import { collection, getDocs, query, where, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { gradePick } from './grading.js';

const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

// Direct client-side poll of ESPN's scoreboard endpoint -- confirmed
// CORS-open (access-control-allow-origin: *) from a browser, see
// docs/live-scoring-scheduling-plan.md. Replaces the Firestore liveScores
// mirror a 15-minute GitHub Actions cron used to keep fresh, whose
// schedule: trigger isn't reliable enough during a ~3-hour game window.
// Mirrors espn_api.py's live_scores()/_scored_games() parsing so the shape
// returned here matches what applyLiveOverlay() already expects.
async function fetchEspnLiveScores(week, seasonType, year) {
    const url = `${ESPN_SCOREBOARD_URL}?week=${week}&seasontype=${seasonType}&dates=${year}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`ESPN scoreboard request failed: ${response.status}`);
    const data = await response.json();

    const games = {};
    for (const event of data.events || []) {
        const competition = event.competitions[0];
        const statusType = competition.status.type;
        if (!statusType.completed && statusType.state !== 'in') continue;

        const competitors = competition.competitors;
        const away = competitors.find((c) => c.homeAway === 'away');
        const home = competitors.find((c) => c.homeAway === 'home');
        if (away?.score == null || home?.score == null) continue;

        const awayTeam = away.team.displayName;
        const homeTeam = home.team.displayName;
        games[event.id] = {
            away_team: awayTeam,
            home_team: homeTeam,
            scores: { [awayTeam]: Number(away.score), [homeTeam]: Number(home.score) },
            completed: statusType.completed,
        };
    }
    return games;
}

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

// Guards against a slow/stale async renderWeek (or live tick) painting the
// DOM after the user has since switched to a different week -- checked
// after every await, before anything gets rendered from that call.
let activeRenderWeek = null;

// Set after a full renderWeek() completes, so the periodic live tick below
// can cheaply re-render the same games/players without re-running the
// matchups/weeklyPicks/own-picks queries that don't change minute to
// minute.
let liveTickState = null;
let liveRefreshTimer = null;
const LIVE_REFRESH_MS = 60000;

function stopLiveRefresh() {
    if (liveRefreshTimer) {
        clearInterval(liveRefreshTimer);
        liveRefreshTimer = null;
    }
}

function weekHasLiveGame(games) {
    return games.some((game) => resultsData[game.id]?.completed === false);
}

// Merges live ESPN games into resultsData, but never lets a stale "still
// in progress" live snapshot regress a game that's already resolved to a
// final result (from results.json, or from an earlier tick that already
// saw it complete) -- guards against a mid-poll ESPN hiccup reporting one
// of this week's games as unfinished after it already wrapped up.
function applyLiveOverlay(liveGames) {
    for (const [gameId, liveGame] of Object.entries(liveGames)) {
        const existing = resultsData[gameId];
        if (existing && existing.completed !== false) continue;
        resultsData[gameId] = liveGame;
    }
}

async function liveTick() {
    if (!liveTickState) return;
    const { week, games, players } = liveTickState;

    let liveGames;
    try {
        liveGames = await fetchEspnLiveScores(week, currentWeekInfo.season_type, currentWeekInfo.year);
    } catch (error) {
        console.error('Error refreshing live scores: ', error);
        return;
    }
    if (activeRenderWeek !== week) return; // user switched weeks while this was in flight

    applyLiveOverlay(liveGames);
    renderBanner(games);
    renderTable(games, players);

    if (!weekHasLiveGame(games)) stopLiveRefresh();
}

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
            const isLive = result.completed === false;
            scoreHtml = `<span class="banner-score${isLive ? ' banner-score-live' : ''}">${awayScore} - ${homeScore}${isLive ? ' <span class="live-dot" title="Live">LIVE</span>' : ''}</span>`;
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
    const gameResult = resultsData[gameId];
    const status = gradePick(pickValue, pickType, gameResult);
    const statusClass = { WIN: 'win', LOSS: 'loss', PUSH: 'tie', PENDING: 'pending' }[status] || 'pending';
    const label = pickType === 'Spread' ? teamName(selection) : `${selection} ${lineStr}`;
    const isLive = gameResult?.completed === false && status !== 'PENDING';

    return `<span class="pick-badge pick-badge-${statusClass}${isLive ? ' pick-badge-live' : ''}" title="${escapeHtml(pickType)}${isLive ? ' (live, not final)' : ''}">${escapeHtml(label)}</span>`;
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
    activeRenderWeek = week;
    stopLiveRefresh();
    liveTickState = null;

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
        if (activeRenderWeek !== week) return; // user switched weeks while this was in flight

        const games = [];
        matchupsSnap.forEach((snap) => games.push({ id: snap.id, ...snap.data() }));
        games.sort((a, b) => toDate(a.commenceTime) - toDate(b.commenceTime));

        const board = boardSnap.exists() ? boardSnap.data() : { players: {} };
        const players = { ...(board.players || {}) };

        // Overlay live ESPN scores on top of the once-daily results.json
        // snapshot -- fetched directly, not via a cron-fed mirror, so
        // there's no schedule to be delayed. A failure here (network
        // blip, ESPN hiccup) just means this render falls back to
        // whatever results.json already had; it shouldn't break the rest
        // of the week from loading.
        const liveGames = await fetchEspnLiveScores(week, currentWeekInfo.season_type, year).catch((error) => {
            console.error('Error fetching live scores: ', error);
            return {};
        });
        if (activeRenderWeek !== week) return;
        applyLiveOverlay(liveGames);

        // Always show the logged-in user their own picks in full, even for
        // games that haven't started -- the weeklyPicks mirror redacts
        // those, so overlay directly from their own doc (already readable
        // by them per firestore.rules).
        if (currentUser) {
            const ownSnap = await getDoc(doc(db, 'picks', `${currentUser.uid}_week${week}_${year}`));
            if (activeRenderWeek !== week) return;
            if (ownSnap.exists()) {
                const own = ownSnap.data();
                players[currentUser.uid] = { username: own.username, picks: own.picks || {} };
            }
        }

        renderBanner(games);
        renderTable(games, players);

        // Only keep polling while this week actually has a game in
        // progress -- an old, fully-final week (or a live week once every
        // game ends) stops re-fetching on its own instead of ticking
        // forever for no reason.
        liveTickState = { week, yearStr, weekStr, games, players };
        if (weekHasLiveGame(games)) {
            liveRefreshTimer = setInterval(liveTick, LIVE_REFRESH_MS);
        }
    } catch (error) {
        if (activeRenderWeek !== week) return; // don't clobber a newer, valid view with a stale error
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
