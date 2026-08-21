import { db, auth } from './firebase-config.js';
import { collection, doc, setDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

const loggedOutView = document.getElementById('logged-out-view');
const loggedInView = document.getElementById('logged-in-view');
const userDisplayNameSpan = document.getElementById('user-display-name');
const authError = document.getElementById('auth-error');
const submitPicksBtn = document.getElementById('submit-picks-btn');

let currentUser = null;

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        loggedOutView.style.display = 'none';
        loggedInView.style.display = 'block';
        userDisplayNameSpan.textContent = user.displayName || user.email;
        submitPicksBtn.disabled = false; 
    } else {
        currentUser = null;
        loggedOutView.style.display = 'block';
        loggedInView.style.display = 'none';
        submitPicksBtn.disabled = true; 
    }
});

document.getElementById('signup-btn').addEventListener('click', async () => {
    const email = document.getElementById('email-input').value.trim();
    const password = document.getElementById('password-input').value.trim();
    const displayName = document.getElementById('display-name-input').value.trim();
    
    if (!email || !password || !displayName) {
        authError.textContent = "Please fill out Email, Password, and Your Name to sign up.";
        return;
    }
    
    try {
        authError.textContent = "Creating account...";
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: displayName });
        userDisplayNameSpan.textContent = displayName;
        authError.textContent = "";
    } catch (error) {
        authError.textContent = error.message;
    }
});

document.getElementById('login-btn').addEventListener('click', async () => {
    const email = document.getElementById('email-input').value.trim();
    const password = document.getElementById('password-input').value.trim();
    
    try {
        authError.textContent = "Logging in...";
        await signInWithEmailAndPassword(auth, email, password);
        authError.textContent = "";
    } catch (error) {
        authError.textContent = "Login failed. Check your email and password.";
    }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await signOut(auth);
});

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

// Pick tracking (Dynamic)
let currentPicks = new Set();
let matchupsData = [];

function updatePickCount() {
    const count = currentPicks.size;
    const counter = document.getElementById('pick-counter');
    if (counter) {
        // Changed to just show total picks made, no strict limit
        counter.textContent = `${count}`;
        counter.style.color = count > 0 ? '#28a745' : '#666';
    }
}

