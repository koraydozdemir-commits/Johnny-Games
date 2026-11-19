/**
 * Flora catalogue: 40 trees and 60 plants. Pure data: each row picks a generator archetype and
 * parameters (see gen-flora.js), then says where the plant lives. Sizes are the longest dimension in
 * metres. Add a row to add an asset; nothing else changes.
 */
import { row } from "./row.js";

const T = (id, name, gen, params, meta) => row("tree", id, name, "tree." + gen, params, meta);
const S = (id, name, gen, params, meta) => row("smallTree", id, name, "tree." + gen, params, meta);
const B = (id, name, gen, params, meta) => row("bush", id, name, "plant." + gen, params, meta);
const G = (id, name, gen, params, meta) => row("grass", id, name, "plant." + gen, params, meta);
const F = (id, name, gen, params, meta) => row("flower", id, name, "plant." + gen, params, meta);
const U = (id, name, gen, params, meta) => row("succulent", id, name, "plant." + gen, params, meta);
const C = (id, name, gen, params, meta) => row("crystalPlant", id, name, "plant." + gen, params, meta);
const A = (id, name, gen, params, meta) => row("alienPlant", id, name, "plant." + gen, params, meta);

export const TREES = [
  T("oak_broad", "Broadleaf Oak", "broadleaf", { h: 9, forks: 3, crownR: 3, clumps: 3 }, "tf,gr|1-3|so|10-18|c|t|3|A wide, forking oak with a heavy rounded crown."),
  T("maple_crimson", "Crimson Maple", "broadleaf", { h: 8, forks: 3, crownR: 2.6, c1: 0xb83a2a, c2: 0xe87a3a }, "tf,ta|1-3|so|8-14|u|t|3|Flame-coloured leaves that blaze against dark trunks."),
  T("elm_vase", "Vase Elm", "broadleaf", { h: 11, forks: 5, crownR: 2.2, crownY: 0.86, clumps: 2, c1: 0x4a8a3a, c2: 0x80b050 }, "tf,gr|1-3|so,mu|11-18|c|t|3|Branches sweep upward and out like a tall vase."),
  T("ironwood", "Ironwood", "branchy", { levels: 3, len: 3.4, r: 0.22, spread: 0.9, leafR: 0.6, trunk: 0x4a3a2a, c1: 0x2f6a3a, c2: 0x5a9a4a }, "tf,rf|2-3|so|8-14|u|t|3|Dense, dark timber and a broad, layered crown."),
  T("birch_white", "White Birch", "branchy", { levels: 3, len: 3.8, r: 0.12, spread: 0.55, shrink: 0.74, up: 0.55, leafR: 0.38, trunk: 0xe8e4d8, bark: 0x3a3a3a, c1: 0x9ac04a, c2: 0xd0e070, kids: [2, 3] }, "tf,ta,tu|0-2|so,sn|9-15|c|k|3|Slender, white-barked and quick to colonise cold ground."),
  T("oak_gnarled", "Gnarled Oak", "branchy", { levels: 3, len: 2.8, r: 0.3, spread: 1.15, curl: 0.8, kids: [2, 3], leafR: 0.7, trunk: 0x5a4430, c1: 0x4a7a3a, c2: 0x7a9a4a }, "tf,wl|1-3|so,ro|6-11|u|s|3|Twisted by centuries of wind into a sprawling shape."),
  T("snag_bleached", "Bleached Snag", "branchy", { levels: 3, len: 3.6, r: 0.18, spread: 0.8, leaf: "none", trunk: 0xc8c0b0 }, "wl,de,sw|1-4|so,sa,mu|6-11|c|s|3|A dead tree, stripped and silvered by weather."),
  T("pine_scots", "Scots Pine", "conifer", { h: 14, tiers: 4, wide: 1.8, tierH: 0.22, c1: 0x3a6a3a, c2: 0x5a8a4a, sides: 8 }, "ta,al,tf|0-2|so,ro|12-20|c|c|3|Flat-topped pine with bare orange trunk and sparse tiers."),
  T("spruce_blue", "Blue Spruce", "conifer", { h: 12, tiers: 8, wide: 2, tierH: 0.26, c1: 0x4a7a9a, c2: 0x8ab8d0 }, "ta,al|0-1|so,sn|10-18|u|k|3|Frosted blue needles on a neat, symmetrical cone."),
  T("fir_snow", "Snow Fir", "conifer", { h: 13, tiers: 7, wide: 2.2, tierH: 0.3, snow: 1, c1: 0x2a5a42, c2: 0x4a7a5a }, "ta,tu,al|0-1|sn,so|11-18|c|d|3|Droop-limbed fir that carries a coat of snow all winter."),
  T("cedar_wide", "Wide Cedar", "conifer", { h: 10, tiers: 5, wide: 3.2, tierH: 0.2, taper: 0.6, c1: 0x2f6a4a, c2: 0x5a9a6a }, "al,tf,ta|1-2|so,ro|9-16|u|t|3|Layered, spreading boughs that shade a wide circle."),
  T("larch_golden", "Golden Larch", "conifer", { h: 12, tiers: 9, wide: 1.5, tierH: 0.2, sides: 6, c1: 0xc8a030, c2: 0xe8d060 }, "ta,al|0-2|so|10-17|r|t|3|A conifer that turns pure gold in the cold."),
  T("palm_coconut", "Coconut Palm", "palm", { h: 10, curve: 1.6, fronds: 9, frondLen: 3.2, nuts: 4 }, "sh,rf,sv|3-4|sa|9-14|c|t|3|A leaning shore palm that drops its nuts into the surf."),
  T("palm_date", "Date Palm", "palm", { h: 8, curve: 0.4, fronds: 14, frondLen: 2.6, nuts: 7, nutC: 0xc87a2a, trunk: 0x8a6a40 }, "de,sv|3-4|sa,so|7-12|c|k|3|Tight crown of stiff fronds and dangling date clusters."),
  T("palm_fan", "Fan Palm", "palm", { h: 6, curve: 0.2, fronds: 16, frondLen: 1.9, tilt: 1.25, frondW: 0.9, nuts: 0, c1: 0x4a8a3a }, "rf,sw,an|2-4|so,mu|5-9|u|k|3|Round, pleated fronds on a short straight trunk."),
  T("baobab_giant", "Giant Baobab", "bulbous", { h: 8, bulge: 2, crown: 5, neck: 0.4, c1: 0x6a8a3a, c2: 0x8aaa4a }, "sv,de|3-4|so,sa|7-13|r|s|3|A swollen water-store of a trunk topped with tiny branches."),
  T("bottle_tree", "Bottle Tree", "bulbous", { h: 6, bulge: 1.2, neck: 0.3, crown: 4, tuft: 0.7, trunk: 0x9a8a6a, c1: 0x7aa05a, c2: 0xa8c070 }, "sv,de,wl|3-4|so,ro|5-8|u|s|3|Bottle-shaped trunk that swells with every rainfall."),
  T("acacia_flat", "Flat-top Acacia", "umbrella", { h: 7, lean: 0.9, spreadR: 4.5, layers: 3 }, "sv,gr|2-4|so,sa|7-12|c|s|3|The classic savanna parasol: a flat canopy on a leaning trunk."),
  T("acacia_tiered", "Tiered Acacia", "umbrella", { h: 9, lean: 0.4, spreadR: 3.6, layers: 4, thick: 0.55, c1: 0x6a9a3c, c2: 0x9aba4a }, "sv|3-4|so|8-13|u|s|3|Stacked canopy layers that catch every angle of the sun."),
  T("willow_weeping", "Weeping Willow", "weeping", { h: 9, domeR: 3.5, strands: 18, len: 5 }, "fw,sw,tf|1-3|so,mu|9-14|c|k|3|Trails long green curtains into the water below."),
  T("willow_golden", "Golden Weeper", "weeping", { h: 11, domeR: 3.8, strands: 24, len: 6, c1: 0xc8a850, c2: 0xe8d890 }, "tf,fu,an|1-3|so|10-16|r|s|3|A willow whose hanging leaves glow like beaten gold."),
  T("cypress_tall", "Tall Cypress", "columnar", { h: 14, w: 1.6, puffs: 7 }, "tf,gr,wl|2-4|so,ro|12-20|c|t|3|A dark flame-shaped column pointing at the sky."),
  T("poplar_slim", "Slim Poplar", "columnar", { h: 16, w: 1.1, puffs: 9, c1: 0x5a8a3a, c2: 0x9ac05a, stretch: 1.8 }, "gr,tf,fw|1-3|so|14-22|c|k|3|Narrow columns that stand in windbreak rows."),
  T("corkscrew_tree", "Corkscrew Tree", "spiralTree", { h: 9, turns: 2.5, coil: 0.9, pods: 9 }, "an,fu|2-3|so|8-12|u|t|3|Its trunk coils like a spring, studded with soft pods."),
  T("spiral_amethyst", "Amethyst Spiral", "spiralTree", { h: 11, turns: 3.2, coil: 1.1, pods: 12, trunk: 0x4a3a6a, c1: 0xa060e0, c2: 0xe0a0ff, podR: 0.55 }, "cr,an|1-3|so,cy|9-14|r|s|3|A violet corkscrew whose pods ring faintly in the wind."),
  T("candelabra_tree", "Candelabra Tree", "candelabra", { h: 8, arms: 5, armLen: 3 }, "de,sv,wl|3-4|so,sa|7-11|u|s|3|Arms curl out then straight up, each ending in a green brush."),
  T("fern_tree", "Giant Tree Fern", "fernTree", { h: 7, fronds: 11, frondLen: 3.4 }, "rf,tf,an|2-3|so,mu|5-9|c|d|3|A scaly trunk bursting into huge arching fronds."),
  T("crystal_tree", "Crystal Tree", "crystalTree", { len: 3, gem: 0.22, gemH: 1.1 }, "cr|0-3|so,cy|7-12|u|t|3|Bare branches that end in faceted blue crystals."),
  T("lantern_tree", "Lantern Tree", "podTree", { len: 3.4, pods: 3 }, "an,fu|2-3|so|7-11|u|t|3|Hung with glowing pods that light the undergrowth at night."),
  T("mangrove_stilt", "Stilt Mangrove", "mangrove", { h: 6, roots: 8, spreadR: 2.6 }, "sw,sh|3-4|mu,sl|5-9|c|d|3|Arching roots hold it above the tide."),
  T("rainforest_emergent", "Rainforest Emergent", "buttress", { h: 20, fins: 5, crownR: 5.5 }, "rf|3-4|so|20-34|u|s|3|Buttressed giant that towers over the canopy."),
  T("ironbark_dead", "Ember Snag", "branchy", { levels: 3, len: 3.2, r: 0.2, spread: 1, leaf: "none", trunk: 0x2a2624, curl: 0.6 }, "vo,wl|2-4|as,so|5-9|c|s|3|A burnt trunk, black and brittle, still standing."),
];

