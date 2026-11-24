/**
 * DOM for progression: hint bubble, stage banner, card pop-ups, the Path screen and the finale.
 * Everything here renders from plain data handed in by the game; no game state lives in this file.
 */
import { GROWTH_STAGES, LAST_TIER } from "./stages.js";
import { CREATURE_CARDS, DIET_CARDS, DIET_THRESHOLDS, STAGE_TRACK, dietLean, dietPath } from "./traits.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ---- hint bubble ---- */
let anchored = null;
export function showTip(text, anchor, onClose) {
  $("#tipText").textContent = text;
  $("#tipBubble").classList.add("show");
  $("#tipClose").onclick = onClose;
  anchored?.classList.remove("tipAnchorGlow");
  anchored = anchor ? document.querySelector(anchor) : null;
  if (anchored && anchored.offsetParent !== null) anchored.classList.add("tipAnchorGlow");
  else anchored = null;
}
export function hideTip() {
  $("#tipBubble").classList.remove("show");
  anchored?.classList.remove("tipAnchorGlow");
  anchored = null;
}

/* ---- stage banner ---- */
let bannerTimer = 0;
export function showStageBanner(tier) {
  const stage = GROWTH_STAGES[tier - 1];
  $("#stageBannerKicker").textContent = "STAGE " + tier + " OF " + LAST_TIER;
  $("#stageBannerTitle").textContent = stage.name;
  $("#stageBannerText").textContent = stage.blurb;
  $("#stageBanner").classList.add("show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => $("#stageBanner").classList.remove("show"), 4200);
}

/* ---- card pop-ups (queued so two unlocks in a row are both seen) ---- */
const cardQueue = [];
let cardBusy = false;
export function popCard(card) {
  cardQueue.push(card);
  if (!cardBusy) nextCard();
}
function nextCard() {
  const card = cardQueue.shift();
  if (!card) {
    cardBusy = false;
    return;
  }
  cardBusy = true;
  const el = $("#cardPop");
  el.style.setProperty("--c", card.color || "#f5c75a");
  $("#cardPopKind").textContent = card.kind;
  $("#cardPopArt").innerHTML = card.img ? '<img alt="" src="' + card.img + '">' : '<div class="cpIcon">' + esc(card.icon || "✦") + "</div>";
  $("#cardPopTitle").textContent = card.title;
  $("#cardPopText").textContent = card.text;
  el.classList.add("show");
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(nextCard, 500);
  }, 3600);
}

/* ---- trait card reveal ---- */
/**
 * The end-of-stage trait card: it flips over to show what your species became, why, and what it means
 * from now on. One button closes it. Keyboard: Enter/Escape close; focus stays inside.
 * @param {{ stage:string, title:string, icon:string, color:string, blurb?:string, ability?:string,
 *   reasons?:string[], pros?:string[], cons?:string[], later?:{icon:string,text:string}[],
 *   button?:string, reducedMotion?:boolean, onClose?:()=>void }} d
 */
export function showTraitCard(d) {
  document.querySelector(".traitReveal")?.remove();
  const el = document.createElement("div");
  el.className = "traitReveal" + (d.reducedMotion ? " still" : "");
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "trTitle");
  el.style.setProperty("--c", d.color || "#f5c75a");
  const list = (items, cls, mark) => (items?.length ? '<ul class="' + cls + '">' + items.map((t) => '<li><span aria-hidden="true">' + mark + "</span>" + esc(t) + "</li>").join("") + "</ul>" : "");
  el.innerHTML =
    '<div class="trCard"><div class="trInner">' +
    '<div class="trFace trBack" aria-hidden="true">◈</div>' +
    '<div class="trFace trFront">' +
    '<small class="trKind">' + esc(d.stage) + " · trait card</small>" +
    '<div class="trIcon" aria-hidden="true">' + esc(d.icon) + "</div>" +
    '<h2 id="trTitle">' + esc(d.title) + "</h2>" +
    (d.ability ? '<em class="trAbility">' + esc(d.ability) + "</em>" : "") +
    (d.blurb ? '<p class="trBlurb">' + esc(d.blurb) + "</p>" : "") +
    (d.reasons?.length ? '<div class="trSection"><b>Earned by</b>' + list(d.reasons, "trReasons", "•") + "</div>" : "") +
    '<div class="trSection trFx">' + list(d.pros, "trPros", "+") + list(d.cons, "trCons", "−") + "</div>" +
    (d.later?.length ? '<div class="trSection"><b>Later</b><ul class="trLater">' + d.later.map((l) => '<li><span aria-hidden="true">' + esc(l.icon) + "</span>" + esc(l.text) + "</li>").join("") + "</ul></div>" : "") +
    '<button class="trGo" type="button">' + esc(d.button || "Continue") + "</button>" +
    "</div></div></div>";
  document.body.appendChild(el);
  const go = el.querySelector(".trGo");
  const close = () => {
    el.classList.add("out");
    setTimeout(() => el.remove(), d.reducedMotion ? 0 : 300);
    d.onClose?.();
  };
  go.onclick = close;
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Tab") {
      e.preventDefault();
      go.focus();
    }
  });
  requestAnimationFrame(() => el.classList.add("in"));
  setTimeout(() => el.classList.add("flipped"), d.reducedMotion ? 0 : 650);
  setTimeout(() => go.focus(), d.reducedMotion ? 0 : 900);
}

