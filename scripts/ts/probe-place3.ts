// probe-place3.ts — stand next to a stuck cell and place, raw responses
import { Bridge } from './mcbuddy.ts';
const b = new Bridge();
await b.connect(10_000);
await b.rawCall<any>('agent.give', { item: 'minecraft:deepslate', count: 64, slot: 2 });

const cells: [number, number, number][] = [[14, -59, 5], [32, -59, 5], [32, -59, -5]];
for (const [x, y, z] of cells) {
  // stand just outside the pillar on the +z side (z+1.5), feet on ground
  const tp = await b.rawCall<any>('agent.teleport', { x: x + 0.5, y: y - 1, z: z + 2.5 });
  console.log(`tp -> (${x + 0.5},${y - 1},${z + 2.5}):`, JSON.stringify(tp));
  for (let i = 0; i < 3; i++) {
    const r = await b.rawCall<any>('agent.place', { x, y, z });
    console.log(`  place (${x},${y},${z}):`, JSON.stringify(r));
    if (r.placed) break;
  }
}
const st = await b.rawCall<any>('status');
console.log('agent now:', JSON.stringify(st.agent.pos), 'held:', st.agent.hotbar[st.agent.selected_slot]);
process.exit(0);
