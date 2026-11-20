// Interactive 3D spine for the landing page: scroll moves the camera through the anatomy,
// drag spins the model, tap a part to name it, chips switch layers on and off.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const stage = document.getElementById('stage');
const canvas = document.getElementById('spine3d');
const loadEl = document.getElementById('load');
const tip = document.getElementById('tip');
const steps = [...document.querySelectorAll('.step')];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) { stage.classList.add('nogl'); throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);

scene.add(new THREE.HemisphereLight(0xdfefff, 0x0a0e13, 0.6));
const key = new THREE.DirectionalLight(0xfff3e0, 2.2); key.position.set(2, 3, 3); scene.add(key);
const rim = new THREE.DirectionalLight(0x5fd3e6, 2.4); rim.position.set(-3, 1, -2.5); scene.add(rim);

// ---- look per group (red is only ever used for the pain pulse) ----
const LOOK = {
  bone:   { color: 0xf1e6d2, roughness: .55, metalness: 0, clearcoat: .3 },
  disc:   { color: 0x9ec9e8, roughness: .25, metalness: 0, transmission: .25, clearcoat: .8, transparent: true },
  nuc:    { color: 0xf3c9a0, roughness: .4, metalness: 0 },
  nerve:  { color: 0xf2d27a, roughness: .35, metalness: 0, emissive: 0x6b4a00, emissiveIntensity: .35 },
  muscle: { color: 0xd98ca6, roughness: .5, metalness: 0, transparent: true, sheen: 1, sheenColor: 0xffc2d4 },
};
const groupOf = n =>
  /^(V_|SACRUM|PELVIS|FEMUR_)/.test(n) ? 'bone' : /^DISC_/.test(n) ? 'disc' : /^NUC_/.test(n) ? 'nuc'
  : /^(ROOT_|SCIATIC_|DRG_|CAUDA_)/.test(n) ? 'nerve' : /^M_/.test(n) ? 'muscle' : null;

const NAMES = {
  V_T12: ['T12 vertebra', 'The last vertebra of the mid-back, sitting on top of the lumbar spine.'],
  V_L1: ['L1 vertebra', 'The first of five lumbar vertebrae.'], V_L2: ['L2 vertebra', 'One of the five lumbar vertebrae.'],
  V_L3: ['L3 vertebra', 'One of the five lumbar vertebrae.'], V_L4: ['L4 vertebra', 'One of the two lowest lumbar vertebrae, where many scan findings are reported.'],
  V_L5: ['L5 vertebra', 'The lowest lumbar vertebra, resting on the sacrum.'],
  SACRUM: ['Sacrum', 'The triangular bone at the base of the spine, wedged into the pelvis.'],
  FEMUR: ['Thigh bone (femur)', 'The sciatic nerve runs down behind it, towards the knee.'],
  PELVIS: ['Pelvis', 'The pelvis and spine move together when you bend, sit and walk.'],
  DISC: ['Intervertebral disc', 'A tough outer ring around a soft centre, between two vertebrae.'],
  NUC: ['Disc centre (nucleus)', 'The soft, gel-like centre of the disc.'],
  ROOT: ['Nerve root', 'Leaves the spine through a small gap beside each disc.'],
  DRG: ['Nerve root ganglion', 'A small swelling on the nerve root, just outside the spine.'],
  CAUDA: ['Cauda equina', 'The bundle of nerve roots running down inside the lower spinal canal.'],
  SCIATIC: ['Sciatic nerve', 'Formed from lower-back nerve roots, it runs down the back of the leg.'],
  M_ERECTOR: ['Erector spinae', 'Long muscles either side of the spine that help you straighten up.'],
  M_MULTIFIDUS: ['Multifidus', 'Small deep muscles that link one vertebra to the next.'],
  M_PSOAS: ['Psoas', 'A deep muscle running from the lumbar spine to the thigh bone.'],
  M_QL: ['Quadratus lumborum', 'A deep muscle between the lowest rib, the spine and the pelvis.'],
};
const nameFor = n => {
  if (NAMES[n]) return NAMES[n];
  const k = Object.keys(NAMES).find(k => n.startsWith(k));
  if (!k) return null;
  const [t, d] = NAMES[k];
  const lvl = n.match(/_(L\d|S\d|T12)(L\d|S\d)?/);
  const side = /_L$/.test(n) ? ' (left)' : /_R$/.test(n) ? ' (right)' : '';
  const where = lvl ? (lvl[2] ? ` ${lvl[1]}–${lvl[2]}` : ` ${lvl[1]}`) : '';
  return [t + where + side, d];
};

const PAIN = new THREE.Color(0xe5484d), NERVE = new THREE.Color(LOOK.nerve.color);
const parts = [];           // {mesh, group, name, mat}
const model = new THREE.Group(); scene.add(model);
const spin = new THREE.Group(); model.add(spin);