/* ---- Species history ---- */
const dietWord = (d) => (d === "meat" ? "Carnivore" : d === "plant" ? "Herbivore" : "Omnivore");
/** How you treated a species, in a few words, and the badge colour that goes with it. */
function treatment(e) {
  if (e.status === "own") return ["Your species", "own"];
  if (e.status === "allied") return ["Allied", "allied"];
  if (e.status === "extinct") return ["Made extinct", "extinct"];
  if (e.status === "defeated") return ["Defeated", "extinct"];
  if (e.status === "epic") return ["Epic · still out there", "danger"];
  if (e.status === "rogue") return ["Rogue · still out there", "danger"];
  if (e.friends > 0 && e.kills > 0) return ["Befriended " + e.friends + " · hunted " + e.kills, "mixed"];
  if (e.friends > 0) return ["Befriended " + e.friends + (e.members ? " of " + e.members : ""), "friendly"];
  if (e.kills > 0) return ["Hunted " + e.kills, "hunted"];
  return ["Met", "met"];
}
/** The species library: one card for every species you've discovered on the island. */
function libraryHtml(list) {
  const cards = list
    .map((e) => {
      const [how, cls] = treatment(e);
      return (
        '<figure class="libCard ' + cls + '">' +
        (e.thumb ? '<img alt="' + esc(e.name) + '" src="' + e.thumb + '">' : '<div class="genNoThumb" aria-hidden="true">🦎</div>') +
        "<figcaption><b>" + esc(e.name) + (e.generation > 1 ? " <small>Gen " + e.generation + "</small>" : "") + "</b>" +
        "<span>" + (e.diet === "meat" ? "🥩 " : e.diet === "plant" ? "🌿 " : "🍽 ") + dietWord(e.diet) + "</span>" +
        "<span>⌂ " + esc(e.home) + "</span>" +
        '<em class="libHow">' + esc(how) + "</em></figcaption></figure>"
      );
    })
    .join("");
  return "<h3>SPECIES LIBRARY · " + list.length + " DISCOVERED</h3>" + '<div class="library">' + cards + "</div>";
}
/** The species' character: the instinct earned (or forming), the leanings behind it, and why. */
const AXES = [
  ["predation", "Hunter"],
  ["sociality", "Social"],
  ["caution", "Cautious"],
  ["dominance", "Dominant"],
  ["breadth", "Varied diet"],
  ["care", "Protective"],
];
function identityHtml(c) {
  const bars = AXES.map(([k, label]) => '<div class="idAxis"><span>' + label + '</span><i><b style="width:' + Math.round((c.profile[k] || 0) * 100) + '%"></b></i></div>').join("");
  const head = c.id
    ? '<div class="idCard" style="--c:' + c.color + '"><span class="idIcon" aria-hidden="true">' + esc(c.icon) + "</span><div><b>" + (c.earned ? "" : "Becoming: ") + esc(c.title) + "</b><p>" + esc(c.blurb) + "</p>" +
      (c.reasons.length ? '<p class="idWhy">' + c.reasons.map(esc).join(" · ") + "</p>" : "") +
      '<p class="idFx"><span class="pro">+ ' + c.pros.map(esc).join("</span> <span class=pro>+ ") + '</span> <span class="con">− ' + c.cons.map(esc).join("</span> <span class=con>− ") + "</span></p></div></div>"
    : '<p style="color:#9fb8c2">No character yet. It forms from what your species does.</p>';
  return "<h3>CHARACTER" + (c.earned ? "" : " · FORMING") + "</h3>" + head + '<div class="idAxes">' + bars + "</div>";
}
/**
 * Spore-style species history: the evolution track (one consequence card per stage) and the
 * lineage of every generation's design.
 * @param {object} d { name, tier, plants, meat, card, history: [], stats: {}, onClose }
 */