function validateAndSubmitPicks() {
    if (currentPicks.size === 0) {
        alert("You must make at least one pick before saving.");
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
            
            let currentDateTimeString = '';

            matchups.forEach(game => {
                const gameDate = new Date(game.commence_time);
                
                // Format the date and time for the group header
                const dateString = gameDate.toLocaleDateString('en-US', { 
                    weekday: 'long', month: 'short', day: 'numeric' 
                });
                const timeString = gameDate.toLocaleTimeString('en-US', {
                    hour: 'numeric', minute: '2-digit'
                });
                const dateTimeString = `${dateString} @ ${timeString}`;

                // Inject a header if it's a new date/time block
                if (dateTimeString !== currentDateTimeString) {
                    // 1. Create the colored wrapper box
                    const headerWrapper = document.createElement('div');
                    headerWrapper.style.background = '#e3f2fd';
                    headerWrapper.style.padding = '10px 15px';
                    headerWrapper.style.margin = '25px 0 15px 0';
                    headerWrapper.style.borderRadius = '6px';
                    headerWrapper.style.borderLeft = '6px solid #0d47a1';
                    headerWrapper.style.display = 'flex';
                    headerWrapper.style.alignItems = 'center';

                    // 2. Create the text element
                    const blockHeader = document.createElement('h2');
                    blockHeader.textContent = dateTimeString;
                    blockHeader.style.margin = '0';
                    blockHeader.style.color = '#0d47a1';
                    blockHeader.style.fontSize = '1.25em';
                    
                    // 3. Assemble and attach to the main container
                    headerWrapper.appendChild(blockHeader);
                    container.appendChild(headerWrapper);
                    
                    // Update the tracker
                    currentDateTimeString = dateTimeString;
                }

                // Automatically assign and flip the spread for Away vs Home
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

                // Calculate if the game has already started
                const isLocked = gameDate <= new Date();
                const lockAttr = isLocked ? 'disabled' : '';
                const lockOverlay = isLocked ? `<div style="text-align: center; color: #dc3545; font-weight: bold; font-size: 0.8em; margin-bottom: 5px;">🔒 GAME LOCKED</div>` : '';

                const wrapperDiv = document.createElement('div');
                wrapperDiv.className = 'game-card';
                // Add a slight opacity fade if the game is locked
                if (isLocked) wrapperDiv.style.opacity = '0.7';
                
                wrapperDiv.innerHTML = `
                    ${lockOverlay}
                    <div class="game-container" style="margin-bottom: 0;">
                        <!-- Spread Picks -->
                        <div class="picks-section">
                            <div class="matchup" style="box-shadow: none; padding: 0; background: transparent;">
                                <label class="team-option">
                                    <input type="radio" name="spread_${game.id}" value="${game.away}|${awaySpread}" ${lockAttr}>
                                    <div class="team-with-logo">
                                        ${awayLogo ? `<img src="${awayLogo}" alt="${game.away}" class="team-logo" onerror="this.style.display='none'">` : ''}
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
                                        ${homeLogo ? `<img src="${homeLogo}" alt="${game.home}" class="team-logo" onerror="this.style.display='none'">` : ''}
                                        <span class="team-label">${game.home}</span>
                                        <span class="spread-badge">${homeSpread}</span>
                                    </div>
                                </label>
                            </div>
                        </div>
                        
                        <!-- Over/Under Picks -->
                        <div class="picks-section">
                            <div class="ou-picks" style="box-shadow: none; padding: 0; background: transparent; height: 100%; align-items: center;">
                                <label class="ou-option">
                                    <input type="radio" name="ou_${game.id}" value="Over|${game.over_under}" ${lockAttr}>
                                    <span class="ou-label">Over <br><span style="font-weight: normal; font-size: 0.9em;">${game.over_under}</span></span>
                                </label>
                                <label class="ou-option">
                                    <input type="radio" name="ou_${game.id}" value="Under|${game.over_under}" ${lockAttr}>
                                    <span class="ou-label">Under <br><span style="font-weight: normal; font-size: 0.9em;">${game.over_under}</span></span>
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

    document.getElementById('picks-form').addEventListener('submit', async function(e) {
		e.preventDefault();
		
		// Block submission if not logged in
		if (!currentUser) {
			alert("You must be logged in to save picks.");
			return;
		}
		
		if (!validateAndSubmitPicks()) {
			return;
		}
		
		const submitBtn = e.target.querySelector('button[type="submit"]');
		const originalText = submitBtn.textContent;
		submitBtn.textContent = 'Saving...';
		submitBtn.disabled = true;
	
		// Build userPicks by looping over formData 
		const formData = new FormData(e.target);
		const userPicks = {};
		for (let [key, value] of formData.entries()) {
			userPicks[key] = value;
		}
		
		const week = getNFLWeek(new Date());
		const year = new Date().getFullYear();
		
		const pickRecord = {
			userId: currentUser.uid,                  // Stores the secure Firebase ID
			username: currentUser.displayName,        // Stores their profile name
			week: week,
			year: year,
			date: new Date().toISOString(),
			picks: userPicks,
			pickCount: Object.keys(userPicks).length
		};
		
		try {
			// Create a unique but predictable document ID for this user's weekly ticket
            const customDocId = `${currentUser.uid}_week${week}_${year}`;
            
            // setDoc will create the document if it doesn't exist, or overwrite it if it does
            await setDoc(doc(db, "picks", customDocId), pickRecord);
            
            alert('Picks saved! You can now view your running record.');
		
			currentPicks.clear();
			updatePickCount();
			e.target.reset();
			document.querySelectorAll('input[type="radio"]').forEach(input => {
				input.dataset.wasChecked = "false";
			});
		} catch (error) {
			console.error("Error adding document: ", error);
			alert("There was an error saving your picks. Please try again.");
		} finally {
			submitBtn.textContent = originalText;
			submitBtn.disabled = false;
		}
	});
});

function getNFLWeek(date = new Date()) {
    const currentYear = date.getFullYear();
    
    // Helper to find Labor Day (first Monday of September)
    function getLaborDay(yr) {
        const sept1 = new Date(yr, 8, 1);
        const dayOfWeek = sept1.getDay();
        const daysToFirstMonday = (1 - dayOfWeek + 7) % 7;
        return new Date(yr, 8, 1 + daysToFirstMonday);
    }
    
    let seasonYear = currentYear;
    
    // If we are in January through July, we are in the previous NFL season's calendar year
    if (date.getMonth() < 7) {
        seasonYear = currentYear - 1;
    }
    
    const laborDay = getLaborDay(seasonYear);
    
    // Week 2 ALWAYS starts on the Tuesday that is exactly 8 days after Labor Day.
    // This ignores the Wed/Thu kickoff variation and anchors to the post-Sunday reset.
    const week2Start = new Date(seasonYear, 8, laborDay.getDate() + 8);
    week2Start.setHours(0, 0, 0, 0); // Midnight on Tuesday
    
    // If the current date is before the Week 2 transition Tuesday, it is Week 1
    if (date < week2Start) {
        return 1;
    }
    
    // After the transition Tuesday, calculate how many 7-day blocks have passed
    const diffTime = date.getTime() - week2Start.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const weeksSinceWeek2 = Math.floor(diffDays / 7);
    
    const weekNum = 2 + weeksSinceWeek2;
    return weekNum > 18 ? 18 : weekNum;
}

