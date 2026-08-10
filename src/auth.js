import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

const SESSION_TTL = 12 * 60 * 60 * 1000;

const sessions = new Map();

export function debugSso() {
  const k = config.kyros;
  return {
    provider: k.provider,
    hasBaseUrl: Boolean(k.baseUrl),
    hasClientId: Boolean(k.clientId),
    hasClientSecret: Boolean(k.clientSecret),
    hasJwtSecret: Boolean(k.jwtSecret),
  };
}

function newState() {
  return crypto.randomBytes(24).toString("hex");
}

function authorizeUrl(state) {
  const k = config.kyros;
  const redirectUri = `${config.publicBaseUrl}/auth/callback`;
  const url = new URL(
    k.authorizeUrl || new URL("/authorize", k.baseUrl).toString()
  );
  url.search = new URLSearchParams({
    client_id: k.clientId,
    redirect_uri: redirectUri,
    scope: k.scope,
    state,
  }).toString();
  return url;
}

export async function exchangeCode(code) {
  const k = config.kyros;
  const redirectUri = `${config.publicBaseUrl}/auth/callback`;
  const res = await fetch(
    k.tokenUrl || new URL("/token", k.baseUrl).toString(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: k.clientId,
        client_secret: k.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`token exchange failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function revokeRefreshToken(refreshToken) {
  try {
    const k = config.kyros;
    await fetch(new URL("/revoke", k.baseUrl).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: refreshToken }),
    });
  } catch {
    // meilleur effort
  }
}

function verifyJwt(token) {
  const k = config.kyros;
  return new Promise((resolve) => {
    jwt.verify(token, k.jwtSecret, {
      algorithms: ["HS256"],
      issuer: k.issuer,
      audience: k.audience,
    }, (err, decoded) => {
      if (err) return resolve(null);
      if (k.resourceAudience && decoded.resource_aud !== k.resourceAudience) {
        return resolve(null);
      }
      resolve(decoded);
    });
  });
}

function profileFromTokenData(data, decoded) {
  const u = data.user || {};
  return {
    sub: decoded?.sub || u.id || null,
    id: u.id || decoded?.sub || null,
    name: decoded?.name || u.display_name || u.name || null,
    email: decoded?.email || u.email || null,
    avatar: u.avatar || null,
  };
}

export function createSession(user, { accessToken, refreshToken }) {
  const sid = crypto.randomBytes(24).toString("hex");
  const session = {
    sid,
    user,
    accessToken,
    refreshToken,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL,
  };
  sessions.set(sid, session);
  return sid;
}

export function getSession(sid) {
  const s = sid && sessions.get(sid);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(sid);
    return null;
  }
  return s;
}

export async function destroySession(sid) {
  const s = sessions.get(sid);
  if (s?.refreshToken) await revokeRefreshToken(s.refreshToken);
  sessions.delete(sid);
}

export function cookieName() {
  return "dropit.sid";
}

export function makeAuthHandlers() {
  return {
    startLogin(req, res) {
      const state = newState();
      res.cookie("dropit.state", state, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 10 * 60 * 1000,
      });
      res.redirect(authorizeUrl(state));
    },

    async callback(req, res) {
      try {
        const { code, state } = req.query;
        const savedState = req.cookies["dropit.state"];
        if (
          !state || !savedState || !crypto.timingSafeEqual(
            Buffer.from(String(savedState)), Buffer.from(String(state))
          )
        ) {
          return res.status(400).send("Paramètre state invalide.");
        }
        res.clearCookie("dropit.state");
        if (!code) return res.status(400).send("Code manquant.");

        const data = await exchangeCode(code);
        const decoded = await verifyJwt(data.access_token);
        if (!decoded) {
          return res.status(401).send("Jeton invalide pour ce module.");
        }
        const user = profileFromTokenData(data, decoded);
        const sid = createSession(user, {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
        });
        res.cookie(cookieName(), sid, {
          httpOnly: true,
          sameSite: "lax",
          maxAge: SESSION_TTL,
        });
        res.redirect("/");
      } catch (err) {
        console.error("SSO callback error:", err.message);
        res.status(500).send("La connexion SSO a échoué.");
      }
    },

    async logout(req, res) {
      await destroySession(req.sid);
      res.clearCookie(cookieName());
      res.redirect("/");
    },
  };
}

const fakeUser = {
  sub: "dev-user",
  id: "dev-user",
  name: "Utilisateur de dev",
  email: "dev@localhost",
};

export function requireAuth(handlers) {
  return (req, res, next) => {
    // En développement sans SSO configuré, on accepte un utilisateur fictif.
    if (config.env === "development" && !(config.kyros.clientId && config.kyros.jwtSecret)) {
      req.sid = "dev";
      req.user = fakeUser;
      return next();
    }
    const session = getSession(req.cookies[cookieName()]);
    if (!session) {
      if (req.originalUrl.startsWith("/api/")) {
        return res.status(401).json({ error: "non_authentifie" });
      }
      // Sas de connexion : on ne jette pas l'utilisateur vers Kyros sans qu'il ait vu la porte.
      return res.redirect("/login");
    }
    req.sid = session.sid;
    req.user = session.user;
    next();
  };
}