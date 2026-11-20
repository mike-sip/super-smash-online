/**
 * Corps commun des figurines : un humanoïde aux formes douces, construit d'après les proportions
 * d'un personnage (`build`), auquel s'ajoutent ses pièces (épaulières, coiffe…, converties en
 * boîtes arrondies) et ses volumes propres (`sculpt`). Logique pure.
 */
import { PLAYER_COLORS } from './visual.ts';
import type { Dims, MannequinColor, MannequinPart, MannequinStyle } from './mannequin.ts';
import type { BoneName, Sculpt, SculptPart, ZoneName } from './sdf.ts';
import { ZONES } from './sdf.ts';
import type { MaterialKind } from './materials.ts';

/** Ce qu'une figurine lit d'un personnage : le style du mannequin, plus ses volumes et teintes. */
export interface FigurineStyle extends MannequinStyle {
  /** Volumes ajoutés au corps commun (tunique, mèches, sandales…). */
  readonly sculpt?: Sculpt;
  /** Teintes des zones que le style ne donne pas (peau, cheveux, accents). */
  readonly palette?: Partial<Record<ZoneName, number>>;
  /**
   * Couleurs alternatives (SPEC-visuals.md, phase 4) : chacune remplace une partie des teintes de
   * base. La première est d'habitude vide (les couleurs de base).
   */
  readonly palettes?: readonly Partial<Record<ZoneName, number>>[];
  /** Zone qui rayonne (gantelets incandescents…), plus fort pendant la charge d'un smash. */
  readonly emissive?: ZoneName;
  /** Zone irisée : sa teinte change avec l'angle de vue (nacre…). */
  readonly iridescent?: ZoneName;
  /** Thème des effets du personnage : rafales, plumes, braises, perles. */
  readonly vfx?: VfxTheme;
  /** Matière de chaque zone (tissu, cuir, métal…) quand elle diffère de celle par défaut. */
  readonly materials?: Partial<Record<ZoneName, MaterialKind>>;
}

export type VfxTheme = 'wind' | 'feather' | 'ember' | 'pearl';

/** Nombre de couleurs alternatives proposées par personnage. */
export const PALETTE_COUNT = 8;

/**
 * Couleur alternative de chaque joueur : celle choisie, ou, à défaut, une couleur différente pour
 * chaque joueur qui a pris le même personnage. Logique pure.
 */
export function distinctPalettes(
  fighters: readonly string[],
  chosen: readonly (number | undefined)[] = [],
): number[] {
  const out: number[] = [];
  fighters.forEach((id, i) => {
    const wanted = chosen[i];
    const taken = new Set(out.filter((_, j) => fighters[j] === id));
    // Couleur voulue, ou la suivante qui reste libre pour ce personnage.
    let p = wanted ?? 0;
    while (taken.has(p) && taken.size < PALETTE_COUNT) p = (p + 1) % PALETTE_COUNT;
    out.push(p);
  });
  return out;
}

const SKIN = 0xf0c4a0;
const HAIR = 0x3a2a22;
const DARK = 0x2b2f3a;
const LIGHT = 0xf3efe6;

/** Zones libres pour les couleurs fixes des pièces, dans l'ordre. */
const FIXED_ZONES: readonly ZoneName[] = ['accent', 'dark', 'light'];

/** Zone de couleur d'une pièce du mannequin. */
function zoneOf(color: MannequinColor, fixed: readonly number[]): ZoneName {
  if (color === 'primary' || color === 'secondary' || color === 'player') return color;
  const i = fixed.indexOf(color);
  return FIXED_ZONES[Math.min(i < 0 ? 0 : i, FIXED_ZONES.length - 1)]!;
}

/** Couleurs fixes des pièces, dans l'ordre d'apparition, sans doublon. */
function fixedColors(parts: readonly MannequinPart[]): number[] {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p.color === 'number' && !out.includes(p.color)) out.push(p.color);
  }
  return out;
}

