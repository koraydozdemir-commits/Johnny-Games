/**
 * The universe screen: every playthrough as a card (its creature, species, stage, progress, play
 * time, last played and discoveries), with create, play, rename, duplicate, export, import and
 * delete (with a confirmation that names what will be lost).
 */
import { formatPlaytime, formatWhen, parseSeed, readMeta, shareCode, summarize } from "./model.js";
import { counts } from "../pedia/model.js";
import { pedia as pediaStore } from "./pedia-store.js";
import { createUniverse, deleteUniverse, duplicateUniverse, exportText, importText, keysFor, renameUniverse, activate } from "./manager.js";

const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * @param {object} o
 * @param {object} o.store
 * @param {Storage} o.ls
 * @param {object} o.current             the universe in play
 * @param {() => Promise<void>|void} o.beforeLeave  save the running game
 * @param {() => void} o.reload
 * @param {() => void} o.onClose
 * @param {(kind:string) => void} [o.sfx]
 */
export function openUniverses(o) {
  const el = document.createElement("div");
  el.className = "uv";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "uvTitle");
  el.innerHTML = `
    <div class="uvPanel">
      <div class="uvTop"><div><small>Johnny Games Spore</small><h2 id="uvTitle">Universes</h2></div><button class="pdBtn" id="uvClose" aria-label="Close">✕</button></div>
      ${o.store.persistent ? "" : `<p class="uvWarn" role="note">This browser isn't letting the game store universes, so other universes will be lost when you close the page. Export any you want to keep.</p>`}
      <div class="uvBar">
        <button class="pdPrimary" id="uvNew">✦ New universe</button>
        <label class="pdSecondary uvImport">⤒ Import<input type="file" id="uvFile" accept=".json,application/json" hidden></label>
      </div>
      <form class="uvNewForm" id="uvNewForm" hidden>
        <label><span>Name</span><input id="uvNewName" maxlength="32" placeholder="My new universe" autocomplete="off" spellcheck="false"></label>
        <label><span>Galaxy seed <small>(optional: a number or a friend's SPORE- code gives the same galaxy they have)</small></span><input id="uvNewSeed" maxlength="14" placeholder="Random, 12345 or SPORE-ABC123" autocomplete="off" spellcheck="false" autocapitalize="characters"></label>
        <p class="uvHint">Your current universe is saved first. The new one starts a fresh Cell Stage in a new galaxy.</p>
        <div class="uvBtns"><button type="button" class="pdSecondary" id="uvNewCancel">Cancel</button><button class="pdPrimary">Create and play</button></div>
      </form>
      <p class="uvMsg" id="uvMsg" role="status" aria-live="polite"></p>
      <div class="uvList" id="uvList" role="list"></div>
    </div>
    <div class="uvConfirm" id="uvConfirm" hidden role="alertdialog" aria-modal="true" aria-labelledby="uvCTitle" aria-describedby="uvCText">
      <div><h3 id="uvCTitle"></h3><p id="uvCText"></p><label class="uvCheck"><input type="checkbox" id="uvCAlso"> Also remove its creations from the Global Sporepedia</label><div class="uvBtns"><button class="pdSecondary" id="uvCNo">Keep it</button><button class="uvDanger" id="uvCYes">Delete forever</button></div></div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  const $ = (q) => el.querySelector(q);
  const msg = (t, bad = false) => {
    $("#uvMsg").textContent = t;
    $("#uvMsg").classList.toggle("bad", bad);
  };
  let busy = false;
  const guard = (fn) => async (...a) => {
    if (busy) return;
    busy = true;
    el.classList.add("busy");
    el.setAttribute("aria-busy", "true");
    try {
      await fn(...a);
    } catch (e) {
      msg(e.message || "Something went wrong.", true);
    } finally {
      busy = false;
      el.classList.remove("busy");
      el.removeAttribute("aria-busy");
    }
  };

  async function render() {
    const metas = (await o.store.all("meta")).map(readMeta).filter(Boolean);
    metas.sort((a, b) => (b.id === o.current.id) - (a.id === o.current.id) || b.lastPlayed - a.lastPlayed);
    const cards = await Promise.all(
      metas.map(async (m) => {
        const keys = await keysFor(o.store, o.ls, o.current, m.id);
        const sum = summarize(keys);
        const ped = await pediaStore.get(o.store, m.id).catch(() => null);
        const c = ped ? counts(ped) : {};
        const playing = m.id === o.current.id;
        return `<article class="uvCard ${playing ? "playing" : ""}" role="listitem" aria-label="${esc(m.name)}${playing ? ", playing now" : ""}">
          <div class="uvThumb">${m.thumb ? `<img src="${m.thumb}" alt="" width="96" height="96">` : `<span aria-hidden="true">${sum.icon}</span>`}</div>
          <div class="uvInfo">
            <h3>${esc(m.name)}${playing ? ` <em>Playing</em>` : ""}</h3>
            <p><b>${esc(sum.species)}</b> · ${sum.stage === "New" ? "Not started" : sum.stage + " Stage"}</p>
            ${m.home ? `<small>🪐 Homeworld <b>${esc(m.home.planet)}</b> (T3) · ${esc(m.home.star)} system · created ${esc(formatWhen(m.createdAt))}</small>` : ""}
            <i class="uvProg" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(sum.progress * 100)}"><b style="width:${Math.round(sum.progress * 100)}%"></b></i>
            <small>${esc(sum.detail)} · ${playing ? "Playing now" : "Played " + esc(formatWhen(m.lastPlayed))} · ${formatPlaytime(m.playtime)}</small>
            <small>Galaxy code <b class="uvCode">${shareCode(m.seed)}</b></small>
            <small>🔭 ${plural((c.species || 0) + (c.plant || 0), "life form")} · 🪐 ${plural(c.planet || 0, "planet")} · ✦ ${plural(c.star || 0, "star")} · Seed ${m.seed}</small>
            <form class="uvRename" data-id="${m.id}" hidden><label><span class="sr">New name</span><input maxlength="32" value="${esc(m.name)}" autocomplete="off" spellcheck="false"></label><button class="pdPrimary">Save</button></form>
          </div>
          <div class="uvActions">
            ${playing ? "" : `<button class="pdPrimary" data-act="play" data-id="${m.id}">▶ Play</button>`}
            <button class="pdSecondary" data-act="rename" data-id="${m.id}" aria-label="Rename ${esc(m.name)}">✎</button>
            <button class="pdSecondary" data-act="dup" data-id="${m.id}" aria-label="Duplicate ${esc(m.name)}">⧉</button>
            <button class="pdSecondary" data-act="export" data-id="${m.id}" aria-label="Export ${esc(m.name)}">⤓</button>
            <button class="pdSecondary" data-act="share" data-id="${m.id}" aria-label="Share the galaxy seed of ${esc(m.name)}">🔗</button>
            ${playing ? "" : `<button class="uvDanger sm" data-act="delete" data-id="${m.id}" aria-label="Delete ${esc(m.name)}">🗑</button>`}
          </div>
        </article>`;
      }),
    );
    $("#uvList").innerHTML = cards.join("");
    el.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => act(b.dataset.act, b.dataset.id, metas.find((m) => m.id === b.dataset.id))));
    el.querySelectorAll(".uvRename").forEach(
      (f) =>
        (f.onsubmit = guard(async (e) => {
          e.preventDefault();
          const m = await renameUniverse(o.store, f.dataset.id, f.querySelector("input").value);
          if (m && m.id === o.current.id) o.current.name = m.name;
          msg("Renamed to " + m.name + ".");
          await render();
        })),
    );
  }
  const act = guard(async (kind, id, m) => {
    if (kind === "play") {
      msg("Saving and loading " + m.name + "…");
      await o.beforeLeave();
      await activate(o.store, o.ls, o.current, id);
      o.reload();
    } else if (kind === "rename") {
      const f = el.querySelector(`.uvRename[data-id="${id}"]`);
      f.hidden = !f.hidden;
      if (!f.hidden) f.querySelector("input").select();
    } else if (kind === "dup") {
      msg("Copying " + m.name + "…");
      if (id === o.current.id) await o.beforeLeave();
      const c = await duplicateUniverse(o.store, o.ls, o.current, id);
      msg("Made a copy: " + c.name + ".");
      o.sfx?.("click");
      await render();
    } else if (kind === "export") {
      msg("Preparing " + m.name + " for export…");
      if (id === o.current.id) await o.beforeLeave();
      const text = await exportText(o.store, o.ls, o.current, id);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.download = m.name.replace(/[^\w-]+/g, "_") + ".spore-universe.json";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 800);
      msg("Exported " + m.name + ".");
    } else if (kind === "share") {
      // Seed sharing: the code reproduces the same galaxy, stars, planets and life; never the save itself.
      const code = shareCode(m.seed);
      let copied = false;
      try {
        await navigator.clipboard.writeText(code);
        copied = true;
      } catch (e) {
        /* no clipboard permission: the code is shown instead */
      }
      msg((copied ? "Copied " : "Galaxy code: ") + code + ". A friend can enter it under ✦ New universe to explore the same galaxy. Their discoveries stay their own.");
      o.sfx?.("click");
    } else if (kind === "delete") {
      const keys = await keysFor(o.store, o.ls, o.current, id);
      const sum = summarize(keys);
      $("#uvCTitle").textContent = "Delete " + m.name + "?";
      $("#uvCText").textContent = "This deletes " + (sum.stage === "New" ? "the universe" : sum.species + " (" + sum.stage + " Stage)") + ", its galaxy discoveries and its Sporepedia, for good. Its creations stay in your Global Sporepedia unless you tick the box. Export it first if you might want it back.";
      $("#uvCAlso").checked = false;
      const box = $("#uvConfirm");
      box.hidden = false;
      $("#uvCNo").focus();
      $("#uvCNo").onclick = () => (box.hidden = true);
      $("#uvCYes").onclick = guard(async () => {
        box.hidden = true;
        await deleteUniverse(o.store, o.current, id, { removeCreations: $("#uvCAlso").checked });
        msg("Deleted " + m.name + ".");
        await render();
      });
    }
  });
  $("#uvNew").onclick = () => {
    $("#uvNewForm").hidden = false;
    $("#uvNewName").focus();
  };
  $("#uvNewCancel").onclick = () => ($("#uvNewForm").hidden = true);
  $("#uvNewForm").onsubmit = guard(async (e) => {
    e.preventDefault();
    const seedText = $("#uvNewSeed").value.trim();
    const seed = seedText ? parseSeed(seedText) : undefined;
    if (seedText && !seed) return msg("That isn't a galaxy seed: use a whole number (1 to 2147483646) or a SPORE- code.", true);
    msg("Saving your current universe…");
    await o.beforeLeave();
    await createUniverse(o.store, o.ls, o.current, { name: $("#uvNewName").value, seed });
    o.reload();
  });
  $("#uvFile").onchange = guard(async () => {
    const f = $("#uvFile").files[0];
    $("#uvFile").value = "";
    if (!f) return;
    if (f.size > 6_000_000) throw new Error("That file is too big to be a universe save.");
    msg("Checking " + f.name + "…");
    const m = await importText(o.store, await f.text());
    msg("Imported as " + m.name + ". Tap ▶ Play to load it.");
    o.sfx?.("unlock");
    await render();
  });
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (!$("#uvConfirm").hidden) $("#uvConfirm").hidden = true;
    else close();
  };
  document.addEventListener("keydown", onKey, true);
  $("#uvClose").onclick = () => close();
  function close() {
    document.removeEventListener("keydown", onKey, true);
    el.classList.remove("show");
    setTimeout(() => el.remove(), 200);
    o.onClose?.();
  }
  render();
  return { close, render };
}
