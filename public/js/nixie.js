/* Nixie bank renderer — chaque position est une tube de verre avec un
   chiffre allumé et son fantôme. Pas de dépendances. */

const DIGITS = "0123456789";
const GLOW_CLASS = [
  "tube-off",     // éteint
  "",             // allumé
  "tube-flicker", // porte-feu (expirant)
];

function makeTube(digit) {
  const tube = document.createElement("span");
  tube.className = "tube";
  tube.innerHTML = `
    <span class="tube-window"></span>
    <span class="tube-ghost" aria-hidden="true"></span>
    <span class="tube-lit"></span>
  `;
  setDigit(tube, digit);
  return tube;
}

function setDigit(tube, digit) {
  const ghostEl = tube.querySelector(".tube-ghost");
  const litEl = tube.querySelector(".tube-lit");
  if (ghostEl.dataset.ghost === digit && litEl.textContent === digit) return;
  ghostEl.textContent = digit;
  litEl.textContent = digit;
  ghostEl.dataset.ghost = digit;
}

/* Construit une banque : "HH:MM:SS" → 8 tubes (avec séparateurs). */
export function renderBank(node, format) {
  node.innerHTML = "";
  node.classList.add("bank-row");
  node.style.setProperty("--tube-h", format.height + "px");
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", format.aria || "");
  const keys = format.keys || [];
  keys.forEach((k) => {
    if (k === ":") {
      const sep = document.createElement("span");
      sep.className = "separator";
      sep.textContent = ":";
      node.appendChild(sep);
    } else if (k === "·") {
      const sep = document.createElement("span");
      sep.className = "separator";
      sep.textContent = "·";
      node.appendChild(sep);
    } else if (k === " ") {
      const sep = document.createElement("span");
      sep.className = "separator";
      sep.style.color = "transparent";
      sep.textContent = "·";
      node.appendChild(sep);
    } else {
      node.appendChild(makeTube(k));
    }
  });
}

/* Applique une chaîne d'état, ex. "12:34:56". Les non-chiffres = séparateurs. */
export function setBank(node, value) {
  const tubes = node.querySelectorAll(":scope > .tube");
  const digits = String(value).split("");
  let t = 0;
  for (const ch of digits) {
    if (DIGITS.includes(ch) && tubes[t]) {
      setDigit(tubes[t], ch);
      t++;
    }
  }
}

/* État de la banque : off | on | flicker */
export function setBankState(node, state) {
  const cls = GLOW_CLASS[stateOffOnOff(state)] || null;
  node.querySelectorAll(":scope > .tube").forEach((tube) => {
    tube.classList.remove(...GLOW_CLASS.filter(Boolean));
    if (cls) tube.classList.add(cls);
  });
}

function stateOffOnOff(state) {
  if (state === "off") return 0;
  if (state === "flicker") return 2;
  return 1;
}

/* Formats utilitaires pour un temps restant (ms). */
export function formatCountdown(remaining) {
  if (remaining < 0) remaining = 0;
  const s = Math.floor(remaining / 1000);
  const dd = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;

  const d2 = String(dd).padStart(2, "0");
  const h2 = String(hh).padStart(2, "0");
  const m2 = String(mm).padStart(2, "0");
  const s2 = String(ss).padStart(2, "0");

  if (dd > 0) {
    if (dd >= 100) return { text: `${d2}:${h2}`, keys: [...d2, ":", ...h2] };
    return { text: `${d2}:${h2}:${m2}`, keys: [...d2, ":", ...h2, ":", ...m2] };
  }
  return { text: `${h2}:${m2}:${s2}`, keys: [...h2, ":", ...m2, ":", ...s2] };
}

/* Taille en octets → affichage lisible, sans jamais d'abaque trompeuse. */
export function formatBytes(bytes) {
  if (bytes < 0) return "—";
  if (bytes === 0) return "0 o";
  if (bytes === 1) return "1 octet";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  const pow = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const val = bytes / Math.pow(1024, pow);
  const str = val >= 100 ? Math.round(val).toString() : val.toFixed(1);
  return `${str.replace(".", ",")} ${units[pow]}`;
}

export function plural(n, un, plur) {
  return n > 1 ? plur : un;
}