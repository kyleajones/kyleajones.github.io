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
                    <div class="matchup" style="margin-bottom: 0;">
                        <label>
                            <input type="radio" name="${game.id}" value="${game.away}" required>
                            <span class="team-label">
                                ${game.away} (Away)
                            </span>
                        </label>
                        <span>VS</span>
                        <label>
                            <input type="radio" name="${game.id}" value="${game.home}">
                            <span class="team-label">${game.home} (Home)</span>
                        </label>
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
