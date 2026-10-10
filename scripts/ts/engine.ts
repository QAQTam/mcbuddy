// engine.ts — buildEngine: consumes a BuildSpec and drives the bridge.
// Knows nothing about any particular house: specToGroups is the only place
// that turns design data into placement cells.
import { Bridge, column, place, type ColumnRow } from './mcbuddy.ts';
import type { BuildSpec } from './buildspec.ts';

export interface Cell { x: number; y: number; z: number }
export interface Group { label: string; mat: string; slot: number; cells: Cell[] }
export interface BuildStats { label: string; placed: number; occupied: number; failed: number; passes: number }

const AIRISH = new Set(['air', 'short_grass', 'tall_grass', 'leaf_litter']);

const key = (dx: number, dz: number) => `${dx},${dz}`;

export function specToGroups(spec: BuildSpec): Group[] {
  const { x0, z0, groundTopY } = spec.site;
  const Y0 = groundTopY + 1;
  const { fx, fz } = spec.footprint;

  const pillarSet = new Set(spec.pillars.map(p => key(p.dx, p.dz)));
  const doorHeight = new Map<string, number>();
  for (const d of spec.doors) doorHeight.set(key(d.dx, d.dz), d.height);
  const windowAt = new Set(spec.windows.map(w => `${w.dx},${w.dz},${w.y}`));

  const cell = (dx: number, y: number, dz: number): Cell => ({ x: x0 + dx, y, z: z0 + dz });

  // foundation: full footprint at Y0
  const foundation: Cell[] = [];
  for (let dx = 0; dx < fx; dx++) for (let dz = 0; dz < fz; dz++) foundation.push(cell(dx, Y0, dz));

  // walls: perimeter, skipping pillars and openings
  const walls: Cell[] = [];
  for (let dx = 0; dx < fx; dx++) for (let dz = 0; dz < fz; dz++) {
    const perimeter = dx === 0 || dz === 0 || dx === fx - 1 || dz === fz - 1;
    if (!perimeter || pillarSet.has(key(dx, dz))) continue;
    for (let h = 1; h <= spec.wallHeight; h++) {
      if ((doorHeight.get(key(dx, dz)) ?? 0) >= h) continue; // door gap
      if (windowAt.has(`${dx},${dz},${h}`)) continue;        // window gap
      walls.push(cell(dx, Y0 + h, dz));
    }
  }

  // pillars: full height + 1
  const pillars: Cell[] = [];
  for (const p of spec.pillars)
    for (let h = 1; h <= spec.wallHeight + 1; h++) pillars.push(cell(p.dx, Y0 + h, p.dz));

  // roof tiers: explicit rects, bottom-up
  let roofIdx = 0;
  const tiers = spec.roofTiers.map(t => {
    const cells: Cell[] = [];
    for (let dx = t.rect.x0; dx <= t.rect.x1; dx++)
      for (let dz = t.rect.z0; dz <= t.rect.z1; dz++) cells.push(cell(dx, Y0 + t.y, dz));
    const label = t.mat === 'ridge' ? 'ridge' : `roof${++roofIdx}`;
    return { label, mat: spec.materials[t.mat], slot: spec.slots[spec.materials[t.mat]], cells };
  });

  return [
    { label: 'foundation', mat: spec.materials.foundation, slot: spec.slots[spec.materials.foundation], cells: foundation },
    { label: 'walls', mat: spec.materials.wall, slot: spec.slots[spec.materials.wall], cells: walls },
    { label: 'pillars', mat: spec.materials.pillar, slot: spec.slots[spec.materials.pillar], cells: pillars },
    ...tiers,
  ];
}

/** creative give: set a stack straight into the agent hotbar and select it */
export async function giveStack(b: Bridge, mat: string, slot: number): Promise<void> {
  const r = await b.rawCall<{ given: boolean; reason?: string }>('agent.give', { item: `minecraft:${mat}`, count: 64, slot });
  if (!r.given) throw new Error(`give ${mat} failed: ${r.reason}`);
}

/** multi-pass fill of one group; stops on clean completion or no progress */
export async function fillCells(b: Bridge, cells: Cell[], label: string, standY: number, maxPasses = 6): Promise<BuildStats> {
  let placed = 0, occupied = 0, failed = 0, passes = 0;
  for (let pass = 1; pass <= maxPasses; pass++) {
    passes = pass;
    placed = 0; occupied = 0; failed = 0;
    for (const c of cells) {
      const rows: ColumnRow[] | null = await column(b, c.x, c.z, c.y, c.y).catch(() => null);
      const row = rows?.find(r => r.y === c.y);
      if (row && !AIRISH.has(row.block)) { occupied++; continue; }
      const r = await place(b, c.x, c.y, c.z, standY);
      if (r.placed) placed++; else failed++;
    }
    console.log(`  ${label} pass ${pass}: placed=${placed} occupied=${occupied} failed=${failed} (${Math.round((Date.now() - t0()) / 1000)}s)`);
    if (failed === 0) break;
    if (placed === 0) { console.log(`  ${label}: no progress, ${failed} cells stuck (likely no-support edges)`); break; }
  }
  return { label, placed, occupied, failed, passes };
}

// wall-clock anchor for pass timing (module-level so fillCells stays signature-clean)
const _t0 = Date.now();
const t0 = () => _t0;

/** buildEngine: give materials and place every group in spec order */
export async function buildEngine(b: Bridge, spec: BuildSpec): Promise<BuildStats[]> {
  const standY = spec.site.groundTopY + 1;
  const stats: BuildStats[] = [];
  for (const g of specToGroups(spec)) {
    await giveStack(b, g.mat, g.slot);
    stats.push(await fillCells(b, g.cells, g.label, standY));
  }
  return stats;
}
