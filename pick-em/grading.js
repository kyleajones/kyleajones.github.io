// Shared pick-grading logic, used by both record.js and current-week.js.
// pickem_common.grade_pick is the server-side Python port -- keep in sync.

// Standings order: points desc, then more wins, then fewer losses. Name
// is a final comparison purely so players still tied on all three hold a
// stable display order (otherwise ordering fell out of Object.values()'s
// enumeration of the leaderboard mirror doc and could shuffle between
// loads). pickem_common.standings_sort_key is the Python port -- keep in
// sync, since send_standings_email.py renders the same ranks.
export function compareStandings(a, b) {
    return (b.points - a.points)
        || (b.w - a.w)
        || (a.l - b.l)
        || (a.name || '').localeCompare(b.name || '');
}

// Assigns standard competition ranking ("1224"): players tied on all
// scoring criteria share a rank, and the next distinct entry skips the
// ranks consumed by that tie. Expects `sorted` to already be ordered by
// compareStandings(). Returns [{...entry, rank}].
//
// Name is deliberately NOT part of the tie test -- it's only a
// display-order tiebreaker in compareStandings(), so two players equal on
// points/w/l are a genuine tie and must share a rank badge regardless of
// what they're called. pickem_common.rank_standings is the Python port.
export function rankStandings(sorted) {
    let lastRank = 0;
    let lastKey = null;
    return sorted.map((entry, index) => {
        const key = `${entry.points}|${entry.w}|${entry.l}`;
        if (key !== lastKey) {
            lastRank = index + 1;
            lastKey = key;
        }
        return { ...entry, rank: lastRank };
    });
}
export function gradePick(pickValue, pickType, gameResult) {
    if (!gameResult) return 'PENDING';
    const [selection, lineStr] = pickValue.split('|');

    const scores = gameResult.scores;
    const awayTeam = gameResult.away_team;
    const homeTeam = gameResult.home_team;

    if (scores[awayTeam] === undefined || scores[homeTeam] === undefined) return 'PENDING';

    const awayScore = scores[awayTeam];
    const homeScore = scores[homeTeam];

    // A line is either the literal "PK" (pick'em) or a numeric string.
    // Anything else is ungradeable -- notably "N/A", which is what
    // espn_api._format_spread() writes whenever ESPN has published no odds
    // for a game. parseFloat("N/A") is NaN, and every comparison against
    // NaN is false, so such a pick used to fall through to PUSH and quietly
    // hand out a point (while the Python port raised ValueError instead).
    let line;
    if (lineStr === "PK") {
        line = 0;
    } else {
        line = parseFloat(lineStr);
        if (!Number.isFinite(line)) return 'PENDING';
    }

    if (pickType === 'Spread') {
        // `selection` must name one of the two real teams. Anything else is
        // ungradeable rather than a silent default: without this check an
        // Over/Under value stored under a spread_ key (e.g. "Under|0") fell
        // through to the home-team branch below and got graded as though the
        // total were a spread, which handed out guaranteed wins.
        if (selection !== awayTeam && selection !== homeTeam) return 'PENDING';

        const isAway = (selection === awayTeam);
        const pickedScore = isAway ? awayScore : homeScore;
        const opponentScore = isAway ? homeScore : awayScore;
        const adjustedScore = pickedScore + line;

        if (adjustedScore > opponentScore) return 'WIN';
        if (adjustedScore < opponentScore) return 'LOSS';
        return 'PUSH';
    }
    else if (pickType === 'Over/Under') {
        // Same reasoning as the Spread branch: a team name stored under an
        // ou_ key is ungradeable, and must be rejected before the push
        // check below, which would otherwise report PUSH for it.
        if (selection !== 'Over' && selection !== 'Under') return 'PENDING';

        const totalPoints = awayScore + homeScore;
        if (totalPoints === line) return 'PUSH';
        if (selection === 'Over') return totalPoints > line ? 'WIN' : 'LOSS';
        return totalPoints < line ? 'WIN' : 'LOSS';
    }
    return 'PENDING';
}