export const SMALL_TREES = [
  S("pine_windtwist", "Wind-twisted Pine", "branchy", { levels: 3, len: 1.6, r: 0.1, spread: 1.2, curl: 1, leaf: "needle", trunk: 0x5a4a38, c1: 0x3a6a3a, c2: 0x6a9a4a, leafR: 0.4 }, "al,tu,ta|0-2|ro,so|2-4|u|s|3|Sculpted sideways by the gales on exposed ridges."),
  S("orchard_tree", "Orchard Tree", "broadleaf", { h: 3.5, forks: 3, crownR: 1.6, clumps: 2, c1: 0x5a9a3a, c2: 0x90c050 }, "tf,gr|1-3|so|3-5|c|t|3|A tidy rounded tree, easy to climb."),
  S("juniper_blue", "Blue Juniper", "conifer", { h: 3.5, tiers: 4, wide: 1.1, c1: 0x4a6a6a, c2: 0x8aa8a8, sides: 6 }, "al,de,tu|0-3|ro,so|2-4|c|t|3|A low blue-grey conifer clinging to stony slopes."),
  S("olive_old", "Old Olive", "branchy", { levels: 3, len: 1.7, r: 0.16, spread: 1, curl: 0.8, trunk: 0x6a5a48, c1: 0x9aa86a, c2: 0xc0c890, leafR: 0.38 }, "sv,gr|2-4|so,ro|3-5|u|s|3|Silver-leaved with a gnarled, hollow trunk."),
  S("thorn_tree", "Thorn Tree", "umbrella", { h: 3.5, spreadR: 2, layers: 2, thick: 0.4, c1: 0x7a8a3a, c2: 0xa8b050 }, "sv,de|3-4|so,sa|3-5|c|s|3|A small flat-topped tree armed with long spines."),
  S("palmetto_dwarf", "Dwarf Palmetto", "palm", { h: 2.5, curve: 0.2, fronds: 10, frondLen: 1.5, nuts: 0, tilt: 1.1, c1: 0x3a7a3a }, "sh,sw,sv|3-4|sa,so|2-3|c|k|3|A stemless palm that forms thick clumps."),
  S("coral_tree", "Red Coral Tree", "candelabra", { h: 3, arms: 4, armLen: 1.4, tuft: 6, tuftLen: 0.7, c1: 0xd8503a, c2: 0xffa070, trunk: 0x7a4a3a }, "rf,sv,an|3-4|so|2-4|r|s|3|Blazing red tufts crown each curling arm."),
  S("ghost_sapling", "Ghost Sapling", "podTree", { len: 1.4, levels: 2, pods: 2, c1: 0xa8e8ff, c2: 0xe8ffff, trunk: 0xd8e4ec, podR: 0.14 }, "fu,cr,tu|0-2|so,sn,cy|2-3|r|t|3|A pale, glassy sapling hung with faintly glowing buds."),
];

