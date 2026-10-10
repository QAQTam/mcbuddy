// build-flat.ts — house #2 on the superflat world, using the polished pipeline:
//   materialize pick-sources -> foundation -> walls (door/windows/pillars) -> 3-tier roof -> verify
//   node scripts/ts/build-flat.ts [x0=14] [z0=-14]
// Superflat: ground top block at y-60, so foundation layer sits at y-59.
import { Bridge, status, column, place, breakBlock, teleport, freecamOn, freecamOff, shot, sleep, type ColumnRow } from './mcbuddy.ts';

const FX = 19, FZ = 20, WALL_H = 3;
const GROUND = -60, Y0 = GROUND + 1; // foundation top level

// design predicates (relative to x0,z0)
const isPerimeter = (dx: number, dz: number) => dx === 0 || dz === 0 || dx === FX - 1 || dz === FZ - 1;
const isPillar = (dx: number, dz: number) =>
  ((dx === 0 || dx === FX - 1) && (dz === 0 || dz === FZ - 1 || dz === 9 || dz === 10)) ||
  ((dz === 0 || dz === FZ - 1) && (dx === 4 || dx === FX - 5));
const isDoor = (dx: number, dz: number) => dz === 0 && (dx === 9 || dx === 10);
const isWindow = (dx: number, dz: number, h: number) =>
  h === 2 && !isDoor(dx, dz) && !isPillar(dx, dz) &&
  ((dz === 0 && [3, 6, 12, 15].includes(dx)) || (dz === FZ - 1 && [3, 6, 12, 15].includes(dx)) ||
    (dx === 0 && [5, 10, 14].includes(dz)) || (dx === FX - 1 && [5, 10, 14].includes(dz)));

const b = new Bridge();

// creative "give": set a stack straight into the agent hotbar and select it
async function give(block: string, slot: number): Promise<void> {
  const r = await b.rawCall<{ given: boolean; reason?: string }>('agent.give', { item: `minecraft:${block}`, count: 64, slot });
  if (!r.given) throw new Error(`give ${block} failed: ${r.reason}`);
}

interface Cell { x: number; y: number; z: number }

