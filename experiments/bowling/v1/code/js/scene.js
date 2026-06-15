// Three.js scene: lane, gutters, pins, ball, lighting, environment, camera.
// Reads body transforms from the physics world each frame and syncs meshes.

import * as THREE from "three";
import {
  LANE_LENGTH,
  LANE_WIDTH,
  GUTTER_WIDTH,
  BALL_RADIUS,
  PIN_HEIGHT,
  PIN_RADIUS,
  PIN_SPOT_Z,
} from "./physics.js";

export class BowlingScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0d18);
    this.scene.fog = new THREE.Fog(0x0a0d18, 22, 40);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
    this.cameraTarget = new THREE.Vector3(0, 0.4, PIN_SPOT_Z);

    this._lights();
    this._lane();
    this._gutters();
    this._environment();
    this.ballMesh = this._ball();
    this.pinMeshes = [];
    this.aimArrow = this._aimArrow();
    this.powerArc = this._powerArc();

    this.resize();
  }

  _lights() {
    const amb = new THREE.AmbientLight(0x404a66, 1.4);
    this.scene.add(amb);

    const hemi = new THREE.HemisphereLight(0x88aaff, 0x202028, 0.5);
    this.scene.add(hemi);

    // Key light over the pins (like the pin-deck spotlight).
    const key = new THREE.DirectionalLight(0xfff2d8, 2.0);
    key.position.set(2.5, 9, PIN_SPOT_Z - 2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    const s = 12;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0004;
    this.scene.add(key);
    this.scene.add(key.target);
    key.target.position.set(0, 0, PIN_SPOT_Z);

    // Fill light near the player.
    const fill = new THREE.DirectionalLight(0x9db4ff, 0.6);
    fill.position.set(-3, 5, -4);
    this.scene.add(fill);

    // Pin-deck accent spotlight.
    const spot = new THREE.SpotLight(0xffffff, 30, 14, Math.PI / 7, 0.4, 1.5);
    spot.position.set(0, 6, PIN_SPOT_Z + 0.5);
    spot.target.position.set(0, 0, PIN_SPOT_Z + 0.8);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    this.scene.add(spot);
    this.scene.add(spot.target);
  }

  _woodTexture() {
    // Procedural wood-plank lane texture on a canvas.
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 2048;
    const ctx = c.getContext("2d");
    const grd = ctx.createLinearGradient(0, 0, c.width, 0);
    grd.addColorStop(0, "#c9974f");
    grd.addColorStop(0.5, "#e3b873");
    grd.addColorStop(1, "#c9974f");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, c.width, c.height);

    // Plank seams down the lane.
    const planks = 12;
    ctx.strokeStyle = "rgba(80,50,20,0.5)";
    ctx.lineWidth = 2;
    for (let i = 1; i < planks; i++) {
      const x = (c.width / planks) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, c.height);
      ctx.stroke();
    }
    // Subtle grain noise.
    for (let i = 0; i < 9000; i++) {
      const x = Math.random() * c.width;
      const y = Math.random() * c.height;
      ctx.fillStyle = `rgba(90,55,25,${Math.random() * 0.06})`;
      ctx.fillRect(x, y, 1, Math.random() * 18);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  _lane() {
    const tex = this._woodTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.25,
      metalness: 0.0,
      envMapIntensity: 0.6,
    });
    const geo = new THREE.BoxGeometry(LANE_WIDTH, 0.1, LANE_LENGTH);
    const lane = new THREE.Mesh(geo, mat);
    lane.position.set(0, -0.05, LANE_LENGTH / 2);
    lane.receiveShadow = true;
    this.scene.add(lane);

    // Foul line.
    const foulGeo = new THREE.BoxGeometry(LANE_WIDTH, 0.012, 0.03);
    const foul = new THREE.Mesh(
      foulGeo,
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 })
    );
    foul.position.set(0, 0.001, 0.05);
    this.scene.add(foul);

    // Aiming arrows (the classic 7 dovetail arrows ~ 4.5m down lane).
    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0x5a3a18,
      roughness: 0.5,
    });
    const arrowXs = [-0.38, -0.25, -0.12, 0, 0.12, 0.25, 0.38];
    arrowXs.forEach((x, i) => {
      const depth = 4.2 + Math.abs(x) * 2.2;
      const a = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 4), arrowMat);
      a.rotation.x = -Math.PI / 2;
      a.rotation.z = Math.PI / 4;
      a.position.set(x, 0.006, depth);
      this.scene.add(a);
    });

    // Approach area (darker) behind the foul line where the player stands.
    const approach = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH + GUTTER_WIDTH * 2 + 0.3, 0.1, 3),
      new THREE.MeshStandardMaterial({ color: 0x3a2c1a, roughness: 0.5 })
    );
    approach.position.set(0, -0.051, -1.5);
    approach.receiveShadow = true;
    this.scene.add(approach);
  }

  _gutters() {
    const half = LANE_WIDTH / 2;
    const gutterMat = new THREE.MeshStandardMaterial({
      color: 0x14181f,
      roughness: 0.3,
      metalness: 0.5,
    });
    [-(half + GUTTER_WIDTH / 2), half + GUTTER_WIDTH / 2].forEach((x) => {
      const g = new THREE.Mesh(
        new THREE.BoxGeometry(GUTTER_WIDTH, 0.12, LANE_LENGTH),
        gutterMat
      );
      g.position.set(x, -0.09, LANE_LENGTH / 2);
      g.receiveShadow = true;
      this.scene.add(g);
    });
  }

  _environment() {
    // Pin deck (slightly raised platform under the pins).
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH + 0.2, 0.06, 1.6),
      new THREE.MeshStandardMaterial({ color: 0xece2c8, roughness: 0.4 })
    );
    deck.position.set(0, -0.03, PIN_SPOT_Z + 0.45);
    deck.receiveShadow = true;
    this.scene.add(deck);

    // Pit / back wall with a backdrop.
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(4, 2.4, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x161a26, roughness: 0.8 })
    );
    back.position.set(0, 1.0, LANE_LENGTH + 0.7);
    back.receiveShadow = true;
    this.scene.add(back);

    // Glowing logo strip on the back wall.
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x2b6cff })
    );
    strip.position.set(0, 1.5, LANE_LENGTH + 0.59);
    this.scene.add(strip);

    // Side walls for enclosure.
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x0f1320,
      roughness: 0.9,
    });
    [-1.6, 1.6].forEach((x) => {
      const w = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 3, LANE_LENGTH + 4),
        wallMat
      );
      w.position.set(x, 1.2, LANE_LENGTH / 2);
      this.scene.add(w);
    });

    // Ceiling.
    const ceil = new THREE.Mesh(
      new THREE.BoxGeometry(4, 0.2, LANE_LENGTH + 4),
      new THREE.MeshStandardMaterial({ color: 0x0c1018, roughness: 1 })
    );
    ceil.position.set(0, 3.2, LANE_LENGTH / 2);
    this.scene.add(ceil);
  }

  _ball() {
    const geo = new THREE.SphereGeometry(BALL_RADIUS, 48, 48);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x1f6fff,
      roughness: 0.12,
      metalness: 0.1,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    this.scene.add(mesh);

    // Finger holes (three small dark dots) as a child group so they rotate with ball.
    const holeMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      roughness: 0.8,
    });
    const holes = new THREE.Group();
    const positions = [
      [0.02, 0.9, 0.03],
      [-0.02, 0.92, 0.02],
      [0, 0.9, -0.03],
    ];
    positions.forEach(([hx, hy, hz]) => {
      const h = new THREE.Mesh(
        new THREE.CircleGeometry(BALL_RADIUS * 0.14, 16),
        holeMat
      );
      const dir = new THREE.Vector3(hx, hy, hz).normalize();
      h.position.copy(dir.multiplyScalar(BALL_RADIUS * 0.99));
      h.lookAt(0, 0, 0);
      h.position.multiplyScalar(-1);
      h.position.copy(dir.multiplyScalar(BALL_RADIUS * 0.99));
      h.lookAt(dir.clone().multiplyScalar(2));
      holes.add(h);
    });
    mesh.add(holes);
    return mesh;
  }

  setBallColor(hex) {
    this.ballMesh.material.color.setHex(hex);
  }

  // Build pin meshes once the physics pins are known.
  buildPins(pinBodies) {
    this.pinMeshes.forEach((m) => this.scene.remove(m));
    this.pinMeshes = pinBodies.map(() => this._pinMesh());
    this.pinMeshes.forEach((m) => this.scene.add(m));
  }

  _pinMesh() {
    const group = new THREE.Group();
    // Bowling-pin silhouette via a lathe.
    const profile = [];
    const pts = [
      [0.0, 0.0],
      [0.34, 0.02],
      [0.42, 0.06],
      [0.5, 0.16],
      [0.46, 0.3],
      [0.34, 0.42],
      [0.28, 0.5],
      [0.3, 0.62],
      [0.42, 0.72],
      [0.46, 0.82],
      [0.4, 0.92],
      [0.3, 0.98],
      [0.22, 1.0],
      [0.0, 1.0],
    ];
    pts.forEach(([r, h]) => {
      profile.push(new THREE.Vector2(r * PIN_RADIUS * 2.0, h * PIN_HEIGHT));
    });
    const geo = new THREE.LatheGeometry(profile, 24);
    geo.translate(0, -PIN_HEIGHT / 2, 0); // center of mass at origin to match physics
    const mat = new THREE.MeshStandardMaterial({
      color: 0xfafafa,
      roughness: 0.25,
      metalness: 0.0,
    });
    const body = new THREE.Mesh(geo, mat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Red neck stripes.
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xd61f2b,
      roughness: 0.3,
    });
    [0.66, 0.74].forEach((h) => {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(
          PIN_RADIUS * 0.62,
          PIN_RADIUS * 0.66,
          PIN_HEIGHT * 0.03,
          24,
          1,
          true
        ),
        stripeMat
      );
      ring.position.y = -PIN_HEIGHT / 2 + h * PIN_HEIGHT;
      group.add(ring);
    });
    return group;
  }

  _aimArrow() {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x6cf0ff,
      transparent: true,
      opacity: 0.85,
    });
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.005, 1.6), mat);
    shaft.position.z = 0.8;
    group.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 16), mat);
    head.rotation.x = Math.PI / 2;
    head.position.z = 1.65;
    group.add(head);
    group.visible = false;
    this.scene.add(group);
    return group;
  }

  _powerArc() {
    // A small ground ring under the ball that fills with power color.
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffcc33,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 32), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    this.scene.add(ring);
    return ring;
  }

  showAim(x, angleRad, power) {
    this.aimArrow.visible = true;
    this.aimArrow.position.set(x, 0.02, 0.25);
    this.aimArrow.rotation.y = -angleRad;
    const len = 0.4 + power * 1.4;
    this.aimArrow.scale.set(1, 1, len);
    // power ring
    this.powerArc.visible = true;
    this.powerArc.position.set(x, 0.015, 0.2);
    this.powerArc.material.opacity = 0.3 + power * 0.6;
    const g = Math.floor(0xcc * (1 - power) + 0x33 * power);
    this.powerArc.material.color.setRGB(1, g / 255, 0.2);
  }

  hideAim() {
    this.aimArrow.visible = false;
    this.powerArc.visible = false;
  }

  syncBall(body) {
    this.ballMesh.position.copy(body.position);
    this.ballMesh.quaternion.copy(body.quaternion);
  }

  syncPins(bodies) {
    bodies.forEach((b, i) => {
      const m = this.pinMeshes[i];
      if (!m) return;
      m.position.copy(b.position);
      m.quaternion.copy(b.quaternion);
      m.visible = b.position.y > -1;
    });
  }

  // Camera follows the ball down the lane, then settles on the pins.
  updateCamera(ballBody, mode) {
    const cam = this.camera;
    let desired = new THREE.Vector3();
    let look = new THREE.Vector3();

    if (mode === "follow") {
      const z = Math.min(ballBody.position.z, PIN_SPOT_Z - 1.5);
      desired.set(ballBody.position.x * 0.4, 1.1, z - 3.0);
      look.set(ballBody.position.x * 0.3, 0.3, ballBody.position.z + 3);
    } else if (mode === "pins") {
      desired.set(0, 1.4, PIN_SPOT_Z - 4.2);
      look.set(0, 0.4, PIN_SPOT_Z + 0.5);
    } else {
      // aiming / default behind-the-player view
      desired.set(0, 1.5, -3.2);
      look.set(0, 0.35, PIN_SPOT_Z * 0.55);
    }

    cam.position.lerp(desired, 0.06);
    this.cameraTarget.lerp(look, 0.08);
    cam.lookAt(this.cameraTarget);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
