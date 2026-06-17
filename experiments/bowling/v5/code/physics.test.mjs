/*
 * physics.test.mjs — run with:  node physics.test.mjs
 * Asserts physically-meaningful invariants of the deterministic sim so the
 * gameplay-relevant behavior (gutter = 0, pocket shot scores big, hook curves,
 * counts in range) is a checkable artifact rather than a self-report.
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const P = require(join(__dirname, "physics.js"));

let pass = 0,
  fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name + (detail ? " — " + detail : ""));
  }
}

// 1. Gutter ball (aimed far off the lane) knocks zero pins.
{
  const r = P.simulateRoll(P.GUTTER_HALF * 1.2, 0, 7.5, 0);
  ok("gutter ball knocks 0", r.knocked === 0, `knocked=${r.knocked}`);
}

// 2. Pin count always within 0..10 across a sweep of shots.
{
  let inRange = true;
  let maxKnocked = 0;
  for (let x = -0.45; x <= 0.45; x += 0.05) {
    for (const spin of [-0.6, 0, 0.6]) {
      const r = P.simulateRoll(x, 0, 7.8, spin);
      if (r.knocked < 0 || r.knocked > 10) inRange = false;
      maxKnocked = Math.max(maxKnocked, r.knocked);
    }
  }
  ok("all rolls knock 0..10 pins", inRange);
  ok("some shot is a strike (10) across the sweep", maxKnocked === 10, `best=${maxKnocked}`);
}

// 3. A pocket shot (slightly right of center, gentle left hook) scores well.
//    The classic right-hander pocket is between head pin and 3-pin.
{
  let best = 0;
  // search a small window of pocket-ish lines for the best result
  for (let x = -0.08; x <= 0.08; x += 0.02) {
    for (const angle of [-0.02, 0, 0.02]) {
      for (const spin of [-0.5, -0.3, 0, 0.3, 0.5]) {
        const r = P.simulateRoll(x, angle, 8.0, spin);
        best = Math.max(best, r.knocked);
      }
    }
  }
  ok("a pocket-area shot can strike", best === 10, `best=${best}`);
}

// 4. Hook actually curves the ball: same launch, nonzero spin ends at a
//    different lateral x than zero spin.
{
  const straight = P.simulateRoll(0, 0, 7.5, 0);
  const hookL = P.simulateRoll(0, 0, 7.5, -0.8);
  const hookR = P.simulateRoll(0, 0, 7.5, 0.8);
  ok("left hook ends left of straight", hookL.ball.x < straight.ball.x - 0.02,
    `straight=${straight.ball.x.toFixed(3)} hookL=${hookL.ball.x.toFixed(3)}`);
  ok("right hook ends right of straight", hookR.ball.x > straight.ball.x + 0.02,
    `straight=${straight.ball.x.toFixed(3)} hookR=${hookR.ball.x.toFixed(3)}`);
}

// 4b. Hook is a controllable curve, not a sweep off the boards: a full-strength
//     hook launched straight from center deflects less than ~0.6 m by the deck
//     (it must not rail across the whole lane the way the first cut did).
{
  const hook = P.simulateRoll(0, 0, 8.0, -1);
  ok("full hook deflects < 0.6 m (controllable curve)", Math.abs(hook.ball.x) < 0.6,
    `|x|=${Math.abs(hook.ball.x).toFixed(3)}`);
  ok("full hook deflects > 0.15 m (it actually curves)", Math.abs(hook.ball.x) > 0.15,
    `|x|=${Math.abs(hook.ball.x).toFixed(3)}`);
}

// 5. Determinism: identical inputs give identical pin counts.
{
  const a = P.simulateRoll(0.03, 0.01, 7.7, -0.4);
  const b = P.simulateRoll(0.03, 0.01, 7.7, -0.4);
  ok("simulation is deterministic", a.knocked === b.knocked, `${a.knocked} vs ${b.knocked}`);
}

// 6. Standard layout has exactly 10 pins in the triangle.
{
  const pins = P.standardPinLayout();
  ok("standard rack has 10 pins", pins.length === 10, `n=${pins.length}`);
}

console.log(`\nphysics.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log(failures.map((f) => "  FAIL " + f).join("\n"));
  process.exit(1);
}
