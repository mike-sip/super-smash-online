/**
 * Contrats de données consommés par la simulation. Le contenu réel (personnages, stages)
 * est fourni par les modules `fighters` et `stages-items`.
 *
 * Ces contrats grandissent avec les mécaniques : chaque phase du plan y ajoute les champs
 * dont elle a besoin, jamais par anticipation.
 *
 * Unités : distances en unités de jeu, vitesses en unités par frame, accélérations en unités
 * par frame², durées en frames (1/60 s).
 */
import type { Fx } from './fixed.ts';

export interface Vec2 {
  readonly x: Fx;
  readonly y: Fx;
}

/**
 * Capsule : segment de (x1, y1) à (x2, y2) épaissi de `radius`. Un cercle est une capsule dont
 * les deux extrémités coïncident. Coordonnées relatives aux pieds du combattant ; l'axe x est
 * inversé quand il regarde à gauche.
 */
export interface CapsuleDef {
  readonly x1: Fx;
  readonly y1: Fx;
  readonly x2: Fx;
  readonly y2: Fx;
  readonly radius: Fx;
}

export interface HitDef extends CapsuleDef {
  /** Première et dernière frame actives, incluses. La frame 1 est celle où l'attaque démarre. */
  readonly start: number;
  readonly end: number;
  /**
   * Groupe de 0 à 3. Une cible n'est touchée qu'une fois par groupe : donner des groupes
   * différents à des fenêtres successives produit un coup multiple.
   */
  readonly group: number;
  /** Dégâts en pourcentage. */
  readonly damage: Fx;
  /** Angle d'éjection en degrés : 0 vers l'avant, 90 vers le haut. */
  readonly angle: number;
  readonly baseKnockback: Fx;
  /** Part de l'éjection qui croît avec les dégâts de la cible ; fx(1) = 100 %. */
  readonly knockbackGrowth: Fx;
}

/** Autorise à enchaîner sur une autre attaque avant la fin de celle-ci. */
export interface CancelDef {
  readonly start: number;
  readonly end: number;
  /** Emplacement que l'input du joueur désignerait normalement (ex. M_JAB). */
  readonly on: number;
  /** Emplacement réellement lancé (ex. M_JAB2). */
  readonly to: number;
  /** Si vrai, l'annulation n'est possible que si l'attaque a touché. */
  readonly requiresHit: boolean;
}

/** Attaque chargeable : tant que le bouton est tenu, l'attaque reste sur `frame`. */
export interface ChargeDef {
  readonly frame: number;
  readonly maxFrames: number;
  /** Multiplicateur de dégâts à pleine charge ; fx(1.4) = +40 %. */
  readonly maxScale: Fx;
}

/** Entité créée par une attaque (projectile). Position et vitesse relatives au combattant. */
export interface SpawnDef {
  /** Frame de l'attaque où l'entité apparaît. Ne doit pas être la frame de charge. */
  readonly frame: number;
  /** Type d'entité : index dans `SimConfig.entities`, plus 1. */
  readonly kind: number;
  readonly x: Fx;
  readonly y: Fx;
  readonly velX: Fx;
  readonly velY: Fx;
}

/** Coup porté par une entité. L'angle est relatif à son sens de déplacement. */
export interface EntityHitDef {
  readonly damage: Fx;
  readonly angle: number;
  readonly baseKnockback: Fx;
  readonly knockbackGrowth: Fx;
}

/** Type d'entité : projectile ou objet. */
export interface EntityDef {
  readonly name: string;
  readonly radius: Fx;
  /** 0 pour une trajectoire rectiligne. */
  readonly gravity: Fx;
  /** Durée de vie en frames. */
  readonly lifetime: number;
  /** `ENTITY_PASS`, `ENTITY_DESTROY` ou `ENTITY_BOUNCE` au contact d'un bloc plein. */
  readonly stageCollision: number;
  /** Absent : l'entité ne blesse personne. */
  readonly hit?: EntityHitDef;
  /** Si vrai, l'entité disparaît au premier combattant touché ; sinon elle touche chacun une fois. */
  readonly destroyOnHit: boolean;
  /**
   * Absent : la zone de coup est un cercle de rayon `radius`. Présent : une capsule verticale de
   * cette hauteur, qui part de la position de l'entité vers le haut (jet de geyser).
   */
  readonly height?: Fx;
  /** Présent : l'entité est un objet, qu'on ramasse ou qui soigne au contact. */
  readonly item?: ItemDef;
}

/**
 * Comportement d'un objet. Un objet libre est posé ou tombe ; tenu, il suit son porteur ; lancé,
 * il frappe avec `EntityDef.hit` jusqu'à toucher quelqu'un ou le décor.
 *
 * La durée de vie (`EntityDef.lifetime`) ne s'écoule que lorsque l'objet est libre ou lancé.
 */
