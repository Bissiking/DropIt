// src/auth.js — durable Kyros v4 sessions, shared by the application and integration consent.
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import {
  createPkce,
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  verifyKyrosToken,
  refreshKyrosTokens,
  revokeKyrosToken,
  KyrosTokenError,
  getKyrosConfig,
} from "./kyros-v4.js";
fs.mkdirSync(config.dirs.data, { recursive: true, mode: 0o700 });
const keyPath = path.join(config.dirs.data, "auth-master.key");
if (!fs.existsSync(keyPath))
  fs.writeFileSync(keyPath, crypto.randomBytes(32), {
    flag: "wx",
    mode: 0o600,
  });
const key = fs.readFileSync(keyPath);
if (key.length !== 32) throw Error("Clé de sessions DropIt invalide");
const dbFile = path.join(config.dirs.data, "auth.sqlite");
const db = new DatabaseSync(dbFile);
fs.chmodSync(dbFile, 0o600);
db.exec(
  "CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,subject TEXT NOT NULL,user TEXT NOT NULL,tokens TEXT NOT NULL,access_expires INTEGER NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,verifier TEXT NOT NULL,expires INTEGER NOT NULL);",
);
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
function seal(value) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64url");
}
function unseal(value) {
  const raw = Buffer.from(value, "base64url"),
    cipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  cipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString(),
  );
}
const options = () => ({
  httpOnly: true,
  sameSite: "lax",
  secure: config.publicBaseUrl.startsWith("https:"),
  path: "/",
});
export const cookieName = () => "dropit.sid";
export const debugSso = () => ({
  provider: "kyros",
  version: "v4",
  hasBaseUrl: Boolean(config.kyros.baseUrl),
  hasClientId: Boolean(config.kyros.clientId),
});
export function getSession(sid) {
  if (typeof sid !== "string" || sid.length > 100) return null;
  const row = db
    .prepare("SELECT * FROM sessions WHERE id=? AND expires>?")
    .get(hash(sid), Date.now());
  if (!row) return null;
  return { sid, user: JSON.parse(row.user), expiresAt: row.expires, row };
}
export function createSession(user, { tokens, claims }) {
  const sid = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(
    hash(sid),
    user.sub,
    JSON.stringify(user),
    seal(tokens),
    Number(claims.exp) * 1000,
    new Date(tokens.refresh_token_expires_at).getTime(),
  );
  return sid;
}
const refreshing = new Map();
async function refresh(sid) {
  const fingerprint = hash(sid);
  if (refreshing.has(fingerprint)) return refreshing.get(fingerprint);
  const work = (async () => {
    const session = getSession(sid);
    if (!session) return null;
    if (session.row.access_expires > Date.now() + 120000) return session;
    try {
      const old = unseal(session.row.tokens),
        tokens = await refreshKyrosTokens(old.refresh_token),
        claims = await verifyKyrosToken(tokens.access_token);
      if (claims.sub !== session.user.sub)
        throw new KyrosTokenError("Compte différent", "invalid_grant", false);
      db.prepare(
        "UPDATE sessions SET tokens=?,access_expires=?,expires=? WHERE id=?",
      ).run(
        seal(tokens),
        Number(claims.exp) * 1000,
        new Date(tokens.refresh_token_expires_at).getTime(),
        fingerprint,
      );
      return getSession(sid);
    } catch (e) {
      if (e instanceof KyrosTokenError && !e.retryable) {
        db.prepare("DELETE FROM sessions WHERE id=?").run(fingerprint);
        return null;
      }
      if (session.row.access_expires > Date.now()) return session;
      throw Object.assign(
        Error("Kyros temporairement inaccessible. Réessayez."),
        { status: 503 },
      );
    }
  })();
  refreshing.set(fingerprint, work);
  try {
    return await work;
  } finally {
    refreshing.delete(fingerprint);
  }
}
export async function destroySession(sid) {
  const session = getSession(sid);
  if (session) {
    db.prepare("DELETE FROM sessions WHERE id=?").run(hash(sid));
    try {
      await revokeKyrosToken(unseal(session.row.tokens).refresh_token);
    } catch {}
  }
}
export function makeAuthHandlers() {
  return {
    async startLogin(req, res) {
      try {
        const state = crypto.randomBytes(32).toString("base64url"),
          pkce = createPkce();
        const location = await createAuthorizationRequest(
          state,
          pkce.challenge,
        );
        db.prepare("DELETE FROM attempts WHERE expires<?").run(Date.now());
        db.prepare("INSERT INTO attempts VALUES(?,?,?)").run(
          hash(state),
          seal(pkce.verifier),
          Date.now() + 600000,
        );
        res.cookie("dropit.state", state, { ...options(), maxAge: 600000 });
        res.redirect(location.toString());
      } catch {
        res
          .status(503)
          .send(
            "Connexion Kyros v4 indisponible. Vérifiez la configuration et réessayez.",
          );
      }
    },
    async callback(req, res) {
      try {
        const { state, code, iss } = req.query;
        const cookie = req.cookies["dropit.state"];
        if (
          typeof state !== "string" ||
          typeof cookie !== "string" ||
          state.length !== cookie.length ||
          !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookie)) ||
          typeof code !== "string" ||
          iss !== getKyrosConfig().issuer
        )
          return res.status(400).send("Retour Kyros invalide.");
        res.clearCookie("dropit.state", options());
        const attempt = db
          .prepare("DELETE FROM attempts WHERE id=? AND expires>? RETURNING *")
          .get(hash(state), Date.now());
        if (!attempt) return res.status(400).send("Tentative expirée.");
        const tokens = await exchangeAuthorizationCode(
            code,
            unseal(attempt.verifier),
          ),
          claims = await verifyKyrosToken(tokens.access_token);
        const user = {
          sub: claims.sub,
          id: claims.sub,
          name: claims.name || claims.username || "Membre LUMA",
          email: claims.email || null,
        };
        const sid = createSession(user, { tokens, claims });
        res.cookie(cookieName(), sid, {
          ...options(),
          maxAge: Math.max(
            0,
            new Date(tokens.refresh_token_expires_at).getTime() - Date.now(),
          ),
        });
        const resume = req.cookies.dropit_integration_return;
        res.clearCookie("dropit_integration_return");
        res.redirect(
          typeof resume === "string" &&
            resume.startsWith("/integrations/authorize?") &&
            resume.length < 3000
            ? resume
            : "/",
        );
      } catch {
        res
          .status(401)
          .send(
            "La connexion Kyros a échoué. Recommencez depuis la page de connexion.",
          );
      }
    },
    async logout(req, res) {
      await destroySession(req.cookies[cookieName()]);
      res.clearCookie(cookieName(), options());
      res.redirect("/login");
    },
  };
}
export function requireAuth() {
  return async (req, res, next) => {
    try {
      const raw = req.cookies[cookieName()];
      const session = typeof raw === "string" ? await refresh(raw) : null;
      if (!session) {
        if (req.originalUrl.startsWith("/api/"))
          return res.status(401).json({ error: "non_authentifie" });
        return res.redirect("/login");
      }
      res.cookie(cookieName(), raw, {
        ...options(),
        maxAge: Math.max(0, session.expiresAt - Date.now()),
      });
      req.sid = session.sid;
      req.user = session.user;
      next();
    } catch (e) {
      next(e);
    }
  };
}
