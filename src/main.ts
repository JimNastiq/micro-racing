import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, DepthOfFieldEffect, HueSaturationEffect, SMAAEffect, SMAAPreset,
  VignetteEffect, ToneMappingEffect, ToneMappingMode, BrightnessContrastEffect, BloomEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Track } from './track';
import { World, TABLE_HW, TABLE_HD, TABLE_S } from './world';
import { loadAssets } from './assets';
import { Car, TUNING } from './car';
import { Input } from './input';
import { Particles } from './fx';
import { Sfx } from './audio';

// ============================================================ constantes
const LAPS = 4;
const STEP = 1 / 120;
// tracé relevé sur le circuit peint de la table (coordonnées du modèle), départ au damier peint
const PAINTED: [number, number][] = [
  [0.006, -0.397], [-0.195, -0.397], [-0.396, -0.399], [-0.595, -0.379], [-0.734, -0.243], [-0.753, -0.044],
  [-0.745, 0.156], [-0.63, 0.311], [-0.432, 0.31], [-0.233, 0.283], [-0.034, 0.25], [0.166, 0.238],
  [0.353, 0.307], [0.546, 0.335], [0.693, 0.206], [0.719, 0.009], [0.711, -0.192], [0.601, -0.353],
  [0.407, -0.397], [0.206, -0.398],
];
const TRACK_POINTS: [number, number][] = PAINTED.map(([x, z]) => [x * TABLE_S, z * TABLE_S]);

// ============================================================ rendu
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9d8bf);
scene.fog = new THREE.Fog(0xe9d8bf, 380, 1100);

const camera = new THREE.PerspectiveCamera(36, 1, 1, 2500);

// reflets : environnement « pièce » pré-calculé (peinture laquée, chrome, céramique)
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.4;
  pmrem.dispose();
}

// lumière de fin d'après-midi
const hemi = new THREE.HemisphereLight(0xfff1dc, 0x7a5a3c, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe0b0, 2.3);
sun.castShadow = true;
sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.3;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xbfd8ff, 0.5);
fill.position.set(-100, 80, 120);
scene.add(fill);

// ============================================================ monde
const track = new Track(TRACK_POINTS);
let world!: World;
const car = new Car(0xe23b3b);
scene.add(car.mesh);
const particles = new Particles(scene, 600);
const sfx = new Sfx();
const input = new Input();

// ============================================================ post-traitement (tilt-shift)
let composer: EffectComposer | null = null;
let dof: DepthOfFieldEffect | null = null;
let ao: N8AOPostPass | null = null;
// point de mise au point : toujours la voiture (comme un objectif macro)
const focusPoint = new THREE.Vector3();
function buildComposer(q: 1 | 2) {
  composer?.dispose();
  const w = window.innerWidth, h = window.innerHeight;
  composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: q === 2 ? 4 : 0 });
  composer.addPass(new RenderPass(scene, camera));
  // occlusion ambiante : ombres de contact sous les objets et la voiture
  ao = new N8AOPostPass(scene, camera, w, h);
  ao.configuration.aoRadius = 3.5;
  ao.configuration.distanceFalloff = 1.0;
  ao.configuration.intensity = 2.2;
  ao.configuration.halfRes = q === 1;
  ao.configuration.gammaCorrection = false;
  ao.setQualityMode(q === 2 ? 'Medium' : 'Performance');
  composer.addPass(ao);
  // profondeur de champ (effet miniature) focalisée sur la voiture
  dof = new DepthOfFieldEffect(camera, { focusRange: 30, bokehScale: q === 2 ? 3 : 2.5, resolutionScale: 0.5 });
  dof.target = focusPoint;
  composer.addPass(new EffectPass(camera,
    dof,
    new BloomEffect({ intensity: 0.35, luminanceThreshold: 0.85, luminanceSmoothing: 0.2, mipmapBlur: true }),
    new HueSaturationEffect({ saturation: 0.06 }),
    new BrightnessContrastEffect({ brightness: -0.02, contrast: 0.1 }),
    new VignetteEffect({ offset: 0.32, darkness: 0.4 }),
    new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
  ));
  // anti-crénelage final (en plus du MSAA en qualité haute)
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: q === 2 ? SMAAPreset.HIGH : SMAAPreset.MEDIUM })));
  resize();
}