/**
 * Palette d'un joueur : une couleur 0xRRGGBB par zone, dans l'ordre de `ZONES`. `variant` choisit
 * l'une des couleurs alternatives du style.
 */
export function paletteOf(style: FigurineStyle | undefined, player: number, variant = 0): number[] {
  const playerColor = PLAYER_COLORS[player % PLAYER_COLORS.length]!;
  const fixed = fixedColors(style?.parts ?? []);
  const base: Record<ZoneName, number> = {
    primary: style?.primary ?? playerColor,
    secondary: style?.secondary ?? LIGHT,
    skin: SKIN,
    hair: HAIR,
    accent: fixed[0] ?? style?.secondary ?? LIGHT,
    dark: fixed[1] ?? DARK,
    light: fixed[2] ?? LIGHT,
    player: playerColor,
  };
  const alternatives = style?.palettes ?? [];
  const alternative = alternatives.length > 0 ? alternatives[variant % alternatives.length] : {};
  const colors = { ...base, ...style?.palette, ...alternative };
  return ZONES.map((z) => colors[z]);
}

/**
 * Proportions héroïques (SPEC-finition.md, phase 2) : tête, mains et pieds plus grands que ceux du
 * mannequin, pour des silhouettes lisibles à distance de jeu. Seule l'apparence change : les
 * hitbox viennent de la simulation, jamais des os.
 */
export const HEAD_BOOST = 1.16;
export const HAND_BOOST = 1.35;
export const FOOT_BOOST = 1.12;

/** Dimensions de la figurine : celles du mannequin, tête agrandie (visage, cheveux, coiffe). */
export function figurineDims(d: Dims): Dims {
  return { ...d, headRadius: d.headRadius * HEAD_BOOST };
}

/** Repère de la main (poignet à l'origine, doigts vers −y) : articulations des doigts et du pouce. */
export function handJoints(d: Dims): { knuckle: number; thumb: [number, number, number] } {
  const a = d.armThickness;
  return { knuckle: -a * 0.62, thumb: [a * 0.3, -a * 0.18, 0] };
}

/**
 * Main : paume, quatre doigts sur l'os des doigts (qui se replient pour le poing), pouce sur le
 * sien. Décrite à la taille du mannequin ; `HAND_BOOST` l'agrandit ensuite autour du poignet.
 */
function handParts(d: Dims): SculptPart[] {
  const a = d.armThickness;
  const fingerR = a * 0.085;
  const parts: SculptPart[] = [
    {
      bone: 'handF',
      shape: 'box',
      zone: 'skin',
      center: [0, -a * 0.33, 0],
      size: [a * 0.38, a * 0.33, a * 0.2],
      round: a * 0.16,
      blend: 0.012,
      mirror: true,
    },
  ];
  for (const k of [-1.5, -0.5, 0.5, 1.5]) {
    const x = k * fingerR * 2.1;
    const len = a * (0.4 - Math.abs(k) * 0.05);
    parts.push({
      bone: 'fingersF',
      shape: 'capsule',
      zone: 'skin',
      from: [x, fingerR * 0.5, 0],
      to: [x * 1.05, -len, 0],
      radius: fingerR,
      radiusTo: fingerR * 0.85,
      blend: 0.004,
      mirror: true,
    });
  }
  parts.push({
    bone: 'thumbF',
    shape: 'capsule',
    zone: 'skin',
    from: [0, 0, 0],
    to: [a * 0.14, -a * 0.3, 0],
    radius: a * 0.1,
    radiusTo: a * 0.085,
    blend: 0.008,
    mirror: true,
  });
  return parts;
}

/** Os dont les volumes grandissent avec la tête, la main ou le pied, et le facteur. */
const BOOSTS: Readonly<Partial<Record<BoneName, number>>> = {
  head: HEAD_BOOST,
  tail1: HEAD_BOOST,
  tail2: HEAD_BOOST,
  handF: HAND_BOOST,
  handB: HAND_BOOST,
  fingersF: HAND_BOOST,
  fingersB: HAND_BOOST,
  thumbF: HAND_BOOST,
  thumbB: HAND_BOOST,
  footF: FOOT_BOOST,
  footB: FOOT_BOOST,
};

