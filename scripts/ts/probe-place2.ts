// probe-place2.ts — raw agent.place on the stuck cells
import { Bridge } from './mcbuddy.ts';
const b = new Bridge();
await b.connect(10_000);
await b.rawCall<any>('agent.give', { item: 'minecraft:diorite', count: 64, slot: 1 });
await b.rawCall<any>('agent.give', { item: 'minecraft:deepslate', count: 64, slot: 2 });
const cells: [string, number, number, number][] = [
  ['wall', 32, -59, -7], ['pillar', 14, -59, 5], ['pillar', 32, -58, -5],
];
for (const [lbl, x, y, z] of cells) {
  const r = await b.rawCall<any>('agent.place', { x, y, z });
  console.log(`${lbl} (${x},${y},${z}):`, JSON.stringify(r));
}
process.exit(0);
