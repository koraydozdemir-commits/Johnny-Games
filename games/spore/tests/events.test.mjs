import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENTS, bombDamage, eventLength, pickEvent } from "../creature/events.js";

const counts = (region, night) => {
  const c = {};
  let s = 1;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 4000; i++) {
    const e = pickEvent(region, night, rand);
    c[e] = (c[e] || 0) + 1;
  }
  return c;
};

test("each region has its own climate", () => {
  const swamp = counts("swamp", false),
    bad = counts("badlands", false),
    vol = counts("volcanic", false);
  assert.ok(swamp.rain > swamp.heat * 5, "the swamp is wet");
  assert.ok(bad.heat > bad.rain * 5, "the badlands bake");
  assert.ok(vol.eruption > 0 && !swamp.eruption && !bad.eruption, "only the volcano erupts");
  assert.ok(swamp.null > 900 && swamp.null < 1800, "calm spells too");
});

test("night and day events keep to their time", () => {
  const night = counts("coast", true),
    day = counts("coast", false);
  assert.ok(night.meteors > 0 && !day.meteors, "meteor showers only at night");
  assert.ok(day.heat > 0 && !night.heat, "heatwaves only by day");
  for (const id of Object.keys(EVENTS)) {
    const l = eventLength(id, () => 0.5);
    assert.ok(l >= EVENTS[id].dur[0] && l <= EVENTS[id].dur[1]);
  }
  assert.ok(bombDamage(0.5) > bombDamage(2) && bombDamage(5) === 0);
  assert.ok(EVENTS.storm.notice < EVENTS.rain.notice && EVENTS.rain.notice < 1, "bad weather hides you");
  assert.ok(EVENTS.heat.hunger > 1.5);
});