/** Agrandit une pièce autour de l'origine du repère où elle est décrite (cou, poignet, cheville). */
function boosted(part: SculptPart): SculptPart {
  const k = BOOSTS[part.frame ?? part.bone];
  if (k === undefined) return part;
  const v = (p: readonly [number, number, number] | undefined) =>
    p === undefined ? undefined : ([p[0] * k, p[1] * k, p[2] * k] as const);
  const n = (x: number | undefined) => (x === undefined ? undefined : x * k);
  return {
    ...part,
    ...(part.from !== undefined ? { from: v(part.from) } : {}),
    ...(part.to !== undefined ? { to: v(part.to) } : {}),
    ...(part.center !== undefined ? { center: v(part.center) } : {}),
    ...(part.size !== undefined ? { size: v(part.size) } : {}),
    ...(part.radius !== undefined ? { radius: n(part.radius) } : {}),
    ...(part.radiusTo !== undefined ? { radiusTo: n(part.radiusTo) } : {}),
    ...(part.round !== undefined ? { round: n(part.round) } : {}),
  } as SculptPart;
}

/**
 * Régions maillées à part, chacune à sa finesse : la tête (visage, cheveux) et surtout les mains
 * (doigts) demandent des cellules plus petites que le reste du corps.
 */
export const MESH_REGIONS: readonly {
  readonly bones: readonly BoneName[];
  readonly cell: number;
}[] = [
  { bones: ['head', 'tail1', 'tail2'], cell: 1 / 100 },
  {
    bones: ['handF', 'handB', 'fingersF', 'fingersB', 'thumbF', 'thumbB'],
    cell: 1 / 170,
  },
];

