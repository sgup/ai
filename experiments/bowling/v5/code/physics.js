/*
 * physics.js — lightweight, deterministic bowling physics.
 *
 * Pure math, no DOM / no THREE. Classic <script> sets window.BowlPhysics;
 * also a Node module so it can be unit-tested.
 *
 * Coordinate convention (matches the renderer):
 *   x : lateral across the lane  (left negative, right positive)
 *   z : down the lane toward the pins. Foul line at z=0, pins near z = LANE_LENGTH.
 *   y : up (ignored for top-down sim; ball rolls on the lane plane).
 *
 * Units are meters-ish. A regulation lane is ~18.3 m (60 ft) foul-line to
 * head pin, ~1.05 m wide. We model the ball as a point with a radius for
 * collision and the pins as upright cylinders that topple when hit hard enough
 * and can knock neighbours (chain reaction) — enough to give realistic-feeling
 * pin action and correct pin-count for scoring.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.BowlPhysics = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LANE_WIDTH = 1.05;       // playable width
  var LANE_LENGTH = 18.3;      // foul line to head pin spot
  var BALL_RADIUS = 0.108;     // ~ regulation 8.5" diameter
  var PIN_RADIUS = 0.06;
  var GUTTER_HALF = LANE_WIDTH / 2; // beyond this lateral, ball is in gutter
  // Lateral hook acceleration scale (m/s^2 at |spin|=1, full ramp). Tuned in
  // physics.test.mjs so |spin|=1 deflects ~0.2-0.3 m, a controllable curve.
  var HOOK_STRENGTH = 1.7;

  // Standard 10-pin triangle. Pin 1 (head) nearest the bowler, rows recede.
  // Spacing 12 inches = 0.3048 m between centers.
  var PIN_SPACING = 0.3048;
  var ROW_DEPTH = PIN_SPACING * Math.sin(Math.PI / 3); // equilateral row depth
  function standardPinLayout() {
    // rows: 1, 2, 3, 4 pins. Head pin at z = LANE_LENGTH.
    var pins = [];
    var headZ = LANE_LENGTH;
    var idx = 0;
    for (var row = 0; row < 4; row++) {
      var count = row + 1;
      var z = headZ + row * ROW_DEPTH;
      var rowWidth = (count - 1) * PIN_SPACING;
      for (var i = 0; i < count; i++) {
        var x = -rowWidth / 2 + i * PIN_SPACING;
        pins.push({ id: idx++, x: x, z: z, down: false, vx: 0, vz: 0 });
      }
    }
    return pins; // 10 pins
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /**
   * Create a ball state.
   *  x0     : starting lateral position at the foul line
   *  angle  : initial aim angle in radians (0 = straight down lane; +x to the right)
   *  power  : forward speed (m/s), ~6..9 realistic
   *  spin   : lateral curve factor (- hooks left, + hooks right), ~ -1..1
   */
  function createBall(x0, angle, power, spin) {
    return {
      x: clamp(x0, -GUTTER_HALF * 1.4, GUTTER_HALF * 1.4),
      z: 0,
      vx: Math.sin(angle) * power,
      vz: Math.cos(angle) * power,
      spin: spin || 0,
      radius: BALL_RADIUS,
      inGutter: false,
      stopped: false,
      // accumulated lateral curve "force" ramps in as the ball travels
      _t: 0,
    };
  }

  /**
   * Advance the whole world by dt seconds. Mutates ball + pins.
   * Returns nothing; read pin.down for results.
   */
  function step(ball, pins, dt) {
    if (ball.stopped) {
      stepPins(pins, dt);
      return;
    }
    ball._t += dt;

    // Hook: spin curves the ball more as friction "bites" later down the lane.
    // Curve acceleration grows with distance traveled (real balls hook late).
    // Tuned so a full-strength spin (|spin|=1) deflects the ball ~0.25 m over
    // the lane — a pocket-sized move, NOT a sweep off the boards. (See
    // physics.test.mjs "hook curves" + the deflection bound below.)
    if (!ball.inGutter) {
      var hookRamp = clamp(ball.z / LANE_LENGTH, 0, 1);
      // quadratic ramp => hook arrives late, like a real ball "reading" the lane
      var hookAccel = ball.spin * HOOK_STRENGTH * hookRamp * hookRamp;
      ball.vx += hookAccel * dt;
    }

    // Mild rolling friction slows forward motion slightly.
    var friction = 0.6; // m/s^2
    var speed = Math.hypot(ball.vx, ball.vz);
    if (speed > 0.0001) {
      var decel = friction * dt;
      var scale = Math.max(0, (speed - decel) / speed);
      ball.vx *= scale;
      ball.vz *= scale;
    }

    ball.x += ball.vx * dt;
    ball.z += ball.vz * dt;

    // Gutter: once the ball center passes the gutter edge it drops in and
    // can no longer hit pins; it just runs straight to the pit.
    if (!ball.inGutter && Math.abs(ball.x) > GUTTER_HALF) {
      ball.inGutter = true;
      ball.vx = 0; // gutter rails straighten it
      ball.spin = 0;
    }

    // Ball reached / passed the pin deck or rolled off the end.
    if (ball.z > LANE_LENGTH + 3 * ROW_DEPTH + 0.6 || speed < 0.2) {
      ball.stopped = true;
    }

    // Ball vs pins.
    if (!ball.inGutter) {
      for (var i = 0; i < pins.length; i++) {
        var p = pins[i];
        if (p.down) continue;
        var dx = p.x - ball.x;
        var dz = p.z - ball.z;
        var dist = Math.hypot(dx, dz);
        if (dist < ball.radius + PIN_RADIUS) {
          knockPin(p, ball.vx, ball.vz, dx, dz);
        }
      }
    }

    stepPins(pins, dt);
  }

  function knockPin(p, bvx, bvz, dx, dz) {
    p.down = true;
    // impart velocity roughly along the impact normal + ball travel direction
    var nlen = Math.hypot(dx, dz) || 1;
    var nx = dx / nlen,
      nz = dz / nlen;
    var impact = Math.hypot(bvx, bvz);
    var transfer = clamp(impact * 0.7, 1.2, 6.0);
    p.vx = nx * transfer + bvx * 0.3;
    p.vz = nz * transfer + bvz * 0.45;
  }

  /**
   * Pins, once falling, slide and can knock standing neighbours (chain).
   */
  function stepPins(pins, dt) {
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i];
      if (!p.down) continue;
      if (Math.abs(p.vx) < 0.001 && Math.abs(p.vz) < 0.001) continue;
      // friction on sliding pin
      var sp = Math.hypot(p.vx, p.vz);
      var dec = 3.0 * dt;
      var sc = Math.max(0, (sp - dec) / sp);
      p.vx *= sc;
      p.vz *= sc;
      var px = p.x + p.vx * dt;
      var pz = p.z + p.vz * dt;
      // chain: a moving downed pin can topple a standing one it slides into
      for (var j = 0; j < pins.length; j++) {
        var q = pins[j];
        if (q.down) continue;
        var ddx = q.x - px;
        var ddz = q.z - pz;
        if (Math.hypot(ddx, ddz) < PIN_RADIUS * 2.6) {
          knockPin(q, p.vx, p.vz, ddx, ddz);
        }
      }
      p.x = px;
      p.z = pz;
    }
  }

  function countDown(pins) {
    var n = 0;
    for (var i = 0; i < pins.length; i++) if (pins[i].down) n++;
    return n;
  }

  /** Run a whole roll to rest (used by tests). Returns pins knocked. */
  function simulateRoll(x0, angle, power, spin, opts) {
    opts = opts || {};
    var pins = opts.pins || standardPinLayout();
    var ball = createBall(x0, angle, power, spin);
    var dt = opts.dt || 1 / 120;
    var maxT = opts.maxT || 8;
    var t = 0;
    while (!ball.stopped && t < maxT) {
      step(ball, pins, dt);
      t += dt;
    }
    // let pins settle a moment after ball stops
    for (var k = 0; k < 240; k++) stepPins(pins, dt);
    return { knocked: countDown(pins), pins: pins, ball: ball };
  }

  /**
   * Predict the ball's path (array of {x,z}) for given launch params, WITHOUT
   * pins (so the aim guide shows the curve the ball will actually take). Used
   * by the renderer to draw a predictive aim line — same hook math as step(),
   * so the guide can't drift from the sim.
   */
  function predictPath(x0, angle, power, spin, opts) {
    opts = opts || {};
    var dt = opts.dt || 1 / 90;
    var maxT = opts.maxT || 6;
    var ball = createBall(x0, angle, power, spin);
    var noPins = [];
    var pts = [{ x: ball.x, z: ball.z }];
    var t = 0;
    while (!ball.stopped && t < maxT && ball.z <= LANE_LENGTH + 0.05) {
      step(ball, noPins, dt);
      pts.push({ x: ball.x, z: ball.z });
      t += dt;
    }
    return pts;
  }

  return {
    LANE_WIDTH: LANE_WIDTH,
    LANE_LENGTH: LANE_LENGTH,
    BALL_RADIUS: BALL_RADIUS,
    PIN_RADIUS: PIN_RADIUS,
    PIN_SPACING: PIN_SPACING,
    ROW_DEPTH: ROW_DEPTH,
    GUTTER_HALF: GUTTER_HALF,
    standardPinLayout: standardPinLayout,
    createBall: createBall,
    step: step,
    stepPins: stepPins,
    predictPath: predictPath,
    countDown: countDown,
    simulateRoll: simulateRoll,
    clamp: clamp,
  };
});
