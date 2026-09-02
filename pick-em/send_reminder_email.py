import json
import os

from pickem_common import resolve_recipients, send_resend_email

PICKS_URL = "https://3woks.com/pick-em/"


def main():
    with open('matchups.json') as f:
        matchups = json.load(f)

    if not matchups:
        # Mirrors how update_picks.py already writes [] when ESPN's
        # scoreboard returns nothing — treated as off-season/no games this week.
        print("No matchups this week (empty matchups.json) — skipping reminder email.")
        return

    with open('current_week.json') as f:
        week = json.load(f)['week']

    subject = f"\U0001F3C8 Pick 'Em Reminder: Lock in your Week {week} picks!"
    html_body = f"""
        <p>Hello there!</p>
        <p>Week {week} picks are open — make sure to lock in your picks before Thursday's first kickoff.</p>
        <p><a href="{PICKS_URL}">Click here to make your picks!</a></p>
        <p>Good luck!</p>
    """

    cred_json = os.environ['FIREBASE_SERVICE_ACCOUNT_JSON']
    bcc_list = resolve_recipients(cred_json)

    if not bcc_list:
        print("No recipient emails found — skipping reminder email.")
        return

    send_resend_email(subject, html_body, bcc_list)
    print(f"Sent Week {week} reminder email to {len(bcc_list)} recipient(s).")


if __name__ == "__main__":
    main()
