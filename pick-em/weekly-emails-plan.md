# Automated weekly emails (Resend, direct send): pick reminder + standings

## Context

The league wants two recurring emails, sent automatically and directly (no
draft-review step — confirmed acceptable by the user, who prioritizes all
recipients being BCC'd over having a chance to edit before sending) to
every player via BCC:

1. **Pick reminder** — before the first game of the week kicks off (assume
   Thursday; week 1 may not actually open on Thursday, but per explicit
   instruction we treat every week the same and don't special-case it).
2. **Weekly winner + standings** — Tuesday morning, reporting the prior
   week's high scorer(s) and the season-long leaderboard.

This extends the existing GitHub Actions pipeline pattern (`update_picks.py`,
`fetch_scores.py`, `.github/workflows/update-matchups.yml`) with two new
standalone Python scripts and a new workflow, following the same style
(plain `requests`-based scripts, no heavy frameworks).

Confirmed decisions from planning discussion:
- **Recipient source**: Firebase Admin SDK `auth.list_users()` — lists every
  signed-up account's email directly from Firebase Auth. No app/schema
  changes, works immediately for existing players, no manual list to
  maintain.
- **Time zone**: Pacific Time. Reminder ~7:00 AM PT Thursday, standings
  ~8:00 AM PT Tuesday (comfortably before any known Thursday kickoff,
  including the 9:30 AM PT Thanksgiving early game, and comfortably after
  Monday Night Football ends).
- **Email link**: `https://3woks.com/pick-em/` (custom domain, matches
  existing `CNAME`).
- **Sender address**: `picks@3woks.com` (display name `"3woks Pick 'Em"`),
  sent via [Resend](https://resend.com) rather than through a personal
  mailbox. Resend only needs to verify domain ownership to send *as*
  `picks@3woks.com` — no actual mailbox/inbox at that address is required.
- **Delivery model**: direct send, no draft/review step. Resend's API has
  no "save as draft" concept — the email goes out the moment the script
  runs. This was an explicit, confirmed tradeoff: the user is fine losing
  the pre-send review in exchange for a much simpler setup (no OAuth flow,
  no mailbox to maintain).
- **BCC structure**: the API requires a non-empty `to` field, so `to` is
  set to `picks@3woks.com` itself (a harmless placeholder, not a real
  recipient) and the actual player list goes entirely in `bcc`, so no
  player ever sees another player's email address.
- **Ties**: list all tied top scorers as co-winners. If nobody submitted
  picks for the week, skip sending the standings email entirely that week.

### Known limitations (documented, not solved)
- GitHub Actions cron is always UTC and does not shift for DST. The NFL
  season spans the Nov DST changeover, so a fixed UTC cron time will
  correspond to PT wall-clock times that drift by ~1 hour across the
  season. We calibrate the cron for **PST** (UTC-8, the timezone in effect
  for most of the season: all of Nov/Dec/Jan). This means during Sept/Oct
  (PDT) the emails will actually land ~1 hour *earlier* than the nominal
  target — the safe direction (never later than intended, never risks
  arriving after kickoff).
- **Recipient cap**: Resend's API has a limit on combined `to`+`cc`+`bcc`
  recipients per call (on the order of 50 — confirm the current exact
  number in Resend's docs before relying on it). Fine for a small
  friend-group league; if the roster ever approached that size, the
  recipient list would need to be chunked into multiple API calls.
- **No pre-send review**: since there's no draft step, a bug in the
  standings calculation or a typo in the copy goes straight to every
  player's inbox with no human checkpoint. Mitigated only by testing the
  scripts thoroughly before relying on the schedule (see Verification).

## Manual prerequisites (user must do these; I can't do them interactively)

1. **Firebase service account key**: Firebase Console → Project Settings →
   Service Accounts → "Generate new private key" (for project
   `nfl-pickem-d3f4d`, per `pick-em/firebase-config.js`). Save the resulting
   JSON. Add its full contents as a GitHub Actions secret named
   `FIREBASE_SERVICE_ACCOUNT_JSON` (Settings → Secrets and variables →
   Actions, in the `kyleajones.github.io` repo).
2. **Resend account + domain verification** (one-time):
   - Sign up at [resend.com](https://resend.com) (free tier: 3,000
     emails/month, 100/day — comfortably covers a weekly two-email
     cadence to a small league).
   - Dashboard → **Domains** → **Add Domain** → enter `3woks.com`.
   - Resend displays the DNS records to add (an SPF TXT record plus a few
     DKIM CNAME/TXT records under a `resend._domainkey`-style selector).
     Add these in Cloudflare's DNS tab for `3woks.com` (same place the
     existing `CNAME` record for GitHub Pages lives). If a `v=spf1` TXT
     record already exists for the domain, merge Resend's `include:` into
     it rather than adding a second SPF record — domains can only have
     one.
   - Back in Resend's dashboard, click **Verify**. Propagation through
     Cloudflare is typically fast (minutes, not hours).
   - No mailbox setup needed — `picks@3woks.com` never needs to receive
     mail for this to work, only to be verified as a sending identity.
3. **Resend API key** (one-time):
   - Dashboard → **API Keys** → **Create API Key**, scoped to sending
     access on the `3woks.com` domain if that option is offered.
   - Add it as a single GitHub secret: `RESEND_API_KEY`.

That's the entire prerequisite list — no OAuth consent flow, no refresh
tokens, no third-party forwarding service, no alias verification. All
three steps are interactive (Firebase Console, Resend dashboard, Cloudflare
DNS) and have to be done by the user; I'll write the scripts that consume
the resulting secrets.

## New files

### `pick-em/pickem_common.py` (new, shared module)
- `get_nfl_week(date)` — **direct line-for-line port** of the existing JS
  in `pick-em/auth.js` (`getNFLWeek`), so week numbers always agree with
  what's stored in Firestore `picks` docs. Kept as a literal port (same
  duplication tradeoff already accepted between `record.js`/`auth.js`);
  comment pointing back to the JS source so both stay in sync if edited.
- `grade_pick(pick_value, pick_type, game_result)` — direct port of
  `gradePick()` from `pick-em/record.js`.
- `compute_points(docs, results_data)` — given an iterable of Firestore
  `picks` doc dicts and `results.json` data, returns `{uid: {"name":...,
  "points": int}}` using the same WIN=3(or 5 if locked)/PUSH=1/LOSS=0
  scoring as `record.js` (reuses `grade_pick`, checks `pickKey ==
  record.get('lockedPick')` for the +2 bonus).
- `list_player_emails(cred_json)` — inits `firebase_admin` (if not already
  initialized) from the service-account JSON (read from
  `FIREBASE_SERVICE_ACCOUNT_JSON` env var), calls `auth.list_users()`,
  returns the list of emails (skips accounts with no email).
- `firestore_client(cred_json)` — returns a `firebase_admin.firestore`
  client for reading the `picks` collection (Admin SDK bypasses
  `firestore.rules`, so this works read-only regardless of the public
  read rule).
- `send_resend_email(subject, html_body, bcc_list)` — a single
  `requests.post` to `https://api.resend.com/emails` with header
  `Authorization: Bearer {RESEND_API_KEY}` (read from env) and JSON body:
  ```json
  {
    "from": "3woks Pick 'Em <picks@3woks.com>",
    "to": ["picks@3woks.com"],
    "bcc": bcc_list,
    "subject": subject,
    "html": html_body
  }
  ```
  No MIME construction, no base64 encoding, no token refresh — this is
  meaningfully simpler than either Gmail or Zoho's draft APIs would have
  required, since Resend uses a static API key rather than OAuth. Raises
  on non-2xx via `resp.raise_for_status()`. Splits `bcc_list` into chunks
  and issues one request per chunk if it exceeds Resend's per-call
  recipient cap (see Known limitations).

### `pick-em/send_reminder_email.py` (new)
- Loads `matchups.json`; if it's an empty list, logs and exits (treated as
  off-season/no games this week — mirrors how `update_picks.py` already
  writes `[]` when the odds API returns nothing).
- Computes `week = get_nfl_week(datetime.now(timezone.utc))`.
- Builds subject `"🏈 Pick 'Em Reminder: Week {week} picks are due before kickoff!"`
  and an HTML body: friendly reminder, deadline note ("before Thursday's
  first kickoff"), link to `https://3woks.com/pick-em/`.
- `bcc_list` = `list_player_emails(...)`.
- Calls `send_resend_email(...)` — email goes out immediately, no review
  step.

### `pick-em/send_standings_email.py` (new)
- `target_week = get_nfl_week(datetime.now(timezone.utc)) - 1` (Tuesday is
  exactly when the existing week-boundary math rolls over, confirmed by
  reading `getNFLWeek`'s `week2Start` = Labor Day + 8 days = a Tuesday — so
  "current week" on Tuesday morning is already the *new* week; subtracting
  1 gives the week whose games just finished).
- If `target_week < 1`, exit (pre-season).
- Reads `results.json` and queries Firestore
  `picks` where `week == target_week` (and matching `year`); if no docs,
  logs and exits (nobody played that week — per user's decision, skip
  sending rather than send an empty/awkward email).
- `weekly_points = compute_points(that_week_docs, results_data)`; finds the
  max point value; lists **all** users tied at that max as co-winners.
- Separately fetches **all** `picks` docs (no week filter) and computes
  season-long standings via the same `compute_points`, sorted descending,
  for the full leaderboard table.
- Builds subject `"🏈 Week {target_week} Results: Winner + Standings"` and
  an HTML body: weekly winner(s) line, then an HTML `<table>` of season
  standings (rank/name/points), link to
  `https://3woks.com/pick-em/record.html`.
- Same `bcc_list`/`send_resend_email` pattern as the reminder script.

### `.github/workflows/pick-em-emails.yml` (new)
- Two `schedule:` cron triggers:
  - `0 15 * * 4` (Thursday 7:00 AM PST / 15:00 UTC) → reminder
  - `0 16 * * 2` (Tuesday 8:00 AM PST / 16:00 UTC) → standings
  - Plus `workflow_dispatch` for manual testing.
- Single job, steps gated by `if: github.event.schedule == '0 15 * * 4'`
  and `if: github.event.schedule == '0 16 * * 2'` respectively (so
  `workflow_dispatch` manual runs can execute both — useful for testing;
  note this in a comment), each running the relevant script with
  `working-directory: ./pick-em` and env vars `FIREBASE_SERVICE_ACCOUNT_JSON`
  and `RESEND_API_KEY` pulled from `${{ secrets.* }}`.
- `pip install firebase-admin requests` (no other deps needed in CI — no
  Gmail/Zoho SDKs required either way, but worth calling out explicitly
  now that there's no OAuth library dependency at all).

## Verification

- Since there's no JS/Python runtime in *this* environment beyond what we
  already confirmed (`python3` is available, no `node`), I can and will:
  - Actually run `pickem_common.get_nfl_week` and `compute_points` locally
    with `python3` against mocked Firestore-doc-shaped dicts and a mocked
    `results.json`, replicating the same test matrix used earlier this
    session for `record.js`'s scoring (WIN/PUSH/LOSS, locked-bonus,
    tie-detection for weekly winner) — this module is real, executable
    Python, unlike the browser-only `.js` files, so this is a real test run,
    not just a simulation script.
  - Dry-run `send_resend_email`'s request-building logic in isolation (no
    network call) to confirm the JSON payload shape and recipient-chunking
    logic are correct.
  - I will **not** be able to exercise the live Resend API or Firebase
    Admin calls myself (no credentials in this environment) — the user
    must smoke test both scripts once by manually triggering
    `workflow_dispatch` after both secrets are in place, then check that
    the email actually arrives (since there's no draft/inbox step to
    verify against beforehand — this is the one place the loss of the
    review step means the first real test *is* a real send).
- Balance-check the new `.py` files (they're real Python, so this is just
  running them / `python3 -m py_compile`, not a brace-count workaround).
- Clearly call out, at the end, the manual steps the user still owes:
  generating the Firebase service-account key; setting up domain
  verification (DNS records in Cloudflare) in Resend; creating the Resend
  API key; and adding both GitHub secrets — none of which I can do from
  here.
