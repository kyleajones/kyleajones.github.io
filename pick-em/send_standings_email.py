import json
import os

from espn_api import week_is_complete
from pickem_common import (
    compute_points,
    escape_html,
    firestore_client,
    rank_standings,
    resolve_recipients,
    send_resend_email,
    standings_sort_key,
)

STANDINGS_URL = "https://3woks.com/pick-em/record.html"


def top_scorers(weekly_points):
    """Returns (max_points, [winner names]) for the week, or None if
    there's nothing worth emailing about.

    None covers two cases that must not produce a send:

    - No scorable entries at all. compute_points() skips docs with no
      picks, so a non-empty week_docs can still reduce to {} here, and
      max() would raise ValueError on the empty sequence.
    - Everyone on zero. That means nothing graded -- week_is_complete()
      consults ESPN directly, but results.json is written by a SEPARATE
      workflow (update-scores.yml) whose scheduled runs have been
      observed hours late, so ESPN can report a finished week while the
      results file this reads is still stale. Congratulating the whole
      league on "the top score of the week (0 points)" reads like a bug;
      better to skip and let the next run send the real thing.
    """
    if not weekly_points:
        return None

    max_points = max(u['points'] for u in weekly_points.values())
    if max_points <= 0:
        return None

    winners = [u['name'] for u in weekly_points.values() if u['points'] == max_points]
    return max_points, winners


def main():
    with open('current_week.json') as f:
        current_week_data = json.load(f)
    season_type = current_week_data['season_type']

    # ESPN's own calendar rolls "current week" over at Wednesday 00:00
    # Pacific (07:00 UTC) -- confirmed live via the scoreboard's
    # leagues[0].calendar[1].entries[].startDate/endDate, e.g. Week 2
    # runs 2026-09-16T07:00Z to 2026-09-23T06:59Z. Our standings cron
    # fires Tuesday 8am Pacific -- strictly BEFORE that boundary, every
    # week -- so current_week.json (written by that morning's ~3am
    # nightly run) still holds the week whose games just finished, not
    # the week before it. No "- 1" needed. Still confirm completion
    # explicitly against ESPN's own status instead of just trusting the
    # calendar, in case of a postponed game or schedule change.
    override = os.environ.get('TARGET_WEEK_OVERRIDE')
    if override:
        # Manual escape hatch (set via workflow_dispatch) for when ESPN's
        # own "current week" hasn't rolled over as expected, so the
        # calendar-based value above would otherwise resolve to the
        # wrong (or a pre-season) week.
        target_week = int(override)
    else:
        target_week = current_week_data['week']
        if target_week < 1:
            print("Pre-season — no completed week to report on. Skipping standings email.")
            return

    if not week_is_complete(target_week, season_type, current_week_data['year']):
        print(f"Week {target_week} isn't fully completed yet — skipping standings email.")
        return

    with open('results.json') as f:
        results_data = json.load(f)

    cred_json = os.environ['FIREBASE_SERVICE_ACCOUNT_JSON']
    db = firestore_client(cred_json)

    # auth.js stores `year` straight from current_week.json's `year` field
    # (the ESPN *season* year, e.g. 2026 for the whole 2026 season including
    # its January 2027 games) -- not the calendar year at submission time.
    # Match that, rather than datetime.now().year, which would silently
    # find zero picks for every season-ending week whose report date lands
    # in the following calendar year.
    year = current_week_data['year']

    week_docs = [
        doc.to_dict()
        for doc in db.collection('picks')
            .where('week', '==', target_week)
            .where('year', '==', year)
            .stream()
    ]

    # Strictly redundant with top_scorers()'s empty check below, but kept
    # so the log distinguishes "nobody submitted picks" from "picks exist
    # but nothing has graded yet" -- the two call for very different
    # follow-up when someone asks why no email arrived.
    if not week_docs:
        print(f"No picks submitted for week {target_week} — skipping standings email.")
        return

    weekly_points = compute_points(week_docs, results_data)
    top = top_scorers(weekly_points)
    if top is None:
        print(
            f"Week {target_week} has no scored picks yet (results likely "
            "not in) — skipping standings email."
        )
        return
    max_points, weekly_winners = top

    all_docs = [doc.to_dict() for doc in db.collection('picks').stream()]
    season_points = compute_points(all_docs, results_data)
    # Same ordering and shared-rank logic as record.js's leaderboard, via
    # the ports in pickem_common, so the emailed standings and the web
    # leaderboard can't disagree on either row order or rank numbers.
    standings = rank_standings(
        sorted(season_points.values(), key=standings_sort_key)
    )

    winners_line = " & ".join(escape_html(name) for name in weekly_winners)
    rows = "".join(
        f"<tr><td>{rank}</td><td>{escape_html(u['name'])}</td><td>{u['points']}</td></tr>"
        for rank, u in standings
    )

    subject = f"\U0001F3C8 Week {target_week} Results: Winner + Standings"
    html_body = f"""
        <p>Week {target_week} is in the books! Congrats to <strong>{winners_line}</strong>
        for the top score of the week ({max_points} points).</p>
        <h3>Season Standings</h3>
        <table border="1" cellpadding="6" cellspacing="0">
            <tr><th>Rank</th><th>Player</th><th>Points</th></tr>
            {rows}
        </table>
        <p><a href="{STANDINGS_URL}">View full results</a></p>
    """

    bcc_list = resolve_recipients(cred_json)
    if not bcc_list:
        print("No recipient emails found — skipping standings email.")
        return

    send_resend_email(subject, html_body, bcc_list)
    print(f"Sent Week {target_week} standings email to {len(bcc_list)} recipient(s).")


if __name__ == "__main__":
    main()