// ============================================================ qualité
type Quality = 0 | 1 | 2; // basse, moyenne, haute
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let qualitySetting: 'auto' | Quality = 'auto';
let quality: Quality = isTouchDevice ? 1 : 2;
function applyQuality(q: Quality) {
  quality = q;
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(q === 2 ? Math.min(dpr, 2) : q === 1 ? Math.min(dpr, 1.5) : 1);
  const sm = q === 2 ? 2048 : q === 1 ? 1024 : 512;
  sun.shadow.mapSize.set(sm, sm);
  sun.shadow.map?.dispose();
  (sun.shadow as any).map = null;
  if (q === 0) {
    composer?.dispose(); composer = null; dof = null; ao = null;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  } else {
    renderer.toneMapping = THREE.NoToneMapping;
    buildComposer(q);
  }
  resize();
  const el = document.getElementById('qualityLabel');
  if (el) el.textContent = qualitySetting === 'auto' ? `Auto (${['basse', 'moyenne', 'haute'][q]})` : ['Basse', 'Moyenne', 'Haute'][q];
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer?.setSize(w, h);
  ao?.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ============================================================ état de la course
type State = 'menu' | 'countdown' | 'race' | 'finished' | 'paused';
let state: State = 'menu';
let pausedFrom: State = 'race';
let countdown = 0;
let raceTime = 0, lapStart = 0, lap = 1;
let lapTimes: number[] = [];
let trackIdx = 0, lastSafe = 0;
const sectors = [false, false, false];
let startPressAt = -1; // instant (compte à rebours restant) du premier appui accélérateur
let stallTime = 0;
let camMode = 0;
let shake = 0;
let best = loadNum('pr_best_lap');
let bestRace = loadNum('pr_best_race');

function loadNum(k: string): number | null {
  try { const v = localStorage.getItem(k); return v ? parseFloat(v) : null; } catch { return null; }
}
function saveNum(k: string, v: number) { try { localStorage.setItem(k, String(v)); } catch {} }

const $ = (id: string) => document.getElementById(id)!;
const fmt = (t: number) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

let msgTimer = 0;
function message(text: string, dur = 1.2, cls = '') {
  const el = $('hudMsg');
  el.textContent = text;
  el.className = 'show ' + cls;
  msgTimer = dur;
}

function show(id: string | null) {
  for (const s of ['menu', 'pause', 'results']) $(s).classList.toggle('hidden', s !== id);
  $('hud').classList.toggle('hidden', id === 'menu');
  document.body.classList.toggle('playing', id === null);
}

function resetRace() {
  const p = track.at(-0.012, 0);
  car.place(p.x, p.z, p.heading, track.roadTop);
  trackIdx = lastSafe = p.i;
  sectors.fill(false);
  raceTime = 0; lapStart = 0; lap = 1; lapTimes = [];
  countdown = 3.2; startPressAt = -1; stallTime = 0;
  car.frozen = true;
  state = 'countdown';
  snapCamera();
  show(null);
  updateHud();
}

function respawn() {
  const s = track.samples[lastSafe];
  const h = Math.atan2(s.tx, s.tz);
  car.place(s.x, s.z, h, track.roadTop);
  car.blink = 1.0;
  trackIdx = lastSafe;
}

function finishRace() {
  state = 'finished';
  car.frozen = true;
  const total = raceTime;
  let newRecord = false;
  if (bestRace === null || total < bestRace) { bestRace = total; saveNum('pr_best_race', total); newRecord = true; }
  const bl = Math.min(...lapTimes);
  $('resTotal').textContent = fmt(total) + (newRecord ? '  ★ record !' : '');
  $('resLaps').innerHTML = lapTimes.map((t, i) => `<li class="${t === bl ? 'best' : ''}">Tour ${i + 1} — ${fmt(t)}</li>`).join('');
  $('resBest').textContent = bestRace !== null ? `Meilleure course : ${fmt(bestRace)} · Meilleur tour : ${best !== null ? fmt(best) : '—'}` : '';
  setTimeout(() => { if (state === 'finished') show('results'); }, 1200);
  message('ARRIVÉE !', 1.5, 'big');
}

// ============================================================ simulation
function simulate(dt: number) {
  if (state === 'countdown') {
    const prev = countdown;
    countdown -= dt;
    // départ turbo : appuyer sur l'accélérateur juste avant le « GO »
    if (input.lastDevice !== 'touch' && input.throttle > 0.5 && startPressAt < 0) startPressAt = countdown;
    for (const k of [3, 2, 1]) if (prev > k && countdown <= k) { message(String(k), 0.8, 'big'); sfx.beep(false); }
    if (countdown <= 0) {
      state = 'race';
      car.frozen = false;
      message('GO !', 0.9, 'big go');
      sfx.beep(true);
      if (startPressAt > 0 && startPressAt < 1.0) { car.boostTime = 0.9; message('DÉPART TURBO !', 1.2, 'big go'); sfx.boost(2); }
      else if (startPressAt > 1.8) { stallTime = 0.7; message('CALÉ…', 1, 'big'); }
    }
  }
  if (state === 'race') {
    raceTime += dt;
    if (stallTime > 0) { stallTime -= dt; car.frozen = stallTime > 0; }
  }

  car.step(dt, input, world);

  // progression sur le circuit
  if (!car.falling) {
    const n = track.nearest(car.x, car.z, trackIdx);
    const onTable = Math.abs(car.x) < TABLE_HW && Math.abs(car.z) < TABLE_HD;
    car.offTrack = onTable && Math.abs(n.lateral) > track.halfWidth + 0.3;
    if (n.dist < track.halfWidth * 3) {
      const N = track.N, prev = trackIdx;
      trackIdx = n.i;
      const f = trackIdx / N;
      if (f >= 0.25 && f < 0.5) sectors[0] = true;
      if (f >= 0.5 && f < 0.75 && sectors[0]) sectors[1] = true;
      if (f >= 0.75 && sectors[1]) sectors[2] = true;
      if (prev > N * 0.85 && trackIdx < N * 0.15 && state === 'race') {
        if (sectors[2]) completeLap();
        sectors.fill(false);
      }
      if (car.onGround && Math.abs(n.lateral) < track.halfWidth + 2 && world.surfaceAt(car.x, car.z) === null && car.y < 1 && track.hasWall(n.i, 1) && track.hasWall(n.i, -1)) lastSafe = n.i;
    }
  }
  if (car.falling && car.fallTime > 1.3) respawn();
}

function completeLap() {
  const t = raceTime - lapStart;
  lapTimes.push(t);
  lapStart = raceTime;
  sfx.lap();
  if (best === null || t < best) {
    best = t; saveNum('pr_best_lap', t);
    message(`RECORD DU TOUR ! ${fmt(t)}`, 1.8, 'record');
  } else message(`Tour ${lap} — ${fmt(t)}`, 1.4);
  if (lap >= LAPS) { finishRace(); return; }
  lap++;
  if (lap === LAPS) setTimeout(() => message('DERNIER TOUR !', 1.4, 'big'), 1500);
}

// ============================================================ caméra
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const tmp = new THREE.Vector3();
function desiredCamera(out: THREE.Vector3, look: THREE.Vector3) {
  const sp = car.speed;
  const portrait = camera.aspect < 1;
  if (camMode === 0) {
    // vue du dessus inclinée, orientation fixe (façon Micro Machines)
    look.set(car.x + car.vx * 0.32, Math.max(car.y, -60) * 0.85, car.z + car.vz * 0.32);
    const zoom = (1 + Math.min(sp, 110) / TUNING.maxSpeed * 0.18) * (portrait ? 1.55 : 1);
    out.set(look.x, look.y + 64 * zoom, look.z + 46 * zoom);
  } else {
    // caméra poursuite
    const h = car.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    look.set(car.x + fx * 14, car.y + 1, car.z + fz * 14);
    const d = portrait ? 34 : 26;
    out.set(car.x - fx * d, car.y + (portrait ? 24 : 17), car.z - fz * d);
  }
}
function snapCamera() {
  desiredCamera(camPos, camTarget);
}
function updateCamera(dt: number) {
  const look = new THREE.Vector3();
  desiredCamera(tmp, look);
  const k = 1 - Math.exp(-dt * (camMode === 0 ? 5 : 6));
  camPos.lerp(tmp, k);
  camTarget.lerp(look, 1 - Math.exp(-dt * 7));
  camera.position.copy(camPos);
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 2.5);
    camera.position.x += (Math.random() - 0.5) * shake * 2;
    camera.position.y += (Math.random() - 0.5) * shake * 2;
  }
  camera.lookAt(camTarget);
  // l'ombre suit la voiture
  sun.position.set(car.x + 55, car.y + 120, car.z + 35);
  sun.target.position.set(car.x, car.y, car.z);
  world.updateOcclusion(camera, car.mesh.position, dt);
  focusPoint.set(car.x, car.y + 1, car.z);
  if (dof) dof.cocMaterial.focusRange = camMode === 0 ? 30 : 22;
}

