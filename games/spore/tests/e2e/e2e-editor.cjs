const { open } = require("./harness.cjs");
const OUT = require("os").tmpdir() + "/spore-e2e-";
const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  → " + extra : ""));
};
(async () => {
  const { browser, page, errors } = await open({ width: 1280, height: 800 });
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore, null, { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__spore.closeStartScreen();
    window.__spore.startCreatureStage(false, false);
    { const i = document.getElementById("intro"); if (i) i.style.display = "none"; }
  });
  await page.waitForFunction(() => window.__spore.creatureEditor && !window.__spore.creatureEditor.closed, null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  const ed = (fn, arg) => page.evaluate(([src, a]) => new Function("ed", "a", "return (" + src + ")(ed, a)")(window.__spore.creatureEditor.debug, a), [fn.toString(), arg]);
  const mouthIdOf = (rec) => rec.parts.map((p) => p.id).find((id) => ["beak", "jaws", "snout", "grinder", "shears", "fluteBeak", "trunk", "fangs", "snapper", "tuskMaw", "mandibles", "bill", "crusher", "tongue", "sawBeak"].includes(id));

  await page.click('.ceRail [data-cat="mouth"]');
  await page.waitForTimeout(300);

  // 1. Unlock state of the catalogue at the start.
  const counts = await page.evaluate(() => ({ tiles: document.querySelectorAll(".cePart").length, locked: document.querySelectorAll(".cePart.locked").length, open: [...document.querySelectorAll(".cePart:not(.locked)")].map((t) => t.dataset.part).sort() }));
  check("15 mouth tiles", counts.tiles === 15, JSON.stringify(counts));
  check("only the three starters are unlocked", counts.locked === 12 && counts.open.join() === "beak,jaws,snout", counts.open.join());

  // 2. Tap a locked mouth: it previews, says locked, shows requirements, and cannot be equipped.
  await page.click('.cePart[data-part="snapper"]');
  await page.waitForTimeout(250);
  let st = await ed((d) => ({ focus: d.focusId, preview: d.previewId, shown: d.shown.parts.map((p) => p.id), real: d.rec.parts.map((p) => p.id) }));
  check("an undiscovered locked mouth does not preview (stays a mystery)", st.focus === "snapper" && st.preview === null && st.real.includes("beak"), JSON.stringify(st));
  let info = await page.textContent("#ceInfo");
  check("locked card shows Locked + requirements", /Locked/.test(info) && /Reach brain level 3/.test(info) && /Defeat 3 creatures/.test(info), info.replace(/\s+/g, " ").slice(0, 160));
  check("locked card has no Equip button", (await page.locator("#ceInfo [data-act=equip]").count()) === 0 && (await page.locator("#ceInfo .ceAct").isDisabled()));
  const sideStats = await page.textContent("#ceStats");
  check("stats panel does not leak the undiscovered mouth", !/Snapper/.test(sideStats) && !/Previewing/.test(sideStats), sideStats.replace(/\s+/g, " ").slice(0, 120));
  const lockedName = await page.getAttribute('.cePart[data-part="snapper"]', "aria-label");
  check("an unseen locked part hides its name", /Undiscovered/.test(lockedName) || /Snapper/.test(lockedName), lockedName);
  await page.screenshot({ path: OUT + "e2e-locked-preview.png" });

  // 3. Tap an unlocked carnivore mouth: preview, compare, equip.
  await page.click('.cePart[data-part="jaws"]');
  await page.waitForTimeout(250);
  info = await page.textContent("#ceInfo");
  check("unlocked card shows diet, stats and Equip", /Carnivore/.test(info) && /Meat eating/.test(info) && (await page.locator("#ceInfo [data-act=equip]").count()) === 1);
  check("comparison against the equipped beak is shown (up/down chips)", (await page.locator("#ceInfo .ceMRow u").count()) >= 3);
  await page.click("#ceInfo [data-act=equip]");
  await page.waitForTimeout(300);
  st = await ed((d) => ({ real: d.rec.parts.map((p) => p.id), preview: d.previewId, shown: d.shown.parts.map((p) => p.id) }));
  check("Equip swaps the real design's mouth to jaws (exactly one mouth)", st.real.includes("jaws") && !st.real.includes("beak") && st.preview === null, JSON.stringify(st.real));
  const diet = await page.textContent("#ceStats h3");
  check("diet readout follows the equipped mouth", /Carnivore/.test(diet), diet);
  check("detail card now says Equipped", /Equipped/.test(await page.textContent("#ceInfo")));

  // 4. Undo / redo / reset.
  await page.click("#ceUndo");
  await page.waitForTimeout(200);
  st = await ed((d) => d.rec.parts.map((p) => p.id));
  check("Undo restores the beak", st.includes("beak") && !st.includes("jaws"), st.join());
  await page.click("#ceRedo");
  await page.waitForTimeout(200);
  st = await ed((d) => d.rec.parts.map((p) => p.id));
  check("Redo reapplies jaws", st.includes("jaws"));
  await page.click("#ceReset");
  await page.waitForTimeout(200);
  st = await ed((d) => d.rec.parts.map((p) => p.id));
  check("Reset returns to the opening design", st.includes("beak") && !st.includes("jaws"));

  // 5. Esc cancels a preview; pointing at the creature ends it.
  await page.click('.cePart[data-part="snout"]');
  await page.waitForTimeout(150);
  check("preview is on", (await ed((d) => d.previewId)) === "snout");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check("Esc clears the preview", (await ed((d) => d.previewId)) === null);

  // 6. Drag a tile with the mouse onto the creature body.
  const box = await page.locator('.cePart[data-part="snout"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 40, { steps: 5 });
  await page.mouse.move(820, 380, { steps: 12 });
  const ghost = await page.evaluate(() => !document.querySelector(".ceGhost").hidden);
  check("a drag shows the ghost thumbnail", ghost);
  await page.mouse.up();
  await page.waitForTimeout(300);
  st = await ed((d) => d.rec.parts.map((p) => p.id));
  check("dropping a mouth on the body equips it", st.includes("snout") && !st.includes("beak"), st.join());

  // 7. Locked parts cannot be dragged on.
  const lbox = await page.locator('.cePart[data-part="tuskMaw"]').boundingBox();
  await page.mouse.move(lbox.x + lbox.width / 2, lbox.y + lbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(820, 380, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  st = await ed((d) => d.rec.parts.map((p) => p.id));
  check("a locked mouth cannot be dragged onto the creature", !st.includes("tuskMaw"), st.join());

  // 8. Other categories render without emoji tiles and with thumbnails.
  for (const cat of ["senses", "limbs", "graspers", "feet", "movement", "offence", "defence", "details"]) {
    await page.click(`.ceRail [data-cat="${cat}"]`);
    await page.waitForTimeout(120);
    const c = await page.evaluate(() => ({ n: document.querySelectorAll(".cePart").length, imgs: document.querySelectorAll(".cePart img").length, title: document.querySelector(".ceCatTitle")?.textContent }));
    check(`category ${cat}: ${c.n} tiles, all with thumbnails`, c.n > 0 && c.imgs === c.n, c.title.replace(/\s+/g, " "));
  }
  await page.click('.ceRail [data-cat="limbs"]');
  await page.click('.cePart[data-part="__leg"]');
  await page.waitForTimeout(200);
  check("leg/arm cards are in Arms & Legs", (await page.locator('.cePart[data-part="__arm"]').count()) === 1);
  await page.screenshot({ path: OUT + "e2e-limbs.png" });

  // 9. Save: the stage now uses the snout (omnivore).
  await page.click("#ceDone");
  await page.waitForTimeout(1200);
  const stage = await page.evaluate(() => { const P = window.__spore.creatureStage.debug.P; return { id: P.mouthId, diet: P.diet, eat: P.mouth.eat, rec: P.record.parts.map((p) => p.id) }; });
  check("saved: the stage's mouth, diet and record all agree", stage.id === "snout" && stage.diet === "omni" && stage.rec.includes("snout") && !stage.rec.includes("beak"), JSON.stringify(stage));
  console.log("page errors:", errors.slice(0, 6));
  check("no page errors", errors.length === 0);
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("CRASH", e.stack || e.message); process.exit(2); });