export interface ItemDef {
  /** Présent : objet de soin, consommé au contact ; il retire ces dégâts, sans descendre sous 0. */
  readonly heal?: Fx;
  /** Présent : objet à frapper ; les attaques normales du porteur deviennent ce coup. */
  readonly swing?: MoveDef;
  /** Vitesse donnée par un lancer vers l'avant, l'arrière ou le haut. */
  readonly throwSpeed: Fx;
  /** Lancé, il disparaît sur le premier combattant touché (sinon il rebondit et retombe). */
  readonly breakOnHit: boolean;
  /** Lancé, il se brise au premier contact, combattant ou décor. */
  readonly breakOnContact: boolean;
  /**
   * Type d'entité créé là où l'objet se brise, ou quand sa durée de vie s'achève (explosion).
   * Index dans `SimConfig.entities`, plus 1.
   */
  readonly burst?: number;
}

export interface MoveDef {
  readonly name: string;
  /** Durée totale. Le combattant redevient libre à la frame `totalFrames + 1`. */
  readonly totalFrames: number;
  /** Dans l'ordre de priorité : si plusieurs touchent la même cible, la première l'emporte. */
  readonly hits: readonly HitDef[];
  readonly cancels: readonly CancelDef[];
  readonly charge?: ChargeDef;
  readonly spawn?: SpawnDef;
  /** Lag d'atterrissage si le combattant touche le sol pendant cette attaque aérienne. */
  readonly landingLag?: number;
}

export interface GrabDef {
  readonly totalFrames: number;
  /** Première et dernière frame où la saisie peut prendre, incluses. */
  readonly start: number;
  readonly end: number;
  readonly box: CapsuleDef;
  /** Distance à laquelle la victime est tenue devant le combattant. */
  readonly holdX: Fx;
  /** Dégâts d'un coup porté pendant la prise, et délai entre deux coups. */
  readonly pummelDamage: Fx;
  readonly pummelFrames: number;
}

export interface ThrowDef {
  readonly totalFrames: number;
  /** Frame où la victime est lâchée et éjectée. */
  readonly releaseFrame: number;
  readonly damage: Fx;
  /** Angle d'éjection : 0 vers l'avant, 90 vers le haut, 180 vers l'arrière. */
  readonly angle: number;
  readonly baseKnockback: Fx;
  readonly knockbackGrowth: Fx;
}

/** Esquive : durée totale et frames d'intangibilité, première et dernière incluses. */
export interface DodgeDef {
  readonly totalFrames: number;
  readonly invStart: number;
  readonly invEnd: number;
  /** Vitesse de déplacement (roulade, esquive aérienne directionnelle). 0 pour l'esquive sur place. */
  readonly speed: Fx;
}

export interface FighterDef {
  readonly name: string;

  /** Résistance du bouclier plein, en points de dégâts. */
  readonly shieldMax: Fx;
  readonly spotDodge: DodgeDef;
  readonly roll: DodgeDef;
  readonly airDodge: DodgeDef;
  /** Lag d'atterrissage si le combattant touche le sol pendant une esquive aérienne. */
  readonly airDodgeLandingLag: number;
  /** Durée de la remontée simple et de la remontée en roulade depuis un rebord. */
  readonly ledgeGetupFrames: number;
  readonly ledgeRollFrames: number;
  /** Distance parcourue sur le stage par la remontée en roulade. */
  readonly ledgeRollDistance: Fx;
  readonly grab: GrabDef;
  /** Projections avant, arrière, haut, bas, dans cet ordre. */
  readonly throws: readonly [ThrowDef, ThrowDef, ThrowDef, ThrowDef];

  /** 100 = poids moyen. Plus lourd, moins éjecté. */
  readonly weight: Fx;
  /** Zones vulnérables du corps. */
  readonly hurtboxes: readonly CapsuleDef[];
  /** Attaques, indexées par emplacement (`M_*`). Un emplacement vide n'a pas d'attaque. */
  readonly moves: readonly (MoveDef | undefined)[];
  /** Durée du rétablissement au sol. */
  readonly techFrames: number;
  /** Durée à terre après un rétablissement manqué. */
  readonly downFrames: number;

  /** Demi-largeur du corps, pour les collisions avec les murs. */
  readonly halfWidth: Fx;
  /** Hauteur du corps, des pieds à la tête. */
  readonly height: Fx;

