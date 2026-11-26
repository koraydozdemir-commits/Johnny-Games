/**
 * Paint for the Cell Creator, in the shared editor design: a sheet along the bottom (left on wide
 * screens) with the three colour layers, the shared colour picker and the patterns, leaving the cell
 * in view. The Cell Stage keeps its own state; this only reads and writes the three colours and the
 * pattern through the callbacks.
 */
import { createColorPicker } from "./picker.js";
import { recentList, toHex } from "./color.js";
import { pulse } from "./chrome.js";

const LAYERS = [
  ["base", "Membrane"],
  ["pattern", "Pattern"],
  ["accent", "Accent"],
];
const PATTERNS = [
  ["speckle", "Speckles"],
  ["stripes", "Stripes"],
  ["spots", "Spots"],
  ["gradient", "Pearl"],
  ["glow", "Glow"],
];

/**
 * @param {object} o
 * @param {() => {base:number, pattern:number, accent:number, kind:string}} o.read   current colours and pattern
 * @param {() => void} o.onStart                    before a change (undo step)
 * @param {(layer:string, c:number) => void} o.onColor
 * @param {(id:string) => void} o.onPattern
 * @param {() => void} o.onClose
 * @returns {{ el: HTMLElement, refresh: () => void, close: () => void }}
 */
export function openCellPaint(o) {
  let layer = "base";
  let storage = null;
  try {
    storage = localStorage;
  } catch (e) {
    storage = null;
  }
  const recent = recentList(storage, "johnny-spore-recent-colours", 10);
  const root = document.createElement("div");
  root.className = "edRoot edCellPaint";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Paint the cell");
  document.body.appendChild(root);
  let picker = null;
  let frame = 0;
  let pending = null;
  // Colour drags fire many times a frame; the cell is rebuilt at most once per frame.
  const apply = (l, c) => {
    pending = [l, c];
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (pending) o.onColor(...pending);
      pending = null;
    });
  };
  function render() {
    const cur = o.read();
    root.innerHTML = `<div class="edCellHead"><b>Paint</b><span>Tap the membrane to add brush strokes.</span><button class="edX" aria-label="Close paint">✕</button></div>
      <div class="edLayers" role="radiogroup" aria-label="Colour layer">${LAYERS.map(([k, name]) => `<button role="radio" data-layer="${k}" aria-checked="${k === layer}"><i style="background:${toHex(cur[k])}"></i><b>${name}</b></button>`).join("")}</div>
      <div class="edPickerSlot"></div>
      <div class="edPatterns" role="radiogroup" aria-label="Pattern">${PATTERNS.map(([id, name]) => `<button role="radio" data-pattern="${id}" aria-checked="${cur.kind === id}" class="pat-${id}" style="--pa:${toHex(cur.base)};--pb:${toHex(cur.pattern)};--pc:${toHex(cur.accent)}"><i></i><span>${name}</span></button>`).join("")}</div>`;
    picker = createColorPicker({
      value: cur[layer],
      label: LAYERS.find((l) => l[0] === layer)[1] + " colour",
      recent,
      onStart: () => o.onStart(),
      onInput: (c) => {
        apply(layer, c);
        const sw = root.querySelector(`[data-layer="${layer}"] i`);
        if (sw) sw.style.background = toHex(c);
      },
      onCommit: () => {},
    });
    root.querySelector(".edPickerSlot").appendChild(picker.el);
    root.querySelectorAll("[data-layer]").forEach(
      (b) =>
        (b.onclick = () => {
          layer = b.dataset.layer;
          render();
        }),
    );
    root.querySelectorAll("[data-pattern]").forEach(
      (b) =>
        (b.onclick = () => {
          o.onStart();
          o.onPattern(b.dataset.pattern);
          render();
          pulse(root.querySelector(`[data-pattern="${b.dataset.pattern}"]`));
        }),
    );
    root.querySelector(".edX").onclick = () => o.onClose();
  }
  render();
  return {
    el: root,
    refresh: render,
    close() {
      cancelAnimationFrame(frame);
      root.remove();
    },
  };
}
