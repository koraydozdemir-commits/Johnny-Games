/**
 * Autosave and recovery for the editors.
 *
 * While you edit, the creation is copied to a draft a moment after each change (debounced, never per
 * frame). The draft remembers which creation it started from, so if the page reloads or you leave by
 * accident, opening the editor on that same creation offers to bring your changes back. Saving or
 * deliberately discarding clears it. Drafts never overwrite saved creations: they live under their
 * own key and only come back when you choose Recover.
 *
 * Storage and timers are passed in, so this is unit tested.
 */

const PREFIX = "johnny-spore-editor-draft:";
/** A stable short fingerprint of a creation (FNV-1a over its JSON), to tell which one a draft belongs to. */
export function fingerprint(value) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * @param {{ kind: string, base: object, storage?: Storage|null, delay?: number, now?: () => number,
 *           setTimer?: Function, clearTimer?: Function, maxAge?: number }} o
 */
export function createDrafts(o) {
  const storage = o.storage === undefined ? (typeof localStorage === "undefined" ? null : localStorage) : o.storage;
  const key = PREFIX + o.kind;
  const base = fingerprint(o.base);
  const baseJson = JSON.stringify(o.base);
  const now = o.now || (() => Date.now());
  const setTimer = o.setTimer || ((f, ms) => setTimeout(f, ms));
  const clearTimer = o.clearTimer || ((t) => clearTimeout(t));
  const delay = o.delay ?? 900;
  const maxAge = o.maxAge ?? 7 * 864e5;
  let timer = null;
  let pending = null;
  let savedAt = 0;
  const read = () => {
    try {
      const d = JSON.parse(storage?.getItem(key) || "null");
      return d && d.v === 1 && d.data ? d : null;
    } catch (e) {
      return null;
    }
  };
  const write = (data) => {
    try {
      // Nothing to keep when the creation is back to how it was opened.
      if (JSON.stringify(data) === baseJson) storage?.removeItem(key);
      else storage?.setItem(key, JSON.stringify({ v: 1, base, savedAt: now(), data }));
      savedAt = now();
      return true;
    } catch (e) {
      return false; // storage full: the editor keeps working, the draft just isn't kept
    }
  };
  return {
    /** A draft of this same creation with changes in it, if there is one worth offering. */
    recoverable() {
      const d = read();
      if (!d || d.base !== base) return null;
      if (now() - d.savedAt > maxAge) return null;
      if (JSON.stringify(d.data) === baseJson) return null;
      return { data: d.data, savedAt: d.savedAt };
    },
    /** Note the creation changed: it is written after a short pause. */
    touch(data) {
      pending = JSON.parse(JSON.stringify(data));
      if (timer) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        const p = pending;
        pending = null;
        if (p) write(p);
      }, delay);
    },
    /** Write any waiting change now (when the page is hidden or about to unload). */
    flush() {
      if (timer) clearTimer(timer);
      timer = null;
      if (pending) write(pending);
      pending = null;
    },
    /** The creation was saved or deliberately thrown away: forget the draft. */
    clear() {
      if (timer) clearTimer(timer);
      timer = null;
      pending = null;
      try {
        storage?.removeItem(key);
      } catch (e) {
        /* nothing to clear */
      }
    },
    get savedAt() {
      return savedAt;
    },
    get dirty() {
      return !!pending;
    },
  };
}
