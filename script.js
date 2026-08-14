// Function to get team logo URL from a public API
function getTeamLogoUrl(teamName) {
    // Using NFL team IDs and a reliable logo service
    const teamLogos = {
        'New England Patriots': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_ne_logo.png',
        'Seattle Seahawks': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_sea_logo.png',
        'San Francisco 49ers': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_sf_logo.png',
        'Los Angeles Rams': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_la_logo.png',
        'Atlanta Falcons': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_atl_logo.png',
        'Pittsburgh Steelers': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_pit_logo.png',
        'Baltimore Ravens': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_bal_logo.png',
        'Indianapolis Colts': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_ind_logo.png',
        'Buffalo Bills': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_buf_logo.png',
        'Houston Texans': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_hou_logo.png',
        'Chicago Bears': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_chi_logo.png',
        'Carolina Panthers': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_car_logo.png',
        'Tampa Bay Buccaneers': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_tb_logo.png',
        'Cincinnati Bengals': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_cin_logo.png',
        'Cleveland Browns': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_cle_logo.png',
        'Jacksonville Jaguars': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_jax_logo.png',
        'New Orleans Saints': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_no_logo.png',
        'Detroit Lions': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_det_logo.png',
        'New York Jets': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_nyj_logo.png',
        'Tennessee Titans': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_ten_logo.png',
        'Arizona Cardinals': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_ari_logo.png',
        'Los Angeles Chargers': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_lac_logo.png',
        'Green Bay Packers': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_gb_logo.png',
        'Minnesota Vikings': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_min_logo.png',
        'Miami Dolphins': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_mia_logo.png',
        'Las Vegas Raiders': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_lv_logo.png',
        'Washington Commanders': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_was_logo.png',
        'Philadelphia Eagles': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_phi_logo.png',
        'Dallas Cowboys': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_dal_logo.png',
        'New York Giants': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_nyg_logo.png',
        'Denver Broncos': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_den_logo.png',
        'Kansas City Chiefs': 'https://a.espncdn.com/media/motion/2024/1104/dm_241104_nfl_kc_logo.png'
    };
    return teamLogos[teamName] || '';
}

document.addEventListener('DOMContentLoaded', () => {
    fetch('matchups.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`File not found or server error (Status: ${response.status})`);
            }
            return response.json();
        })
        .then(matchups => {
            const container = document.getElementById('matchups-container');
            
            // Tracker variable to watch for day changes
            let currentDayString = '';
            
            matchups.forEach(game => {
                const gameDate = new Date(game.commence_time);
                
                // Extract just the date for the header (e.g., "Sunday, Sep 8")
                const dayString = gameDate.toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    month: 'short', 
                    day: 'numeric' 
                });

                // Extract just the time for the individual game (e.g., "1:00 PM")
                const timeString = gameDate.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit'
                });

                // If the day changes, inject a new header into the container
                if (dayString !== currentDayString) {
                    const dayHeader = document.createElement('h2');
                    dayHeader.textContent = dayString;
                    
                    // Simple styling to make the header pop
                    dayHeader.style.marginTop = '40px';
                    dayHeader.style.borderBottom = '2px solid #ddd';
                    dayHeader.style.paddingBottom = '10px';
                    dayHeader.style.color = '#333';
                    
                    container.appendChild(dayHeader);
                    
                    // Update the tracker
                    currentDayString = dayString;
                }

                // Get team logos
                const awayLogo = getTeamLogoUrl(game.away);
                const homeLogo = getTeamLogoUrl(game.home);

                // Create the matchup block
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
                                    <input type="radio" name="spread_${game.id}" value="${game.away}" required>
                                    <div class="team-with-logo">
                                        <img src="${awayLogo}" alt="${game.away}" class="team-logo" onerror="this.style.display='none'">
                                        <span class="team-label">${game.away}</span>
                                    </div>
                                </label>
                                <span class="vs-text">VS</span>
                                <label class="team-option">
                                    <input type="radio" name="spread_${game.id}" value="${game.home}">
                                    <div class="team-with-logo">
                                        <img src="${homeLogo}" alt="${game.home}" class="team-logo" onerror="this.style.display='none'">
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
        })
        .catch(error => {
            console.error('Error fetching matchups:', error);
            document.getElementById('matchups-container').innerHTML = '<p>Matchups will be available soon.</p>';
        });

    document.getElementById('picks-form').addEventListener('submit', function(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const userPicks = Object.fromEntries(formData.entries());
        console.log('Saved Picks:', userPicks);
        alert('Picks saved! Open developer console to view.');
    });
});
