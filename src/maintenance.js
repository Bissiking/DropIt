import fsp from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { allShares, removeShare, updateShare } from "./store.js";
import { shareStatus } from "./shares.js";

async function removeFilesOfShare(share, keepPath) {
  for (const file of share.files) {
    const abs = path.join(config.root, file.path);
    if (keepPath && abs === keepPath) continue;
    await fsp.rm(abs, { force: true });
  }
}

async function sweepOnce() {
  const now = Date.now();
  const pendingDir = config.dirs.pending;
  const appended = [];

  // 1. Partages détruits et au-delà de la rétention de 24 h → fichiers supprimés, entrée purgée.
  for (const share of allShares()) {
    const status = shareStatus(share, now);
    if (status.state === "purged") {
      await removeFilesOfShare(share);
      await removeShare(share.id);
      appended.push(`purge share ${share.id} (${share.files.length} fichier(s))`);
      continue;
    }
    // 2. Partages expirés depuis plus que la grâce → fichiers détruits, entrée conservée (historique).
    if (status.state === "expired" && share.expiresAt + config.retention.graceExpiryMs < now) {
      await removeFilesOfShare(share);
      await updateShare(share.id, { files: [] });
      appended.push(`purge fichiers partage expiré ${share.id}`);
    }
  }

  return appended;
}

// 3. Fichiers assemblés jamais rattachés à un partage (upload abandonné > 24 h).
async function sweepPending() {
  const pendingDir = config.dirs.pending;
  let files = [];
  try {
    files = await fsp.readdir(pendingDir);
  } catch {
    return [];
  }
  const now = Date.now();
  const removed = [];
  for (const file of files) {
    const abs = path.join(pendingDir, file);
    let stat;
    try {
      stat = await fsp.stat(abs);
    } catch {
      continue;
    }
    if (now - stat.mtimeMs > config.retention.recoveryMs) {
      await fsp.rm(abs, { force: true });
      removed.push(file);
    }
  }
  return removed;
}

async function sweepUploads() {
  const workDir = config.dirs.work;
  let dirs = [];
  try {
    dirs = await fsp.readdir(workDir);
  } catch {
    return [];
  }
  const now = Date.now();
  const removed = [];
  for (const name of dirs) {
    const abs = path.join(workDir, name);
    let stat;
    try {
      stat = await fsp.stat(abs);
    } catch {
      continue;
    }
    if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) {
      await fsp.rm(abs, { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed;
}

export async function runSweep() {
  const [shares, pending, uploads] = await Promise.all([
    sweepOnce(),
    sweepPending(),
    sweepUploads(),
  ]);
  return { shares, pending, uploads };
}

export function startMaintenance() {
  setTimeout(async () => {
    try {
      await runSweep();
    } catch (err) {
      console.error("maintenance error:", err.message);
    }
  }, 60 * 1000);
  setInterval(async () => {
    try {
      await runSweep();
    } catch (err) {
      console.error("maintenance error:", err.message);
    }
  }, config.retention.sweepMs);
}