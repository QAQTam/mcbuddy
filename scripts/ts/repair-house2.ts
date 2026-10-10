// repair-house2.ts — one final pass over walls+pillars cells that are still air
import { Bridge, column } from './mcbuddy.ts';
import { house2, withSite } from './buildspec.ts';
import { specToGroups, fillCells } from './engine.ts';

const b = new Bridge();
await b.connect(10_000);
const st = await b.rawCall<any>('status');
console.log('agent:', st.agent.pos, st.agent.gamemode);

const x0 = 14, z0 = -14, groundTopY = -61;
const spec = withSite(house2, x0, z0, groundTopY);
const groups = specToGroups(spec).filter(g => g.label === 'walls' || g.label === 'pillars');

for (const g of groups) {
  // keep only cells that are still airish now (neighbours from later groups exist)
  const open: typeof g.cells = [];
  for (const c of g.cells) {
    const rows = await column(b, c.x, c.z, c.y, c.y).catch(() => null);
    const row = rows?.find(r => r.y === c.y);
    if (!row || ['air', 'short_grass', 'tall_grass', 'leaf_litter'].includes(row.block)) open.push(c);
  }
  console.log(`${g.label}: ${open.length} open cells`);
  if (open.length) {
    const s = await fillCells(b, open, `${g.label}-repair`, groundTopY + 1);
    console.log(JSON.stringify(s));
  }
}
process.exit(0);
