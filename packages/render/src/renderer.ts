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
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type BufferGeometry,
  type Camera,
  type Material,
} from 'three';
import {
  approachFraming,
  copyFraming,
  ensureVisible,
  frameFighters,
  projectX,
  projectY,
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
  createEffectPool,
  createEffectVisuals,
  hitShake,
  liveEffects,
  shieldRadius,
  showsShield,
  spawnForEvent,
} from './effects.ts';
import { createEntityVisuals, isNewEntity } from './entities.ts';
import { createEventFilter, isNewFrame } from './events.ts';
import { createMannequins } from './fighters/mannequin.ts';
import { createDomSink, createHud, type HudSink } from './hud.ts';
import {
  createTrack,
  isTeleport,
  pushSample,
  resetTrack,
  sampleX,
  sampleY,
} from './interpolation.ts';
import { buildStage, groundBelow, stageSurfaces } from './stage.ts';

export interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
  /** Conteneur du HUD et de la vue technique, superposé au canvas. */
  readonly overlay: HTMLElement;
  readonly config: SimConfig;
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
  dispose(): void;
}

const FOV_DEGREES = 35;
/** Marges gardées autour des combattants par la caméra, en unités de jeu. */
const CAMERA_MARGIN_X = 24;
const CAMERA_MARGIN_TOP = 34;
const CAMERA_MARGIN_BOTTOM = 14;
const CAMERA_MIN_VIEW_HEIGHT = 90;

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
  return createRendererWith(
    options.config,
    {
      render: (scene, camera) => gl.render(scene, camera),
      drawCalls: () => gl.info.render.calls,
      setSize(width, height, pixelRatio) {
        gl.setPixelRatio(pixelRatio);
        gl.setSize(width, height, false);
      },
      dispose: () => gl.dispose(),
    },
    createDomSink(options.overlay, options.config.fighters.length),
    createDebugLayer(options.overlay),
  );
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
}

/** Construit le renderer sur un backend donné. Interne : l'API publique est `createRenderer`. */
export function createRendererWith(
  config: SimConfig,
  backend: DrawBackend,
  hudSink: HudSink = silentSink,
  debugLayer?: DebugLayer,
): RendererInternals {
  const players = config.fighters.length;

  const scene = new Scene();
  scene.background = new Color(0x1b2233);
  scene.add(new HemisphereLight(0xffffff, 0x3b4252, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.8);
  sun.position.set(40, 120, 90);
  scene.add(sun);

  scene.add(buildStage(config.stage));
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
    aspect: 16 / 9,
  };
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

  const visuals = createMannequins(config);
  scene.add(visuals.root);
  const entities = createEntityVisuals(config);
  scene.add(entities.mesh);

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

  const effectPool = createEffectPool();
  const effects = createEffectVisuals(players, effectPool.capacity);
  scene.add(effects.root);
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
  let lastFrame = -1;
  let captured = false;

  function applyCamera(framing: Framing): void {
    camera.position.set(framing.centerX, framing.centerY, framing.distance);
  }
  applyCamera(framingCurr);

  return {
    capture(sim) {
      const now = frame(sim);
      // Hors séquence (première capture, saut dans le temps) : rien à interpoler.
      const sequential = now === lastFrame + 1;
      if (!sequential) {
        resetTrack(track);
        resetTrack(entityTrack);
      }
      lastFrame = now;

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
      if (isNewFrame(eventFilter, now)) {
        const queue = events(sim);
        for (let e = 0; e < queue.count; e++) {
          spawnForEvent(effectPool, queue.type[e]!, queue.a[e]!, queue.b[e]!, views, heights, now);
        }
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
      const started = debugEnabled ? performance.now() : 0;
      if (captured) {
        debugFrame.shapes.count = 0;
        const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
        framingShown.centerX =
          framingPrev.centerX + (framingCurr.centerX - framingPrev.centerX) * t;
        framingShown.centerY =
          framingPrev.centerY + (framingCurr.centerY - framingPrev.centerY) * t;
        framingShown.distance =
          framingPrev.distance + (framingCurr.distance - framingPrev.distance) * t;
        applyCamera(framingShown);

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
          );
          if (debugEnabled) {
            const def = config.fighters[i]!;
            if (alive) fighterShapes(def, view, x, y, charging[i] === 1, debugFrame.shapes);
            debugFrame.lines[i] = describeFighter(def, i, view);
          }
          hud.tag(
            i,
            projectX(framingShown, bounds, x, viewWidth),
            projectY(framingShown, bounds, y + heights[i]! + TAG_GAP, viewHeight),
            alive,
          );

          const shadow = shadows[i]!;
          const ground = groundBelow(surfaces, x, y);
          const fade = 1 - (y - ground) / SHADOW_FADE_HEIGHT;
          if (!alive || fade <= 0) {
            shadow.visible = false;
          } else {
            const radius = shadowRadius[i]! * (0.5 + 0.5 * fade);
            shadow.visible = true;
            shadow.position.set(x, ground + SHADOW_LIFT, 0);
            shadow.scale.set(radius, 1, radius);
            shadow.material.opacity = SHADOW_OPACITY * fade;
          }
        }

        const entityDefs = config.entities ?? [];
        for (let slot = 0; slot < MAX_ENTITIES; slot++) {
          const kind = entityKind[slot]!;
          const x = sampleX(entityTrack, slot, t);
          const y = sampleY(entityTrack, slot, t);
          entities.set(slot, kind, x, y);
          if (debugEnabled && kind !== 0) {
            const def = entityDefs[kind - 1];
            if (def !== undefined) entityShape(def, x, y, debugFrame.shapes);
          }
        }
        effects.update(effectPool, lastFrame + t);
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
      backend.setSize(width, height, pixelRatio);
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

    effectCount() {
      return liveEffects(effectPool, lastFrame);
    },

    dispose() {
      visuals.dispose();
      entities.dispose();
      effects.dispose();
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
      backend.dispose();
    },
  };
}
