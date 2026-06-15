/*
 * 3D bowling game: rendering (Three.js) + input + game-state machine.
 *
 * Depends on globals:
 *   THREE          (loaded via CDN in index.html)
 *   window.Bowling      (scoring.js)
 *   window.BowlPhysics  (physics.js)
 *
 * The game loop runs a fixed-step physics world while a throw is live and a
 * variable-rate render. Mouse controls:
 *   - move mouse left/right over the lane to aim
 *   - click+hold to start a power meter, drag up/down for spin (hook), release
 *     to throw. A quick click also throws at the current meter value.
 */
(function () {
  "use strict";

  var THREE = window.THREE;
  var Bowling = window.Bowling;
  var Phys = window.BowlPhysics;
  var C = Phys.constants;

  // ---- Scene setup ---------------------------------------------------------
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070f);
  scene.fog = new THREE.Fog(0x05070f, 28, 46);

  var camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );

  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  var container = document.getElementById("scene");
  container.appendChild(renderer.domElement);

  // ---- Lighting ------------------------------------------------------------
  var ambient = new THREE.AmbientLight(0x6677aa, 0.55);
  scene.add(ambient);

  var key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(-6, 18, -6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = 40;
  key.shadow.bias = -0.0004;
  scene.add(key);

  // Warm spotlight over the pin deck.
  var pinSpot = new THREE.SpotLight(0xffeecc, 1.4, 26, Math.PI / 5, 0.45, 1);
  pinSpot.position.set(0, 12, C.PIN_DECK_Z + 1.0);
  pinSpot.target.position.set(0, 0, C.PIN_DECK_Z + 1.0);
  scene.add(pinSpot);
  scene.add(pinSpot.target);

  var fill = new THREE.PointLight(0x4466ff, 0.4, 40);
  fill.position.set(4, 6, -2);
  scene.add(fill);

  // ---- Lane, gutters, environment -----------------------------------------
  var LANE_LEN = C.PIN_DECK_Z + 6.0;
  var laneGroup = new THREE.Group();
  scene.add(laneGroup);

  // Wood lane with subtle plank striping via canvas texture.
  function makeLaneTexture() {
    var cv = document.createElement("canvas");
    cv.width = 64;
    cv.height = 1024;
    var ctx = cv.getContext("2d");
    var grad = ctx.createLinearGradient(0, 0, 0, 1024);
    grad.addColorStop(0, "#c8923f");
    grad.addColorStop(0.5, "#d89b46");
    grad.addColorStop(1, "#b97f33");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 1024);
    // plank lines
    for (var x = 0; x < 64; x += 8) {
      ctx.strokeStyle = "rgba(80,50,20,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 1024);
      ctx.stroke();
    }
    // grain noise
    for (var i = 0; i < 4000; i++) {
      ctx.fillStyle = "rgba(60,40,15," + Math.random() * 0.06 + ")";
      ctx.fillRect(Math.random() * 64, Math.random() * 1024, 1, Math.random() * 8);
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    return tex;
  }

  var laneTex = makeLaneTexture();
  var laneMat = new THREE.MeshStandardMaterial({
    map: laneTex,
    roughness: 0.25,
    metalness: 0.05,
  });
  var laneWidth = C.LANE_HALF_WIDTH * 2;
  var lane = new THREE.Mesh(
    new THREE.BoxGeometry(laneWidth, 0.2, LANE_LEN),
    laneMat
  );
  lane.position.set(0, -0.1, LANE_LEN / 2 - 2.0);
  lane.receiveShadow = true;
  laneGroup.add(lane);

  // Approach (the area before the foul line where the bowler stands).
  var approach = new THREE.Mesh(
    new THREE.BoxGeometry(laneWidth + 1.2, 0.2, 5),
    new THREE.MeshStandardMaterial({ color: 0x6b4a26, roughness: 0.6 })
  );
  approach.position.set(0, -0.1, -3.5);
  approach.receiveShadow = true;
  laneGroup.add(approach);

  // Foul line.
  var foul = new THREE.Mesh(
    new THREE.BoxGeometry(laneWidth, 0.22, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x110000 })
  );
  foul.position.set(0, 0.01, C.FOUL_LINE_Z);
  laneGroup.add(foul);

  // Gutters.
  var gutterMat = new THREE.MeshStandardMaterial({
    color: 0x1a1d2b,
    roughness: 0.4,
    metalness: 0.3,
  });
  [-1, 1].forEach(function (side) {
    var gutter = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.18, LANE_LEN),
      gutterMat
    );
    gutter.position.set(side * (C.LANE_HALF_WIDTH + 0.17), -0.14, LANE_LEN / 2 - 2.0);
    gutter.receiveShadow = true;
    laneGroup.add(gutter);
  });

  // Aiming arrows (the classic 7 dovetail arrows ~4.5m down the lane).
  var arrowMat = new THREE.MeshStandardMaterial({
    color: 0x3a2410,
    emissive: 0x1a1000,
  });
  for (var a = 0; a < 7; a++) {
    var arrow = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 4), arrowMat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.rotation.z = Math.PI / 4;
    var off = (a - 3) * 0.26;
    arrow.position.set(off, 0.02, 4.5 + Math.abs(off) * 0.4);
    laneGroup.add(arrow);
  }

  // Pin deck backstop / pit.
  var pit = new THREE.Mesh(
    new THREE.BoxGeometry(laneWidth + 1.0, 2.4, 3.0),
    new THREE.MeshStandardMaterial({ color: 0x0a0c14, roughness: 0.9 })
  );
  pit.position.set(0, 1.0, C.PIN_DECK_Z + 4.2);
  laneGroup.add(pit);

  // Back wall with a glowing logo strip.
  var backWall = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 8),
    new THREE.MeshStandardMaterial({ color: 0x101428, roughness: 0.8 })
  );
  backWall.position.set(0, 3.5, C.PIN_DECK_Z + 5.6);
  scene.add(backWall);

  var logoStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 0.8),
    new THREE.MeshStandardMaterial({
      color: 0x00ffcc,
      emissive: 0x00aa88,
      emissiveIntensity: 1.2,
    })
  );
  logoStrip.position.set(0, 5.2, C.PIN_DECK_Z + 5.55);
  scene.add(logoStrip);

  // Side rails / lane walls for depth.
  [-1, 1].forEach(function (side) {
    var wall = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 3, LANE_LEN),
      new THREE.MeshStandardMaterial({ color: 0x14182a, roughness: 0.7 })
    );
    wall.position.set(side * (C.LANE_HALF_WIDTH + 0.5), 1.2, LANE_LEN / 2 - 2.0);
    scene.add(wall);
  });

  // ---- Ball ---------------------------------------------------------------
  var ballMat = new THREE.MeshPhysicalMaterial({
    color: 0x1133cc,
    roughness: 0.08,
    metalness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
  });
  var ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(C.BALL_RADIUS, 48, 32),
    ballMat
  );
  ballMesh.castShadow = true;
  scene.add(ballMesh);

  // Finger holes (cosmetic) parented to the ball.
  var holeMat = new THREE.MeshStandardMaterial({ color: 0x06081a, roughness: 0.6 });
  for (var h = 0; h < 3; h++) {
    var hole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.08, 12),
      holeMat
    );
    var ang = (h / 3) * Math.PI * 2;
    hole.position.set(
      Math.cos(ang) * 0.06,
      C.BALL_RADIUS - 0.02,
      Math.sin(ang) * 0.06
    );
    ballMesh.add(hole);
  }

  // ---- Pins ---------------------------------------------------------------
  function makePinMesh() {
    var group = new THREE.Group();
    // Approximate a pin profile with stacked segments (LatheGeometry).
    var points = [];
    var profile = [
      [0.0, 0.0],
      [0.055, 0.02],
      [0.06, 0.12],
      [0.05, 0.28],
      [0.035, 0.42],
      [0.045, 0.56],
      [0.06, 0.66],
      [0.055, 0.78],
      [0.035, 0.9],
      [0.028, 0.95],
      [0.0, 0.96],
    ];
    for (var i = 0; i < profile.length; i++) {
      points.push(new THREE.Vector2(profile[i][0] * 2, profile[i][1]));
    }
    var geo = new THREE.LatheGeometry(points, 24);
    var mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.0,
    });
    var body = new THREE.Mesh(geo, mat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    // Red neck stripes.
    var stripeMat = new THREE.MeshStandardMaterial({ color: 0xcc1122, roughness: 0.35 });
    [0.7, 0.78].forEach(function (yy) {
      var ring = new THREE.Mesh(
        new THREE.CylinderGeometry(0.072, 0.072, 0.03, 24, 1, true),
        stripeMat
      );
      ring.position.y = yy * C.PIN_HEIGHT;
      group.add(ring);
    });
    return group;
  }

  var pinMeshes = [];
  for (var pi = 0; pi < 10; pi++) {
    var pm = makePinMesh();
    scene.add(pm);
    pinMeshes.push(pm);
  }

  // ---- Aim guide line ------------------------------------------------------
  var aimMat = new THREE.LineDashedMaterial({
    color: 0x00ffcc,
    dashSize: 0.3,
    gapSize: 0.2,
    transparent: true,
    opacity: 0.8,
  });
  var aimGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.05, C.FOUL_LINE_Z - 0.6),
    new THREE.Vector3(0, 0.05, C.PIN_DECK_Z),
  ]);
  var aimLine = new THREE.Line(aimGeo, aimMat);
  aimLine.computeLineDistances();
  scene.add(aimLine);

  // Spin indicator arc (curves the aim line when hook is applied).
  // ---- World + game state --------------------------------------------------
  var world = Phys.createWorld();
  var game = Bowling.createGame();

  var STATE = { AIM: "aim", POWER: "power", THROW: "throw", SETTLE: "settle", BETWEEN: "between" };
  var state = STATE.AIM;

  var input = {
    aimX: 0, // -1..1 lateral start position
    dirX: 0, // aim direction across lane
    power: 0, // 0..1
    spin: 0, // -1..1 hook
    charging: false,
    chargeStart: 0,
    mouseX: 0,
    mouseY: 0,
  };

  var lastThrowResult = null;
  var pinsBeforeThrow = 10;
  var messageTimer = 0;

  // ---- HUD elements --------------------------------------------------------
  var scoreboardEl = document.getElementById("scoreboard");
  var powerFillEl = document.getElementById("power-fill");
  var spinFillEl = document.getElementById("spin-indicator");
  var messageEl = document.getElementById("message");
  var totalEl = document.getElementById("total-score");
  var hintEl = document.getElementById("hint");

  function showMessage(text, ms, cls) {
    messageEl.textContent = text;
    messageEl.className = "message show " + (cls || "");
    messageTimer = (ms || 1800) / 1000;
  }

  // Build the 10-frame scoreboard once; cells updated each render.
  function buildScoreboard() {
    var html = "";
    for (var f = 0; f < 10; f++) {
      var rolls = f === 9 ? 3 : 2;
      html += '<div class="frame" data-frame="' + f + '">';
      html += '<div class="frame-num">' + (f + 1) + "</div>";
      html += '<div class="frame-rolls">';
      for (var r = 0; r < rolls; r++) {
        html += '<span class="roll" data-roll="' + r + '"></span>';
      }
      html += "</div>";
      html += '<div class="frame-total"></div>';
      html += "</div>";
    }
    scoreboardEl.innerHTML = html;
  }

  function updateScoreboard() {
    var frameEls = scoreboardEl.querySelectorAll(".frame");
    for (var f = 0; f < 10; f++) {
      var frame = game.frames[f];
      var el = frameEls[f];
      var rollEls = el.querySelectorAll(".roll");
      for (var r = 0; r < rollEls.length; r++) {
        var val = frame.rolls[r];
        if (val === undefined) {
          rollEls[r].textContent = "";
        } else {
          rollEls[r].textContent = Bowling.labelForRoll(game, f, r, val);
        }
      }
      var totalCell = el.querySelector(".frame-total");
      totalCell.textContent = frame.cumulative !== null ? frame.cumulative : "";
      el.classList.toggle("active", f === game.currentFrame && !game.over);
    }
    totalEl.textContent = Bowling.settledTotal(game);
  }

  // ---- Camera helpers ------------------------------------------------------
  var camDefault = { x: 0, y: 2.4, z: -4.2, lookZ: 10 };
  var camFollow = false;

  function updateCamera(dt) {
    var target;
    if (camFollow && world.ball.active) {
      // Trail behind & above the ball.
      var bz = world.ball.pos.z;
      target = {
        x: world.ball.pos.x * 0.5,
        y: 1.6,
        z: bz - 3.0,
        lookZ: bz + 4,
      };
    } else {
      target = camDefault;
    }
    camera.position.x += (target.x - camera.position.x) * Math.min(1, dt * 4);
    camera.position.y += (target.y - camera.position.y) * Math.min(1, dt * 4);
    camera.position.z += (target.z - camera.position.z) * Math.min(1, dt * 4);
    var lz = target.lookZ;
    camera.lookAt(input.aimX * 0.3, 0.4, lz);
  }

  // ---- Sound (WebAudio, synthesized, no assets) ----------------------------
  var audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        audioCtx = null;
      }
    }
  }
  function playRoll() {
    if (!audioCtx) return;
    var o = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    o.type = "sawtooth";
    o.frequency.value = 55;
    g.gain.value = 0.06;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.4);
    o.stop(audioCtx.currentTime + 1.4);
  }
  function playCrash() {
    if (!audioCtx) return;
    var bufferSize = audioCtx.sampleRate * 0.5;
    var buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
    }
    var noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    var g = audioCtx.createGain();
    g.gain.value = 0.25;
    var filter = audioCtx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    noise.connect(filter);
    filter.connect(g);
    g.connect(audioCtx.destination);
    noise.start();
  }
  function playStrikeChime() {
    if (!audioCtx) return;
    [523, 659, 784, 1047].forEach(function (f, idx) {
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.value = 0.0001;
      o.connect(g);
      g.connect(audioCtx.destination);
      var t = audioCtx.currentTime + idx * 0.08;
      o.start(t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.stop(t + 0.5);
    });
  }

  // ---- Input handling ------------------------------------------------------
  function ndcToLaneX(clientX) {
    // Map horizontal mouse position to an aim start X within the lane.
    var nx = (clientX / window.innerWidth) * 2 - 1; // -1..1
    return nx * (C.LANE_HALF_WIDTH - C.BALL_RADIUS - 0.05);
  }

  renderer.domElement.addEventListener("mousemove", function (e) {
    input.mouseX = e.clientX;
    input.mouseY = e.clientY;
    if (state === STATE.AIM) {
      input.aimX = ndcToLaneX(e.clientX);
      // Aim direction: subtle, mouse near top of screen aims further.
    } else if (state === STATE.POWER && input.charging) {
      // While charging, vertical drag sets spin (hook).
      var dy = (input.chargeY - e.clientY) / 200;
      input.spin = Math.max(-1, Math.min(1, dy));
      // Horizontal drag fine-tunes aim direction.
      var dx = (e.clientX - input.chargeX) / 400;
      input.dirX = Math.max(-0.35, Math.min(0.35, dx));
    }
  });

  renderer.domElement.addEventListener("mousedown", function (e) {
    ensureAudio();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    if (state === STATE.AIM) {
      state = STATE.POWER;
      input.charging = true;
      input.chargeStart = performance.now();
      input.chargeX = e.clientX;
      input.chargeY = e.clientY;
      input.spin = 0;
      input.dirX = 0;
    }
  });

  window.addEventListener("mouseup", function () {
    if (state === STATE.POWER && input.charging) {
      input.charging = false;
      throwBall();
    }
  });

  // Touch support (basic) for mouse-free play.
  renderer.domElement.addEventListener("touchstart", function (e) {
    if (e.touches[0]) {
      input.mouseX = e.touches[0].clientX;
      if (state === STATE.AIM) {
        input.aimX = ndcToLaneX(e.touches[0].clientX);
        state = STATE.POWER;
        input.charging = true;
        input.chargeStart = performance.now();
        input.chargeX = e.touches[0].clientX;
        input.chargeY = e.touches[0].clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });
  renderer.domElement.addEventListener("touchmove", function (e) {
    if (e.touches[0] && state === STATE.POWER) {
      var dy = (input.chargeY - e.touches[0].clientY) / 200;
      input.spin = Math.max(-1, Math.min(1, dy));
    }
    e.preventDefault();
  }, { passive: false });
  renderer.domElement.addEventListener("touchend", function (e) {
    if (state === STATE.POWER && input.charging) {
      input.charging = false;
      throwBall();
    }
    e.preventDefault();
  });

  window.addEventListener("resize", function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- Throw / settle flow -------------------------------------------------
  function throwBall() {
    if (state !== STATE.POWER) return;
    var power = input.power;
    if (power < 0.05) power = 0.05;
    var speed = 9 + power * 9; // 9..18
    pinsBeforeThrow = Bowling.pinsAvailable(game);

    Phys.resetBall(world);
    Phys.launch(world, {
      startX: input.aimX,
      dirX: input.dirX,
      speed: speed,
      spin: input.spin * 2.2,
    });
    state = STATE.THROW;
    camFollow = true;
    playRoll();
    hintEl.style.opacity = "0";
  }

  function resolveThrow() {
    var standing = Phys.countStanding(world);
    var knocked = pinsBeforeThrow - standing;
    if (knocked < 0) knocked = 0;
    if (world.ball.inGutter) knocked = 0;

    var frameBefore = game.currentFrame;
    var wasFirstBall = game.frames[game.currentFrame].rolls.length === 0;

    Bowling.roll(game, knocked);
    updateScoreboard();

    var frameAfter = game.currentFrame;
    var frameAdvanced = frameAfter !== frameBefore || game.over;

    // Messaging.
    if (knocked === 10 && wasFirstBall) {
      showMessage("STRIKE!", 2000, "strike");
      playStrikeChime();
    } else if (
      !wasFirstBall &&
      standing === 0 &&
      frameBefore < 9 &&
      game.frames[frameBefore].rolls[0] + knocked === 10
    ) {
      showMessage("SPARE!", 1800, "spare");
      playStrikeChime();
    } else if (world.ball.inGutter) {
      showMessage("Gutter ball", 1400, "gutter");
    } else if (knocked === 0) {
      showMessage("Miss", 1200, "");
    } else {
      showMessage(knocked + " down", 1000, "");
    }

    state = STATE.BETWEEN;
    betweenTimer = 1.6;

    if (game.over) {
      finalTimer = 1.8;
    }
  }

  var betweenTimer = 0;
  var finalTimer = -1;

  function nextBall() {
    camFollow = false;
    if (game.over) {
      var total = Bowling.settledTotal(game);
      showMessage("Game over — " + total + "! Press R to play again", 999999, "final");
      state = STATE.BETWEEN; // stays here; R restarts
      return;
    }

    // If the previous ball completed a frame (or strike), re-rack all pins.
    var frame = game.frames[game.currentFrame];
    var needFreshRack = false;
    if (game.currentFrame < 9) {
      needFreshRack = frame.rolls.length === 0; // new frame -> fresh rack
    } else {
      // Frame 10: re-rack after strike or spare.
      var r = frame.rolls;
      if (r.length === 0) needFreshRack = true;
      else if (r.length === 1 && r[0] === 10) needFreshRack = true;
      else if (r.length === 2 && (r[1] === 10 || r[0] + r[1] === 10)) needFreshRack = true;
    }

    if (needFreshRack) {
      Phys.resetPins(world);
      syncPinMeshes(true);
    } else {
      Phys.clearDownedPins(world);
    }
    Phys.resetBall(world);
    state = STATE.AIM;
    input.power = 0;
    input.spin = 0;
    input.dirX = 0;
  }

  function restartGame() {
    game = Bowling.createGame();
    world = Phys.createWorld();
    syncPinMeshes(true);
    updateScoreboard();
    state = STATE.AIM;
    camFollow = false;
    input.power = 0;
    messageEl.className = "message";
    hintEl.style.opacity = "1";
  }

  window.addEventListener("keydown", function (e) {
    if (e.key === "r" || e.key === "R") restartGame();
  });

  // ---- Mesh sync -----------------------------------------------------------
  function syncPinMeshes(snap) {
    for (var i = 0; i < 10; i++) {
      var p = world.pins[i];
      var mesh = pinMeshes[i];
      if (p.removed) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(p.pos.x, p.pos.y - C.PIN_HEIGHT * 0.5, p.pos.z);
      // Apply tilt around the horizontal tilt axis.
      var axis = p.tiltAxis;
      // Rotation axis perpendicular to fall direction, in the ground plane.
      var rotAxis = new THREE.Vector3(-axis.z, 0, axis.x).normalize();
      mesh.setRotationFromAxisAngle(rotAxis, p.tilt);
      mesh.position.y = Math.sin(p.tilt) * C.PIN_HEIGHT * 0.2; // lift base slightly as it falls
    }
  }

  function syncBallMesh() {
    var b = world.ball;
    ballMesh.position.set(b.pos.x, b.pos.y, b.pos.z);
    // Roll the ball visually based on travel.
    var dist = Phys.vec(b.vel.x, 0, b.vel.z);
    var speed = Math.sqrt(dist.x * dist.x + dist.z * dist.z);
    if (speed > 0.01) {
      ballMesh.rotation.x += speed * 0.016 / C.BALL_RADIUS;
    }
  }

  // ---- Aim guide update ----------------------------------------------------
  function updateAimGuide() {
    var visible = state === STATE.AIM || state === STATE.POWER;
    aimLine.visible = visible;
    if (!visible) return;
    var pts = [];
    var x = input.aimX;
    var vx = input.dirX * 8;
    var spin = input.spin * 2.2;
    var segs = 30;
    for (var s = 0; s <= segs; s++) {
      var z = (C.FOUL_LINE_Z - 0.6) + (s / segs) * (C.PIN_DECK_Z - C.FOUL_LINE_Z + 1.0);
      var travel = Math.max(0, z);
      // Mirror physics hook curve roughly for the guide.
      var curve = spin * 0.5 * Math.pow(travel / C.PIN_DECK_Z, 2) * 2.0;
      var px = x + vx * (travel / C.PIN_DECK_Z) * 0.3 + curve;
      px = Math.max(-C.LANE_HALF_WIDTH, Math.min(C.LANE_HALF_WIDTH, px));
      pts.push(new THREE.Vector3(px, 0.06, z));
    }
    aimLine.geometry.setFromPoints(pts);
    aimLine.computeLineDistances();
    // Colour shifts with power.
    aimMat.color.setHSL(0.45 - input.power * 0.45, 1, 0.5);
  }

  // ---- Power meter update --------------------------------------------------
  function updatePowerMeter() {
    if (state === STATE.POWER && input.charging) {
      // Oscillating power meter for skill-based timing.
      var elapsed = (performance.now() - input.chargeStart) / 1000;
      input.power = (Math.sin(elapsed * 3.0 - Math.PI / 2) + 1) / 2;
    }
    powerFillEl.style.width = (input.power * 100).toFixed(0) + "%";
    // Spin indicator.
    var spinPct = (input.spin + 1) / 2 * 100;
    spinFillEl.style.left = spinPct.toFixed(0) + "%";
    document.getElementById("power-meter").style.opacity =
      state === STATE.POWER ? "1" : "0.25";
  }

  // ---- Main loop -----------------------------------------------------------
  var lastTime = performance.now();
  var physicsAccumulator = 0;
  var PHYS_DT = 1 / 120;

  function loop() {
    requestAnimationFrame(loop);
    var now = performance.now();
    var dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    // Fixed-step physics while a throw is live.
    if (state === STATE.THROW) {
      physicsAccumulator += dt;
      var crashed = false;
      var prevStanding = Phys.countStanding(world);
      while (physicsAccumulator >= PHYS_DT) {
        Phys.step(world, PHYS_DT);
        physicsAccumulator -= PHYS_DT;
      }
      var nowStanding = Phys.countStanding(world);
      if (nowStanding < prevStanding) {
        playCrash();
      }
      syncBallMesh();
      syncPinMeshes(false);

      if (Phys.isResting(world)) {
        state = STATE.SETTLE;
        settleTimer = 0.6; // let pins fully settle visually
      }
    } else if (state === STATE.SETTLE) {
      physicsAccumulator += dt;
      while (physicsAccumulator >= PHYS_DT) {
        Phys.step(world, PHYS_DT);
        physicsAccumulator -= PHYS_DT;
      }
      syncBallMesh();
      syncPinMeshes(false);
      settleTimer -= dt;
      if (settleTimer <= 0) {
        resolveThrow();
      }
    } else if (state === STATE.BETWEEN) {
      if (betweenTimer > 0) {
        betweenTimer -= dt;
        if (betweenTimer <= 0 && !game.over) {
          nextBall();
        } else if (betweenTimer <= 0 && game.over) {
          nextBall(); // shows game over message
        }
      }
    }

    // Animate logo strip glow.
    logoStrip.material.emissiveIntensity = 0.9 + Math.sin(now * 0.003) * 0.4;

    updatePowerMeter();
    updateAimGuide();
    updateCamera(dt);

    // Keep ball positioned at aim point when idle.
    if (state === STATE.AIM || state === STATE.POWER) {
      world.ball.pos.x = input.aimX;
      world.ball.pos.z = C.FOUL_LINE_Z - 0.8;
      world.ball.pos.y = C.BALL_RADIUS;
      syncBallMesh();
    }

    if (messageTimer > 0) {
      messageTimer -= dt;
      if (messageTimer <= 0) {
        messageEl.className = "message";
      }
    }

    renderer.render(scene, camera);
  }

  var settleTimer = 0;

  // ---- Boot ----------------------------------------------------------------
  buildScoreboard();
  updateScoreboard();
  syncPinMeshes(true);
  camera.position.set(camDefault.x, camDefault.y, camDefault.z);
  camera.lookAt(0, 0.4, 10);
  loop();

  // Expose for headless smoke-testing.
  window.__bowl = {
    get state() { return state; },
    get game() { return game; },
    get world() { return world; },
    throwAt: function (aimX, dirX, power, spin) {
      if (state !== STATE.AIM) return false;
      input.aimX = aimX;
      input.dirX = dirX || 0;
      input.power = power == null ? 0.8 : power;
      input.spin = spin || 0;
      state = STATE.POWER;
      input.charging = true;
      input.charging = false;
      // bypass meter oscillation: set power directly then throw
      var savedPower = input.power;
      throwBall();
      input.power = savedPower;
      return true;
    },
    restart: restartGame,
  };
})();
