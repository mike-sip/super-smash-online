import { A_AIR, A_LEDGE, BTN_JUMP, encodeInput, fx, step } from '@game/sim-core';
import { describe, expect, it } from 'vitest';
import { STAGES, applyStage, isStageId, stageById, validateStage } from '../src/index.ts';
import { baseConfig, createSim, playRandom } from './helpers.ts';

describe('stages de la v1', () => {
  it('sont tous valides de 2 à 8 joueurs', () => {
    for (const stage of STAGES) {
      for (let players = 2; players <= 8; players++) {
        expect(validateStage(stage.def, players), `${stage.id} à ${players}`).toEqual([]);
      }
    }
  });

  it('ont des identifiants uniques, égaux au nom de leur StageDef', () => {
    const ids = STAGES.map((stage) => stage.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const stage of STAGES) {
      expect(stage.def.name).toBe(stage.id);
      expect(stageById(stage.id)).toBe(stage);
      expect(isStageId(stage.id)).toBe(true);
    }
    expect(isStageId('inconnu')).toBe(false);
    expect(() => stageById('inconnu' as never)).toThrow(/inconnu/);
  });

  it('applyStage remplace le stage sans toucher au reste ni à l’original', () => {
    const base = baseConfig(2);
    const config = applyStage(base, 'recif');
    expect(config.stage.name).toBe('recif');
    expect(config.fighters).toBe(base.fighters);
    expect(config.entities).toBe(base.entities);
    expect(base.stage.name).toBe('test');
  });

  it('supportent 8 joueurs à inputs aléatoires sans erreur', () => {
    for (const stage of STAGES) {
      const sim = createSim(applyStage(baseConfig(8), stage.id));
      expect(() => playRandom(sim, 7, 600)).not.toThrow();
    }
  });

  it('Récif : un combattant qui quitte le bord en courant puis revient s’accroche au rebord', () => {
    const sim = createSim(applyStage(baseConfig(2), 'recif'));
    const s = sim.state;
    s.posX[0] = fx(75);
    s.facing[0] = 1;
    const inputs = new Uint32Array(2);
    // Coup de stick franc vers le bord : dash, puis chute.
    inputs[0] = encodeInput(127, 0, 0);
    let fell = false;
    for (let f = 0; f < 30 && !fell; f++) {
      step(sim, inputs);
      fell = s.action[0] === A_AIR;
    }
    expect(fell).toBe(true);
    // Retour vers le stage : stick vers le bord, en freinant une fois à portée pour retomber à
    // côté du rebord plutôt que sur le stage ; double saut une fois passé sous le niveau du sol.
    let grabbed = false;
    let jumped = false;
    for (let f = 0; f < 240 && !grabbed; f++) {
      const x = s.posX[0]!;
      const toward = x > fx(100) ? -127 : s.velX[0]! < 0 ? 127 : 0;
      const jump: boolean = !jumped && s.posY[0]! < fx(-10);
      jumped ||= jump;
      inputs[0] = jump ? encodeInput(0, 0, BTN_JUMP) : encodeInput(toward, 0, 0);
      step(sim, inputs);
      grabbed = s.action[0] === A_LEDGE;
    }
    expect(grabbed).toBe(true);
    expect(s.posX[0]! > fx(85)).toBe(true);
  });
});
