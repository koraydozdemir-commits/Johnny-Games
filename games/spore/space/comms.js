// Alien communications, first slice: first contact, the comm screen (portrait, mood face, meter, line),
// Trade, Diplomacy, and the Keis. Stands on empires.js for the rules.
import { ARCHETYPES, BANDS, band, makeEmpires, createRelations, score, addReason } from "./empires.js";
import { rng32 } from "../galaxy/names.js";
import { createPortrait } from "./portrait.js";
import { loadPlayer } from "./player.js";
import { speak, stopSpeech, preloadVoice, duckMusic } from "./voice.js";

const css = `
#comm{position:fixed;inset:0;z-index:9;display:flex;align-items:flex-end;justify-content:center;padding:10px 10px calc(10px + env(safe-area-inset-bottom));background:linear-gradient(0deg,rgba(2,8,16,.78),rgba(2,8,16,.15) 70%)}
#comm[hidden]{display:none}
#comm .cm{width:100%;max-width:880px;display:grid;grid-template-columns:minmax(190px,36%) 1fr;gap:14px;align-items:end}
#comm .cmFaceHolder{position:relative;aspect-ratio:1/1.04;border-radius:18px;overflow:hidden;border:2px solid rgba(160,235,255,.75);box-shadow:0 0 0 3px rgba(8,30,48,.9),0 0 26px rgba(80,200,255,.35),inset 0 0 40px rgba(0,0,0,.6);background:radial-gradient(ellipse at 50% 38%,#1b4a6a 0,#0a2036 55%,#040a14 100%)}
#comm .cmFaceHolder::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 2px,transparent 2px 4px);pointer-events:none}
#comm .cmFace{position:absolute;inset:0;width:100%;height:100%}
#comm .cmRight{display:flex;flex-direction:column;gap:8px;min-width:0}
#comm .cmTab{display:flex;align-items:center;gap:10px;padding:6px 8px 6px 16px;border-radius:12px;background:linear-gradient(180deg,rgba(20,70,100,.92),rgba(8,32,54,.94));border:1.5px solid rgba(160,235,255,.7)}
#comm .cmName{flex:1;min-width:0;font-size:17px;font-weight:800;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#comm .cmBand{font-size:12px;font-weight:800}
#comm .cmFaceBtn img{width:34px;height:34px;display:block}
#comm .cmFaceBtn{width:40px;height:40px;padding:0;border-radius:10px;font-size:24px;display:grid;place-items:center;flex:none;background:rgba(0,0,0,.35);border:1.5px solid rgba(160,235,255,.6)}
#comm .cmSay{padding:14px 18px;min-height:78px;border-radius:12px;background:linear-gradient(180deg,rgba(14,52,78,.93),rgba(6,24,40,.95));border:1.5px solid rgba(160,235,255,.6);font-size:17px;line-height:1.45;color:#f0fbff;display:flex;flex-direction:column;justify-content:center;gap:2px}
#comm .cmSay i{color:#9fe0ff}
#comm .cmBar{position:relative;height:8px;margin:6px 4px 2px;border-radius:9px;background:linear-gradient(90deg,#ef4b48 0 20%,#f08a3c 20% 40%,#b9c3c9 40% 60%,#4fa3f0 60% 80%,#3fc26e 80%)}
#comm .cmMark{position:absolute;top:-5px;width:4px;height:18px;margin-left:-2px;border-radius:3px;background:#fff;box-shadow:0 0 8px #fff;transition:left .4s}
#comm .cmReasons{font-size:13px;line-height:1.5;color:#d6eefa;max-height:150px;overflow:auto;padding:8px 14px;border-radius:12px;background:rgba(4,16,28,.95);border:1.5px solid rgba(160,235,255,.4)}
#comm .cmReasons b{float:right;font-variant-numeric:tabular-nums}
#comm .cmReasons[hidden]{display:none}
#comm .cmList{display:flex;flex-direction:column;gap:6px}
#comm .cmList .row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;padding:8px 16px;border-radius:10px;font-size:16px;font-weight:700;text-align:left;color:#eaf8ff;background:linear-gradient(180deg,rgba(24,86,124,.9),rgba(10,40,66,.94));border:1.5px solid rgba(160,235,255,.55);touch-action:manipulation}
#comm .cmList .row:active{background:linear-gradient(180deg,rgba(60,150,200,.95),rgba(20,70,110,.95))}
#comm .cmList .row small{font-size:14px;font-weight:700;color:#ffe08a;white-space:nowrap}
#comm .cmList .row:disabled{opacity:.42}
#comm .cmList .reply{font-weight:500;font-style:italic;background:linear-gradient(180deg,rgba(16,60,92,.9),rgba(8,30,50,.94))}
#comm .cmList .bye{display:flex;gap:8px}
#comm .cmList .bye .row{flex:1;min-height:38px;font-size:15px;font-weight:600;justify-content:center}
#comm .cmList .bye .snd{flex:none;width:52px;padding:0;justify-content:center}
#hailCard{position:fixed;z-index:6;left:10px;bottom:calc(126px + env(safe-area-inset-bottom));width:148px;display:none;flex-direction:column;border-radius:14px;overflow:hidden;border:1.5px solid rgba(160,235,255,.7);background:linear-gradient(180deg,rgba(14,52,78,.93),rgba(6,24,40,.95));box-shadow:0 0 18px rgba(80,200,255,.25)}
body.live.near:not(.stars):not(.warping):not(.comm) #hailCard{display:flex}
#hailCard .hcTop{display:flex;align-items:center;gap:6px;padding:5px 5px 5px 10px}
#hailCard .hcName{flex:1;min-width:0;font-size:12px;font-weight:800;line-height:1.15}
#hailCard .hcRadio{width:34px;height:34px;flex:none;border-radius:9px;display:grid;place-items:center;font-size:19px;background:rgba(0,0,0,.35);border:1.5px solid rgba(160,235,255,.65);animation:hcPulse 1.8s ease-in-out infinite}
@keyframes hcPulse{50%{box-shadow:0 0 12px rgba(120,230,255,.8)}}
#hailCard img{display:block;width:100%;aspect-ratio:1/.9;object-fit:cover;background:radial-gradient(ellipse at 50% 40%,#1b4a6a,#050c16)}
#stats .cr{color:#ffd36a}
@media (max-width:640px){#hailCard{width:124px}#comm .cm{grid-template-columns:1fr;gap:8px}#comm .cmFaceHolder{aspect-ratio:2.1/1}}
`;

