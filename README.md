# DropIt · 1.1.0

Transfert de fichiers lourds (jusqu'à 40 Go par fichier) pour les équipes, relié au SSO Kyros. Version allégée de type WeTransfer, avec upload resumable par chunks, liens courts, durée de vie choisissable et rétention de 24 h après suppression.

## Démarrage

```bash
npm install
cp .env.example .env   # renseigner le SSO Kyros, Kyros v4 obligatoire
npm run dev            # ou npm start
```

Puis ouvrir `http://localhost:3000`.

Node ≥22.13 requis. Kyros v4 est obligatoire, y compris en développement. Voir [migration 1.1.0](DOCS/RELEASE_1.1.0.md) pour adapter une ancienne inscription. Les sessions sont maintenant persistantes et renouvelées automatiquement.

## Fonctionnalités

- **Upload resumable par chunks** (8 Mo) : les chunks reçus sont conservés, un envoi interrompu reprend au bon index (interrogation `/api/upload/:id/status`).
- **Liens courts** (`/d/<slug>`) + régénération : un lien régénéré invalide immédiatement l'ancien (404).
- **Durée de partage** au choix : `1h`, `24h`, `7j`, `30j`.
- **Statuts dérivés du temps** : `en cours`, `bientôt expiré`, `expiré`, `supprimé (récupérable)`, `purgé`.
- **Rétention 24 h** : après suppression, le partage reste récupérable 24 h, puis fichiers détruits et entrée purgée.
- **Métadonnées** : taille, type MIME, nombre de fichiers, empreinte SHA-256, dates.
- **SSO Kyros v4** : tout est derrière le SSO SAUF les pages/liens de téléchargement publics (`/d/:slug`, `/dl/:slug/:fileId`).
- **Nettoyage automatique** : partages expirés, uploads abandonnés, fichiers orphelins.

## SSO Kyros

Flux v4 PAR/PKCE, contrôle state/issuer, signature RS256/JWKS et audiences. Sessions opaques HttpOnly en SQLite, jetons chiffrés, refresh sérialisé. Sauvegarder `data/auth-master.key` avec les bases SQLite et les fichiers. Configuration initiale : `.env.example`. Une instance Node par stockage.

## Applications connectées

Dans `/integrations`, créez la clé d’application pour Liora et gérez vos autorisations personnelles. Clé applicative + consentement individuel sont nécessaires ; un ID utilisateur seul n’accorde aucun accès. [Contrat API déléguée](DOCS/LIORA_API.md).

## API

| Méthode & route | Accès | Rôle |
| --- | --- | --- |
| `GET/POST` `/auth/login`, `/auth/callback`, `/auth/logout` | public | SSO |
| `GET /api/me`, `/api/health` | SSO | profile, santé |
| `POST /api/upload/init` | SSO | ouvre un upload (taille, chunkSize) |
| `GET /api/upload/:id/status` | SSO | liste des chunks déjà reçus (reprise) |
| `POST /api/upload/:id/chunk/:n` | SSO | dépose un chunk (octets bruts) |
| `POST /api/upload/:id/complete` | SSO | assemble, calcue SHA-256, rend le descripteur |
| `POST /api/upload/:id/abort` | SSO | abandonne |
| `GET/POST` `/api/shares…` | SSO | liste, crée, supprime, restaure, régénère |
| `GET /api/d/:slug` | public | infos publiques d'un partage |
| `GET /dl/:slug/:fileId` | public | téléchargement |

## Structure

```
server.js          Écoute, monte routes et maintenance
src/config.js      Configuration (.env)
src/store.js       Persistance JSON atomique (partages)
src/auth.js        SSO Kyros v4 (session SQLite chiffrée)
src/uploads.js     Upload resumable par chunks
src/shares.js      Cycle de vie partages + statuts + slug
src/download.js    API publique de téléchargement
src/maintenance.js Balayage horaire (expirés, orphelins)
public/            Front vanilla (monde "nixie", voir DESIGN.md)
scripts/seed.mjs   Génération de données de démo via l'API
docs/ideas.md      Backlog de propositions produit
docs/sso-guide.md  Guide d'intégration Kyros (fourni)
```

## Idées ensuite

Voir `docs/ideas.md` : téléchargement ZIP en streaming, e-mail de prolongation, QR code, mots de passe sur liens, dossiers, reprise navigateur, SSE, prévisualisations, antivirus…

## Notes

- Limite de chunk côté serveur : `CHUNK_SIZE` (8 Mo). Ne pas dépasser ~2 Mo de body JSON sur les autres routes.
- Les partages expirés gardent leur entrée (historique) pendant la grâce (6 h) avant que les fichiers soient physiquement détruits.
- La source du monde visuel et sa justification sont dans PRODUCT.md, DESIGN.md et le contrat en entête de `public/index.html`.