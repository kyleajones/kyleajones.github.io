import { db, auth } from './firebase-config.js';
import { collection, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, onAuthStateChanged, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

const loggedOutView = document.getElementById('logged-out-view');
const loggedInView = document.getElementById('logged-in-view');
const userDisplayNameSpan = document.getElementById('user-display-name');
const authError = document.getElementById('auth-error');
const submitPicksBtn = document.getElementById('submit-picks-btn');

let currentUser = null;

// Tracks whether matchups.js has finished rendering the DOM (safe to
// inspect/manipulate) and which uid we last prefilled for, so that
// maybeInitializePicks() only resets/reprefills when the effective user
// actually changes rather than on every incidental onAuthStateChanged fire.
let matchupsRendered = false;
let lastPrefilledUid;

document.addEventListener('matchups:rendered', () => {
    matchupsRendered = true;
    maybeInitializePicks();
});

async function maybeInitializePicks() {
    if (!matchupsRendered) return;

    const effectiveUid = currentUser?.uid ?? null;
    if (effectiveUid === lastPrefilledUid) return;
    lastPrefilledUid = effectiveUid;

    document.dispatchEvent(new CustomEvent('picks:reset'));

    if (!currentUser) return;

    try {
        const week = getNFLWeek(new Date());
        const year = new Date().getFullYear();
        const customDocId = `${currentUser.uid}_week${week}_${year}`;
        const docRef = doc(db, "picks", customDocId);
        const snap = await getDoc(docRef);

        if (snap.exists()) {
            const data = snap.data();
            document.dispatchEvent(new CustomEvent('picks:prefill', {
                detail: { picks: data.picks || {}, lockedPick: data.lockedPick || null }
            }));
        }
    } catch (error) {
        console.error("Error prefilling picks: ", error);
    }
}

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

    maybeInitializePicks();
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

document.getElementById('forgot-password-btn').addEventListener('click', async () => {
    const email = document.getElementById('email-input').value.trim();
    if (!email) {
        authError.textContent = "Enter your email above, then click 'Forgot password?' again.";
        return;
    }
    try {
        authError.textContent = "Sending reset email...";
        await sendPasswordResetEmail(auth, email);
        authError.textContent = "If an account exists for that email, a password reset link has been sent.";
    } catch (error) {
        authError.textContent = "Couldn't send reset email. Check the address and try again.";
    }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await signOut(auth);
});

document.getElementById('picks-form').addEventListener('submit', async function(e) {
    e.preventDefault();

    if (!currentUser) {
        alert("You must be logged in to save picks.");
        return;
    }

    const formData = new FormData(e.target);
    const userPicks = {};
    for (let [key, value] of formData.entries()) {
        if (key === 'lock') continue;
        userPicks[key] = value;
    }
    const submittedLock = formData.get('lock') || null;

    if (Object.keys(userPicks).length === 0) {
        alert("You must make at least one pick before saving.");
        return;
    }

    if (Object.keys(userPicks).length > 7) {
        alert("You can only make up to 7 picks per week.");
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Saving...';
    submitBtn.disabled = true;

    const week = getNFLWeek(new Date());
    const year = new Date().getFullYear();

    try {
        const customDocId = `${currentUser.uid}_week${week}_${year}`;
        const docRef = doc(db, "picks", customDocId);

        // Merge with any previously saved picks so that resubmitting
        // doesn't erase picks for games that have already locked.
        const [existingSnap, matchupsData] = await Promise.all([
            getDoc(docRef),
            fetch('matchups.json').then(r => r.json()).catch(() => [])
        ]);
        const existingPicks = existingSnap.exists() ? (existingSnap.data().picks || {}) : {};
        const existingLockedPick = existingSnap.exists() ? (existingSnap.data().lockedPick || null) : null;

        const mergedPicks = { ...userPicks };
        let carriedOverCount = 0;
        const now = new Date();
        for (const [key, value] of Object.entries(existingPicks)) {
            if (key in userPicks) continue;

            const gameId = key.split('_')[1];
            const game = matchupsData.find(g => g.id === gameId);
            const isLocked = !game || new Date(game.commence_time) <= now;

            if (isLocked) {
                mergedPicks[key] = value;
                carriedOverCount++;
            }
        }

        // Once a locked pick's game has started, the Lock designation itself
        // freezes — independent of whether the underlying pick is being
        // changed — so a player can't wait to see which pick won and then
        // resubmit to retroactively mark that winner as their Lock.
        let finalLockedPick = null;
        if (existingLockedPick) {
            const gameId = existingLockedPick.split('_')[1];
            const game = matchupsData.find(g => g.id === gameId);
            const lockIsFrozen = !game || new Date(game.commence_time) <= now;
            if (lockIsFrozen) finalLockedPick = existingLockedPick;
        }
        if (finalLockedPick === null && submittedLock && submittedLock in mergedPicks) {
            finalLockedPick = submittedLock;
        }

        // The 7-pick cap has to be checked post-merge, not just against this
        // submission's new picks, since carried-over locked picks from an
        // earlier submission also count toward the total that gets scored.
        if (Object.keys(mergedPicks).length > 7) {
            const remainingSlots = Math.max(0, 7 - carriedOverCount);
            alert(`You already have ${carriedOverCount} locked-in pick${carriedOverCount === 1 ? '' : 's'} from this week. You can add up to ${remainingSlots} more new pick${remainingSlots === 1 ? '' : 's'} (max 7 total).`);
            return;
        }

        const pickRecord = {
            userId: currentUser.uid,
            username: currentUser.displayName,
            week: week,
            year: year,
            date: new Date().toISOString(),
            picks: mergedPicks,
            pickCount: Object.keys(mergedPicks).length,
            lockedPick: finalLockedPick
        };

        await setDoc(docRef, pickRecord);

        alert('Picks saved! You can now view your running record.');

        e.target.reset();
        document.querySelectorAll('input[type="radio"]').forEach(input => {
            input.dataset.wasChecked = "false";
        });
        document.dispatchEvent(new CustomEvent('picks:saved'));
    } catch (error) {
        console.error("Error adding document: ", error);
        alert("There was an error saving your picks. Please try again.");
    } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
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
