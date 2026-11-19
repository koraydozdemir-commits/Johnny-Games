/**
 * Catalogue of fungi (30), aquatic life (30), rocks and geology (40) and environment props (30).
 * Pure data (see catalog-flora.js for the row format). Generators are in gen-nature.js.
 */
import { row, withKind } from "./row.js";

const MU = (id, name, params, meta) => row("mushroom", id, name, "fungus.mushroom", params, meta);
const FG = (id, name, gen, params, meta) => row("mushroom", id, name, "fungus." + gen, params, meta);
const GF = (id, name, gen, params, meta) => row("giantFungus", id, name, "fungus." + gen, params, meta);
const AQ = (id, name, gen, params, meta) => row("aquatic", id, name, "aquatic." + gen, params, meta);
const CO = (id, name, gen, params, meta) => row("coral", id, name, "aquatic." + gen, params, meta);
const RK = (id, name, gen, params, meta) => row("rock", id, name, "geo." + gen, params, meta);
const CR = (id, name, gen, params, meta) => row("crystal", id, name, "geo." + gen, params, meta);
const FM = (id, name, gen, params, meta) => row("formation", id, name, "geo." + gen, params, meta);
const FS = (id, name, gen, params, meta) => row("fossil", id, name, "prop." + gen, params, meta);
const RU = (id, name, gen, params, meta) => row("ruin", id, name, "prop." + gen, params, meta);
const DC = (id, name, gen, params, meta) => row("decor", id, name, "prop." + gen, params, meta);
const PR = (id, name, gen, params, meta) => row("prop", id, name, "prop." + gen, params, meta);

