# DropIt 1.1.0 — intégration Liora 0.3.0

16 septembre 2026. Ancienne version : 1.0.2.

## Modifications

- API applicative et autorisation personnelle : clés hashées, consentement, PKCE, codes à usage unique, jetons rotatifs, révocation et contrôle du propriétaire.
- Écran Applications connectées, accessible depuis la navigation : création/révocation des clients et retrait des autorisations personnelles.
- Consultation des fichiers des partages actifs et récupération explicite de leur lien public ; aucun droit délégué d’upload/suppression.
- Kyros **SSO v4 uniquement** : PAR, PKCE S256, state + iss, JWT RS256/JWKS, validation client/audiences/scopes et renouvellement sérialisé. Sessions persistantes chiffrées. Une panne temporaire ne supprime pas la session ; accès refusé temporairement si le token a expiré.
- Mise à jour des dépendances vulnérables compatibles ; ajout de jose. Node ≥22.13 nécessaire pour SQLite natif.

Fichiers principaux : `src/integrations.js`, `src/auth.js`, `src/kyros-v4.js`, `server.js`, `public/integrations.html`, `public/css/integrations.css`, `public/js/integrations.js`, navigation, package/lock et tests. Le client Kyros v4 est adapté du client Liora 0.3.0. Kyros lui-même n’a pas été modifié.

## Déploiement et compatibilité

1. Sauvegarder `data`, `uploads` et la configuration privée, serveur arrêté pour une copie cohérente des SQLite.
2. Installer Node ≥22.13 et `npm ci`. Inscrire/activer DropIt sur Kyros v4 ; conserver le callback exact `${PUBLIC_BASE_URL}/auth/callback` et utiliser les valeurs d’issuer/client/audiences fournies par cette inscription.
3. Vérifier `.env` selon `.env.example` : l’ancien `KYROS_ISSUER=kyros` est remplacé par l’issuer URL réel v4, l’audience de ressource doit correspondre au JWT émis. `KYROS_JWT_SECRET`, `KYROS_AUTHORIZE_URL` et `KYROS_TOKEN_URL` historiques ne sont plus utilisés. Aucune configuration réelle n’a été réécrite par cette adaptation.
4. Redémarrer DropIt. La première ouverture impose de se reconnecter car les anciennes sessions étaient en mémoire. Il n’existe plus de faux utilisateur de développement sans SSO.
5. Conserver ensemble pour restauration `data/auth.sqlite`, **`data/auth-master.key`** et `data/integrations.sqlite`, ainsi que les données de partages et fichiers existantes. Les trois nouveaux fichiers sont créés automatiquement, droits 0600. Ne jamais committer/copier la clé dans une documentation.
6. Configurer le connecteur Liora via [LIORA_API.md](LIORA_API.md). Les réglages de clients résident dans SQLite, aucune variable par client.

Le verrou de renouvellement SSO est local au processus : cette version cible **une instance Node**. Un déploiement multi-processus nécessite une sérialisation distribuée avant activation.

## Validation

`npm test` : 8 tests, dont parcours Kyros v4 contre fournisseur de test, rafale de 8 appels avec une seule rotation, panne temporaire/token expiré, API déléguée réelle, mauvais propriétaire, code rejoué, persistance de grants après réouverture SQLite et révocation. Tests navigateur Liora contre le vrai routeur DropIt isolé : consentement, sélection, insertion et mobile. `npm audit --omit=dev` : aucune vulnérabilité signalée lors de cette mise à jour.

Pas de connexion humaine réelle à Kyros/DropIt public et pas de redémarrage d’une instance DropIt réelle. Les données utilisées par les tests sont temporaires. Cette version ne prétend pas auditer l’ensemble de l’ancienne chaîne d’upload.

Retour arrière : restaurer le code et les dépendances 1.0.2 ainsi que sa configuration sauvegardée, désactiver le connecteur Liora ; conserver les nouvelles bases/clé pour une reprise future. Les formats de partages et fichiers ne sont pas migrés.
