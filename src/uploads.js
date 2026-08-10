import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export const chunkLimitBytes = () => config.limits.chunkSize;

function workDir(uploadId) {
  return path.join(config.dirs.work, uploadId);
}
function metaPath(uploadId) {
  return path.join(workDir(uploadId), "meta.json");
}
function chunkPath(uploadId, index) {
  return path.join(workDir(uploadId), `chunk-${index}.part`);
}

async function readMeta(uploadId) {
  try {
    return JSON.parse(await fsp.readFile(metaPath(uploadId), "utf8"));
  } catch {
    return null;
  }
}

async function writeMeta(uploadId, meta) {
  await fsp.writeFile(metaPath(uploadId), JSON.stringify(meta, null, 2));
}

async function listChunks(uploadId) {
  const dir = workDir(uploadId);
  try {
    const entries = await fsp.readdir(dir);
    return entries
      .filter((f) => f.startsWith("chunk-") && f.endsWith(".part"))
      .map((f) => Number(f.slice(6, -5)))
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

async function removeUpload(uploadId) {
  await fsp.rm(workDir(uploadId), { recursive: true, force: true });
}

export function getChunkUpload() {
  return async (req, res, next) => {
    const bytes = await new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > chunkLimitBytes() + 1024 * 1024) {
          reject(new Error("chunk trop volumineux"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
    req.chunk = bytes;
    next();
  };
}

export function uploadHandlers() {
  return {
    async init(req, res) {
      const { uploadId, name, size, mime, chunkSize } = req.body || {};
      if (!uploadId || typeof uploadId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(uploadId)) {
        return res.status(400).json({ error: "uploadId invalide" });
      }
      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "nom de fichier requis" });
      }
      if (!Number.isFinite(size) || size <= 0 || size > config.limits.maxFileSize) {
        return res.status(400).json({ error: "taille invalide" });
      }
      const cs = Number.isFinite(chunkSize) && chunkSize > 0
        ? Math.min(chunkSize, config.limits.chunkSize)
        : config.limits.chunkSize;
      // expectedChunks est DERIVÉ de size : on n'utilise jamais le champ du client,
      // sinon un client ancien (ou sans la valeur) stockerait 0 et rejetterait tout index.
      const expected = Math.max(1, Math.ceil(size / cs));
      const now = Date.now();
      const existing = await readMeta(uploadId);
      const meta = {
        uploadId,
        name: name.slice(0, 255),
        size: size,
        mime: mime || "application/octet-stream",
        chunkSize: cs,
        expectedChunks: expected,
        created: existing?.created || now,
        updated: now,
      };
      await fsp.mkdir(workDir(uploadId), { recursive: true });
      await writeMeta(uploadId, meta);
      const received = await listChunks(uploadId);
      res.json({ uploadId, size: meta.size, chunkSize: cs, expectedChunks: meta.expectedChunks, receivedChunks: received });
    },

    async chunk(req, res) {
      const { uploadId, index } = req.params;
      const meta = await readMeta(uploadId);
      if (!meta) return res.status(404).json({ error: "upload inconnu" });
      const i = Number(index);
      if (!Number.isInteger(i) || i < 0 || i >= meta.expectedChunks) {
        console.error("chunk refusé:", { uploadId, index: i, expectedChunks: meta.expectedChunks, size: meta.size, chunkSize: meta.chunkSize, name: meta.name });
        return res.status(400).json({ error: "index de chunk invalide" });
      }
      const buf = req.chunk;
      const expected = Math.min(meta.chunkSize, meta.size - i * meta.chunkSize);
      if (expected <= 0 || buf.length !== expected) {
        console.error("taille chunk refusée:", { uploadId, index: i, reçu: buf.length, attendu: expected, chunkSize: meta.chunkSize, size: meta.size });
        return res.status(400).json({ error: `taille chunk ${i} inattendue (${buf.length} != ${expected})` });
      }
      const digest = crypto.createHash("sha256").update(buf).digest("hex");
      await fsp.writeFile(chunkPath(uploadId, i), buf);
      const full = await listChunks(uploadId);
      res.json({ uploadId, index: i, sha256: digest, receivedChunks: full, done: full.length === meta.expectedChunks });
    },

    async status(req, res) {
      const { uploadId } = req.params;
      const meta = await readMeta(uploadId);
      if (!meta) return res.status(404).json({ error: "upload inconnu" });
      const received = await listChunks(uploadId);
      res.json({ uploadId, size: meta.size, expectedChunks: meta.expectedChunks, receivedChunks: received });
    },

    async complete(req, res) {
      const { uploadId } = req.params;
      const meta = await readMeta(uploadId);
      if (!meta) return res.status(404).json({ error: "upload inconnu" });
      const received = await listChunks(uploadId);
      const needed = Array.from({ length: meta.expectedChunks }, (_, i) => i);
      const missing = needed.filter((i) => !received.includes(i));
      if (missing.length > 0) {
        return res.status(409).json({ error: "chunks manquants", missing });
      }

      const fileId = crypto.randomUUID();
      const dest = path.join(config.dirs.pending, fileId);
      const out = fs.createWriteStream(dest);
      const sha = crypto.createHash("sha256");
      let written = 0;
      for (const i of needed) {
        const buf = await fsp.readFile(chunkPath(uploadId, i));
        sha.update(buf);
        written += buf.length;
        await new Promise((resolve, reject) => {
          out.write(buf, (e) => (e ? reject(e) : resolve()));
        });
      }
      await new Promise((resolve) => out.end(resolve));
      await removeUpload(uploadId);

      if (written !== meta.size) {
        await fsp.rm(dest, { force: true });
        return res.status(400).json({ error: "taille assemblée incorrecte" });
      }

      res.json({
        file: {
          id: fileId,
          name: meta.name,
          size: written,
          mime: meta.mime,
          sha256: sha.digest("hex"),
          path: path.relative(config.root, dest),
        },
      });
    },

    async abort(req, res) {
      const { uploadId } = req.params;
      await removeUpload(uploadId);
      res.json({ ok: true });
    },
  };
}