// Physics world (cannon-es). Owns rigid bodies for ball, 10 pins, lane, gutters,
// back wall, and side bumpers. Pure physics — no rendering, no Three.js here.
//
// Coordinate convention (shared with scene.js):
//   +Z points DOWN the lane, from the foul line (z=0) toward the pins (z = LANE_LENGTH).
//   x is across the lane (left/right). y is up.

import * as CANNON from "cannon-es";

// Real-ish ten-pin dimensions, scaled to meters.
export const LANE_LENGTH = 18.3; // ~60 ft
export const LANE_WIDTH = 1.05; // ~41.5 in
export const GUTTER_WIDTH = 0.23;
export const BALL_RADIUS = 0.108; // ~8.5 in diameter
export const BALL_MASS = 6.0; // kg (~13 lb)
export const PIN_HEIGHT = 0.38;
export const PIN_RADIUS = 0.06;
export const PIN_MASS = 1.5; // kg (light vs ball so they scatter)
export const FOUL_LINE_Z = 0;
export const PIN_SPOT_Z = LANE_LENGTH - 0.9; // head pin location
export const PIN_PITCH = 0.305; // 12 in between pin centers (board spacing)

// Standard triangular pin layout, row by row (row 0 = head pin nearest player).
// Offsets are in lane units; we convert to world coords at build time.
const PIN_LAYOUT = [
  [0], // head pin
  [-0.5, 0.5],
  [-1, 0, 1],
  [-1.5, -0.5, 0.5, 1.5],
];

