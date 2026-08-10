import test from "node:test";
import assert from "node:assert/strict";
import { shareStatus, resolveDuration, DURATIONS } from "../src/shares.js";

const base = {
  id: "s1",
  slug: "abc",
  owner: { sub: "u1" },
  createdAt: 1_000_000_000_000,
  deletedAt: null,
  files: [],
};

test("partage actif tant que l'expiration n'est pas atteinte", () => {
  const share = { ...base, expiresAt: Date.now() + 2 * 24 * 60 * 60 * 1000 };
  const st = shareStatus(share);
  assert.equal(st.state, "active");
  assert.ok(st.remaining > 0);
  assert.equal(st.label, "En cours");
});

test("expiration proche (< 24h) → expiring", () => {
  const share = { ...base, expiresAt: Date.now() + 60 * 60 * 1000 };
  const st = shareStatus(share);
  assert.equal(st.state, "expiring");
});

test("expiration passée → expired", () => {
  const share = { ...base, expiresAt: Date.now() - 5 * 1000 };
  const st = shareStatus(share);
  assert.equal(st.state, "expired");
  assert.equal(st.remaining, 0);
});

test("supprimé → deleted récupérable pendant 24h", () => {
  const share = { ...base, expiresAt: Date.now() + 100 * 1000, deletedAt: Date.now() - 60 * 1000 };
  const st = shareStatus(share);
  assert.equal(st.state, "deleted");
  assert.ok(st.remaining > 0 && st.remaining <= 24 * 60 * 60 * 1000);
});

test("supprimé au-delà de 24h → purged", () => {
  const share = { ...base, expiresAt: Date.now() + 100 * 1000, deletedAt: Date.now() - 25 * 60 * 60 * 1000 };
  const st = shareStatus(share);
  assert.equal(st.state, "purged");
});

test("durées du partage couvertes", () => {
  assert.deepEqual(DURATIONS.map((d) => d.id), ["1h", "24h", "7d", "30d"]);
  assert.equal(resolveDuration("7d").ms, 7 * 24 * 60 * 60 * 1000);
  assert.equal(resolveDuration("inconnu").id, "24h"); // défaut sécuritaire
});