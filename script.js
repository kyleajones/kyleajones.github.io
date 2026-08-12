document.addEventListener('DOMContentLoaded', () => {
    fetch('matchups.json')
        .then(response => response.json())
        .then(matchups => {
            const container = document.getElementById('matchups-container');
            
            matchups.forEach(game => {
                const gameDiv = document.createElement('div');
                gameDiv.className = 'matchup';
                
                gameDiv.innerHTML = `
                    
                        
                        
                            ${game.away} (Away) 
                            Spread: ${game.spread}
                        
                    
                    VS
                    
                        
                        ${game.home} (Home)
                    
                `;
                container.appendChild(gameDiv);
            });
        })
        .catch(error => {
            console.error('Error fetching matchups:', error);
            document.getElementById('matchups-container').innerHTML = 'Matchups will be available soon.';
        });

    document.getElementById('picks-form').addEventListener('submit', function(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const userPicks = Object.fromEntries(formData.entries());
        console.log('Saved Picks:', userPicks);
        alert('Picks saved! Open developer console to view.');
    });
});
