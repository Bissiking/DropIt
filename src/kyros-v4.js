// src/kyros-v4.js — Kyros v4 client adapted from Liora 0.3.0
import { config as dropitConfig } from "./config.js";
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
export class KyrosTokenError extends Error {
  code;
  retryable;
  constructor(message, code, retryable) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = "KyrosTokenError";
  }
}
export function getKyrosConfig() {
  const baseUrl = dropitConfig.kyros.baseUrl?.replace(/\/$/, "");
  const clientId = dropitConfig.kyros.clientId;
  const appUrl = dropitConfig.publicBaseUrl?.replace(/\/$/, "");
  if (!baseUrl || !clientId || !appUrl) {
    throw new Error(
      "Configuration Kyros incomplète. Vérifiez KYROS_BASE_URL, KYROS_CLIENT_ID et APP_URL.",
    );
  }
  return {
    baseUrl,
    issuer: process.env.KYROS_ISSUER || baseUrl,
    clientId,
    clientSecret: dropitConfig.kyros.clientSecret,
    audience: process.env.KYROS_AUDIENCE ?? "kyros-modules",
    resourceAudience: process.env.KYROS_RESOURCE_AUDIENCE ?? "kyros:dropit",
    scopes: Array.from(
      new Set((dropitConfig.kyros.scope + " offline_access").split(/\s+/)),
    ).join(" "),
    redirectUri: `${appUrl}/auth/callback`,
  };
}
function handshake() {
  return {
    kyros_sso_version: "v4",
    kyros_edition: "standard",
    kyros_application_scope: "standard",
  };
}
function requestSignal() {
  const configured = Number(process.env.KYROS_TIMEOUT_SECONDS ?? 5);
  const seconds =
    Number.isFinite(configured) && configured > 0 ? configured : 5;
  return AbortSignal.timeout(seconds * 1000);
}
export function createPkce() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
export async function createAuthorizationRequest(state, challenge) {
  const config = getKyrosConfig();
  const response = await fetch(`${config.baseUrl}/par`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret || undefined,
      redirect_uri: config.redirectUri,
      scope: config.scopes,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...handshake(),
    }),
    cache: "no-store",
    signal: requestSignal(),
  });
  const payload = await response.json();
  if (!response.ok || !payload.request_uri) {
    throw new Error(
      payload.error_description ??
        payload.error ??
        "Kyros a refusé la requête PAR.",
    );
  }
  const authorize = new URL(`${config.baseUrl}/authorize`);
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("request_uri", payload.request_uri);
  return authorize;
}
function parseTokenResponse(payload, ok) {
  if (
    !ok ||
    typeof payload.access_token !== "string" ||
    typeof payload.refresh_token !== "string" ||
    typeof payload.expires_in !== "number" ||
    !Number.isFinite(payload.expires_in) ||
    payload.expires_in <= 0 ||
    typeof payload.refresh_token_expires_at !== "string" ||
    !Number.isFinite(Date.parse(payload.refresh_token_expires_at)) ||
    Date.parse(payload.refresh_token_expires_at) <= Date.now()
  ) {
    const code = payload.error ?? "invalid_token_response";
    const retryable = ![
      "invalid_refresh_token",
      "refresh_token_reuse",
      "invalid_client",
      "invalid_client_secret",
    ].includes(code);
    throw new KyrosTokenError(
      payload.error_description ??
        payload.error ??
        "Kyros n'a pas émis une paire de jetons complète.",
      code,
      retryable,
    );
  }
  return payload;
}
async function requestTokens(body) {
  const config = getKyrosConfig();
  let response;
  try {
    response = await fetch(`${config.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: requestSignal(),
    });
  } catch {
    throw new KyrosTokenError(
      "Kyros est temporairement indisponible.",
      "network_error",
      true,
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status >= 500 || response.status === 429) {
    throw new KyrosTokenError(
      payload.error_description ??
        payload.error ??
        "Kyros est temporairement indisponible.",
      payload.error ?? "temporarily_unavailable",
      true,
    );
  }
  if (!response.ok) {
    throw new KyrosTokenError(
      payload.error_description ??
        payload.error ??
        "Kyros a refusé le rafraîchissement.",
      payload.error ?? "token_request_rejected",
      false,
    );
  }
  return parseTokenResponse(payload, response.ok);
}
export async function exchangeAuthorizationCode(code, verifier) {
  const config = getKyrosConfig();
  return requestTokens({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret || undefined,
    code,
    code_verifier: verifier,
    redirect_uri: config.redirectUri,
    ...handshake(),
  });
}
const refreshRequests = new Map();
export function refreshKyrosTokens(refreshToken) {
  const key = createHash("sha256").update(refreshToken).digest("hex");
  const now = Date.now();
  for (const [candidate, entry] of refreshRequests) {
    if (entry.expiresAt <= now) refreshRequests.delete(candidate);
  }
  const existing = refreshRequests.get(key);
  if (existing) return existing.promise;
  const config = getKyrosConfig();
  const promise = requestTokens({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret || undefined,
    refresh_token: refreshToken,
    ...handshake(),
  });
  refreshRequests.set(key, { expiresAt: now + 30_000, promise });
  void promise.catch(() => refreshRequests.delete(key));
  return promise;
}
export async function revokeKyrosToken(refreshToken) {
  const config = getKyrosConfig();
  await fetch(`${config.baseUrl}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret || undefined,
      refresh_token: refreshToken,
      ...handshake(),
    }),
    cache: "no-store",
    signal: requestSignal(),
  });
}
const keysets = new Map();
export async function verifyKyrosToken(token) {
  const config = getKyrosConfig();
  const jwksUrl = `${config.baseUrl}/sso/v4/jwks`;
  let jwks = keysets.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    keysets.set(jwksUrl, jwks);
  }
  const { payload } = await jwtVerify(token, jwks, {
    algorithms: ["RS256"],
    issuer: config.issuer,
    audience: config.audience,
  }).catch(() => {
    throw new KyrosTokenError(
      "Signature ou expiration Kyros invalide.",
      "invalid_signature",
      false,
    );
  });
  const checks = {
    subject: typeof payload.sub === "string" && !!payload.sub,
    expiry: typeof payload.exp === "number",
    scopes: config.scopes
      .split(" ")
      .filter(Boolean)
      .every((scope) =>
        String(payload.scope ?? "")
          .split(" ")
          .includes(scope),
      ),
    version: payload.sso_version === "v4",
    client: payload.client_id === config.clientId,
    resource: payload.resource_aud === config.resourceAudience,
  };
  const failed = Object.entries(checks).find(([, valid]) => !valid);
  if (failed)
    throw new KyrosTokenError(
      `Jeton Kyros invalide : ${failed[0]}.`,
      "invalid_claims",
      false,
    );
  return payload;
}
