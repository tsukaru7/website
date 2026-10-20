# Ce site te regarde

Un site vivant. Il te voit, il te suit, il se souvient de toi.
Zéro dépendance, zéro framework, zéro image : tout est calculé en direct, dans ton navigateur.

## Les cinq actes

| # | Acte | Ce qui se passe | Technique |
|---|------|-----------------|-----------|
| 0 | **Le réveil** | Le site se présente en te décrivant : heure, ville, système, écran, batterie, nombre de visites. | `Intl`, `navigator`, Battery API, `localStorage` |
| 1 | **L'œil** | Un œil géant suit ton curseur, cligne, s'endort si tu ne bouges plus, sursaute quand tu reviens sur l'onglet. La lumière vient de ton curseur. | Fragment shader GLSL : intersection rayon/sphère analytique, iris procédural (bruit fractal), cornée, paupières, cils |
| 2 | **La matière** | Des milliers de particules forment des mots (dont ta ville et ton heure) et fuient ta main. | Physique ressort-amortisseur sur `Float32Array`, rendu pixel par pixel dans un `ImageData` |
| 3 | **Le vivant** | Ton passage sème des colonies qui grandissent, se divisent, envahissent l'écran. 5 espèces. | Réaction-diffusion de Gray-Scott sur GPU, ping-pong de textures flottantes WebGL2, éclairage par gradient |
| 4 | **Le son** | Ton curseur joue une gamme pentatonique. Si tu arrêtes, le site joue tout seul. | Synthé Web Audio, réverbération par convolution générée, delay, analyseur de spectre |
| 5 | **La mémoire** | Tout ce que le site a remarqué : distance parcourue par ta souris (en vrais mètres), clics, notes, clignements, visites. | Statistiques en direct, persistées localement — rien ne quitte ton navigateur |

## Les secrets

- Change d'onglet : le titre et l'icône de l'onglet changent, et l'œil compte ton absence.
- Copie du texte, fais un clic droit, redimensionne la fenêtre… il remarque.
- Ouvre la console.
- ↑ ↑ ↓ ↓ ← → ← → B A

## Lancer en local

Les modules ES ont besoin d'un serveur HTTP (pas de `file://`) :

```sh
python3 -m http.server 8000
# puis http://localhost:8000
```

## Mettre en ligne (GitHub Pages)

Settings → Pages → *Deploy from a branch* → choisir la branche et le dossier `/ (root)`.
Le site est 100 % statique, il marche aussi tel quel sur Netlify, Vercel ou Cloudflare Pages.

## Structure

```
index.html        les cinq actes
css/style.css
js/main.js        orchestration, suivi du visiteur, secrets
js/state.js       état partagé + mémoire (localStorage)
js/intro.js       le réveil
js/gl.js          mini-boîte à outils WebGL2
js/eye.js         l'œil (shader)
js/matter.js      les particules
js/life.js        Gray-Scott sur GPU
js/audio.js       le synthétiseur
js/sound.js       l'instrument
js/memory.js      la mémoire
```
