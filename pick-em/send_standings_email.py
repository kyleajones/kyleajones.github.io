import json
import os
from datetime import datetime, timezone

from espn_api import week_is_complete
from pickem_common import (
    compute_points,
    escape_html,
    firestore_client,
    resolve_recipients,
    send_resend_email,
)

STANDINGS_URL = "https://3woks.com/pick-em/record.html"


def main():
    with open('current_week.json') as f:
        current_week_data = json.load(f)
    season_type = current_week_data['season_type']

    # "Current week" (per ESPN) is normally already the *new* week by
    # Tuesday morning, so the week whose games just finished is one
    # behind it -- but confirm that explicitly against ESPN's own
    # completed status instead of just trusting the calendar, in case
    # this runs before the rollover (a postponed game, a schedule
    # change, etc.).
    target_week = current_week_data['week'] - 1
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

    # auth.js stores `year: new Date().getFullYear()` at submission time,
    # i.e. the literal calendar year, not the season year — match that.
    year = datetime.now(timezone.utc).year

    week_docs = [
        doc.to_dict()
        for doc in db.collection('picks')
            .where('week', '==', target_week)
            .where('year', '==', year)
            .stream()
    ]

    if not week_docs:
        print(f"No picks submitted for week {target_week} — skipping standings email.")
        return

    weekly_points = compute_points(week_docs, results_data)
    max_points = max(u['points'] for u in weekly_points.values())
    weekly_winners = [u['name'] for u in weekly_points.values() if u['points'] == max_points]

    all_docs = [doc.to_dict() for doc in db.collection('picks').stream()]
    season_points = compute_points(all_docs, results_data)
    standings = sorted(season_points.values(), key=lambda u: u['points'], reverse=True)

    winners_line = " & ".join(escape_html(name) for name in weekly_winners)
    rows = "".join(
        f"<tr><td>{i + 1}</td><td>{escape_html(u['name'])}</td><td>{u['points']}</td></tr>"
        for i, u in enumerate(standings)
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