export const BUSHES = [
  B("berry_bush", "Berry Bush", "bush", { r: 0.8, clumps: 6, berries: 14 }, "tf,gr|1-3|so|0.8-1.4|c|t|3|Heavy with red berries that every forager knows."),
  B("blueberry", "Wild Blueberry", "bush", { r: 0.6, clumps: 5, berries: 18, berryC: 0x3a4a9a, c1: 0x4a6a3a, c2: 0x7a9a4a }, "ta,tu,al|0-2|so|0.5-1|c|d|3|Low, dense and covered with blue-black fruit."),
  B("holly", "Holly", "bush", { r: 0.9, clumps: 5, berries: 10, c1: 0x1f5a34, c2: 0x3a7a4a, light: 0x5a9a5a }, "tf,ta|0-2|so|1-1.8|u|t|3|Glossy dark leaves and bright winter berries."),
  B("boxwood", "Boxwood", "bush", { r: 0.7, clumps: 3, squash: 1, c1: 0x2f7a3a, c2: 0x4a9a4a }, "tf,gr|1-3|so|0.8-1.4|c|t|3|A tight, dense ball of tiny leaves."),
  B("lilac_shrub", "Lilac Shrub", "bush", { r: 1.1, clumps: 7, c1: 0x7a5aa8, c2: 0xc0a0e0, light: 0xe8d8ff, squash: 0.9 }, "tf,gr|1-3|so|1.4-2.4|u|t|3|Heavy plumes of fragrant lilac-coloured bloom."),
  B("gorse", "Golden Gorse", "scrub", { stems: 12, h: 1, thorns: 1, c1: 0xc8b030, c2: 0xe8d860, leafR: 0.22, trunk: 0x5a4a30 }, "gr,wl,tu|0-3|so,ro|0.8-1.4|c|d|3|A prickly mass of yellow blossom on stony ground."),
  B("sagebrush", "Sagebrush", "scrub", { stems: 9, h: 0.9, c1: 0x7a8a6a, c2: 0xb0c0a0, trunk: 0x6a5a48 }, "de,gr,wl|2-4|so,sa|0.7-1.2|c|d|3|Silver-grey scrub that scents the whole desert."),
  B("heather", "Purple Heather", "scrub", { stems: 14, h: 0.6, c1: 0x8a4a8a, c2: 0xc080c0, leafR: 0.14, trunk: 0x4a3a30 }, "tu,ta,al|0-2|so|0.4-0.8|c|d|3|Carpets the moors in purple."),
  B("thornscrub", "Thornscrub", "scrub", { stems: 11, h: 1.3, thorns: 1, c1: 0x6a7a3a, c2: 0x9aa860, trunk: 0x4a3a2a }, "sv,de,wl|3-4|so,ro|1-1.8|c|d|3|A knot of grey twigs armed with thorns."),
  B("rhododendron", "Rhododendron", "bush", { r: 1.2, clumps: 8, c1: 0x2f6a3a, c2: 0xd8508a, light: 0xff90b8, squash: 0.85 }, "tf,al,rf|1-3|so|1.4-2.6|u|t|3|Dark leathery leaves under pink flower trusses."),
  B("bracken", "Bracken", "fern", { fronds: 9, len: 1.1, w: 0.3, c1: 0x4a8a3a, c2: 0x9ac050 }, "tf,ta|1-3|so|0.8-1.4|c|d|3|Waist-high fern that spreads in dense stands."),
  B("sword_fern", "Sword Fern", "fern", { fronds: 12, len: 1.4, w: 0.22, droop: 0.4, c1: 0x2f7a46, c2: 0x68b062 }, "tf,rf,ta|1-3|so,mu|1-1.8|c|k|3|Erect, evergreen fronds in a neat vase shape."),
  B("ruffle_fern", "Ruffle Fern", "fern", { fronds: 7, len: 0.9, w: 0.5, droop: 1, c1: 0x6aa84a, c2: 0xc0e070 }, "rf,an,sw|2-4|so,mu|0.6-1.1|u|k|3|Wide, ruffled fronds in bright lime."),
  B("swamp_fern", "Marsh Fern", "fern", { fronds: 8, len: 1.2, w: 0.26, droop: 0.9, c1: 0x3a6a4a, c2: 0x80a870 }, "sw,fw|1-4|mu,so|0.8-1.4|c|d|3|Grows in the soft, wet margins of pools."),
];

