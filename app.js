import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm";

const artifacts = [
  { name: "青铜礼器", image: "assets/bronze-vessel.jpg", polygon: [[.44,.02],[.56,.02],[.62,.09],[.72,.11],[.78,.28],[.72,.42],[.79,.5],[.74,.73],[.68,.94],[.33,.94],[.25,.76],[.22,.55],[.29,.42],[.24,.26],[.34,.1]] },
  { name: "人面纹方鼎", image: "assets/human-face-ding.jpg", polygon: [[.36,.07],[.42,.04],[.44,.16],[.59,.16],[.61,.04],[.67,.08],[.7,.23],[.78,.23],[.82,.38],[.77,.55],[.72,.58],[.75,.79],[.7,.96],[.61,.97],[.59,.75],[.42,.75],[.4,.97],[.3,.96],[.25,.8],[.28,.57],[.2,.53],[.17,.37],[.22,.23],[.32,.22]] },
  { name: "青铜猪形器", image: "assets/pig-shaped-vessel.jpg", polygon: [[.08,.48],[.16,.4],[.28,.37],[.36,.39],[.4,.34],[.46,.29],[.5,.35],[.55,.39],[.68,.39],[.77,.42],[.84,.44],[.9,.38],[.96,.42],[.99,.5],[.95,.56],[.88,.58],[.84,.67],[.79,.79],[.73,.83],[.67,.8],[.62,.72],[.58,.68],[.42,.69],[.36,.82],[.29,.84],[.22,.78],[.19,.65],[.13,.59]] },
  { name: "纹饰陶器", image: "assets/relief-ceramic.jpg", polygon: [[.3,.21],[.7,.21],[.76,.28],[.75,.68],[.8,.78],[.74,.91],[.65,.89],[.62,.83],[.38,.83],[.34,.9],[.25,.91],[.2,.82],[.25,.68],[.24,.29]] },
  { name: "褐釉陶壶", image: "assets/glazed-jar.jpg", polygon: [[.4,.13],[.6,.13],[.65,.21],[.73,.23],[.79,.32],[.85,.44],[.86,.62],[.8,.78],[.74,.84],[.7,.92],[.3,.92],[.26,.84],[.2,.78],[.14,.62],[.15,.44],[.21,.32],[.27,.23],[.35,.21]] },
  { name: "青花瓷瓶", image: "assets/blue-white-vase.jpg", polygon: [[.42,.04],[.58,.04],[.62,.1],[.57,.15],[.57,.29],[.62,.36],[.71,.43],[.78,.54],[.78,.72],[.74,.84],[.68,.91],[.61,.94],[.39,.94],[.32,.91],[.26,.84],[.22,.72],[.22,.54],[.29,.43],[.38,.36],[.43,.29],[.43,.15],[.38,.1]] },
];
const palettes = [0xffffff, 0x69e4e7, 0xffc176, 0x9cd8ff];
const $ = (id) => document.getElementById(id);
const ui = {
  host: $("renderHost"), switcher: $("artifactSwitcher"), index: $("artifactIndex"), name: $("artifactName"),
  gesture: $("gestureState"), hint: $("gestureHint"), status: $("statusText"), statusLine: $("statusLine"),
  camera: $("cameraButton"), cameraText: $("cameraButtonText"), cameraFrame: $("cameraFrame"), video: $("cameraVideo"), toast: $("toast"),
};

let renderer;
let scene;
let camera;
let controls;
let particleGroup;
let particleMesh;
let starField;
let activeArtifact = 0;
let activePalette = 0;
let scatterAmount = 0;
let scatterTarget = 0;
let moveTarget = new THREE.Vector3();
let moveMode = false;
let baseCameraDistance = 10.3;
let landmarker;
let stream;
let inferenceFrame;
let lastInference = 0;
let rawPose = "none";
let candidatePose = "none";
let candidateSince = 0;
let activePose = "none";
let toastTimer;
const clock = new THREE.Clock();

function setStatus(text, gesture = null) {
  ui.status.textContent = text;
  if (gesture !== null) ui.gesture.textContent = gesture;
}

function flash(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove("visible"), 1350);
}

function buildArtifactButtons() {
  artifacts.forEach((artifact, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "artifact-choice";
    button.textContent = artifact.name;
    button.setAttribute("aria-pressed", String(index === activeArtifact));
    button.addEventListener("click", () => selectArtifact(index));
    ui.switcher.append(button);
  });
}

function setActiveArtifact(index) {
  activeArtifact = index;
  ui.index.textContent = `${String(index + 1).padStart(2, "0")} / 06`;
  ui.name.textContent = artifacts[index].name;
  [...ui.switcher.children].forEach((button, buttonIndex) => button.setAttribute("aria-pressed", String(buttonIndex === index)));
}

