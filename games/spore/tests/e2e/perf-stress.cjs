const { open } = require("./harness.cjs");
(async () => {
  const { browser, page, errors } = await open({ width: 1024, height: 768 });
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  await page.waitForTimeout(500);
  const t0 = Date.now();
  await page.evaluate(async () => { const m = await import("/games/spore/gfx/body.js"); m.setQuality(new URLSearchParams(location.search).get("q") || "high"); window.__spore.closeStartScreen(); window.__spore.startCivStage(); const i = document.getElementById("intro"); if (i) i.style.display = "none"; });
  await page.waitForFunction(() => window.__spore.civStage, null, { timeout: 90000 });
  const open_ms = Date.now() - t0;
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const cs = window.__spore.civStage, d = cs.debug;
    const heap = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1);
    const out = { heap0: heap() };
    // ---- steady state, AI running
    const time = (n, dt) => { const t = performance.now(); for (let i = 0; i < n; i++) cs.update(dt); return (performance.now() - t) / n; };
    out.idleMs = +time(120, 1 / 30).toFixed(2);
    // ---- a big war: 60 vehicles each side-ish
    for (const n of d.T.nations) n.war = true;
    for (let i = 0; i < 72; i++) {
      const owner = ["you", "n0", "n1", "n2"][i % 4]; const cities = d.T.cities.filter((c) => c.owner === owner); const home = cities[0] || d.T.cities[0];
      const role = i % 3 === 0 ? "economic" : "military"; const key = (owner === "you" ? role : d.T.cities.find((c) => c.owner === owner)?.type || role) + ":land";
      try { const v = d.spawnVehicle(owner, key.startsWith("economic") || key.startsWith("military") || key.startsWith("religious") ? key : "military:land", home); v.pos.x = home.x + (i % 9) * 6 - 24; v.pos.z = home.z + 25 + Math.floor(i / 9) * 6; } catch (e) { out.spawnErr = String(e); }
    }
    out.vehicles = d.T.vehicles.length;
    out.warMs = +time(120, 1 / 30).toFixed(2);
    out.warWorstMs = 0; for (let i = 0; i < 90; i++) { const t = performance.now(); cs.update(1 / 30); out.warWorstMs = Math.max(out.warWorstMs, +(performance.now() - t).toFixed(1)); }
    // ---- camera sweep over the planet
    d.rig.setDistance(110); d.rig.snap(); let worst = 0, tot = 0;
    for (let i = 0; i < 240; i++) { d.rig.panMetres(16, 4); const t = performance.now(); cs.update(1 / 60); const ms = performance.now() - t; worst = Math.max(worst, ms); tot += ms; }
    out.pan = { avg: +(tot / 240).toFixed(2), worst: +worst.toFixed(1) };
    // ---- zoom sweep
    let zw = 0; for (const dist of [60, 120, 250, 450, 580, 300, 90]) { d.rig.setDistance(dist); for (let i = 0; i < 20; i++) { const t = performance.now(); cs.update(1 / 60); zw = Math.max(zw, performance.now() - t); } }
    out.zoomWorst = +zw.toFixed(1);
    const info = window.__spore.renderer.info;
    out.gl = { geometries: info.memory.geometries, textures: info.memory.textures, calls: info.render.calls, tris: info.render.triangles };
    out.stats = d.stats();
    out.heap1 = heap();
    return out;
  });
  console.log(JSON.stringify({ open_ms, ...r }, null, 1));
  console.log("errors", errors.slice(0, 4));
  await browser.close();
})();