export const GRASSES = [
  G("meadow_grass", "Meadow Grass", "grassTuft", { n: 22, h: 0.6, w: 0.08 }, "gr,tf,sv|1-3|so|0.4-0.8|c|d|3|Soft green tufts that make up most lowlands."),
  G("prairie_tall", "Tall Prairie Grass", "grassTuft", { n: 20, h: 1.5, w: 0.07, bend: 0.5, c1: 0x9a9a3a, c2: 0xe0d070, radius: 0.2 }, "gr,sv|2-3|so|1.2-1.9|c|d|3|Chest-high golden stems that ripple like water."),
  G("blue_fescue", "Blue Fescue", "grassTuft", { n: 26, h: 0.35, w: 0.035, bend: 0.2, c1: 0x6a98a8, c2: 0xb0d8e8, radius: 0.12, tilt: 0.45 }, "al,tu,gr|0-2|so,ro|0.25-0.45|u|k|3|Round blue-grey hummocks of fine blades."),
  G("pampas_plume", "Pampas Plume", "grassTuft", { n: 24, h: 1.9, w: 0.09, bend: 0.6, c1: 0x8a9a5a, c2: 0xf0ecd8, radius: 0.28 }, "gr,sv|2-4|so|1.6-2.4|u|s|3|Fountains of blades topped with silver plumes."),
  G("tundra_tussock", "Tundra Tussock", "grassTuft", { n: 30, h: 0.3, w: 0.04, bend: 0.3, c1: 0x7a7a4a, c2: 0xb8b078, radius: 0.18, tilt: 0.5 }, "tu,al|0-1|so,sn|0.25-0.4|c|d|3|Tight hummocks that cover frozen ground."),
  G("dune_grass", "Dune Grass", "grassTuft", { n: 14, h: 0.8, w: 0.045, bend: 0.5, c1: 0x9aaa6a, c2: 0xe0e0a0, radius: 0.2 }, "de,sh|2-4|sa|0.6-1|c|k|3|Spiky blades that bind shifting sand."),
  G("reed_bed", "Reed Bed", "reeds", { n: 10, h: 2, heads: 0, c1: 0x6a8a3a, c2: 0xb8c880 }, "fw,sw|1-4|mu,sl|1.6-2.4|c|d|3|Tall feathery reeds that fill the shallows."),
  G("cattails", "Cattails", "reeds", { n: 8, h: 1.7, heads: 1, c1: 0x5a7a3a, c2: 0x9ab060, headC: 0x6a3a22 }, "fw,sw|1-4|mu,sl|1.4-2|c|k|3|Brown velvet seed-heads on straight green stalks."),
  G("papyrus", "Papyrus", "reeds", { n: 7, h: 3, w: 0.09, heads: 0, c1: 0x7aa04a, c2: 0xc8e090, radius: 0.35 }, "fw,sw,sv|3-4|mu,sl|2.4-3.6|u|k|3|Triangular stalks with umbrella tufts, towering over the bank."),
  G("red_grass", "Crimson Grass", "grassTuft", { n: 18, h: 0.7, c1: 0xa8302a, c2: 0xff7a5a, bend: 0.4 }, "an,vo,wl|2-4|so,as|0.5-0.9|u|d|3|An alien turf the colour of embers."),
];

