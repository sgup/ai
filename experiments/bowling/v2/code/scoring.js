/*
 * Ten-pin bowling scoring engine.
 *
 * Self-contained, dependency-free, and usable both in the browser (attached to
 * window.Bowling) and under Node (module.exports) so it can be unit-tested
 * headlessly. The 3D game imports the same logic via the global.
 *
 * Frame model:
 *   frames: Array<Frame>, length 10
 *   Frame = { rolls: number[], score: number|null, cumulative: number|null }
 *   - frames 1-9 hold up to 2 rolls (1 if a strike)
 *   - frame 10 holds up to 3 rolls (bonus balls on strike/spare)
 */

(function (root) {
  "use strict";

  var TOTAL_FRAMES = 10;
  var PINS = 10;

  function createGame() {
    var frames = [];
    for (var i = 0; i < TOTAL_FRAMES; i++) {
      frames.push({ rolls: [], score: null, cumulative: null });
    }
    return { frames: frames, currentFrame: 0, currentRoll: 0, over: false };
  }

  // How many pins are still standing for the ball about to be thrown.
  // Returns 10 when a fresh rack is due (start of frame, or after a strike/spare
  // resets the rack in the 10th frame).
  function pinsAvailable(game) {
    if (game.over) return 0;
    var idx = game.currentFrame;
    if (idx >= TOTAL_FRAMES) return 0;
    var frame = game.frames[idx];

    if (idx < 9) {
      // Frames 1-9: only ever a fresh rack (10) or the remainder after ball 1.
      if (frame.rolls.length === 0) return PINS;
      return PINS - frame.rolls[0];
    }

    // Frame 10.
    var r = frame.rolls;
    if (r.length === 0) return PINS;
    if (r.length === 1) {
      if (r[0] === PINS) return PINS; // strike -> fresh rack for ball 2
      return PINS - r[0];
    }
    if (r.length === 2) {
      // Ball 3 only exists on strike or spare; rack may be fresh.
      var first = r[0];
      var second = r[1];
      if (first === PINS) {
        // ball1 strike. ball2 may be strike (fresh) or partial.
        if (second === PINS) return PINS;
        return PINS - second;
      }
      if (first + second === PINS) return PINS; // spare -> fresh rack
      return 0;
    }
    return 0;
  }

  function isStrike(frame) {
    return frame.rolls.length >= 1 && frame.rolls[0] === PINS;
  }

  function isSpare(frame) {
    return (
      frame.rolls.length >= 2 &&
      frame.rolls[0] !== PINS &&
      frame.rolls[0] + frame.rolls[1] === PINS
    );
  }

  // Record a roll that knocked down `pins` pins. Mutates and returns the game.
  function roll(game, pins) {
    if (game.over) return game;
    pins = Math.max(0, Math.min(PINS, Math.round(pins)));
    var available = pinsAvailable(game);
    if (pins > available) pins = available;

    var idx = game.currentFrame;
    var frame = game.frames[idx];
    frame.rolls.push(pins);

    // Advance bookkeeping.
    if (idx < 9) {
      if (isStrike(frame) || frame.rolls.length === 2) {
        game.currentFrame++;
        game.currentRoll = 0;
      } else {
        game.currentRoll++;
      }
    } else {
      // Frame 10 ending logic.
      var r = frame.rolls;
      var done = false;
      if (r.length === 3) {
        done = true;
      } else if (r.length === 2) {
        var bonus = r[0] === PINS || r[0] + r[1] === PINS;
        if (!bonus) done = true;
      }
      if (done) {
        game.over = true;
      } else {
        game.currentRoll++;
      }
    }

    recompute(game);
    return game;
  }

  // Flattened roll list, used to look ahead for strike/spare bonuses.
  function flatRolls(frames) {
    var out = [];
    for (var i = 0; i < frames.length; i++) {
      for (var j = 0; j < frames[i].rolls.length; j++) {
        out.push({ frame: i, value: frames[i].rolls[j] });
      }
    }
    return out;
  }

  // Recompute per-frame scores and running cumulative totals. Leaves a frame's
  // score null until enough future rolls exist to settle its bonus.
  function recompute(game) {
    var frames = game.frames;
    var flat = flatRolls(frames);

    // Map: index of the first flat roll belonging to each frame.
    var firstFlatIndex = [];
    var k = 0;
    for (var f = 0; f < frames.length; f++) {
      firstFlatIndex.push(k);
      k += frames[f].rolls.length;
    }

    var running = 0;
    var stillOpen = false;
    for (var fi = 0; fi < frames.length; fi++) {
      var frame = frames[fi];
      var score = null;

      if (fi < 9) {
        if (isStrike(frame)) {
          var s = firstFlatIndex[fi];
          if (flat.length > s + 2) {
            score = PINS + flat[s + 1].value + flat[s + 2].value;
          }
        } else if (isSpare(frame)) {
          var sp = firstFlatIndex[fi];
          if (flat.length > sp + 2) {
            score = PINS + flat[sp + 2].value;
          }
        } else if (frame.rolls.length === 2) {
          score = frame.rolls[0] + frame.rolls[1];
        }
      } else {
        // Frame 10: score is just the sum of its (up to 3) rolls once complete.
        var needed = 2;
        if (frame.rolls.length >= 2) {
          var bonus = frame.rolls[0] === PINS || frame.rolls[0] + frame.rolls[1] === PINS;
          if (bonus) needed = 3;
        }
        if (frame.rolls.length >= needed) {
          score = frame.rolls.reduce(function (a, b) { return a + b; }, 0);
        }
      }

      frame.score = score;
      if (score === null) {
        stillOpen = true;
        frame.cumulative = null;
      } else if (!stillOpen) {
        running += score;
        frame.cumulative = running;
      } else {
        frame.cumulative = null;
      }
    }
    return game;
  }

  // Best total achievable so far (for live display): sum of settled frames.
  function settledTotal(game) {
    var total = 0;
    for (var i = 0; i < game.frames.length; i++) {
      var c = game.frames[i].cumulative;
      if (c !== null) total = c;
    }
    return total;
  }

  function labelForRoll(game, frameIdx, rollIdx, value) {
    // Returns the display glyph for a roll cell: X, /, -, or the number.
    var frame = game.frames[frameIdx];
    if (frameIdx < 9) {
      if (rollIdx === 0) {
        if (value === PINS) return "X";
        return value === 0 ? "-" : String(value);
      }
      if (frame.rolls[0] + value === PINS) return "/";
      return value === 0 ? "-" : String(value);
    }
    // Frame 10.
    var r = frame.rolls;
    if (rollIdx === 0) {
      return value === PINS ? "X" : value === 0 ? "-" : String(value);
    }
    if (rollIdx === 1) {
      if (r[0] === PINS) return value === PINS ? "X" : value === 0 ? "-" : String(value);
      if (r[0] + value === PINS) return "/";
      return value === 0 ? "-" : String(value);
    }
    // rollIdx === 2
    if (r[1] === PINS || r[0] + r[1] === PINS) {
      return value === PINS ? "X" : value === 0 ? "-" : String(value);
    }
    return value === PINS ? "X" : value === 0 ? "-" : String(value);
  }

  var api = {
    TOTAL_FRAMES: TOTAL_FRAMES,
    PINS: PINS,
    createGame: createGame,
    roll: roll,
    pinsAvailable: pinsAvailable,
    isStrike: isStrike,
    isSpare: isSpare,
    recompute: recompute,
    settledTotal: settledTotal,
    labelForRoll: labelForRoll,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.Bowling = api;
})(typeof window !== "undefined" ? window : globalThis);
