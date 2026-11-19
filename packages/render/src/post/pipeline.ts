/**
 * Chaîne de dessin WebGL selon le préréglage (SPEC-visuals.md, phase 1).
 *
 * - Sans post-traitement (`Bas`) : dessin direct à l'écran, mappage de tons dans les shaders.
 * - Avec : scène dessinée dans une image intermédiaire HDR anticrénelée, bloom, puis mappage de
 *   tons et passage en sRGB (`OutputPass`), puis étalonnage et vignette.
 *
 * Le mappage de tons est « Neutral » (Khronos PBR Neutral) : il garde les couleurs franches des
 * thèmes telles quelles jusqu'aux hautes lumières, qu'il comprime en douceur. Les lueurs peuvent
 * ainsi dépasser 1 et rayonner sans brûler le reste de l'image.
 */
import {
  BackSide,
  Color,
  HalfFloatType,
  Mesh,
  NeutralToneMapping,
  PCFShadowMap,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { QualityPreset } from '../quality.ts';
import { GRADING_FRAGMENT, GRADING_VERTEX, rgbOf, type PostLook } from './grading.ts';

export interface PostPipeline {
  configure(preset: QualityPreset, look: PostLook): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
}

interface Chain {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass | null;
  readonly grading: ShaderPass | null;
}

export function createPostPipeline(gl: WebGLRenderer): PostPipeline {
  gl.toneMapping = NeutralToneMapping;
  gl.shadowMap.type = PCFShadowMap;
  let chain: Chain | null = null;
  let width = 1280;
  let height = 720;
  let pixelRatio = 1;
  let preset: QualityPreset | null = null;

  function build(p: QualityPreset, look: PostLook): Chain {
    const target = new WebGLRenderTarget(width * pixelRatio, height * pixelRatio, {
      type: HalfFloatType,
      samples: p.msaa,
    });
    const composer = new EffectComposer(gl, target);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    composer.addPass(new RenderPass(new Scene(), undefined as never));
    let bloom: UnrealBloomPass | null = null;
    if (p.bloom) {
      bloom = new UnrealBloomPass(
        new Vector2(width * pixelRatio, height * pixelRatio),
        look.bloomStrength,
        look.bloomRadius,
        look.bloomThreshold,
      );
      composer.addPass(bloom);
    }
    composer.addPass(new OutputPass());
    let grading: ShaderPass | null = null;
    if (p.grading) {
      grading = new ShaderPass(
        new ShaderMaterial({
          uniforms: {
            tDiffuse: { value: null },
            lift: { value: new Vector3(...rgbOf(look.lift)) },
            gain: { value: new Vector3(...rgbOf(look.gain)) },
            saturation: { value: look.saturation },
            contrast: { value: look.contrast },
            vignette: { value: look.vignette },
          },
          vertexShader: GRADING_VERTEX,
          fragmentShader: GRADING_FRAGMENT,
        }),
      );
      composer.addPass(grading);
    }
    return { composer, bloom, grading };
  }

  function disposeChain(): void {
    if (chain === null) return;
    for (const pass of chain.composer.passes) pass.dispose();
    chain.composer.renderTarget1.dispose();
    chain.composer.renderTarget2.dispose();
    chain = null;
  }

  return {
    configure(p, look) {
      preset = p;
      gl.toneMappingExposure = look.exposure;
      gl.shadowMap.enabled = p.shadowMapSize > 0;
      disposeChain();
      if (p.post) chain = build(p, look);
    },
    setSize(w, h, ratio) {
      width = w;
      height = h;
      pixelRatio = ratio;
      gl.setPixelRatio(ratio);
      gl.setSize(w, h, false);
      if (chain !== null) {
        chain.composer.setPixelRatio(ratio);
        chain.composer.setSize(w, h);
      }
    },
    render(scene, camera) {
      if (chain === null || preset === null) {
        gl.render(scene, camera);
        return;
      }
      const pass = chain.composer.passes[0] as RenderPass;
      pass.scene = scene;
      pass.camera = camera;
      chain.composer.render();
    },
    dispose() {
      disposeChain();
    },
  };
}

/**
 * Lumière d'ambiance par image (IBL) : un ciel en dégradé aux couleurs du thème, préfiltré pour
 * les matières physiques. Donne aux volumes un modelé doux et des reflets cohérents avec le décor.
 */
export function skyEnvironment(
  gl: WebGLRenderer,
  colors: { readonly sky: number; readonly horizon: number; readonly ground: number },
): WebGLRenderTarget {
  const scene = new Scene();
  const geometry = new SphereGeometry(10, 32, 16);
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      sky: { value: new Color(colors.sky) },
      horizon: { value: new Color(colors.horizon) },
      ground: { value: new Color(colors.ground) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sky;
      uniform vec3 horizon;
      uniform vec3 ground;
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 c = y > 0.0 ? mix( horizon, sky, pow( y, 0.6 ) ) : mix( horizon, ground, pow( -y, 0.5 ) );
        gl_FragColor = vec4( c, 1.0 );
      }`,
  });
  scene.add(new Mesh(geometry, material));
  const pmrem = new PMREMGenerator(gl);
  const target = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  geometry.dispose();
  material.dispose();
  return target;
}
