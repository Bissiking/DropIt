// test/auth-v4.test.js
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import cookieParser from "cookie-parser";
import { fakeKyros } from "./fixtures/kyros.js";
test("Kyros v4 PAR/PKCE, persistent encrypted sessions, serialized refresh, outage and logout", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dropit-v4-"));
  const origin = "http://127.0.0.1:14336";
  Object.assign(process.env, {
    DATA_DIR: dir,
    UPLOADS_DIR: path.join(dir, "uploads"),
    PUBLIC_BASE_URL: origin,
    KYROS_BASE_URL: "http://127.0.0.1:14337",
    KYROS_CLIENT_ID: "liora-test",
    KYROS_ISSUER: "http://127.0.0.1:14337",
    KYROS_RESOURCE_AUDIENCE: "kyros:liora",
    KYROS_AUDIENCE: "kyros-modules",
    KYROS_SCOPES: "profile email offline_access",
  });
  const provider = await fakeKyros(14337, origin);
  provider.setExpiry(90);
  const auth = await import("../src/auth.js");
  const h = auth.makeAuthHandlers();
  const app = express();
  app.use(cookieParser());
  app.get("/auth/login", h.startLogin);
  app.get("/auth/callback", h.callback);
  app.get("/auth/logout", h.logout);
  app.get("/api/me", auth.requireAuth(), (req, res) => res.json(req.user));
  app.use((e, req, res, next) =>
    res.status(e.status || 500).json({ error: e.message }),
  );
  const server = app.listen(14336, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    assert.equal((await fetch(origin + "/api/me")).status, 401);
    let r = await fetch(origin + "/auth/login", { redirect: "manual" });
    assert.equal(r.status, 302);
    const stateCookie = r.headers.getSetCookie()[0].split(";")[0];
    r = await fetch(r.headers.get("location"), { redirect: "manual" });
    const callback = r.headers.get("location");
    assert.ok(callback.includes("iss="));
    r = await fetch(callback, {
      headers: { cookie: stateCookie },
      redirect: "manual",
    });
    assert.equal(r.status, 302);
    const sessionCookie = r.headers
      .getSetCookie()
      .find((c) => c.startsWith("dropit.sid="))
      .split(";")[0];
    const sid = sessionCookie.split("=")[1];
    assert.equal(auth.getSession(sid).user.sub, "test-owner");
    const persisted = await readFile(path.join(dir, "auth.sqlite"));
    assert.equal(persisted.includes(Buffer.from(sid)), false);
    assert.equal(
      persisted.includes(Buffer.from(auth.getSession(sid).row.tokens)),
      true,
    );
    provider.setExpiry(3600);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        fetch(origin + "/api/me", { headers: { cookie: sessionCookie } }),
      ),
    );
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(provider.rotations, 1);
    const stored = new DatabaseSync(path.join(dir, "auth.sqlite"));
    stored
      .prepare("UPDATE sessions SET access_expires=?")
      .run(Date.now() + 90000);
    provider.setUnavailable(true);
    assert.equal(
      (await fetch(origin + "/api/me", { headers: { cookie: sessionCookie } }))
        .status,
      200,
    );
    stored
      .prepare("UPDATE sessions SET access_expires=?")
      .run(Date.now() - 1000);
    assert.equal(
      (await fetch(origin + "/api/me", { headers: { cookie: sessionCookie } }))
        .status,
      503,
    );
    assert.ok(auth.getSession(sid));
    stored.close();
    await fetch(origin + "/auth/logout", {
      headers: { cookie: sessionCookie },
      redirect: "manual",
    });
    assert.equal(
      (await fetch(origin + "/api/me", { headers: { cookie: sessionCookie } }))
        .status,
      401,
    );
  } finally {
    await new Promise((r) => server.close(r));
    await new Promise((r) => provider.server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