export function openHistoryScreen(d) {
  const lean = dietLean(d.plants, d.meat),
    heading = DIET_CARDS[dietPath(d.plants, d.meat)];
  const track = STAGE_TRACK.map((st) => {
    let face;
    if (st.id === "cell") {
      const card = d.card ? DIET_CARDS[d.card] : null;
      face = card
        ? '<div class="tcSlot earned" style="--c:' + card.color + '"><span>' + card.icon + "</span><b>" + card.title + "</b><small>" + card.ability + "</small></div>"
        : '<div class="tcSlot pending" style="--c:' + heading.color + '"><span>' + heading.icon + "</span><b>Leaning " + heading.title + "</b><small>Decided at the end of the stage</small></div>";
    } else if (st.id === "creature" && d.creature) {
      const card = d.creature.card ? CREATURE_CARDS[d.creature.card] : null;
      face = card
        ? d.identity?.earned
          ? '<div class="tcSlot earned" style="--c:' + d.identity.color + '"><span>' + d.identity.icon + "</span><b>" + esc(d.identity.title) + "</b><small>" + card.title + " · " + card.ability + "</small></div>"
          : '<div class="tcSlot earned" style="--c:' + card.color + '"><span>' + card.icon + "</span><b>" + card.title + "</b><small>" + card.ability + "</small></div>"
        : '<div class="tcSlot pending" style="--c:#f5c75a"><span>🧠</span><b>Brain ' + d.creature.brain + ' / 5</b><small>' + d.creature.alliances + " allied · " + d.creature.extinctions + " extinct</small></div>";
    } else if (st.id === "tribe" && d.tribe) {
      const t = d.tribe;
      face = t.trait
        ? '<div class="tcSlot earned" style="--c:' + t.trait.color + '"><span>' + t.trait.icon + "</span><b>" + t.trait.name + "</b><small>" + t.allied + " allied · " + t.conquered + " conquered</small></div>"
        : '<div class="tcSlot pending" style="--c:#f5c75a"><span>🛖</span><b>' + (t.allied + t.conquered) + " / " + t.total + " settled</b><small>" + t.members + " members · hut " + t.hutLevel + "</small></div>";
    } else if (st.id === "civ" && d.civ) {
      const c = d.civ;
      face = c.card
        ? '<div class="tcSlot earned" style="--c:' + c.card.color + '"><span>' + c.card.icon + "</span><b>" + esc(c.card.name) + "</b><small>" + c.cities + " cities united</small></div>"
        : '<div class="tcSlot pending" style="--c:#f5c75a"><span>🏛</span><b>' + c.cities + " / " + c.total + " cities</b><small>" + c.captures + " taken so far</small></div>";
    } else face = '<div class="tcSlot locked"><span>?</span><b>Coming later</b><small>&nbsp;</small></div>';
    const here = d.civ ? "civ" : d.tribe ? "tribe" : d.creature ? "creature" : "cell";
    return '<div class="trackStage ' + (st.id === here ? "current" : st.status) + '"><div class="tsHead">' + st.icon + " " + esc(st.title) + "</div>" + face + "</div>";
  }).join("");
  const lineage = d.history.length
    ? d.history
        .map(
          (g) =>
            '<figure class="genCard' + (g.stage === "creature" ? " land" : "") + '">' +
            (g.thumb ? '<img alt="Generation ' + g.gen + ' design" src="' + g.thumb + '">' : '<div class="genNoThumb" aria-hidden="true">🦎</div>') +
            "<figcaption><b>Generation " + g.gen + "</b>" +
            (g.stage === "creature"
              ? "<span>Creature · Brain " + g.brain + "</span><span>" + dietWord(g.diet) + " · " + g.parts + " parts</span>" +
                (g.ended
                  ? "<span>" + g.alliances + " befriended · " + g.extinctions + " extinct</span><span>" + g.deaths + " death" + (g.deaths === 1 ? "" : "s") + "</span>"
                  : '<span style="color:#8ff0c9">Living now</span>') +
                "</figcaption></figure>"
              : "<span>Stage " + g.tier + " · " + esc(g.stageName) + "</span>" +
            "<span>" + dietWord(g.diet) + " · " + g.parts + " parts</span>" +
            (g.ended
              ? "<span>Ate 🌿" + (g.plants || 0) + " 🥩" + (g.meat || 0) + "</span><span>" + (g.kills || 0) + " kill" + (g.kills === 1 ? "" : "s") + " · " + (g.deaths || 0) + " death" + (g.deaths === 1 ? "" : "s") + "</span>"
              : '<span style="color:#8ff0c9">Living now</span>') +
            (g.gen === 1 ? "<span>The first design</span>" : "") +
            "</figcaption></figure>"),
        )
        .join("")
    : '<p style="color:#9fb8c2">Your first design will appear here once you leave the editor.</p>';
  const st = d.stats;
  const library = d.library ? libraryHtml(d.library) : "";
  const STAGE_ICON = { cell: "◉", creature: "🦎", tribe: "⛺", civ: "🏛" };
  const STAGE_NAME = { cell: "Cell Stage", creature: "Creature Stage", tribe: "Tribal Stage", civ: "Civilization Stage" };
  // The chronicle as a timeline in chapters, one per stage; turning points stand out.
  const isKey = (e) => e.major || /^(leaning|milestone|creature:card|cell:complete|tribe:won|first:|heritage:|civ:(won|war|unified|captured)|home:begin)/.test(e.key);
  let lastStage = null;
  const chronicle = d.chronicle?.length
    ? "<h3>CHRONICLE · " + d.chronicle.length + " MOMENT" + (d.chronicle.length === 1 ? "" : "S") + '</h3><ol class="chronicle">' +
      d.chronicle
        .map((e) => {
          const head = e.stage !== lastStage ? '<li class="chrChapter" aria-hidden="false">' + STAGE_ICON[e.stage] + " " + STAGE_NAME[e.stage] + "</li>" : "";
          lastStage = e.stage;
          return head + '<li class="chr ' + esc(e.stage) + (isKey(e) ? " key" : "") + '"><span class="chrStage" title="' + esc(e.stage) + ' stage">' + STAGE_ICON[e.stage] + '</span><span class="chrIcon" aria-hidden="true">' + esc(e.icon) + "</span><span>" + esc(e.text) + "</span></li>";
        })
        .join("") +
      "</ol>"
    : "";
  // Who the species is, from the first cell on: the identity each stage handed to the next.
  const h = d.heritage;
  const heritage =
    h && (h.tags.length || h.summary)
      ? '<h3>HERITAGE</h3><div class="heritage">' +
        (h.summary ? '<p class="hgSummary">' + esc(h.summary) + "</p>" : "") +
        '<div class="hgTags">' +
        [h.diet && [h.diet.icon, h.diet.name, "Cell"], h.instinct && [h.instinct.icon, h.instinct.name + (h.instinct.earned ? "" : " (forming)"), "Creature"], h.tribe?.name && [h.tribe.icon, h.tribe.name, "Tribal"], h.civ?.methodName && [h.civ.icon, h.civ.methodName, "Civilization"]]
          .filter(Boolean)
          .map(([i, n, st]) => '<span class="hgTag"><i aria-hidden="true">' + esc(i) + "</i><b>" + esc(n) + "</b><small>" + st + "</small></span>")
          .join("") +
        "</div>" +
        (d.civLegacy?.length ? '<p class="hgSub">Carried into the Civilization Stage</p><ul class="legacyList">' + d.civLegacy.map((l) => "<li>" + esc(l.icon) + " " + esc(l.text) + "</li>").join("") + "</ul>" : "") +
        "</div>"
      : "";
  const identity = d.identity ? identityHtml(d.identity) : "";
  const legacy = d.legacy?.length
    ? '<h3>LEGACY IN THE TRIBAL STAGE</h3><ul class="legacyList">' + d.legacy.map((l) => "<li>" + esc(l.icon) + " <b>" + esc(l.name) + "</b> " + esc(l.text) + "</li>").join("") + "</ul>"
    : "";
  $("#pathPanel").innerHTML =
    '<button class="close" id="pathClose">Close</button><h2 id="pathTitle">' + esc(d.name) + " · Species history</h2>" +
    '<div style="color:#9fb8c2;font-size:13px">Each stage ends with a trait card earned by how your species behaved: <b style="color:#ef4b48">red</b> aggressive, <b style="color:#3fc26e">green</b> peaceful, <b style="color:#3f9cf0">blue</b> balanced.</div>' +
    "<h3>EVOLUTION TRACK</h3>" +
    '<div class="evoTrack">' + track + "</div>" +
    "<h3>CELL STAGE DIET</h3>" +
    '<div class="dpTrack" style="height:12px"><i class="dpZone herb" style="flex:' + DIET_THRESHOLDS.herbivore * 100 + '"></i><i class="dpZone omni" style="flex:' +
    (DIET_THRESHOLDS.carnivore - DIET_THRESHOLDS.herbivore) * 100 + '"></i><i class="dpZone carn" style="flex:' + (1 - DIET_THRESHOLDS.carnivore) * 100 +
    '"></i><i class="dpMark" style="left:' + lean * 100 + '%"></i></div>' +
    '<div class="dpCounts" style="margin-top:6px"><span>🌿 ' + d.plants + " plants</span><span>" + d.meat + " meat 🥩</span></div>" +
    heritage +
    identity +
    legacy +
    chronicle +
    "<h3>LINEAGE · " + d.history.length + " GENERATION" + (d.history.length === 1 ? "" : "S") + "</h3>" +
    '<div class="lineage">' + lineage + "</div>" +
    library +
    "<h3>THIS RUN</h3>" +
    '<div class="statGrid">' +
    (d.creature
      ? [["Brain level", d.creature.brain + " / 5"], ["Species befriended", d.creature.alliances], ["Species extinct", d.creature.extinctions], ["Deaths on land", d.creature.deaths], ["Cells defeated", st.kills], ["DNA", d.creature.dna]]
      : [["Cells defeated", st.kills], ["Deaths", st.deaths], ["Meteor shards", st.shards], ["Regions explored", st.regions], ["Parts unlocked", st.partsUnlocked], ["Stage", d.tier + " / 4"]])
      .map(([k, v]) => "<div>" + k + "<b>" + v + "</b></div>")
      .join("") +
    "</div>";
  $("#pathScreen").classList.add("show");
  const close = () => {
    $("#pathScreen").classList.remove("show");
    d.onClose?.();
  };
  $("#pathClose").onclick = close;
  $("#pathScreen").onclick = (e) => e.target.id === "pathScreen" && close();
  $("#pathClose").focus();
}
export const pathScreenOpen = () => $("#pathScreen").classList.contains("show");