export const FLOWERS = [
  F("daisy_white", "Meadow Daisy", "flower", { h: 0.35, petals: 12, petalLen: 0.1, petalW: 0.03, c1: 0xffffff, c2: 0xfff4e0, centre: 0xffcc20, open: 1.3 }, "gr,tf|1-3|so|0.25-0.45|c|d|3|White rays around a gold button."),
  F("poppy_red", "Field Poppy", "flower", { h: 0.55, petals: 4, petalLen: 0.16, petalW: 0.14, c1: 0xd82a2a, c2: 0xff6a4a, centre: 0x2a1a1a, cup: 0.5, open: 0.8 }, "gr,sv,wl|1-4|so|0.4-0.7|c|k|3|Four crumpled scarlet petals around a black heart."),
  F("buttercup", "Buttercup", "flower", { h: 0.3, petals: 5, petalLen: 0.08, petalW: 0.08, c1: 0xffd820, c2: 0xfff080, centre: 0xc89a10, cup: 0.6 }, "gr,tf,fw|1-3|so,mu|0.2-0.4|c|d|3|Glossy golden cups in damp grass."),
  F("violet", "Wild Violet", "flower", { h: 0.2, petals: 5, petalLen: 0.07, petalW: 0.06, c1: 0x6a3aa8, c2: 0xb08ae0, centre: 0xffe040, open: 0.9 }, "tf,ta|1-2|so|0.12-0.28|c|k|3|Small purple faces peeking from the leaf litter."),
  F("sunflower", "Sunflower", "flower", { h: 1.1, petals: 16, petalLen: 0.2, petalW: 0.06, c1: 0xffc820, c2: 0xffe060, centre: 0x4a2a10, open: 1.4, leaves: 4 }, "gr,sv|2-4|so|0.9-1.5|u|k|3|A huge golden face that follows the sun."),
  F("meadow_mix", "Meadow Mix", "flowerPatch", { n: 9, h: 0.4, c1: 0xe0507a, c2: 0xffe08a }, "gr,tf|1-3|so|0.3-0.6|c|d|3|A scatter of pink and cream wildflowers."),
  F("lavender", "Lavender", "flowerPatch", { n: 10, h: 0.5, c1: 0x8a5ad0, c2: 0xc8a0ff, headR: 0.04, radius: 0.35 }, "gr,sv,de|2-4|so,ro|0.4-0.7|u|d|3|Purple spikes humming with life."),
  F("clover_patch", "Clover Patch", "flowerPatch", { n: 12, h: 0.2, c1: 0xf0f0e8, c2: 0xf8c8d8, headR: 0.045, grass: 14, stem: 0x4a9a4a, radius: 0.3 }, "gr,tf|1-3|so|0.15-0.3|c|d|3|Round white heads over three-leafed carpets."),
  F("aster_wild", "Wild Aster", "flowerPatch", { n: 8, h: 0.55, c1: 0x6a8ad8, c2: 0xc0d0ff, headR: 0.055, radius: 0.35 }, "gr,tu,ta|0-2|so|0.4-0.7|c|k|3|Pale blue star-flowers late in the season."),
  F("tulip_bright", "Tulip", "flower", { h: 0.45, petals: 6, petalLen: 0.14, petalW: 0.09, c1: 0xe8403a, c2: 0xffa040, centre: 0x2a1a10, cup: 0.8, open: 0.4 }, "gr,tf|1-3|so|0.3-0.55|u|k|3|Tight cups in red and orange."),
  F("orchid_pink", "Orchid", "flower", { h: 0.6, petals: 5, petalLen: 0.18, petalW: 0.12, c1: 0xd8508a, c2: 0xffc0e0, centre: 0xffe880, open: 1.2, leaves: 3 }, "rf,an,sw|3-4|so,mu|0.4-0.7|r|s|3|An exquisite, speckled bloom hidden in the shade."),
  F("lupine_blue", "Lupine", "flowerPatch", { n: 7, h: 0.75, c1: 0x4a4ad8, c2: 0xa0a0ff, headR: 0.06, radius: 0.3 }, "al,tf,tu|0-2|so|0.6-0.95|u|k|3|Tall blue spires standing in colourful drifts."),
];