// Short lines by mood, with a little archetype flavour.
const LINES = {
  enemy: ["We have nothing to say to you.", "Leave our space.", "Your kind is not welcome."],
  shunned: ["We tolerate you. Barely.", "State your business, quickly.", "Be brief."],
  neutral: ["Yes, Captain. What can we do for you?", "We are listening.", "Speak."],
  liked: ["Welcome, friend. What do you need?", "Good to see you again.", "Our doors are open to you."],
  allied: ["Our fleets are yours, ally.", "Always glad to hear from you.", "Together, Captain. What now?"],
};

// What you say, in your own voice. Each archetype of yours speaks differently; the rest fall back to Diplomat's.
const ASK = {
  Bard: { trade: "Shall we trade a song for some coin?", repair: "My ship has lost its tune. Can you mend her?", recharge: "Could my ship drink a little light?", missions: "Any tales worth chasing for pay?", diplomacy: "May we speak of friendship?", bye: "Until our next verse." },
  Diplomat: { trade: "Might we discuss an exchange of goods?", repair: "Could your engineers see to my ship?", recharge: "May I trouble you for a recharge?", missions: "Is there any work I could do for you?", diplomacy: "Let us speak about our relations.", bye: "Thank you for your time." },
  Ecologist: { trade: "I have things to trade, gently gathered.", repair: "My ship needs mending. Do you have a way?", recharge: "Could my ship take on some clean energy?", missions: "Is there anything alive that needs our help?", diplomacy: "How can we live well side by side?", bye: "May your worlds stay green." },
  Explorer: { trade: "Fancy a trade? I found some things out there.", repair: "Took a few knocks out there. Can you patch her up?", recharge: "Got room to top me up?", missions: "Have any work for me?", diplomacy: "Let's talk about where we stand.", bye: "Time I got moving." },
  Knight: { trade: "I offer fair trade, on my honour.", repair: "My ship is wounded. Will you grant repairs?", recharge: "I request a recharge, in good faith.", missions: "Is there a deed I may undertake?", diplomacy: "I would speak of our standing.", bye: "Farewell. Hold your honour." },
  Scientist: { trade: "I have samples and ore. Interested?", repair: "Systems are damaged. Do you have the means to fix them?", recharge: "My reserves are low. Can you supply power?", missions: "Is there anything you need investigated?", diplomacy: "Let us discuss the terms between us.", bye: "That is all. Thank you." },
  Shaman: { trade: "The stars say we should trade.", repair: "My ship's spirit is hurt. Can it be healed?", recharge: "Her fire burns low. Will you feed it?", missions: "Does the sky ask anything of me?", diplomacy: "Let us read what lies between us.", bye: "The stars watch over you." },
  Trader: { trade: "Let's talk prices.", repair: "Need my ship fixed. What's it going to cost me?", recharge: "Top me up. Name your price.", missions: "Got any jobs that pay well?", diplomacy: "Let's see where we stand, you and I.", bye: "Pleasure doing business." },
  Warrior: { trade: "I have goods. Buy them.", repair: "My ship is battered. Fix it.", recharge: "Fill my reserves.", missions: "Give me something to fight for.", diplomacy: "Speak plainly of where we stand.", bye: "We are done here." },
  Zealot: { trade: "Our goods serve the cause. Will you trade?", repair: "My ship was wounded in the cause. Mend her.", recharge: "Renew her strength, for the cause.", missions: "What may I do for the cause?", diplomacy: "Do we share the same purpose?", bye: "May the cause guide you." },
};
const DRIVE_COST = [300, 800, 2000], DRIVE_LY = [4500, 6750, 9450, 13500];
const ask = (k) => `“${(ASK[PLAYER.archetype] || ASK.Diplomat)[k]}”`;
const PLAYER = { archetype: "Explorer" };
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

