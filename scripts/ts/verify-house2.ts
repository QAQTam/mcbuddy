// verify-house2.ts — compare spec material vs actual block for every cell in every group
import { Bridge, column } from './mcbuddy.ts';
import { house2, withSite } from './buildspec.ts';
import { specToGroups } from './engine.ts';

const AIR = new Set(['air', 'short_grass', 'tall_grass', 'leaf_litter']);
const b = new Bridge();
await b.connect(10_000);

const spec = withSite(house2, 14, -14, -61);
const groups = specToGroups(spec);
const mismatches: string[] = [];
let airCells = 0, okCells = 0;
for (const g of groups) {
  for (const c of g.cells) {
    const rows = await column(b, c.x, c.z, c.y, c.y).catch(() => null);
    const blk = rows?.find(r => r.y === c.y)?.block;
    if (!blk) { mismatches.push(`${g.label} (${c.x},${c.y},${c.z}) UNLOADED`); continue; }
    if (AIR.has(blk)) { airCells++; mismatches.push(`${g.label} (${c.x},${c.y},${c.z}) AIR`); continue; }
    // block id may have a variant prefix (e.g. minecraft:polished_...) — accept substring match
    if (!blk.includes(g.mat)) mismatches.push(`${g.label} (${c.x},${c.y},${c.z}) got=${blk} want~${g.mat}`);
    else okCells++;
  }
}
console.log(`ok=${okCells} air=${airCells} other-mismatch=${mismatches.length - airCells}`);
for (const m of mismatches) console.log(' ', m);
process.exit(0);
