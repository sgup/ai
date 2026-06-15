/**
 * physics.js — A compact, purpose-built physics simulator for bowling.
 *
 * Rather than pulling in a full rigid-body engine, this implements just what a
 * convincing bowling sim needs:
 *   - A rolling ball with velocity, angular momentum and a lateral "hook" force
 *     from spin (so curve/hook shots behave realistically on an oily lane).
 *   - Upright pins as capsule-ish cylinders that get knocked over by the ball
 *     and by each other (chain reactions), then tumble and slide off.
 *   - Gutters: the ball falls into the channel if it drifts past the lane edge.
 *
 * Units are meters. The lane runs along +Z (away from the bowler). X is the
 * lateral axis. Y is up.
 *
 * All vectors here are plain {x,y,z} objects to stay independent of Three.js;
 * the renderer reads positions/quaternions out each frame.
 */

export const LANE = {
  length: 18.29, // regulation ~60ft foul line to head pin + pin deck
  width: 1.05, // playing surface width (~41.5in)
  pinDeckZ: 16.7, // z of the head pin (#1)
  approachZ: 0.0, // foul line z (release point reference)
  gutterDepth: 0.12,
};

export const BALL_RADIUS = 0.108; // ~8.5in diameter
export const PIN_RADIUS = 0.06;
export const PIN_HEIGHT = 0.38;
const PIN_SPACING = 0.305; // 12 inches between pin centers

// Standard 10-pin triangle, offsets relative to the head pin (#1) at z = pinDeckZ.
// Row 1: pin 1; Row 2: 2,3; Row 3: 4,5,6; Row 4: 7,8,9,10
export const PIN_LAYOUT = [
  { id: 1, x: 0.0, z: 0.0 },
  { id: 2, x: -PIN_SPACING / 2, z: PIN_SPACING * 0.866 },
  { id: 3, x: PIN_SPACING / 2, z: PIN_SPACING * 0.866 },
  { id: 4, x: -PIN_SPACING, z: PIN_SPACING * 0.866 * 2 },
  { id: 5, x: 0.0, z: PIN_SPACING * 0.866 * 2 },
  { id: 6, x: PIN_SPACING, z: PIN_SPACING * 0.866 * 2 },
  { id: 7, x: -PIN_SPACING * 1.5, z: PIN_SPACING * 0.866 * 3 },
  { id: 8, x: -PIN_SPACING / 2, z: PIN_SPACING * 0.866 * 3 },
  { id: 9, x: PIN_SPACING / 2, z: PIN_SPACING * 0.866 * 3 },
  { id: 10, x: PIN_SPACING * 1.5, z: PIN_SPACING * 0.866 * 3 },
];

const GRAVITY = -9.8;

function v(x = 0, y = 0, z = 0) {
  return { x, y, z };
}
function len2(a) {
  return Math.hypot(a.x, a.z);
}

export class Pin {
  constructor(def) {
    this.id = def.id;
    this.home = v(def.x, PIN_HEIGHT / 2, LANE.pinDeckZ + def.z);
    this.reset();
  }
  reset() {
    this.pos = { ...this.home };
    this.vel = v();
    this.angVel = v(); // tumbling angular velocity (rad/s) about x/z axes
    this.tilt = v(); // accumulated rotation about x and z (radians)
    this.spin = 0; // spin about own vertical axis
    this.spinAngle = 0;
    this.down = false;
    this.settled = false;
    this.counted = false; // already tallied as knocked down
  }
  /** A pin counts as "down" once it tips past ~35° or leaves the deck. */
  get isKnocked() {
    return (
      this.down ||
      Math.abs(this.tilt.x) > 0.62 ||
      Math.abs(this.tilt.z) > 0.62 ||
      this.pos.y < PIN_HEIGHT * 0.35
    );
  }
}

export class BowlingPhysics {
  constructor() {
    this.pins = PIN_LAYOUT.map((d) => new Pin(d));
    this.resetBall();
    this.rolling = false;
    this.ballInGutter = false;
    this.settleTimer = 0;
  }

  resetPins() {
    for (const p of this.pins) p.reset();
  }

  /** Remove pins that were knocked down on a previous ball (deadwood cleared). */
  clearKnockedPins() {
    for (const p of this.pins) {
      if (p.isKnocked) {
        p.removed = true;
      }
    }
  }

  /** Restore a fresh full rack. */
  rackFull() {
    for (const p of this.pins) {
      p.reset();
      p.removed = false;
    }
  }

  resetBall(x = 0) {
    this.ball = {
      pos: v(x, BALL_RADIUS, LANE.approachZ - 0.4),
      vel: v(),
      angVel: v(), // rolling rotation (rad/s)
      spin: 0, // hook spin: + curves right, - curves left
      rollRot: v(), // accumulated rotation for rendering
    };
    this.ballInGutter = false;
  }