function selectArtifact(index) {
  const nextIndex = (index + artifacts.length) % artifacts.length;
  setActiveArtifact(nextIndex);
  scatterTarget = 0;
  moveMode = false;
  moveTarget.set(0, 0, 0);
  setStatus("文物粒子已重组", "手势：等待动作");
  createParticleCloud(nextIndex).catch((error) => {
    console.error(error);
    setStatus("文物图片载入失败，请刷新页面", "手势：未就绪");
  });
}

function hueOf(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (!delta) return 0;
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
}

function isExhibitPixel(r, g, b, px, py, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  if (!inside) return false;
  const brightness = (r * .24 + g * .68 + b * .08) / 255;
  if (brightness < .105) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const hue = hueOf(r, g, b);
  const warmBackdrop = hue < 31 || hue > 350;
  if (warmBackdrop && saturation > .28 && r > g * 1.12 && g > b * .98) return false;
  if (px < .09 || px > .91) return false;
  return true;
}

function pointScale() {
  const height = ui.host.clientHeight * renderer.getPixelRatio();
  const worldSize = window.innerWidth < 600 ? .031 : .026;
  return worldSize * height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}

function pixelCloud(image, polygon) {
  const sampleCanvas = document.createElement("canvas");
  const size = 384;
  sampleCanvas.width = size;
  sampleCanvas.height = size;
  const context = sampleCanvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const positions = [];
  const luminance = [];
  const scatter = [];
  const step = 1.5;
  const aspect = image.naturalWidth / image.naturalHeight;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const offset = (y * size + x) * 4;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      if (!isExhibitPixel(r, g, b, x / size, y / size, polygon)) continue;
      const light = (r * .24 + g * .68 + b * .08) / 255;
      const nx = x / size - .5;
      const ny = .5 - y / size;
      const depth = (Math.random() - .5) * (.26 + light * .34);
      positions.push(nx * 5.15 * aspect, ny * 5.15, depth);
      luminance.push(Math.min(1, .68 + light * .42));
      const spreadLength = 1.7 + Math.random() * 2.6;
      const angle = Math.random() * Math.PI * 2;
      const vertical = Math.random() * 2 - 1;
      const radial = Math.sqrt(1 - vertical * vertical);
      scatter.push(Math.cos(angle) * radial * spreadLength, vertical * spreadLength, Math.sin(angle) * radial * spreadLength);
    }
  }
  return { positions: new Float32Array(positions), luminance: new Float32Array(luminance), scatter: new Float32Array(scatter) };
}