export function createComms({ galaxy, S, homeId, toast, sound, starView, retreat }) {
  const player = loadPlayer();
  PLAYER.archetype = S.archetype || player.archetype;
  const world = makeEmpires(galaxy, homeId);
  // Your own empire: always on your side. Same species every time.
  const own = { id: "own", own: true, home: homeId, archetype: PLAYER.archetype, name: player.record ? `${player.name} Empire` : "Your Empire", short: "Home", color: "#5cf0c8", seed: 1046 * 7919 + 13, mood: 0, record: player.record };
  const KEY = "johnny-spore-empires-test";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
  const rels = {};
  for (const e of [...world.empires, own]) rels[e.id] = Object.assign(createRelations(e), saved.rel?.[e.id] || {});
  S.credits = saved.credits ?? 40;
  S.hull ??= saved.hull ?? 100;
  S.charge ??= saved.charge ?? 100;
  S.drive = saved.drive ?? 0;
  starView?.setDrive?.(S.drive);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ rel: rels, credits: S.credits, hull: S.hull, charge: S.charge, drive: S.drive })); } catch {} };

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  const root = document.createElement("div");
  root.id = "comm";
  root.hidden = true;
  root.innerHTML = `<div class="cm"><div class="cmFaceHolder"></div><div class="cmRight">
    <div class="cmTab"><span class="cmName"></span><span class="cmBand"></span><button class="cmFaceBtn" aria-label="Why they feel this way">😐</button></div>
    <div class="cmReasons" hidden></div>
    <div class="cmSay"><span class="cmLine"></span><div class="cmBar"><i class="cmMark"></i></div></div>
    <div class="cmList"></div></div></div>`;
  document.body.appendChild(root);
  const $q = (s) => root.querySelector(s);
  const portrait = createPortrait($q(".cmFaceHolder"));
  const card = document.createElement("div");
  card.id = "hailCard";
  card.innerHTML = '<div class="hcTop"><span class="hcName"></span><button class="hcRadio" aria-label="Open communications">📻</button></div><img alt="">';
  document.body.appendChild(card);
  let cardFor = null;
  const snaps = new Map();
  function setCard(e) {
    if (cardFor === e) return;
    cardFor = e;
    document.body.classList.toggle("near", !!e);
    if (!e) return;
    card.querySelector(".hcName").textContent = e.name;
    card.querySelector(".hcName").style.color = e.color;
    if (!snaps.has(e.id)) { snaps.set(e.id, portrait.snapshot(e)); faceOf.set("cur", null); }
    card.querySelector("img").src = snaps.get(e.id);
  }
  card.querySelector(".hcRadio").onclick = () => { if (!cardFor) return; if (!cardFor.own && !cardFor.keis && !rels[cardFor.id].met) firstContact(cardFor); else open(cardFor); };
  const credEl = document.createElement("span");
  credEl.className = "cr";
  credEl.innerHTML = 'Credits <b id="cred">0</b> · Charge <b id="chg">100</b>% · Hull <b id="hul">100</b>%';
  document.getElementById("stats").appendChild(credEl);
  const showCredits = () => { credEl.querySelector("#cred").textContent = Math.round(S.credits); credEl.querySelector("#chg").textContent = Math.round(S.charge); credEl.querySelector("#hul").textContent = Math.round(S.hull); };
  showCredits();

  let emp = null, view = "main", here = null, lastSafe = homeId, line = "", nextLine = null;
  const rel = () => rels[emp.id];
  const sc = () => (emp.own ? 100 : score(rel()));
  const bandOf = () => (emp.own ? BANDS[4] : band(sc()));
  const say = (t) => { nextLine = t; };
  const speakNow = (t) => { const sec = speak(emp.archetype, t, emp.seed); portrait.speak(sec); duckMusic(true); clearTimeout(speakNow.t); speakNow.t = setTimeout(() => duckMusic(false), sec * 1000 + 300); };
  // Missions pay less the worse they feel about you; they never refuse you for it.
  const payMult = () => (emp.own ? 1.2 : 0.5 + ((sc() + 100) / 200) * 0.9);
  const fmtReward = (base) => Math.max(5, Math.round((base * payMult()) / 5) * 5);

  function offers() {
    const r = rel(), rng = rng32((emp.seed ^ ((r.round || 0) * 7919)) >>> 0);
    const stars = galaxy.stars, h = stars[emp.home];
    const near = [];
    for (let k = 0; k < 400 && near.length < 3; k++) {
      const id = Math.floor(rng() * stars.length), s = stars[id];
      if (id === emp.home || id === here?.home || id === S.starId) continue;
      if (Math.hypot(s.x - h.x, s.y - h.y) < 0.16) near.push(id);
    }
    const list = [];
    const n1 = 8 + Math.floor(rng() * 4) * 4, n2 = 1 + Math.floor(rng() * 3);
    list.push({ kind: "ore", n: n1, base: n1 * 5 });
    list.push({ kind: "spec", n: n2, base: n2 * 40 });
    if (near.length) list.push({ kind: "visit", target: near[0], base: 80 + Math.floor(rng() * 80) });
    list.push({ kind: "hunt", n: 3, base: 150 });
    return list;
  }
  const describe = (m) => (m.kind === "hunt" ? `Destroy ${m.n} hostile ships (${Math.min(m.progress || 0, m.n)}/${m.n})` : m.kind === "ore" ? `Bring ${m.n} ore` : m.kind === "spec" ? `Bring ${m.n} specimen${m.n > 1 ? "s" : ""}` : `Survey ${galaxy.stars[m.target].name}`);

  function setView(v) { view = v; render(); }
  function render() {
    const b = bandOf();
    if (!faceOf.has(emp.id) || faceOf.get("cur") !== emp.id) { portrait.show(emp); faceOf.set(emp.id, true); faceOf.set("cur", emp.id); }
    const nm = $q(".cmName");
    nm.textContent = emp.name;
    nm.style.color = emp.color;
    if (nextLine) { line = nextLine; nextLine = null; $q(".cmLine").innerHTML = line; speakNow(line.replace(/<[^>]+>/g, "")); }
    else $q(".cmLine").innerHTML = line;
    $q(".cmFaceBtn").innerHTML = `<img src="${b.face}" alt="${b.name}">`;
    $q(".cmMark").style.left = (sc() + 100) / 2 + "%";
    $q(".cmBar").style.display = view === "first" || emp.own ? "none" : "block";
    const bb = $q(".cmBand");
    const r = rel();
    bb.textContent = emp.keis ? "Furious" : emp.own ? "Yours" : r.allied ? "Allied" : b.name;
    bb.style.color = b.color;
    $q(".cmReasons").innerHTML = r.reasons.map((x) => `<div>${x.t}<b style="color:${x.w < 0 ? "#ff9a8a" : "#9ae68a"}">${x.w > 0 ? "+" : ""}${Math.round(x.w)}</b></div>`).join("");
    const list = $q(".cmList");
    list.replaceChildren();
    const add = (label, fn, { sub = "", dis = false, cls = "row" } = {}) => {
      const el = document.createElement("button");
      el.className = cls;
      el.innerHTML = `<span>${label}</span>` + (sub ? `<small>${sub}</small>` : "");
      el.disabled = dis;
      el.onclick = () => { sound?.tone(520, 700, 0.07, "sine", 0.07); fn(); };
      list.appendChild(el);
      return el;
    };
    const bye = (back) => {
      const w = document.createElement("div");
      w.className = "bye";
      const g = document.createElement("button");
      g.className = "row reply"; g.textContent = back ? "“Let us talk of something else.”" : ask("bye");
      g.onclick = () => (back ? setView("main") : close());
      const sp = document.createElement("button");
      sp.className = "row snd"; sp.textContent = "🔊"; sp.setAttribute("aria-label", "Hear again");
      sp.onclick = () => speakNow(line.replace(/<[^>]+>/g, ""));
      w.append(g, sp);
      list.appendChild(w);
    };
    if (emp.keis) {
      add("Retreat", () => { close(); retreat(lastSafe); });
    } else if (view === "first") {
      add("“👋  Greetings, friend.”", () => gesture("wave"), { cls: "row reply" });
      add("“🎁  Please accept this gift.”", () => gesture("gift"), { cls: "row reply", sub: "3 ore", dis: S.ore < 3 });
      add("“🛡  We are not to be trifled with.”", () => gesture("strength"), { cls: "row reply" });
    } else if (view === "main") {
      add(ask("trade"), () => setView("trade"), { cls: "row reply" });
      add(ask("repair"), repair, { cls: "row reply", sub: S.hull < 100 ? Math.round((100 - S.hull) * 4 * (emp.own ? 0 : 1)) || "free" : "" });
      add(ask("recharge"), recharge, { cls: "row reply", sub: S.charge < 100 ? Math.round((100 - S.charge) * 3.5 * (emp.own ? 0 : 1)) || "free" : "" });
      add("“Can you upgrade my drive?”", upgrade, { cls: "row reply", sub: S.drive >= 3 ? "max" : DRIVE_COST[S.drive] });
      add(ask("missions"), () => { setView("missions"); }, { cls: "row reply", sub: rel().mission ? "active" : "" });
      if (!emp.own) add(ask("diplomacy"), () => setView("diplomacy"), { cls: "row reply" });
      bye(false);
    } else if (view === "missions") {
      const m = r.mission;
      if (m) {
        const have = m.kind === "hunt" ? (m.progress || 0) >= m.n : m.kind === "ore" ? S.ore >= m.n : m.kind === "spec" ? S.specimens >= m.n : false;
        add(`“${describe(m)}.”`, turnIn, { cls: "row reply", sub: m.kind === "visit" ? "go there" : have ? "Turn in" : `${fmtReward(m.base)}`, dis: m.kind === "visit" || !have });
        add("“I cannot do this after all.”", () => { r.mission = null; say("Another time, then."); save(); render(); }, { cls: "row reply" });
      } else {
        for (const o of offers()) add(`“${describe(o)}.”`, () => accept(o), { cls: "row reply", sub: fmtReward(o.base) + " cr" });
        say0("I have work, if you want it. " + (emp.own ? "" : sc() < -20 ? "It pays less from those we dislike." : ""));
      }
      bye(true);
    } else if (view === "trade") {
      const sold = r.sold || 0, mult = emp.own ? 1.25 : ARCHETYPES[emp.archetype].sells;
      const sag = emp.own ? 0 : 1;
      const orePrice = Math.max(1, Math.round(3 * mult * (1 / (1 + (sold * sag) / 60)) * 10) / 10);
      const lifePrice = Math.round(22 * (emp.own ? 1.3 : ARCHETYPES[emp.archetype].buysSpecimens));
      add(`“Take ten ore.”`, () => sellOre(10), { cls: "row reply", sub: `${(orePrice * 10).toFixed(0)}`, dis: S.ore < 10 });
      add(`“Take all my ore. (${S.ore})”`, () => sellOre(S.ore), { cls: "row reply", sub: `${Math.round(orePrice * S.ore)}`, dis: S.ore < 1 });
      add(`“A living specimen, for you.”`, () => sellSpec(1), { cls: "row reply", sub: `${lifePrice}`, dis: S.specimens < 1 });
      add(`“All my specimens. (${S.specimens})”`, () => sellSpec(S.specimens), { cls: "row reply", sub: `${lifePrice * S.specimens}`, dis: S.specimens < 1 });
      bye(true);
    } else if (view === "diplomacy") {
      const g = r.gifts || 0;
      add("“Please, take this gift. (5 ore)”", giveOre, { cls: "row reply", sub: `+${(6 / (1 + g * 0.6)).toFixed(0)}`, dis: S.ore < 5 });
      add("“Your people are admirable.”", compliment, { cls: "row reply", sub: r.praised ? "done" : "", dis: !!r.praised });
      add("“May we cross your space in peace?”", passage, { cls: "row reply", sub: r.passage ? "granted" : "" });
      add("“Shall our ships trade freely?”", tradeRoute, { cls: "row reply", sub: r.route ? "active" : "" });
      add(r.allied ? "We stand together." : "“Will you stand with us as allies?”", alliance, { cls: "row reply", dis: r.allied });
      add(r.war ? "“Enough. Let there be peace.”" : "“Then we are at war.”", r.war ? peace : war, { cls: "row reply" });
      bye(true);
    }
    $q(".cmTab").style.display = "flex";
  }
  function say0(t) { if (!lineSet) { /* keep the existing line unless we just changed view */ } line = t; $q(".cmLine").innerHTML = t; }
  let lineSet = true;
  const faceOf = new Map();

  function greeting() {
    const b = bandOf();
    if (emp.own) return pick(["Welcome home, Captain. The fleet is yours.", "All is well at home, Captain.", "Your people are glad to hear you."], emp.seed + Math.floor(Date.now() / 60000));
    return pick(LINES[b.id], emp.seed + sc());
  }
  function open(e, v = "main", first = null) {
    emp = e; view = v; faceOf.set("cur", null);
    preloadVoice(e.archetype);
    $q(".cmReasons").hidden = true;
    root.hidden = false;
    document.body.classList.add("comm");
    portrait.start();
    nextLine = first || greeting();
    render();
  }
  function close() { root.hidden = true; document.body.classList.remove("comm"); portrait.pause(); portrait.stop(); stopSpeech(); duckMusic(false); save(); }
  $q(".cmFaceBtn").onclick = () => { const x = $q(".cmReasons"); x.hidden = !x.hidden; };
  addEventListener("resize", () => !root.hidden && portrait.resize());

  const rewardFx = (n) => { S.credits += n; showCredits(); sound?.tone(700, 1100, 0.15, "triangle", 0.08); };
  function accept(o) {
    const r = rel();
    r.mission = { ...o, progress: 0 };
    say(o.kind === "hunt" ? `Pirates have been raiding us. Destroy ${o.n} of their ships and come back for ${fmtReward(o.base)} credits.` : o.kind === "visit" ? `Go to ${galaxy.stars[o.target].name} and look around for us. We will pay you ${fmtReward(o.base)} credits.` : `${describe(o)}. We will pay ${fmtReward(o.base)} credits.`);
    save(); render();
  }
  function turnIn() {
    const r = rel(), m = r.mission;
    if (!m) return;
    if (m.kind === "ore") S.ore -= m.n; else if (m.kind === "spec") S.specimens -= m.n;
    const pay = fmtReward(m.base);
    rewardFx(pay);
    r.mission = null; r.round = (r.round || 0) + 1;
    if (!emp.own) addReason(r, "You did a job for them", 2);
    say(`Well done. ${pay} credits.`); save(); setView("missions");
  }
  function upgrade() {
    if (S.drive >= 3) { say("Your drive is already the best we can build."); return render(); }
    if (!emp.own && sc() < -20) { say("We do not help those we dislike."); return render(); }
    const cost = DRIVE_COST[S.drive];
    if (S.credits < cost) { say(`That takes ${cost} credits.`); return render(); }
    S.credits -= cost; S.drive++; starView?.setDrive?.(S.drive); showCredits();
    say(`Done. Your drive now reaches ${DRIVE_LY[S.drive].toLocaleString()} light years.`); sound?.tone(300, 1200, 0.5, "sawtooth", 0.07); save(); render();
  }
  function repair() {
    if (S.hull >= 100) { say("Your ship is in perfect shape."); return render(); }
    const cost = emp.own ? 0 : Math.round((100 - S.hull) * 4);
    if (S.credits < cost) { say("You cannot afford the repairs."); return render(); }
    S.credits -= cost; S.hull = 100; showCredits(); say("Good as new."); save(); render();
  }
  function recharge() {
    if (S.charge >= 100) { say("Your ship is fully charged."); return render(); }
    const cost = emp.own ? 0 : Math.round((100 - S.charge) * 3.5);
    if (S.credits < cost) { say("You cannot afford a full charge."); return render(); }
    S.credits -= cost; S.charge = 100; showCredits(); say("Fully charged."); save(); render();
  }
  function sellOre(n) {
    const r = rel(), m = emp.own ? 1.25 : ARCHETYPES[emp.archetype].sells;
    let total = 0;
    for (let i = 0; i < n; i++) total += (3 * m) / (1 + (emp.own ? 0 : (r.sold + i) / 60));
    S.ore -= n; if (!emp.own) { r.sold += n; addReason(r, "You trade with them", n >= 10 ? 1 : 0.3); }
    S.credits += Math.round(total);
    sound?.tone(700, 900, 0.1, "square", 0.05);
    say(`A fair price. ${Math.round(total)} credits.`); showCredits(); save(); render();
  }
  function sellSpec(n) {
    const r = rel(), price = Math.round(22 * (emp.own ? 1.3 : ARCHETYPES[emp.archetype].buysSpecimens)) * n;
    S.specimens -= n; S.credits += price;
    if (!emp.own) addReason(r, "You trade with them", 0.6 * n);
    say(`Fascinating. ${price} credits.`); showCredits(); save(); render();
  }
  function giveOre() {
    const r = rel(), w = 6 / (1 + (r.gifts || 0) * 0.6);
    S.ore -= 5; r.gifts = (r.gifts || 0) + 1;
    addReason(r, "Your gifts", w);
    say("A generous gift. We will remember it.");
    save(); render();
  }
  function compliment() {
    const r = rel();
    if (r.praised) return say("You have said it already."), render();
    r.praised = true;
    if (score(r) < -20) { addReason(r, "Insincere flattery", -1); say("Flattery from you means nothing."); }
    else { addReason(r, "Kind words", 3); say("Kind of you to say so."); }
    save(); render();
  }
  function passage() {
    const r = rel();
    if (score(r) >= -20) { r.passage = true; say("Our space is open to you."); }
    else say("Not while we feel this way about you.");
    save(); render();
  }
  function tradeRoute() {
    const r = rel();
    if (r.route) return say("Our ships already run to your ports."), render();
    if (score(r) >= 20) { r.route = true; addReason(r, "Trade route", 4); say("A route it is. Credits will flow."); }
    else say("We would need to trust you more.");
    save(); render();
  }
  function alliance() {
    const r = rel();
    if (score(r) >= 60) { r.allied = true; addReason(r, "Alliance", 6); say("Then we stand together."); toast(emp.short + " are your allies", 3); }
    else say("An alliance is for those we trust fully.");
    save(); render();
  }
  function war() { const r = rel(); r.war = true; addReason(r, "You declared war", -90); say("So be it."); save(); render(); }
  function peace() {
    const r = rel();
    if (score(r) < -95) return say("There will be no peace."), render();
    r.war = false; addReason(r, "Peace made", 60); say("We will lay down arms. For now."); save(); render();
  }
  function gesture(kind) {
    const r = rel(), like = ARCHETYPES[emp.archetype].likes;
    if (kind === "gift") S.ore -= 3;
    let w, t, l;
    if (kind === like) { w = 16; t = "You understood their greeting"; l = "You speak as we do. Welcome, stranger."; }
    else if (kind === "gift") { w = 8; t = "A gift on first meeting"; l = "A gift. Unexpected, but kind."; }
    else if (kind === "strength" && like === "wave") { w = -8; t = "Showed strength to a peaceful people"; l = "There is no need for that here."; }
    else if (kind === "wave" && like === "strength") { w = -8; t = "Greeted warily by a proud people"; l = "A wave. You look weak to us."; }
    else { w = 2; t = "A polite first meeting"; l = "We do not know your ways, but we are listening."; }
    r.met = true;
    addReason(r, t, w);
    starView?.addEmpire?.(emp, world.empires.length);
    say(l); save(); sound?.tone(440, 880, 0.25, "sine", 0.1);
    view = "main"; render();
  }

  function firstContact(e) { open(e, "first", "<i>…zzk ○ △ … vvli …</i><br>They wait for a sign from you."); }
  function refresh(starId, mode) {
    here = world.of(starId);
    S.starId = starId;
    setCard(mode === "stars" ? null : here || (starId === homeId ? own : null));
  }
  function onArrive(star, mode = "close") {
    const e = world.of(star.id);
    refresh(star.id, mode);
    // Survey jobs finish the moment you get there.
    for (const x of [...world.empires, own]) {
      const m = rels[x.id].mission;
      if (m?.kind === "visit" && m.target === star.id) {
        const old = emp; emp = x;
        const pay = fmtReward(m.base);
        emp = old;
        S.credits += pay; rels[x.id].mission = null; rels[x.id].round = (rels[x.id].round || 0) + 1;
        showCredits(); toast(`Survey done: ${pay} credits from ${x.short}`, 4); save();
      }
    }
    if (!e) { lastSafe = star.id; return; }
    if (e.keis) {
      toast("Hostile ships close in", 3);
      return setTimeout(() => open(e, "main", "KEY. LOCK. LEAVE."), 1200);
    }
    lastSafe = star.id;
    if (!rels[e.id].met) setTimeout(() => firstContact(e), 1200);
  }
  setInterval(() => {
    let n = 0;
    for (const e of world.empires) if (rels[e.id].route && !rels[e.id].war) n++;
    if (n) { S.credits += n * 2; showCredits(); }
    for (const e of world.empires) if (rels[e.id].sold > 0) rels[e.id].sold = Math.max(0, rels[e.id].sold - 1);
  }, 6000);
  for (const e of world.empires) if (rels[e.id].met && !e.keis) starView?.addEmpire?.(e, world.empires.length);

  const onKill = () => { for (const x of [...world.empires, own]) { const m = rels[x.id].mission; if (m?.kind === "hunt" && (m.progress || 0) < m.n) { m.progress = (m.progress || 0) + 1; if (m.progress >= m.n) toast(`Job done. Report back to ${x.short}`, 4); } } save(); };
  return { onKill, onArrive, refresh, world, rels, own, open: (e, v) => open(e, v), showCredits, save, portrait };
}
