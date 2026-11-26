/**
 * The colour picker shared by every editor's paint tools.
 *
 * Made for fingers: a large saturation/brightness pad and a thick hue strip you can drag along
 * (the picture never hides under a tiny swatch), a palette of big swatches, your recent colours, and
 * a hex field for keyboards. Dragging previews live; letting go commits one undo step.
 */
import { PALETTE, fromHsv, luminance, parseHex, toHex, toHsv } from "./color.js";

/**
 * @param {object} o
 * @param {number} o.value
 * @param {string} [o.label]                 what is being coloured, for screen readers
 * @param {() => void} [o.onStart]           a drag or pick is starting (open an undo step)
 * @param {(c:number) => void} o.onInput     live colour while dragging
 * @param {(c:number) => void} [o.onCommit]  the colour was chosen (close the undo step)
 * @param {{items:number[], add:(c:number)=>void}} [o.recent]
 * @param {number[]} [o.palette]
 */
export function createColorPicker(o) {
  let hsv = toHsv(o.value);
  const el = document.createElement("div");
  el.className = "edPicker";
  el.innerHTML = `
    <div class="edPickRow">
      <div class="edSV" role="slider" tabindex="0" aria-label="${o.label || "Colour"}: saturation and brightness" aria-valuemin="0" aria-valuemax="100"><i class="edSVThumb"></i></div>
      <div class="edPickSide">
        <span class="edPickNow" aria-hidden="true"></span>
        <label class="edHex"><span>#</span><input inputmode="text" maxlength="7" autocomplete="off" spellcheck="false" aria-label="Hex colour"></label>
      </div>
    </div>
    <div class="edHue" role="slider" tabindex="0" aria-label="Hue" aria-valuemin="0" aria-valuemax="360"><i class="edHueThumb"></i></div>
    <div class="edSwatches" role="group" aria-label="Palette"></div>
    <div class="edRecentWrap"><small>Recent</small><div class="edSwatches edRecent" role="group" aria-label="Recent colours"></div></div>`;
  const $ = (s) => el.querySelector(s);
  const sv = $(".edSV"),
    hue = $(".edHue"),
    hexIn = $(".edHex input");
  const value = () => fromHsv(hsv);
  function paint() {
    const c = value();
    sv.style.setProperty("--hue", `hsl(${Math.round(hsv.h)} 100% 50%)`);
    $(".edSVThumb").style.left = hsv.s * 100 + "%";
    $(".edSVThumb").style.top = (1 - hsv.v) * 100 + "%";
    $(".edSVThumb").style.background = toHex(c);
    $(".edHueThumb").style.left = (hsv.h / 360) * 100 + "%";
    $(".edPickNow").style.background = toHex(c);
    sv.setAttribute("aria-valuenow", String(Math.round(hsv.v * 100)));
    sv.setAttribute("aria-valuetext", toHex(c));
    hue.setAttribute("aria-valuenow", String(Math.round(hsv.h)));
    if (document.activeElement !== hexIn) hexIn.value = toHex(c).slice(1);
    el.querySelectorAll(".edSwatches button").forEach((b) => b.setAttribute("aria-checked", String(+b.dataset.c === c)));
  }
  const swatch = (c) => `<button type="button" role="radio" data-c="${c}" style="--c:${toHex(c)};--ink:${luminance(c) > 0.45 ? "#132532" : "#fff"}" aria-label="${toHex(c)}"></button>`;
  function renderSwatches() {
    $(".edSwatches").innerHTML = (o.palette || PALETTE).map(swatch).join("");
    const rec = o.recent?.items || [];
    $(".edRecentWrap").hidden = !rec.length;
    $(".edRecent").innerHTML = rec.map(swatch).join("");
    el.querySelectorAll(".edSwatches button").forEach(
      (b) =>
        (b.onclick = () => {
          o.onStart?.();
          hsv = toHsv(+b.dataset.c);
          paint();
          o.onInput(value());
          commit();
        }),
    );
  }
  function commit() {
    const c = value();
    o.recent?.add(c);
    o.onCommit?.(c);
    renderSwatches();
    paint();
  }
  /** Drag on a pad: `set` maps the pointer's 0..1 position into the colour. */
  function dragPad(pad, set) {
    let id = null;
    const at = (e) => {
      const r = pad.getBoundingClientRect();
      set(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
      paint();
      o.onInput(value());
    };
    pad.onpointerdown = (e) => {
      if (id !== null) return;
      id = e.pointerId;
      e.preventDefault();
      try {
        pad.setPointerCapture(e.pointerId);
      } catch (err) {
        /* already released */
      }
      pad.classList.add("held");
      o.onStart?.();
      at(e);
    };
    pad.onpointermove = (e) => e.pointerId === id && at(e);
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      pad.classList.remove("held");
      commit();
    };
    pad.onpointerup = end;
    pad.onpointercancel = end;
    pad.onlostpointercapture = end;
  }
  dragPad(sv, (x, y) => {
    hsv.s = x;
    hsv.v = 1 - y;
  });
  dragPad(hue, (x) => (hsv.h = x * 359.9));
  /** Arrow keys move the pads (keyboards and switch access). */
  const keys = (pad, f) =>
    (pad.onkeydown = (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      o.onStart?.();
      f(...d);
      paint();
      o.onInput(value());
      commit();
    });
  keys(sv, (dx, dy) => {
    hsv.s = Math.min(1, Math.max(0, hsv.s + dx));
    hsv.v = Math.min(1, Math.max(0, hsv.v - dy));
  });
  keys(hue, (dx) => (hsv.h = (hsv.h + dx * 360 + 360) % 360));
  hexIn.onchange = () => {
    const c = parseHex(hexIn.value);
    if (c === null) return paint();
    o.onStart?.();
    hsv = toHsv(c);
    paint();
    o.onInput(c);
    commit();
  };
  hexIn.onkeydown = (e) => e.key === "Enter" && hexIn.blur();
  renderSwatches();
  paint();
  return {
    el,
    /** Show another colour (a different layer was chosen), without committing anything. */
    set(c) {
      hsv = toHsv(c);
      paint();
    },
    get value() {
      return value();
    },
  };
}