export const FUNGI = [
  MU("fly_agaric", "Fly Agaric", { h: 0.3, capR: 0.16, c1: 0xd82a2a, c2: 0xff6a4a, spots: 9, ring: 1 }, "tf,ta|0-2|so|0.2-0.35|u|k|3|The storybook toadstool: scarlet cap, white spots, poisonous."),
  MU("porcini", "Porcini", { h: 0.22, capR: 0.15, stalk: "bulb", c1: 0x8a5a32, c2: 0xc89a62, gills: 0 }, "tf,ta|1-2|so|0.15-0.3|u|s|3|A fat brown cap on a swollen stalk, prized by foragers."),
  MU("chanterelle", "Golden Chanterelle", { h: 0.18, capR: 0.12, cap: "bell", stalk: "thick", c1: 0xe0a02a, c2: 0xffd870, n: 3, spread: 0.2, gills: 0 }, "tf,rf|1-3|so|0.12-0.25|u|k|3|Trumpets of apricot gold in the leaf litter."),
  MU("button_cluster", "Button Mushrooms", { h: 0.1, capR: 0.07, c1: 0xf0e8dc, c2: 0xffffff, n: 6, spread: 0.2, gills: 0 }, "gr,tf|1-3|so|0.08-0.18|c|d|3|Small white domes crowding out of damp grass."),
  MU("parasol", "Parasol Mushroom", { h: 0.45, capR: 0.2, cap: "flat", c1: 0xc8b8a0, c2: 0xece4d4, ring: 1, spots: 5, spotC: 0x8a6a4a }, "gr,tf|1-3|so|0.3-0.55|u|s|3|A tall, thin stalk under a broad, flat, scaly cap."),
  MU("ink_cap", "Shaggy Ink Cap", { h: 0.35, capR: 0.08, cap: "cone", c1: 0xece8e0, c2: 0x2a2a30, stalk: "thin", n: 3, spread: 0.15 }, "gr,tf|1-3|so|0.25-0.45|c|k|3|A white bullet that melts to black ink."),
  MU("blue_bell_cap", "Bluebell Cap", { h: 0.2, capR: 0.1, cap: "bell", c1: 0x3a6ad8, c2: 0x9ac8ff, n: 4, spread: 0.2 }, "fu,an|1-3|so,mu|0.15-0.3|r|k|3|Soft blue bells that appear after rain."),
  MU("violet_cluster", "Violet Webcap", { h: 0.16, capR: 0.1, cap: "flat", c1: 0x8a4ac8, c2: 0xd8a0ff, n: 5, spread: 0.26 }, "fu,tf|0-2|so|0.12-0.25|c|k|3|Purple caps in tight family groups."),
  MU("glow_cluster", "Glow Cluster", { h: 0.2, capR: 0.1, cap: "bell", c1: 0x20c8c0, c2: 0xc0fff4, n: 5, spread: 0.24, stalkC: 0x9affe0 }, "fu,an,cr|1-3|so,mu|0.15-0.3|u|k|3|Bioluminescent caps that light a whole clearing."),
  FG("puffball_white", "White Puffball", "puffball", { r: 0.2 }, "gr,tf|1-3|so|0.2-0.45|c|t|3|A soft white ball that bursts into a cloud of spores."),
  FG("puffball_grey", "Grey Puffball", "puffball", { r: 0.28, c1: 0xb8b4a8, babies: 3, squash: 0.8 }, "wl,tu,ta|0-2|so|0.25-0.6|c|s|3|A dusty grey sphere with its young beside it."),
  FG("stinkhorn", "Stinkhorn", "stinkhorn", { h: 0.5 }, "tf,rf,sw|2-3|so,mu|0.3-0.6|u|s|3|Smells of rot to draw in the flies that spread it."),
  FG("morel", "Morel", "morel", { h: 0.3 }, "tf,ta|0-2|so|0.2-0.4|r|s|3|A honeycombed brown cone, found after fire or flood."),
  FG("coral_fungus_pink", "Pink Coral Fungus", "coralFungus", { len: 0.3, c1: 0xe8a0b8, c2: 0xfff0d8 }, "tf,rf,an|1-3|so|0.15-0.35|u|k|3|Branches like a tiny pink reef on the forest floor."),
  FG("coral_fungus_gold", "Golden Coral Fungus", "coralFungus", { len: 0.35, levels: 3, c1: 0xe8c040, c2: 0xfff4b0, r: 0.05 }, "fu,an|1-3|so|0.18-0.4|r|k|3|Antler-like golden fingers."),
  FG("cups_orange", "Orange Peel Fungus", "cups", { n: 7 }, "tf,gr|1-3|so|0.1-0.25|c|d|3|Bright, thin cups scattered like peel."),
  FG("cups_scarlet", "Scarlet Elf Cups", "cups", { n: 5, c1: 0xd82a3a, c2: 0xff8a8a }, "tf,ta|0-2|so|0.1-0.2|u|k|3|Blood-red goblets on rotting twigs."),
  FG("shelf_oak", "Oak Bracket", "shelf", { tiers: 4, r: 0.3, c1: 0x9a6a3a, c2: 0xd0a870 }, "tf,ta|1-3|so|0.5-0.9|c|s|3|Shelves of brown bracket fungus climbing a stump."),
  FG("shelf_ember", "Ember Bracket", "shelf", { tiers: 5, r: 0.26, c1: 0xd8501a, c2: 0xffb050, stub: 0x2a2018 }, "vo,wl,fu|2-4|so,as|0.5-0.9|r|s|3|Fire-coloured shelves on charred wood."),
  MU("toadstool_ring", "Fairy Ring", { h: 0.14, capR: 0.07, c1: 0xc8a070, c2: 0xe8d0a0, n: 9, spread: 0.55, gills: 0 }, "gr,tf|1-3|so|0.9-1.4|u|k|3|A perfect circle of small brown mushrooms."),
];

export const GIANT_FUNGI = [
  GF("giant_purple", "Giant Violet Cap", "giantCap", { h: 6, capR: 3.2, c1: 0x7a4ad0, c2: 0xc89aff }, "fu,an|1-3|so,mu|5-9|u|t|3|A parasol of purple the height of a house."),
  GF("giant_blue_spots", "Spotted Sky Cap", "giantCap", { h: 8, capR: 3.8, c1: 0x2a5ad0, c2: 0x80b8ff, spots: 12, gillC: 0xa8d0ff }, "fu,an|0-2|so,mu|7-12|r|s|3|Midnight blue, dotted white, towering over its neighbours."),
  GF("giant_red_spots", "Giant Toadstool", "giantCap", { h: 5, capR: 3, c1: 0xd02a2a, c2: 0xff7a5a, spots: 10, ring: 1, cap: "convex" }, "fu,tf,an|1-3|so|4-8|r|s|3|A cartoon-red cap big enough to shelter a herd."),
  GF("giant_bell", "Giant Glow Bell", "giantCap", { h: 6, capR: 2.8, cap: "bell", c1: 0x20c8b8, c2: 0xc0fff0, gillC: 0x9affe0 }, "fu,cr,an|1-3|so,mu|5-9|u|t|3|A glowing bell whose edge sheds spore-light."),
  GF("pagoda_red", "Red Pagoda Fungus", "pagoda", { h: 8, tiers: 4, capR: 2.6 }, "fu,an|2-4|so,mu|7-11|u|s|3|Stacked red tiers narrowing to a point."),
  GF("pagoda_teal", "Teal Pagoda", "pagoda", { h: 10, tiers: 6, capR: 2, c1: 0x1a8a8a, c2: 0x80e8d0 }, "fu,sw|1-3|mu,so|9-14|r|s|3|A slender tower of cool teal discs."),
  GF("forked_caps", "Forked Cap Tree", "forkedCaps", { h: 7, arms: 4 }, "fu,an|1-3|so,mu|6-10|u|t|3|A trunk that splits into arms, each carrying its own cap."),
  GF("spire_fungus", "Violet Spire Fungus", "spire", { h: 7, tiers: 5 }, "fu,cr|0-2|so,cy|6-9|r|s|3|A cone-tiered fungal tower."),
  GF("bulb_cap_amber", "Amber Puff-top", "bulbCap", { h: 5, capR: 2 }, "fu,an|2-4|so|4-7|u|t|3|A globe of amber studded with glowing orbs."),
  GF("shelf_tower", "Shelf Tower", "shelfTower", { h: 8, shelves: 6, capR: 1.8 }, "fu,sw,tf|1-3|so,mu|7-11|u|s|3|Giant brackets spiralling up a living column."),
];

