// Shared presentation helpers used by every page's entry module.
//
// Deliberately contains no external/CDN imports, so the modules that
// depend on it (notably matchups.js, which must keep rendering picks even
// when a content blocker kills the Firebase SDK) stay free of any
// third-party dependency. Kept separate from grading.js because that file
// is scoring/standings logic with no DOM involvement.

// Escape user-controlled strings (display names, pick values) before
// they're interpolated into innerHTML, so a crafted display name can't
// inject markup that executes in every visitor's browser.
export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// The single source of truth for the game's rules copy.
//
// This markup used to be pasted into index.html, current-week.html and
// record.html, so the scoring numbers lived in three places and could
// drift from what pickem_common.compute_points() actually awards -- and
// did: the standings section said only "highest score wins", which stopped
// being the whole story once ties started being broken by W/L record.
// Injecting it from here means the text is written once.
//
// Keep the numbers below in sync with compute_points() (WIN = 3, or 5 when
// locked; PUSH = 1; LOSS = 0) and the tiebreak wording in sync with
// compareStandings()/standings_sort_key().
const HOW_TO_PLAY_HTML = `
    <div class="modal-content">
        <button type="button" class="modal-close" id="modal-close-btn">&times;</button>
        <h2>How to Play</h2>

        <p>Welcome to 3woks NFL Pick'em! Make your picks each week to win it all.</p>

        <div class="rules-section">
            <h3>Scoring Rules</h3>
            <ul>
                <li><strong>Correct Pick:</strong> 3 Points</li>
                <li><strong>Push / Tie:</strong> 1 Point</li>
                <li><strong>Incorrect Pick:</strong> 0 Points</li>
                <li><strong>Lock of the Week (correct):</strong> 5 Points</li>
            </ul>
        </div>

        <div class="rules-section">
            <h3>Making Picks</h3>
            <ul>
                <li>Pick up to 7 games (either against the spread and/or over/unders).</li>
                <li>Optionally designate one pick as your "Lock of the Week" for a bonus if it wins.</li>
                <li>Picks must be submitted before each game's scheduled kickoff time.</li>
                <li>Highest score at the end of each week wins a prize, and highest score at the end of the season wins the championship!</li>
            </ul>
        </div>

        <div class="rules-section">
            <h3>Standings &amp; Ties</h3>
            <ul>
                <li>Players level on points are separated first by more wins, then by fewer losses.</li>
                <li>Players still level after that genuinely tie, and share the same rank.</li>
            </ul>
        </div>
    </div>
`;

// Injects the "How to Play" modal and wires the nav link that opens it.
// Safe to call on any page: it no-ops when the nav link is absent, and
// won't inject twice.
export function initHowToPlayModal() {
    const openBtn = document.getElementById('how-to-play-link');
    if (!openBtn) return;
    if (document.getElementById('how-to-play-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'how-to-play-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = HOW_TO_PLAY_HTML;
    document.body.appendChild(modal);

    openBtn.addEventListener('click', (e) => {
        e.preventDefault();
        modal.style.display = 'flex';
    });

    modal.querySelector('#modal-close-btn').addEventListener('click', () => {
        modal.style.display = 'none';
    });

    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
}
