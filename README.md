# Micro Racing — prototype

Course de petites voitures sur une table de cuisine géante (vue façon Micro Machines, effet tilt-shift).

## Jouer en ligne
Chaque push sur `main` reconstruit le jeu et le publie sur GitHub Pages
(`https://<ton-compte>.github.io/micro-racing/`), via `.github/workflows/deploy.yml`.

## Lancer
    npm install
    npm run dev      # serveur de dev avec rechargement instantané
    npm run build    # produit dist/index.html (un seul fichier, hébergeable partout)

## Structure
- `src/main.ts`    boucle de jeu, états (menu / départ / course / arrivée), caméra, HUD, qualité graphique
- `src/car.ts`     voiture : physique arcade (adhérence, drift + mini-turbo, sauts, chutes) + modèle low-poly
- `src/track.ts`   circuit (courbe fermée) : rendu de la route, bordures, ligne d'arrivée, progression
- `src/world.ts`   la cuisine : table, objets-obstacles, flaque de lait, sucre, tremplin, transparence des objets
- `src/input.ts`   entrées unifiées clavier / manette / tactile → actions abstraites
- `src/fx.ts`      particules (fumée, étincelles, flammes)
- `src/audio.ts`   sons synthétisés en WebAudio (aucun fichier audio)
- `src/textures.ts` textures générées par code (bois, carrelage, paquet de céréales…)

Les réglages de conduite sont regroupés dans `TUNING` (src/car.ts).

## Modèles 3D (v3)
Les modèles Meshy sont optimisés puis stockés dans `public/assets/*.model.json` (GLB encodé en base64).
- `tools/optim.mjs` : simplification (meshoptimizer), textures 1024 px en WebP, compression meshopt
  `node tools/optim2.mjs entree.glb sortie.glb <triangles> <tex couleur> <tex normale> <tex autres>` (HD : 90000 4096 2048 1024)
- `tools/heightfield.mjs` : calcule les cartes de hauteur (collisions, rampes) → `heightfields.json`
- `src/assets.ts` : chargement + classe `Prop` (objet posé avec sa carte de hauteur)
- La route est le tronçon droit Meshy répété et courbé le long du tracé (`Track.buildPieces`),
  le tracé suit le circuit peint sur la table.
