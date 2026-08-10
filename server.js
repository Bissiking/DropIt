import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { config } from "./src/config.js";
import { init } from "./src/store.js";
import { makeAuthHandlers, requireAuth, getSession, cookieName, debugSso } from "./src/auth.js";
import { uploadHandlers, getChunkUpload, chunkLimitBytes } from "./src/uploads.js";
import { shareHandlers } from "./src/shares.js";
import { downloadHandlers } from "./src/download.js";
import { startMaintenance } from "./src/maintenance.js";

async function main() {
  await init();

  const app = express();
  const auth = makeAuthHandlers();
  const uploads = uploadHandlers();
  const shares = shareHandlers();
  const downloads = downloadHandlers();

  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.locals.publicBaseUrl = config.publicBaseUrl;
  app.locals.kyros = config.kyros;

  // --- SSO ---
  app.get("/auth/login", auth.startLogin);
  app.get("/auth/callback", auth.callback);
  app.get("/auth/logout", auth.logout);

  // --- Page de connexion (sas nixie, publique) ---
  app.get("/login", (req, res) => {
    // déjà connecté (session encore valide) ? on refile vers l'app
    let authed = false;
    if (config.env === "development" && !(config.kyros.clientId && config.kyros.jwtSecret)) {
      authed = true;
    } else {
      authed = Boolean(getSession(req.cookies[cookieName()]));
    }
    if (authed) return res.redirect("/");
    res.sendFile(path.join(config.root, "public", "login.html"));
  });

  // --- Statique public (assets + page téléchargement) ---
  // NB: index.html N'EST PAS exposé ici : '/' passe par la route protégée SSO.
  app.use(express.static(path.join(config.root, "public"), {
    extensions: ["html"],
    index: false,
  }));

  // --- API publique ---
  app.get("/api/d/:slug", downloads.info);
  app.get("/dl/:slug/:fileId", downloads.file);

  // --- API authentifiée ---
  app.use("/api", (req, res, next) => {
    // l'authentification bloque le reste des routes API
    requireAuth(auth)(req, res, next);
  });

  app.get("/api/me", (req, res) => res.json({ user: req.user }));
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // Upload resumable
  app.post("/api/upload/init", uploads.init);
  app.get("/api/upload/:uploadId/status", uploads.status);
  app.post("/api/upload/:uploadId/chunk/:index", getChunkUpload(), uploads.chunk);
  app.post("/api/upload/:uploadId/complete", uploads.complete);
  app.post("/api/upload/:uploadId/abort", uploads.abort);

  // Partages
  app.get("/api/shares", shares.list);
  app.post("/api/shares", shares.create);
  app.get("/api/shares/:id", shares.get);
  app.delete("/api/shares/:id", shares.remove);
  app.post("/api/shares/:id/restore", shares.restore);
  app.post("/api/shares/:id/regenerate", shares.regenerate);

  // --- Page application (derrière SSO) ---
  app.get(["/", "/app", "/share/:id"], (req, res, next) => {
    requireAuth(auth)(req, res, next);
  }, (req, res) => {
    res.sendFile(path.join(config.root, "public", "index.html"));
  });

  // --- Page publique de téléchargement ---
  app.get("/d/:slug", (req, res) => {
    res.sendFile(path.join(config.root, "public", "d.html"));
  });

  // --- Erreurs ---
  app.use((req, res) => res.status(404).json({ error: "route introuvable" }));
  app.use((err, req, res, next) => {
    console.error("server error:", err);
    res.status(err.status || 500).json({ error: "erreur serveur" });
  });

  startMaintenance();

  console.log(`
  ╔══════════════════════════════════════╗
  ║   D R O P I T — fichier en transit   ║
  ╚══════════════════════════════════════╝
  ui  → ${config.publicBaseUrl}
  sso → ${config.kyros.baseUrl || "(non configuré — voir .env)"}
  chunk upload plafond ${Math.round(chunkLimitBytes() / 1024 / 1024)} Mo/chunk`);
  if (!config.kyros.clientId) {
    if (config.env === "development") {
      console.log("  ⚠ en dev : SSO désactivé, utilisateur fictif (mode non configuré)");
    } else {
      console.warn("  ⚠ SSO Kyros non configuré en production : toutes les routes API seront bloquées. Voir docs/sso-guide.md");
    }
  }

  app.listen(config.port, () => {
    console.log(`🚀 DropIt prêt sur http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});