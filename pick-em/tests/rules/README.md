# Firestore Rules emulator tests

Tests `pick-em/firestore.rules` against a local Firestore emulator using
`@firebase/rules-unit-testing` + Node's built-in test runner (`node:test`).
No live Firebase project or credentials needed -- everything runs against
a fake local project ID (`demo-pickem`).

## Run locally

```bash
cd pick-em/tests/rules
npm install
npx firebase emulators:exec --project=demo-pickem "node --test *.test.js"
```

`firebase emulators:exec` starts the Firestore emulator (config in
`firebase.json`, pointed at the real `../../firestore.rules`), runs the
given command against it, then shuts the emulator down -- so no manual
emulator start/stop is needed.

## Notes

- Each test file seeds any fixture data (e.g. `matchups/{gameId}` mirror
  docs) via `withSecurityRulesDisabled()`, the same way `update_picks.py`'s
  Admin SDK writes them in production -- tests never rely on the rules
  under test to also seed themselves.
- `afterEach` calls `clearFirestore()` so every test starts from a clean
  slate.