export const AQUATIC = [
  AQ("kelp_giant", "Giant Kelp", "kelp", { h: 6, strands: 4, blades: 8 }, "sh,dp|0-2|sb|4-9|c|k|3|Towering strands that make underwater forests."),
  AQ("kelp_golden", "Golden Kelp", "kelp", { h: 4.5, strands: 5, c1: 0x9a7a2a, c2: 0xe8c060 }, "sh|1-3|sb|3-6|u|k|3|Amber ribbons, warm in the sun."),
  AQ("kelp_short", "Bladder Kelp", "kelp", { h: 2, strands: 6, blades: 4, bladeLen: 0.6, c1: 0x6a7a2a, c2: 0xb0c060 }, "sh|0-2|sb,sl|1.5-2.5|c|d|3|A bushy under-storey of short ribbons."),
  AQ("kelp_red", "Red Kelp", "kelp", { h: 3, strands: 4, c1: 0x8a2a3a, c2: 0xe0707a }, "sh,dp|0-2|sb|2-4|u|k|3|Crimson fronds that thrive in deeper water."),
  AQ("seagrass_green", "Seagrass", "seagrass", { n: 16, h: 1 }, "sh,fw|1-4|sb,sl,mu|0.6-1.3|c|d|3|Meadows of green ribbon in warm shallows."),
  AQ("eelgrass_long", "Eelgrass", "seagrass", { n: 20, h: 1.8, w: 0.05, c1: 0x3a6a4a, c2: 0x8ac08a }, "sh,fw|0-3|sb,sl,mu|1.4-2.2|c|d|3|Long, dark ribbons that sway as one."),
  AQ("seagrass_blue", "Blue Grass", "seagrass", { n: 14, h: 1.2, w: 0.08, c1: 0x2a6a9a, c2: 0x80d0ff }, "sh,an|1-3|sb,sl|0.9-1.5|r|k|3|Alien blue ribbons that glimmer with light."),
  AQ("lily_pink", "Pink Water Lily", "lilyPad", { r: 0.5, pads: 2 }, "fw,sw|1-4|mu,sl|0.8-1.4|c|k|3|Floating pads and a pink star of petals."),
  AQ("lily_white", "White Lily Raft", "lilyPad", { r: 0.45, pads: 5, petal: 0xffffff }, "fw,sw|1-3|mu,sl|1.4-2.6|c|d|3|A whole raft of pads and pale blooms."),
  AQ("lily_giant", "Giant Lily", "lilyPad", { r: 1.2, pads: 1, flower: 0, c1: 0x2a7a3a, c2: 0x5aa84a }, "fw,rf,an|3-4|mu,sl|2-3|r|s|3|A pad broad enough to hold a small creature."),
  AQ("anemone_pink", "Pink Anemone", "anemone", { n: 22 }, "sh,cf|2-4|sb,ro|0.3-0.6|c|k|3|A ring of waving pink tentacles."),
  AQ("anemone_green", "Emerald Anemone", "anemone", { n: 28, c1: 0x3aa86a, c2: 0xc0ffd8, len: 0.5, r: 0.3 }, "sh,cf|2-4|sb,ro|0.35-0.7|u|k|3|Glowing green tentacles tipped with violet."),
  AQ("sponge_yellow", "Tube Sponge", "sponge", { tubes: 5, h: 0.8 }, "sh,cf,dp|1-4|sb,ro|0.5-1|c|k|3|Yellow tubes that filter the passing current."),
  AQ("sponge_purple", "Purple Vase Sponge", "sponge", { tubes: 3, h: 1.1, tubeR: 0.18, c1: 0x7a3aa8, c2: 0xc090e0 }, "dp,cf|0-3|sb,ro|0.8-1.3|u|s|3|Heavy purple vases rooted in the deep."),
  AQ("tube_worms", "Tube Worms", "tubeWorms", { n: 7, h: 0.5 }, "cf,dp,vo|0-4|sb,ro|0.3-0.6|u|k|3|Feathery red crowns on pale tubes."),
  AQ("crinoid", "Feather Star", "crinoid", { arms: 10, h: 0.7 }, "cf,dp|1-4|sb,ro|0.5-0.9|u|s|3|A living flower that walks on its arms."),
  AQ("sea_pen", "Sea Pen", "seaPen", { pairs: 9, h: 0.9 }, "dp,sh|0-3|sb|0.6-1.1|u|k|3|A feather-shaped colony stuck in the silt."),
  AQ("reeds_water", "Water Reeds", "seagrass", { n: 12, h: 2.2, w: 0.1, c1: 0x6a8a3a, c2: 0xc0d080, radius: 0.35 }, "fw,sw|1-4|mu,sl|1.8-2.6|c|d|3|Reeds standing in a metre of still water."),
];

