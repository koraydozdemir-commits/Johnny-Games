import test from 'node:test';
import assert from 'node:assert/strict';
import { createCellRecord, validateCellRecord, mirrorCellRecord, mutateCellRecord, starterCellRecord, makeRng, writeHandoff, readHandoff, readCellRecord, storeCellRecord, cellFromJson, cellToJson, shiftHue, HANDOFF_STORAGE_KEY } from '../cell-format.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('starter cell is valid and round-trips through JSON', () => {
  const rec = starterCellRecord();
  const res = cellFromJson(cellToJson(rec));
  assert.equal(res.ok, true);
  assert.deepEqual(res.record, rec);
  assert.equal(rec.diet, 'plant');
});

test('validate rejects garbage and clamps wild numbers', () => {
  assert.equal(validateCellRecord(null).ok, false);
  assert.equal(validateCellRecord({ format: 'other', version: 1 }).ok, false);
  const rec = starterCellRecord();
  rec.body.nodes[0].x = 999; rec.body.nodes[1].r = -4; rec.parts[0].scale = 50; rec.parts.push({ id: 'nope', x: 0, y: 0 });
  const res = validateCellRecord(rec);
  assert.equal(res.ok, true);
  assert.equal(res.record.body.nodes[0].x, 4.2);
  assert.equal(res.record.body.nodes[1].r, 0.12);
  assert.equal(res.record.parts[0].scale, 2.2);
  assert.equal(res.record.parts.length, 3, 'unknown part dropped');
});

test('validate enforces the complexity budget', () => {
  const rec = starterCellRecord();
  for (let i = 0; i < 12; i++) rec.parts.push({ id: 'proboscis', x: 0, y: 0.5, rotation: 0, scale: 1 });
  const total = validateCellRecord(rec).record.parts.reduce((n, p) => n + (p.id === 'proboscis' ? 18 : p.id === 'filter' ? 8 : p.id === 'cilia' ? 10 : 8), 0);
  assert.ok(total <= 100);
});

test('mirror flips y and rotation and is its own inverse', () => {
  const rec = createCellRecord({ nodes: [{ x: -1, y: 0.2, r: 0.3 }, { x: 1, y: -0.3, r: 0.3 }], parts: [{ id: 'jaw', x: 1, y: 0.4, rotation: 0.5, scale: 1 }] });
  const m = mirrorCellRecord(rec);
  assert.equal(m.body.nodes[0].y, -0.2);
  assert.equal(m.parts[0].y, -0.4);
  assert.equal(m.parts[0].rotation, -0.5);
  assert.deepEqual(mirrorCellRecord(m), rec);
});

test('mutation keeps parts and diet, changes the body slightly, and is seed-deterministic', () => {
  const rec = createCellRecord({ nodes: starterCellRecord().body.nodes, parts: [{ id: 'jaw', x: 1.1, y: 0, rotation: 0 }, { id: 'spike', x: 0, y: 0.7, rotation: 1.5 }] });
  const a = mutateCellRecord(rec, makeRng(7)), b = mutateCellRecord(rec, makeRng(7)), c = mutateCellRecord(rec, makeRng(8));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual(a.parts.map((p) => p.id), ['jaw', 'spike']);
  assert.equal(a.diet, 'meat');
  a.body.nodes.forEach((n, i) => assert.ok(Math.abs(n.r / rec.body.nodes[i].r - 1) < 0.15));
  assert.notEqual(a.colors.base, rec.colors.base);
});

test('hue shift keeps a grey grey and wraps', () => {
  assert.equal(shiftHue(0x808080, 0.3), 0x808080);
  assert.equal(shiftHue(0xff0000, 1), 0xff0000);
});

test('hand-off survives storage and is rejected if tampered with', () => {
  const store = memory();
  const rec = starterCellRecord();
  const payload = writeHandoff(store, rec, { plants: 12, meat: 3, unlocked: ['jaw', 'bogus'], dna: 40 });
  assert.equal(payload.progress.unlocked.length, 1);
  const back = readHandoff(store);
  assert.deepEqual(back.cell, rec);
  assert.equal(back.progress.plants, 12);
  store.setItem(HANDOFF_STORAGE_KEY, '{"from":"somewhere-else"}');
  assert.equal(readHandoff(store), null);
  store.setItem(HANDOFF_STORAGE_KEY, 'not json');
  assert.equal(readHandoff(store), null);
});

test('stored cell record reads back', () => {
  const store = memory();
  const rec = starterCellRecord();
  assert.equal(readCellRecord(store), null);
  storeCellRecord(store, rec);
  assert.deepEqual(readCellRecord(store), rec);
});