/** Volumes du corps commun, d'après les dimensions du personnage. */
export function humanoid(d: Dims): SculptPart[] {
  const r = d.headRadius;
  const tw = d.torsoWidth;
  const td = d.torsoDepth;
  const arm = d.armThickness;
  const leg = d.legThickness;
  return [
    // Tronc : bassin, ventre, poitrine, fondus ensemble.
    {
      bone: 'hips',
      shape: 'ellipsoid',
      zone: 'primary',
      center: [0, 0.01, 0],
      size: [tw * 0.55, 0.075, td * 0.62],
    },
    {
      bone: 'spine',
      shape: 'capsule',
      zone: 'primary',
      from: [0, 0.03, 0],
      to: [0, 0.2, 0],
      radius: tw * 0.5,
      radiusTo: tw * 0.55,
      blend: 0.05,
    },
    {
      bone: 'spine',
      shape: 'ellipsoid',
      zone: 'primary',
      center: [0.004, 0.25, 0],
      size: [tw * 0.6, 0.11, td * 0.66],
      blend: 0.05,
    },
    // Épaules arrondies, à la jonction des bras.
    {
      bone: 'spine',
      shape: 'ellipsoid',
      zone: 'secondary',
      center: [0, 0.3, d.armSide * 0.82],
      size: [arm * 0.75, arm * 0.7, arm * 0.75],
      blend: 0.03,
      mirror: true,
    },
    {
      bone: 'neck',
      shape: 'capsule',
      zone: 'skin',
      from: [0, -0.02, 0],
      to: [0.004, 0.03, 0],
      radius: 0.032,
      blend: 0.025,
    },
    // Tête : crâne, mâchoire, nez, cheveux.
    {
      bone: 'head',
      shape: 'ellipsoid',
      zone: 'skin',
      center: [0.006, r * 1.02, 0],
      size: [r * 0.98, r * 1.0, r * 0.92],
      blend: 0.02,
    },
    {
      bone: 'head',
      shape: 'ellipsoid',
      zone: 'skin',
      center: [r * 0.14, r * 0.64, 0],
      size: [r * 0.66, r * 0.46, r * 0.64],
      blend: 0.04,
    },
    {
      bone: 'head',
      shape: 'ellipsoid',
      zone: 'skin',
      center: [r * 0.93, r * 0.9, 0],
      size: [r * 0.13, r * 0.16, r * 0.11],
      blend: 0.03,
    },
    {
      bone: 'head',
      shape: 'ellipsoid',
      zone: 'hair',
      center: [-r * 0.22, r * 1.26, 0],
      size: [r * 0.9, r * 0.78, r * 0.97],
      blend: 0.012,
    },
    // Bras : épaule, biceps, avant-bras, main.
    {
      bone: 'upperArmF',
      shape: 'capsule',
      zone: 'secondary',
      from: [0, -0.01, 0],
      to: [0, -d.upperArm, 0],
      radius: arm * 0.56,
      radiusTo: arm * 0.46,
      mirror: true,
    },
    {
      bone: 'forearmF',
      shape: 'capsule',
      zone: 'skin',
      from: [0, 0, 0],
      to: [0, -d.forearm * 0.95, 0],
      radius: arm * 0.47,
      radiusTo: arm * 0.38,
      blend: 0.02,
      mirror: true,
    },
    ...handParts(d),
    // Jambes : cuisse, mollet, pied.
    {
      bone: 'thighF',
      shape: 'capsule',
      zone: 'primary',
      from: [0, 0, 0],
      to: [0, -d.thigh, 0],
      radius: leg * 0.62,
      radiusTo: leg * 0.5,
      mirror: true,
    },
    {
      bone: 'shinF',
      shape: 'capsule',
      zone: 'primary',
      from: [0, 0, 0],
      to: [0, -d.shin + 0.02, 0],
      radius: leg * 0.5,
      radiusTo: leg * 0.4,
      blend: 0.025,
      mirror: true,
    },
    {
      bone: 'footF',
      shape: 'box',
      zone: 'dark',
      center: [0.03, -0.006, 0],
      size: [0.058, 0.024, leg * 0.42],
      round: 0.02,
      blend: 0.02,
      mirror: true,
    },
  ];
}

/** Pièces du mannequin converties en boîtes arrondies, chacune sur l'os qui la porte. */
export function partsAsSculpt(d: Dims, parts: readonly MannequinPart[]): SculptPart[] {
  const fixed = fixedColors(parts);
  return parts.map((p): SculptPart => {
    const onHead = p.anchor === 'head';
    const s = onHead ? d.headScale : 1;
    const half: [number, number, number] = [
      (p.width / 2) * s,
      (p.height / 2) * s,
      (p.depth / 2) * s,
    ];
    return {
      bone: onHead ? 'head' : p.anchor === 'torso' ? 'spine' : 'hips',
      shape: 'box',
      zone: zoneOf(p.color, fixed),
      // La tête du mannequin est centrée à un rayon au-dessus du cou, comme celle de la figurine.
      center: [p.x * s, p.y * s + (onHead ? d.headRadius : 0), p.z * s],
      size: half,
      rotation: -p.angle,
      round: Math.min(...half) * 0.45,
      blend: 0.006,
      ...(p.mirror === true ? { mirror: true } : {}),
    };
  });
}

/**
 * Tous les volumes d'une figurine : le corps commun, puis les volumes propres au personnage. Un
 * personnage qui n'en a pas encore garde ses pièces de mannequin, converties en boîtes arrondies ;
 * ses volumes propres, quand il en a, les remplacent.
 */
export function figurineSculpt(d: Dims, style: FigurineStyle | undefined): Sculpt {
  const own = style?.sculpt;
  // `d` : dimensions du mannequin ; tête, mains et pieds sont agrandis ensuite (proportions
  // héroïques), les pièces du personnage avec eux.
  return [...humanoid(d), ...(own ?? partsAsSculpt(d, style?.parts ?? []))].map(boosted);
}
