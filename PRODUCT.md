# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Express 5 + multer (hérité de la V1) ; front en HTML/CSS/JS vanilla servi en statique. Décision confirmée par l'utilisateur.

## Users

Membres d'une organisation connectés via SSO Kyros (guide : docs/sso-guide.md). Leur job : envoyer de gros fichiers (jusqu'à 20 Go+) à des destinataires, souvent externes ou peu techniques, sans friction de compte.

Destinataires secondaires : toute personne recevant un lien de partage, sans compte ni login.

## Product Purpose

DropIt est une version légère de WeTransfer ciblée sur les fichiers lourds (>20 Go). Il permet d'envoyer un lot de fichiers, de partager un lien identifiable, d'en suivre la durée de vie, et de le supprimer/régénérer. Le succès = envoyer un fichier volumineux en quelques clics et savoir précisément où en est le partage.

## Positioning

Un transfert d'entreprise greffé au SSO Kyros, fiable pour les très gros fichiers grâce à un upload resumable par chunks, avec une rétention de 24 h après suppression (repêchable), le tout derrière des liens courts.

## Operating Context

- Utilisation au navigateur, principalement sur postes de travail ; upload de fichiers parfois de plusieurs dizaines de Go sur réseaux instables → l'upload doit reprendre après coupure (chunks).
- Connexion utilisateur via SSO Kyros (mode `sso` recommandé par le guide) ; les liens de partage restent publics (hybride).
- Le serveur nettoie les fichiers expirés périodiquement.

## Capabilities and Constraints

Confirmées :
- Upload de fichiers jusqu'à 20 Go+ via upload resumable par chunks (init/upload/complete).
- Génération de liens de partage, idéalement courts (`creation de lien court` demandé).
- Suppression de liens, et régénération de liens.
- Métadonnées des fichiers (nom, taille, type, date…).
- Statut des partages : en cours / expiré / temps restant avant expiration.
- Durée de partage choisissable par l'émetteur.
- Après suppression, rétention de 24 h permettant de récupérer le partage.
- SSO Kyros : tout est sous SSO SAUF l'accès aux liens de partage (hybride).

Contraintes :
- Stack imposée : Express + front vanilla (pas de framework front).
- `.gitignore` exclut déjà `uploads`.
- V1 (server.js / public/index.html) supprimée du working tree ; git history conserve l'ancien code comme référence.

Non décidées : persistance des métadonnées (stockage fichier JSON vs DB), limites d'expiration par défaut, quotas par utilisateur.

## Brand Commitments

- Nom : DropIt.
- Fichier clés/dirigeants : Kyros (SSO). Aucune autre identité graphique imposée.
- Aucun engagement de marque additionnel déclaré.

## Evidence on Hand

- docs/sso-guide.md : protocole exact d'intégration Kyros (authorize/token/callback, JWT HS256, variables d'env préfixées).
- Aucune autre donnée produit, copie de marque, ou asset de contenu. Ne pas inventer de témoignages, clients, pricing.

## Product Principles

1. La fiable précédente la simple : l'upload resumable est la promesse, pas une option.
2. Le lien est le produit : court, partageable, dont l'état est toujours lisible par le propriétaire.
3. Le SSO protège l'outil, jamais le lien partagé.
4. La rétention répare les erreurs : une suppression est réversible 24 h.
5. Léger à déployer et à comprendre : vanilla, sans superflu.

## Accessibility & Inclusion

Aucune exigence spécifique confirmée au-delà du standard web (clavier, contraste, `lang="fr"`). Double alphabet : texte UI en français.