// chapter: camera view + which layers show + how see-through bones are
const BOX = {};
const CH = [
  { look: 'spine', dir: [0.9, 0.25, 1], fit: 1.25, show: { bone: 1, disc: 1, nuc: 1, nerve: 1, muscle: 0 } },
  { look: 'lumbar', dir: [1, 0.15, 0.25], fit: 1.15, show: { bone: 1, disc: .9, nuc: 1, nerve: .25, muscle: 0 }, hi: 'bone' },
  { look: 'disc', dir: [0.35, 0.9, 0.9], fit: 2.2, show: { bone: .22, disc: 1, nuc: 1, nerve: .5, muscle: 0 }, hi: 'disc' },
  { look: 'roots', dir: [-0.4, 0.2, -1], fit: 1.6, show: { bone: .3, disc: .5, nuc: .6, nerve: 1, muscle: 0 }, hi: 'nerve' },
  { look: 'legs', dir: [-0.6, 0.15, -1], fit: 1.05, show: { bone: .45, disc: .6, nuc: .6, nerve: 1, muscle: 0 }, pain: 1 },
  { look: 'spine', dir: [-0.7, 0.2, -1], fit: 1.3, show: { bone: 1, disc: 1, nuc: 1, nerve: .6, muscle: .9 }, hi: 'muscle' },
];
const layerOn = { bone: 1, disc: 1, nuc: 1, nerve: 1, muscle: 1 };

const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
new GLTFLoader().setDRACOLoader(draco).load('model/spine.glb?v=4', gltf => {
  const root = gltf.scene;
  root.traverse(o => {
    if (!o.isMesh) return;
    const name = o.name.replace(/\.\d+$/, '') || o.parent?.name;
    const n = groupOf(name) ? name : (o.parent?.name ?? name);
    const g = groupOf(n); if (!g) { o.visible = false; return; }
    const mat = new THREE.MeshPhysicalMaterial({ ...LOOK[g], transparent: true });
    o.material = mat; o.userData.part = n;
    parts.push({ mesh: o, group: g, name: n, mat, base: mat.color.clone(), op: 1, lvl: n.match(/(L4|L5|S1)/) });
  });
  spin.add(root);
  root.updateMatrixWorld(true);
  const box = sel => { const b = new THREE.Box3(); parts.filter(sel).forEach(p => b.expandByObject(p.mesh)); return b; };
  const spineB = box(p => p.group === 'bone' && !/^(PELVIS|FEMUR_)/.test(p.name));
  const c = spineB.getCenter(new THREE.Vector3());
  root.position.sub(c);                          // spin around the spine's own centre
  root.updateMatrixWorld(true);
  BOX.spine = box(p => p.group === 'bone' && !/^FEMUR_/.test(p.name));
  BOX.lumbar = box(p => /^V_/.test(p.name));
  BOX.disc = box(p => p.name === 'DISC_L4L5');
  BOX.roots = box(p => /^(ROOT_L[45]|ROOT_S1|DRG_L[45])/.test(p.name) || p.name === 'DISC_L4L5');
  BOX.legs = box(p => /^(SCIATIC_|SACRUM|PELVIS|FEMUR_)/.test(p.name));
  window.__tour = { step: () => curStep };
  loadEl.classList.add('done');
  stage.classList.add('ready');
  resize(); goTo(curStep, true);
}, xhr => { if (xhr.total) loadEl.querySelector('b').textContent = Math.min(99, Math.round(xhr.loaded / xhr.total * 100)) + '%'; },
() => { stage.classList.add('nogl'); });

// ---- camera rig: eased toward the current chapter ----
const camPos = new THREE.Vector3(0, 0, 3), camTgt = new THREE.Vector3(), wantPos = new THREE.Vector3(0, 0, 3), wantTgt = new THREE.Vector3();
let curStep = 0;
function framing(i) {
  const ch = CH[i], b = BOX[ch.look]; if (!b) return;
  const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  const r = Math.max(s.x, s.y, s.z) * 0.5 * ch.fit;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const fitH = r / Math.tan(fov / 2), fitW = r / (Math.tan(fov / 2) * camera.aspect);
  const d = Math.max(fitH, fitW) * 1.05;
  const dir = new THREE.Vector3(...ch.dir).normalize();
  wantTgt.copy(c);
  wantPos.copy(c).addScaledVector(dir, d);
}
function goTo(i, snap) {
  curStep = i; framing(i);
  steps.forEach((s, k) => s.classList.toggle('on', k === i));
  document.querySelectorAll('.dots i').forEach((d, k) => d.classList.toggle('on', k === i));
  if (snap) { camPos.copy(wantPos); camTgt.copy(wantTgt); }
  tip.classList.remove('show');
}