export class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.solver.iterations = 20;
    this.world.defaultContactMaterial.contactEquationStiffness = 1e8;

    this._materials();
    this._lane();
    this._gutters();
    this._walls();

    this.ball = this._makeBall();
    this.pins = this._makePins();
  }

  _materials() {
    this.matLane = new CANNON.Material("lane");
    this.matBall = new CANNON.Material("ball");
    this.matPin = new CANNON.Material("pin");
    this.matGutter = new CANNON.Material("gutter");

    // Ball on lane: low friction, low restitution (oily lane → it slides/rolls).
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.matBall, this.matLane, {
        friction: 0.06,
        restitution: 0.02,
      })
    );
    // Ball on pin: pins fly.
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.matBall, this.matPin, {
        friction: 0.05,
        restitution: 0.35,
      })
    );
    // Pin on pin: they clatter into each other.
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.matPin, this.matPin, {
        friction: 0.1,
        restitution: 0.4,
      })
    );
    // Pin on lane.
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.matPin, this.matLane, {
        friction: 0.3,
        restitution: 0.2,
      })
    );
    // Ball in gutter: high friction, ball dies slowly.
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.matBall, this.matGutter, {
        friction: 0.4,
        restitution: 0.05,
      })
    );
  }

  _lane() {
    const lane = new CANNON.Body({ mass: 0, material: this.matLane });
    lane.addShape(new CANNON.Plane());
    // Rotate plane to be horizontal (normal +y).
    lane.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    lane.position.set(0, 0, 0);
    this.world.addBody(lane);
    this.laneBody = lane;
  }

  _gutters() {
    // Two recessed troughs flanking the lane. Modeled as angled floors slightly
    // below lane level so a ball that drifts off falls in and is slowed.
    const half = LANE_WIDTH / 2;
    const gutterY = -0.07;
    const len = LANE_LENGTH;

    const makeGutterFloor = (xCenter) => {
      const body = new CANNON.Body({ mass: 0, material: this.matGutter });
      const shape = new CANNON.Box(
        new CANNON.Vec3(GUTTER_WIDTH / 2, 0.02, len / 2)
      );
      body.addShape(shape);
      body.position.set(xCenter, gutterY, len / 2);
      this.world.addBody(body);
      return body;
    };
    // outer walls of gutters keep the ball contained
    const makeGutterWall = (x) => {
      const body = new CANNON.Body({ mass: 0, material: this.matGutter });
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.03, 0.18, len / 2)));
      body.position.set(x, 0.05, len / 2);
      this.world.addBody(body);
      return body;
    };

    makeGutterFloor(-(half + GUTTER_WIDTH / 2));
    makeGutterFloor(half + GUTTER_WIDTH / 2);
    makeGutterWall(-(half + GUTTER_WIDTH));
    makeGutterWall(half + GUTTER_WIDTH);

    // Low lips between lane and gutter so the ball doesn't trivially bounce back.
    const makeLip = (x) => {
      const body = new CANNON.Body({ mass: 0, material: this.matGutter });
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.005, 0.015, len / 2)));
      body.position.set(x, 0.0, len / 2);
      this.world.addBody(body);
    };
    makeLip(-half);
    makeLip(half);
  }

  _walls() {
    // Back wall behind the pins (pit) — absorbs the ball and pins.
    const back = new CANNON.Body({ mass: 0, material: this.matGutter });
    back.addShape(new CANNON.Box(new CANNON.Vec3(2, 1.2, 0.1)));
    back.position.set(0, 0.6, LANE_LENGTH + 0.6);
    this.world.addBody(back);
    this.backWall = back;

    // Pit floor (lower) so pins fall away after being struck.
    const pit = new CANNON.Body({ mass: 0, material: this.matGutter });
    pit.addShape(new CANNON.Box(new CANNON.Vec3(2, 0.1, 0.9)));
    pit.position.set(0, -0.25, LANE_LENGTH + 0.3);
    this.world.addBody(pit);
  }

  _makeBall() {
    const body = new CANNON.Body({
      mass: BALL_MASS,
      material: this.matBall,
      shape: new CANNON.Sphere(BALL_RADIUS),
      linearDamping: 0.012,
      angularDamping: 0.012,
    });
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.15;
    body.sleepTimeLimit = 0.4;
    this.resetBall();
    this.world.addBody(body);
    return body;
  }

  resetBall(x = 0) {
    const b = this.ball;
    if (!b) return;
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.force.setZero();
    b.torque.setZero();
    b.position.set(x, BALL_RADIUS, FOUL_LINE_Z + 0.2);
    b.quaternion.set(0, 0, 0, 1);
    b.wakeUp();
  }

  // Launch the ball: speed (m/s) down lane, lateral aim, and spin (curve).
  // aimX: lateral starting x. dirX: small lateral velocity component for angle.
  // spin: angular velocity about y that produces a hook via friction.
  launchBall({ speed, aimX, dirX, spin }) {
    const b = this.ball;
    this.resetBall(aimX);
    b.velocity.set(dirX, 0, speed);
    // Topspin around x-axis makes it roll forward; y-spin creates a hook.
    b.angularVelocity.set(speed / BALL_RADIUS, spin, 0);
    b.wakeUp();
  }

  _makePins() {
    const pins = [];
    let id = 0;
    PIN_LAYOUT.forEach((row, rowIndex) => {
      row.forEach((offset) => {
        const body = new CANNON.Body({
          mass: PIN_MASS,
          material: this.matPin,
          linearDamping: 0.2,
          angularDamping: 0.2,
        });
        // Compound shape: cylinder body approximated by a capsule-ish stack.
        const cyl = new CANNON.Cylinder(
          PIN_RADIUS * 0.7,
          PIN_RADIUS,
          PIN_HEIGHT,
          12
        );
        body.addShape(cyl);
        body.allowSleep = true;
        body.sleepSpeedLimit = 0.1;
        body.sleepTimeLimit = 0.3;
        body._pinId = id++;
        body._home = new CANNON.Vec3(
          offset * PIN_PITCH,
          PIN_HEIGHT / 2,
          PIN_SPOT_Z + rowIndex * PIN_PITCH
        );
        pins.push(body);
        this.world.addBody(body);
      });
    });
    // Assign before resetPins(), which reads this.pins.
    this.pins = pins;
    this.resetPins();
    return pins;
  }

  // Place pins upright at their home spots. Optionally only the ones still standing
  // (keepStanding = array of bools) for the second ball of a frame.
  resetPins(keepStanding = null) {
    this.pins.forEach((pin, i) => {
      pin.velocity.setZero();
      pin.angularVelocity.setZero();
      pin.force.setZero();
      pin.torque.setZero();
      if (keepStanding && !keepStanding[i]) {
        // removed pin: park it far below/out of play
        pin.position.set(pin._home.x, -5, pin._home.z);
        pin.sleep();
        return;
      }
      pin.position.copy(pin._home);
      pin.quaternion.set(0, 0, 0, 1);
      pin.wakeUp();
    });
  }

  // A pin counts as knocked down if it's tilted past ~45° or moved off its spot
  // or fell into the pit.
  standingMask() {
    return this.pins.map((pin) => {
      if (pin.position.y < -1) return false; // parked / fell off
      const up = new CANNON.Vec3(0, 1, 0);
      const local = new CANNON.Vec3();
      pin.quaternion.vmult(up, local);
      const tilt = Math.acos(Math.max(-1, Math.min(1, local.y)));
      if (tilt > Math.PI / 4) return false; // toppled
      const dx = pin.position.x - pin._home.x;
      const dz = pin.position.z - pin._home.z;
      const moved = Math.sqrt(dx * dx + dz * dz);
      if (moved > PIN_RADIUS * 1.6) return false; // knocked off spot
      if (pin.position.y < PIN_HEIGHT * 0.3) return false; // lying flat
      return true;
    });
  }

  // True when everything has essentially stopped moving (ball + pins asleep/slow).
  isSettled() {
    const ballSpeed = this.ball.velocity.length();
    const ballPastPins = this.ball.position.z > PIN_SPOT_Z + 0.3;
    const ballInGutter =
      Math.abs(this.ball.position.x) > LANE_WIDTH / 2 + 0.02 &&
      this.ball.position.z > 2;
    const ballSlow = ballSpeed < 0.25;

    let pinsCalm = true;
    for (const pin of this.pins) {
      if (pin.position.y < -1) continue; // parked
      if (pin.velocity.length() > 0.18 || pin.angularVelocity.length() > 0.4) {
        pinsCalm = false;
        break;
      }
    }
    // Settled if pins are calm AND the ball has either stopped, gone past the
    // pins, or is dawdling in the gutter.
    return pinsCalm && (ballSlow || ballPastPins || (ballInGutter && ballSpeed < 1.2));
  }

  step(dt) {
    this.world.step(1 / 120, dt, 4);
  }
}
