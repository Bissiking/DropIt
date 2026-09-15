// test/fixtures/kyros.js — isolated provider for tests only, never mounted in the application
import express from "express";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createHash, randomUUID } from "node:crypto";
export async function fakeKyros(port        , appUrl        ) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const issuer = `http://127.0.0.1:${port}`;
  const pars = new Map                                (),
    codes = new Map                                (),
    refreshes = new Map                ();
  let rotations = 0;
  let unavailable = false;
  let subject = "test-owner";
  let expiresIn = 3600;
  const app = express();
  app.use(express.json());
  app.get("/sso/v4/jwks", (_req, res) =>
    res.json({ keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }] }),
  );
  app.post("/par", (req, res) => {
    if (
      req.body.kyros_sso_version !== "v4" ||
      req.body.code_challenge_method !== "S256"
    )
      return res.status(400).json({ error: "bad_handshake" });
    const uri = randomUUID();
    pars.set(uri, req.body);
    res.json({ request_uri: uri, expires_in: 600 });
  });
  app.get("/authorize", (req, res) => {
    const p = pars.get(String(req.query.request_uri));
    if (!p) return res.sendStatus(400);
    const code = randomUUID();
    codes.set(code, { ...p, subject });
    pars.delete(String(req.query.request_uri));
    res.redirect(
      `${p.redirect_uri}?code=${code}&state=${p.state}&iss=${encodeURIComponent(issuer)}`,
    );
  });
  app.post("/token", async (req, res) => {
    if (unavailable)
      return res.status(503).json({ error: "temporarily_unavailable" });
    const b = req.body;
    let sub                    ;
    if (b.grant_type === "authorization_code") {
      const p = codes.get(b.code);
      codes.delete(b.code);
      if (
        !p ||
        createHash("sha256")
          .update(String(b.code_verifier))
          .digest("base64url") !== p.code_challenge
      )
        return res.status(400).json({ error: "invalid_code" });
      sub = p.subject;
    } else {
      sub = refreshes.get(b.refresh_token);
      refreshes.delete(b.refresh_token);
      if (!sub) return res.status(400).json({ error: "invalid_refresh_token" });
      rotations++;
    }
    const refresh = randomUUID();
    refreshes.set(refresh, sub);
    const access = await new SignJWT({
      sso_version: "v4",
      client_id: "liora-test",
      resource_aud: "kyros:liora",
      scope: "profile email offline_access",
      name: sub === "test-owner" ? "Camille Martin" : "Alex Dupont",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience("kyros-modules")
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime(`${expiresIn}s`)
      .sign(privateKey);
    res.json({
      access_token: access,
      expires_in: expiresIn,
      refresh_token: refresh,
      refresh_token_expires_at: new Date(
        Date.now() + 86400000 * 30,
      ).toISOString(),
    });
  });
  app.post("/revoke", (req, res) => {
    refreshes.delete(req.body.refresh_token);
    res.json({ ok: true });
  });
  const server = app.listen(port, "127.0.0.1");
  await new Promise      ((resolve) => server.once("listening", resolve));
  return {
    server,
    get rotations() {
      return rotations;
    },
    setSubject(s        ) {
      subject = s;
    },
    setUnavailable(v         ) {
      unavailable = v;
    },
    setExpiry(s        ) {
      expiresIn = s;
    },
    issuer,
    appUrl,
  };
}
