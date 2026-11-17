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
        ? '<div class="tcSlot earned" style="--c:' + card.color + '"><span>' + card.icon + "</span><b>" + card.title + "</b><small>" + card.ability + "</small></div>"
        : '<div class="tcSlot pending" style="--c:#f5c75a"><span>🧠</span><b>Brain ' + d.creature.brain + ' / 5</b><small>' + d.creature.alliances + " allied · " + d.creature.extinctions + " extinct</small></div>";
    } else face = '<div class="tcSlot locked"><span>?</span><b>Coming later</b><small>&nbsp;</small></div>';
    const here = d.creature ? "creature" : "cell";
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
  $("#pathPanel").innerHTML =
    '<button class="close" id="pathClose">Close</button><h2 id="pathTitle">' + esc(d.name) + " · Species history</h2>" +
    '<div style="color:#9fb8c2;font-size:13px">Every stage ends with a consequence trait: <b style="color:#ef4b48">red</b> for carnivores, <b style="color:#3fc26e">green</b> for herbivores, <b style="color:#3f9cf0">blue</b> for omnivores. Each one becomes an ability later on.</div>' +
    "<h3>EVOLUTION TRACK</h3>" +
    '<div class="evoTrack">' + track + "</div>" +
    "<h3>CELL STAGE DIET</h3>" +
    '<div class="dpTrack" style="height:12px"><i class="dpZone herb" style="flex:' + DIET_THRESHOLDS.herbivore * 100 + '"></i><i class="dpZone omni" style="flex:' +
    (DIET_THRESHOLDS.carnivore - DIET_THRESHOLDS.herbivore) * 100 + '"></i><i class="dpZone carn" style="flex:' + (1 - DIET_THRESHOLDS.carnivore) * 100 +
    '"></i><i class="dpMark" style="left:' + lean * 100 + '%"></i></div>' +
    '<div class="dpCounts" style="margin-top:6px"><span>🌿 ' + d.plants + " plants</span><span>" + d.meat + " meat 🥩</span></div>" +
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