export const CORALS = [
  CO("staghorn", "Staghorn Coral", "branchCoral", { levels: 3, len: 0.5 }, "cf,sh|3-4|sb,ro|0.5-1.2|c|k|3|Antler branches in orange and cream."),
  CO("elkhorn", "Elkhorn Coral", "branchCoral", { levels: 2, len: 0.8, spread: 0.9, up: 0.1, kids: [3, 4], c1: 0xc8803a, c2: 0xffe0a0 }, "cf|3-4|sb,ro|0.9-1.6|u|k|3|Broad flattened branches reaching sideways to the light."),
  CO("finger_coral", "Finger Coral", "branchCoral", { levels: 1, len: 0.55, kids: [5, 6], spread: 0.35, c1: 0xe8b0c0, c2: 0xffffff, r: 0.08 }, "cf,sh|2-4|sb,ro|0.3-0.7|c|k|3|Short, thick, pink fingers."),
  CO("brain_gold", "Golden Brain Coral", "brainCoral", { r: 0.5 }, "cf,sh|3-4|sb,ro|0.5-1|c|t|3|A grooved dome like a folded brain."),
  CO("brain_green", "Green Brain Coral", "brainCoral", { r: 0.7, c1: 0x4aa86a, c2: 0x1a5a3a, groove: 28, squash: 0.6 }, "cf,sh|2-4|sb,ro|0.7-1.4|u|s|3|A deep-green ridged boulder, centuries old."),
  CO("table_blue", "Blue Table Coral", "tableCoral", { r: 0.9, plates: 2 }, "cf|3-4|sb|0.9-1.8|u|s|3|A broad shelf of blue on a short stalk."),
  CO("table_pink", "Pink Plate Coral", "tableCoral", { r: 1.1, plates: 3, c1: 0xd8509a, c2: 0xffb0d8, h: 0.6 }, "cf|3-4|sb|1-2|r|s|3|Stacked pink plates catching the sun."),
  CO("pillar_purple", "Pillar Coral", "pillarCoral", { n: 5, h: 0.9 }, "cf,sh|2-4|sb,ro|0.5-1.2|u|k|3|Rounded columns in violet."),
  CO("bubble_coral", "Bubble Coral", "bubbleCoral", { n: 12, r: 0.4 }, "cf,sh|2-4|sb,ro|0.3-0.6|u|k|3|Glassy green bubbles, each one a polyp."),
  CO("leaf_coral", "Lettuce Coral", "leafCoral", { n: 7, h: 0.7 }, "cf,sh,an|2-4|sb,ro|0.5-1|c|k|3|Ruffled sheets folded like lettuce."),
  CO("fire_coral", "Fire Coral", "branchCoral", { levels: 2, len: 0.45, kids: [3, 4], c1: 0xe84a1a, c2: 0xffc060, spread: 0.7 }, "cf,vo|3-4|sb,ro|0.4-0.9|u|k|3|Stinging orange branches that glow like embers."),
  CO("sea_fan_gold", "Golden Sea Fan", "seaFan", { r: 0.7, h: 1.1, c1: 0xd8a020, c2: 0xffe080 }, "cf,dp|2-4|sb,ro|0.9-1.6|u|s|3|A net-like gold fan facing the current."),
];