export const SUCCULENTS = [
  U("aloe", "Aloe", "succulent", { leaves: 18, len: 0.6, thick: 0.08, c1: 0x5a9a72, c2: 0xa0d0a0, tip: 0xc86a4a }, "de,sv,wl|3-4|so,sa,ro|0.4-0.8|c|t|3|Fleshy, toothed leaves in a spiky rosette."),
  U("agave_blue", "Blue Agave", "succulent", { leaves: 21, len: 0.9, thick: 0.1, c1: 0x5a88a0, c2: 0xb8d8e8, tip: 0x7a8a98, open: 0.9 }, "de,wl|3-4|so,sa|0.7-1.2|u|s|3|A sword-leaved rosette in powdery blue."),
  U("echeveria", "Rosette Succulent", "succulent", { leaves: 24, len: 0.22, thick: 0.05, c1: 0x8a98c0, c2: 0xe0b0d8, tip: 0xff8a9a, open: 1.6 }, "de,sv,al|2-4|ro,so|0.15-0.3|u|k|3|A pastel flower-shaped rosette."),
  U("saguaro", "Saguaro Cactus", "cactus", { kind: "column", h: 3.2, arms: 2 }, "de|3-4|sa,so|2.4-4.2|u|s|3|The great armed column of the desert."),
  U("barrel_cactus", "Barrel Cactus", "cactus", { kind: "barrel", h: 0.8, bloom: 1 }, "de,wl|3-4|sa,ro|0.5-1|c|t|3|A ribbed, spined globe crowned with pink flowers."),
  U("prickly_pear", "Prickly Pear", "cactus", { kind: "paddle", h: 1.6, pads: 5 }, "de,sv|3-4|sa,so|1-2|c|t|3|Flat paddles stacked into a thorny thicket."),
  U("organ_pipe", "Organ Pipe Cactus", "cactus", { kind: "column", h: 2.2, arms: 0, c1: 0x4a7a5a }, "de|3-4|sa,so|1.6-2.6|u|k|3|Straight green columns rising in tight bunches."),
  U("lithops", "Living Stones", "succulent", { leaves: 8, len: 0.12, thick: 0.07, c1: 0xa8a090, c2: 0xd0c8b0, tip: 0x8a7a6a, open: 2 }, "de,wl|3-4|ro,sa|0.08-0.16|r|k|3|Pebble-like plants that hide among real stones."),
];

