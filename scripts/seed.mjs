/* Seed de démonstration via l'API complète (chunks + partage). Usage: node scripts/seed.mjs <url> <files...> */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const [, , base = "http://localhost:3457", ...paths] = process.argv;
const CHUNK = 8 * 1024 * 1024;

async function api(path, opts = {}) {
  const res = await fetch(base + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function upload(filePath, duration) {
  const stat = fs.statSync(filePath);
  const name = filePath.split("/").pop();
  const uploadId = crypto.randomUUID();
  await api("/api/upload/init", {
    method: "POST",
    body: JSON.stringify({ uploadId, name, size: stat.size, mime: name.endsWith(".txt") ? "text/plain" : "application/octet-stream", chunkSize: CHUNK }),
  });
  const expected = Math.ceil(stat.size / CHUNK);
  for (let i = 0; i < expected; i++) {
    const start = i * CHUNK;
    const end = Math.min(start + CHUNK, stat.size);
    const buf = fs.readFileSync(filePath).subarray(start, end);
    const r = await fetch(`${base}/api/upload/${uploadId}/chunk/${i}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: buf,
    });
    if (!r.ok) throw new Error(`chunk ${i} → ${r.status}`);
  }
  const { file } = await api(`/api/upload/${uploadId}/complete`, { method: "POST" });
  return { id: file.id, name: file.name, size: file.size, mime: file.mime, sha256: file.sha256, path: file.path };
}

const durations = ["1h", "24h", "7d", "30d"];
const uploaded = [];
for (const p of paths) {
  uploaded.push(await upload(p, durations[0]));
}
// plusieurs partages distincts pour un dashboard riche
const groups = [
  [uploaded[0], uploaded[1]],
  [uploaded[2]],
];
for (let i = 0; i < groups.length; i++) {
  await api("/api/shares", { method: "POST", body: JSON.stringify({ files: groups[i], duration: durations[i + 1] }) });
}
const shares = await api("/api/shares");
console.log("seed ok —", shares.shares.length, "partages");