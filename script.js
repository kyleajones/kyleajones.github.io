// Load logo mapping and get logo URL
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
const PICKS_REQUIRED = 7;
let currentPicks = new Set();
let matchupsData = [];

function updatePickCount() {
    const count = currentPicks.size;
    const counter = document.getElementById('pick-counter');
    if (counter) {
        counter.textContent = `${count}/${PICKS_REQUIRED}`;
        if (count === PICKS_REQUIRED) {
            counter.style.color = '#28a745';
        } else {
            counter.style.color = '#666';
        }
    }
}

function validateAndSubmitPicks() {
    if (currentPicks.size !== PICKS_REQUIRED) {
        alert(`You must make exactly ${PICKS_REQUIRED} picks. Currently: ${currentPicks.size}/${PICKS_REQUIRED}`);
        return false;
    }
    return true;
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

document.addEventListener('DOMContentLoaded', () => {
    // Initialize counter display immediately
    updatePickCount();

    fetch('matchups.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`File not found or server error (Status: ${response.status})`);
            }
            return response.json();
        })
        .then(matchups => {
            matchupsData = matchups;
            const container = document.getElementById('matchups-container');
            
            let currentDayString = '';
            
            matchups.forEach(game => {
                const gameDate = new Date(game.commence_time);
                
                const dayString = gameDate.toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    month: 'short', 
                    day: 'numeric' 
                });

                const timeString = gameDate.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit'
                });

                if (dayString !== currentDayString) {
                    const dayHeader = document.createElement('h2');
                    dayHeader.textContent = dayString;
                    dayHeader.style.marginTop = '40px';
                    dayHeader.style.borderBottom = '2px solid #ddd';
                    dayHeader.style.paddingBottom = '10px';
                    dayHeader.style.color = '#333';
                    
                    container.appendChild(dayHeader);
                    currentDayString = dayString;
                }

                const awayLogo = getTeamLogoUrl(game.away);
                const homeLogo = getTeamLogoUrl(game.home);

                const wrapperDiv = document.createElement('div');
                wrapperDiv.style.marginBottom = '20px';
                
                wrapperDiv.innerHTML = `
                    <div style="text-align: center; margin-bottom: 8px; font-weight: bold; color: #555; font-size: 0.95em;">
                        ${timeString}
                    </div>
                    <div class="odds-summary">
                        <span class="odds-item">Spread: ${game.spread}</span>
                        <span class="odds-item">O/U: ${game.over_under}</span>
                    </div>
                    
                    <div class="game-container">
                        <!-- Spread Picks -->
                        <div class="picks-section">
                            <div class="section-label">Spread</div>
                            <div class="matchup">
                                <label class="team-option">
                                    <input type="radio" name="spread_${game.id}" value="${game.away}">
                                    <div class="team-with-logo">
                                        ${awayLogo ? `<img src="${awayLogo}" alt="${game.away}" class="team-logo" onerror="this.style.display='none'">` : ''}
                                        <span class="team-label">${game.away}</span>
                                    </div>
                                </label>
                                <span class="vs-text">VS</span>
                                <label class="team-option">
                                    <input type="radio" name="spread_${game.id}" value="${game.home}">
                                    <div class="team-with-logo">
                                        ${homeLogo ? `<img src="${homeLogo}" alt="${game.home}" class="team-logo" onerror="this.style.display='none'">` : ''}
                                        <span class="team-label">${game.home}</span>
                                    </div>
                                </label>
                            </div>
                        </div>
                        
                        <!-- Over/Under Picks -->
                        <div class="picks-section">
                            <div class="section-label">Over/Under</div>
                            <div class="ou-picks">
                                <label class="ou-option">
                                    <input type="radio" name="ou_${game.id}" value="Over">
                                    <span class="ou-label">Over ${game.over_under}</span>
                                </label>
                                <label class="ou-option">
                                    <input type="radio" name="ou_${game.id}" value="Under">
                                    <span class="ou-label">Under ${game.over_under}</span>
                                </label>
                            </div>
                        </div>
                    </div>
                `;
                container.appendChild(wrapperDiv);
            });
            
            // Add custom click logic to allow deselecting radio buttons
            document.querySelectorAll('input[type="radio"]').forEach(input => {
                // Keep track of whether this radio was already checked when clicked
                input.dataset.wasChecked = "false";

                input.addEventListener('mousedown', function() {
                    this.dataset.wasChecked = this.checked ? "true" : "false";
                });

                input.addEventListener('click', function() {
                    if (this.dataset.wasChecked === "true") {
                        this.checked = false;
                        this.dataset.wasChecked = "false";
                        // Manually trigger change event so the pick counter updates
                        this.dispatchEvent(new Event('change'));
                    } else {
                        this.dataset.wasChecked = "true";
                        // Uncheck other radios in the same group so their states update cleanly
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
            document.getElementById('matchups-container').innerHTML = '<p>Matchups will be available soon.</p>';
        });

    document.getElementById('picks-form').addEventListener('submit', function(e) {
        e.preventDefault();
        
        if (!validateAndSubmitPicks()) {
            return;
        }
        
        const formData = new FormData(e.target);
        const userPicks = Object.fromEntries(formData.entries());
        
        const week = getWeekNumber(new Date());
        const year = new Date().getFullYear();
        const storageKey = `picks_${year}_week_${week}`;
        
        const pickRecord = {
            week: week,
            year: year,
            date: new Date().toISOString(),
            picks: userPicks,
            pickCount: Object.keys(userPicks).length
        };
        
        localStorage.setItem(storageKey, JSON.stringify(pickRecord));
        
        alert('Picks saved! You can now view your running record.');
        
        currentPicks.clear();
        updatePickCount();
        document.getElementById('picks-form').reset();
    });
});

function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
