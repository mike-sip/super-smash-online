/** Création du renderer, capture des frames simulées, boucle de dessin, redimensionnement. */
import {
  A_DEAD,
  MAX_ENTITIES,
  MAX_PLAYERS,
  createEntityView,
  createFighterView,
  events,
  frame,
  fxToFloat,
  readEntity,
  readFighter,
  type FighterView,
  type Sim,
  type SimConfig,
} from '@game/sim-core';
import {
  CircleGeometry,
  Color,
  Fog,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  WebGLRenderer,
  type WebGLRenderTarget,
  type BufferGeometry,
  type Camera,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import {
  addShake,
  applyCloseUp,
  approachFraming,
  cameraPosition,
  copyFraming,
  createCloseUp,
  createShake,
  ensureVisible,
  frameFighters,
  projectX,
  projectY,
  shakeOffset,
  startCloseUp,
  type CameraBounds,
  type Framing,
} from './camera.ts';
import {
  createDebugLayer,
  createShapes,
  describeFighter,
  entityShape,
  fighterShapes,
  stageLedges,
  type DebugFrame,
  type DebugLayer,
} from './debug.ts';
import {
  createEffectVisuals,
  createScreenFlash,
  hitShake,
  shieldRadius,
  showsShield,
} from './effects.ts';
import { createEntityVisuals, isNewEntity } from './entities.ts';
import { createEventFilter, isNewFrame } from './events.ts';
import { createVfx } from './vfx/library.ts';
import { createParticleLayer, liveParticles } from './vfx/particles.ts';
import { createMannequins } from './fighters/mannequin.ts';
import type { FighterVisualsFactory } from './fighters/visual.ts';
import { createDomSink, createHud, type HudSink } from './hud.ts';
import {
  createTrack,
  isTeleport,
  pushSample,
  resetTrack,
  sampleX,
  sampleY,
} from './interpolation.ts';
import { createLighting } from './lighting.ts';
import { lookOf, type PostLook } from './post/grading.ts';
import { createPostPipeline, skyEnvironment } from './post/pipeline.ts';
import { loadHdri } from './assets/loader.ts';
import {
  createAutoTuner,
  guessQuality,
  pixelRatioFor,
  presetOf,
  type AutoTuner,
  type Quality,
  type QualityPreset,
  type QualitySetting,
} from './quality.ts';
import { groundBelow, stageSurfaces } from './stage.ts';
import { createStageVisuals, type Theme } from './stages/decor.ts';
import { createItemVisuals, swingOf } from './stages/items.ts';

export interface QualityOptions {
  /** Niveau de qualité graphique ; `'auto'` par défaut. */
  readonly quality?: QualitySetting;
  /**
   * En `'auto'`, niveau de départ à la place de l'estimation d'après la carte graphique : celui
   * qu'a retenu le match précédent (`Renderer.quality`), pour ne pas réévaluer à chaque match.
   */
  readonly autoStart?: Quality;
}

export interface RendererOptions extends QualityOptions {
  readonly canvas: HTMLCanvasElement;
  /** Conteneur du HUD et de la vue technique, superposé au canvas. */
  readonly overlay: HTMLElement;
  readonly config: SimConfig;
  /** Représentation des combattants ; par défaut, le mannequin procédural sans style. */
  readonly fighterVisuals?: FighterVisualsFactory;
  /** Secousses de caméra, gros plans et éclairs d'écran ; vrai par défaut (option de confort). */
  readonly screenEffects?: boolean;
  /**
   * Vrai si l'éjection de ce joueur finirait le match : le coup final a son gros plan et son
   * ralenti (`Renderer.timeScale`). Le match local seulement ; absent en ligne.
   */
  readonly isFinal?: (player: number) => boolean;
}

export interface Renderer {
  /**
   * À appeler après chaque `step`. Mémorise la frame pour l'interpolation et déclenche les
   * effets des événements. Une frame déjà vue (re-simulée après un rollback) ne redéclenche rien.
   */
  capture(sim: Sim): void;

  /** Dessine. `alpha`, de 0 à 1, situe l'instant affiché entre les deux dernières frames capturées. */
  draw(alpha: number): void;

  resize(width: number, height: number, pixelRatio: number): void;
  setDebug(enabled: boolean): void;
  /** Change le niveau de qualité (de préférence entre deux matchs). */
  setQuality(quality: QualitySetting): void;
  /** Niveau effectivement appliqué : celui qu'a choisi `'auto'`, le cas échéant. */
  readonly quality: Quality;
  /**
   * Vitesse d'affichage conseillée (SPEC-finition.md, phase 3) : 1, ou moins pendant le ralenti
   * du coup final. Le match local multiplie le temps écoulé par cette valeur avant de simuler.
   */
  timeScale(): number;
  /** Libère les ressources GPU. */
  dispose(): void;
}

/**
 * Ce qui touche réellement au GPU. Isolé pour que tout le reste du renderer (scène, capture,
 * interpolation) s'exécute dans les tests, sans WebGL.
 */
export interface DrawBackend {
  render(scene: Scene, camera: Camera): void;
  /** Appels de dessin émis par le dernier `render`. */
  drawCalls(): number;
  setSize(width: number, height: number, pixelRatio: number): void;
  /** Applique un préréglage : ombres, chaîne de post-traitement, réglages d'image. */
  configure?(preset: QualityPreset, look: PostLook): void;
  /**
   * Lumière d'ambiance par image pour ce thème, ou rien. `upgrade` reçoit plus tard l'éclairage
   * tiré de l'image HDRI du thème, quand elle est chargée.
   */
  environment?(
    theme: Theme,
    upgrade?: (texture: Texture) => void,
  ): { readonly texture: Texture; dispose(): void } | null;
  /** Nom de la carte graphique, pour le choix automatique de la qualité. */
  gpu?(): string;
  dispose(): void;
}

const FOV_DEGREES = 35;
/** Inclinaison de la caméra vers le bas : le dessus des plateformes et les ombres se voient. */
const CAMERA_TILT = (7 * Math.PI) / 180;
/** Particules au plus, avant la limite fixée par la qualité : lumineuses et opaques. */
const GLOW_CAPACITY = 7000;
const PUFF_CAPACITY = 3000;
/** Part des particules lumineuses dans le budget d'un préréglage. */
const GLOW_SHARE = 0.7;
/** Marges gardées autour des combattants par la caméra, en unités de jeu. */
const CAMERA_MARGIN_X = 20;
const CAMERA_MARGIN_TOP = 30;
const CAMERA_MARGIN_BOTTOM = 12;
const CAMERA_MIN_VIEW_HEIGHT = 72;

const SHADOW_OPACITY = 0.35;
/** Hauteur au-dessus du sol à laquelle l'ombre a perdu toute sa taille et son opacité. */
const SHADOW_FADE_HEIGHT = 60;
/** Décalage qui évite à l'ombre de se confondre avec la surface qui la porte. */
const SHADOW_LIFT = 0.05;
/** Nombre d'images sur lesquelles le temps de dessin affiché est lissé. */
const DRAW_TIME_WINDOW = 60;
/** Capsules que la vue technique peut montrer : hurtbox et hitbox de 8 combattants, plus les entités. */
const DEBUG_SHAPES = MAX_PLAYERS * 12 + MAX_ENTITIES;
/** Espace entre la tête d'un combattant et son étiquette, en unités de jeu. */
const TAG_GAP = 2.5;

export function createRenderer(options: RendererOptions): Renderer {
  const gl = new WebGLRenderer({
    canvas: options.canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  const pipeline = createPostPipeline(gl);
  return createRendererWith(
    options.config,
    {
      render: (scene, camera) => pipeline.render(scene, camera),
      drawCalls: () => gl.info.render.calls,
      setSize: (width, height, pixelRatio) => pipeline.setSize(width, height, pixelRatio),
      configure: (preset, look) => pipeline.configure(preset, look),
      environment(theme, upgrade) {
        const target = skyEnvironment(gl, {
          sky: theme.sky,
          horizon: theme.background,
          ground: theme.ground,
        });
        let hdr: WebGLRenderTarget | null = null;
        let alive = true;
        if (theme.hdri !== undefined && upgrade !== undefined) {
          void loadHdri(theme.hdri.file).then((image) => {
            if (image === null || !alive) return;
            const pmrem = new PMREMGenerator(gl);
            hdr = pmrem.fromEquirectangular(image);
            pmrem.dispose();
            upgrade(hdr.texture);
          });
        }
        return {
          texture: target.texture,
          dispose() {
            alive = false;
            target.dispose();
            hdr?.dispose();
          },
        };
      },
      gpu() {
        const context = gl.getContext();
        const info = context.getExtension('WEBGL_debug_renderer_info');
        return String(
          context.getParameter(info === null ? context.RENDERER : info.UNMASKED_RENDERER_WEBGL),
        );
      },
      dispose() {
        pipeline.dispose();
        gl.dispose();
      },
    },
    createDomSink(options.overlay, options.config.fighters.length),
    createDebugLayer(options.overlay),
    options.fighterVisuals,
    {
      quality: options.quality ?? 'auto',
      autoStart: options.autoStart,
      screenEffects: options.screenEffects ?? true,
      ...(options.isFinal === undefined ? {} : { isFinal: options.isFinal }),
    },
  );
}

/** Ralenti du coup final : vitesse tenue, frames de maintien, frames du retour à la normale. */
const FINALE_SPEED = 0.2;
const FINALE_HOLD = 10;
const FINALE_RAMP = 40;

/**
 * Vitesse d'affichage `age` frames de simulation après le départ du coup final : très lente,
 * tenue, puis retour en douceur. 1 hors du ralenti.
 */
export function finaleScale(age: number): number {
  if (!(age >= 0) || age >= FINALE_HOLD + FINALE_RAMP) return 1;
  if (age < FINALE_HOLD) return FINALE_SPEED;
  const t = (age - FINALE_HOLD) / FINALE_RAMP;
  return FINALE_SPEED + (1 - FINALE_SPEED) * t * t * (3 - 2 * t);
}

/** Part de lumière retirée au décor au plus fort de l'assombrissement d'une attaque ultime. */
const DIM_DEPTH = 0.62;

/** Poids de l'assombrissement `age` frames après son départ : montée, maintien, retour. */
export function dimWeight(age: number, life: number): number {
  if (life <= 0 || age < 0 || age >= life) return 0;
  const w = Math.min(1, age / 6, (life - age) / 18);
  return w * w * (3 - 2 * w);
}

/** Part de la lumière d'ambiance par image dans l'éclairage. */
const ENVIRONMENT_INTENSITY = 0.3;

/** Les combattants, objets et entités portent et reçoivent les ombres et la lumière de contour. */
function prepareActors(root: Object3D, addRim: (material: Material) => void): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    // Contour et petits détails (yeux) : ni ombre portée ni ombre reçue.
    const shadows = object.userData.noShadow !== true;
    object.castShadow = shadows;
    object.receiveShadow = shadows;
    const material = object.material as Material | Material[];
    for (const m of Array.isArray(material) ? material : [material]) {
      if (m instanceof MeshStandardMaterial) addRim(m);
    }
  });
}

