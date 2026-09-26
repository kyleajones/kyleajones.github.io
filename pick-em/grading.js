// Shared pick-grading logic, used by both record.js and current-week.js.
// pickem_common.grade_pick is the server-side Python port -- keep in sync.
export function gradePick(pickValue, pickType, gameResult) {
    if (!gameResult) return 'PENDING';
    const [selection, lineStr] = pickValue.split('|');
    let line = parseFloat(lineStr);
    if (lineStr === "PK") line = 0;

    const scores = gameResult.scores;
    const awayTeam = gameResult.away_team;
    const homeTeam = gameResult.home_team;

    if (scores[awayTeam] === undefined || scores[homeTeam] === undefined) return 'PENDING';

    const awayScore = scores[awayTeam];
    const homeScore = scores[homeTeam];

    if (pickType === 'Spread') {
        const isAway = (selection === awayTeam);
        const pickedScore = isAway ? awayScore : homeScore;
        const opponentScore = isAway ? homeScore : awayScore;
        const adjustedScore = pickedScore + line;

        if (adjustedScore > opponentScore) return 'WIN';
        if (adjustedScore < opponentScore) return 'LOSS';
        return 'PUSH';
    }
    else if (pickType === 'Over/Under') {
        const totalPoints = awayScore + homeScore;
        if (totalPoints === line) return 'PUSH';
        if (selection === 'Over') return totalPoints > line ? 'WIN' : 'LOSS';
        if (selection === 'Under') return totalPoints < line ? 'WIN' : 'LOSS';
    }
    return 'PENDING';
}