// ============================================================ effets
const pv = new THREE.Vector3();
const sparkColors = ['#ffe9a0', '#47c6ff', '#ff8a1f'];
function updateFx(dt: number) {
  for (const e of car.events) {
    switch (e.type) {
      case 'bump': sfx.bump(e.strength); shake = Math.max(shake, e.strength * 1.2); break;
      case 'boost':
        sfx.boost(e.level); shake = Math.max(shake, 0.4);
        message(e.level === 2 ? 'SUPER TURBO !' : 'TURBO !', 0.7, e.level === 2 ? 'orange' : 'blue');
        break;
      case 'land':
        sfx.land(); shake = Math.max(shake, e.strength * 0.8);
        if ((e.air ?? 0) > 0.55 && !car.falling && car.y > -1) {
          car.boostTime = Math.max(car.boostTime, 0.9);
          sfx.boost(2);
          message('ATTERRISSAGE TURBO !', 1.1, 'orange');
        }
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2;
          particles.emit(pv.set(car.x, car.y + 0.3, car.z), new THREE.Vector3(Math.cos(a) * 14, 3, Math.sin(a) * 14), '#efe6d6', 0.45, 0.6, 1.4, 0);
        }
        break;
      case 'fall': sfx.fall(); message('Oups !', 1); break;
    }
  }
  car.events.length = 0;

  const sp = car.speed;
  if (car.onGround && !car.falling) {
    const [l, r] = car.rearWheels();
    if (car.drifting) {
      // fumée + étincelles colorées selon la charge du mini-turbo
      if (Math.random() < 0.6) for (const w of [l, r])
        particles.emit(w, new THREE.Vector3((Math.random() - 0.5) * 4, 3 + Math.random() * 3, (Math.random() - 0.5) * 4), '#e8e4dc', 0.55, 0.5, 1.8, -2);
      const lvl = car.driftLevel;
      if (lvl > 0 || Math.random() < 0.3) {
        const w = car.driftDir > 0 ? l : r;
        for (let i = 0; i < 2; i++)
          particles.emit(w, new THREE.Vector3((Math.random() - 0.5) * 20 - car.vx * 0.3, 6 + Math.random() * 8, (Math.random() - 0.5) * 20 - car.vz * 0.3), sparkColors[lvl], 0.25, 0.35, 0.1, 50);
      }
    }
    if (car.surface === 'slip' && sp > 20 && Math.random() < 0.7)
      particles.emit(l, new THREE.Vector3((Math.random() - 0.5) * 8, 8 + Math.random() * 6, (Math.random() - 0.5) * 8), '#ffffff', 0.4, 0.5, 0.2, 60);
    if (car.surface === 'slow' && sp > 10 && Math.random() < 0.6)
      particles.emit(r, new THREE.Vector3((Math.random() - 0.5) * 10, 6 + Math.random() * 6, (Math.random() - 0.5) * 10), '#5a3418', 0.5, 0.35, 0.15, 50);
  }
  if (car.boostTime > 0) {
    const ex = car.exhaust();
    for (let i = 0; i < 2; i++)
      particles.emit(ex, new THREE.Vector3(-car.vx * 0.2 + (Math.random() - 0.5) * 4, 1 + Math.random() * 2, -car.vz * 0.2 + (Math.random() - 0.5) * 4),
        Math.random() < 0.5 ? '#ffb020' : '#ff6a10', 0.22, 0.7, 0.1, -4);
  }
  particles.update(dt);

  // sons continus
  const active = state === 'race' || state === 'countdown' || state === 'finished';
  sfx.engine(sp, input.throttle, car.boostTime > 0, active && !car.falling);
  const slip = car.onGround && !car.falling ? (car.drifting ? 1 : 0) + (car.surface === 'slip' && sp > 25 ? 0.5 : 0) : 0;
  sfx.skid(active ? slip : 0);
}

