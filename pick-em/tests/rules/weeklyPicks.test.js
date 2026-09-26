const { before, after, afterEach, test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc } = require("firebase/firestore");

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-pickem",
    firestore: {
      rules: fs.readFileSync(
        path.join(__dirname, "..", "..", "firestore.rules"),
        "utf8"
      ),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

async function seedWeeklyPicksBoard() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "weeklyPicks/2026_week1"), {
      players: {
        alice: { username: "Alice", picks: { spread_game1: "Team A|+3" } },
      },
      computedAt: new Date(),
    });
  });
}

test("unauthenticated users can read /weeklyPicks/{docId}", async () => {
  await seedWeeklyPicksBoard();
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, "weeklyPicks/2026_week1")));
});

test("no client, even authenticated, can write /weeklyPicks/{docId}", async () => {
  await seedWeeklyPicksBoard();
  const db = testEnv.authenticatedContext("alice").firestore();
  await assertFails(
    setDoc(doc(db, "weeklyPicks/2026_week1"), { players: { alice: { picks: {} } } })
  );
});
