import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('record-container');
    const allPickHistory = [];

    // Show a loading state
    container.innerHTML = `<div style="text-align: center; padding: 40px;">Loading your record...</div>`;

    try {
        // Query Firestore for the "picks" collection, ordered newest to oldest
        const q = query(collection(db, "picks"), orderBy("date", "desc"));
        const querySnapshot = await getDocs(q);
        
        querySnapshot.forEach((doc) => {
            allPickHistory.push(doc.data());
        });
        
        // Clear the loading message
        container.innerHTML = '';

        if (allPickHistory.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h2>No picks found</h2>
                    <p>You haven't saved any picks yet. Head back to the main page to make your selections!</p>
                </div>
            `;
            return;
        }

        allPickHistory.forEach(record => {
            const weekCard = document.createElement('div');
            weekCard.className = 'game-card'; 
            weekCard.style.flexDirection = 'column';
            weekCard.style.alignItems = 'stretch';

            const dateSaved = new Date(record.date).toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            });

            let html = `
                <div style="border-bottom: 2px solid #f0f0f0; padding-bottom: 10px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
                    <h2 style="margin: 0; font-size: 1.3em;">Year ${record.year} - Week ${record.week}</h2>
                    <span style="font-size: 0.85em; color: #888;">Saved: ${dateSaved}</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            `;

            for (const [gameId, selection] of Object.entries(record.picks)) {
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

    } catch (error) {
        console.error("Error fetching picks: ", error);
        container.innerHTML = `
            <div style="text-align: center; color: #d9534f; padding: 40px;">
                Error loading your record. Please check your connection and try again.
            </div>
        `;
    }
});