// ============================================================ HUD
function updateHud() {
  $('hudLap').innerHTML = `TOUR <b>${Math.min(lap, LAPS)}</b>/${LAPS}`;
  $('hudTime').textContent = fmt(state === 'countdown' ? 0 : raceTime);
  $('hudLapTime').textContent = 'Tour : ' + fmt(state === 'race' ? raceTime - lapStart : 0);
  $('hudBest').textContent = 'Record : ' + (best !== null ? fmt(best) : '—');
  const lvl = car.drifting ? car.driftLevel : 0;
  const g = $('driftGauge');
  g.style.width = `${Math.min(1, car.driftCharge / TUNING.driftLvl2) * 100}%`;
  g.className = 'lvl' + lvl;
  $('driftWrap').classList.toggle('on', car.drifting);
}

// ============================================================ menus
function startGame(e?: Event) {
  sfx.init();
  if (e && (e as PointerEvent).pointerType === 'touch') { input.touchActive = true; input.lastDevice = 'touch'; refreshTouchUi(); }
  resetRace();
}
$('btnPlay').addEventListener('click', (e) => { if (ready) startGame(e); });
$('btnRetry').addEventListener('click', startGame);
$('btnMenu').addEventListener('click', () => { state = 'menu'; show('menu'); });
$('btnResume').addEventListener('click', () => togglePause());
$('btnRestart').addEventListener('click', startGame);
$('btnQuit').addEventListener('click', () => { state = 'menu'; show('menu'); });
$('btnQuality').addEventListener('click', () => {
  const order: ('auto' | Quality)[] = ['auto', 2, 1, 0];
  qualitySetting = order[(order.indexOf(qualitySetting) + 1) % order.length];
  applyQuality(qualitySetting === 'auto' ? (isTouchDevice ? 1 : 2) : qualitySetting);
});
$('btnSound').addEventListener('click', () => {
  sfx.init();
  sfx.setMuted(!sfx.muted);
  $('btnSound').textContent = sfx.muted ? 'Son : coupé' : 'Son : activé';
});
$('btnFull').addEventListener('click', () => {
  const d = document.documentElement as any;
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d)?.catch?.(() => {});
  } catch {}
});
$('tPause').addEventListener('click', () => togglePause());
$('tCam').addEventListener('click', () => { camMode = 1 - camMode; });
$('tReset').addEventListener('click', () => { if (state === 'race') respawn(); });