  /**
   * Launch the ball.
   * @param {number} power  0..1 → forward speed
   * @param {number} aimX   lateral release offset in meters (where on the lane)
   * @param {number} angle  initial heading in radians (small; + aims right)
   * @param {number} spin   hook spin -1..1 (curve strength + direction)
   */
  launch({ power, aimX, angle, spin }) {
    const speed = 7.5 + power * 7.5; // 7.5 .. 15 m/s
    // Tiny lane/release imperfection so identical inputs don't always produce
    // an identical result — a dead-centre hit can carry or leave a corner, just
    // like the real thing.
    const wobble = (Math.random() - 0.5) * 0.012;
    const angWobble = (Math.random() - 0.5) * 0.01;
    this.ball.pos = v(aimX + wobble, BALL_RADIUS, LANE.approachZ - 0.2);
    this.ball.vel = v(
      Math.sin(angle + angWobble) * speed,
      0,
      Math.cos(angle + angWobble) * speed
    );
    this.ball.spin = spin;
    this.ball.angVel = v(speed / BALL_RADIUS, spin * 6, 0);
    this.ball.rollRot = v();
    this.rolling = true;
    this.ballInGutter = false;
    this.settleTimer = 0;
  }

  step(dt) {
    if (this.rolling) this._stepBall(dt);
    this._stepPins(dt);

    // Determine when motion has effectively stopped.
    if (this.rolling) {
      const ballSlow =
        len2(this.ball.vel) < 0.25 ||
        this.ball.pos.z > LANE.pinDeckZ + 1.6 ||
        this.ballInGutter;
      const pinsCalm = this.pins.every(
        (p) => p.removed || len2(p.vel) < 0.05 || p.settled
      );
      if (ballSlow && pinsCalm) {
        this.settleTimer += dt;
      } else {
        this.settleTimer = 0;
      }
    }
  }

  _stepBall(dt) {
    const b = this.ball;
    const halfW = LANE.width / 2;

    // Gutter check — once the ball center passes the edge it drops into the channel.
    if (!this.ballInGutter && Math.abs(b.pos.x) > halfW - BALL_RADIUS * 0.5) {
      this.ballInGutter = true;
      b.spin = 0;
      // Clamp into the gutter trough and kill lateral motion.
      b.pos.x = Math.sign(b.pos.x) * (halfW + 0.04);
      b.vel.x = 0;
      b.vel.z = Math.max(b.vel.z * 0.7, 2.5);
    }

    if (this.ballInGutter) {
      b.pos.y = BALL_RADIUS - LANE.gutterDepth * 0.6;
      b.vel.z *= 1 - 0.5 * dt;
      b.pos.z += b.vel.z * dt;
      this._spinBallVisual(dt);
      return;
    }

    // Hook physics: spin imparts a growing lateral acceleration, stronger as the
    // ball slows and "grabs" the drier back end of the lane. Kept modest so a
    // shot aimed near the edge can curve back toward the pocket without sailing
    // straight into the gutter.
    const speed = len2(b.vel);
    const traction = Math.min(1, (16 - speed) / 22 + 0.08); // grows as it slows
    const hookAccel = b.spin * 1.7 * Math.max(0, traction);
    b.vel.x += hookAccel * dt;

    // Rolling friction — gentle, lane-realistic slowdown. The ball should lose
    // most of its energy by the time it reaches the pins / pit so it doesn't
    // sail off the back of the world, but keeps enough drive to carry pins.
    b.vel.x -= b.vel.x * 0.7 * dt;
    b.vel.z -= b.vel.z * 0.5 * dt;

    // Integrate position.
    b.pos.x += b.vel.x * dt;
    b.pos.z += b.vel.z * dt;

    // Pin collisions.
    this._ballPinCollisions();

    // Once past the pin deck the ball drops into the pit at the back of the
    // lane, falling out of sight and quickly coming to rest there.
    if (b.pos.z > LANE.pinDeckZ + 0.9) {
      b.pos.y -= 2.4 * dt;
      b.vel.z *= 1 - 1.6 * dt;
      b.vel.x *= 1 - 2.0 * dt;
      if (b.pos.y < -0.6) {
        b.pos.y = -0.6;
        b.vel.z = 0;
        b.vel.x = 0;
      }
    }

    this._spinBallVisual(dt);
  }

  _spinBallVisual(dt) {
    const b = this.ball;
    const speed = len2(b.vel);
    // Rolling: rotate about the axis perpendicular to travel.
    b.rollRot.x += (speed / BALL_RADIUS) * dt;
    b.rollRot.y += b.spin * 4 * dt;
  }

