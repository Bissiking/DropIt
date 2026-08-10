import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { allShares, getShare, getShareBySlug, insertShare, updateShare, isSlugFree } from "./store.js";

const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function generateSlug(len = 8) {
  let slug;
  do {
    slug = Array.from(crypto.randomBytes(len))
      .map((b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length])
      .join("");
  } while (!isSlugFree(slug));
  return slug;
}

export const DURATIONS = [
  { id: "1h", label: "1 heure", ms: 60 * 60 * 1000 },
  { id: "24h", label: "24 heures", ms: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "7 jours", ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "30d", label: "30 jours", ms: 30 * 24 * 60 * 60 * 1000 },
];

export function resolveDuration(id) {
  return DURATIONS.find((d) => d.id === id) || DURATIONS[1];
}

// Statuts dérivés du temps, jamais stockés
export function shareStatus(share, now = Date.now()) {
  if (share.deletedAt) {
    const retention = share.deletedAt + config.retention.recoveryMs;
    if (now >= retention) return { state: "purged", label: "Détruit", remaining: 0 };
    return {
      state: "deleted",
      label: "Supprimé — récupérable",
      remaining: retention - now,
    };
  }
  if (now >= share.expiresAt) return { state: "expired", label: "Expiré", remaining: 0 };
  const remaining = share.expiresAt - now;
  const expiringSoon = remaining < 24 * 60 * 60 * 1000;
  return {
    state: expiringSoon ? "expiring" : "active",
    label: expiringSoon ? "Bientôt expiré" : "En cours",
    remaining,
  };
}

export function safeShare(share) {
  return {
    id: share.id,
    slug: share.slug,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    deletedAt: share.deletedAt,
    owner: share.owner,
    totalSize: share.files.reduce((a, f) => a + f.size, 0),
    fileCount: share.files.length,
    files: share.files.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      mime: f.mime,
      sha256: f.sha256,
    })),
  };
}

export function shareHandlers() {
  return {
    async list(req, res) {
      const mine = allShares().filter((s) => s.owner.sub === req.user.sub);
      const now = Date.now();
      const items = mine
        .map((s) => ({ ...safeShare(s), status: shareStatus(s, now) }))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      res.json({ shares: items });
    },

    async create(req, res) {
      const { files, duration = "24h" } = req.body || {};
      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: "aucun fichier" });
      }
      if (!Array.isArray(files.map((f) => f.id)) || files.length > 50) {
        return res.status(400).json({ error: "trop de fichiers" });
      }
      const resolved = resolveDuration(duration);
      const registered = [];
      const shareDir = path.join(config.dirs.shares, crypto.randomUUID());
      await fsp.mkdir(shareDir, { recursive: true });

      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      for (const desc of files) {
        try {
          if (!uuidRe.test(desc.id || "")) {
            throw new Error("chemin refusé");
          }
          const src = path.join(config.dirs.pending, desc.id);
          const dest = path.join(shareDir, desc.id);
          await fsp.rename(src, dest);
          registered.push({
            id: desc.id,
            name: desc.name,
            size: desc.size,
            mime: desc.mime,
            sha256: desc.sha256,
            path: path.relative(config.root, dest),
          });
        } catch (e) {
          console.error("share create: fichier refusé/absent", desc.name, e.message);
          for (const r of registered) await fsp.rm(path.join(config.root, r.path), { force: true });
          await fsp.rm(shareDir, { recursive: true, force: true });
          return res.status(400).json({ error: "fichier refusé" });
        }
      }

      const now = Date.now();
      const share = await insertShare({
        id: crypto.randomUUID(),
        slug: generateSlug(),
        owner: { sub: req.user.sub, name: req.user.name, email: req.user.email },
        createdAt: now,
        expiresAt: now + resolved.ms,
        duration: resolved.id,
        deletedAt: null,
        files: registered,
      });
      res.json({ share: safeShare(share), status: shareStatus(share) });
    },

    async get(req, res) {
      const share = getShare(req.params.id);
      if (!share || share.owner.sub !== req.user.sub) {
        return res.status(404).json({ error: "introuvable" });
      }
      res.json({ share: safeShare(share), status: shareStatus(share) });
    },

    async remove(req, res) {
      const share = getShare(req.params.id);
      if (!share || share.owner.sub !== req.user.sub) {
        return res.status(404).json({ error: "introuvable" });
      }
      await updateShare(share.id, { deletedAt: Date.now() });
      res.json({ ok: true });
    },

    async restore(req, res) {
      const share = getShare(req.params.id);
      if (!share || share.owner.sub !== req.user.sub) {
        return res.status(404).json({ error: "introuvable" });
      }
      const status = shareStatus(share);
      if (status.state === "purged") {
        return res.status(410).json({ error: "partage détruit" });
      }
      await updateShare(share.id, { deletedAt: null });
      res.json({ share: safeShare(share), status: shareStatus(share) });
    },

    async regenerate(req, res) {
      const share = getShare(req.params.id);
      if (!share || share.owner.sub !== req.user.sub) {
        return res.status(404).json({ error: "introuvable" });
      }
      const status = shareStatus(share);
      if (status.state === "purged") {
        return res.status(410).json({ error: "partage détruit" });
      }
      await updateShare(share.id, { slug: generateSlug() });
      res.json({ share: safeShare(getShare(share.id)), status: shareStatus(getShare(share.id)) });
    },
  };
}

export function findShareBySlug(slug) {
  return getShareBySlug(slug);
}