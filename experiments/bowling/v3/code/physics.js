// physics.js — Lightweight, self-contained bowling physics.
//
// Why custom physics instead of a CDN engine (cannon-es / rapier)?
//   - Zero extra network dependencies / WASM loads -> nothing else to break.
//   - A bowling lane is a constrained, mostly-2D problem (ball rolls in the
//     X/Z plane; pins topple). We don't need a general 3D solver.
//   - The simulation is deterministic given the same inputs, which keeps the
//     game predictable and debuggable.
//
// Coordinate system (world units = meters, roughly true to a real lane):
//   +Z runs from the foul line (z = 0) toward the pins (z = LANE_LENGTH).
//   X is left/right across the lane, centered at 0.
//   Y is up. Everything rolls on the y = 0 plane.
//
// A regulation lane is ~18.3 m foul-line-to-headpin and ~1.05 m wide; the ball
// is ~0.108 m radius and pins ~0.12 m wide. We scale loosely for feel.

export const LANE = {
  length: 18.3, // foul line to pin deck (m)
  width: 1.05, // playing surface width (m)
  halfWidth: 1.05 / 2,
  gutterDepth: 0.06,
  pinDeckZ: 18.0, // z of the head pin
};

export const BALL_RADIUS = 0.108;
export const PIN_RADIUS = 0.06; // collision radius (pin base)
export const PIN_HEIGHT = 0.38;
export const PIN_MASS = 1.5;
export const BALL_MASS = 6.0;

// Standard 10-pin triangle. Pin spacing center-to-center is ~0.305 m.
// Pin 1 (head) nearest the bowler; rows recede in +Z.
const PIN_SPACING = 0.305;
const ROW_DEPTH = (PIN_SPACING * Math.sqrt(3)) / 2;

export function pinLayout() {
  const z0 = LANE.pinDeckZ;
  const positions = [];
  // Row 0: 1 pin; Row 1: 2; Row 2: 3; Row 3: 4
  for (let row = 0; row < 4; row++) {
    const count = row + 1;
    const z = z0 + row * ROW_DEPTH;
    const xStart = -(count - 1) * 0.5 * PIN_SPACING;
    for (let i = 0; i < count; i++) {
      positions.push({ x: xStart + i * PIN_SPACING, z });
    }
  }
  // Reorder to standard pin numbering (1..10) for scoring/visuals.
  // Layout index order above is row-major; standard numbering:
  //   row0: 1 | row1: 2,3 | row2: 4,5,6 | row3: 7,8,9,10
  return positions.map((p, i) => ({ id: i + 1, x: p.x, z: p.z }));
}

export function createPins() {
  return pinLayout().map((p) => ({
    id: p.id,
    homeX: p.x,
    homeZ: p.z,
    x: p.x,
    z: p.z,
    y: 0,
    vx: 0,
    vz: 0,
    // tilt: how far the pin has tipped (radians). >~1.0 == fallen.
    tilt: 0,
    tiltAxisX: 0, // direction the pin falls toward
    tiltAxisZ: 0,
    angVel: 0,
    fallen: false,
    settled: false,
  }));
}

// Create a ball state. dir is a normalized {x,z}; speed in m/s; spin curves it.
export function createBall({ x, speed, dirX, dirZ, spin }) {
  return {
    x,
    y: 0,
    z: 0,
    vx: dirX * speed,
    vz: dirZ * speed,
    spin: spin || 0, // lateral acceleration coefficient (+ curves right)
    radius: BALL_RADIUS,
    rolling: true,
    inGutter: false,
    distance: 0,
  };
}

const GRAVITY = 9.81;
const ROLL_FRICTION = 0.045; // gentle deceleration while rolling
const HOOK_STRENGTH = 1.5; // how strongly spin curves the ball
const FALL_RATE = 7.0; // how fast a struck pin topples

