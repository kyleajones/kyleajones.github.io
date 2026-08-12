// Sample data for the week's games
const matchups = [
    { id: 'game1', away: 'Chiefs', home: 'Ravens' },
    { id: 'game2', away: 'Packers', home: 'Eagles' },
    { id: 'game3', away: 'Cowboys', home: 'Browns' }
];

const container = document.getElementById('matchups-container');

// Generate the HTML for each matchup
matchups.forEach(game => {
    const gameDiv = document.createElement('div');
    gameDiv.className = 'matchup';
    
    gameDiv.innerHTML = `
        <label>
            <input type="radio" name="${game.id}" value="${game.away}" required>
            <span class="team-label">${game.away} (Away)</span>
        </label>
        <span>VS</span>
        <label>
            <input type="radio" name="${game.id}" value="${game.home}">
            <span class="team-label">${game.home} (Home)</span>
        </label>
    `;
    container.appendChild(gameDiv);
});

// Capture the picks when the form is submitted
document.getElementById('picks-form').addEventListener('submit', function(e) {
    e.preventDefault(); // Prevent the page from refreshing
    
    const formData = new FormData(e.target);
    const userPicks = {};
    
    for (let [game, pick] of formData.entries()) {
        userPicks[game] = pick;
    }
    
    console.log('Saved Picks:', userPicks);
    alert('Picks saved! Open your browser developer console to see the JSON data.');
});