  /** Vitesse de marche stick à fond ; proportionnelle à l'inclinaison en dessous. */
  readonly walkSpeed: Fx;
  readonly walkAccel: Fx;
  /** Décélération au sol quand rien ne pousse le combattant. */
  readonly friction: Fx;
  /** Vitesse imposée pendant le dash initial. */
  readonly dashSpeed: Fx;
  readonly dashFrames: number;
  readonly runSpeed: Fx;
  readonly runAccel: Fx;
  /** Durée du freinage en sortie de course. */
  readonly brakeFrames: number;
  /** Durée du dérapage avant de repartir dans l'autre sens. */
  readonly turnFrames: number;

  /** Frames au sol entre l'appui sur saut et le décollage. */
  readonly jumpSquatFrames: number;
  /** Vitesse verticale du grand saut (bouton encore enfoncé au décollage). */
  readonly jumpVelocity: Fx;
  /** Vitesse verticale du petit saut (bouton relâché avant le décollage). */
  readonly shortHopVelocity: Fx;
  readonly doubleJumpVelocity: Fx;
  /** Nombre de sauts disponibles en l'air. */
  readonly airJumps: number;

  /** Vitesse horizontale maximale en l'air. */
  readonly airSpeed: Fx;
  readonly airAccel: Fx;
  /** Décélération horizontale en l'air, stick au neutre. */
  readonly airFriction: Fx;
  readonly gravity: Fx;
  readonly maxFallSpeed: Fx;
  /** Vitesse de chute imposée pendant une chute rapide. */
  readonly fastFallSpeed: Fx;
  /** Lag d'atterrissage après une chute sans attaque. */
  readonly landFrames: number;
}

/** Bloc plein : on marche dessus, on bute contre ses flancs et son dessous. */
export interface SolidDef {
  readonly x1: Fx;
  readonly y1: Fx;
  readonly x2: Fx;
  readonly y2: Fx;
}

/** Plateforme fine : traversable par le bas, et par le haut stick vers le bas. */
export interface PlatformDef {
  readonly x1: Fx;
  readonly x2: Fx;
  readonly y: Fx;
  /** Présent : la plateforme fait des allers-retours. Ses coordonnées sont alors celles du départ. */
  readonly motion?: PlatformMotionDef;
}

/**
 * Aller-retour d'une plateforme entre sa position de départ et ce départ décalé de (`dx`, `dy`),
 * adouci aux deux bouts. La position ne dépend que du numéro de frame : rien à sauvegarder.
 */
export interface PlatformMotionDef {
  readonly dx: Fx;
  readonly dy: Fx;
  /** Durée d'un aller-retour complet, en frames (au moins 2). */
  readonly period: number;
  /** Décalage dans le cycle à la frame 0, en frames. */
  readonly phase: number;
}

/** Segment d'où tombent les objets : ils apparaissent à la hauteur `y`, entre `x1` et `x2`. */
export interface ItemZoneDef {
  readonly x1: Fx;
  readonly x2: Fx;
  readonly y: Fx;
}

/**
 * Danger périodique : à chaque cycle, crée en (`x`, `y`) une entité sans propriétaire qui vit
 * `duration` frames. L'entité frappe comme tout coup d'entité (bouclier, intangibilité compris).
 */
export interface HazardDef {
  readonly x: Fx;
  readonly y: Fx;
  /** Type d'entité créé : index dans `SimConfig.entities`, plus 1. 0 : danger inactif. */
  readonly kind: number;
  readonly period: number;
  /** Frame du cycle où le jet commence, comptée depuis la frame 0. */
  readonly phase: number;
  readonly duration: number;
  /** Frames d'annonce avant le jet. La simulation l'ignore : c'est une indication pour le rendu. */
  readonly warning: number;
}

export interface StageDef {
  readonly name: string;
  /** Points d'apparition, dans l'ordre des joueurs. Il en faut au moins un par joueur. */
  readonly spawns: readonly Vec2[];
  readonly solids: readonly SolidDef[];
  readonly platforms: readonly PlatformDef[];
  /** Zones limites : un combattant qui en sort est KO. */
  readonly blast: {
    readonly left: Fx;
    readonly right: Fx;
    readonly top: Fx;
    readonly bottom: Fx;
  };
  /** Zones d'apparition des objets. Sans zone, aucun objet n'apparaît. */
  readonly itemSpawns?: readonly ItemZoneDef[];
  readonly hazards?: readonly HazardDef[];
}

/** Apparition des objets pendant le combat. */
export interface ItemSpawnDef {
  /** Objets possibles : type d'entité (index dans `SimConfig.entities` + 1) et poids du tirage. */
  readonly table: readonly { readonly kind: number; readonly weight: number }[];
  /** Délai entre deux apparitions, tiré entre ces bornes incluses, en frames. */
  readonly minInterval: number;
  readonly maxInterval: number;
  /** Au-delà de ce nombre d'objets présents, l'apparition est reportée au délai suivant. */
  readonly maxActive: number;
}
