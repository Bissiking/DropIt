# DropIt — Idées produit (backlog)

Candidatures pour le futur, triées par impact pour l'usage réel (gros fichiers d'entreprise). Rien ici n'est engagé : ce sont des propositions à valider.

## 1. Destination courte personnalisée

Le slug court est aléatoire (`dropit.example/d/a7b3x2`). Proposer à l'émetteur un **nom lisible et retypable** en option :
`dropit.example/d/blast-results-231`
- Moins de confusions que 8 caractères sans sens.
- Nécessite une check de disponibilité + normalisation (minuscules, tirets, max 48 car.).

## 2. "Tout télécharger" en ZIP en streaming

Côté destinataire, chaque fichier a son bouton. Ajouter **un seul clic "Tout récupérer"** qui streame une archive ZIP sans stocker l'archive sur disque (flux `archiver` vers la réponse). Pour des partages de plusieurs Go c'est le geste le plus attendu après WeTransfer.

## 3. E-mail d'alerte de fin de vie

Avant l'expiration (J-3, J-1, H-6), un mail à l'émetteur : "ton partage expire bientôt, prolonger ?". Un lien de prolongement en un clic. C'est l'usage du WeTransfer Pro qui fidélise le plus, sans abonnement.

## 4. Téléchargements comptés + QR

- Compter les téléchargements par fichier (et les visions de page du lien).
- Générer un **QR code** sur l'écran de résultat (webcrypto → canvas, zéro dépendance) pour un partage "écran vers mobile".
- Option "stop after N downloads" : garde-fou anti-fuite pour partages sensibles.

## 5. Mot de passe sur le lien

Option serveur : un lien public protégé par un code que le destinataire saisit. Le hash du mot de passe est stocké, jamais le mot de passe. Idéal pour la donnée sensible transmise hors SSO (le destinataire des fichiers est souvent externe).

## 6. Mode "dossier" et sélection par dossier

Aujourd'hui on envoie plusieurs fichiers plats. Ajouter la **préservation de la hiérarchie de dossiers** lors du drag & drop (structure relative dans le partage). Le destinataire télécharge à l'identique.

## 7. Reprise d'upload côté navigateur (les vrais 20+ Go)

Le backend recommence déjà les chunks reçus, mais la page doit **survivre au rechargement**. Persister les `uploadId` et indices reçus dans `localStorage`, et proposer "Reprendre l'envoi interrompu ?" au retour.

## 8. Notifications temps réel (SSE)

Mettre à jour le dashboard en push (`Server-Sent Events`) plutôt qu'en polling 30 s : un partage expiré, sa lampe s'éteint vite. Léger, unidirectionnel, sans dépendance extra.

## 9. Fichiers volumineux : prix du "pseudo-streaming de progression"

Pour l'upload des gros soleils, afficher **vitesse instantanée** (Mo/s) + **ETA** calculés à partir d'une fenêtre glissante des derniers chunks. Motive à laisser tourner, protège de l'abandon.

## 10. Interface légère destinataire : prévisualisations

Pour les types courants (images, PDF, texte), un **aperçu inline** sur la page `/d/:slug` sans le télécharger d'abord. Effet positif sur la confiance du destinataire ("je sais ce que je reçois").

## 11. Audit & cycle de vie complet

Tableau d'audit par partage : création, consommation de lien (fetches OK), expirations, suppressions, restaurations, purges. C'est ce qui rend un outil d'entreprise contrôlable (et vendable).

## 12. Rétention différenciée

La rétention de 24 h est un minimum. Proposer selon la politique : `24h | 7j | jamais` pour les partages supprimés. Configuration via `.env`, applicative, pas par l'utilisateur.

## 13. Anti-virus et quarantine

Scan antivirus au moment du `complete` (ClamAV) : statut visible par fichier (`en analyse / propre / infecté`), téléchargement bloqué si infecté. Non négociable à partir du moment où des fichiers externes entrent dans un outil d'entreprise.

## 14. Quotas et limites par utilisateur

Sans gérer des comptes, positionner des limites par identité SSO : volume total en ligne, nombre de partages simultanés, durée max. Backend simple (compteur par `sub`), UI en barres de "capacité du chauffage".

## 15. Logique "invité" pour les liens

Rendre `POST /api/d/:slug` capable d'accepter un transfert *à destination inverse* (le destinataire dépose à son tour), dans le même tiroir. Un mini "exchange" sans serveur supplémentaire.

---

### Pris pour acquis dans la v1 (ne pas re-proposer)
- Upload resumable par chunks (8 Mo, reprise déterministe, `status` des chunks reçus).
- Liens courts + régénération (le lien ancien devient 404).
- Suppression avec rétention 24 h + restauration.
- Statuts dérivés du temps : `en cours`, `bientôt expiré`, `expiré`, `supprimé (récupérable)`, `purgé`.
- Durée de partage au choix (`1h / 24h / 7j / 30j`).
- SSO hybride : tout sauf les liens de téléchargement est derrière Kyros.
- Nettoyage automatique des expirés et des uploads abandonnés.