// Renders the matchups list and the "How to Play" modal.
//
// Deliberately has zero external/CDN imports (unlike auth.js, which depends
// on the Firebase SDK). This keeps picks visible and the page usable even if
// a browser's content blocker prevents Firebase's scripts from loading.
// ui.js is a local module with the same no-CDN property, so importing it
// doesn't weaken that.
import { initHowToPlayModal } from './ui.js';

// Logo and team-color maps, both consumed during the render below.
//
// These used to be kicked off as bare, unawaited fetch().then() chains that
// assigned into module-level objects. Rendering happens on
// DOMContentLoaded, which routinely won over a cold network fetch, so logos
// and team colors would silently fail to appear -- and the colors aren't
// merely decorative, they're what highlights a selected spread pick. Now
// the render awaits these explicitly.
//
// A failure is still non-fatal: each resolves to {} and the page renders
// with the generic accent color and no logos, which is strictly better than
// not rendering the picks at all.
let logoMap = {};
let teamColorMap = {};

function fetchJsonMap(path, label) {
    return fetch(path)
        .then(response => {
            if (!response.ok) throw new Error(`${path} request failed: ${response.status}`);
            return response.json();
        })
        .catch(error => {
            console.warn(`Could not load ${label}:`, error);
            return {};
        });
}

async function loadTeamAssets() {
    [logoMap, teamColorMap] = await Promise.all([
        fetchJsonMap('logos.json', 'logo mapping'),
        fetchJsonMap('team-colors.json', 'team color mapping'),
    ]);
}

function getTeamLogoUrl(teamName) {
    return logoMap[teamName] || '';
}

function getTeamColor(teamName) {
    return teamColorMap[teamName] || '';
}

// Pick tracking
const MAX_PICKS = 7;
let currentPicks = new Set();

function updatePickCount() {
    const count = currentPicks.size;
    const counter = document.getElementById('pick-counter');
    const progressBar = document.getElementById('pick-progress-bar');
    if (counter) {
        counter.textContent = `${count}/${MAX_PICKS}`;
        counter.style.color = count > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)';
    }
    if (progressBar) {
        const pct = Math.min((count / MAX_PICKS) * 100, 100);
        progressBar.style.width = `${pct}%`;
    }
}

// Once the cap is reached, disable any not-yet-selected, not-already-locked
// radio inputs so a player can't rack up more than MAX_PICKS scored picks.
// This is a UX nicety only — the real enforcement is in firestore.rules,
// since a player could bypass anything client-side via dev tools.
function enforcePickLimit() {
    const atLimit = currentPicks.size >= MAX_PICKS;
    document.querySelectorAll('input[type="radio"]').forEach(input => {
        if (input.checked || input.closest('.game-card.locked')) return;
        if (input.dataset.unavailable === "true") return;
        input.disabled = atLimit;
    });
}

function trackPick(event) {
    const input = event.target;
    const pickId = input.name;

    if (input.checked) {
        currentPicks.add(pickId);
    } else {
        currentPicks.delete(pickId);
    }

    updatePickCount();
    enforcePickLimit();
    rebuildLockOptions();
}

// Rebuilds the Lock-of-the-Week <select> from whatever picks are currently
// checked. Games that have already started are excluded — a player
// shouldn't be able to newly designate an already-started game as their
// lock (though an existing lock on a started game is handled separately,
// via the frozen-lock branch in the picks:prefill listener).
function rebuildLockOptions() {
    const lockSelect = document.getElementById('lock-select');
    if (!lockSelect) return;

    const previousValue = lockSelect.value;

    lockSelect.innerHTML = '<option value="">No Lock</option>';

    currentPicks.forEach(pickId => {
        const input = document.querySelector(`input[name="${pickId}"]:checked`);
        if (!input) return;
        if (input.closest('.game-card.locked')) return;

        const [selection, line] = input.value.split('|');
        const option = document.createElement('option');
        option.value = pickId;
        option.textContent = `${selection} (${line})`;
        lockSelect.appendChild(option);
    });

    const stillValid = Array.from(lockSelect.options).some(opt => opt.value === previousValue);
    lockSelect.value = stillValid ? previousValue : '';
}

// auth.js dispatches this on every auth state change, before prefilling, so
// that switching users (or logging out) doesn't leave a stale prior user's
// picks/lock checked in the DOM.
document.addEventListener('picks:reset', () => {
    document.querySelectorAll('input[type="radio"]').forEach(input => {
        input.checked = false;
        input.dataset.wasChecked = "false";
    });
    currentPicks.clear();
    updatePickCount();
    enforcePickLimit();

    const lockSelect = document.getElementById('lock-select');
    if (lockSelect) {
        lockSelect.innerHTML = '<option value="">No Lock</option>';
        lockSelect.value = '';
        lockSelect.disabled = false;
    }
});