function togglePause() {
  if (state === 'paused') { state = pausedFrom; show(null); }
  else if (state === 'race' || state === 'countdown') { pausedFrom = state; state = 'paused'; show('pause'); }
}
document.addEventListener('visibilitychange', () => { if (document.hidden && (state === 'race' || state === 'countdown')) togglePause(); });

input.bindTouch($('stickZone'), $('stickKnob'), $('stickBase'), $('btnDrift'), $('btnBrake'));
function refreshTouchUi() {
  document.body.classList.toggle('touch', input.lastDevice === 'touch');
  $('helpKeys').classList.toggle('hidden', input.lastDevice !== 'keyboard');
  $('helpPad').classList.toggle('hidden', input.lastDevice !== 'gamepad');
  $('helpTouch').classList.toggle('hidden', input.lastDevice !== 'touch');
}
input.onDeviceChange = refreshTouchUi;
if (isTouchDevice && !matchMedia('(pointer: fine)').matches) { input.lastDevice = 'touch'; }
refreshTouchUi();
$('btnFull').classList.toggle('hidden', !isTouchDevice);

// ============================================================ boucle principale
let last = performance.now();
let acc = 0;
let fpsAcc = 0, fpsFrames = 0, fpsChecks = 0;
let ready = false;
function frame(now: number) {
  requestAnimationFrame(frame);
  if (!ready) { renderer.render(scene, camera); return; }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.poll();

  if (input.pause && state !== 'menu' && state !== 'finished') togglePause();
  if (input.confirm) {
    if ((state === 'menu' && ready) || (state === 'finished' && !$('results').classList.contains('hidden'))) startGame();
    else if (state === 'paused') togglePause();
  }
  if (input.camera) camMode = 1 - camMode;
  if (input.respawn && state === 'race' && !car.falling) respawn();

  if (state === 'countdown' || state === 'race' || state === 'finished') {
    acc += dt;
    while (acc >= STEP) { simulate(STEP); acc -= STEP; }
  } else acc = 0;

  if (state === 'menu') {
    // caméra qui tourne lentement autour de la voiture
    const t = now / 1000 * 0.15;
    camera.position.set(car.x + Math.sin(t) * 70, 38, car.z + Math.cos(t) * 70);
    camera.lookAt(car.x, 0, car.z);
    focusPoint.set(car.x, 1, car.z);
    camPos.copy(camera.position); camTarget.set(car.x, 0, car.z);
    sun.position.set(car.x + 55, 120, car.z + 35);
    sun.target.position.set(car.x, 0, car.z);
  } else if (state !== 'paused') updateCamera(dt);

  if (state !== 'paused') {
    car.updateVisual(dt, state === 'race' || state === 'countdown' ? input : { steer: 0, throttle: 0, brake: 0, drift: false });
    updateFx(dt);
    if (state !== 'menu') updateHud();
  } else sfx.engine(0, 0, false, false);

  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('hudMsg').className = ''; }

  // qualité automatique : on baisse si le jeu rame
  if (qualitySetting === 'auto' && state === 'race' && quality > 0 && fpsChecks < 4) {
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc > 3) {
      const fps = fpsFrames / fpsAcc;
      fpsChecks++;
      if (fps < 45) applyQuality((quality - 1) as Quality);
      fpsAcc = 0; fpsFrames = 0;
    }
  }

  if (composer) composer.render(dt);
  else renderer.render(scene, camera);
}

