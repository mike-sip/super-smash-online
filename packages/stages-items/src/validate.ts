/**
 * Contrôles de cohérence d'un stage. Ils ne remplacent pas l'essai manette en main, mais
 * attrapent les erreurs de saisie (point d'apparition à côté du sol, plateforme hors d'atteinte).
 *
 * Calculs en unités de jeu flottantes : rien de ce qui sort d'ici ne revient dans la simulation.
 */
import { fxToFloat, type StageDef } from '@game/sim-core';

/**
 * Hauteur qu'un combattant gagne d'un saut et d'un double saut, prudemment arrondie : le
 * combattant de test monte d'environ 35 unités au premier saut, le lourd d'environ 20.
 */
export const REACH_UP = 30;
/** Distance horizontale franchissable en montant vers une plateforme. */
export const REACH_SIDE = 25;
/** Écart minimal entre deux points d'apparition, pour que deux combattants ne se superposent pas. */
export const MIN_SPAWN_GAP = 8;

interface Surface {
  x1: number;
  x2: number;
  y: number;
  /** Plateforme fine (index dans `platforms`), ou -1 pour le dessus d'un bloc plein. */
  platform: number;
}

function surfaces(stage: StageDef): Surface[] {
  return [
    ...stage.solids.map((s) => ({
      x1: fxToFloat(s.x1),
      x2: fxToFloat(s.x2),
      y: fxToFloat(s.y2),
      platform: -1,
    })),
    ...stage.platforms.map((p, k) => ({
      x1: fxToFloat(p.x1),
      x2: fxToFloat(p.x2),
      y: fxToFloat(p.y),
      platform: k,
    })),
  ];
}

/** Renvoie la liste des problèmes du stage pour `players` joueurs ; vide si tout va bien. */
export function validateStage(stage: StageDef, players: number): string[] {
  const errors: string[] = [];
  const all = surfaces(stage);

  if (stage.spawns.length < players) {
    errors.push(
      `${stage.spawns.length} points d'apparition pour ${players} joueurs : il en faut un par joueur.`,
    );
  }
  const used = stage.spawns.slice(0, players);
  used.forEach((spawn, i) => {
    const x = fxToFloat(spawn.x);
    const y = fxToFloat(spawn.y);
    // Comparaison exacte en virgule fixe, comme `findSurface` dans la simulation.
    const onSurface =
      stage.solids.some((s) => s.y2 === spawn.y && spawn.x >= s.x1 && spawn.x <= s.x2) ||
      stage.platforms.some((p) => p.y === spawn.y && spawn.x >= p.x1 && spawn.x <= p.x2);
    if (!onSurface) errors.push(`J${i + 1} (${x}, ${y}) n'est posé sur aucune surface.`);
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
  stage.solids.forEach((s, k) => {
    if (
      fxToFloat(s.x1) <= blast.left ||
      fxToFloat(s.x2) >= blast.right ||
      fxToFloat(s.y1) <= blast.bottom ||
      fxToFloat(s.y2) >= blast.top
    ) {
      errors.push(`Le bloc plein ${k + 1} sort des zones limites.`);
    }
  });
  all.forEach((s) => {
    if (s.platform < 0) return;
    if (s.x1 <= blast.left || s.x2 >= blast.right || s.y <= blast.bottom || s.y >= blast.top) {
      errors.push(`La plateforme ${s.platform + 1} sort des zones limites.`);
    }
  });

  // Accessibilité : on part des dessus de blocs pleins et on monte de proche en proche.
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

  return errors;
}