async function fillCells(cells: Cell[], label: string): Promise<void> {
  for (let pass = 1; pass <= 6; pass++) {
    let placed = 0, occupied = 0, failed = 0;
    for (const c of cells) {
      const rows: ColumnRow[] | null = await column(b, c.x, c.z, c.y, c.y).catch(() => null);
      const row = rows?.find(r => r.y === c.y);
      if (row && !['air', 'short_grass', 'tall_grass', 'leaf_litter'].includes(row.block)) { occupied++; continue; }
      const r = await place(b, c.x, c.y, c.z, Y0);
      if (r.placed) placed++; else failed++;
    }
    console.log(`  ${label} pass ${pass}: placed=${placed} occupied=${occupied} failed=${failed}`);
    if (failed === 0) break;
    // keep only failed cells for the next pass
    const failedSet = new Set(cells.filter(c => {
      // cheap recheck happens next pass via occupied(); drop nothing here
      return true;
    }));
    void failedSet;
    if (placed === 0) { console.log(`  ${label}: no progress, ${failed} cells remain (likely no-support edges)`); break; }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const x0 = Number(argv[0] ?? 14), z0 = Number(argv[1] ?? -14);

  await b.connect();
  const st = await status(b);
  if (!st.agent?.spawned) throw new Error('agent not spawned — /buddy spawn first');
  console.log(`agent at (${st.agent.pos.x}, ${st.agent.pos.y}, ${st.agent.pos.z}); site x[${x0}..${x0 + FX - 1}] z[${z0}..${z0 + FZ - 1}] top y=${Y0}`);

  // ---- build groups: each phase = one material, multi-pass until done ----
  const groups: { label: string; mat: string; slot: number; cells: Cell[] }[] = [
    { label: 'foundation', mat: 'stone', slot: 0, cells: [] },
    { label: 'walls', mat: 'diorite', slot: 1, cells: [] },
    { label: 'pillars', mat: 'deepslate', slot: 2, cells: [] },
    { label: 'roof1', mat: 'stone', slot: 0, cells: [] },
    { label: 'roof2', mat: 'stone', slot: 0, cells: [] },
    { label: 'ridge', mat: 'deepslate', slot: 2, cells: [] },
  ];
  for (let dx = 0; dx < FX; dx++) for (let dz = 0; dz < FZ; dz++) {
    groups[0].cells.push({ x: x0 + dx, y: Y0, z: z0 + dz });                       // foundation 19x20
  }
  for (let dx = 0; dx < FX; dx++) for (let dz = 0; dz < FZ; dz++) {
    if (!isPerimeter(dx, dz) || isPillar(dx, dz)) continue;
    for (let h = 1; h <= WALL_H; h++) {
      if (isDoor(dx, dz) && h <= 2) continue;   // door gap
      if (isWindow(dx, dz, h)) continue;        // window gaps
      groups[1].cells.push({ x: x0 + dx, y: Y0 + h, z: z0 + dz });
    }
  }
  for (let dx = 0; dx < FX; dx++) for (let dz = 0; dz < FZ; dz++) {
    if (!isPillar(dx, dz)) continue;
    for (let h = 1; h <= WALL_H + 1; h++) groups[2].cells.push({ x: x0 + dx, y: Y0 + h, z: z0 + dz });
  }
  for (let dx = -1; dx <= FX; dx++) for (let dz = -1; dz <= FZ; dz++) groups[3].cells.push({ x: x0 + dx, y: Y0 + 4, z: z0 + dz });  // tier1 21x22
  for (let dx = 1; dx <= FX - 2; dx++) for (let dz = 1; dz <= FZ - 2; dz++) groups[4].cells.push({ x: x0 + dx, y: Y0 + 5, z: z0 + dz }); // tier2 17x18
  for (let dx = 7; dx <= 11; dx++) for (let dz = 1; dz <= FZ - 2; dz++) groups[5].cells.push({ x: x0 + dx, y: Y0 + 6, z: z0 + dz });  // ridge 5x18

  const t0 = Date.now();
  for (const g of groups) {
    await give(g.mat, g.slot);
    for (let pass = 1; pass <= 6; pass++) {
      let placed = 0, occupied = 0, failed = 0;
      for (const c of g.cells) {
        const rows: ColumnRow[] | null = await column(b, c.x, c.z, c.y, c.y).catch(() => null);
        const row = rows?.find(r => r.y === c.y);
        if (row && !['air', 'short_grass', 'tall_grass', 'leaf_litter'].includes(row.block)) { occupied++; continue; }
        const r = await place(b, c.x, c.y, c.z, Y0);
        if (r.placed) placed++; else failed++;
      }
      console.log(`  ${g.label} pass ${pass}: placed=${placed} occupied=${occupied} failed=${failed} (${Math.round((Date.now() - t0) / 1000)}s)`);
      if (failed === 0) break;
      if (placed === 0) { console.log(`  ${g.label}: no progress, ${failed} cells stuck`); break; }
    }
  }

  // ---- visual QA ----
  const look = { x: x0 + FX / 2, y: Y0 + 1, z: z0 + FZ / 2 };
  const a = Math.PI / 4;
  await freecamOn(b, { x: look.x + 30, y: Y0 + 14, z: look.z + 30 }, look);
  await sleep(500);
  await shot(b, '.qaqh/tmp/house2-far.png', 2);
  await freecamOn(b, { x: look.x, y: Y0 + 3, z: look.z + 18 }, look);
  await sleep(500);
  await shot(b, '.qaqh/tmp/house2-close.png', 2);
  await freecamOff(b);
  console.log('QA shots saved: .qaqh/tmp/house2-far.png / house2-close.png');
}

main().then(() => { b.close(); process.exit(0); }).catch(e => { console.error('FAIL:', e.message); b.close(); process.exit(1); });
