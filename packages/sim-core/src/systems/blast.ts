/** Zones limites : un combattant qui en sort est KO et reste figé jusqu'à sa réapparition. */
import { A_DEAD, A_HITSTUN, A_TUMBLE, setAction } from '../actions.ts';
import { EV_KO, emit } from '../events.ts';
import type { Sim } from '../step.ts';
import { destroyHeld } from './items.ts';

export function checkBlast(sim: Sim, i: number): void {
  const s = sim.state;
  const action = s.action[i]!;
  if (action === A_DEAD) return;
  const blast = sim.config.stage.blast;
  const x = s.posX[i]!;
  const y = s.posY[i]!;
  // La limite haute ne tue qu'un combattant éjecté : sauter très haut n'est pas un KO.
  const overTop = y > blast.top && (action === A_HITSTUN || action === A_TUMBLE);
  if (x >= blast.left && x <= blast.right && y >= blast.bottom && !overTop) return;

  s.velX[i] = 0;
  s.velY[i] = 0;
  s.grounded[i] = 0;
  s.surface[i] = 0;
  s.fastFall[i] = 0;
  s.hitlag[i] = 0;
  s.launchPending[i] = 0;
  s.stun[i] = 0;
  destroyHeld(sim, i);
  setAction(s, i, A_DEAD);
  emit(sim.events, EV_KO, i, 0);
}
