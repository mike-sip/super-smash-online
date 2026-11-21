# Sources des assets

Tous les fichiers de ce dossier viennent de sources libres. Aucun n'exige d'attribution ; la liste sert à la traçabilité (spec : [SPEC-finition.md](../SPEC-finition.md)).

- **Poly Haven** (https://polyhaven.com) : textures et HDRI sous licence **CC0** (domaine public), https://polyhaven.com/license.
- **Google Fonts** (https://github.com/google/fonts) : police Lilita One, © 2011 Juan Montoreano, sous **SIL Open Font License 1.1** (texte dans `fonts/OFL.txt`).

Récupérés le 2026-11-19, relus avant intégration (contenu, format, taille conforme à l'API de la source).

Dossiers servis à la racine du jeu et de la démo (`publicDir` de Vite) : `/textures/…`, `/hdri/…`, `/fonts/…`.

Textures : résolution 1K ; `color` (couleur, sRGB), `normal` (relief, convention OpenGL), `arm` (occlusion, rugosité, métal dans R, G, B).

| Fichier | Stage | Source | Taille |
|---|---|---|---|
| `textures/sandstone_blocks_05/color.jpg` | belvedere | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/sandstone_blocks_05/sandstone_blocks_05_diff_1k.jpg | 621 Ko |
| `textures/sandstone_blocks_05/normal.jpg` | belvedere | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/sandstone_blocks_05/sandstone_blocks_05_nor_gl_1k.jpg | 1196 Ko |
| `textures/sandstone_blocks_05/arm.jpg` | belvedere | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/sandstone_blocks_05/sandstone_blocks_05_arm_1k.jpg | 157 Ko |
| `textures/sandstone_cracks/color.jpg` | belvedere | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/sandstone_cracks/sandstone_cracks_diff_1k.jpg | 680 Ko |
| `textures/sandstone_cracks/normal.jpg` | belvedere | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/sandstone_cracks/sandstone_cracks_nor_gl_1k.jpg | 1277 Ko |
| `textures/sandstone_cracks/arm.jpg` | belvedere | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/sandstone_cracks/sandstone_cracks_arm_1k.jpg | 217 Ko |
| `textures/weathered_brown_planks/color.jpg` | belvedere | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/weathered_brown_planks/weathered_brown_planks_diff_1k.jpg | 221 Ko |
| `textures/weathered_brown_planks/normal.jpg` | belvedere | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/weathered_brown_planks/weathered_brown_planks_nor_gl_1k.jpg | 218 Ko |
| `textures/weathered_brown_planks/arm.jpg` | belvedere | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/weathered_brown_planks/weathered_brown_planks_arm_1k.jpg | 199 Ko |
| `textures/coast_sand_rocks_02/color.jpg` | belvedere | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/coast_sand_rocks_02/coast_sand_rocks_02_diff_1k.jpg | 820 Ko |
| `textures/coast_sand_rocks_02/normal.jpg` | belvedere | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/coast_sand_rocks_02/coast_sand_rocks_02_nor_gl_1k.jpg | 1236 Ko |
| `textures/coast_sand_rocks_02/arm.jpg` | belvedere | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/coast_sand_rocks_02/coast_sand_rocks_02_arm_1k.jpg | 847 Ko |
| `textures/dark_rock_02/color.jpg` | recif | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/dark_rock_02/dark_rock_02_diff_1k.jpg | 579 Ko |
| `textures/dark_rock_02/normal.jpg` | recif | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/dark_rock_02/dark_rock_02_nor_gl_1k.jpg | 1005 Ko |
| `textures/dark_rock_02/arm.jpg` | recif | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/dark_rock_02/dark_rock_02_arm_1k.jpg | 645 Ko |
| `textures/brown_planks_03/color.jpg` | canal | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brown_planks_03/brown_planks_03_diff_1k.jpg | 557 Ko |
| `textures/brown_planks_03/normal.jpg` | canal | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brown_planks_03/brown_planks_03_nor_gl_1k.jpg | 505 Ko |
| `textures/brown_planks_03/arm.jpg` | canal | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brown_planks_03/brown_planks_03_arm_1k.jpg | 123 Ko |
| `textures/cobblestone_floor_04/color.jpg` | canal | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/cobblestone_floor_04/cobblestone_floor_04_diff_1k.jpg | 562 Ko |
| `textures/cobblestone_floor_04/normal.jpg` | canal | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/cobblestone_floor_04/cobblestone_floor_04_nor_gl_1k.jpg | 764 Ko |
| `textures/cobblestone_floor_04/arm.jpg` | canal | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/cobblestone_floor_04/cobblestone_floor_04_arm_1k.jpg | 228 Ko |
| `textures/red_brick/color.jpg` | canal | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/red_brick/red_brick_diff_1k.jpg | 748 Ko |
| `textures/red_brick/normal.jpg` | canal | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/red_brick/red_brick_nor_gl_1k.jpg | 1027 Ko |
| `textures/red_brick/arm.jpg` | canal | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/red_brick/red_brick_arm_1k.jpg | 685 Ko |
| `textures/rock_face_03/color.jpg` | geysers | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_face_03/rock_face_03_diff_1k.jpg | 905 Ko |
| `textures/rock_face_03/normal.jpg` | geysers | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_face_03/rock_face_03_nor_gl_1k.jpg | 1120 Ko |
| `textures/rock_face_03/arm.jpg` | geysers | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_face_03/rock_face_03_arm_1k.jpg | 775 Ko |
| `textures/rock_pitted_mossy/color.jpg` | geysers | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_pitted_mossy/rock_pitted_mossy_diff_1k.jpg | 1062 Ko |
| `textures/rock_pitted_mossy/normal.jpg` | geysers | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_pitted_mossy/rock_pitted_mossy_nor_gl_1k.jpg | 1111 Ko |
| `textures/rock_pitted_mossy/arm.jpg` | geysers | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_pitted_mossy/rock_pitted_mossy_arm_1k.jpg | 756 Ko |
| `textures/large_floor_tiles_02/color.jpg` | test | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/large_floor_tiles_02/large_floor_tiles_02_diff_1k.jpg | 545 Ko |
| `textures/large_floor_tiles_02/normal.jpg` | test | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/large_floor_tiles_02/large_floor_tiles_02_nor_gl_1k.jpg | 224 Ko |
| `textures/large_floor_tiles_02/arm.jpg` | test | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/large_floor_tiles_02/large_floor_tiles_02_arm_1k.jpg | 189 Ko |
| `hdri/belfast_sunset_puresky.hdr` | belvedere | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/belfast_sunset_puresky_1k.hdr | 1162 Ko |
| `hdri/kloppenheim_02.hdr` | recif | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloppenheim_02_1k.hdr | 1700 Ko |
| `hdri/qwantani_dusk_2_puresky.hdr` | canal | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/qwantani_dusk_2_puresky_1k.hdr | 1139 Ko |
| `hdri/kiara_9_dusk.hdr` | geysers | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kiara_9_dusk_1k.hdr | 1473 Ko |
| `hdri/kloofendal_48d_partly_cloudy_puresky.hdr` | test | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr | 1401 Ko |
| `fonts/LilitaOne-Regular.ttf` | interface | https://raw.githubusercontent.com/google/fonts/main/ofl/lilitaone/LilitaOne-Regular.ttf | 27 Ko |
| `fonts/OFL.txt` | interface | https://raw.githubusercontent.com/google/fonts/main/ofl/lilitaone/OFL.txt | 4 Ko |

## Modèles des combattants

Format et conventions : [`fighters/README.md`](fighters/README.md).

| Fichier | Origine | Taille |
|---|---|---|
| `fighters/sorel/model.glb` | Créé dans le dépôt : sculpt et animations écrits à la main (`packages/render/tools/characters/sorel.ts`), exportés par `packages/render/tools/bake-character.ts` (aucune source externe) | 3876 Ko |
| `fighters/zephine/model.glb` | Créé dans le dépôt, de la même façon (`packages/render/tools/characters/zephine.ts`) | 3454 Ko |
| `fighters/ferroc/model.glb` | Créé dans le dépôt, de la même façon (`packages/render/tools/characters/ferroc.ts`) | 4641 Ko |
| `fighters/nacre/model.glb` | Créé dans le dépôt, de la même façon (`packages/render/tools/characters/nacre.ts`) | 4545 Ko |
