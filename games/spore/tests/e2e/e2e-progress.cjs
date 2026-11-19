const { open } = require("./harness.cjs");
const OUT = require("os").tmpdir() + "/spore-e2e-";
const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  → " + extra : ""));
};
const MOUTHS = ["beak", "grinder", "shears", "fluteBeak", "trunk", "jaws", "fangs", "snapper", "tuskMaw", "mandibles", "snout", "bill", "crusher", "tongue", "sawBeak"];
const hide = () => { const i = document.getElementById("intro"); if (i) i.style.display = "none"; };

async function start(page, resume = false) {
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(([resume, hideSrc]) => {
    window.__spore.closeStartScreen();
    window.__spore.startCreatureStage(resume, false);
    new Function("(" + hideSrc + ")()")();
  }, [resume, hide.toString()]);
}

(async () => {
  const { browser, page, errors } = await open({ width: 1280, height: 800 });

  /* ---- 1. A fresh game: three starters, nothing announced ------------------------------ */
  await start(page);
  await page.waitForFunction(() => window.__spore.creatureEditor && !window.__spore.creatureEditor.closed, null, { timeout: 30000 });
  const fresh = await page.evaluate(() => { const P = window.__spore.creatureStage.debug.P; return { brain: P.brain, unlocked: [...P.unlocked].sort(), cards: document.querySelector("#cardPop")?.classList.contains("show") }; });
  check("fresh game: starter mouths are granted silently (no card)", ["beak", "jaws", "snout"].every((m) => fresh.unlocked.includes(m)) && !fresh.cards, JSON.stringify(fresh));
  check("fresh game: nothing beyond the starters", !fresh.unlocked.some((m) => ["grinder", "fangs", "bill", "shears", "snapper"].includes(m)));
  await page.click("#ceCancel");
  await page.waitForTimeout(600);

  /* ---- 2. Reaching brain 2 earns the basic variations, with a notification ------------- */
  const mated = await page.evaluate(() => {
    const d = window.__spore.creatureStage.debug;
    d.gainXp(9999);
    d.mate();
    return { brain: d.P.brain, unlocked: [...d.P.unlocked].sort() };
  });
  check("brain 2: grinder, fangs and bill are earned", mated.brain === 2 && ["grinder", "fangs", "bill"].every((m) => mated.unlocked.includes(m)), JSON.stringify(mated));
  check("brain 2: later mouths stay locked", !mated.unlocked.some((m) => ["shears", "fluteBeak", "snapper", "tuskMaw", "crusher", "tongue", "trunk", "mandibles", "sawBeak"].includes(m)));
  await page.waitForTimeout(500);
  const card = await page.evaluate(() => ({ shown: document.querySelector("#cardPop")?.classList.contains("show"), kind: document.querySelector("#cardPopKind")?.textContent, title: document.querySelector("#cardPopTitle")?.textContent, img: document.querySelector("#cardPopArt img")?.src?.slice(0, 22) }));
  check("an unlock card pops with a thumbnail of the new mouth", card.shown && /New part/.test(card.kind) && /Evolved/.test(card.kind) && card.img === "data:image/png;base64,", JSON.stringify(card));
  await page.screenshot({ path: OUT + "e2e-unlock-card.png" });

  // The editor opens with the mate: new mouths are available, the rest show requirements.
  await page.waitForFunction(() => window.__spore.creatureEditor && !window.__spore.creatureEditor.closed, null, { timeout: 15000 }).catch(() => {});
  const edOpen = await page.evaluate(() => !!window.__spore.creatureEditor && !window.__spore.creatureEditor.closed);
  if (edOpen) {
    await page.click('.ceRail [data-cat="mouth"]');
    await page.waitForTimeout(300);
    const open = await page.evaluate(() => [...document.querySelectorAll(".cePart:not(.locked)")].map((t) => t.dataset.part).sort());
    check("the editor shows exactly the earned mouths as unlocked", open.join() === "beak,bill,fangs,grinder,jaws,snout", open.join());
    await page.click('.cePart[data-part="shears"]');
    await page.waitForTimeout(250);
    const info = (await page.textContent("#ceInfo")).replace(/\s+/g, " ");
    check("a locked mouth shows its next requirement with progress", /Reach brain level 3/.test(info) && /Taste 3 kinds of food/.test(info) && /0\/3/.test(info), info.slice(0, 200));
    await page.screenshot({ path: OUT + "e2e-requirements.png" });
    await page.click('.cePart[data-part="fangs"]');
    await page.click("#ceInfo [data-act=equip]");
    await page.waitForTimeout(200);
    await page.click("#ceDone");
    await page.waitForTimeout(1000);
  } else check("editor opened on mating", false);
  const after = await page.evaluate(() => { const P = window.__spore.creatureStage.debug.P; return { id: P.mouthId, diet: P.diet, rate: P.mouth.rate, rec: P.record.parts.map((p) => p.id) }; });
  check("equipping fangs updates diet, stats and record together", after.id === "fangs" && after.diet === "meat" && after.rate === 1.3 && after.rec.includes("fangs"), JSON.stringify(after));

  /* ---- 3. Other triggers: tasting foods, wins, allies ---------------------------------- */
  const t3 = await page.evaluate(() => {
    const stage = window.__spore.creatureStage;
    const P = stage.debug.P;
    P.brain = 3;
    P.foods.add("fruit"); P.foods.add("treeFruit"); P.foods.add("meat");
    P.alliances = 1;
    P.treated.t1 = { friends: 0, kills: 3 };
    stage.save();
    return [...P.unlocked].sort();
  });
  check("brain 3 + progress earns the specialists (shears, flute, snapper, crusher, tongue)", ["shears", "fluteBeak", "snapper", "crusher", "tongue"].every((m) => t3.includes(m)) && !t3.includes("tuskMaw"), t3.join());
  const toasts = await page.evaluate(() => document.querySelector("#cardPop")?.classList.contains("show"));
  console.log("   (card visible while queueing:", toasts, ")");

  /* ---- 4. Save, reload, resume: progression persists ----------------------------------- */
  await page.evaluate(() => window.__spore.creatureStage.save());
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("johnny-spore-creature-stage")));
  check("the save file carries the earned mouths and the equipped design", saved.unlocked.includes("shears") && saved.unlocked.includes("grinder") && saved.record.parts.some((p) => p.id === "fangs"), saved.unlocked.length + " unlocked");
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__spore, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(([hideSrc]) => {
    window.__spore.closeStartScreen();
    window.__spore.startCreatureStage(true, false);
    new Function("(" + hideSrc + ")()")();
  }, [hide.toString()]);
  await page.waitForFunction(() => window.__spore.creatureStage, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const loaded = await page.evaluate(() => { const P = window.__spore.creatureStage.debug.P; return { id: P.mouthId, diet: P.diet, brain: P.brain, unlocked: [...P.unlocked].sort(), card: document.querySelector("#cardPop")?.classList.contains("show") }; });
  check("after reload: same mouth, diet and brain", loaded.id === "fangs" && loaded.diet === "meat" && loaded.brain === 3, JSON.stringify({ id: loaded.id, diet: loaded.diet, brain: loaded.brain }));
  check("after reload: earned mouths are still unlocked, and not re-announced", loaded.unlocked.includes("shears") && loaded.unlocked.includes("tongue") && !loaded.card);

  /* ---- 5. An old save: a creature wearing a mouth it never earned is preserved --------- */
  await page.evaluate(() => {
    const key = "johnny-spore-creature-stage";
    const s = JSON.parse(localStorage.getItem(key));
    s.brain = 1;
    s.xp = 0;
    s.alliances = 0;
    s.treated = {};
    s.foods = [];
    s.unlocked = ["tuskMaw"]; // how an older save looked: no starters, no new fields
    const mouths = ["beak", "grinder", "shears", "fluteBeak", "trunk", "jaws", "fangs", "snapper", "tuskMaw", "mandibles", "snout", "bill", "crusher", "tongue", "sawBeak"];
    s.record.parts = s.record.parts.filter((p) => !mouths.includes(p.id));
    s.record.parts.push({ id: "mandibles", t: 1, angle: 0, scale: 1 }); // earned at brain 4 under the new rules
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__spore, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(([hideSrc]) => {
    window.__spore.closeStartScreen();
    window.__spore.startCreatureStage(true, false);
    new Function("(" + hideSrc + ")()")();
  }, [hide.toString()]);
  await page.waitForFunction(() => window.__spore.creatureStage, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const legacy = await page.evaluate(() => { const P = window.__spore.creatureStage.debug.P; const ed = window.__spore.creatureStage.editorState(); return { id: P.mouthId, diet: P.diet, brain: P.brain, hasMandibles: ed.unlocked.has("mandibles"), hasStarters: ["beak", "jaws", "snout"].every((m) => ed.unlocked.has(m)), hasTusk: ed.unlocked.has("tuskMaw"), hasSnapper: ed.unlocked.has("snapper"), card: document.querySelector("#cardPop")?.classList.contains("show") }; });
  check("legacy: the creature keeps its unearned mandibles (not replaced)", legacy.id === "mandibles" && legacy.diet === "meat", JSON.stringify(legacy));
  check("legacy: it can still be swapped back (mandibles stay unlocked)", legacy.hasMandibles);
  check("legacy: previously found mouths and the new starters are available, others still locked", legacy.hasTusk && legacy.hasStarters && !legacy.hasSnapper);
  check("legacy: no spurious unlock cards on load", !legacy.card);
  // Swap away and back to prove it stays yours.
  const swapped = await page.evaluate(() => {
    const stage = window.__spore.creatureStage;
    const P = stage.debug.P;
    const rec = JSON.parse(JSON.stringify(P.record));
    rec.parts = rec.parts.filter((p) => p.id !== "mandibles");
    rec.parts.push({ id: "jaws", t: 1, angle: 0, scale: 1 });
    stage.applyDesign(rec, P.dna);
    return stage.editorState().unlocked.has("mandibles");
  });
  check("legacy: after switching away, the old mouth is still unlocked", swapped);

  console.log("page errors:", errors.slice(0, 5));
  check("no page errors", errors.length === 0);
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("CRASH", e.stack || e.message); process.exit(2); });
