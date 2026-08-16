document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('record-container');
    const allPickHistory = [];

    // 1. Loop through all items in localStorage
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        
        // 2. Only grab the items saved by our pick form
        if (key.startsWith('picks_')) {
            try {
                const data = JSON.parse(localStorage.getItem(key));
                allPickHistory.push(data);
            } catch (e) {
                console.error("Error parsing picks for key:", key);
            }
        }
    }

    // 3. Sort the array so the most recent picks appear at the top
    allPickHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 4. Handle the empty state
    if (allPickHistory.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h2>No picks found</h2>
                <p>You haven't saved any picks yet. Head back to the main page to make your selections!</p>
            </div>
        `;
        return;
    }

    // 5. Generate the HTML for each saved week
    allPickHistory.forEach(record => {
        // Reuse your existing .matchup class for the card background
        const weekCard = document.createElement('div');
        weekCard.className = 'matchup'; 
        weekCard.style.flexDirection = 'column';
        weekCard.style.alignItems = 'stretch';
        weekCard.style.marginBottom = '25px';

        const dateSaved = new Date(record.date).toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        });

        // Build the card header
        let html = `
            <div style="border-bottom: 2px solid #f0f0f0; padding-bottom: 10px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
                <h2 style="margin: 0; font-size: 1.3em;">Year ${record.year} - Week ${record.week}</h2>
                <span style="font-size: 0.85em; color: #888;">Saved: ${dateSaved}</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        `;

        // Iterate through the user's specific picks
        for (const [gameId, selection] of Object.entries(record.picks)) {
            // Determine if it was a spread or an over/under pick based on your naming convention
            const pickType = gameId.startsWith('spread') ? 'Spread' : 'Over/Under';
            
            html += `
                <div style="background: #f9f9f9; padding: 12px; border-radius: 6px; border: 1px solid #eaeaea;">
                    <div style="font-size: 0.75em; color: #666; text-transform: uppercase; font-weight: bold; margin-bottom: 5px;">
                        ${pickType} Pick
                    </div>
                    <div style="font-weight: bold; font-size: 1.1em;">
                        ${selection}
                    </div>
                </div>
            `;
        }

        html += `</div>`;
        weekCard.innerHTML = html;
        container.appendChild(weekCard);
    });
});