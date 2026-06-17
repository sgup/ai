/*
 * scoring.test.mjs — run with:  node scoring.test.mjs
 * Verifies ten-pin scoring against canonical, independently-known totals.
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const Scoring = require(join(__dirname, "scoring.js"));

let pass = 0,
  fail = 0;
const failures = [];

function eq(name, got, want) {
  if (got === want) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// 1. Perfect game: 12 strikes => 300.
const perfect = [
  [10], [10], [10], [10], [10], [10], [10], [10], [10],
  [10, 10, 10],
];
eq("perfect game = 300", Scoring.totalScore(perfect), 300);

// 2. All open frames, 4+5 = 9 each => 90.
const ninety = Array.from({ length: 9 }, () => [4, 5]).concat([[4, 5]]);
eq("all 9s open = 90", Scoring.totalScore(ninety), 90);

// 3. Gutter game: all zeros => 0.
const gutter = Array.from({ length: 9 }, () => [0, 0]).concat([[0, 0]]);
eq("gutter game = 0", Scoring.totalScore(gutter), 0);

// 4. All spares with 5,5 and a final bonus 5 => 150.
const spares = Array.from({ length: 9 }, () => [5, 5]).concat([[5, 5, 5]]);
eq("all 5/5 spares = 150", Scoring.totalScore(spares), 150);

// 5. Canonical mixed game (Wikipedia "Scoring" example variants).
//    Strike, spare(7/3), strike, ... well-known total = 167.
//    Frames: X 7/ X 9- X X X 2/ X 6- ... use a fully specified known case:
const mixed = [
  [10],        // strike
  [7, 3],      // spare
  [9, 0],      // 9
  [10],        // strike
  [0, 8],      // 8
  [8, 2],      // spare
  [0, 6],      // 6
  [10],        // strike
  [10],        // strike
  [10, 8, 1],  // strike + 8 + 1
];
// Hand-computed:
// f1 X = 10 + 7 + 3 = 20            -> 20
// f2 7/ = 10 + 9 = 19              -> 39
// f3 9  = 9                        -> 48
// f4 X = 10 + 0 + 8 = 18           -> 66
// f5 8  = 8                        -> 74
// f6 8/ = 10 + 0 = 10              -> 84
// f7 6  = 6                        -> 90
// f8 X = 10 + 10 + 10 = 30         -> 120
// f9 X = 10 + 10 + 8 = 28          -> 148
// f10 X 8 1 = 19                   -> 167
eq("canonical mixed = 167", Scoring.totalScore(mixed), 167);

// 6. Strike then nine-spare interplay: [X][5,5][3,4] open rest.
const small = [
  [10], [5, 5], [3, 4],
  [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0],
];
// f1 X = 10 + 5 + 5 = 20 -> 20
// f2 5/ = 10 + 3 = 13   -> 33
// f3 3+4 = 7            -> 40
eq("strike+spare+open = 40", Scoring.totalScore(small), 40);

// 7. In-progress: open strike with no bonus balls yet -> frame score null.
const inProgress = [[10]];
eq("lone strike frameScore is null (unresolved)", Scoring.frameScores(inProgress)[0], null);
eq("lone strike running total = 0 (unresolved)", Scoring.totalScore(inProgress), 0);

// 8. Spare awaiting bonus -> null until next roll.
const spareWait = [[5, 5]];
eq("lone spare unresolved -> null", Scoring.frameScores(spareWait)[0], null);

// 9. Open frame resolves immediately.
const openOne = [[3, 4]];
eq("open frame resolves = 7", Scoring.frameScores(openOne)[0], 7);
eq("open frame total = 7", Scoring.totalScore(openOne), 7);

// 10. isStrike / isSpare predicates.
eq("isStrike([10])", Scoring.isStrike([10]), true);
eq("isStrike([6,4]) false", Scoring.isStrike([6, 4]), false);
eq("isSpare([6,4])", Scoring.isSpare([6, 4]), true);
eq("isSpare([10]) false (it's a strike)", Scoring.isSpare([10]), false);
eq("isSpare([4,5]) false", Scoring.isSpare([4, 5]), false);

// 11. 10th-frame strike needs all three rolls before it resolves.
const tenthOpenStrike = [
  [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0],
  [10, 10], // only two of three -> unresolved
];
eq("10th strike with 2/3 rolls -> null", Scoring.frameScores(tenthOpenStrike)[9], null);

console.log(`\nscoring.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log(failures.map((f) => "  FAIL " + f).join("\n"));
  process.exit(1);
}
