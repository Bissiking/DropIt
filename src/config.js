import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

import dotenv from "dotenv";
dotenv.config({ path: path.join(root, ".env") });

const port = Number(process.env.PORT || 3000);

export const config = {
  root,
  port,
  env: process.env.NODE_ENV || "development",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}`,
  dirs: {
    uploads: path.resolve(process.env.UPLOADS_DIR || path.join(root, "uploads")),
    work: path.resolve(process.env.UPLOADS_DIR || path.join(root, "uploads"), "work"),
    pending: path.resolve(process.env.UPLOADS_DIR || path.join(root, "uploads"), "pending"),
    shares: path.resolve(process.env.UPLOADS_DIR || path.join(root, "uploads"), "share"),
    data: path.resolve(process.env.DATA_DIR || path.join(root, "data")),
  },
  limits: {
    maxFileSize: Number(process.env.MAX_FILE_SIZE || 40 * 1024 * 1024 * 1024), // 40 Go
    chunkSize: Number(process.env.CHUNK_SIZE || 8 * 1024 * 1024), // 8 Mo
  },
  retention: {
    recoveryMs: 24 * 60 * 60 * 1000, // rétention 24 h après suppression
    sweepMs: 60 * 60 * 1000, // passage de nettoyage
    graceExpiryMs: 6 * 60 * 60 * 1000, // purge 6 h après expiration
  },
  kyros: {
    provider: process.env.KYROS_AUTH_PROVIDER || "kyros",
    baseUrl: process.env.KYROS_BASE_URL || process.env.DROPIT_KYROS_BASE_URL || "",
    authorizeUrl: process.env.KYROS_AUTHORIZE_URL || process.env.DROPIT_KYROS_AUTHORIZE_URL || "",
    tokenUrl: process.env.KYROS_TOKEN_URL || process.env.DROPIT_KYROS_TOKEN_URL || "",
    clientId: process.env.KYROS_CLIENT_ID || process.env.DROPIT_KYROS_CLIENT_ID || "",
    clientSecret: process.env.KYROS_CLIENT_SECRET || process.env.DROPIT_KYROS_CLIENT_SECRET || "",
    jwtSecret: process.env.KYROS_JWT_SECRET || process.env.DROPIT_KYROS_JWT_SECRET || "",
    issuer: process.env.KYROS_ISSUER || process.env.DROPIT_KYROS_ISSUER || "kyros",
    audience: process.env.KYROS_AUDIENCE || process.env.DROPIT_KYROS_AUDIENCE || "kyros-modules",
    resourceAudience: process.env.KYROS_RESOURCE_AUDIENCE || process.env.DROPIT_KYROS_RESOURCE_AUDIENCE || "",
    scope: process.env.KYROS_REQUESTED_SCOPE || process.env.DROPIT_KYROS_REQUESTED_SCOPE || "profile email",
  },
};