export const ROCKS = [
  RK("boulder_grey", "Grey Boulder", "boulder", { r: 0.9 }, "tf,gr,al,ta|0-4|so,ro|0.8-2.2|c|t|3|A weathered grey stone."),
  RK("boulder_mossy", "Mossy Boulder", "boulder", { r: 1.1, c1: 0x7a8068, c2: 0x9a9a84, moss: 0x5a8a3a }, "tf,rf,sw,ta,fu|1-3|so,mu|1-2.4|c|t|3|A boulder furred green on its shaded side."),
  RK("boulder_red", "Red Sandstone Boulder", "boulder", { r: 1, c1: 0xa0583a, c2: 0xc88a5a }, "de,wl,sv|3-4|ro,sa|0.9-2.2|c|t|3|Sun-baked red stone."),
  RK("boulder_basalt", "Dark Basalt", "boulder", { r: 0.9, c1: 0x2e3238, c2: 0x4a505a, lump: 0.22 }, "vo,wl,dp|0-4|ro,as,sb|0.8-2|c|t|3|Black volcanic rock, on land and on the sea floor."),
  RK("boulder_cluster", "Boulder Cluster", "boulder", { r: 0.9, n: 4 }, "al,tu,ta|0-2|ro,so|1.5-3|c|k|3|A few stones lying together where a glacier left them."),
  RK("boulder_limestone", "Pale Limestone", "boulder", { r: 1.2, c1: 0xcfc8b4, c2: 0xe8e2d0, squash: 0.6, lump: 0.2 }, "gr,al,sh,cf,dp|1-3|ro,so,sb|1-2.6|c|t|3|Smooth, pale, softly pitted stone."),
  RK("sandstone_chunk", "Sandstone Chunk", "boulder", { r: 0.8, c1: 0xd8a870, c2: 0xe8c898, squash: 0.85 }, "de,wl|3-4|sa,ro|0.7-1.7|c|t|3|A crumbly chunk of layered desert stone."),
  RK("pebbles_river", "River Pebbles", "pebbles", { n: 22, radius: 0.9 }, "fw,sh,gr|1-3|sl,so,mu|0.5-1.4|c|d|3|Rounded stones worn smooth by water."),
  RK("pebbles_black", "Black Pebbles", "pebbles", { n: 26, radius: 0.9, c1: 0x22262c, c2: 0x4a5058 }, "vo,wl,sh,dp|1-4|as,ro,sb|0.5-1.4|c|d|3|Dark gravel of cooled lava."),
  RK("pebbles_white", "White Pebbles", "pebbles", { n: 24, radius: 0.8, c1: 0xd8d4c8, c2: 0xf4f0e8, max: 0.12 }, "sh,tu,de|0-3|sa,sl,sn|0.4-1.2|c|d|3|Bright, bleached gravel."),
  RK("slab_flagstone", "Flagstone", "slab", { w: 2, t: 0.3 }, "gr,tf,al|1-3|ro,so|1.5-3|c|t|3|A wide flat stone, level enough to stand on."),
  RK("slab_shale", "Tilted Shale", "slab", { w: 2.4, t: 0.25, tilt: 0.35, c1: 0x5a606a, c2: 0x8a909a, yaw: 1.1 }, "al,tu,wl|0-3|ro|1.6-3.2|c|t|3|Thin, dark layers split and heaved up."),
  RK("stack_small", "Stone Stack", "stack", { n: 3, r: 0.6 }, "al,tu,tf|0-3|ro,so|0.8-1.5|u|s|3|A natural pile of balanced stones."),
  RK("stack_tall", "Balanced Pillar", "stack", { n: 5, r: 0.8, c1: 0x7a7468, c2: 0xb0a890 }, "de,wl,al|1-4|ro,sa|2-4|r|s|3|Stones piled so high they should have fallen."),
  RK("rubble_pile", "Rubble Pile", "boulder", { r: 0.7, n: 7, c1: 0x7a7870, c2: 0xaaa89c }, "al,wl,vo|0-4|ro,so,as|1.2-2.6|c|k|3|A fall of broken stone at the foot of a slope."),
  RK("lava_rock", "Lava Rock", "lavaRock", { r: 0.9 }, "vo|3-4|as,ro|0.8-1.8|u|k|3|Black rock veined with glowing orange."),
  RK("lava_cracked", "Cooling Lava", "lavaRock", { r: 1.2, veins: 3, glow: 0xc84a1a, c1: 0x3a2e2e }, "vo,wl|2-4|as,ro|1-2.4|c|t|3|A crust still dull-red in its cracks."),
  RK("boulder_ice", "Glacial Erratic", "boulder", { r: 1.2, c1: 0xb8d0e0, c2: 0xe8f4ff, lump: 0.2 }, "tu,al,ta|0-1|ic,sn,ro|1-2.8|u|s|3|A blue-white boulder frozen into the ice."),
];

