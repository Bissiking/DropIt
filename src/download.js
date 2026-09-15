import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { shareStatus, findShareBySlug, safeShare } from "./shares.js";

export function publicShareInfo(slug) {
  const share = findShareBySlug(slug);
  if (!share) return null;
  const status = shareStatus(share);
  return { share: safeShare(share), raw: share, status };
}

export function downloadHandlers() {
  return {
    info(req, res) {
      const info = publicShareInfo(req.params.slug);
      if (!info) return res.status(404).json({ error: "partage introuvable" });
      const safe = { share: info.share, status: info.status };
      if (info.status.state === "expired") {
        return res.status(410).json({ error: "partage expiré", ...safe });
      }
      if (info.share.deletedAt) {
        return res.status(410).json({ error: "partage supprimé", ...safe });
      }
      res.json(safe);
    },

    file(req, res) {
      const info = publicShareInfo(req.params.slug);
      if (!info) return res.status(404).send("Partage introuvable");
      const status = info.status;
      if (status.state === "expired") {
        return res.status(410).send("Ce partage a expiré");
      }
      if (info.share.deletedAt) {
        return res.status(410).send("Ce partage a été supprimé");
      }
      const file = (info.raw.files || []).find((f) => f.id === req.params.fileId);
      if (!file) return res.status(404).send("Fichier introuvable");
      const abs = path.join(config.root, file.path);
      if (!fs.existsSync(abs)) return res.status(404).send("Fichier introuvable");
      res.download(abs, file.name);
    },
  };
}