  _ballPinCollisions() {
    const b = this.ball;
    for (const p of this.pins) {
      if (p.removed) continue;
      const dx = p.pos.x - b.pos.x;
      const dz = p.pos.z - b.pos.z;
      const dist = Math.hypot(dx, dz);
      const minDist = BALL_RADIUS + PIN_RADIUS;
      if (dist < minDist && dist > 1e-4) {
        const nx = dx / dist;
        const nz = dz / dist;
        const impactSpeed = b.vel.x * nx + b.vel.z * nz;
        if (impactSpeed <= 0) continue;

        // Transfer momentum: pins are light, fly off energetically and carry
        // hard into their neighbours so chain reactions clear the rack. A bit of
        // extra lateral spread helps the scatter reach the wide corner pins.
        const force = impactSpeed * 1.9;
        p.vel.x += nx * force * 1.25 + b.spin * 1.8;
        p.vel.z += nz * force;
        p.vel.y += 0.3 + Math.random() * 0.35; // little pop up
        // Tumble away from impact.
        p.angVel.x += nz * force * 4 * (0.8 + Math.random() * 0.4);
        p.angVel.z += -nx * force * 4 * (0.8 + Math.random() * 0.4);
        p.spin += (Math.random() - 0.5) * 8;
        p.down = true;

        // The ball is far heavier than a pin: it barely deflects and keeps
        // driving forward, so it can plow through to the back rows.
        b.vel.x -= nx * impactSpeed * 0.06;
        b.vel.z -= nz * impactSpeed * 0.05;
      }
    }
  }

  _stepPins(dt) {
    for (const p of this.pins) {
      if (p.removed || p.settled) continue;
      const moving =
        len2(p.vel) > 0.02 ||
        Math.abs(p.vel.y) > 0.02 ||
        Math.abs(p.angVel.x) > 0.05 ||
        Math.abs(p.angVel.z) > 0.05;
      if (!moving && !p.down) {
        continue; // still standing, untouched
      }

      // Gravity + vertical integration with floor bounce.
      p.vel.y += GRAVITY * dt;
      p.pos.y += p.vel.y * dt;
      const floor = PIN_HEIGHT / 2 - Math.min(0.18, Math.abs(p.tilt.x) + Math.abs(p.tilt.z)) * 0.1;
      if (p.pos.y < floor) {
        p.pos.y = floor;
        if (p.vel.y < 0) p.vel.y = -p.vel.y * 0.18;
        // Ground friction on lateral motion — frame-rate-independent and light
        // enough that knocked pins slide far enough to topple the corners.
        const gf = Math.pow(0.4, dt); // ~0.4 per second
        p.vel.x *= gf;
        p.vel.z *= gf;
      }

      // Horizontal integration.
      p.pos.x += p.vel.x * dt;
      p.pos.z += p.vel.z * dt;

      // Tumble.
      p.tilt.x += p.angVel.x * dt;
      p.tilt.z += p.angVel.z * dt;
      p.spinAngle += p.spin * dt;
      // Damping on angular velocity.
      p.angVel.x *= 1 - 1.4 * dt;
      p.angVel.z *= 1 - 1.4 * dt;
      p.spin *= 1 - 0.8 * dt;

      // Pin-vs-pin collisions (chain reactions).
      this._pinPinCollisions(p);

      // Settle once it's lying down and slow.
      if (
        len2(p.vel) < 0.04 &&
        Math.abs(p.vel.y) < 0.05 &&
        (Math.abs(p.tilt.x) > 0.7 || Math.abs(p.tilt.z) > 0.7 || p.pos.y <= floor + 0.001)
      ) {
        if (p.isKnocked) {
          p.vel = v();
          p.settled = true;
        }
      }
    }
  }

  _pinPinCollisions(p) {
    for (const q of this.pins) {
      if (q === p || q.removed) continue;
      const dx = q.pos.x - p.pos.x;
      const dz = q.pos.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      const minDist = PIN_RADIUS * 2;
      if (dist < minDist && dist > 1e-4) {
        const nx = dx / dist;
        const nz = dz / dist;
        const overlap = minDist - dist;
        // Separate.
        p.pos.x -= nx * overlap * 0.5;
        p.pos.z -= nz * overlap * 0.5;
        q.pos.x += nx * overlap * 0.5;
        q.pos.z += nz * overlap * 0.5;

        const relSpeed = (p.vel.x - q.vel.x) * nx + (p.vel.z - q.vel.z) * nz;
        if (relSpeed > 0) {
          const transfer = relSpeed * 0.95;
          q.vel.x += nx * transfer * 1.15;
          q.vel.z += nz * transfer;
          q.vel.y += 0.15 + Math.random() * 0.2;
          q.angVel.x += nz * transfer * 5 * (0.7 + Math.random() * 0.5);
          q.angVel.z += -nx * transfer * 5 * (0.7 + Math.random() * 0.5);
          q.spin += (Math.random() - 0.5) * 6;
          q.down = true;
          p.vel.x -= nx * transfer * 0.6;
          p.vel.z -= nz * transfer * 0.6;
        }
      }
    }
  }

  /** Count pins knocked down (for the current rack state). */
  countDownPins() {
    return this.pins.filter((p) => !p.removed && p.isKnocked).length;
  }

  /** True when ball + pins have come to rest after a roll. */
  isSettled() {
    return this.rolling && this.settleTimer > 0.7;
  }

  endRoll() {
    this.rolling = false;
  }
}