// auth.js dispatches this once it has both a logged-in user and confirmation
// that matchups have rendered, carrying that user's previously saved picks
// (if any) so revisiting the page pre-checks them.
document.addEventListener('picks:prefill', (event) => {
    const { picks = {}, lockedPick = null } = event.detail || {};

    for (const [key, value] of Object.entries(picks)) {
        const candidates = document.querySelectorAll(`input[name="${key}"]`);
        for (const input of candidates) {
            if (input.value === value) {
                input.checked = true;
                input.dataset.wasChecked = "true";
                input.dispatchEvent(new Event('change'));
                break;
            }
        }
    }

    const lockSelect = document.getElementById('lock-select');
    if (!lockSelect) return;

    if (lockedPick) {
        const checkedInput = document.querySelector(`input[name="${lockedPick}"]:checked`);
        const gameCard = checkedInput ? checkedInput.closest('.game-card') : null;
        const isFrozen = gameCard ? gameCard.classList.contains('locked') : false;

        if (isFrozen) {
            const alreadyOption = Array.from(lockSelect.options).some(opt => opt.value === lockedPick);
            if (!alreadyOption && checkedInput) {
                const [selection, line] = checkedInput.value.split('|');
                const option = document.createElement('option');
                option.value = lockedPick;
                option.textContent = `${selection} (${line})`;
                lockSelect.appendChild(option);
            }
            lockSelect.value = lockedPick;
            lockSelect.disabled = true;
        } else {
            lockSelect.value = lockedPick;
            lockSelect.disabled = false;
        }
    } else {
        lockSelect.value = '';
        lockSelect.disabled = false;
    }
});

