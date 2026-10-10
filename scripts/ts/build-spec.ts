// build-spec.ts — generic runner for declarative BuildSpec JSON files.
//   node ts/build-spec.ts <spec.json> [--check] [--shots] [--x0 N] [--z0 N] [--y N]
//     (default)  build: give materials -> multi-pass fill per group -> residual report -> optional shots
//     --check    verify-only: compare every spec cell against the live world, no building
//     --y N      force groundTopY (else: spec value, else auto-detect at footprint center)
// Design lives entirely in the JSON file (see specs/README.md); this file is generic plumbing.
import fs from 'node:fs';
import { Bridge, status, column, groundOf, freecamOn, freecamOff, shot, sleep } from './mcbuddy.ts';
import type { BuildSpec } from './buildspec.ts';
import { buildEngine, specToGroups, type BuildStats } from './engine.ts';

const AIRISH = new Set(['air', 'short_grass', 'tall_grass', 'leaf_litter']);

/**
 * Ground detection, safe against buildings:
 * - probe OUTSIDE the footprint (built-over centers report rooftops, seen live)
 * - 24-row windows stepping upward (world.column silently truncates beyond 24 rows)
 */
async function detectGround(b: Bridge, spec: BuildSpec): Promise<number> {
  const { x0, z0 } = spec.site;
  const { fx, fz } = spec.footprint;
  const spots: [number, number][] = [
    [x0 - 3, z0 - 3], [x0 + fx + 2, z0 - 3], [x0 - 3, z0 + fz + 2], [x0 + fx + 2, z0 + fz + 2],
  ];
  for (const [px, pz] of spots) {
    for (let y = -64; y <= 280; y += 24) {
      const rows = await column(b, px, pz, y, Math.min(y + 23, 319)).catch(() => null);
      if (!rows) break; // chunk not loaded (column() returns null) — try next spot
      const g = groundOf(rows);
      if (g !== null) return g;
      // window all airish: keep stepping up
    }
  }
  throw new Error(`cannot auto-detect ground around (${x0},${z0}) — all probe points unloaded`);
}

/** light validation — fail fast with a human message before any world contact */
function validate(spec: BuildSpec): string[] {
  const errs: string[] = [];
  const { fx, fz } = spec.footprint;
  const pillarSet = new Set(spec.pillars.map(p => `${p.dx},${p.dz}`));
  const doorSet = new Set(spec.doors.map(d => `${d.dx},${d.dz}`));
  for (const [mat, slot] of Object.entries(spec.slots))
    if (slot < 0 || slot > 8) errs.push(`slot for ${mat} out of hotbar range 0..8`);
  for (const key of ['foundation', 'wall', 'pillar', 'roof', 'ridge'] as const)
    if (!(spec.materials[key] in spec.slots)) errs.push(`material ${spec.materials[key]} has no hotbar slot`);
  for (const p of spec.pillars)
    if (p.dx < 0 || p.dx >= fx || p.dz < 0 || p.dz >= fz) errs.push(`pillar outside footprint: ${p.dx},${p.dz}`);
  for (const d of spec.doors) {
    if (pillarSet.has(`${d.dx},${d.dz}`)) errs.push(`door on pillar: ${d.dx},${d.dz}`);
    if (d.height > spec.wallHeight) errs.push(`door taller than wall: ${d.dx},${d.dz}`);
  }
  for (const w of spec.windows) {
    if (pillarSet.has(`${w.dx},${w.dz}`)) errs.push(`window on pillar: ${w.dx},${w.dz}`);
    if (doorSet.has(`${w.dx},${w.dz}`)) errs.push(`window inside door gap: ${w.dx},${w.dz}`);
    if (w.y < 1 || w.y > spec.wallHeight) errs.push(`window y=${w.y} outside wall 1..${spec.wallHeight}`);
  }
  for (const t of spec.roofTiers) {
    if (t.y <= spec.wallHeight) errs.push(`roof tier y=${t.y} collides with wall top ${spec.wallHeight}`);
    const { x0, x1, z0, z1 } = t.rect;
    if (x0 > x1 || z0 > z1) errs.push(`inverted rect in roof tier y=${t.y} (remember: x0<=x1, z0<=z1)`);
  }
  return errs;
}

/** verify every spec cell against the live world; a cell may be claimed by several groups
 *  (e.g. pillar tops through a roof ring) — matching ANY claimed material counts as ok */
