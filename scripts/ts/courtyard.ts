// courtyard.ts — clear all tree parts within RADIUS of the house, so the
// building stops being buried in poplar canopy. Idempotent; safe to re-run.
//
//   node scripts/ts/courtyard.ts [margin=8]
//
// House bounds (design constants from the build): x[47..65] z[-126..-107], roof to y93.
import { Bridge, status, column, breakBlock, isTreePart, sleep } from './mcbuddy.ts';

const HOUSE = { x0: 47, x1: 65, z0: -126, z1: -107, topY: 94 };
const MARGIN = Number(process.argv[2] ?? 8);

async function main() {
  const b = new Bridge();
  await b.connect();
  const st = await status(b);
  if (!st.agent?.spawned) throw new Error('agent not spawned — /buddy spawn first');
  console.log(`clearing trees within ${MARGIN} blocks of house bounds ...`);

  const xLo = HOUSE.x0 - MARGIN, xHi = HOUSE.x1 + MARGIN;
  const zLo = HOUSE.z0 - MARGIN, zHi = HOUSE.z1 + MARGIN;
  let broken = 0;

  for (let x = xLo; x <= xHi; x++) {
    for (let z = zLo; z <= zHi; z++) {
      // scan from high above down to the ground; trees go up to ~y100
      const rows = await column(b, x, z, HOUSE.topY - 6, HOUSE.topY + 24);
      if (!rows) continue;
      for (const { y, block } of rows) {
        if (!isTreePart(block)) continue;
        // never cut blocks that belong to the house (stone/diorite build)
        if (y <= HOUSE.topY && x >= HOUSE.x0 && x <= HOUSE.x1 && z >= HOUSE.z0 && z <= HOUSE.z1) continue;
        if (await breakBlock(b, x, y, z)) broken++;
      }
    }
    if ((x - xLo) % 8 === 7) console.log(`  ${(x - xLo + 1)}/${xHi - xLo + 1} columns`);
  }

  console.log(`done — broke ${broken} tree blocks`);
  b.close();
}

main().then(() => process.exit(0)).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