export const CRYSTAL_PLANTS = [
  C("quartz_bloom", "Quartz Bloom", "crystalBloom", { n: 5, h: 0.9, c1: 0xe8f0f8, c2: 0xffffff }, "cr|0-3|cy,ro|0.5-1.1|c|k|3|Glassy white stems that chime in the wind."),
  C("amethyst_fern", "Amethyst Fern", "crystalBloom", { n: 9, h: 0.6, w: 0.06, sides: 5, c1: 0xa060d8, c2: 0xe0b8ff, radius: 0.3 }, "cr,an|1-3|cy,so|0.4-0.8|u|k|3|A crown of violet crystal fronds."),
  C("glass_reed", "Glass Reed", "crystalBloom", { n: 8, h: 1.5, w: 0.05, sides: 4, c1: 0xb8f0e8, c2: 0xffffff, shaft: 0.9 }, "cr,sw|1-3|cy,mu|1-1.9|u|k|3|Thin transparent spears that ring like bells."),
  C("ice_flower", "Ice Flower", "crystalBloom", { n: 6, h: 0.7, w: 0.08, sides: 6, c1: 0xcfeaff, c2: 0xffffff, radius: 0.28 }, "cr,tu|0-1|ic,sn,cy|0.5-0.9|u|k|3|A frozen bloom that never melts."),
  C("emerald_shoots", "Emerald Shoots", "crystalBloom", { n: 7, h: 0.8, c1: 0x3ad88a, c2: 0xc0ffe0, sides: 6 }, "cr,an|2-4|cy,so|0.5-1|r|k|3|Green crystal sprouts growing straight from bare rock."),
  C("ruby_thorn", "Ruby Thorn", "crystalBloom", { n: 6, h: 0.65, w: 0.07, sides: 4, c1: 0xd82a4a, c2: 0xffa0b0, shaft: 0.5 }, "cr,vo|2-4|cy,as|0.4-0.9|r|s|3|Blood-red thorns of faceted crystal."),
];

