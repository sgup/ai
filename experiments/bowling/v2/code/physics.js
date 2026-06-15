/*
 * Lightweight rigid-body physics tuned for a bowling lane.
 *
 * Dependency-free and deterministic enough for a game (not a simulator).
 * Bodies: one ball (sphere) + ten pins (capsule-ish cylinders approximated as
 * upright rigid bodies that can topple). Uses a fixed timestep with simple
 * impulse-based collision response, friction, and a gravity-driven topple model
 * for pins. Exposed on window.BowlPhysics and module.exports for testing.
 *
 * Coordinate system (matches the renderer):
 *   x = across the lane (gutters at +-LANE_HALF_WIDTH)
 *   y = up
 *   z = down the lane (positive toward the pins / pin deck)
 */
(function (root) {
  "use strict";

  function vec(x, y, z) { return { x: x || 0, y: y || 0, z: z || 0 }; }
  function add(a, b) { return vec(a.x + b.x, a.y + b.y, a.z + b.z); }
  function sub(a, b) { return vec(a.x - b.x, a.y - b.y, a.z - b.z); }
  function scale(a, s) { return vec(a.x * s, a.y * s, a.z * s); }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a); return l > 1e-9 ? scale(a, 1 / l) : vec(0, 0, 0); }

  // Lane geometry constants (metres-ish, scaled for play feel).
  var LANE_HALF_WIDTH = 1.05; // playable lane half width (gutters beyond)
  var GUTTER_EDGE = 1.05;
  var BALL_RADIUS = 0.22;
  var PIN_RADIUS = 0.12;
  var PIN_HEIGHT = 0.95;
  var PIN_SPACING = 0.55; // centre-to-centre between adjacent pins
  var FOUL_LINE_Z = 0;
  var PIN_DECK_Z = 18.0; // distance from foul line to head pin
  var GRAVITY = -18.0;

  // Standard 10-pin triangle, head pin nearest the bowler, apex toward bowler.
  // Returns array of {x, z} centres.
  function pinLayout() {
    var rowGap = PIN_SPACING * 0.886; // row depth = spacing * cos(30)
    var positions = [];
    // Row 0: 1 pin (head). Row 1: 2. Row 2: 3. Row 3: 4.
    for (var rowI = 0; rowI < 4; rowI++) {
      var count = rowI + 1;
      var z = PIN_DECK_Z + rowI * rowGap;
      var startX = -(count - 1) * 0.5 * PIN_SPACING;
      for (var i = 0; i < count; i++) {
        positions.push({ x: startX + i * PIN_SPACING, z: z });
      }
    }
    return positions; // length 10, indexed head-first
  }

  function makeBall() {
    return {
      type: "ball",
      pos: vec(0, BALL_RADIUS, FOUL_LINE_Z - 1.2),
      vel: vec(0, 0, 0),
      radius: BALL_RADIUS,
      mass: 6.0,
      spin: 0, // sideways curve force (hook), set at release
      active: false,
      inGutter: false,
    };
  }

  function makePins() {
    var layout = pinLayout();
    return layout.map(function (p, i) {
      return {
        type: "pin",
        index: i,
        home: vec(p.x, 0, p.z),
        pos: vec(p.x, PIN_HEIGHT * 0.5, p.z),
        vel: vec(0, 0, 0),
        radius: PIN_RADIUS,
        height: PIN_HEIGHT,
        mass: 1.5,
        // Toppling state: tilt is angle (rad) from upright, tiltAxis is unit
        // horizontal direction the pin falls toward.
        tilt: 0,
        tiltAxis: vec(1, 0, 0),
        angVel: 0,
        standing: true,
        settled: true,
        downCounted: false,
      };
    });
  }

  function createWorld() {
    return {
      ball: makeball_safe(),
      pins: makePins(),
      time: 0,
      constants: {
        LANE_HALF_WIDTH: LANE_HALF_WIDTH,
        BALL_RADIUS: BALL_RADIUS,
        PIN_RADIUS: PIN_RADIUS,
        PIN_HEIGHT: PIN_HEIGHT,
        PIN_DECK_Z: PIN_DECK_Z,
        FOUL_LINE_Z: FOUL_LINE_Z,
        GUTTER_EDGE: GUTTER_EDGE,
      },
    };
  }
  function makeball_safe() { return makeBall(); }

  // Reset the ball for a new throw; keep standing pins where they are.
  function resetBall(world) {
    world.ball = makeBall();
  }

  // Reset all pins to a fresh rack.
  function resetPins(world) {
    world.pins = makePins();
  }

  // Remove pins that have been knocked down (between balls in a frame).
  function clearDownedPins(world) {
    world.pins.forEach(function (p) {
      if (!p.standing) p.removed = true;
    });
  }

  // Launch the ball. dir is a normalized-ish {x,z}; power scales speed; spin is
  // hook strength (positive curves right-to-left for a right-hander).
  function launch(world, opts) {
    var b = world.ball;
    b.pos = vec(opts.startX || 0, BALL_RADIUS, FOUL_LINE_Z - 0.6);
    var speed = opts.speed;
    var dir = norm(vec(opts.dirX || 0, 0, 1));
    b.vel = vec(dir.x * speed, 0, dir.z * speed);
    b.spin = opts.spin || 0;
    b.active = true;
    b.inGutter = false;
  }

  // Whether everything has come to rest (used to know the throw is finished).
  function isResting(world) {
    var b = world.ball;
    var ballRest =
      !b.active ||
      (b.pos.z > PIN_DECK_Z + 3.0) ||
      (len(b.vel) < 0.15 && b.pos.y <= BALL_RADIUS + 0.01) ||
      b.pos.z > 26;
    var pinsRest = world.pins.every(function (p) {
      return p.removed || (Math.abs(p.angVel) < 0.05 && len(p.vel) < 0.05);
    });
    return ballRest && pinsRest;
  }

  function countStanding(world) {
    var c = 0;
    world.pins.forEach(function (p) {
      if (!p.removed && p.standing && p.tilt < 0.5) c++;
    });
    return c;
  }

  function countDowned(world) {
    var c = 0;
    world.pins.forEach(function (p) {
      if (!p.removed && (!p.standing || p.tilt >= 0.5)) c++;
    });
    return c;
  }

  // Knock a pin: apply horizontal impulse, start it toppling.
  function hitPin(pin, impulse) {
    pin.vel = add(pin.vel, scale(impulse, 1 / pin.mass));
    var horiz = vec(impulse.x, 0, impulse.z);
    var mag = len(horiz);
    if (mag > 0.01) {
      pin.tiltAxis = norm(horiz);
      pin.angVel += mag * 1.4;
      pin.standing = false;
    }
  }

  // One fixed physics step.
  function step(world, dt) {
    var b = world.ball;
    var C = world.constants;

    if (b.active) {
      // Hook: lateral acceleration grows as the ball travels (oil model rough).
      if (!b.inGutter) {
        var travel = Math.max(0, b.pos.z - FOUL_LINE_Z);
        var hookAccel = b.spin * (0.6 + travel * 0.05);
        b.vel.x += hookAccel * dt;
      }

      // Gutter capture.
      if (!b.inGutter && Math.abs(b.pos.x) > LANE_HALF_WIDTH - BALL_RADIUS) {
        b.inGutter = true;
        b.spin = 0;
        // Snap into gutter channel and straighten.
        var side = b.pos.x > 0 ? 1 : -1;
        b.pos.x = side * (GUTTER_EDGE + 0.04);
        b.vel.x = 0;
        b.vel.z = Math.max(b.vel.z, 3.5);
      }

      // Rolling friction.
      var fr = b.inGutter ? 0.15 : 0.45;
      var sp = len(b.vel);
      if (sp > 0) {
        var decel = fr * dt;
        var ns = Math.max(0, sp - decel);
        b.vel = scale(norm(b.vel), ns);
      }

      b.pos = add(b.pos, scale(b.vel, dt));
      b.pos.y = BALL_RADIUS;

      // Ball vs pins (only if not in gutter).
      if (!b.inGutter) {
        world.pins.forEach(function (p) {
          if (p.removed) return;
          var dx = b.pos.x - p.pos.x;
          var dz = b.pos.z - p.pos.z;
          var distSq = dx * dx + dz * dz;
          var minDist = BALL_RADIUS + PIN_RADIUS;
          if (distSq < minDist * minDist) {
            var dist = Math.sqrt(distSq) || 0.0001;
            var nx = dx / dist;
            var nz = dz / dist;
            // Relative velocity along normal.
            var rvx = b.vel.x - p.vel.x;
            var rvz = b.vel.z - p.vel.z;
            var velAlong = rvx * -nx + rvz * -nz;
            if (velAlong > 0) {
              // Transfer a realistic slice of speed into the pin (a few m/s),
              // not the full heavy-ball momentum, so pins scatter rather than
              // rocket off the deck.
              var transfer = Math.min(velAlong * 0.4, 6.0);
              hitPin(p, vec(-nx * transfer * p.mass, 0, -nz * transfer * p.mass));
              // Ball loses a little energy & deflects toward the impact.
              b.vel.x -= nx * velAlong * 0.12;
              b.vel.z -= nz * velAlong * 0.12;
            }
            // Positional separation so they don't overlap.
            var overlap = minDist - dist;
            b.pos.x += nx * overlap * 0.5;
            b.pos.z += nz * overlap * 0.5;
          }
        });
      }

      if (len(b.vel) < 0.12 || b.pos.z > 27) b.active = false;
    }

    // Pin-vs-pin and pin dynamics.
    world.pins.forEach(function (p) {
      if (p.removed) return;

      // Toppling integration. A pin keeps falling until it is flat (tilt =
      // pi/2), then locks: angVel zeroed so the world can come to rest.
      if (p.tilt >= Math.PI / 2) {
        p.tilt = Math.PI / 2;
        p.angVel = 0;
        p.standing = false;
        p.fallen = true;
      } else if (!p.standing || p.tilt > 0) {
        p.angVel += 3.0 * dt; // gravity-driven fall acceleration
        p.tilt += p.angVel * dt;
        if (p.tilt >= Math.PI / 2) {
          p.tilt = Math.PI / 2;
          p.angVel = 0;
          p.fallen = true;
        }
        p.standing = p.tilt < 0.35;
      }

      // Clamp pin speed so a violent hit can't send a pin to infinity.
      var maxPinSpeed = 7.0;
      if (len(p.vel) > maxPinSpeed) p.vel = scale(norm(p.vel), maxPinSpeed);

      // Horizontal slide of a struck/falling pin.
      if (len(p.vel) > 0.001) {
        p.pos = add(p.pos, scale(p.vel, dt));
        var pfr = 3.0 * dt;
        var psp = len(p.vel);
        var nps = Math.max(0, psp - pfr);
        p.vel = scale(norm(p.vel), nps);
        if (len(p.vel) < 0.04) p.vel = vec(0, 0, 0); // snap to rest
      }

      // Contain pins to the deck / pit so they don't drift off into space.
      var maxX = LANE_HALF_WIDTH + 0.7;
      if (p.pos.x > maxX) { p.pos.x = maxX; p.vel.x = 0; }
      if (p.pos.x < -maxX) { p.pos.x = -maxX; p.vel.x = 0; }
      var backZ = PIN_DECK_Z + 3.2;
      if (p.pos.z > backZ) { p.pos.z = backZ; p.vel.z *= -0.2; }
      var frontZ = PIN_DECK_Z - 1.5;
      if (p.pos.z < frontZ) { p.pos.z = frontZ; p.vel.z = Math.abs(p.vel.z) * 0.2; }

      // Keep pin base on the deck (cosmetic height as it tilts).
      p.pos.y = PIN_HEIGHT * 0.5 * Math.cos(p.tilt);
    });

    // Pin vs pin collisions (chain reactions).
    for (var i = 0; i < world.pins.length; i++) {
      var a = world.pins[i];
      if (a.removed) continue;
      for (var j = i + 1; j < world.pins.length; j++) {
        var c = world.pins[j];
        if (c.removed) continue;
        var ddx = a.pos.x - c.pos.x;
        var ddz = a.pos.z - c.pos.z;
        var d2 = ddx * ddx + ddz * ddz;
        var md = PIN_RADIUS * 2.0;
        if (d2 < md * md) {
          var d = Math.sqrt(d2) || 0.0001;
          var nnx = ddx / d;
          var nnz = ddz / d;

          // Always separate positionally so pins never permanently overlap.
          var ov = md - d;
          a.pos.x += nnx * ov * 0.5;
          a.pos.z += nnz * ov * 0.5;
          c.pos.x -= nnx * ov * 0.5;
          c.pos.z -= nnz * ov * 0.5;

          // Closing velocity along the contact normal (a relative to c).
          var rvx = a.vel.x - c.vel.x;
          var rvz = a.vel.z - c.vel.z;
          var closing = rvx * nnx + rvz * nnz; // >0 means a moving into c... sign:
          // normal points from c -> a, so a moving toward c gives closing < 0.
          if (closing < -0.15) {
            // Elastic-ish equal-mass exchange of the normal component, damped.
            var restitution = 0.6;
            var jn = -(1 + restitution) * closing * 0.5; // split between two equal masses
            a.vel.x += nnx * jn;
            a.vel.z += nnz * jn;
            c.vel.x -= nnx * jn;
            c.vel.z -= nnz * jn;
            // A standing pin that takes a real hit starts to topple. Lower the
            // threshold so chain reactions reach the back-row corner pins.
            var impactMag = Math.abs(closing);
            if (c.standing && impactMag > 0.4) {
              c.tiltAxis = norm(vec(-nnx, 0, -nnz));
              c.angVel += impactMag * 0.7;
              c.standing = false;
            }
            if (a.standing && impactMag > 0.4) {
              a.tiltAxis = norm(vec(nnx, 0, nnz));
              a.angVel += impactMag * 0.7;
              a.standing = false;
            }
          }
        }
      }
    }

    world.time += dt;
  }

  var api = {
    vec: vec,
    createWorld: createWorld,
    resetBall: resetBall,
    resetPins: resetPins,
    clearDownedPins: clearDownedPins,
    launch: launch,
    step: step,
    isResting: isResting,
    countStanding: countStanding,
    countDowned: countDowned,
    pinLayout: pinLayout,
    constants: {
      LANE_HALF_WIDTH: LANE_HALF_WIDTH,
      BALL_RADIUS: BALL_RADIUS,
      PIN_RADIUS: PIN_RADIUS,
      PIN_HEIGHT: PIN_HEIGHT,
      PIN_DECK_Z: PIN_DECK_Z,
      FOUL_LINE_Z: FOUL_LINE_Z,
      GUTTER_EDGE: GUTTER_EDGE,
      PIN_SPACING: PIN_SPACING,
    },
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.BowlPhysics = api;
})(typeof window !== "undefined" ? window : globalThis);