// Step the whole simulation forward by dt seconds.
// Returns true while anything is still meaningfully moving.
export function step(state, dt) {
  const { ball, pins } = state;
  let active = false;

  // --- Ball integration ---
  if (ball.rolling) {
    active = true;

    // Spin (hook): lateral acceleration that fades as the ball slows, like
    // a real ball gripping the lane near the pins. Stronger at lower speed.
    const speed = Math.hypot(ball.vx, ball.vz);
    if (speed > 0.01) {
      const hook = ball.spin * HOOK_STRENGTH * (1 - Math.min(speed / 9, 1));
      // Perpendicular to travel direction.
      const px = ball.vz / speed;
      const pz = -ball.vx / speed;
      ball.vx += px * hook * dt;
      ball.vz += pz * hook * dt;
    }

    // Rolling friction.
    const decel = Math.exp(-ROLL_FRICTION * dt);
    ball.vx *= decel;
    ball.vz *= decel;

    ball.x += ball.vx * dt;
    ball.z += ball.vz * dt;
    ball.distance += speed * dt;

    // Gutter check: ball off the playing surface drops into a gutter and
    // can no longer hit pins.
    if (Math.abs(ball.x) > LANE.halfWidth - ball.radius * 0.5) {
      ball.inGutter = true;
      ball.x = Math.sign(ball.x) * (LANE.halfWidth + 0.04);
      ball.y = -LANE.gutterDepth;
      ball.vx = 0; // run straight down the gutter
    }

    // Ball reached the pit / went far enough -> stop.
    if (ball.z > LANE.pinDeckZ + 1.4 || speed < 0.25) {
      ball.rolling = false;
    }

    // --- Ball vs pins collision (only if on the lane) ---
    if (!ball.inGutter) {
      for (const pin of pins) {
        if (pin.fallen) continue;
        const dx = pin.x - ball.x;
        const dz = pin.z - ball.z;
        const dist = Math.hypot(dx, dz);
        const minDist = ball.radius + PIN_RADIUS;
        if (dist < minDist && dist > 1e-5) {
          // Transfer momentum to the pin along the contact normal.
          const nx = dx / dist;
          const nz = dz / dist;
          const impactSpeed = ball.vx * nx + ball.vz * nz;
          if (impactSpeed > 0) {
            const transfer = (impactSpeed * BALL_MASS) / (BALL_MASS + PIN_MASS);
            pin.vx += nx * transfer * 2.6;
            pin.vz += nz * transfer * 2.6;
            knock(pin, nx, nz, impactSpeed);
            // Ball loses a little speed and deflects slightly.
            ball.vx -= nx * transfer * (PIN_MASS / BALL_MASS) * 0.6;
            ball.vz -= nz * transfer * (PIN_MASS / BALL_MASS) * 0.6;
          }
        }
      }
    }
  }

  // --- Pin integration + pin-vs-pin collisions ---
  for (const pin of pins) {
    if (pin.settled) continue;
    const moving = Math.abs(pin.vx) > 0.02 || Math.abs(pin.vz) > 0.02;
    const toppling = pin.fallen && pin.tilt < Math.PI / 2;
    if (moving || toppling) active = true;

    if (pin.fallen) {
      // Advance the topple animation.
      if (pin.tilt < Math.PI / 2) {
        pin.tilt = Math.min(Math.PI / 2, pin.tilt + pin.angVel * dt);
      }
    }

    // Move pins that have lateral velocity (sliding/scattering).
    if (moving) {
      const pinDecel = Math.exp(-2.4 * dt);
      pin.vx *= pinDecel;
      pin.vz *= pinDecel;
      pin.x += pin.vx * dt;
      pin.z += pin.vz * dt;
    } else if (pin.fallen && pin.tilt >= Math.PI / 2 - 1e-3) {
      pin.settled = true;
    } else if (!pin.fallen) {
      // a standing pin with no velocity is settled
      pin.settled = !ball.rolling ? true : pin.settled;
    }
  }

  // Pin vs pin: a moving/falling pin knocks neighbors (chain reaction).
  for (let i = 0; i < pins.length; i++) {
    const a = pins[i];
    const aActive = Math.abs(a.vx) > 0.05 || Math.abs(a.vz) > 0.05;
    if (!aActive) continue;
    for (let j = 0; j < pins.length; j++) {
      if (i === j) continue;
      const b = pins[j];
      if (b.fallen) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      const minDist = PIN_RADIUS * 2 + 0.02;
      if (dist < minDist && dist > 1e-5) {
        const nx = dx / dist;
        const nz = dz / dist;
        const along = a.vx * nx + a.vz * nz;
        if (along > 0) {
          const transfer = along * 0.85;
          b.vx += nx * transfer;
          b.vz += nz * transfer;
          a.vx -= nx * transfer * 0.35;
          a.vz -= nz * transfer * 0.35;
          knock(b, nx, nz, along);
        }
      }
    }
  }

  return active;
}

// Mark a pin as knocked over, falling in the direction of impact.
function knock(pin, nx, nz, force) {
  if (pin.fallen) return;
  pin.fallen = true;
  pin.tiltAxisX = nx;
  pin.tiltAxisZ = nz;
  pin.angVel = FALL_RATE * Math.min(1.5, 0.6 + force * 0.15);
}

// Count pins knocked down (fallen far enough to no longer count as standing).
export function countFallen(pins) {
  return pins.filter((p) => p.fallen || p.tilt > 0.7).length;
}

// Has the simulation come to rest?
export function isSettled(state) {
  if (state.ball.rolling) return false;
  return state.pins.every(
    (p) => p.settled || (!p.fallen && Math.abs(p.vx) < 0.05 && Math.abs(p.vz) < 0.05),
  );
}
