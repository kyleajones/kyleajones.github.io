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
`firebase.json`), runs the given command against it, then shuts the
emulator down -- so no manual emulator start/stop is needed.

## Notes

- `firebase.json`'s `rules` field points at the local `placeholder.rules`
  (a harmless deny-everything ruleset), NOT the real
  `pick-em/firestore.rules` -- firebase-tools refuses to reference a
  rules file outside its project directory (i.e. anything via `../`)
  from `firebase.json`. The placeholder is never actually enforced:
  each test file reads the real `../../firestore.rules` itself via
  `fs.readFileSync` and loads it into the running emulator through
  `initializeTestEnvironment()`'s `firestore.rules` option, which
  replaces whatever was loaded at startup before any test runs.
- Each test file seeds any fixture data (e.g. `matchups/{gameId}` mirror
  docs) via `withSecurityRulesDisabled()`, the same way `update_picks.py`'s
  Admin SDK writes them in production -- tests never rely on the rules
  under test to also seed themselves.
- `afterEach` calls `clearFirestore()` so every test starts from a clean
  slate.