export const CRYSTALS = [
  CR("quartz_cluster", "Quartz Cluster", "crystalCluster", { n: 6, c1: 0xe8f0f8, c2: 0xffffff, h: 1.2 }, "cr,al|0-3|cy,ro|0.7-1.5|c|k|3|Clear, six-sided points in a bunch."),
  CR("amethyst_cluster", "Amethyst Cluster", "crystalCluster", { n: 7, h: 1.4 }, "cr,an|1-3|cy,ro|0.8-1.8|u|k|3|Deep violet crystals, darkest at the root."),
  CR("citrine_cluster", "Citrine Cluster", "crystalCluster", { n: 6, c1: 0xe8a020, c2: 0xffe8a0, h: 1.2 }, "cr,de|2-4|cy,ro,sa|0.7-1.5|u|k|3|Honey-gold crystals that catch the light."),
  CR("emerald_spire", "Emerald Spire", "crystalSpire", { h: 6, c1: 0x20c870, tip: 0xc0ffe0 }, "cr,an|1-3|cy|4-8|r|s|3|A green tower of crystal growing through the ground."),
  CR("sapphire_spire", "Sapphire Spire", "crystalSpire", { h: 8, w: 1, c1: 0x2a6ad8, tip: 0xc0e0ff, sides: 6 }, "cr|0-2|cy|6-10|r|s|3|An enormous blue crystal, humming faintly."),
  CR("rose_bed", "Rose Quartz Bed", "crystalBed", { n: 20, h: 0.5 }, "cr,an|1-3|cy,so|0.5-1.1|u|d|3|Dozens of pink points in a low glittering bed."),
  CR("ice_spikes", "Ice Spikes", "iceSpikes", { n: 7, h: 1.8 }, "tu,cr,al|0-0|ic,sn|1-2.2|u|k|3|Sharp blue spikes of ancient ice."),
  CR("obsidian_shards", "Obsidian Shards", "iceSpikes", { n: 8, h: 1.5, c1: 0x15151c, w: 0.2 }, "vo,wl|2-4|as,ro|1-1.9|u|k|3|Black volcanic glass in jagged blades."),
  CR("geode_purple", "Purple Geode", "geode", { r: 0.7 }, "cr,de,wl|1-4|ro,cy|0.5-1|r|s|3|A split stone lined with violet crystals."),
  CR("geode_teal", "Teal Geode", "geode", { r: 0.9, c2: 0x40e0d0, inner: 0x103a3a, n: 11 }, "cr,sh|1-3|ro,cy|0.7-1.2|r|s|3|Hollow and glittering with teal crystals."),
];

