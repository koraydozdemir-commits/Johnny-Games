/**
 * Undo and redo for every editor, as snapshots of the creation (small JSON records, so a snapshot
 * per step is cheap and can never drift the way inverse operations can).
 *
 * A step is either one call to `record(label)` before a change, or a transaction: `begin(label)` when
 * a drag starts, any number of changes while it moves, and `end()` when it lets go. A transaction that
 * changed nothing leaves no step, and one that did is a single step however many frames it ran, so
 * dragging a part across the screen is one undo, not hundreds.
 *
 * Pure: no DOM, no THREE. The editor supplies how to take and put back a snapshot.
 */

/**
 * @template S
 * @param {{ take: () => S, put: (s: S) => void, limit?: number, same?: (a: S, b: S) => boolean, onChange?: () => void }} o
 */
export function createHistory(o) {
  const limit = Math.max(1, o.limit || 80);
  const same = o.same || ((a, b) => JSON.stringify(a) === JSON.stringify(b));
  const undo = [];
  const redo = [];
  /** The open transaction: what the creation looked like when it began. */
  let open = null;
  const changed = () => o.onChange?.();
  const push = (entry) => {
    undo.push(entry);
    if (undo.length > limit) undo.shift();
    redo.length = 0;
  };
  const api = {
    /** Remember the creation as it is now, before a one-off change. */
    record(label = "") {
      if (open) return; // a transaction is already holding the before-state
      push({ label, state: o.take() });
      changed();
    },
    /** Start a gesture that may change the creation many times. */
    begin(label = "") {
      if (open) api.end();
      open = { label, state: o.take() };
    },
    /** Finish it: one step if anything changed, none if not. Returns whether a step was added. */
    end() {
      if (!open) return false;
      const t = open;
      open = null;
      if (same(t.state, o.take())) return false;
      push(t);
      changed();
      return true;
    },
    /** Abandon an open transaction and put the creation back as it began. */
    cancel() {
      if (!open) return;
      o.put(open.state);
      open = null;
      changed();
    },
    /** Drop the last step without restoring it (a change that turned out not to happen). */
    discardLast() {
      undo.pop();
      changed();
    },
    undo() {
      if (open) api.end();
      const e = undo.pop();
      if (!e) return null;
      redo.push({ label: e.label, state: o.take() });
      o.put(e.state);
      changed();
      return e.label || "change";
    },
    redo() {
      if (open) api.end();
      const e = redo.pop();
      if (!e) return null;
      undo.push({ label: e.label, state: o.take() });
      o.put(e.state);
      changed();
      return e.label || "change";
    },
    clear() {
      undo.length = redo.length = 0;
      open = null;
      changed();
    },
    get canUndo() {
      return undo.length > 0;
    },
    get canRedo() {
      return redo.length > 0;
    },
    get inTransaction() {
      return !!open;
    },
    get size() {
      return undo.length;
    },
    /** Label of the step Undo would take back. */
    get undoLabel() {
      return undo.at(-1)?.label || "";
    },
    get redoLabel() {
      return redo.at(-1)?.label || "";
    },
  };
  return api;
}
