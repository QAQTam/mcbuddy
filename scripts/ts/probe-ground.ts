// probe-ground.ts — scan a few columns across the site to find real ground level
import { Bridge } from './mcbuddy.ts';

const b = new Bridge();
await b.connect(10_000);

const spots: [number, number][] = [[14, -12], [23, -4], [30, 3], [18, 2], [23, -14]];
for (const [x, z] of spots) {
  const col = await b.rawCall<any>('world.column', { x, z, y0: -70, y1: -52 });
  console.log(`(${x},${z}):`, col?.loaded ? JSON.stringify(col.column) : JSON.stringify(col));
}
process.exit(0);
