// Who you are in Space: your species and instinct from the Creature Stage save, turned into an archetype.
// The archetype names are the ten stand-ins in empires.js until the full archetype table is connected.
import { readLedger, seedLedger, instinctFor } from "../creature/identity.js";

const KEY = "johnny-spore-creature-stage";
// Each creature instinct speaks to a space archetype.
const ARCHETYPE_OF = { apex: "Warrior", packHunter: "Knight", territorial: "Zealot", symbiotic: "Ecologist", nurturing: "Diplomat", elusive: "Explorer", adaptable: "Trader", scavenger: "Scientist" };

/** @returns {{ record: object|null, name: string, archetype: string }} */
export function loadPlayer() {
  try {
    const save = JSON.parse(localStorage.getItem(KEY) || "null");
    if (save?.record) {
      const id = instinctFor(save.ledger ? readLedger(save.ledger) : seedLedger(save));
      return { record: save.record, name: save.record.name || "Your species", archetype: ARCHETYPE_OF[id] || "Explorer" };
    }
  } catch { /* no save, or an old one */ }
  return { record: null, name: "Your species", archetype: "Explorer" };
}