/** Le décor éclairé porte et reçoit les ombres ; ciel et lueurs non. */
function prepareDecor(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const lit = object.material instanceof MeshStandardMaterial;
    object.castShadow = lit;
    object.receiveShadow = lit;
  });
}

const silentSink: HudSink = {
  setDamage() {},
  setTag() {},
  setTagVisible() {},
  dispose() {},
};

/** Ce que le renderer expose en plus à ses propres tests. */
export interface RendererInternals extends Renderer {
  /** Nombre d'effets visibles à la dernière frame capturée. */
  effectCount(): number;
  /**
   * Fige la caméra sur un cadrage donné (centre et distance au plan de jeu), ou rend le cadrage
   * automatique avec `null`. Outil d'inspection (démo, vérification visuelle, portraits).
   */
  inspect(framing: Framing | null): void;
}

/** Construit le renderer sur un backend donné. Interne : l'API publique est `createRenderer`. */
export function createRendererWith(
  config: SimConfig,
  backend: DrawBackend,
  hudSink: HudSink = silentSink,
  debugLayer?: DebugLayer,
  fighterVisuals: FighterVisualsFactory = createMannequins,
  qualityOptions: QualityOptions & {
    readonly screenEffects?: boolean;
    readonly isFinal?: (player: number) => boolean;
  } = {},
): RendererInternals {
  const players = config.fighters.length;

  const scene = new Scene();
  // Décor, fond et lumières : ceux du thème du stage (module stages-items), ou le décor neutre.
  const stageVisuals = createStageVisuals(config.stage);
  const theme = stageVisuals.theme;
  scene.background = new Color(theme.background);
  if (theme.fog !== undefined) scene.fog = new Fog(theme.fog.color, theme.fog.near, theme.fog.far);
  const lighting = createLighting(theme);
  scene.add(lighting.root);
  // Ambiance : d'abord tirée des couleurs du thème, puis de son image HDRI quand elle arrive.
  let environmentIntensity = ENVIRONMENT_INTENSITY;
  const environment =
    backend.environment?.(theme, (texture) => {
      scene.environment = texture;
      environmentIntensity = theme.hdri?.intensity ?? ENVIRONMENT_INTENSITY;
      scene.environmentIntensity = environmentIntensity;
      scene.environmentRotation.set(0, theme.hdri?.rotation ?? 0, 0);
    }) ?? null;
  if (environment !== null) {
    scene.environment = environment.texture;
    scene.environmentIntensity = ENVIRONMENT_INTENSITY;
  }
  const look = lookOf(theme.look);

  // L'eau reflète le ciel du thème par sa propre carte : sa force de reflet (`reflect`) s'applique alors,
  // ce que la lumière d'ambiance de la scène ne permet pas.
  if (environment !== null) {
    stageVisuals.root.traverse((object) => {
      if (object instanceof Mesh && object.userData.skyReflection === true) {
        (object.material as MeshStandardMaterial).envMap = environment.texture;
      }
    });
  }
  prepareDecor(stageVisuals.root);
  scene.add(stageVisuals.root);
  const surfaces = stageSurfaces(config.stage);

  // La caméra regarde le plan de jeu de face ; `camera.ts` décide où elle se place.
  const camera = new PerspectiveCamera(FOV_DEGREES, 16 / 9, 1, 5000);
  const blast = config.stage.blast;
  const bounds: CameraBounds = {
    minX: fxToFloat(blast.left),
    maxX: fxToFloat(blast.right),
    minY: fxToFloat(blast.bottom),
    maxY: fxToFloat(blast.top),
    marginX: CAMERA_MARGIN_X,
    marginTop: CAMERA_MARGIN_TOP,
    marginBottom: CAMERA_MARGIN_BOTTOM,
    minViewHeight: CAMERA_MIN_VIEW_HEIGHT,
    tanHalfFov: Math.tan((FOV_DEGREES * Math.PI) / 360),
    tilt: CAMERA_TILT,
    aspect: 16 / 9,
  };
  camera.rotation.x = -CAMERA_TILT;
  // La caméra porte le voile des éclairs d'écran : elle doit être dans la scène.
  scene.add(camera);
  const screenEffects = qualityOptions.screenEffects ?? true;
  const shake = createShake();
  const closeUp = createCloseUp();
  const cameraAt = { x: 0, y: 0, z: 0 };
  const shakeAt = { x: 0, y: 0 };
  const framingTarget: Framing = { centerX: 0, centerY: 0, distance: 0 };
  const framingPrev: Framing = { centerX: 0, centerY: 0, distance: 0 };
  const framingCurr: Framing = { centerX: 0, centerY: 0, distance: 0 };
  const framingShown: Framing = { centerX: 0, centerY: 0, distance: 0 };
  const aliveX = new Float32Array(MAX_PLAYERS);
  const aliveY = new Float32Array(MAX_PLAYERS);
  let aliveCount = 0;
  // Avant la première capture : le stage entier, centré sur ses points d'apparition.
  for (let i = 0; i < players; i++) {
    aliveX[i] = fxToFloat(config.stage.spawns[i]!.x);
    aliveY[i] = fxToFloat(config.stage.spawns[i]!.y);
  }
  frameFighters(aliveX, aliveY, players, bounds, framingTarget);
  copyFraming(framingTarget, framingPrev);
  copyFraming(framingTarget, framingCurr);

  const visuals = fighterVisuals(config);
  scene.add(visuals.root);
  const entities = createEntityVisuals(config, (owner) =>
    owner < 0 ? undefined : visuals.theme?.(owner),
  );
  scene.add(entities.mesh);
  // Objets et dangers : chacun sous sa forme ; les autres entités restent des sphères.
  const itemVisuals = createItemVisuals(config);
  const swing = swingOf(config);
  scene.add(itemVisuals.root);
  for (const root of [visuals.root, entities.mesh, itemVisuals.root]) {
    prepareActors(root, (m) => lighting.addRim(m));
  }

  const views: FighterView[] = [];
  const heights = new Float64Array(players);
  const shadows: Mesh<CircleGeometry, MeshBasicMaterial>[] = [];
  const shadowRadius = new Float64Array(players);
  const shadowGeometry = new CircleGeometry(1, 24);
  shadowGeometry.rotateX(-Math.PI / 2);
  for (let i = 0; i < players; i++) {
    const def = config.fighters[i]!;
    views.push(createFighterView());
    heights[i] = fxToFloat(def.height);

    // Un matériau par ombre : son opacité dépend de la hauteur du combattant.
    const shadow = new Mesh(
      shadowGeometry,
      new MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false }),
    );
    shadow.name = `shadow-${i}`;
    shadow.visible = false;
    shadowRadius[i] = fxToFloat(def.halfWidth) * 1.4;
    scene.add(shadow);
    shadows.push(shadow);
  }

  const effects = createEffectVisuals(players);
  scene.add(effects.root);
  const flash = createScreenFlash(camera);
  const glowLayer = createParticleLayer(GLOW_CAPACITY, false);
  const puffLayer = createParticleLayer(PUFF_CAPACITY, true);
  scene.add(glowLayer.mesh, puffLayer.mesh);
  const gravities = new Float64Array(players);
  for (let i = 0; i < players; i++) gravities[i] = fxToFloat(config.fighters[i]!.gravity);
  const vfx = createVfx({
    glow: glowLayer.pool,
    puff: puffLayer.pool,
    heights,
    gravities,
    blast: { left: bounds.minX, right: bounds.maxX, top: bounds.maxY, bottom: bounds.minY },
    themes: Array.from({ length: players }, (_, i) => visuals.theme?.(i)),
    ...(qualityOptions.isFinal === undefined ? {} : { isFinal: qualityOptions.isFinal }),
  });
  /** Frame du dernier coup final, ou -Infinity. */
  let finaleAt = Number.NEGATIVE_INFINITY;
  const eventFilter = createEventFilter();

  // Vue technique. Ses textes sont recréés à chaque image : elle seule déroge à la règle
  // « aucune allocation par image », et uniquement quand elle est affichée.
  const charging = new Uint8Array(players);
  const debugFrame: DebugFrame = {
    shapes: createShapes(DEBUG_SHAPES),
    ledges: stageLedges(config.stage),
    framing: framingShown,
    bounds,
    lines: new Array<string>(players + 1).fill(''),
  };
  let debugEnabled = false;
  let drawTime = 0;

  const hud = createHud(players, hudSink);
  let viewWidth = 1280;
  let viewHeight = 720;

  const track = createTrack(players);
  const prevAction = new Int32Array(players);
  const entityTrack = createTrack(MAX_ENTITIES);
  const entityView = createEntityView();
  const entityKind = new Int32Array(MAX_ENTITIES);
  const entityLife = new Int32Array(MAX_ENTITIES);
  const entityOwner = new Int32Array(MAX_ENTITIES).fill(-1);
  const entityDefs = config.entities ?? [];
  // Assombrissement du décor pendant une attaque ultime (frame de départ et durée).
  let dimBorn = 0;
  let dimLife = 0;
  const background = new Color(theme.background);
  const fogColor = theme.fog === undefined ? null : new Color(theme.fog.color);
  let lastFrame = -1;
  let captured = false;
  let inspected: Framing | null = null;

  function applyCamera(framing: Framing): void {
    cameraPosition(framing, bounds, cameraAt);
    camera.position.set(cameraAt.x, cameraAt.y, cameraAt.z);
  }
  applyCamera(framingCurr);

  // Qualité : préréglage appliqué aux lumières et au backend ; en `auto`, réévaluée pendant les
  // premières secondes d'après l'intervalle entre deux images dessinées.
  let tuner: AutoTuner | null = null;
  let quality: Quality = 'high';
  let preset = presetOf(quality);
  let requestedRatio = 1;
  let lastDrawAt = 0;

  function applyQuality(q: Quality): void {
    quality = q;
    preset = presetOf(q);
    lighting.configure(preset);
    visuals.setQuality?.(preset);
    stageVisuals.setQuality(preset);
    glowLayer.setLimit(Math.round(preset.particles * GLOW_SHARE));
    puffLayer.setLimit(preset.particles - Math.round(preset.particles * GLOW_SHARE));
    backend.configure?.(preset, look);
    backend.setSize(viewWidth, viewHeight, pixelRatioFor(preset, requestedRatio));
  }

  function setQuality(setting: QualitySetting, autoStart?: Quality): void {
    if (setting === 'auto') {
      tuner = createAutoTuner(autoStart ?? guessQuality(backend.gpu?.() ?? ''));
      applyQuality(tuner.quality);
    } else {
      tuner = null;
      applyQuality(setting);
    }
  }
  setQuality(qualityOptions.quality ?? 'high', qualityOptions.autoStart);

  return {
    get quality() {
      return quality;
    },
    setQuality: (setting) => setQuality(setting),
    timeScale: () => finaleScale(lastFrame - finaleAt),
    capture(sim) {
      const now = frame(sim);
      // Hors séquence (première capture, saut dans le temps) : rien à interpoler.
      const sequential = now === lastFrame + 1;
      if (!sequential) {
        resetTrack(track);
        resetTrack(entityTrack);
      }
      lastFrame = now;
      stageVisuals.capture(sim, sequential);
      itemVisuals.capture(sim);

      aliveCount = 0;
      for (let i = 0; i < players; i++) {
        const view = views[i]!;
        const chargeBefore = view.charge;
        readFighter(sim, i, view);
        charging[i] = view.charge > chargeBefore ? 1 : 0;
        pushSample(track, i, view.x, view.y, isTeleport(prevAction[i]!, view.action));
        prevAction[i] = view.action;
        visuals.capture(i, view);
        hud.damage(i, view.damage);
        if (view.action !== A_DEAD) {
          aliveX[aliveCount] = view.x;
          aliveY[aliveCount] = view.y;
          aliveCount++;
        }
      }

      // Événements : une frame re-simulée après un rollback ne redéclenche rien.
      const newFrame = isNewFrame(eventFilter, now);
      if (newFrame) {
        // Zone visible, pour ramener à l'écran l'effet d'un KO.
        const halfH = framingCurr.distance * bounds.tanHalfFov;
        vfx.view.minX = framingCurr.centerX - halfH * bounds.aspect;
        vfx.view.maxX = framingCurr.centerX + halfH * bounds.aspect;
        vfx.view.minY = framingCurr.centerY - halfH;
        vfx.view.maxY = framingCurr.centerY + halfH;
        if (!sequential) vfx.forget();
        const queue = events(sim);
        for (let e = 0; e < queue.count; e++) {
          vfx.event(queue.type[e]!, queue.a[e]!, queue.b[e]!, views, now);
        }
        for (let i = 0; i < players; i++) vfx.fighter(i, views[i]!, now);
        const cues = vfx.cues;
        if (screenEffects) {
          if (cues.shake > 0) addShake(shake, cues.shake, cues.shakeLife, now);
          if (cues.closeLife > 0)
            startCloseUp(closeUp, cues.closeX, cues.closeY, cues.closeLife, now);
          if (cues.flash > 0) flash.start(cues.flashColor, cues.flash, now);
          if (cues.finale) finaleAt = now;
        }
        if (cues.dimLife > 0) {
          dimBorn = now;
          dimLife = cues.dimLife;
        }
        cues.shake = 0;
        cues.closeLife = 0;
        cues.flash = 0;
        cues.dimLife = 0;
        cues.finale = false;
      }

      for (let slot = 0; slot < MAX_ENTITIES; slot++) {
        if (!readEntity(sim, slot, entityView)) {
          entityKind[slot] = 0;
          continue;
        }
        const fresh = isNewEntity(
          entityKind[slot]!,
          entityLife[slot]!,
          entityView.kind,
          entityView.life,
        );
        pushSample(entityTrack, slot, entityView.x, entityView.y, fresh);
        entityKind[slot] = entityView.kind;
        entityLife[slot] = entityView.life;
        entityOwner[slot] = entityView.owner;
        // Traînée des projectiles (les objets ont leur propre rendu).
        if (newFrame && !itemVisuals.handles(entityView.kind)) {
          const def = entityDefs[entityView.kind - 1];
          vfx.projectile(
            entityView.x,
            entityView.y,
            entityView.velX,
            entityView.velY,
            entityView.owner,
            def === undefined ? 1 : fxToFloat(def.radius),
            now,
          );
        }
      }

      // Caméra : la cible suit les combattants vivants, le cadrage affiché la rejoint en douceur.
      frameFighters(aliveX, aliveY, aliveCount, bounds, framingTarget);
      if (captured && sequential) {
        copyFraming(framingCurr, framingPrev);
        approachFraming(framingCurr, framingTarget);
        ensureVisible(framingCurr, aliveX, aliveY, aliveCount, bounds);
      } else {
        copyFraming(framingTarget, framingCurr);
        copyFraming(framingTarget, framingPrev);
      }
      captured = true;
    },

    draw(alpha) {
      const started = debugEnabled || tuner !== null ? performance.now() : 0;
      if (tuner !== null && !tuner.done) {
        const changed = lastDrawAt > 0 ? tuner.sample(started - lastDrawAt) : null;
        if (changed !== null) applyQuality(changed);
        lastDrawAt = started;
      }
      if (captured) {
        debugFrame.shapes.count = 0;
        const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
        framingShown.centerX =
          framingPrev.centerX + (framingCurr.centerX - framingPrev.centerX) * t;
        framingShown.centerY =
          framingPrev.centerY + (framingCurr.centerY - framingPrev.centerY) * t;
        framingShown.distance =
          framingPrev.distance + (framingCurr.distance - framingPrev.distance) * t;
        if (inspected !== null) copyFraming(inspected, framingShown);
        const time = lastFrame + t;
        // Gros plan et secousse : purement visuels, coupés dans la vue technique pour qu'elle
        // reste lisible.
        if (!debugEnabled) applyCloseUp(closeUp, time, bounds, framingShown);
        applyCamera(framingShown);
        if (!debugEnabled) {
          shakeOffset(shake, time, framingShown.distance, bounds, shakeAt);
          camera.position.x += shakeAt.x;
          camera.position.y += shakeAt.y;
        }
        lighting.follow(framingShown, bounds.tanHalfFov, bounds.aspect);
        stageVisuals.update(lastFrame, t);

        for (let i = 0; i < players; i++) {
          const view = views[i]!;
          const x = sampleX(track, i, t);
          const y = sampleY(track, i, t);
          const alive = view.action !== A_DEAD;
          // Une victime gelée par le hitlag tremble ; son étiquette et son ombre restent en place.
          visuals.update(i, x + hitShake(view.action, view.hitlag), y, view, t);
          const height = heights[i]!;
          effects.shield(
            i,
            x,
            y + height / 2,
            alive && showsShield(view.action) ? shieldRadius(view.shield) * height : 0,
            view.shield,
          );
          if (debugEnabled) {
            const def = config.fighters[i]!;
            if (alive) {
              fighterShapes(def, view, x, y, charging[i] === 1, debugFrame.shapes, swing);
            }
            debugFrame.lines[i] = describeFighter(def, i, view);
          }
          hud.tag(
            i,
            projectX(framingShown, bounds, x, y + heights[i]! + TAG_GAP, viewWidth),
            projectY(framingShown, bounds, y + heights[i]! + TAG_GAP, viewHeight),
            alive,
          );

          const shadow = shadows[i]!;
          const ground = groundBelow(surfaces, x, y);
          const fade = 1 - (y - ground) / SHADOW_FADE_HEIGHT;
          // Ombre ronde seulement sans carte d'ombre : sinon le combattant porte sa vraie ombre.
          if (!alive || fade <= 0 || preset.shadowMapSize > 0) {
            shadow.visible = false;
          } else {
            const radius = shadowRadius[i]! * (0.5 + 0.5 * fade);
            shadow.visible = true;
            shadow.position.set(x, ground + SHADOW_LIFT, 0);
            shadow.scale.set(radius, 1, radius);
            shadow.material.opacity = SHADOW_OPACITY * fade;
          }
        }

        itemVisuals.begin();
        for (let slot = 0; slot < MAX_ENTITIES; slot++) {
          const kind = entityKind[slot]!;
          const x = sampleX(entityTrack, slot, t);
          const y = sampleY(entityTrack, slot, t);
          if (itemVisuals.handles(kind)) {
            entities.set(slot, 0, x, y, -1);
            itemVisuals.set(slot, x, y, lastFrame + t);
          } else {
            entities.set(slot, kind, x, y, entityOwner[slot]!);
          }
          if (debugEnabled && kind !== 0) {
            const def = entityDefs[kind - 1];
            if (def !== undefined) entityShape(def, x, y, debugFrame.shapes);
          }
        }
        itemVisuals.end();
        effects.update(time);
        glowLayer.update(time);
        puffLayer.update(time);
        flash.update(time);
        // Ultime : le décor s'assombrit, les combattants (lumière de contour) ressortent.
        const dim = DIM_DEPTH * dimWeight(time - dimBorn, dimLife);
        lighting.setDim(1 - dim);
        if (environment !== null) scene.environmentIntensity = environmentIntensity * (1 - dim);
        (scene.background as Color).copy(background).multiplyScalar(1 - dim);
        if (fogColor !== null && scene.fog !== null) {
          (scene.fog as Fog).color.copy(fogColor).multiplyScalar(1 - dim);
        }
      }
      backend.render(scene, camera);

      if (debugEnabled && debugLayer !== undefined) {
        // Temps passé côté processeur à préparer et émettre l'image, lissé ; le travail de la
        // carte graphique n'y figure pas.
        drawTime += (performance.now() - started - drawTime) / DRAW_TIME_WINDOW;
        debugFrame.lines[players] =
          `frame ${lastFrame}  ${backend.drawCalls()} appels de dessin  dessin ${drawTime.toFixed(2)} ms`;
        debugLayer.draw(debugFrame);
      }
    },

    resize(width, height, pixelRatio) {
      if (width <= 0 || height <= 0) return;
      requestedRatio = pixelRatio;
      backend.setSize(width, height, pixelRatioFor(preset, pixelRatio));
      debugLayer?.resize(width, height, pixelRatio);
      viewWidth = width;
      viewHeight = height;
      bounds.aspect = width / height;
      camera.aspect = bounds.aspect;
      camera.updateProjectionMatrix();
      // Le cadrage dépend des proportions de l'écran : on le refait sans transition.
      const count = captured ? aliveCount : players;
      frameFighters(aliveX, aliveY, count, bounds, framingTarget);
      copyFraming(framingTarget, framingCurr);
      copyFraming(framingTarget, framingPrev);
      applyCamera(framingCurr);
    },

    setDebug(enabled) {
      debugEnabled = enabled;
      debugLayer?.setEnabled(enabled);
    },

    inspect(framing) {
      inspected = framing === null ? null : { ...framing };
    },

    effectCount() {
      return liveParticles(glowLayer.pool, lastFrame) + liveParticles(puffLayer.pool, lastFrame);
    },

    dispose() {
      visuals.dispose();
      entities.dispose();
      effects.dispose();
      flash.dispose();
      glowLayer.dispose();
      puffLayer.dispose();
      debugLayer?.dispose();
      hud.dispose();
      const geometries = new Set<BufferGeometry>();
      const materials = new Set<Material>();
      scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        geometries.add(object.geometry as BufferGeometry);
        const material = object.material as Material | Material[];
        for (const m of Array.isArray(material) ? material : [material]) materials.add(m);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      scene.clear();
      lighting.dispose();
      environment?.dispose();
      stageVisuals.dispose();
      backend.dispose();
    },
  };
}
