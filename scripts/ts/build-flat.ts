// build-flat.ts — house #2 on the superflat world, driven by a declarative BuildSpec.
//   node scripts/ts/build-flat.ts [x0=14] [z0=-14] [groundTopY=auto-detect]
// Design lives in buildspec.ts (house2); this file is only plumbing:
// connect -> status -> buildEngine -> visual QA shots.
import fs from 'node:fs';
import { Bridge, status, column, groundOf, freecamOn, freecamOff, shot, sleep } from './mcbuddy.ts';
import { house2, withSite } from './buildspec.ts';
import { buildEngine } from './engine.ts';

/** probe the ground OUTSIDE the footprint (a built-over center reports rooftops), 24-row windows */
async function detectGround(b: Bridge, x0: number, z0: number, fx: number, fz: number): Promise<number> {
  const spots: [number, number][] = [
    [x0 - 3, z0 - 3], [x0 + fx + 2, z0 - 3], [x0 - 3, z0 + fz + 2], [x0 + fx + 2, z0 + fz + 2],
  ];
  for (const [px, pz] of spots) {
    for (let y = -64; y <= 280; y += 24) {
      const rows = await column(b, px, pz, y, Math.min(y + 23, 319)).catch(() => null);
      if (!rows) break;
      const g = groundOf(rows);
      if (g !== null) return g;
    }
  }
  throw new Error(`cannot auto-detect ground around (${x0},${z0})`);
}

async function main() {
  const argv = process.argv.slice(2);
  const x0 = Number(argv[0] ?? house2.site.x0);
  const z0 = Number(argv[1] ?? house2.site.z0);

  const b = new Bridge();
  await b.connect();
  try {
    const st = await status(b);
    if (!st.agent?.spawned) throw new Error('agent not spawned — /buddy spawn first');

    // ground level: explicit argv[2], else probe the site center
    const groundTopY = argv[2] !== undefined
      ? Number(argv[2])
      : await detectGround(b, x0, z0, house2.footprint.fx, house2.footprint.fz);
    const spec = withSite(house2, x0, z0, groundTopY);
    const Y0 = groundTopY + 1;
    console.log(`ground top y=${groundTopY}${argv[2] === undefined ? ' (auto-detected)' : ''}`);
    console.log(`agent at (${st.agent.pos.x}, ${st.agent.pos.y}, ${st.agent.pos.z}); site x[${x0}..${x0 + spec.footprint.fx - 1}] z[${z0}..${z0 + spec.footprint.fz - 1}] top y=${Y0}`);

    const stats = await buildEngine(b, spec);
    const bad = stats.filter(s => s.failed > 0);
    if (bad.length) console.log(`WARNING: groups with residual failures: ${bad.map(s => `${s.label}(${s.failed})`).join(' ')}`);

    // ---- visual QA ----
    fs.mkdirSync('.qaqh/tmp', { recursive: true });
    const look = { x: x0 + spec.footprint.fx / 2, y: Y0 + 1, z: z0 + spec.footprint.fz / 2 };
    await freecamOn(b, { x: look.x + 30, y: Y0 + 14, z: look.z + 30 }, look);
    await sleep(500);
    await shot(b, '.qaqh/tmp/house2-far.png', 2);
    await freecamOn(b, { x: look.x, y: Y0 + 3, z: look.z + 18 }, look);
    await sleep(500);
    await shot(b, '.qaqh/tmp/house2-close.png', 2);
    await freecamOff(b);
    console.log('QA shots saved: .qaqh/tmp/house2-far.png / house2-close.png');
  } finally {
    b.close();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
