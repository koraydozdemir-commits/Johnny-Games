/**
 * The editor's part catalogue, as markup: thumbnail tiles, and the detail card that shows a part's
 * stats, how it compares with what you have equipped, and (when locked) what unlocks it.
 * Pure string builders over parts.js / mouths.js so the numbers shown are the numbers used in play.
 */
import { ABILITY_INFO, STAT_INFO, creaturePart } from "./parts.js";
import { ICONS } from "./editor-icons.js";
import { DIET_NAME, SPECIALS, TIER_NAME, compareMouths, isMouth, mouthDiet, mouthRows, mouthStats, requirementsOf, rowText } from "./mouths.js";

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** A part's name, hidden ("Undiscovered") for locked parts you have never seen. */
export const shownName = (def, { unlocked, seen }) => (unlocked || seen ? def.name : "Undiscovered " + (def.slot === "mouth" ? "mouth" : "part"));
const abilityName = (k) => ABILITY_INFO[k]?.name || STAT_INFO[k]?.name || k;

/** One thumbnail in the grid. The name lives in the detail card, not on the tile. */
export function tileHtml(def, s) {
  const name = shownName(def, s);
  const state = s.unlocked ? (s.inUse ? "equipped" : "available") : "locked";
  const diet = isMouth(def.id) ? mouthDiet(def.id) : null;
  const label = `${name}${diet ? ", " + DIET_NAME[diet] : ""}, ${state}${s.unlocked && def.cost ? ", " + def.cost + " DNA" : ""}`;
  const tier = isMouth(def.id) ? mouthStats(def.id).tier : 0;
  return `<button class="cePart ${s.unlocked ? "" : "locked"} ${s.inUse ? "inUse" : ""} ${s.focused ? "focused" : ""}" data-part="${def.id}" ${diet ? `data-diet="${diet}"` : ""} aria-pressed="${!!s.focused}" aria-label="${esc(label)}" title="${esc(name)}">
    <span class="thumb">${s.thumb ? `<img src="${s.thumb}" alt="" draggable="false">` : ""}</span>
    ${isMouth(def.id) && tier > 0 ? `<span class="tier" aria-hidden="true">${"<i></i>".repeat(tier)}</span>` : ""}
    ${s.unlocked ? (s.inUse ? `<span class="badge on" aria-hidden="true">${ICONS.check}</span>` : "") : `<span class="badge lk" aria-hidden="true">${ICONS.lock}</span>`}
  </button>`;
}

const pips = (v) => `<i class="pips">${[1, 2, 3, 4, 5].map((n) => `<b class="${n <= v ? "on" : ""}"></b>`).join("")}</i>`;
const chip = (delta, fmt) => (Math.abs(delta) < 0.005 ? "" : `<u class="${delta > 0 ? "up" : "down"}">${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta))}</u>`);

/** The mouth statistics table. With `vs`, bars carry a tick for the equipped mouth and a change chip. */
export function mouthTableHtml(id, vs) {
  const rows = vs && vs !== id ? compareMouths(vs, id) : mouthRows(id).map((r) => ({ ...r, from: r.value, delta: 0 }));
  return `<div class="ceMouthRows" role="table" aria-label="Mouth statistics">${rows
    .map((r) => {
      const max = r.key === "reach" ? 1 : 1.5;
      const w = Math.min(100, (r.value / max) * 100);
      const tick = vs && vs !== id ? `<u class="tick" style="left:${Math.min(100, (r.from / max) * 100)}%"></u>` : "";
      const fmt = r.key === "reach" ? (d) => d.toFixed(1) + " m" : (d) => Math.round(d * 100) + "%";
      return `<div class="ceMRow" role="row"><span role="rowheader">${r.label}</span><i class="ceBar" aria-hidden="true"><b style="width:${w}%"></b>${tick}</i><em role="cell">${rowText(r.key, r.value)}</em>${chip(r.delta, fmt)}</div>`;
    })
    .join("")}</div>`;
}

/**
 * The detail card for the focused part.
 * @param {object} def part definition
 * @param {{unlocked:boolean, seen:boolean, inUse:boolean, previewing:boolean, progress:object, mouthNow:string|null,
 *   now:object, after:object, dnaLeft:number, exclusive:boolean, blocked:string}} c
 */
