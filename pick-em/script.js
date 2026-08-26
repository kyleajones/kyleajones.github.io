import { db, auth } from './firebase-config.js';
import { collection, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
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
let matchupsData = [];

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

    document.getElementById('picks-form').addEventListener('submit', async function(e) {
		e.preventDefault();
		
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
	
		const formData = new FormData(e.target);
		const userPicks = {};
		for (let [key, value] of formData.entries()) {
			userPicks[key] = value;
		}
		
		const week = getNFLWeek(new Date());
		const year = new Date().getFullYear();

		try {
            const customDocId = `${currentUser.uid}_week${week}_${year}`;
            const docRef = doc(db, "picks", customDocId);

            // Merge with any previously saved picks so that resubmitting
            // doesn't erase picks for games that have already locked.
            const existingSnap = await getDoc(docRef);
            const existingPicks = existingSnap.exists() ? (existingSnap.data().picks || {}) : {};

            const mergedPicks = { ...userPicks };
            const now = new Date();
            for (const [key, value] of Object.entries(existingPicks)) {
                if (key in userPicks) continue;

                const gameId = key.split('_')[1];
                const game = matchupsData.find(g => g.id === gameId);
                const isLocked = !game || new Date(game.commence_time) <= now;

                if (isLocked) {
                    mergedPicks[key] = value;
                }
            }

            const pickRecord = {
                userId: currentUser.uid,
                username: currentUser.displayName,
                week: week,
                year: year,
                date: new Date().toISOString(),
                picks: mergedPicks,
                pickCount: Object.keys(mergedPicks).length
            };

            await setDoc(docRef, pickRecord);
            
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
	// How to Play Modal Logic (Inside DOMContentLoaded)
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

function getNFLWeek(date = new Date()) {
    const currentYear = date.getFullYear();
    
    function getLaborDay(yr) {
        const sept1 = new Date(yr, 8, 1);
        const dayOfWeek = sept1.getDay();
        const daysToFirstMonday = (1 - dayOfWeek + 7) % 7;
        return new Date(yr, 8, 1 + daysToFirstMonday);
    }
    
    let seasonYear = currentYear;
    if (date.getMonth() < 7) {
        seasonYear = currentYear - 1;
    }
    
    const laborDay = getLaborDay(seasonYear);
    const week2Start = new Date(seasonYear, 8, laborDay.getDate() + 8);
    week2Start.setHours(0, 0, 0, 0); 
    
    if (date < week2Start) {
        return 1;
    }
    
    const diffTime = date.getTime() - week2Start.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const weeksSinceWeek2 = Math.floor(diffDays / 7);
    
    const weekNum = 2 + weeksSinceWeek2;
    return weekNum > 18 ? 18 : weekNum;
}