export const ALIEN_PLANTS = [
  A("bulb_glow", "Glow Bulb", "bulbPlant", { h: 1, c1: 0x8affc0, c2: 0xe0fff0 }, "an,fu|2-3|so,mu|0.8-1.4|c|k|3|A swollen bulb that glows softly green."),
  A("bulb_spotted", "Spotted Bulb", "bulbPlant", { h: 1.3, bulbR: 0.36, c1: 0xffb040, c2: 0xfff0b0, spots: 9, spotC: 0xc03a60, leaves: 5 }, "an,rf|3-4|so|1-1.7|u|t|3|An amber orb freckled with crimson."),
  A("spiral_pod", "Spiral Pod", "spiralPod", { h: 1.1, turns: 3 }, "an,fu|1-3|so|0.8-1.4|u|t|3|A coiled stalk ending in a plump orange pod."),
  A("spiral_pod_blue", "Blue Coil", "spiralPod", { h: 1.5, turns: 4, c1: 0x3a6ad8, c2: 0x80e0ff, podR: 0.16 }, "an,cr|0-2|so,cy|1.1-1.9|r|s|3|A tightly wound azure spring."),
  A("tendril_pink", "Pink Tendril", "tendril", { n: 9, len: 1.1 }, "an,fu|2-4|so,mu|0.8-1.4|c|k|3|Curling feelers with yellow bead-tips."),
  A("tendril_blue", "Blue Tendril", "tendril", { n: 13, len: 0.9, c1: 0x3a6ac8, c2: 0x8ad8ff, bead: 0xffffff }, "an,sw|1-3|so,mu|0.6-1.2|u|k|3|A flower-sized knot of writhing blue feelers."),
  A("star_flower", "Star Flower", "starFlower", { spikes: 12, len: 0.45 }, "an,rf|2-4|so|0.3-0.6|c|d|3|A burst of orange spikes around a violet eye."),
  A("star_urchin", "Urchin Plant", "starFlower", { spikes: 20, len: 0.35, c1: 0x3a6ad8, c2: 0x80d8ff, centre: 0xffe060 }, "an,cr|0-2|so,cy|0.3-0.6|u|k|3|A spherical hedgehog of blue spines."),
  A("lantern_stalk", "Lantern Stalk", "lantern", { stalks: 4, h: 1.2 }, "an,fu,cr|1-3|so,mu|1-1.6|c|k|3|Arching stems hung with soft green lamps."),
  A("lantern_gold", "Golden Lantern", "lantern", { stalks: 6, h: 1.6, c2: 0xffd860, bulbR: 0.2, c1: 0x6a4a2a }, "an,fu|2-4|so|1.2-2|r|s|3|Warm golden lamps that draw night insects in swarms."),
  A("vine_tangle", "Creeping Vine", "vineTangle", { vines: 8, r: 0.7 }, "an,rf,sw|2-4|so,mu|0.5-1|c|d|3|A snarl of low vines tipped with fat buds."),
];

export const FLORA = [...TREES, ...SMALL_TREES, ...BUSHES, ...GRASSES, ...FLOWERS, ...SUCCULENTS, ...CRYSTAL_PLANTS, ...ALIEN_PLANTS];
