import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

let db = { shares: [] };
const dbPath = path.join(config.dirs.data, "db.json");

function ensureDirs() {
  for (const dir of Object.values(config.dirs)) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

async function load() {
  ensureDirs();
  try {
    db = JSON.parse(await fsp.readFile(dbPath, "utf8"));
  } catch {
    db = { shares: [] };
  }
  if (!Array.isArray(db.shares)) db.shares = [];
}

async function save() {
  ensureDirs();
  const tmp = `${dbPath}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
  await fsp.rename(tmp, dbPath);
}

export function allShares() {
  return db.shares;
}

export function getShare(shareId) {
  return db.shares.find((s) => s.id === shareId);
}

export function getShareBySlug(slug) {
  return db.shares.find((s) => s.slug === slug);
}

export function findShare(fn) {
  return db.shares.find(fn);
}

export async function insertShare(share) {
  db.shares.push(share);
  await save();
  return share;
}

export async function updateShare(shareId, patch) {
  const share = getShare(shareId);
  if (!share) return null;
  Object.assign(share, patch);
  await save();
  return share;
}

export async function removeShare(shareId) {
  db.shares = db.shares.filter((s) => s.id !== shareId);
  await save();
}

export function isSlugFree(slug) {
  return !db.shares.some((s) => s.slug === slug);
}

export async function init() {
  await load();
}