// scroll picks the chapter whose card is nearest the viewport middle
const io = new IntersectionObserver(es => {
  es.forEach(e => { if (e.isIntersecting) goTo(+e.target.dataset.i); });
}, { rootMargin: '-45% 0px -45% 0px' });
steps.forEach(s => io.observe(s));
document.querySelectorAll('.dots i').forEach((d, k) => d.addEventListener('click', () => steps[k].scrollIntoView({ behavior: 'smooth', block: 'center' })));

// ---- drag to spin (horizontal only, so the page still scrolls on phones) ----
let yaw = 0, pitch = 0, vYaw = reduce ? 0 : 0.0025, dragging = false, lx = 0, ly = 0, moved = 0, idle = 0;
canvas.addEventListener('pointerdown', e => { dragging = true; lx = e.clientX; ly = e.clientY; moved = 0; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
  vYaw = dx * 0.006; yaw += vYaw;
  if (e.pointerType === 'mouse') pitch = THREE.MathUtils.clamp(pitch + dy * 0.004, -0.5, 0.5);
  idle = 0; stage.classList.add('touched');
});
canvas.addEventListener('pointerup', e => { dragging = false; if (moved < 6) pick(e); });
canvas.addEventListener('pointercancel', () => { dragging = false; });

// ---- tap a part to name it ----
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let picked = null;
function pick(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(parts.filter(p => p.mesh.visible && p.op > .35).map(p => p.mesh), false);
  if (!hits.length) { tip.classList.remove('show'); picked = null; return; }
  const p = parts.find(q => q.mesh === hits[0].object); const nm = nameFor(p.name); if (!nm) return;
  picked = p; tip.innerHTML = `<b>${nm[0]}</b>${nm[1]}`;
  tip.style.left = Math.min(r.width - 250, Math.max(10, e.clientX - r.left + 14)) + 'px';
  tip.style.top = Math.max(10, e.clientY - r.top - 20) + 'px';
  tip.classList.add('show');
}

// ---- layer chips ----
document.querySelectorAll('.chips button').forEach(b => b.addEventListener('click', () => {
  const g = b.dataset.g; const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', on); layerOn[g] = on ? 1 : 0; if (g === 'disc') layerOn.nuc = layerOn.disc;
}));

// ---- frame loop ----
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  // desktop: the copy is on the left, so push the model right; phone: the copy is at the bottom, so lift the model
  if (w >= 860) camera.setViewOffset(w, h, -w * 0.17, 0, w, h); else camera.setViewOffset(w, h, 0, h * 0.17, w, h);
  camera.updateProjectionMatrix(); framing(curStep);
}
addEventListener('resize', resize);
const clock = new THREE.Clock(); let visible = true;
new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(stage);
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
  if (!visible || !parts.length) return;
  idle += dt;
  if (!dragging) { vYaw *= 0.95; if (!reduce && idle > 2.5) vYaw += (0.0022 - vYaw) * 0.02; yaw += vYaw; }
  spin.rotation.y = yaw; spin.rotation.x += (pitch - spin.rotation.x) * 0.1;
  const k = 1 - Math.pow(0.0015, dt);
  camPos.lerp(wantPos, k); camTgt.lerp(wantTgt, k);
  camera.position.copy(camPos); camera.lookAt(camTgt);
  const ch = CH[curStep], pain = ch.pain ? 0.5 + 0.5 * Math.sin(t * 4.2) : 0;
  for (const p of parts) {
    let want = (ch.show[p.group] ?? 1) * layerOn[p.group];
    if (/^FEMUR_/.test(p.name)) want = ch.pain ? want : 0;
    p.op += (want - p.op) * k;
    p.mesh.visible = p.op > 0.02;
    p.mat.opacity = p.group === 'disc' ? Math.min(p.op, .92) : p.op;
    p.mat.depthWrite = p.op > 0.95;
    const hi = ch.hi === p.group || (ch.hi === 'disc' && p.group === 'nuc');
    if (p.group === 'nerve') {
      const along = ch.pain && /^(SCIATIC|ROOT_L5|ROOT_S1)/.test(p.name);
      p.mat.color.copy(NERVE).lerp(PAIN, along ? pain * 0.85 : 0);
      p.mat.emissive.set(along ? 0x5a0d10 : 0x6b4a00); p.mat.emissiveIntensity = along ? 0.4 + pain : (hi ? .6 : .35);
    } else if ('emissive' in p.mat) {
      p.mat.emissive.set(0x5fd3e6); p.mat.emissiveIntensity += ((hi ? 0.12 + 0.06 * Math.sin(t * 2.4) : 0) - p.mat.emissiveIntensity) * k;
    }
    if (picked === p) { p.mat.emissive.set(0x5fd3e6); p.mat.emissiveIntensity = .45; }
  }
  renderer.render(scene, camera);
});