async function createParticleCloud(index) {
  const image = new Image();
  image.src = artifacts[index].image;
  await image.decode();
  const data = pixelCloud(image, artifacts[index].polygon);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute("aScatter", new THREE.BufferAttribute(data.scatter, 3));
  geometry.setAttribute("aLuminance", new THREE.BufferAttribute(data.luminance, 1));
  geometry.userData = { luminance: data.luminance };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uScatter: { value: scatterAmount },
      uPointScale: { value: pointScale() },
      uColor: { value: new THREE.Color(palettes[activePalette]) },
    },
    vertexShader: `
      uniform float uScatter;
      uniform float uPointScale;
      attribute vec3 aScatter;
      attribute float aLuminance;
      varying float vLuminance;
      void main() {
        vec3 animatedPosition = position + aScatter * uScatter;
        vec4 viewPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = max(1.0, uPointScale / max(1.0, -viewPosition.z));
        vLuminance = aLuminance;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vLuminance;
      void main() {
        float distanceFromCenter = length(gl_PointCoord - vec2(0.5));
        float glow = 1.0 - smoothstep(0.12, 0.5, distanceFromCenter);
        if (glow < 0.025) discard;
        gl_FragColor = vec4(uColor * min(1.25, vLuminance * 1.2), glow * 0.68);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const nextMesh = new THREE.Points(geometry, material);
  nextMesh.rotation.x = -.05;
  nextMesh.rotation.y = .14;
  nextMesh.frustumCulled = false;
  if (particleMesh) {
    particleGroup.remove(particleMesh);
    particleMesh.geometry.dispose();
    particleMesh.material.dispose();
  }
  particleMesh = nextMesh;
  particleGroup.add(particleMesh);
  setStatus(`${data.luminance.length.toLocaleString()} 个光点已生成`, ui.gesture.textContent);
}

function paintCloud(geometry, paletteIndex) {
  if (particleMesh?.geometry === geometry) particleMesh.material.uniforms.uColor.value.setHex(palettes[paletteIndex]);
}

function setScatter(value, announce = true) {
  scatterTarget = value;
  moveMode = false;
  if (particleMesh) particleMesh.rotation.set(-.05, .14, 0);
  const label = value ? "张开：扩散" : "握拳：聚合";
  ui.gesture.textContent = `手势：${label}`;
  setStatus(value ? "光点向外散开" : "光点重新聚合", `手势：${label}`);
  if (announce) flash(value ? "张开手掌 · 光点扩散" : "握拳 · 光点聚合");
}
function cyclePalette() {
  activePalette = (activePalette + 1) % palettes.length;
  if (particleMesh) paintCloud(particleMesh.geometry, activePalette);
  ui.gesture.textContent = "手势：双指 · 变色";
  setStatus("粒子色彩已切换", "手势：双指 · 变色");
  flash("双指 · 切换流光颜色");
}

function setupScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030507);
  camera = new THREE.PerspectiveCamera(39, 1, .1, 100);
  camera.position.set(0, 0, 10.3);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
  renderer.setClearColor(0x030507, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", "深色展厅中的三维文物粒子，可用手势扩散、聚合、移动和变色");
  ui.host.append(renderer.domElement);
  particleGroup = new THREE.Group();
  scene.add(particleGroup);
  addStarField();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .055;
  controls.enablePan = false;
  controls.minDistance = 7.2;
  controls.maxDistance = 16;
  controls.rotateSpeed = .48;
  resizeRenderer();
  const observer = new ResizeObserver(resizeRenderer);
  observer.observe(ui.host);
}

function addStarField() {
  const positions = [];
  for (let i = 0; i < 850; i++) {
    positions.push((Math.random() - .5) * 25, (Math.random() - .5) * 15, -3 - Math.random() * 9);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0x8298a3, size: .012, transparent: true, opacity: .24, sizeAttenuation: true, depthWrite: false });
  starField = new THREE.Points(geometry, material);
  scene.add(starField);
}

function resizeRenderer() {
  if (!renderer) return;
  const { clientWidth: width, clientHeight: height } = ui.host;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  const portrait = width / height < .78;
  baseCameraDistance = portrait ? 13.8 : 10.3;
  camera.position.z = Math.max(camera.position.z, baseCameraDistance);
  particleGroup?.scale.setScalar(portrait ? .74 : 1);
  camera.updateProjectionMatrix();
  if (particleMesh) particleMesh.material.uniforms.uPointScale.value = pointScale();
}

function renderLoop() {
  requestAnimationFrame(renderLoop);
  const delta = Math.min(clock.getDelta(), .04);
  if (particleMesh) {
    scatterAmount += (scatterTarget - scatterAmount) * Math.min(1, delta * 3.4);
    particleMesh.material.uniforms.uScatter.value = scatterAmount;
    particleMesh.position.lerp(moveTarget, moveMode ? .12 : .08);
    if (scatterTarget === 0 && !moveMode) {
      particleMesh.rotation.y = .14 + Math.sin(clock.elapsedTime * .19) * .045;
      particleMesh.rotation.x = -.05 + Math.sin(clock.elapsedTime * .24) * .035;
    }
  }
  const portrait = camera.aspect < .78;
  const spreadDistance = baseCameraDistance + (portrait ? 11.5 : 9.7);
  camera.position.z += ((scatterTarget > .04 ? spreadDistance : baseCameraDistance) - camera.position.z) * (1 - Math.exp(-delta * 2.4));
  if (starField) starField.rotation.y = Math.sin(clock.elapsedTime * .025) * .015;
  controls?.update();
  renderer?.render(scene, camera);
}

function classifyPose(hand) {
  const fingers = [[8, 6], [12, 10], [16, 14], [20, 18]].map(([tip, pip]) => hand[tip].y < hand[pip].y - .025);
  const extended = fingers.filter(Boolean).length;
  if (extended >= 4) return "open";
  if (extended === 0) return "fist";
  if (fingers[0] && extended === 1) return "move";
  if (fingers[0] && fingers[1] && extended === 2) return "color";
  return "none";
}

function handlePose(pose, now) {
  if (pose !== candidatePose) {
    candidatePose = pose;
    candidateSince = now;
    return;
  }
  if (now - candidateSince < 180 || pose === activePose) return;
  activePose = pose;
  if (pose === "open") setScatter(1);
  else if (pose === "fist") setScatter(0);
  else if (pose === "color") cyclePalette();
  else if (pose === "move") {
    moveMode = true;
    scatterTarget = 0;
    ui.gesture.textContent = "手势：单指 · 移动";
    setStatus("文物跟随食指移动", "手势：单指 · 移动");
    flash("伸出食指 · 移动文物");
  } else {
    moveMode = false;
    moveTarget.set(0, 0, 0);
    if (stream) setStatus("将手放入画面，试试四种手势", "手势：等待动作");
  }
}

function handleHand(result, now) {
  const hand = result.landmarks?.[0];
  if (!hand) {
    handlePose("none", now);
    if (stream && activePose === "none") {
      ui.gesture.textContent = "手势：未检测到";
      setStatus("请让手掌进入右下角摄像头画面", "手势：未检测到");
    }
    return;
  }
  const pose = classifyPose(hand);
  handlePose(pose, now);
  if (pose === "move" && moveMode) {
    const x = THREE.MathUtils.clamp((.5 - hand[8].x) * 5.4, -2.3, 2.3);
    const y = THREE.MathUtils.clamp((.5 - hand[8].y) * 4.1, -1.8, 1.8);
    moveTarget.set(x, y, 0);
  }
}

function inferenceLoop(now) {
  if (!landmarker || !stream) return;
  if (now - lastInference > 90 && ui.video.readyState >= 2) {
    lastInference = now;
    try { handleHand(landmarker.detectForVideo(ui.video, now), now); }
    catch (error) { console.error("Hand detection failed", error); }
  }
  inferenceFrame = requestAnimationFrame(inferenceLoop);
}

async function startCamera() {
  ui.camera.disabled = true;
  ui.cameraText.textContent = "正在启动…";
  ui.gesture.textContent = "手势：初始化中";
  setStatus("正在请求摄像头权限", "手势：初始化中");
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("请在 localhost 或 HTTPS 页面中开启摄像头。");
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
    ui.video.srcObject = stream;
    await ui.video.play();
    setStatus("正在载入手势模型", "手势：初始化中");
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm");
    const modelAssetPath = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
    const options = { runningMode: "VIDEO", numHands: 1, minHandDetectionConfidence: .58, minHandPresenceConfidence: .52, minTrackingConfidence: .52 };
    try {
      landmarker = await HandLandmarker.createFromOptions(vision, { ...options, baseOptions: { modelAssetPath, delegate: "GPU" } });
    } catch {
      landmarker = await HandLandmarker.createFromOptions(vision, { ...options, baseOptions: { modelAssetPath } });
    }
    ui.camera.setAttribute("aria-pressed", "true");
    ui.camera.setAttribute("aria-label", "关闭手势识别");
    ui.cameraText.textContent = "关闭手势";
    ui.cameraFrame.hidden = false;
    ui.statusLine.classList.add("is-live");
    setStatus("将手放入画面，试试四种手势", "手势：等待动作");
    flash("识别就绪 · 张开手掌开始");
    inferenceFrame = requestAnimationFrame(inferenceLoop);
  } catch (error) {
    stopCamera(false);
    const message = error?.name === "NotAllowedError" ? "摄像头权限未允许，可在浏览器设置中开启" : error?.message || "摄像头启动失败，请重试";
    ui.gesture.textContent = "手势：启动失败";
    setStatus(message, "手势：启动失败");
    flash(message);
  } finally {
    ui.camera.disabled = false;
  }
}

function stopCamera(reset = true) {
  if (inferenceFrame) cancelAnimationFrame(inferenceFrame);
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
  landmarker?.close();
  landmarker = undefined;
  ui.video.srcObject = null;
  ui.cameraFrame.hidden = true;
  ui.camera.setAttribute("aria-pressed", "false");
  ui.camera.setAttribute("aria-label", "开启手势识别");
  ui.cameraText.textContent = "开启手势";
  ui.statusLine.classList.remove("is-live");
  if (reset) setStatus("粒子已就绪 · 开启摄像头体验手势", "手势：等待开启");
}

function setupControls() {
  ui.camera.addEventListener("click", () => stream ? stopCamera() : startCamera());
  document.querySelectorAll("[data-effect]").forEach((button) => button.addEventListener("click", () => {
    const effect = button.dataset.effect;
    if (effect === "scatter") setScatter(1);
    if (effect === "gather") setScatter(0);
    if (effect === "color") cyclePalette();
    document.querySelectorAll("[data-effect]").forEach((item) => item.classList.toggle("active", item === button));
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") selectArtifact(activeArtifact + 1);
    if (event.key === "ArrowLeft") selectArtifact(activeArtifact - 1);
    if (/^[1-6]$/.test(event.key)) selectArtifact(Number(event.key) - 1);
    if (event.key === "Escape" && stream) stopCamera();
  });
  window.addEventListener("pagehide", () => stopCamera(false));
}

buildArtifactButtons();
setupControls();
try {
  setupScene();
  await createParticleCloud(activeArtifact);
  renderLoop();
} catch (error) {
  console.error(error);
  setStatus("当前浏览器无法初始化 WebGL，请使用最新版 Chrome 或 Edge", "手势：不可用");
}