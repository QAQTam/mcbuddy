// debug-stuck.ts — print stuck cells and their 6 neighbours
import { Bridge, column } from './mcbuddy.ts';
import { house2, withSite } from './buildspec.ts';
import { specToGroups } from './engine.ts';

const AIR = new Set(['air', 'short_grass', 'tall_grass', 'leaf_litter']);
const b = new Bridge();
await b.connect(10_000);

const spec = withSite(house2, 14, -14, -61);
const groups = specToGroups(spec).filter(g => g.label === 'walls' || g.label === 'pillars');
const blockAt = async (x: number, y: number, z: number) => {
  const rows = await column(b, x, z, y, y).catch(() => null);
  return rows?.find(r => r.y === y)?.block ?? 'unloaded';
};
for (const g of groups) {
  for (const c of g.cells) {
    const here = await blockAt(c.x, c.y, c.z);
    if (!AIR.has(here)) continue;
    const nbs = [
      ['+x', await blockAt(c.x + 1, c.y, c.z)], ['-x', await blockAt(c.x - 1, c.y, c.z)],
      ['+z', await blockAt(c.x, c.y, c.z + 1)], ['-z', await blockAt(c.x, c.y, c.z - 1)],
      ['+y', await blockAt(c.x, c.y + 1, c.z)], ['-y', await blockAt(c.x, c.y - 1, c.z)],
    ];
    const solid = nbs.filter(([, bl]) => !AIR.has(bl as string)).map(([d]) => d);
    console.log(`${g.label} (${c.x},${c.y},${c.z}) here=${here} solidNbs=[${solid.join(',')}]`);
    console.log('   ', JSON.stringify(nbs));
  }
}
process.exit(0);
