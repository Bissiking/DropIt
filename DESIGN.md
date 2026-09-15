# DESIGN — DropIt

<!-- impeccable:design-schema 1 -->
> Enregistré depuis le monde construit : compteur de laboratoire nixie (seed 9a751a58 direction → challenger `signals-instruments-nixie-laboratory-counter`).

## Monde

Un compteur de laboratoire : tubes de verre nixie allumés néon orange dans un châssis d'acier noircie. Le monde est un instrument de mesure, pas une jolie page — chaque quantité visible est un savoir net, chaque état est un état de lampe/tube.

## Palette

- `--ink #070708` : accus de frappe, la masse.
- `--steel / --steel-2 / --steel-3` : trois degrés d'acier noirci (fond, panneau, contrôle).
- `--hairline #2c2c35` / `--hairline-bright #3a3a45` : règles gravées.
- `--text #e9e7e1` / `--text-dim #a3a09a` / `--text-faint #6f6d68` : encres chaudes (jamais gris froid).
- `--accent #ff6a1f` : le néon orange, **unique source de couleur**. Variantes `--accent-bright`, `--accent-soft`, `--accent-line` pour les états allumés. Tout le reste est achromatique.

## Typographie

- `--font-digits: "IBM Plex Mono"` : tous les chiffres, compteurs, etiquette gravée, slugs.
- `--font-ui: "IBM Plex Sans"` : texte d'interface, etiquettes de contrôle.
- Caps gravées : 10–12 px, suivi 0.16–0.22em, uppercase, en couleur `--text-faint` — jamais au-dessus d'un titre.

## Composants du monde

- **Tube nixie** (`.tube`) : enveloppe de verre (reflets biaisés), `--tube-h` réglable, chiffre allumé `--accent` avec triple halo, fantôme du même chiffre en `--ghost-lit` par derrière. États : `tube-off` (éteint), `tube-flicker` (porte-feu / expirant), allumé par défaut.
- **Banque** (`.bank-row`) : rangée de tubes + séparateurs `:` ; formats `HH:MM:SS` et `JJ:HH:MM` selon le temps restant.
- **Panneau partage** (`.share-panel`) : plaque d'acier, une seule élévation (bordure 1px + reflet interne), lampe d'état + compteur principal temps restant + compteur fichiers + fiche métadonnées + actions.
- **Châssis bar** (`.chassis-bar`) : fente d'aération en `repeating-linear-gradient` pour coder l'acier.
- **Tiroir de dépôt** (`.drop-vault`) : panneau en pointillés, `is-over` → bordure orange + fond `--accent-soft`.
- **Touches durée** : 4 touches `1h / 24h / 7j / 30j` à `[aria-pressed]`, point lumineux sur la sélection.
- **Barres** : `transform: scaleX` avec `--bar-pct` (pas de layout animé).

## États des partages (mappés au monde)

| État backend | Lampe | Tube du compteur | Actions |
| --- | --- | --- | --- |
| `active` | allumée | allumé | copier / régénérer / supprimer |
| `expiring` | clignotante | `tube-flicker` | idem |
| `expired` | éteinte | `tube-off` | copier seulement |
| `deleted` (rétention 24 h) | faible | `tube-off` + cap "Récupérable pendant" | restaurer / copier |
| `purgé` | absent du store | absent | — |

## Comportement

- Ticker local 1 s dans le dashboard (re-sync toutes les 30 s), compte à rebours 1 s sur la page publique.
- Motion : une seule passe de cross-fade par changement de chiffre ; `prefers-reduced-motion` tout coupe. Un seul moment d'auteur : l'allumage initial du tube du tiroir de dépôt.
- Responsive : la barre de châssis s'empile (nav pleine largeur), les rangées de fichiers passent en 2 colonnes, les banques gardent `--tube-h` réduit (`.tail`).
- Axes a11y : focus visible, `lang="fr"`, contrastes 4.5:1 texte, états en `aria-pressed` / `aria-label` sur les compteurs.

## Contraintes respectées

- Une seule élévation (bordure ou reflet), jamais d'ombre dure zéro-blur, jamais de halo zéro-offset.
- Pas de kicker au-dessus des titres ; pas de gradient text ; icônes SVG/stock, pas d'emoji.
- Fond texturé uniquement depuis le monde (l'acier ventilé), jamais de grille décorative générique.