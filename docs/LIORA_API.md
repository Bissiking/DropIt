# API déléguée Liora — DropIt 1.1.0

16 septembre 2026. Contrat en lecture seule, distinct des cookies SSO et de l’API d’upload.

## Configuration

Ouvrir `/integrations` après connexion Kyros v4. Créer une application avec son nom et son callback exact (HTTPS, HTTP autorisé uniquement en boucle locale). La clé API brute est affichée une fois ; seule son empreinte est conservée dans `data/integrations.sqlite`. Reporter identifiant et clé dans Liora → Administration → Intégrations → DropIt. Aucun `.env` par application connectée.

La configuration de démarrage du SSO DropIt reste nécessaire. DropIt et Liora doivent partager le même émetteur Kyros, avec des inscriptions distinctes et leurs audiences exactes. Une application inscrite possède uniquement `files:list` et `shares:read`.

## Routes

| Route | Accès et résultat |
| --- | --- |
| `GET/POST /api/integrations/clients` | Session Kyros : propres clients ; création affiche id/api_key une fois |
| `DELETE /api/integrations/clients/:id` | Propriétaire : révoque le client et ses accès |
| `GET /api/integrations/grants` | Session Kyros : propres autorisations |
| `DELETE /api/integrations/grants/:id` | Utilisateur concerné : révocation |
| `GET /api/integrations/capabilities` | Clé API Bearer : client, version, scopes, identity_issuer |
| `GET /integrations/authorize` | Session : formulaire de consentement explicite |
| `POST /integrations/authorize` | Session + origine + nonce personnel à usage unique ; retour du code |
| `POST /api/integrations/token` | Clé API : code+PKCE ou refresh ; paire de jetons et identité |
| `POST /api/integrations/revoke` | Clé API + refresh_token : révocation |
| `GET /api/integrations/files?offset=0&limit=50` | Clé API + jeton personnel : métadonnées des fichiers des partages actifs du propriétaire |
| `POST /api/integrations/shares/:id/link` | Mêmes preuves : lien public existant, expiration, portée de tout le partage |

Clé : `Authorization: Bearer <api_key>`. Jeton personnel : `X-DropIt-User-Token: <access_token>`. Aucun paramètre utilisateur libre ; le propriétaire vient exclusivement de l’autorisation enregistrée.

## Consentement et rotation

GET authorize : `client_id`, `redirect_uri`, `state` (aléatoire), `code_challenge` (SHA256 base64url). Le callback doit correspondre exactement à l’inscription. Consentement 10 minutes ; code 2 minutes, usage unique. Échange JSON : `grant_type: authorization_code`, `code`, `code_verifier`, `redirect_uri`. Le code est lié au client et au sujet Kyros.

Renouvellement JSON : `grant_type: refresh_token`, `refresh_token`. Les réponses contiennent `access_token`, `refresh_token`, `expires_in` (900), `sub`, `identity_issuer`, `scope`. Accès 15 minutes, refresh 30 jours glissants ; les deux tournent atomiquement. Un ancien refresh est refusé. Chaque appel revérifie client/grant actifs et propriété du partage. Les jetons bruts délégués ne sont pas conservés en base, seulement leurs empreintes.

L’application cliente vérifie le même `identity_issuer` et `sub` que sa session locale et stocke ses jetons chiffrés. Un ID utilisateur envoyé seul ou une clé API seule ne donne accès à aucun fichier.

## Partage

Les fichiers expirés/supprimés et ceux d’un autre utilisateur ne sont pas listés. L’API ne crée pas de partage, ne télécharge pas et ne modifie aucun fichier. Le lien renvoyé est **public pour ses détenteurs et couvre tous les fichiers du partage**. Liora demande confirmation avant insertion dans le brouillon. Déconnecter une application ne révoque pas les liens déjà envoyés : supprimer/régénérer le partage dans DropIt.

Pour renouveler une clé d’application, créer un nouveau client, remplacer clé/id dans Liora puis révoquer l’ancien. Les membres doivent reconnecter leur compte. Les clients ne sont pas limités à un rôle admin DropIt (pas de modèle de rôles dans ce module) : chaque compte gère ses propres inscriptions, et chaque autre utilisateur doit consentir individuellement.
