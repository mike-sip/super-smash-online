import { describe, expect, it } from 'vitest';
import { createHud, type HudSink } from '../src/hud.ts';

function recorder(): HudSink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    setDamage: (player, percent) => calls.push(`damage ${player} ${percent}`),
    setTag: (player, x, y) => calls.push(`tag ${player} ${x} ${y}`),
    setTagVisible: (player, visible) => calls.push(`visible ${player} ${visible}`),
    dispose: () => calls.push('dispose'),
  };
}

describe('HUD', () => {
  it('écrit le pourcentage entier, arrondi vers le bas', () => {
    const sink = recorder();
    const hud = createHud(2, sink);
    hud.damage(0, 0);
    hud.damage(1, 42.9);
    expect(sink.calls).toEqual(['damage 0 0', 'damage 1 42']);
  });

  it('ne réécrit le pourcentage que lorsqu’il change à l’affichage', () => {
    const sink = recorder();
    const hud = createHud(2, sink);
    for (let f = 0; f < 600; f++) hud.damage(0, 12 + f * 0.001);
    expect(sink.calls).toEqual(['damage 0 12']);
    hud.damage(0, 13.2);
    hud.damage(0, 13.9);
    expect(sink.calls).toEqual(['damage 0 12', 'damage 0 13']);
    // Un retour à zéro (réapparition) est un changement comme un autre.
    hud.damage(0, 0);
    expect(sink.calls.at(-1)).toBe('damage 0 0');
  });

  it('ne déplace une étiquette que si elle bouge d’au moins un demi-pixel', () => {
    const sink = recorder();
    const hud = createHud(1, sink);
    hud.tag(0, 100, 200, true);
    hud.tag(0, 100.1, 200.2, true);
    hud.tag(0, 100.2, 199.9, true);
    expect(sink.calls).toEqual(['visible 0 true', 'tag 0 100 200']);
    hud.tag(0, 100.6, 200, true);
    expect(sink.calls.at(-1)).toBe('tag 0 100.5 200');
  });

  it('cache une étiquette une seule fois et ne la déplace plus', () => {
    const sink = recorder();
    const hud = createHud(1, sink);
    hud.tag(0, 10, 10, true);
    sink.calls.length = 0;
    hud.tag(0, 500, 500, false);
    hud.tag(0, 600, 600, false);
    expect(sink.calls).toEqual(['visible 0 false']);
    hud.tag(0, 600, 600, true);
    expect(sink.calls).toEqual(['visible 0 false', 'visible 0 true', 'tag 0 600 600']);
  });

  it('ne touche à rien quand rien ne change, image après image', () => {
    const sink = recorder();
    const hud = createHud(8, sink);
    const frame = (): void => {
      for (let p = 0; p < 8; p++) {
        hud.damage(p, p * 10);
        hud.tag(p, p * 50, 300, true);
      }
    };
    frame();
    const written = sink.calls.length;
    for (let f = 0; f < 100; f++) frame();
    expect(sink.calls.length).toBe(written);
  });

  it('libère sa sortie', () => {
    const sink = recorder();
    createHud(1, sink).dispose();
    expect(sink.calls).toEqual(['dispose']);
  });
});
