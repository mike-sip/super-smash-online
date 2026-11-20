import { applyStage } from '@game/stages-items';
import { testConfig } from '@game/sim-core/testing';
import {
  BoxGeometry,
  Mesh,
  ShaderChunk,
  ShaderLib,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { describe, expect, it } from 'vitest';
import { assetsEnabled, loadHdri, materialMaps } from '../src/assets/loader.ts';
import { presetOf } from '../src/quality.ts';
import { createStageVisuals } from '../src/stages/decor.ts';
import { displace, fbm3, noise3, paint } from '../src/stages/sculpt.ts';
import { createTriplanarMaterial } from '../src/stages/triplanar.ts';

/** Compile « à blanc » : applique `onBeforeCompile` au shader standard de Three, chunks inclus. */
function compiled(material: ReturnType<typeof createTriplanarMaterial>): {
  vertex: string;
  fragment: string;
  uniforms: Record<string, unknown>;
} {
  const shader = {
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
    uniforms: {},
  } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, undefined as never);
  return {
    vertex: shader.vertexShader,
    fragment: shader.fragmentShader,
    uniforms: shader.uniforms,
  };
}

describe('assets libres (SPEC-finition.md)', () => {
  it('sans adresse configurée, rien n’est téléchargé : images d’un pixel, pas de HDRI', async () => {
    expect(assetsEnabled()).toBe(false);
    const maps = materialMaps('sandstone_cracks');
    expect(maps.ready()).toBe(false);
    for (const t of [maps.color.value, maps.normal.value, maps.arm.value]) {
      expect((t.image as { width: number }).width).toBe(1);
    }
    // La même matière est partagée par toutes ses surfaces.
    expect(materialMaps('sandstone_cracks')).toBe(maps);
    await expect(loadHdri('belfast_sunset_puresky')).resolves.toBeNull();
  });

  it('la matière triplanaire remplace bien les morceaux du shader standard', () => {
    // Chaque point d'injection doit exister dans Three, sinon le remplacement serait muet.
    for (const chunk of [
      'color_fragment',
      'roughnessmap_fragment',
      'metalnessmap_fragment',
      'normal_fragment_maps',
      'worldpos_vertex',
    ]) {
      expect(ShaderChunk[chunk as keyof typeof ShaderChunk]).toBeTypeOf('string');
    }
    const material = createTriplanarMaterial({ texture: 'dark_rock_02', tile: 20, base: 0x445566 });
    const { vertex, fragment, uniforms } = compiled(material);
    expect(vertex).toContain('vTriPos = ( modelMatrix');
    expect(fragment).toContain('triSample( uTriColor');
    expect(fragment).toContain('float roughnessFactor = clamp( roughness * triArm.g');
    expect(fragment).toContain('normal = normalize( ( viewMatrix * vec4( triWorld');
    expect(Object.keys(uniforms)).toEqual(
      expect.arrayContaining(['uTriColor', 'uTriNormal', 'uTriArm', 'uTriParams']),
    );
  });

  it('une pièce mobile garde sa texture collée (repère de l’objet)', () => {
    const material = createTriplanarMaterial({
      texture: 'brown_planks_03',
      tile: 14,
      base: 0x6a5038,
      local: true,
    });
    expect(compiled(material).vertex).toContain('vTriPos = transformed;');
    expect(material.customProgramCacheKey()).toBe('triplanar-local');
  });

  it('chaque stage porte des surfaces texturées, couleurs simples en Bas', () => {
    for (const id of ['belvedere', 'recif', 'canal', 'geysers'] as const) {
      const visuals = createStageVisuals(applyStage(testConfig(2), id).stage);
      const surfaces: Mesh[] = [];
      visuals.root.traverse((o) => {
        if (o instanceof Mesh && o.name.startsWith('surface-')) surfaces.push(o);
      });
      expect(surfaces.length, id).toBeGreaterThan(0);
      visuals.setQuality(presetOf('ultra'));
      const textured = surfaces.map((m) => m.material);
      visuals.setQuality(presetOf('low'));
      surfaces.forEach((m, i) => expect(m.material, id).not.toBe(textured[i]));
      visuals.setQuality(presetOf('high'));
      surfaces.forEach((m, i) => expect(m.material, id).toBe(textured[i]));
      visuals.dispose();
    }
  });
});

describe('géométrie sculptée', () => {
  it('le bruit est déterministe et borné', () => {
    expect(noise3(1.3, 2.7, -4.1, 5)).toBe(noise3(1.3, 2.7, -4.1, 5));
    for (let i = 0; i < 200; i++) {
      const n = fbm3(i * 0.37, i * 0.11, -i * 0.23, 3);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });

  it('la déformation garde une surface fermée et la peinture la rend prête à fusionner', () => {
    const shape = displace(new BoxGeometry(10, 10, 10, 4, 4, 4), 1, 0.2, 9);
    // Sommets confondus fusionnés : les faces restent soudées après déformation.
    expect(shape.index).not.toBeNull();
    const painted = paint(shape, 0x887766, 0.2, 1);
    expect(painted.index).toBeNull();
    expect(painted.getAttribute('color').count).toBe(painted.getAttribute('position').count);
    expect(painted.getAttribute('normal')).toBeDefined();
    expect(painted.getAttribute('uv')).toBeUndefined();
  });
});