/* ---- finale ---- */
/**
 * Crawl-out finale: the shore, then the diet card flips over.
 * @param {{ card: object, onCreature: () => void, onStay: () => void, onSave: () => void }} d
 */
export function showFinale(d) {
  const c = d.card;
  $("#finaleInner").innerHTML =
    '<small style="letter-spacing:.3em">CELL STAGE COMPLETE</small>' +
    '<h2 id="finaleTitle">Your species reaches the shore</h2>' +
    "<p>Generations of grazing, hunting and mating have made your cell strong enough to crawl out of the water.</p>" +
    '<div class="flipCard" id="flipCard" style="--c:' + c.color + '"><div class="fcInner"><div class="fcFace fcBack">◈</div>' +
    '<div class="fcFace fcFront"><span class="ic">' + c.icon + "</span><b>" + c.title + "</b><em>" + c.ability.toUpperCase() + "</em><p>" + esc(c.text) + "</p></div></div></div>" +
    '<div class="finaleButtons"><button class="primary" id="finaleCreature">Crawl onto land</button><button id="finaleStay">Keep swimming</button><button id="finaleSave">Save / copy my cell</button></div>';
  $("#finale").classList.add("show");
  setTimeout(() => $("#flipCard")?.classList.add("flipped"), 900);
  const close = () => $("#finale").classList.remove("show");
  $("#finaleCreature").onclick = () => {
    close();
    d.onCreature();
  };
  $("#finaleStay").onclick = () => {
    close();
    d.onStay();
  };
  $("#finaleSave").onclick = d.onSave;
  $("#finaleCreature").focus();
}

/* ---- HUD diet meter ---- */
export function updateDietMeter(plants, meat) {
  const lean = dietLean(plants, meat),
    path = dietPath(plants, meat);
  $("#dietPathMark").style.left = lean * 100 + "%";
  $("#dietPathLabel").textContent = plants + meat === 0 ? "Undecided" : DIET_CARDS[path].title;
  $("#dietPathLabel").style.color = DIET_CARDS[path].color;
}