export function infoHtml(def, c) {
  const name = shownName(def, c);
  const mouth = isMouth(def.id) ? mouthStats(def.id) : null;
  const tags = [];
  if (mouth) tags.push(`<span class="ceTag diet-${mouthDiet(def.id)}">${DIET_NAME[mouthDiet(def.id)]}</span>`, `<span class="ceTag">${TIER_NAME[mouth.tier]}</span>`);
  if (!c.unlocked) tags.push(`<span class="ceTag lock">${ICONS.lock} Locked</span>`);
  else if (c.inUse) tags.push(`<span class="ceTag on">${ICONS.check} Equipped</span>`);
  else if (c.previewing) tags.push('<span class="ceTag prev">Preview</span>');
  let body = "";
  if (c.unlocked || c.seen) body += `<p class="ceDesc">${esc(def.desc)}</p>`;
  else body += '<p class="ceDesc">You haven\'t met a creature with this part yet. Its details are a mystery.</p>';
  if (mouth && (c.unlocked || c.seen)) {
    body += mouthTableHtml(def.id, c.mouthNow);
    if (mouth.special) body += `<p class="ceSpecial"><b>${SPECIALS[mouth.special].name}</b> ${SPECIALS[mouth.special].text}</p>`;
  } else if (!mouth && (c.unlocked || c.seen)) {
    const keys = Object.keys(def.abilities);
    if (keys.length)
      body += `<div class="ceMouthRows">${keys
        .map((k) => {
          const was = c.now?.[k] || 0,
            will = c.after?.[k] ?? def.abilities[k];
          return `<div class="ceMRow"><span>${abilityName(k)}</span>${pips(will)}<em>${was} → ${will}</em>${chip(will - was, (d) => d)}</div>`;
        })
        .join("")}</div>`;
  }
  if (!c.unlocked) {
    if (mouth) {
      const reqs = requirementsOf(def.id, c.progress);
      body += `<ul class="ceReq" aria-label="Unlock requirements">${reqs
        .map((r) => `<li class="${r.done ? "done" : ""}"><span class="mark" aria-hidden="true">${r.done ? ICONS.check : ""}</span>${esc(r.text)}${r.need > 1 && r.key !== "brain" ? ` <small>${r.have}/${r.need}</small>` : ""}</li>`)
        .join("")}</ul>`;
    } else body += '<p class="ceReq plain">Found in the wild: dig up fossils and meteorites, win over a species or beat one to take its part.</p>';
  }
  let action;
  if (!c.unlocked) action = `<button class="ceAct" disabled>${ICONS.lock} Locked</button>`;
  else if (c.inUse && c.exclusive) action = `<button class="ceAct" disabled>${ICONS.check} Equipped</button>`;
  else if (c.blocked) action = `<button class="ceAct" disabled title="${esc(c.blocked)}">${esc(c.blocked)}</button>`;
  else action = `<button class="ceAct primary" data-act="equip">${c.exclusive ? "Equip" : "Add to creature"}</button>`;
  const cost = c.unlocked ? (def.cost && !c.inUse ? `<span class="ceCost">${ICONS.dna} ${def.cost} DNA</span>` : '<span class="ceCost free">No DNA cost</span>') : "";
  return `<div class="ceInfoHead"><b>${esc(name)}</b>${tags.join("")}</div>${body}<div class="ceInfoFoot">${cost}${action}</div>`;
}

/** The "Mouth" block of the creature stats panel. `vs` is the equipped mouth while another is being previewed. */
export function mouthPanelHtml(id, vs) {
  const s = mouthStats(id);
  if (!s) return "";
  const special = s.special ? `<p class="ceSpecial"><b>${SPECIALS[s.special].name}</b> ${SPECIALS[s.special].text}</p>` : "";
  return `<h4>Mouth</h4><div class="ceMouthName"><b>${esc(creaturePart(id)?.name || id)}</b><small>${DIET_NAME[mouthDiet(id)]}</small></div>${mouthTableHtml(id, vs)}${special}`;
}