export const FORMATIONS = [
  FM("mesa_red", "Red Mesa", "mesa", { r: 3, h: 4 }, "de,wl,sv|3-4|ro,sa|6-14|u|s|3|A banded red mesa with a flat top."),
  FM("butte_tall", "Tall Butte", "mesa", { r: 1.6, h: 6, bands: [0x9a5a3a, 0xc88a5a, 0xe0b080, 0x7a4a30], top: 0x7a6a4a }, "de,wl|3-4|ro,sa|8-16|r|s|3|A slender, steep-sided tower of stratified stone."),
  FM("arch_red", "Red Rock Arch", "arch", { w: 5, h: 4 }, "de,wl|3-4|ro,sa|5-10|r|s|3|A natural bridge worn through solid sandstone."),
  FM("arch_pale", "Pale Arch", "arch", { w: 4, h: 3, c1: 0xcfc8b0, c2: 0xe8e0c8 }, "al,sh,gr|1-3|ro|4-8|r|s|3|A pale limestone arch eroded by the sea."),
  FM("hoodoo", "Hoodoo", "hoodoo", { h: 4.5 }, "de,wl|3-4|ro,sa|3-7|u|k|3|A pillar of soft rock capped with a harder stone."),
  FM("basalt_columns", "Basalt Columns", "basalt", { h: 2.4 }, "vo,sh,al|1-4|ro,as|2-5|u|k|3|Hexagonal stone columns cooled from lava."),
  FM("granite_tor", "Granite Tor", "tor", { n: 5, r: 1.4 }, "al,tu,wl|0-3|ro|3-7|u|s|3|Stacked rounded blocks left by weathering."),
  FM("stalagmites", "Stalagmite Field", "stalagmites", { n: 7, h: 2 }, "cr,wl,an|0-3|ro,cy|1.5-3.5|u|k|3|Mineral cones rising from the ground."),
  FM("geyser_vent", "Geyser Vent", "vent", { h: 1.1, r: 1.6 }, "vo,tu,an|0-4|ro,as,so|2-4|r|s|3|A mineral cone that erupts steam on a timer."),
  FM("spring_terraces", "Spring Terraces", "terrace", { steps: 4, r: 2 }, "vo,an|3-4|ro,so|3-6|r|s|3|Stepped, mineral-rimmed hot pools."),
  FM("rock_ridge", "Rock Ridge", "ridge", { n: 6, h: 2, len: 6 }, "al,wl,tu|0-3|ro|4-9|c|k|3|A knife-edge of jagged stone."),
  FM("rock_spire", "Rock Spire", "spire", { h: 5, blocks: 6 }, "al,wl,de|0-4|ro|4-8|u|s|3|A jagged needle of stacked, tilting stone."),
];

export const FOSSILS = [
  FS("ribcage_large", "Great Ribcage", "ribcage", { len: 3.4, r: 1.2, ribs: 8 }, "de,wl,sv|2-4|sa,so,ro|3-5|r|s|3|The bleached ribs of something enormous."),
  FS("ribcage_small", "Small Ribcage", "ribcage", { len: 1.8, r: 0.6, ribs: 6, c1: 0xd8ccb0 }, "gr,wl,tu|0-4|so,sa|1.5-2.5|u|s|3|A small creature's ribcage, half sunk in the ground."),
  FS("skull_beast", "Beast Skull", "skull", { r: 0.6 }, "wl,de,tu|0-4|so,sa|0.8-1.6|u|s|3|A big, toothed skull staring out of the dust."),
  FS("skull_horned", "Horned Skull", "skull", { r: 0.7, horn: 1, teeth: 3, c1: 0xdcd0b4 }, "sv,wl|2-4|so,sa|1-2|r|s|3|A heavy skull with a single curved horn."),
  FS("ammonite", "Giant Ammonite", "ammonite", { r: 0.8 }, "sh,de,wl|1-4|ro,sa|0.8-1.8|u|s|3|A coiled shell turned to stone."),
  FS("tusk_giant", "Giant Tusk", "tusk", { len: 3 }, "tu,wl,sv|0-3|so,sn,sa|2.5-4|r|s|3|A great curved tusk, half buried."),
];

export const RUINS = [
  RU("column_broken", "Broken Column", "column", { h: 3.2, capital: 0, rubble: 3 }, "gr,de,sv,wl|1-4|so,sa|2-4|u|s|3|A fluted shaft snapped off above the ground."),
  RU("column_whole", "Standing Column", "column", { h: 4, capital: 1 }, "gr,de,sv|1-4|so,sa|3-5|r|s|3|A lone column still holding up nothing."),
  RU("colonnade_arch", "Colonnade", "colonnade", { n: 3, h: 3, broken: 1 }, "gr,de,sv|1-4|so,sa|3-5|r|s|3|Three columns and a lintel, the rest long gone."),
  RU("wall_crumbled", "Crumbled Wall", "wall", { len: 4, h: 1.8, blocks: 9 }, "gr,tf,de,wl|0-4|so,sa|3-5|u|k|3|A low wall of fitted stone, mostly fallen."),
  RU("obelisk_dark", "Dark Obelisk", "obelisk", { h: 5, w: 0.5 }, "wl,de,an|0-4|so,sa,ro|4-7|r|s|3|A black spire carved with faded symbols."),
  RU("statue_weathered", "Weathered Statue", "statue", { h: 3 }, "gr,tf,wl|0-4|so|2.2-3.5|r|s|3|A figure worn nearly featureless by rain."),
  RU("stone_circle", "Stone Circle", "circle", { n: 8, r: 3, h: 2 }, "gr,tu,al,tf|0-3|so,ro|5-8|r|s|3|Standing stones set in a ring for reasons now lost."),
  RU("tower_stump", "Tower Stump", "tower", { h: 5, r: 1.3 }, "gr,wl,al,de|0-4|so,ro,sa|4-7|r|s|3|The broken base of a round tower."),
];

