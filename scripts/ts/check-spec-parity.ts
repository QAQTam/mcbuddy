// check-spec-parity.ts — proves the BuildSpec refactor is behavior-preserving:
// regenerates cells with the OLD hardcoded predicates (copied verbatim from the
// pre-refactor build-flat.ts) and compares, group by group, against specToGroups.
//   node scripts/ts/check-spec-parity.ts
// No bridge connection needed — pure geometry check.
import { house2 } from './buildspec.ts';
import { specToGroups, type Cell } from './engine.ts';

const FX = 19, FZ = 20, WALL_H = 3;
const GROUND = -60, Y0 = GROUND + 1;
const x0 = house2.site.x0, z0 = house2.site.z0;

// ---- OLD generation logic (verbatim from pre-refactor build-flat.ts) ----
const isPerimeter = (dx: number, dz: number) => dx === 0 || dz === 0 || dx === FX - 1 || dz === FZ - 1;
const isPillar = (dx: number, dz: number) =>
  ((dx === 0 || dx === FX - 1) && (dz === 0 || dz === FZ - 1 || dz === 9 || dz === 10)) ||
  ((dz === 0 || dz === FZ - 1) && (dx === 4 || dx === FX - 5));
const isDoor = (dx: number, dz: number) => dz === 0 && (dx === 9 || dx === 10);
const isWindow = (dx: number, dz: number, h: number) =>
  h === 2 && !isDoor(dx, dz) && !isPillar(dx, dz) &&
  ((dz === 0 && [3, 6, 12, 15].includes(dx)) || (dz === FZ - 1 && [3, 6, 12, 15].includes(dx)) ||
    (dx === 0 && [5, 10, 14].includes(dz)) || (dx === FX - 1 && [5, 10, 14].includes(dz)));

const c = (dx: number, y: number, dz: number): Cell => ({ x: x0 + dx, y, z: z0 + dz });

const old: Record<string, { mat: string; cells: Cell[] }> = {
  foundation: { mat: 'stone', cells: [] },
  walls: { mat: 'diorite', cells: [] },
  pillars: { mat: 'deepslate', cells: [] },
  roof1: { mat: 'stone', cells: [] },
  roof2: { mat: 'stone', cells: [] },
  ridge: { mat: 'deepslate', cells: [] },
};
for (let dx = 0; dx < FX; dx++) for (let dz = 0; dz < FZ; dz++) old.foundation.cells.push(c(dx, Y0, dz));
for (let dx = 0; dx < FX; dx++) for (let dz = 0; dz < FZ; dz++) {
  if (!isPerimeter(dx, dz) || isPillar(dx, dz)) continue;
  for (let h = 1; h <= WALL_H; h++) {
    if (isDoor(dx, dz) && h <= 2) continue;
    if (isWindow(dx, dz, h)) continue;
    old.walls.cells.push(c(dx, Y0 + h, dz));
  }
}
for (let dx = 0; dx < FX; dx++) for (let dz = 0; dz < FZ; dz++) {
  if (!isPillar(dx, dz)) continue;
  for (let h = 1; h <= WALL_H + 1; h++) old.pillars.cells.push(c(dx, Y0 + h, dz));
}
for (let dx = -1; dx <= FX; dx++) for (let dz = -1; dz <= FZ; dz++) old.roof1.cells.push(c(dx, Y0 + 4, dz));
for (let dx = 1; dx <= FX - 2; dx++) for (let dz = 1; dz <= FZ - 2; dz++) old.roof2.cells.push(c(dx, Y0 + 5, dz));
for (let dx = 7; dx <= 11; dx++) for (let dz = 1; dz <= FZ - 2; dz++) old.ridge.cells.push(c(dx, Y0 + 6, dz));

// ---- compare ----
const ck = (x: number, y: number, z: number) => `${x},${y},${z}`;
const newGroups = specToGroups(house2);
let ok = true;

const oldLabels = Object.keys(old);
const newLabels = newGroups.map(g => g.label);
if (newLabels.join() !== oldLabels.join()) {
  ok = false;
  console.error(`group order mismatch:\n  old: ${oldLabels.join()}\n  new: ${newLabels.join()}`);
}

for (const g of newGroups) {
  const o = old[g.label];
  if (!o) { ok = false; console.error(`unexpected group ${g.label}`); continue; }
  const os = new Set(o.cells.map(k => ck(k.x, k.y, k.z)));
  const ns = new Set(g.cells.map(k => ck(k.x, k.y, k.z)));
  const onlyOld = [...os].filter(k => !ns.has(k));
  const onlyNew = [...ns].filter(k => !os.has(k));
  const dup = g.cells.length - ns.size;
  if (onlyOld.length || onlyNew.length || dup || o.mat !== g.mat) {
    ok = false;
    console.error(`MISMATCH ${g.label}: old=${o.cells.length} new=${g.cells.length} dup=${dup} mat ${o.mat} vs ${g.mat}`);
    for (const k of onlyOld.slice(0, 5)) console.error(`  only-old ${k}`);
    for (const k of onlyNew.slice(0, 5)) console.error(`  only-new ${k}`);
  } else {
    console.log(`OK ${g.label}: ${g.cells.length} cells, mat=${g.mat}`);
  }
}

// material/slot wiring
const wantSlots: Record<string, number> = { stone: 0, diorite: 1, deepslate: 2 };
for (const g of newGroups) {
  if (wantSlots[g.mat] !== g.slot) { ok = false; console.error(`slot mismatch ${g.label}: ${g.mat} -> ${g.slot}`); }
}

console.log(ok ? '\nPARITY: PASS' : '\nPARITY: FAIL');
process.exit(ok ? 0 : 1);
