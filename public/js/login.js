import { renderBank, setBank, setBankState } from "./nixie.js";

const $ = (sel) => document.querySelector(sel);
const BRAND_KEYS = ["D", "R", "O", "P", "I", "T"];

function starClock(now) {
  const s = now.getSeconds();
  const m = now.getMinutes();
  const h = now.getHours();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function boot() {
  // 1. Bandeau DROPIT — allumage en cascade des tubes
  const brand = $("#brandBank");
  renderBank(brand, { keys: BRAND_KEYS, aria: "DropIt" });
  const tubes = [...brand.querySelectorAll(".tube")];
  tubes.forEach((t, i) => {
    t.classList.add("tube-off");
    setTimeout(() => {
      t.classList.remove("tube-off");
      t.querySelector(".tube-lit").style.opacity = "0";
      t.querySelector(".tube-lit").style.transition = "none";
      requestAnimationFrame(() => {
        t.querySelector(".tube-lit").style.opacity = "";
        t.querySelector(".tube-lit").style.transition = "";
      });
    }, 140 * (i + 1) + 220);
  });
  brand.classList.add("is-lit");
  document.body.dataset.ready = "true";

  // 2. Horloge nixie en direct
  const clock = $("#clockBank");
  const now = new Date();
  renderBank(clock, { keys: [...starClock(now)], aria: "Heure" });
  setBank(clock, starClock(now));
  setInterval(() => setBank(clock, starClock(new Date())), 1000);

  // 3. Bouton connexion → flux SSO
  $("#ssoBtn").addEventListener("click", () => {
    document.body.dataset.connecting = "true";
    window.location.href = "/auth/login";
  });
}

boot();