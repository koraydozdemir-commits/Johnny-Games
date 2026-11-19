// Save reliability: how big a Civilization save gets in a long, busy game, and that it survives repeated save/load.
const { open } = require("./harness.cjs");
(async () => {
  const { browser, page, errors } = await open({ width: 1024, height: 768 });
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__spore.closeStartScreen(); window.__spore.startCivStage(); const i = document.getElementById("intro"); if (i) i.style.display = "none"; });
  await page.waitForFunction(() => window.__spore.civStage, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const cs = window.__spore.civStage, d = cs.debug;
    for (let i = 0; i < 4800; i++) cs.update(0.25); // twenty minutes of a busy game
    for (let i = 0; i < 40; i++) d.spawnVehicle("you", "military:land", d.T.cities[0]);
    cs.save();
    const raw = localStorage.getItem("johnny-spore-civ-stage");
    const first = JSON.parse(raw);
    let ok = true;
    for (let i = 0; i < 20; i++) { cs.save(); const again = JSON.parse(localStorage.getItem("johnny-spore-civ-stage")); if (again.cities.length !== first.cities.length) ok = false; }
    return { bytes: raw.length, vehicles: first.vehicles.length, cities: first.cities.length, stable: ok, designsBytes: JSON.stringify(first.designs).length };
  });
  console.log(JSON.stringify(r), "errors", errors.length);
  await browser.close();
})();