applyQuality(quality);
show('menu');
camera.position.set(0, 200, 250); camera.lookAt(0, 0, 0);
requestAnimationFrame(frame);

// chargement des modèles 3D puis construction du monde
const btnPlay = $('btnPlay') as HTMLButtonElement;
btnPlay.disabled = true;
loadAssets(isTouchDevice ? 'sd' : 'hd', (p) => { btnPlay.textContent = `CHARGEMENT ${Math.round(p * 100)} %`; }).then((assets) => {
  world = new World(scene, track, assets);
  car.setModel(assets.models.car);
  const p0 = track.at(-0.012, 0);
  car.place(p0.x, p0.z, p0.heading, track.roadTop);
  snapCamera();
  ready = true;
  btnPlay.disabled = false;
  btnPlay.textContent = 'JOUER';
  // compile les shaders tout de suite pour éviter un à-coup au départ
  renderer.compile(scene, camera);
}).catch((err) => {
  console.error(err);
  btnPlay.textContent = 'Erreur de chargement';
});

// accès debug (tests automatisés)
(window as any).__game = { get dof() { return dof; }, get composer() { return composer; }, get ao() { return ao; }, get world() { return world; }, get ready() { return ready; }, get lap() { return lap; }, get lapTimes() { return lapTimes; }, get raceTime() { return raceTime; }, get trackIdx() { return trackIdx; }, car, track, input, get state() { return state; }, resetRace, respawn, simulate, setCam: (m: number) => (camMode = m), applyQuality };
