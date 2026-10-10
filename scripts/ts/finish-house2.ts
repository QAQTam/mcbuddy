// finish-house2.ts — fill the last stuck cells (teleport adjacent first), fix one contaminated wall cell
import { Bridge, column } from './mcbuddy.ts';

const AIR = new Set(['air', 'short_grass', 'tall_grass', 'leaf_litter']);
const b = new Bridge();
await b.connect(10_000);

async function blockAt(x: number, y: number, z: number) {
  const rows = await column(b, x, z, y, y).catch(() => null);
  return rows?.find(r => r.y === y)?.block ?? 'unloaded';
}
async function fill(x: number, y: number, z: number, item: string, slot: number) {
  await b.rawCall<any>('agent.give', { item: `minecraft:${item}`, count: 64, slot });
  const spots: [number, number][] = [[0.5, 2.5], [0.5, -2.5], [2.5, 0.5], [-2.5, 0.5], [0.5, 3.5]];
  for (const [dx, dz] of spots) {
    await b.rawCall<any>('agent.teleport', { x: x + dx, y: y - 1, z: z + dz }).catch(() => { });
    for (let i = 0; i < 2; i++) {
      const r = await b.rawCall<any>('agent.place', { x, y, z });
      if (r.placed) { console.log(`placed (${x},${y},${z}) ${item}`); return true; }
    }
    if (!AIR.has(await blockAt(x, y, z))) { console.log(`already solid (${x},${y},${z})`); return true; }
  }
  console.log(`STILL STUCK (${x},${y},${z})`);
  return false;
}

// 1) contaminated wall cell: my probe left deepslate where diorite belongs
if (!(await blockAt(32, -59, -7)).includes('diorite')) {
  await b.rawCall<any>('agent.break', { x: 32, y: -59, z: -7 });
  await fill(32, -59, -7, 'diorite', 1);
}
// 2) remaining walls (diorite)
await fill(32, -59, 0, 'diorite', 1);
await fill(32, -58, -7, 'diorite', 1);
// 3) remaining pillar tops (deepslate)
await fill(14, -58, 5, 'deepslate', 2);
await fill(32, -58, 5, 'deepslate', 2);
await fill(32, -58, -5, 'deepslate', 2);
process.exit(0);
