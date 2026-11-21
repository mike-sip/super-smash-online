/**
 * Visionneuse d'animations des modèles glTF (`/anim.html?id=sorel`) : liste des clips, lecture,
 * ralenti, image par image, angle de vue. Outil de travail pour animateurs et game designers.
 *
 * Paramètres d'adresse : `id` (personnage), `clip` (clip ouvert), `frame` (frame figée), `angle`.
 * `window.viewer` permet de piloter la vue depuis la console (captures automatisées).
 */
import { parseFighterModel, type FighterModel } from '@game/render';
import {
  AmbientLight,
  AnimationMixer,
  CircleGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type Object3D,
} from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const FPS = 60;
const params = new URLSearchParams(location.search);
const id = params.get('id') ?? 'sorel';

const view = document.getElementById('view')!;
const info = document.getElementById('info')!;
const list = document.getElementById('clips')!;
const title = document.getElementById('title')!;
const play = document.getElementById('play') as HTMLButtonElement;
const scrub = document.getElementById('scrub') as HTMLInputElement;
const speed = document.getElementById('speed') as HTMLSelectElement;
const orbit = document.getElementById('orbit') as HTMLInputElement;

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
view.append(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x232b3d);
scene.add(new HemisphereLight(0xdfe8ff, 0x3a3226, 1.4));
scene.add(new AmbientLight(0xffffff, 0.25));
const sun = new DirectionalLight(0xfff1dc, 2.6);
sun.position.set(2, 4, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
for (const k of ['left', 'bottom'] as const) sun.shadow.camera[k] = -2;
for (const k of ['right', 'top'] as const) sun.shadow.camera[k] = 2;
scene.add(sun);
const ground = new Mesh(
  new CircleGeometry(1.6, 48),
  new MeshStandardMaterial({ color: 0x3a4459, roughness: 0.9 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new GridHelper(3.2, 16, 0x56627e, 0x3a4459);
grid.position.y = 0.001;
scene.add(grid);
const camera = new PerspectiveCamera(32, 1, 0.05, 50);

let model: FighterModel | undefined;
/** Hauteur du modèle dans ses unités (le modèle affiché est ramené à 1). */
let sourceHeight = 1;
let actor: Object3D | undefined;
let mixer: AnimationMixer | undefined;
let action: AnimationAction | undefined;
let clipName = '';
let time = 0;
let playing = !params.has('frame');
/** Grossissement et hauteur visée (0 : pieds, 1 : sommet de la tête). */
let zoom = Number(params.get('zoom') ?? 1);
let focus = Number(params.get('focus') ?? 0.5);

function resize(): void {
  const w = view.clientWidth;
  const h = view.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}

function placeCamera(): void {
  const angle = (Number(orbit.value) * Math.PI) / 180;
  const height = model?.height ?? 1;
  const d = (height * 3.4) / zoom;
  // Le modèle regarde vers +z ; l'angle 0 le montre de face.
  camera.position.set(Math.sin(angle) * d, height * (0.25 + focus * 0.5), Math.cos(angle) * d);
  camera.lookAt(0, height * focus, 0);
}

function duration(): number {
  return action?.getClip().duration ?? 0;
}

function show(): void {
  if (action === undefined || mixer === undefined) return;
  action.time = time;
  mixer.update(0);
  const total = Math.round(duration() * FPS);
  info.textContent = `${clipName} — frame ${Math.round(time * FPS)} / ${total}`;
  scrub.value = String(duration() > 0 ? time / duration() : 0);
}

function select(name: string): void {
  if (model === undefined || mixer === undefined) return;
  const clip = model.clips.get(name)?.[0];
  if (clip === undefined) return;
  action?.stop();
  action = mixer.clipAction(clip);
  action.play();
  action.paused = true;
  clipName = name;
  time = 0;
  for (const b of list.querySelectorAll('button')) {
    b.setAttribute('aria-current', String(b.dataset.clip === name));
  }
  show();
}

function setFrame(frame: number): void {
  time = Math.min(duration(), Math.max(0, frame / FPS));
  show();
}

async function load(): Promise<void> {
  const response = await fetch(`/fighters/${id}/model.glb`);
  if (!response.ok) {
    title.textContent = `Modèle introuvable : ${id}`;
    return;
  }
  model = await parseFighterModel(await response.arrayBuffer());
  sourceHeight = model.height;
  actor = clone(model.scene);
  actor.scale.setScalar(1 / model.height);
  actor.traverse((o) => {
    if (o instanceof Mesh) {
      o.castShadow = true;
      o.frustumCulled = false;
    }
  });
  scene.add(actor);
  // Le modèle est ramené à une hauteur de 1 ; la caméra s'y règle.
  model = { ...model, height: 1 };
  mixer = new AnimationMixer(actor);
  title.textContent = `${id} — ${model.names.length} clips`;
  for (const name of [...model.names].sort()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.clip = name;
    const frames = Math.round((model.clips.get(name)![0].duration || 0) * FPS);
    b.innerHTML = `${name} <span>${frames}</span>`;
    b.addEventListener('click', () => select(name));
    list.append(b);
  }
  select(params.get('clip') ?? 'idle');
  if (params.has('frame')) setFrame(Number(params.get('frame')));
  if (params.has('angle')) orbit.value = params.get('angle')!;
  const sheet = params.get('sheet');
  if (sheet !== null) contactSheet(sheet);
}

/**
 * Planche contact : `sheet=jab1:0,jab1:s,jab1:e,…` aligne les poses demandées côte à côte, chacune
 * légendée. Les frames peuvent être des nombres ou `end` (dernière image du clip).
 */
function contactSheet(spec: string): void {
  if (model === undefined || actor === undefined) return;
  const entries = spec.split(',').map((e) => e.split(':') as [string, string?]);
  actor.visible = false;
  ground.visible = false;
  grid.visible = false;
  const gap = 0.9;
  const labels: HTMLDivElement[] = [];
  entries.forEach(([name, at], i) => {
    const clip = model!.clips.get(name)?.[0];
    if (clip === undefined) return;
    const copy = clone(model!.scene);
    copy.scale.setScalar(1 / sourceHeight);
    copy.position.x = (i - (entries.length - 1) / 2) * gap;
    // Vu comme en jeu : tourné vers la droite, de trois quarts vers la caméra.
    copy.rotation.y = Math.PI / 2 - 0.35;
    copy.traverse((o) => {
      if (o instanceof Mesh) o.frustumCulled = false;
    });
    scene.add(copy);
    const m = new AnimationMixer(copy);
    const act = m.clipAction(clip);
    act.play();
    act.paused = true;
    act.time = at === 'end' ? clip.duration : Math.min(clip.duration, Number(at ?? 0) / FPS);
    m.update(0);
    const label = document.createElement('div');
    label.textContent = `${name} ${at ?? 0}`;
    label.style.cssText =
      'position:absolute;bottom:8px;transform:translateX(-50%);color:#e6ebf5;font-size:12px;white-space:nowrap';
    label.dataset.x = String(copy.position.x);
    view.append(label);
    labels.push(label);
  });
  zoom = 3.4 / (entries.length * gap * 1.7);
  focus = 0.5;
  orbit.value = '0';
  info.textContent = `${entries.length} poses`;
  // Légendes sous chaque pose, recalculées quand la vue change de taille.
  const place = (): void => {
    placeCamera();
    camera.updateMatrixWorld();
    for (const label of labels) {
      const p = new Vector3(Number(label.dataset.x), 0, 0).project(camera);
      label.style.left = `${((p.x + 1) / 2) * view.clientWidth}px`;
    }
  };
  new ResizeObserver(place).observe(view);
  place();
}

play.addEventListener('click', () => {
  playing = !playing;
  play.textContent = playing ? 'Pause' : 'Lecture';
});
document.getElementById('prev')!.addEventListener('click', () => {
  playing = false;
  play.textContent = 'Lecture';
  setFrame(Math.round(time * FPS) - 1);
});
document.getElementById('next')!.addEventListener('click', () => {
  playing = false;
  play.textContent = 'Lecture';
  setFrame(Math.round(time * FPS) + 1);
});
scrub.addEventListener('input', () => {
  playing = false;
  play.textContent = 'Lecture';
  time = Number(scrub.value) * duration();
  show();
});
play.textContent = playing ? 'Pause' : 'Lecture';

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing && duration() > 0) {
    time = (time + dt * Number(speed.value)) % duration();
    show();
  }
  placeCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

declare global {
  interface Window {
    viewer: {
      select(name: string): void;
      setFrame(frame: number): void;
      setAngle(degrees: number): void;
      frame(zoom: number, focus: number): void;
      pause(): void;
      clips(): string[];
    };
  }
}
window.viewer = {
  select,
  setFrame,
  setAngle(degrees) {
    orbit.value = String(degrees);
  },
  frame(z, f) {
    zoom = z;
    focus = f;
  },
  pause() {
    playing = false;
    play.textContent = 'Lecture';
  },
  clips: () => [...(model?.names ?? [])],
};

new ResizeObserver(resize).observe(view);
resize();
requestAnimationFrame(frame);
void load();
