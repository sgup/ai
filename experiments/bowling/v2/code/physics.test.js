/* Headless physics sanity tests. Run: node physics.test.js */
const P = require("./physics.js");

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name) { if (cond) pass++; else { fail++; failures.push(name); } }

function simulate(launchOpts, maxSteps = 2000) {
  const w = P.createWorld();
  P.launch(w, launchOpts);
  const dt = 1 / 120;
  for (let i = 0; i < maxSteps; i++) {
    P.step(w, dt);
    if (P.isResting(w)) break;
  }
  return w;
}

// 1. A fast strike down the centre should down several pins (ideally all).
{
  const w = simulate({ startX: 0, dirX: 0, speed: 14, spin: 0 });
  const down = P.countDowned(w);
  ok(down >= 6, `centre strike downs many pins (got ${down})`);
}

// 2. A hard gutter ball (aimed off the lane) downs zero pins.
{
  const w = simulate({ startX: 0.9, dirX: 0.25, speed: 14, spin: 0 });
  const down = P.countDowned(w);
  ok(down === 0, `gutter ball downs no pins (got ${down})`);
  ok(w.ball.inGutter === true, "gutter ball flagged inGutter");
}

// 3. Standing + downed always sums to 10 on a fresh rack.
{
  const w = simulate({ startX: 0.1, dirX: 0, speed: 12, spin: 0.4 });
  const total = P.countStanding(w) + P.countDowned(w);
  ok(total === 10, `standing+downed = 10 (got ${total})`);
}

// 4. Hook ball curves: positive spin moves ball -x over its travel.
{
  const w = P.createWorld();
  P.launch(w, { startX: 0.3, dirX: 0, speed: 12, spin: 1.2 });
  const startX = w.ball.pos.x;
  const dt = 1 / 120;
  for (let i = 0; i < 120; i++) P.step(w, dt);
  ok(w.ball.pos.x !== startX, "hook ball lateral position changes");
}

// 5. World resets cleanly.
{
  const w = simulate({ startX: 0, dirX: 0, speed: 14, spin: 0 });
  P.resetPins(w);
  ok(P.countStanding(w) === 10, "resetPins restores full rack");
}

console.log(`\nPhysics tests: ${pass} passed, ${fail} failed.`);
if (fail) { console.log("Failures:\n  " + failures.join("\n  ")); process.exit(1); }
process.exit(0);
