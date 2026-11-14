/**
 * Contrôles de cohérence d'un stage. Ils ne remplacent pas l'essai manette en main, mais
 * attrapent les erreurs de saisie (point d'apparition à côté du sol, plateforme hors d'atteinte,
 * plateforme mobile qui traverse le décor).
 *
 * Calculs en unités de jeu flottantes : rien de ce qui sort d'ici ne revient dans la simulation.
 */
import { fxToFloat, type PlatformDef, type StageDef } from '@game/sim-core';

/**
 * Hauteur qu'un combattant gagne d'un saut et d'un double saut, prudemment arrondie : le
 * combattant de test monte d'environ 35 unités au premier saut, le lourd d'environ 20.
 */
export const REACH_UP = 30;
/** Distance horizontale franchissable en montant vers une plateforme. */
export const REACH_SIDE = 25;
/** Écart minimal entre deux points d'apparition, pour que deux combattants ne se superposent pas. */
export const MIN_SPAWN_GAP = 8;
/** Positions vérifiées le long de la trajectoire d'une plateforme mobile. */
const MOTION_SAMPLES = 64;

interface Surface {
  x1: number;
  x2: number;
  y: number;
  /** Plateforme fine (index dans `platforms`), ou -1 pour le dessus d'un bloc plein. */
  platform: number;
}

/**
 * Positions successives d'une plateforme. Une plateforme mobile va de son départ au départ décalé
 * de (dx, dy) en ligne droite, puis revient : sa trajectoire est ce segment, quelle que soit la
 * façon dont elle accélère.
 */
function sweep(p: PlatformDef): Surface[] {
  const m = p.motion;
  const steps = m === undefined ? 0 : MOTION_SAMPLES;
  const out: Surface[] = [];
  for (let n = 0; n <= steps; n++) {
    const s = steps === 0 ? 0 : n / steps;
    const dx = m === undefined ? 0 : fxToFloat(m.dx) * s;
    const dy = m === undefined ? 0 : fxToFloat(m.dy) * s;
    out.push({
      x1: fxToFloat(p.x1) + dx,
      x2: fxToFloat(p.x2) + dx,
      y: fxToFloat(p.y) + dy,
      platform: -1,
    });
  }
  return out;
}

/** Renvoie la liste des problèmes du stage pour `players` joueurs ; vide si tout va bien. */
export function validateStage(stage: StageDef, players: number): string[] {
  const errors: string[] = [];

  if (stage.spawns.length < players) {
    errors.push(
      `${stage.spawns.length} points d'apparition pour ${players} joueurs : il en faut un par joueur.`,
    );
  }
  const used = stage.spawns.slice(0, players);
  used.forEach((spawn, i) => {
    const x = fxToFloat(spawn.x);
    const y = fxToFloat(spawn.y);
    // Comparaison exacte en virgule fixe, comme `findSurface` dans la simulation. Une plateforme
    // mobile ne compte pas : le combattant réapparaîtrait dans le vide une fois qu'elle est partie.
    const onSurface =
      stage.solids.some((s) => s.y2 === spawn.y && spawn.x >= s.x1 && spawn.x <= s.x2) ||
      stage.platforms.some(
        (p) => p.motion === undefined && p.y === spawn.y && spawn.x >= p.x1 && spawn.x <= p.x2,
      );
    if (!onSurface) errors.push(`J${i + 1} (${x}, ${y}) n'est posé sur aucune surface fixe.`);
  });
  for (let i = 0; i < used.length; i++) {
    for (let j = i + 1; j < used.length; j++) {
      const a = used[i]!;
      const b = used[j]!;
      const dx = Math.abs(fxToFloat(a.x) - fxToFloat(b.x));
      if (a.y === b.y && dx < MIN_SPAWN_GAP) {
        errors.push(`J${i + 1} et J${j + 1} apparaissent à ${dx} unités l'un de l'autre.`);
      }
    }
  }

  const blast = {
    left: fxToFloat(stage.blast.left),
    right: fxToFloat(stage.blast.right),
    top: fxToFloat(stage.blast.top),
    bottom: fxToFloat(stage.blast.bottom),
  };
  const inside = (x1: number, x2: number, y1: number, y2: number): boolean =>
    x1 > blast.left && x2 < blast.right && y1 > blast.bottom && y2 < blast.top;
  const solids = stage.solids.map((s) => ({
    x1: fxToFloat(s.x1),
    x2: fxToFloat(s.x2),
    y1: fxToFloat(s.y1),
    y2: fxToFloat(s.y2),
  }));
  solids.forEach((s, k) => {
    if (!inside(s.x1, s.x2, s.y1, s.y2))
      errors.push(`Le bloc plein ${k + 1} sort des zones limites.`);
  });

  // Plateformes : toute leur trajectoire dans les zones limites, hors des blocs pleins.
  const sweeps = stage.platforms.map(sweep);
  sweeps.forEach((positions, k) => {
    if (positions.some((p) => !inside(p.x1, p.x2, p.y, p.y))) {
      errors.push(`La plateforme ${k + 1} sort des zones limites.`);
    }
    solids.forEach((s, b) => {
      const crosses = positions.some(
        (p) => p.y > s.y1 && p.y <= s.y2 && p.x2 > s.x1 && p.x1 < s.x2,
      );
      if (crosses) errors.push(`La plateforme ${k + 1} traverse le bloc plein ${b + 1}.`);
    });
  });

  // Accessibilité : on part des dessus de blocs pleins et on monte de proche en proche. Une
  // plateforme mobile est prise à son point le plus bas, sur toute sa largeur balayée.
  const all: Surface[] = [
    ...solids.map((s) => ({ x1: s.x1, x2: s.x2, y: s.y2, platform: -1 })),
    ...sweeps.map((positions, k) => ({
      x1: Math.min(...positions.map((p) => p.x1)),
      x2: Math.max(...positions.map((p) => p.x2)),
      y: Math.min(...positions.map((p) => p.y)),
      platform: k,
    })),
  ];
  const reached = all.map((s) => s.platform < 0);
  let progress = true;
  while (progress) {
    progress = false;
    all.forEach((target, t) => {
      if (reached[t]) return;
      const ok = all.some((from, f) => {
        if (!reached[f]) return false;
        const rise = target.y - from.y;
        const gap = Math.max(target.x1 - from.x2, from.x1 - target.x2, 0);
        return rise <= REACH_UP && gap <= REACH_SIDE;
      });
      if (ok) {
        reached[t] = true;
        progress = true;
      }
    });
  }
  all.forEach((s, t) => {
    if (!reached[t]) errors.push(`La plateforme ${s.platform + 1} est inaccessible.`);
  });

  // Zones d'apparition des objets : au-dessus d'une surface, pour que l'objet s'y pose.
  (stage.itemSpawns ?? []).forEach((zone, z) => {
    const x1 = fxToFloat(zone.x1);
    const x2 = fxToFloat(zone.x2);
    const y = fxToFloat(zone.y);
    const covered = (x: number): boolean => all.some((s) => s.y < y && x >= s.x1 && x <= s.x2);
    if (!inside(x1, x2, y, y) || !covered(x1) || !covered(x2) || !covered((x1 + x2) / 2)) {
      errors.push(`La zone d'objets ${z + 1} n'est pas entièrement au-dessus d'une surface.`);
    }
  });

  return errors;
}
