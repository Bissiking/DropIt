# Utiliser Kyros 4.2.0 — SSO, login direct et mode hybride

Ce guide décrit l’intégration d’un module quelconque à Kyros. Les exemples utilisent `https://kyros.example.fr` et `https://module.example.fr` : remplace-les par tes domaines.

## Choisir le mode

| Mode | À choisir quand | Particularité |
| --- | --- | --- |
| `sso` | Le navigateur doit afficher la connexion Kyros | Le module ne voit jamais le mot de passe |
| `direct` | Un backend interne possède déjà son formulaire de connexion | Le backend transmet les identifiants à Kyros |
| `hybrid` | Le module doit accepter les deux parcours | Autorise SSO et password grant |

Le mode `sso` est recommandé. Le mode `direct` est réservé aux backends internes de confiance.

## Créer l’application

Dans `/admin`, renseigne au minimum le nom, le mode et l’URL d’accueil. Kyros propose automatiquement le domaine, l’URL de login, le callback et l’audience. Vérifie ces suggestions avant de créer l’application.

Pour un module SSO :

```text
URL accueil      https://module.example.fr
URL login        https://module.example.fr/login
Callback         https://module.example.fr/auth/callback
Scopes           profile email
Audience         kyros:sso:module
```

Kyros canonise les doubles `/` accidentels dans le chemin. Ainsi, `https://module.example.fr//auth/callback` est traité comme `https://module.example.fr/auth/callback` lors de l’enregistrement, de l’autorisation et de l’échange du code.

Le `client_secret` n’est affiché qu’après la création ou une rotation. Le bloc `.env` contient également le secret JWT global pour les backends qui vérifient localement les tokens. Il est masqué à l’écran par défaut et ne doit jamais être envoyé au navigateur.

## Flow SSO

### 1. Créer `state`

Le backend du module génère une valeur aléatoire, la conserve dans sa session puis redirige le navigateur :

```text
https://kyros.example.fr/authorize?client_id=CLIENT_ID&redirect_uri=https%3A%2F%2Fmodule.example.fr%2Fauth%2Fcallback&scope=profile%20email&state=VALEUR_ALEATOIRE
```

Ne construis pas cette URL par concaténation manuelle. Utilise `URL` et `URLSearchParams` pour encoder correctement `redirect_uri`, `scope` et `state`.

### 2. Recevoir le callback

Kyros renvoie le navigateur vers :

```text
https://module.example.fr/auth/callback?code=CODE_TEMPORAIRE&state=VALEUR_ALEATOIRE
```

Le module doit refuser la requête si `state` ne correspond pas à la valeur conservée en session.

### 3. Échanger le code côté serveur

```http
POST https://kyros.example.fr/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "client_id": "CLIENT_ID",
  "client_secret": "CLIENT_SECRET",
  "code": "CODE_TEMPORAIRE",
  "redirect_uri": "https://module.example.fr/auth/callback"
}
```

Le code dure cinq minutes et n’est utilisable qu’une fois. Le `redirect_uri` doit correspondre au callback autorisé après normalisation.

## Login direct

```http
POST https://kyros.example.fr/token
Content-Type: application/json

{
  "grant_type": "password",
  "client_id": "CLIENT_ID",
  "client_secret": "CLIENT_SECRET",
  "username": "utilisateur@example.fr",
  "password": "mot-de-passe",
  "scope": "profile email"
}
```

`username` accepte un nom d’utilisateur ou un email. N’enregistre jamais le mot de passe dans les logs.

## Renouveler les tokens

```http
POST https://kyros.example.fr/token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "client_id": "CLIENT_ID",
  "client_secret": "CLIENT_SECRET",
  "refresh_token": "REFRESH_TOKEN"
}
```

Chaque utilisation fait tourner le refresh token. Remplace atomiquement l’ancien par le nouveau. Pour déconnecter l’utilisateur du module, envoie le refresh token à `POST /revoke` puis détruis la session locale.

## Profil disponible

La réponse `/token` et le JWT peuvent exposer, selon les données renseignées : nom, prénom, nom affiché, email, téléphone, avatar, langue, fuseau, présentation, date de naissance, pronoms, site, ville et pays. Tous ces champs sont facultatifs. Un module doit accepter `null` et ne demander que les scopes dont il a réellement besoin.

Les identifiants stables sont :

- `sub` dans le JWT ;
- `user.id` dans la réponse token.

Utilise-les comme clé de liaison. Ne lie pas un compte à l’email, car l’utilisateur peut le modifier.

## Vérifier un JWT

Le backend vérifie au minimum :

- la signature `HS256` avec le secret JWT Kyros ;
- `iss` ;
- `aud` ;
- `resource_aud` pour son propre module ;
- `exp` ;
- les scopes nécessaires.

Le `client_secret` authentifie l’application auprès de `/token`. Le `JWT_SECRET` vérifie les access tokens : ce sont deux secrets différents.

## Variables d’environnement générées

Le préfixe dépend du nom de l’application. Une application `Jobs Manager` reçoit par exemple :

```env
JOBS_MANAGER_AUTH_PROVIDER=kyros
JOBS_MANAGER_KYROS_BASE_URL=https://kyros.example.fr
JOBS_MANAGER_KYROS_AUTHORIZE_URL=https://kyros.example.fr/authorize
JOBS_MANAGER_KYROS_TOKEN_URL=https://kyros.example.fr/token
JOBS_MANAGER_KYROS_CLIENT_ID=cli_x
JOBS_MANAGER_KYROS_CLIENT_SECRET=secret_client
JOBS_MANAGER_KYROS_JWT_SECRET=secret_jwt_global
JOBS_MANAGER_KYROS_ISSUER=kyros
JOBS_MANAGER_KYROS_AUDIENCE=kyros-modules
JOBS_MANAGER_KYROS_RESOURCE_AUDIENCE=kyros:sso:jobs-manager
JOBS_MANAGER_KYROS_REQUESTED_SCOPE=profile email
```

## Dépannage

- La connexion recharge la page : vérifie que le formulaire conserve bien le paramètre `redirect` vers `/authorize` et que les cookies sont acceptés.
- `invalid_redirect_uri` : compare origine, port et chemin. Kyros corrige les doubles `/`, mais pas un autre domaine ou protocole.
- `invalid_code` : le code a expiré, a déjà servi, ou le callback ne correspond pas.
- `invalid_client_secret` : renouvelle le secret dans l’admin puis remplace-le côté backend.
- `app_access_denied` : contrôle les règles entreprise et les permissions exigées.
- `direct_login_not_allowed` : passe l’application en `direct` ou `hybrid`, ou utilise le SSO.
