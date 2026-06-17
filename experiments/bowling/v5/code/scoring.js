/*
 * scoring.js — Ten-pin bowling scoring.
 *
 * Pure logic, no DOM / no THREE. Works as a classic <script> (sets window.Scoring)
 * AND as a Node module (module.exports) so the same code is exercised by tests.
 *
 * A "frame" is an array of roll pin-counts:
 *   - frames 1..9:  [r1] (open in progress), [r1, r2], or [10] (strike)
 *   - frame 10:     up to three rolls, e.g. [10,10,10], [7,3,9], [4,5]
 * Pin counts are 0..10; a strike is a single 10 in frames 1..9.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.Scoring = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function isStrike(frame) {
    return frame.length >= 1 && frame[0] === 10;
  }

  function isSpare(frame) {
    return !isStrike(frame) && frame.length >= 2 && frame[0] + frame[1] === 10;
  }

  /**
   * Flatten all rolls into one array (used to look up bonus balls for
   * strikes/spares regardless of which frame they land in).
   */
  function flattenRolls(frames) {
    var rolls = [];
    for (var i = 0; i < frames.length; i++) {
      for (var j = 0; j < frames[i].length; j++) rolls.push(frames[i][j]);
    }
    return rolls;
  }

  /**
   * Returns an array of per-frame cumulative scores. A frame's entry is null
   * until enough rolls exist to resolve its bonus (so the scoreboard can show
   * a blank for a strike whose two bonus balls haven't been thrown yet).
   */
  function frameScores(frames) {
    var result = [];
    var running = 0;
    // Index into the *flattened roll stream* of the first roll of each frame.
    var rollStart = [];
    var cursor = 0;
    for (var f = 0; f < frames.length; f++) {
      rollStart.push(cursor);
      cursor += frames[f].length;
    }
    var rolls = flattenRolls(frames);

    for (var i = 0; i < frames.length; i++) {
      var frame = frames[i];
      var start = rollStart[i];

      if (i < 9) {
        if (isStrike(frame)) {
          // need next two rolls
          var b1 = rolls[start + 1];
          var b2 = rolls[start + 2];
          if (b1 === undefined || b2 === undefined) {
            result.push(null);
            // running stays; later frames also can't resolve, push nulls below
            // but continue so we can still attempt them (they'll be null too).
            // We DON'T early-return because frame 10 etc. is moot when blocked.
            // Mark and break: nothing after an unresolved frame can resolve.
            for (var k = i + 1; k < frames.length; k++) result.push(null);
            return result;
          }
          running += 10 + b1 + b2;
          result.push(running);
        } else if (isSpare(frame)) {
          var s1 = rolls[start + 2];
          if (s1 === undefined) {
            result.push(null);
            for (var k2 = i + 1; k2 < frames.length; k2++) result.push(null);
            return result;
          }
          running += 10 + s1;
          result.push(running);
        } else {
          // open frame: must have two rolls to be complete
          if (frame.length < 2) {
            result.push(null);
            for (var k3 = i + 1; k3 < frames.length; k3++) result.push(null);
            return result;
          }
          running += frame[0] + frame[1];
          result.push(running);
        }
      } else {
        // 10th frame: sum its own rolls; bonus rolls are part of this frame.
        // It's complete when: strike|spare -> 3 rolls; open -> 2 rolls.
        var needed;
        if (isStrike(frame) || (frame[0] + (frame[1] || 0) === 10)) needed = 3;
        else needed = 2;
        if (frame.length < needed) {
          result.push(null);
          return result;
        }
        var sum = 0;
        for (var r = 0; r < frame.length; r++) sum += frame[r];
        running += sum;
        result.push(running);
      }
    }
    return result;
  }

  /** Total score, or the last resolved cumulative score if game incomplete. */
  function totalScore(frames) {
    var scores = frameScores(frames);
    var last = 0;
    for (var i = 0; i < scores.length; i++) {
      if (scores[i] !== null && scores[i] !== undefined) last = scores[i];
    }
    return last;
  }

  return {
    isStrike: isStrike,
    isSpare: isSpare,
    frameScores: frameScores,
    totalScore: totalScore,
    flattenRolls: flattenRolls,
  };
});