export const DECOR = [
  DC("fallen_log", "Fallen Log", "log", { len: 3, r: 0.35 }, "tf,rf,ta,sw|0-4|so,mu|2.5-4|c|t|3|A rotting trunk lying where it fell."),
  DC("mossy_log", "Mossy Log", "log", { len: 4, r: 0.45, moss: 6, c1: 0x4a4a38, mossC: 0x4a8a3a }, "rf,tf,sw,fu|1-3|so,mu|3.5-5|c|t|3|Green with moss and busy with beetles."),
  DC("tree_stump", "Tree Stump", "stump", { r: 0.5, h: 0.6 }, "tf,ta,rf|0-3|so|0.9-1.6|c|t|3|A cut stump showing its growth rings."),
  DC("bone_scatter", "Scattered Bones", "bones", { n: 9 }, "wl,de,tu,gr|0-4|so,sa,sn|1-2|c|k|3|A few old bones and a skull, scattered by scavengers."),
  DC("leaf_litter", "Autumn Litter", "litter", { n: 26, radius: 1 }, "tf,ta|0-3|so|1-2|c|d|3|Fallen leaves in russet and gold."),
  DC("pine_needles", "Pine Needles", "litter", { n: 32, radius: 1.2, c1: 0x7a5a2a, c2: 0xa88a4a }, "ta,al,tf|0-2|so|1.2-2.4|c|d|3|A brown carpet of needles."),
  DC("soil_mound", "Soil Mound", "mound", { r: 1, h: 0.45, n: 4 }, "gr,tf,sv|1-4|so|0.9-2|c|t|3|A heap of turned earth."),
  DC("moss_patch", "Moss Patch", "patch", { n: 6, r: 1 }, "tf,rf,sw,ta,fu|1-3|so,mu,ro|1-2.2|c|d|3|A soft green cushion on shaded ground."),
  DC("shell_heap", "Shell Heap", "shells", { n: 12 }, "sh,fw,de|1-4|sa,sl|0.8-1.6|c|k|3|A scatter of shells and beach glass."),
  DC("driftwood", "Driftwood", "driftwood", { n: 3, len: 2.2 }, "sh,fw,sw|0-4|sa,sl,mu|2-3.4|c|k|3|Bleached sticks washed up by the tide."),
];

export const PROPS = [
  PR("totem_pole", "Totem Pole", "totem", { h: 3.5, tiers: 4 }, "tf,ta,gr,rf|0-4|so|3-4.5|r|s|3|A carved pole of stacked faces."),
  PR("stone_cairn", "Stone Cairn", "cairn", { layers: 4 }, "al,tu,wl,ta|0-3|ro,so,sn|0.6-1.2|u|s|3|A pile of stones that marks a path or a grave."),
  PR("impact_crater", "Impact Crater", "crater", { r: 2.2 }, "wl,vo,de,tu|0-4|so,as,sa,ro|3-6|r|s|3|A shallow bowl with a raised, scorched rim."),
  PR("wreck_hull", "Wreckage", "wreck", { len: 5, ribs: 7 }, "sh,wl,de|0-4|sa,so,sl|4-7|r|s|3|The ribs of a wrecked hull, long since stripped."),
  PR("old_nest", "Abandoned Nest", "nestBowl", { r: 0.7, eggs: 3 }, "tf,gr,sv,al|0-4|so,ro|0.5-1.2|u|s|3|A woven bowl of twigs, eggs still inside."),
  PR("monolith_glow", "Glowing Monolith", "obelisk", { h: 6, w: 0.6, glow: 1, c1: 0x20242c, cap: 0x7affd8, base: 0x3a3e48, sides: 4 }, "an,cr,wl|0-4|so,cy,ro|5-8|q|s|3|A smooth black slab inscribed with lines of cold light."),
];

/** Fungi and aquatic life are flora; rocks, crystals and formations dress the environment. */
export const NATURE = [...FUNGI, ...GIANT_FUNGI, ...AQUATIC, ...CORALS, ...withKind([...ROCKS, ...CRYSTALS, ...FORMATIONS], "environment")];
export const ENVIRONMENT = withKind([...FOSSILS, ...RUINS, ...DECOR, ...PROPS], "environment");
