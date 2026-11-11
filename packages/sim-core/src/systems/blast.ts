/** Zones limites : un combattant qui en sort est KO et reste figé jusqu'à sa réapparition. */
import { A_DEAD, setAction } from '../actions.ts';
import { EV_KO, emit } from '../events.ts';
import type { Sim } from '../step.ts';

export function checkBlast(sim: Sim, i: number): void {
  const s = sim.state;
  if (s.action[i] === A_DEAD) return;
  const blast = sim.config.stage.blast;
  const x = s.posX[i]!;
  const y = s.posY[i]!;
  if (x >= blast.left && x <= blast.right && y >= blast.bottom && y <= blast.top) return;

  s.velX[i] = 0;
  s.velY[i] = 0;
  s.grounded[i] = 0;
  s.surface[i] = 0;
  s.fastFall[i] = 0;
  setAction(s, i, A_DEAD);
  emit(sim.events, EV_KO, i, 0);
}