async function verify(b: Bridge, spec: BuildSpec) {
  const groups = specToGroups(spec);
  const mats = new Map<string, Set<string>>();
  const at = (c: { x: number; y: number; z: number }) => `${c.x},${c.y},${c.z}`;
  for (const g of groups) for (const c of g.cells) {
    const s = mats.get(at(c)) ?? new Set<string>();
    s.add(g.mat); mats.set(at(c), s);
  }
  let ok = 0; const air: string[] = []; const other: string[] = [];
  for (const [k, want] of mats) {
    const [x, y, z] = k.split(',').map(Number);
    const rows = await column(b, x, z, y, y).catch(() => null);
    const blk = rows?.find(r => r.y === y)?.block;
    if (!blk) { other.push(`(${k}) UNLOADED`); continue; }
    if (AIRISH.has(blk)) { air.push(`(${k})`); continue; }
    [...want].some(m => blk.includes(m)) ? ok++ : other.push(`(${k}) got=${blk} want~${[...want].join('|')}`);
  }
  const total = mats.size;
  return { total, ok, air, other };
}

async function takeShots(b: Bridge, spec: BuildSpec, Y0: number) {
  fs.mkdirSync('.qaqh/tmp', { recursive: true });
  const { x0, z0 } = spec.site;
  const look = { x: x0 + spec.footprint.fx / 2, y: Y0 + 1, z: z0 + spec.footprint.fz / 2 };
  await freecamOn(b, { x: look.x + 30, y: Y0 + 14, z: look.z + 30 }, look);
  await sleep(500);
  await shot(b, `.qaqh/tmp/${spec.name}-far.png`, 2);
  await freecamOn(b, { x: look.x, y: Y0 + 3, z: look.z + 18 }, look);
  await sleep(500);
  await shot(b, `.qaqh/tmp/${spec.name}-close.png`, 2);
  await freecamOff(b);
  console.log(`QA shots saved: .qaqh/tmp/${spec.name}-far.png / ${spec.name}-close.png`);
}

async function main() {
  const argv = process.argv.slice(2);
  const file = argv.find(a => !a.startsWith('--'));
  if (!file) throw new Error('usage: node ts/build-spec.ts <spec.json> [--check] [--shots] [--x0 N] [--z0 N] [--y N]');
  const flag = (f: string) => argv.includes(f);
  const opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? Number(argv[i + 1]) : undefined; };

  const spec: BuildSpec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errs = validate(spec);
  if (errs.length) throw new Error(`invalid spec:\n  ${errs.join('\n  ')}`);

  const b = new Bridge();
  await b.connect();
  try {
    const st = await status(b);
    if (!st.agent?.spawned) throw new Error('agent not spawned — /buddy spawn first');

    // site resolution: CLI flags > spec values > auto-detect ground
    const x0 = opt('--x0') ?? spec.site.x0;
    const z0 = opt('--z0') ?? spec.site.z0;
    let groundTopY = opt('--y');
    let how = 'cli';
    if (groundTopY === undefined) { groundTopY = spec.site.groundTopY; how = 'spec'; }
    if (groundTopY === null || groundTopY === undefined || Number.isNaN(groundTopY)) {
      groundTopY = await detectGround(b, spec); how = 'auto';
    }
    spec.site = { x0, z0, groundTopY };
    const Y0 = groundTopY + 1;
    console.log(`[${spec.name}] site x[${x0}..${x0 + spec.footprint.fx - 1}] z[${z0}..${z0 + spec.footprint.fz - 1}] ground=${groundTopY}(${how}) Y0=${Y0} cells=${specToGroups(spec).reduce((n, g) => n + g.cells.length, 0)}`);

    if (flag('--check')) {
      const v = await verify(b, spec);
      console.log(`verify: ok=${v.ok} air=${v.air.length} other=${v.other.length} total=${v.total}`);
      const show = [...v.air.map(s => `${s} AIR`), ...v.other];
      for (const m of show.slice(0, 20)) console.log(' ', m);
      if (show.length > 20) console.log(`  … ${show.length - 20} more`);
      process.exitCode = v.air.length + v.other.length ? 1 : 0;
      return;
    }

    const stats: BuildStats[] = await buildEngine(b, spec);
    const bad = stats.filter(s => s.failed > 0);
    if (bad.length) console.log(`WARNING residual failures: ${bad.map(s => `${s.label}(${s.failed})`).join(' ')} — rerun with a teleport-assisted repair pass or fix the spec`);

    const v = await verify(b, spec);
    console.log(`verify: ok=${v.ok} air=${v.air.length} other=${v.other.length} total=${v.total}`);
    if (flag('--shots')) await takeShots(b, spec, Y0);
    process.exitCode = v.air.length ? 1 : 0;
  } finally {
    b.close();
  }
}

main().then(() => process.exit(process.exitCode ?? 0)).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
