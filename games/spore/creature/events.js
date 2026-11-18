/**
 * Weather and events on the creature island. Each region has its own climate: the swamp is wet, the
 * badlands bake, the volcano erupts. Events change play, not just the look: rain and storms hide you
 * (others notice you from less far), heat makes you hungry faster, an eruption throws lava bombs, and a
 * night-time meteor shower drops a meteorite you can dig a rare part out of. Pure scheduling here; the
 * stage draws and applies them.
 */
export const EVENTS = {
  rain: { name: "Rain", icon: "🌧", dur: [70, 120], weight: { coast: 3, forest: 4, swamp: 6, badlands: 0.4, volcanic: 1 }, notice: 0.8, hunger: 1, fog: 0.6, tip: "Rain: others can't see you from as far. A good time to sneak." },
  storm: { name: "Thunderstorm", icon: "⛈", dur: [45, 80], weight: { coast: 2, forest: 2, swamp: 3, badlands: 1, volcanic: 1 }, notice: 0.62, hunger: 1, fog: 0.42, lightning: true, tip: "A thunderstorm: hard to see, hard to be seen." },
  heat: { name: "Heatwave", icon: "🔥", dur: [60, 100], weight: { coast: 0.6, forest: 0.4, swamp: 0.3, badlands: 5, volcanic: 3 }, notice: 1.1, hunger: 1.8, fog: 1, dayOnly: true, tip: "A heatwave: you'll get hungry much faster. Stay near food." },
  meteors: { name: "Meteor shower", icon: "☄", dur: [32, 45], weight: { coast: 1, forest: 1, swamp: 1, badlands: 1.5, volcanic: 1 }, notice: 1, hunger: 1, fog: 1, nightOnly: true, meteorite: true, tip: "A meteor shower! Watch where one lands: meteorites hold rare parts." },
  eruption: { name: "Eruption", icon: "🌋", dur: [30, 50], weight: { volcanic: 4 }, notice: 0.85, hunger: 1.2, fog: 0.55, bombs: true, tip: "The volcano is erupting! Watch for glowing rings: lava bombs land there." },
};
export const EVENT_IDS = Object.keys(EVENTS);

/** Seconds until the next event is considered. */
export const nextEventIn = (rand = Math.random) => 100 + rand() * 110;

/** An event for this region and time of day, or null for a calm spell (about one time in three). */
export function pickEvent(region, isNight, rand = Math.random) {
  if (rand() < 0.33) return null;
  const options = EVENT_IDS.filter((id) => {
    const e = EVENTS[id];
    return (e.weight[region] || 0) > 0 && !(e.nightOnly && !isNight) && !(e.dayOnly && isNight);
  });
  const total = options.reduce((a, id) => a + EVENTS[id].weight[region], 0);
  let roll = rand() * total;
  for (const id of options) {
    roll -= EVENTS[id].weight[region];
    if (roll <= 0) return id;
  }
  return options.at(-1) || null;
}
export const eventLength = (id, rand = Math.random) => EVENTS[id].dur[0] + rand() * (EVENTS[id].dur[1] - EVENTS[id].dur[0]);

/** Lava bomb damage: a direct hit hurts, the edge of the blast stings. */
export const bombDamage = (dist) => (dist < 1.4 ? 26 : dist < 2.8 ? 12 : 0);
