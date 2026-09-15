// src/integrations.js
import { Router } from "express";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const check = (value, status, message) => {
  if (!value) throw Object.assign(Error(message), { status });
};
export function createIntegrationRouter({
  dataDir,
  baseUrl,
  requireUser,
  shares,
  identityIssuer,
}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, "integrations.sqlite");
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,redirect_uri TEXT NOT NULL,key_hash TEXT UNIQUE NOT NULL,revoked INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS codes(hash TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id),subject TEXT NOT NULL,challenge TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS consents(hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,subject TEXT NOT NULL,challenge TEXT NOT NULL,state TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id),subject TEXT NOT NULL,access_hash TEXT UNIQUE NOT NULL,refresh_hash TEXT UNIQUE NOT NULL,access_expires INTEGER NOT NULL,refresh_expires INTEGER NOT NULL,revoked INTEGER DEFAULT 0);`);
  const router = Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "same-origin");
    next();
  });
  const client = (req) => {
    const raw = req
      .get("authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    check(raw, 401, "Clé applicative requise");
    const row = db
      .prepare("SELECT * FROM clients WHERE key_hash=? AND revoked=0")
      .get(hash(raw));
    check(row, 401, "Client révoqué ou invalide");
    return row;
  };
  const origin = (req, res, next) => {
    try {
      check(
        req.get("origin") === new URL(baseUrl).origin,
        403,
        "Origine refusée",
      );
      next();
    } catch (e) {
      next(e);
    }
  };
  const realUser = (req, res, next) => {
    check(
      req.user?.sub && req.sid !== "dev" && req.user.sub !== "dev-user",
      403,
      "Une session Kyros réelle est requise",
    );
    next();
  };
  const protect = [requireUser, realUser];
  const grant = (req) => {
    const c = client(req),
      raw = req.get("x-dropit-user-token");
    check(
      typeof raw === "string" && raw.length === 43,
      401,
      "Autorisation personnelle requise",
    );
    const g = db
      .prepare(
        "SELECT * FROM grants WHERE client_id=? AND access_hash=? AND revoked=0 AND access_expires>? AND refresh_expires>?",
      )
      .get(c.id, hash(raw), Date.now(), Date.now());
    check(g, 401, "Autorisation expirée ou révoquée");
    return g;
  };
  const issue = (clientId, subject, id) => {
    const access = token(),
      refresh = token();
    const now = Date.now();
    if (id)
      db.prepare(
        "UPDATE grants SET access_hash=?,refresh_hash=?,access_expires=?,refresh_expires=? WHERE id=?",
      ).run(hash(access), hash(refresh), now + 900000, now + 30 * 86400000, id);
    else
      db.prepare(
        "INSERT INTO grants(id,client_id,subject,access_hash,refresh_hash,access_expires,refresh_expires) VALUES(?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        clientId,
        subject,
        hash(access),
        hash(refresh),
        now + 900000,
        now + 30 * 86400000,
      );
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: 900,
      sub: subject,
      scope: "files:list shares:read",
      identity_issuer: identityIssuer,
    };
  };
  router.get("/api/integrations/clients", ...protect, (req, res) => {
    res.json({
      data: db
        .prepare(
          "SELECT id,name,redirect_uri,revoked FROM clients WHERE owner=? ORDER BY name",
        )
        .all(req.user.sub),
    });
  });
  router.post("/api/integrations/clients", ...protect, origin, (req, res) => {
    const { name, redirect_uri } = req.body || {};
    check(
      typeof name === "string" && name.trim().length > 0 && name.length <= 80,
      400,
      "Nom requis",
    );
    let u;
    try {
      u = new URL(redirect_uri);
    } catch {
      check(false, 400, "URL invalide");
    }
    check(
      !u.username &&
        !u.password &&
        !u.hash &&
        !u.search &&
        (u.protocol === "https:" ||
          (u.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(u.hostname))),
      400,
      "URL de retour HTTPS requise",
    );
    const count = db
      .prepare("SELECT count(*) count FROM clients WHERE owner=? AND revoked=0")
      .get(req.user.sub);
    check(count.count < 20, 400, "20 applications maximum");
    const key = token(),
      id = randomUUID();
    db.prepare(
      "INSERT INTO clients(id,owner,name,redirect_uri,key_hash) VALUES(?,?,?,?,?)",
    ).run(id, req.user.sub, name.trim(), u.toString(), hash(key));
    res.status(201).json({
      id,
      name: name.trim(),
      api_key: key,
      redirect_uri: u.toString(),
    });
  });
  router.delete(
    "/api/integrations/clients/:id",
    ...protect,
    origin,
    (req, res) => {
      db.prepare("UPDATE clients SET revoked=1 WHERE id=? AND owner=?").run(
        req.params.id,
        req.user.sub,
      );
      res.json({ ok: true });
    },
  );
  router.get("/api/integrations/grants", ...protect, (req, res) => {
    res.json({
      data: db
        .prepare(
          "SELECT g.id,c.name,g.refresh_expires FROM grants g JOIN clients c ON c.id=g.client_id WHERE g.subject=? AND g.revoked=0 AND c.revoked=0 AND g.refresh_expires>?",
        )
        .all(req.user.sub, Date.now()),
    });
  });
  router.delete(
    "/api/integrations/grants/:id",
    ...protect,
    origin,
    (req, res) => {
      db.prepare("UPDATE grants SET revoked=1 WHERE id=? AND subject=?").run(
        req.params.id,
        req.user.sub,
      );
      res.json({ ok: true });
    },
  );
  router.get("/api/integrations/capabilities", (req, res) => {
    const c = client(req);
    res.json({
      provider: "dropit",
      version: "1.1.0",
      client_id: c.id,
      identity_issuer: identityIssuer,
      scopes: ["files:list", "shares:read"],
    });
  });
  router.get("/integrations/authorize", ...protect, (req, res) => {
    const { client_id, redirect_uri, state, code_challenge } = req.query;
    const c = db
      .prepare("SELECT * FROM clients WHERE id=? AND revoked=0")
      .get(String(client_id));
    check(
      c && c.redirect_uri === redirect_uri,
      400,
      "Client ou URL de retour invalide",
    );
    check(
      typeof state === "string" &&
        /^[A-Za-z0-9_-]{30,100}$/.test(state) &&
        typeof code_challenge === "string" &&
        /^[A-Za-z0-9_-]{43}$/.test(code_challenge),
      400,
      "Tentative invalide",
    );
    db.prepare("DELETE FROM consents WHERE expires<?").run(Date.now());
    db.prepare("DELETE FROM codes WHERE expires<?").run(Date.now());
    const nonce = token();
    db.prepare("INSERT INTO consents VALUES(?,?,?,?,?,?)").run(
      hash(nonce),
      c.id,
      req.user.sub,
      code_challenge,
      state,
      Date.now() + 600000,
    );
    res
      .type("html")
      .send(
        `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Autoriser ${escape(c.name)} · DropIt</title><link rel="stylesheet" href="/css/integrations.css"></head><body><main><a href="/">DropIt</a><h1>Connecter ${escape(c.name)}</h1><p>Compte : <strong>${escape(req.user.name || req.user.sub)}</strong></p><p>Cette application pourra lister vos fichiers dans les partages actifs et récupérer leurs liens de partage existants. Elle ne pourra ni supprimer ni modifier vos fichiers.</p><p>Destination : <strong>${escape(new URL(c.redirect_uri).origin)}</strong></p><form method="post" action="/integrations/authorize"><input type="hidden" name="nonce" value="${nonce}"><button type="submit">Autoriser la connexion</button> <a href="/integrations">Annuler</a></form><p>Vous pourrez révoquer cet accès dans Applications connectées.</p></main></body></html>`,
      );
  });
  router.post("/integrations/authorize", ...protect, origin, (req, res) => {
    const nonce = String(req.body.nonce || "");
    const a = db
      .prepare(
        "SELECT * FROM consents WHERE hash=? AND subject=? AND expires>?",
      )
      .get(hash(nonce), req.user.sub, Date.now());
    check(a, 400, "Accord expiré ou déjà utilisé");
    const c = db
      .prepare("SELECT * FROM clients WHERE id=? AND revoked=0")
      .get(a.client_id);
    check(c, 400, "Application révoquée");
    const code = token();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM consents WHERE hash=?").run(hash(nonce));
      db.prepare("INSERT INTO codes VALUES(?,?,?,?,?)").run(
        hash(code),
        c.id,
        req.user.sub,
        a.challenge,
        Date.now() + 120000,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    const u = new URL(c.redirect_uri);
    u.search = new URLSearchParams({ code, state: a.state }).toString();
    res.redirect(303, u.toString());
  });
  router.post("/api/integrations/token", (req, res) => {
    const c = client(req),
      b = req.body || {};
    db.exec("BEGIN IMMEDIATE");
    try {
      let result;
      if (b.grant_type === "authorization_code") {
        const a = db
          .prepare(
            "SELECT * FROM codes WHERE hash=? AND client_id=? AND expires>?",
          )
          .get(hash(String(b.code || "")), c.id, Date.now());
        check(a && b.redirect_uri === c.redirect_uri, 400, "Code invalide");
        check(
          typeof b.code_verifier === "string" &&
            /^[A-Za-z0-9_-]{43,128}$/.test(b.code_verifier) &&
            createHash("sha256").update(b.code_verifier).digest("base64url") ===
              a.challenge,
          400,
          "PKCE invalide",
        );
        db.prepare("DELETE FROM codes WHERE hash=?").run(a.hash);
        result = issue(c.id, a.subject);
      } else if (b.grant_type === "refresh_token") {
        const g = db
          .prepare(
            "SELECT * FROM grants WHERE refresh_hash=? AND client_id=? AND revoked=0 AND refresh_expires>?",
          )
          .get(hash(String(b.refresh_token || "")), c.id, Date.now());
        check(g, 401, "Autorisation expirée ou révoquée");
        result = issue(c.id, g.subject, g.id);
      } else check(false, 400, "Type de renouvellement invalide");
      db.exec("COMMIT");
      res.json(result);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  router.post("/api/integrations/revoke", (req, res) => {
    const c = client(req);
    db.prepare(
      "UPDATE grants SET revoked=1 WHERE client_id=? AND refresh_hash=?",
    ).run(c.id, hash(String(req.body.refresh_token || "")));
    res.json({ ok: true });
  });
  router.get("/api/integrations/me", (req, res) => {
    const g = grant(req);
    res.json({ sub: g.subject, scope: "files:list shares:read" });
  });
  const available = (s, sub) =>
    s.owner?.sub === sub && !s.deletedAt && s.expiresAt > Date.now();
  router.get("/api/integrations/files", (req, res) => {
    const g = grant(req);
    const after = String(req.query.after || "");
    check(after.length <= 200, 400, "Curseur invalide");
    const all = shares()
      .filter((s) => available(s, g.subject))
      .flatMap((s) =>
        (s.files || []).map((f) => ({
          id: `${s.id}:${f.id}`,
          share_id: s.id,
          name: f.name,
          size: f.size,
          mime: f.mime,
          expires_at: new Date(s.expiresAt).toISOString(),
        })),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .filter((f) => f.id > after);
    const data = all.slice(0, 100);
    res.json({ data, nextCursor: all.length > 100 ? data.at(-1).id : null });
  });
  router.post("/api/integrations/shares/:id/link", (req, res) => {
    const g = grant(req);
    const s = shares().find(
      (s) => s.id === req.params.id && available(s, g.subject),
    );
    check(s, 404, "Partage introuvable");
    res.json({
      url: new URL(`/d/${encodeURIComponent(s.slug)}`, baseUrl).toString(),
      expires_at: new Date(s.expiresAt).toISOString(),
      public: true,
    });
  });
  return { router, close: () => db.close() };
}
