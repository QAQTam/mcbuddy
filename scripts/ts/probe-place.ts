// probe-place.ts — print raw bridge responses for status / give / column / place
import { Bridge } from './mcbuddy.ts';

const b = new Bridge();
await b.connect(10_000);
const st = await b.rawCall<any>('status');
console.log('status:', JSON.stringify(st));

// pick a spot just in front of the agent, on the ground
const x = 14, z = -12, y = -58;
const col = await b.rawCall<any>('world.column', { x, z, y0: y - 2, y1: y });
console.log('column:', JSON.stringify(col));

const give = await b.rawCall<any>('agent.give', { item: 'minecraft:stone', count: 64, slot: 0 });
console.log('give:', JSON.stringify(give));

for (let i = 0; i < 3; i++) {
  const r = await b.rawCall<any>('agent.place', { x, y, z });
  console.log(`place#${i}:`, JSON.stringify(r));
  await new Promise(s => setTimeout(s, 200));
}
process.exit(0);
