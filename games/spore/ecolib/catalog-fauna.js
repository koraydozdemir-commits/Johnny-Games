/**
 * Fauna catalogue: 42 creatures (six in each of seven categories). Fauna are not separate models: each
 * row is a recipe for the existing creature generator (creature/species.js generateSpecies), so they
 * use the same body, parts, abilities and balance as every other creature in the game.
 *
 * params: seed (the generator's seed), diet (plant | meat | omni), level (1..5), archetype (the
 * ecosystem role, creature/ecosystem.js), habitat (land | air | water), scale (body-size multiplier),
 * add (extra parts to attach: [partId, slot-fraction t, angle]), foot (override foot style).
 * Row size is body length in metres.
 */
import { row, withKind } from "./row.js";

const FA = (category, id, name, params, meta) => withKind([row(category, id, name, "fauna.species", { habitat: "land", scale: 1, level: 2, ...params }, meta)], "fauna")[0];
const SIDE = Math.PI / 2 - 0.2;

export const FAUNA = [
  // Herbivores
  FA("herbivore", "dune_grazer", "Dune Grazer", { seed: 4101, diet: "plant", archetype: "grazer" }, "sv,de|2-4|so,sa|2-3|c|k|1|A long-legged grazer that follows the thin green between dunes."),
  FA("herbivore", "meadow_browser", "Meadow Browser", { seed: 4102, diet: "plant", archetype: "grazer" }, "gr,tf|1-3|so|2-3|c|k|1|Roams in herds, cropping the soft grass of open country."),
  FA("herbivore", "antlerback", "Antlerback", { seed: 4103, diet: "plant", archetype: "grazer", level: 3, add: [["antlers", 0.5, 0]] }, "tf,ta|0-2|so|2.5-3.5|u|t|1|Branching antlers along its spine fend off ambushers."),
  FA("herbivore", "marsh_waddler", "Marsh Waddler", { seed: 4104, diet: "plant", archetype: "grazer", foot: "webbed" }, "sw,fw|2-4|mu,sl|2-3|c|k|1|Broad webbed feet carry it across soft, wet ground."),
  FA("herbivore", "tundra_shaggy", "Tundra Shaggy", { seed: 4105, diet: "plant", archetype: "grazer", level: 3 }, "tu,ta|0-1|so,sn|2.5-3.5|c|k|1|A thick-set, slow herd animal that scrapes lichen from under the snow."),
  FA("herbivore", "stone_nibbler", "Stone Nibbler", { seed: 4106, diet: "plant", archetype: "grazer", foot: "hooves" }, "al,wl|0-2|ro,so|2-3|u|t|1|Sure-footed on scree, grazing the tough plants of high slopes."),
  // Carnivores
  FA("carnivore", "ridge_stalker", "Ridge Stalker", { seed: 4201, diet: "meat", archetype: "ambusher" }, "al,wl|0-3|ro,so|2.5-3.5|u|s|1|Waits on the high rock and drops on whatever walks below."),
  FA("carnivore", "dune_hunter", "Dune Hunter", { seed: 4202, diet: "meat", archetype: "packHunter" }, "de,wl|3-4|sa,so|2-3|c|k|1|A lean sand-coloured pack hunter."),
  FA("carnivore", "fenland_lurker", "Fenland Lurker", { seed: 4203, diet: "meat", archetype: "ambusher", level: 3 }, "sw,fw|2-4|mu,sl|2.5-3.5|u|s|1|Lies half-submerged, mouth open, until something steps close."),
  FA("carnivore", "pack_snapper", "Pack Snapper", { seed: 4204, diet: "meat", archetype: "packHunter" }, "gr,sv|1-4|so|2-3|c|k|1|Hunts in groups, running prey down in relays."),
  FA("carnivore", "frost_fang", "Frost Fang", { seed: 4205, diet: "meat", archetype: "packHunter", level: 3 }, "tu,ta|0-1|so,sn|2.5-3.5|u|k|1|White-furred and patient, tracking herds over the snow."),
  FA("carnivore", "ember_prowler", "Ember Prowler", { seed: 4206, diet: "meat", archetype: "ambusher", level: 3 }, "vo,wl|2-4|as,ro|2.5-3.5|r|s|1|Hunts the ashlands, its dark hide invisible against cooled lava."),
  // Omnivores
  FA("omnivore", "scrub_scavenger", "Scrub Scavenger", { seed: 4301, diet: "omni", archetype: "scavenger" }, "wl,sv,de|2-4|so,sa|1.5-2.5|c|k|1|Eats anything it can find, and finds almost everything."),
  FA("omnivore", "forest_forager", "Forest Forager", { seed: 4302, diet: "omni", archetype: "scavenger" }, "tf,ta,rf|1-3|so|1.5-2.5|c|t|1|Roots through leaf litter for fruit, grubs and eggs."),
  FA("omnivore", "rootsnout", "Rootsnout", { seed: 4303, diet: "omni", archetype: "guardian" }, "rf,an|3-4|so,mu|2-3|u|t|1|Digs up tubers and defends its patch with its tusks."),
  FA("omnivore", "mudcomber", "Mudcomber", { seed: 4304, diet: "omni", archetype: "scavenger", foot: "webbed" }, "sw,fw,sh|2-4|mu,sl|1.5-2.5|c|k|1|Strains the shallows through its bill for anything edible."),
  FA("omnivore", "coast_gleaner", "Coast Gleaner", { seed: 4305, diet: "omni", archetype: "scavenger" }, "sh,gr|1-3|sa,so|1.5-2.5|c|k|1|Picks the tideline clean of shells, weed and carrion."),
  FA("omnivore", "crystal_delver", "Crystal Delver", { seed: 4306, diet: "omni", archetype: "guardian", level: 3 }, "cr,al|0-2|cy,ro|2-3|r|s|1|Gnaws mineral-rich moss from crystal caves and guards the way in."),
  // Small creatures
  FA("small", "dust_skitter", "Dust Skitter", { seed: 4401, diet: "omni", archetype: "smallPrey", scale: 0.5, level: 1 }, "de,wl|3-4|sa,so|0.4-0.8|c|d|1|A flicker of legs across hot sand."),
  FA("small", "fern_hopper", "Fern Hopper", { seed: 4402, diet: "plant", archetype: "smallPrey", scale: 0.5, level: 1 }, "rf,tf,an|2-4|so,mu|0.4-0.8|c|d|1|Springs between fronds at the first sign of danger."),
  FA("small", "burrow_nibbler", "Burrow Nibbler", { seed: 4403, diet: "plant", archetype: "smallPrey", scale: 0.55, level: 1 }, "gr,sv|1-3|so|0.4-0.8|c|d|1|Pops up from its tunnel, nibbles, and vanishes again."),
  FA("small", "pebble_dasher", "Pebble Dasher", { seed: 4404, diet: "omni", archetype: "smallPrey", scale: 0.5, level: 1 }, "tu,al|0-1|ro,sn|0.4-0.8|c|d|1|Round and fast; hides among the stones."),
  FA("small", "glimmer_mite", "Glimmer Mite", { seed: 4405, diet: "plant", archetype: "smallPrey", scale: 0.45, level: 1 }, "fu,an|1-3|so,mu|0.3-0.7|u|k|1|Tiny, shining and drawn to glowing fungi."),
  FA("small", "reed_peeper", "Reed Peeper", { seed: 4406, diet: "omni", archetype: "smallPrey", scale: 0.5, level: 1, foot: "webbed" }, "fw,sw|2-4|mu,sl|0.4-0.8|c|k|1|Calls from the reeds all night."),
  // Large creatures
  FA("large", "plains_giant", "Plains Giant", { seed: 4501, diet: "plant", archetype: "giant", scale: 2.1, level: 4, foot: "stompers" }, "sv,gr|2-4|so|5-8|u|s|1|A walking hill that crops trees and does not much care who is in the way."),
  FA("large", "marsh_colossus", "Marsh Colossus", { seed: 4502, diet: "plant", archetype: "giant", scale: 2.2, level: 4, foot: "webbed" }, "sw,fw|2-4|mu|6-9|r|s|1|Wades through the deepest bogs, grazing the water plants."),
  FA("large", "mountain_titan", "Mountain Titan", { seed: 4503, diet: "plant", archetype: "giant", scale: 2.3, level: 5, foot: "stompers" }, "al,tu|0-2|ro,so|6-9|r|s|1|Browses the high pastures and shrugs off wolves."),
  FA("large", "forest_elder", "Forest Elder", { seed: 4504, diet: "omni", archetype: "guardian", scale: 1.6, level: 4 }, "tf,ta,rf|1-3|so|4-6|r|s|1|An ancient, territorial omnivore that owns its stretch of woods."),
  FA("large", "dune_behemoth", "Dune Behemoth", { seed: 4505, diet: "plant", archetype: "giant", scale: 2, level: 4, foot: "stompers" }, "de,wl|3-4|sa,so|5-8|r|s|1|Lumbers between oases, taking long drinks and longer naps."),
  FA("large", "glacier_walker", "Glacier Walker", { seed: 4506, diet: "omni", archetype: "guardian", scale: 1.8, level: 5, add: [["tuskMaw", 1, 0]] }, "tu,al|0-1|ic,sn|5-7|q|s|1|Great tusks scrape the ice as it crosses the glaciers."),
  // Flying creatures
  FA("flying", "kite_glider", "Kite Glider", { seed: 4601, diet: "omni", archetype: "scavenger", habitat: "air", scale: 0.9, add: [["wings", 0.58, SIDE]], foot: "talons" }, "sv,gr|2-4|so|1.5-2.5|c|t|1|Rides thermals over the plains, watching for movement below."),
  FA("flying", "canopy_flapper", "Canopy Flapper", { seed: 4602, diet: "plant", archetype: "smallPrey", habitat: "air", scale: 0.7, level: 1, add: [["wings", 0.58, SIDE]] }, "rf,an|3-4|so|1-2|c|k|1|Bright flocks that flutter between fruit trees."),
  FA("flying", "cliff_swooper", "Cliff Swooper", { seed: 4603, diet: "meat", archetype: "ambusher", habitat: "air", scale: 1.1, level: 3, add: [["wings", 0.58, SIDE]], foot: "talons" }, "al,wl|0-2|ro|2-3.5|u|s|1|Dives from the cliff edge onto unwary grazers."),
  FA("flying", "marsh_skimmer", "Marsh Skimmer", { seed: 4604, diet: "omni", archetype: "scavenger", habitat: "air", scale: 0.8, add: [["fanFins", 0.58, SIDE]] }, "sw,fw|2-4|mu,sl|1.2-2|c|k|1|Skims the water for insects with its wing-like fins."),
  FA("flying", "dusk_drifter", "Dusk Drifter", { seed: 4605, diet: "plant", archetype: "smallPrey", habitat: "air", scale: 0.8, level: 1, add: [["wings", 0.58, SIDE], ["glowOrbs", 0.4, 0]] }, "fu,an,cr|1-3|so|1-1.8|r|k|1|Glows faintly as it floats through the spore-clouds."),
  FA("flying", "ember_wing", "Ember Wing", { seed: 4606, diet: "meat", archetype: "ambusher", habitat: "air", scale: 1, level: 3, add: [["wings", 0.58, SIDE], ["stinger", 0, 0]] }, "vo,wl|2-4|as,ro|1.8-3|r|s|1|Rides the heat above the lava fields."),
  // Aquatic creatures
  FA("aquaticFauna", "reef_darter", "Reef Darter", { seed: 4701, diet: "omni", archetype: "smallPrey", habitat: "water", scale: 0.6, level: 1, add: [["fanFins", 0.5, SIDE]], foot: "webbed" }, "cf,sh|3-4|sb|0.5-1|c|k|1|A flash of colour among the coral."),
  FA("aquaticFauna", "kelp_drifter", "Kelp Drifter", { seed: 4702, diet: "plant", archetype: "grazer", habitat: "water", scale: 0.9, add: [["fanFins", 0.5, SIDE], ["fanTail", 0, 0]], foot: "webbed" }, "sh,dp|0-2|sb|1.5-2.5|c|k|1|Grazes the kelp forests in slow schools."),
  FA("aquaticFauna", "deep_lurker", "Deep Lurker", { seed: 4703, diet: "meat", archetype: "ambusher", habitat: "water", scale: 1.3, level: 4, add: [["fanFins", 0.5, SIDE], ["glowOrbs", 0.4, 0]], foot: "webbed" }, "dp|0-1|sb|3-5|r|s|1|Dangles a lure in the dark and waits."),
  FA("aquaticFauna", "river_glider", "River Glider", { seed: 4704, diet: "omni", archetype: "scavenger", habitat: "water", scale: 0.9, add: [["fanFins", 0.5, SIDE]], foot: "webbed" }, "fw|1-3|sl,mu|1.5-2.5|c|k|1|Slides through slow rivers in search of anything small."),
  FA("aquaticFauna", "bog_paddler", "Bog Paddler", { seed: 4705, diet: "plant", archetype: "grazer", habitat: "water", scale: 1, add: [["fanFins", 0.5, SIDE]], foot: "webbed" }, "sw|2-4|mu,sl|1.8-2.8|c|k|1|Paddles between lily pads, nibbling as it goes."),
  FA("aquaticFauna", "ice_finner", "Ice Finner", { seed: 4706, diet: "meat", archetype: "packHunter", habitat: "water", scale: 1, level: 3, add: [["fanFins", 0.5, SIDE], ["fanTail", 0, 0]], foot: "webbed" }, "tu,sh|0-1|sl,ic|2-3|u|k|1|Hunts in packs under the sea-ice."),
];
