# Automated weekly emails (Gmail drafts): pick reminder + standings

## Context

The league wants two recurring emails, generated automatically as **drafts**
in the commissioner's personal Gmail account (never auto-sent, so they can
review/edit first), BCC'd to every player:

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
- **Gmail draft link**: `https://3woks.com/pick-em/` (custom domain, matches
  existing `CNAME`).
- **Sender address**: `picks@3woks.com` (display name `"3woks Pick 'Em"`),
  not the commissioner's raw Gmail address. Since `3woks.com` currently has
  no email hosting (it's just a GitHub Pages CNAME target), this requires
  extra one-time setup — see prerequisites below.
- **Ties**: list all tied top scorers as co-winners. If nobody submitted
  picks for the week, skip sending the standings email entirely that week.
- User is starting Gmail OAuth setup from scratch — plan includes full
  step-by-step instructions for a **one-time, local, manual** consent flow
  (I cannot complete this interactively on the user's behalf).

### Known limitation (documented, not solved)
GitHub Actions cron is always UTC and does not shift for DST. The NFL season
spans the Nov DST changeover, so a fixed UTC cron time will correspond to
PT wall-clock times that drift by ~1 hour across the season. We calibrate
the cron for **PST** (UTC-8, the timezone in effect for most of the season:
all of Nov/Dec/Jan). This means during Sept/Oct (PDT) the emails will
actually land ~1 hour *earlier* than the nominal target — the safe
direction (never later than intended, never risks arriving after kickoff).

## Manual prerequisites (user must do these; I can't do them interactively)

1. **Firebase service account key**: Firebase Console → Project Settings →
   Service Accounts → "Generate new private key" (for project
   `nfl-pickem-d3f4d`, per `pick-em/firebase-config.js`). Save the resulting
   JSON. Add its full contents as a GitHub Actions secret named
   `FIREBASE_SERVICE_ACCOUNT_JSON` (Settings → Secrets and variables →
   Actions, in the `kyleajones.github.io` repo).
2. **Gmail API OAuth client + refresh token** (one-time):
   - In Google Cloud Console, create/select a project, enable the **Gmail
     API**.
   - Create OAuth 2.0 credentials of type **Desktop app**. Note the Client
     ID and Client Secret.
   - Under OAuth consent screen, add the Gmail account as a test user (if
     the app stays in "Testing" status, which is fine for personal use).
   - Locally, run the one-time setup script this plan adds
     (`pick-em/gmail_oauth_setup.py`) — it opens a browser consent screen
     (scope: `gmail.compose`, the narrowest Gmail scope that supports draft
     creation — note it technically also permits sending, since Gmail has
     no drafts-only scope, but the scripts we write will only ever call the
     "create draft" endpoint) and prints a refresh token.
   - Add three GitHub secrets: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
     `GMAIL_REFRESH_TOKEN`.
3. **Enable sending as `picks@3woks.com`** (one-time, needed since the
   domain has no email hosting today):
   - Set up free inbound forwarding for the domain — e.g.
     [ImprovMX](https://improvmx.com) (no nameserver migration required,
     just add the DNS records it gives you at whatever registrar/DNS host
     currently manages `3woks.com`'s records — likely wherever the existing
     `CNAME` record was added). Add ImprovMX's MX records, then configure
     forwarding: `picks@3woks.com` → the commissioner's real Gmail address.
   - In Gmail, Settings → **Accounts** → "Send mail as" → **Add another
     email address** → enter `picks@3woks.com` (uncheck "treat as an
     alias" is fine either way) → Gmail emails a verification link to
     `picks@3woks.com`, which forwards to the real Gmail inbox → click it
     (or enter the confirmation code) to verify.
   - Add an **SPF TXT record** on `3woks.com` authorizing Google's servers
     to send as this domain: `v=spf1 include:_spf.google.com ~all` (if a
     `v=spf1` TXT record already exists for the domain, merge the
     `include:_spf.google.com` into it rather than adding a second SPF
     record — domains can only have one).
   - **Caveat to flag to the user**: without a Google Workspace account for
     this domain, there's no way to get DKIM signing aligned for
     `3woks.com` through personal Gmail's "send mail as" — SPF alone is a
     reasonable, low-effort improvement, but some recipients' spam filters
     may still be pickier the first time. For a small trusted friend-group
     recipient list, this is a one-time "mark as not spam" at worst, not a
     blocker.

I'll write the setup script and exact instructions for all of the above;
the interactive steps (Google OAuth consent, DNS record entry, Gmail alias
verification click) have to be done by the user themselves.

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
- `create_gmail_draft(subject, html_body, bcc_list, to_addr)` — builds a
  MIME `text/html` message (stdlib `email.mime.text.MIMEText`,
  base64url-encodes it), refreshes an access token via a raw POST to
  `https://oauth2.googleapis.com/token` using
  `GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET`/`GMAIL_REFRESH_TOKEN` env vars,
  then POSTs to `https://gmail.googleapis.com/gmail/v1/users/me/drafts`.
  Sets the `From` header to `"3woks Pick 'Em" <picks@3woks.com>` — this
  works because that address is set up as a verified "Send mail as" alias
  on the authenticated Gmail account (see prerequisites); Gmail honors the
  provided `From` for verified aliases both when creating the draft and
  later when the user sends it. Deliberately uses raw `requests` calls
  instead of `google-api-python-client`, keeping CI dependencies minimal
  (matches the existing scripts' style — just `requests`).

### `pick-em/send_reminder_email.py` (new)
- Loads `matchups.json`; if it's an empty list, logs and exits (treated as
  off-season/no games this week — mirrors how `update_picks.py` already
  writes `[]` when the odds API returns nothing).
- Computes `week = get_nfl_week(datetime.now(timezone.utc))`.
- Builds subject `"🏈 Pick 'Em Reminder: Week {week} picks are due before kickoff!"`
  and an HTML body: friendly reminder, deadline note ("before Thursday's
  first kickoff"), link to `https://3woks.com/pick-em/`.
- `to_addr` = the Gmail account's own address (so the draft has a normal
  reviewable "To"); `bcc_list` = `list_player_emails(...)`.
- Calls `create_gmail_draft(...)`.

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
- Same `to_addr`/BCC/`create_gmail_draft` pattern as the reminder script.

### `pick-em/gmail_oauth_setup.py` (new, one-time local-use utility)
- Small script using `google-auth-oauthlib`'s `InstalledAppFlow` (only
  dependency needed locally, never installed in CI) to run the browser
  consent flow for scope `https://www.googleapis.com/auth/gmail.compose`,
  then prints the resulting refresh token to the terminal for the user to
  copy into the `GMAIL_REFRESH_TOKEN` GitHub secret. Includes a top-of-file
  comment explaining it's a one-time setup tool, run locally, not part of
  the CI pipeline, and takes `client_id`/`client_secret` as CLI args (never
  hardcoded/committed).

### `.github/workflows/pick-em-emails.yml` (new)
- Two `schedule:` cron triggers:
  - `0 15 * * 4` (Thursday 7:00 AM PST / 15:00 UTC) → reminder
  - `0 16 * * 2` (Tuesday 8:00 AM PST / 16:00 UTC) → standings
  - Plus `workflow_dispatch` for manual testing.
- Single job, steps gated by `if: github.event.schedule == '0 15 * * 4'`
  and `if: github.event.schedule == '0 16 * * 2'` respectively (so
  `workflow_dispatch` manual runs can execute both — useful for testing;
  note this in a comment), each running the relevant script with
  `working-directory: ./pick-em` and env vars `FIREBASE_SERVICE_ACCOUNT_JSON`,
  `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` pulled
  from `${{ secrets.* }}`.
- `pip install firebase-admin requests` (no other deps needed in CI).

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
  - Dry-run `create_gmail_draft`'s MIME-building logic in isolation (no
    network call) to confirm the base64url encoding and headers are
    well-formed.
  - I will **not** be able to exercise the live Gmail API or Firebase Admin
    calls myself (no credentials in this environment, and creating them
    requires the user's interactive Google consent) — the user must smoke
    test both scripts once by manually triggering `workflow_dispatch` after
    the four secrets are in place, then check their Gmail Drafts folder.
- Balance-check the new `.py` files (they're real Python, so this is just
  running them / `python3 -m py_compile`, not a brace-count workaround).
- Clearly call out, at the end, the manual steps the user still owes:
  generating the Firebase service-account key; setting up ImprovMX
  forwarding + DNS records + SPF for `3woks.com`; verifying `picks@3woks.com`
  as a Gmail "Send mail as" alias; running `gmail_oauth_setup.py` locally
  once; and adding all four GitHub secrets — none of which I can do from
  here.