document.addEventListener('DOMContentLoaded', () => {
    updatePickCount();
    initHowToPlayModal();

    // The logo/color maps are fetched alongside matchups.json and awaited
    // together, so the render below can never start before they've settled.
    Promise.all([
        fetch('matchups.json').then(response => {
            if (!response.ok) {
                throw new Error(`File not found or server error (Status: ${response.status})`);
            }
            return response.json();
        }),
        loadTeamAssets(),
    ])
        .then(([matchups]) => {
            const container = document.getElementById('matchups-container');

            let currentDateTimeString = '';

            matchups.forEach(game => {
                const gameDate = new Date(game.commence_time);

                const dateString = gameDate.toLocaleDateString('en-US', {
                    weekday: 'long', month: 'short', day: 'numeric'
                });
                const timeString = gameDate.toLocaleTimeString('en-US', {
                    hour: 'numeric', minute: '2-digit'
                });
                const dateTimeString = `${dateString} @ ${timeString}`;

                // Inject header using themed styling
                if (dateTimeString !== currentDateTimeString) {
                    const headerWrapper = document.createElement('div');
                    headerWrapper.classList.add('date-header');

                    const blockHeader = document.createElement('h2');
                    blockHeader.textContent = dateTimeString;

                    headerWrapper.appendChild(blockHeader);
                    container.appendChild(headerWrapper);

                    currentDateTimeString = dateTimeString;
                }

                let awaySpread = game.spread;
                let homeSpread = "N/A";

                // game.spread arrives already normalized to the literal
                // string "PK" for a pick'em line (matchups.json's spread
                // field is written from espn_api._format_spread(), which
                // does that conversion upstream) -- it's never the numeric
                // string "0" in practice, so that has to be checked before
                // parseFloat(), which would otherwise return NaN for "PK".
                if (awaySpread === "PK") {
                    homeSpread = "PK";
                } else if (awaySpread !== "N/A") {
                    const spreadVal = parseFloat(awaySpread);
                    if (spreadVal === 0) {
                        awaySpread = "PK";
                        homeSpread = "PK";
                    } else {
                        const inverted = spreadVal * -1;
                        homeSpread = inverted > 0 ? `+${inverted}` : `${inverted}`;
                    }
                }

                const awayLogo = getTeamLogoUrl(game.away);
                const homeLogo = getTeamLogoUrl(game.home);

                const awayColor = getTeamColor(game.away);
                const homeColor = getTeamColor(game.home);
                // Only set the --team-color custom property when a color was
                // found, so CSS's var(--team-color, var(--color-accent))
                // fallback works correctly for any team missing from
                // team-colors.json (an empty custom property value would
                // otherwise NOT fall back, per the CSS var() spec).
                const awayColorStyle = awayColor ? ` style="--team-color: ${awayColor};"` : '';
                const homeColorStyle = homeColor ? ` style="--team-color: ${homeColor};"` : '';

                const isLocked = gameDate <= new Date();
                const lockOverlay = isLocked ? `<div class="locked-banner">🔒 GAME LOCKED</div>` : '';

                // An unpriced line ("N/A", written by
                // espn_api._format_spread()/_format_over_under() when ESPN
                // has published no odds yet) isn't pickable: there's no real
                // line to grade against, so the graders return PENDING and
                // firestore.rules rejects the write outright. Disable those
                // inputs so a player can't make a pick that silently scores
                // nothing. The two sides are independent -- a game often has
                // a published total but no spread, or vice versa.
                // data-unavailable marks these as permanently unpickable, so
                // enforcePickLimit() (which otherwise re-enables any
                // unchecked input whenever the player drops below the cap)
                // leaves them alone.
                const spreadUnavailable = awaySpread === "N/A" || homeSpread === "N/A";
                const ouUnavailable = game.over_under === "N/A" || game.over_under == null;
                const spreadLockAttr = spreadUnavailable
                    ? 'disabled data-unavailable="true"'
                    : (isLocked ? 'disabled' : '');
                const ouLockAttr = ouUnavailable
                    ? 'disabled data-unavailable="true"'
                    : (isLocked ? 'disabled' : '');

                const wrapperDiv = document.createElement('div');
                wrapperDiv.className = 'game-card';
                if (isLocked) wrapperDiv.classList.add('locked');

                wrapperDiv.innerHTML = `
                    ${lockOverlay}
                    <div class="game-container">
                        <!-- Spread Picks -->
                        <div class="picks-section">
                            <div class="matchup">
                                <label class="team-option">
                                    <input type="radio" name="spread_${game.id}" value="${game.away}|${awaySpread}" ${spreadLockAttr}>
                                    <div class="team-with-logo"${awayColorStyle}>
                                        ${awayLogo ? `<div class="team-logo-badge"><img src="${awayLogo}" alt="${game.away}" class="team-logo" onerror="this.parentElement.style.display='none'"></div>` : ''}
                                        <span class="team-label">${game.away}</span>
                                        <span class="spread-badge">${awaySpread}</span>
                                    </div>
                                </label>

                                <div class="home-marker">
                                    <span>@</span>
                                </div>

                                <label class="team-option">
                                    <input type="radio" name="spread_${game.id}" value="${game.home}|${homeSpread}" ${spreadLockAttr}>
                                    <div class="team-with-logo"${homeColorStyle}>
                                        ${homeLogo ? `<div class="team-logo-badge"><img src="${homeLogo}" alt="${game.home}" class="team-logo" onerror="this.parentElement.style.display='none'"></div>` : ''}
                                        <span class="team-label">${game.home}</span>
                                        <span class="spread-badge">${homeSpread}</span>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <!-- Over/Under Picks -->
                        <div class="picks-section">
                            <div class="ou-picks">
                                <label class="ou-option ou-over">
                                    <input type="radio" name="ou_${game.id}" value="Over|${game.over_under}" ${ouLockAttr}>
                                    <span class="ou-label">Over <br><span class="ou-total">${game.over_under}</span></span>
                                </label>
                                <label class="ou-option ou-under">
                                    <input type="radio" name="ou_${game.id}" value="Under|${game.over_under}" ${ouLockAttr}>
                                    <span class="ou-label">Under <br><span class="ou-total">${game.over_under}</span></span>
                                </label>
                            </div>
                        </div>
                    </div>
                `;
                container.appendChild(wrapperDiv);
            });

            document.querySelectorAll('input[type="radio"]').forEach(input => {
                input.dataset.wasChecked = "false";

                input.addEventListener('mousedown', function() {
                    this.dataset.wasChecked = this.checked ? "true" : "false";
                });

                input.addEventListener('click', function() {
                    if (this.dataset.wasChecked === "true") {
                        this.checked = false;
                        this.dataset.wasChecked = "false";
                        this.dispatchEvent(new Event('change'));
                    } else {
                        this.dataset.wasChecked = "true";
                        document.querySelectorAll(`input[name="${this.name}"]`).forEach(other => {
                            if (other !== this) other.dataset.wasChecked = "false";
                        });
                    }
                });

                input.addEventListener('change', trackPick);
            });

            enforcePickLimit();
            rebuildLockOptions();
            document.dispatchEvent(new CustomEvent('matchups:rendered'));
        })
        .catch(error => {
            console.error('Error fetching matchups:', error);
            document.getElementById('matchups-container').innerHTML = '<p style="color: var(--color-text-muted);">Matchups will be available soon.</p>';
        });
});
