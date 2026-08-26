// Renders the matchups list and the "How to Play" modal.
//
// Deliberately has zero external/CDN imports (unlike auth.js, which depends
// on the Firebase SDK). This keeps picks visible and the page usable even if
// a browser's content blocker prevents Firebase's scripts from loading.

// Load logo mapping
let logoMap = {};

fetch('logos.json')
    .then(response => response.json())
    .then(data => {
        logoMap = data;
    })
    .catch(error => console.warn('Could not load logo mapping:', error));

function getTeamLogoUrl(teamName) {
    return logoMap[teamName] || '';
}

// Pick tracking
let currentPicks = new Set();

function updatePickCount() {
    const count = currentPicks.size;
    const counter = document.getElementById('pick-counter');
    const progressBar = document.getElementById('pick-progress-bar');
    if (counter) {
        counter.textContent = `${count}/7`;
        counter.style.color = count > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)';
    }
    if (progressBar) {
        const pct = Math.min((count / 7) * 100, 100);
        progressBar.style.width = `${pct}%`;
    }
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
}

// Reset local pick-tracking state once auth.js confirms a save succeeded.
document.addEventListener('picks:saved', () => {
    currentPicks.clear();
    updatePickCount();
});

document.addEventListener('DOMContentLoaded', () => {
    updatePickCount();

    fetch('matchups.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`File not found or server error (Status: ${response.status})`);
            }
            return response.json();
        })
        .then(matchups => {
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

                if (awaySpread !== "N/A") {
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

                const isLocked = gameDate <= new Date();
                const lockAttr = isLocked ? 'disabled' : '';
                const lockOverlay = isLocked ? `<div class="locked-banner">🔒 GAME LOCKED</div>` : '';

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
                                    <input type="radio" name="spread_${game.id}" value="${game.away}|${awaySpread}" ${lockAttr}>
                                    <div class="team-with-logo">
                                        ${awayLogo ? `<div class="team-logo-badge"><img src="${awayLogo}" alt="${game.away}" class="team-logo" onerror="this.parentElement.style.display='none'"></div>` : ''}
                                        <span class="team-label">${game.away}</span>
                                        <span class="spread-badge">${awaySpread}</span>
                                    </div>
                                </label>

                                <div class="home-marker">
                                    <span>@</span>
                                </div>

                                <label class="team-option">
                                    <input type="radio" name="spread_${game.id}" value="${game.home}|${homeSpread}" ${lockAttr}>
                                    <div class="team-with-logo">
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
                                <label class="ou-option">
                                    <input type="radio" name="ou_${game.id}" value="Over|${game.over_under}" ${lockAttr}>
                                    <span class="ou-label">Over <br><span class="ou-total">${game.over_under}</span></span>
                                </label>
                                <label class="ou-option">
                                    <input type="radio" name="ou_${game.id}" value="Under|${game.over_under}" ${lockAttr}>
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
        })
        .catch(error => {
            console.error('Error fetching matchups:', error);
            document.getElementById('matchups-container').innerHTML = '<p style="color: var(--color-text-muted);">Matchups will be available soon.</p>';
        });

    // How to Play Modal Logic
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
