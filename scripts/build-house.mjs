#!/usr/bin/env node
// PTC demo: build a 19x20 stone-foundation Chinese-style house by driving
// mcbuddy's bridge primitives (survey -> pick -> fill -> walls -> roof).
// The model writes the program ONCE; the mod's algorithms execute & guard it.
//
// Usage: node scripts/build-house.mjs [--cx 68] [--cz -100] [--dry]

import net from 'node:net';

const PORT = Number(process.env.MCBUDDY_PORT || 25731);
const HOST = '127.0.0.1';

// ---------- bridge ----------
class Bridge {
  constructor() {
    this.socket = null; this.buffer = ''; this.pending = new Map(); this.nextId = 1;
  }
  async connect(timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try { await this.#dial(); return; }
      catch (e) {
        if (Date.now() > deadline) throw new Error(`bridge unreachable: ${e.message}`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  #dial() {
    return new Promise((resolve, reject) => {
      const s = net.connect(PORT, HOST);
      s.setEncoding('utf8');
      const fail = (e) => { s.destroy(); reject(e); };
      s.once('error', fail);
      s.once('connect', () => {
        s.off('error', fail);
        s.on('data', c => this.#onData(c));
        s.on('close', () => { for (const p of this.pending.values()) p.reject(new Error('closed')); this.pending.clear(); this.socket = null; });
        s.on('error', () => {});
        this.socket = s; resolve();
      });
    });
  }
  #onData(chunk) {
    this.buffer += chunk;
    let i;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      const p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message ?? JSON.stringify(m.error))) : p.resolve(m.result); }
    }
  }
  call(method, params = {}, timeoutMs = 8000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, timeoutMs);
      this.pending.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } });
      this.socket.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  close() { this.socket?.destroy(); }
}

const bridge = new Bridge();

// ---------- guarded ops ----------
async function rawCall(method, params, timeoutMs = 8000) {
  for (let a = 1; ; a++) {
    try { return await bridge.call(method, params, timeoutMs); }
    catch (e) {
      if (a >= 4) throw new Error(`${method} ${JSON.stringify(params)}: ${e.message}`);
      await sleep(600 * a);
    }
  }
}

async function teleport(x, y, z) {
  const r = await rawCall('agent.teleport', { x, y, z });
  if (!r.moved) throw new Error(`teleport refused: ${r.reason}`);
  return r;
}

// pick a material: find a shallow source block, clear the ground cover around it,
// stand on intact ground beside it, pick it (creative pick-block)
async function pickMaterial(block, nearX, nearZ, y0) {
  const f = await rawCall('world.find', { block, x: nearX, z: nearZ, y0: y0 - 3, y1: y0 + 6, radius: 24 });
  const hits = f.matches ?? [];
  if (!hits.length) throw new Error(`no ${block} found near site (needed for pick)`);
  for (const hit of hits.slice(0, 8)) {
    for (const [px, pz] of [[hit.x + 2, hit.z], [hit.x - 2, hit.z], [hit.x, hit.z + 2], [hit.x, hit.z - 2]]) {
      // clear ground cover (leaf_litter etc.) that would block a standable spot
      const rows = await column(px, pz, y0, y0 + 2).catch(() => null);
      if (rows) for (const row of rows) {
        const [ys, id] = row.split(' ');
        if (!isAirish(id)) await breakBlock(px, Number(ys), pz);
      }
      try { await teleport(px + 0.5, y0 + 1, pz + 0.5); } catch { continue; }
      for (let y = hit.y + 1; y <= y0; y++) await breakBlock(hit.x, y, hit.z); // dig covers off
      const p = await rawCall('agent.pick', { x: hit.x, y: hit.y, z: hit.z });
      const heldName = (p.held ?? '').split(' ')[0];
      if (p.changed === true || heldName === block.replace('minecraft:', '')) return p;
    }
  }
  throw new Error(`could not expose & pick any ${block}`);
}

// try materials in preference order (fallback when the top pick is out of reach)
async function pickAny(blocks, nearX, nearZ, y0) {
  let lastErr = null;
  for (const b of blocks) {
    try { return await pickMaterial(b, nearX, nearZ, y0); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// place one block; try in place first, only teleport when reach fails
async function place(x, y, z, opts = {}) {
  const { standY = y, tries = 4 } = opts;
  for (let t = 0; t < tries; t++) {
    const r = await rawCall('agent.place', { x, y, z });
    if (r.placed) return r;
    const reason = r.reason ?? '';
    if (reason.includes('no solid neighbour')) return { placed: false, skipped: reason };
    if (r.within_reach === false || reason.includes('empty hand')) {
      const spots = [[2.5, 0.5], [-2.5, 0.5], [0.5, 2.5], [0.5, -2.5], [1.5, 1.5]];
      const s = spots[t % spots.length];
      try { await teleport(x + s[0], standY + 1, z + s[1]); } catch { /* try next */ }
    }
    await sleep(200);
  }
  return { placed: false, skipped: 'gave up' };
}

async function breakBlock(x, y, z) {
  const r = await rawCall('agent.break', { x, y, z });
  return r;
}

// ground height (topmost non-air, non-vegetation y) from a world.column response
function groundOf(columnRows) {
  let g = null;
  for (const row of columnRows) {
    const [ys, id] = row.split(' ');
    const y = Number(ys);
    const bare = id.replace('block.minecraft.', '');
    if (bare.includes('leaves') || bare.includes('_log') || bare.includes('wood')) continue; // trees — not ground
    if (bare !== 'air' && bare !== 'short_grass' && bare !== 'tall_grass' && bare !== 'fern') g = y;
  }
  return g;
}
const isAirish = (id) => {
  const b = id.replace('block.minecraft.', '');
  return b === 'air' || b === 'short_grass' || b === 'tall_grass' || b === 'fern' || b === 'dandelion' || b === 'poppy' || b === 'snow' || b === 'leaf_litter';
};
const isTreePart = (id) => {
  const b = id.replace('block.minecraft.', '');
  return b.includes('leaves') || b.includes('_log') || b === 'leaf_litter' || b.includes('wood');
};

async function column(x, z, y0, y1) {
  const r = await rawCall('world.column', { x, z, y0, y1 });
  return r.loaded ? r.column : null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- design ----------
const FX = 19, FZ = 20;            // foundation 19(x) x 20(z)
const WALL_H = 3;                  // wall blocks above foundation
const TIER1_D = 1, TIER2_D = 3;    // roof tier overhang/step (x/z shrink per tier)
const DOOR_Z_SIDE = 0;             // 0 = min-z face
const stats = { placed: 0, broken: 0, skipped: 0, calls: 0 };

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
  const DRY = argv.includes('--dry');

  process.stdout.write('connecting ... ');
  await bridge.connect();
  console.log('ok');

  const st = await rawCall('status');
  if (!st.agent?.spawned) throw new Error('agent not spawned — run /buddy spawn in game');
  if (st.pause?.server_paused) throw new Error('game is paused (ESC) — unpause the world');
  console.log(`agent at (${st.agent.pos.x}, ${st.agent.pos.y}, ${st.agent.pos.z}), tick ${st.tick}`);

  // ---- phase 1: survey grid, choose flattest 19x20 window ----
  // world.column returns at most 24 rows, so keep windows <= 24 and get the
  // agent out of any pit first (it sinks the reference height).
  for (const off of [[0.5, 0.5], [2.5, 0.5], [-2.5, 0.5], [0.5, 2.5], [0.5, -2.5]]) {
    try { await teleport(cx + off[0], 85, cz + off[1]); break; } catch { /* next */ }
  }
  const st2 = await rawCall('status');
  const ay = st2.agent?.pos?.y ?? 80;
  const cy0 = Math.max(1, Math.min(ay - 12, ay + 11 - 23));
  const cy1 = cy0 + 23;
  const cx = arg('--cx', Math.round(st.agent.pos.x)), cz = arg('--cz', Math.round(st.agent.pos.z));
  const step = 6, gx = 9, gz = 9; // 9x9 samples, 48x48 area
  const H = []; // heights[gi][gz]
  console.log(`surveying ${gx}x${gz} grid around (${cx}, ${cz}) ...`);
  const jobs = [];
  for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++) {
    const x = cx - step * (gx >> 1) + i * step, z = cz - step * (gz >> 1) + j * step;
    jobs.push({ i, j, x, z });
  }
  const heights = Array.from({ length: gx }, () => Array(gz).fill(null));
  const wet = Array.from({ length: gx }, () => Array(gz).fill(false));
  await Promise.all(jobs.map(async (job) => {
    const rows = await column(job.x, job.z, cy0, cy1).catch(() => null);
    if (!rows) return;
    heights[job.i][job.j] = groundOf(rows);
    wet[job.i][job.j] = rows.some(r => r.includes('water'));
  }));
  // choose top-left grid cell of a window spanning (FX-1)/step+1 x (FZ-1)/step+1 samples
  const wi = Math.ceil((FX - 1) / step) + 1, wj = Math.ceil((FZ - 1) / step) + 1;
  let best = null;
  for (let i = 0; i + wi < gx; i++) for (let j = 0; j + wj < gz; j++) {
    let hs = [], bad = false;
    for (let a = 0; a <= wi && !bad; a++) for (let b = 0; b <= wj; b++) {
      if (wet[i + a][j + b]) { bad = true; break; }
      const h = heights[i + a][j + b]; if (h == null) { bad = true; break; }
      hs.push(h);
    }
    if (bad) continue;
    const min = Math.min(...hs), max = Math.max(...hs);
    const score = (max - min) * 100 + max; // flatness first, lower terrain second
    if (!best || score < best.score) best = { score, i, j, min, max };
  }
  if (!best) throw new Error('no suitable flat, dry 19x20 window found in survey area');
  const x0 = cx - step * (gx >> 1) + best.i * step;
  const z0 = cz - step * (gz >> 1) + best.j * step;
  const y0 = best.max; // foundation top level
  console.log(`site: x [${x0}..${x0 + FX - 1}], z [${z0}..${z0 + FZ - 1}], foundation top y=${y0} (terrain spread ${best.min}..${best.max})`);
  if (DRY) { console.log('(--dry) stopping after site selection'); return; }

  // ---- phase 2: materials ----
  console.log('picking materials (stone / diorite / deepslate) ...');
  await pickMaterial('stone', cx, cz, y0);
  const hand1 = await rawCall('status');
  console.log('stone picked; hotbar:', hand1.agent.hotbar.filter(Boolean).join(', '));

  // ---- phase 2.5: clear the site (tree canopy blocks standable spots) ----
  console.log('clearing canopy / obstacles around site ...');
  for (let x = x0 - 4; x <= x0 + FX + 3; x++) {
    for (let z = z0 - 4; z <= z0 + FZ + 3; z++) {
      const rows = await column(x, z, y0 + 1, y0 + 12).catch(() => null);
      if (!rows) continue;
      for (const row of rows) {
        const [ys, id] = row.split(' ');
        if (isTreePart(id)) { await breakBlock(x, Number(ys), z); stats.broken++; }
      }
    }
    if ((x - (x0 - 4)) % 8 === 7) console.log(`  clear ${(x - (x0 - 4) + 1)}/${FX + 8}`);
  }
  console.log(`canopy cleared (broke ${stats.broken} blocks)`);

  // ---- phase 3: foundation — clear + fill every column to y0 ----
  console.log('laying 19x20 foundation ...');
  for (let dx = 0; dx < FX; dx++) {
    for (let dz = 0; dz < FZ; dz++) {
      const x = x0 + dx, z = z0 + dz;
      const rows = await column(x, z, y0 - 15, y0 + 8);
      if (!rows) throw new Error(`chunk not loaded at ${x},${z}`);
      const g = groundOf(rows);
      if (g == null) throw new Error(`no ground at ${x},${z}`);
      const rowAt = (y) => rows.find(r => Number(r.split(' ')[0]) === y);
      // terrain higher than the foundation top: break it down to y0
      for (let y = g; y > y0; y--) {
        const id = rowAt(y)?.split(' ')[1];
        if (id && !isAirish(id)) { await breakBlock(x, y, z); stats.broken++; }
      }
      // fill up to y0, skipping cells that are already stone
      for (let y = g + 1; y <= y0; y++) {
        const cur = rowAt(y)?.split(' ')[1];
        if (cur && cur.endsWith('stone')) continue; // already placed
        const r = await place(x, y, z, { standY: y0 });
        if (r.placed) stats.placed++; else stats.skipped++;
      }
    }
    if (dx % 4 === 3) console.log(`  foundation ${(dx + 1) * FZ}/${FX * FZ}`);
  }
  console.log(`foundation done (placed ${stats.placed}, broke ${stats.broken})`);

  // ---- phase 4: walls (diorite) with door + window gaps, deepslate pillars ----
  await pickMaterial('diorite', x0 + FX / 2, z0 + FZ / 2, y0);
  const isPerimeter = (dx, dz) => dx === 0 || dz === 0 || dx === FX - 1 || dz === FZ - 1;
  const isPillar = (dx, dz) => (dx === 0 || dx === FX - 1) && (dz === 0 || dz === FZ - 1 || dz === Math.floor(FZ / 2) || dz === Math.ceil(FZ / 2))
    || (dz === 0 || dz === FZ - 1) && (dx === 0 || dx === FX - 1 || dx === 4 || dx === FX - 5);
  const isDoor = (dx, dz) => dz === DOOR_Z_SIDE && (dx === Math.floor(FX / 2) || dx === Math.floor(FX / 2) - 1) ;
  const isWindow = (dx, dz, dy) => dy === 1 && !isDoor(dx, dz)
    && ((dz === 0 && dx % 5 === 2 && dx > 2 && dx < FX - 3) || (dz === FZ - 1 && dx % 5 === 2 && dx > 2 && dx < FX - 3)
      || (dx === 0 && dz % 5 === 2 && dz > 2 && dz < FZ - 3) || (dx === FX - 1 && dz % 5 === 2 && dz > 2 && dz < FZ - 3));

  // pass A: diorite wall cells (skip pillar columns and gaps)
  for (let dx = 0; dx < FX; dx++) {
    for (let dz = 0; dz < FZ; dz++) {
      if (!isPerimeter(dx, dz) || isPillar(dx, dz)) continue;
      const have = {};
      const wrows = await column(x0 + dx, z0 + dz, y0 + 1, y0 + WALL_H).catch(() => null);
      if (wrows) for (const row of wrows) { const [ys, id] = row.split(' '); have[Number(ys)] = id.replace('block.minecraft.', ''); }
      for (let h = 1; h <= WALL_H; h++) {
        if (isDoor(dx, dz) && h <= 2) continue;         // door gap
        if (isWindow(dx, dz, h)) continue;              // window gap
        if (have[y0 + h] && have[y0 + h] !== 'air') continue; // already built
        const r = await place(x0 + dx, y0 + h, z0 + dz, { standY: y0 });
        r.placed ? stats.placed++ : stats.skipped++;
      }
    }
    if (dx % 5 === 4) console.log(`  walls ${(dx + 1)}/${FX}`);
  }
  // pass B: dark pillars (deepslate preferred, granite/diorite fallback)
  await pickAny(['deepslate', 'granite', 'diorite'], x0 + FX / 2, z0 + FZ / 2, y0);
  for (let dx = 0; dx < FX; dx++) for (let dz = 0; dz < FZ; dz++) {
    if (!isPillar(dx, dz)) continue;
    for (let h = 1; h <= WALL_H + 1; h++) {
      const r = await place(x0 + dx, y0 + h, z0 + dz, { standY: y0 });
      r.placed ? stats.placed++ : stats.skipped++;
    }
  }
  console.log(`walls done (total placed ${stats.placed})`);

  // ---- phase 5: roof tiers (stone), ridge (deepslate) ----
  await pickMaterial('stone', x0 + FX / 2, z0 + FZ / 2, y0);
  const tiers = [
    { dy: WALL_H + 1, inX: -TIER1_D, inZ: -TIER1_D },              // 21x22
    { dy: WALL_H + 2, inX: TIER2_D, inZ: TIER2_D },                // 13x14
  ];
  for (const t of tiers) {
    const ax0 = x0 - t.inX, ax1 = x0 + FX - 1 + t.inX;
    const az0 = z0 - t.inZ, az1 = z0 + FZ - 1 + t.inZ;
    const y = y0 + t.dy;
    // ring first (attaches to structure below/side), then fill inward
    const cells = [];
    for (let x = ax0; x <= ax1; x++) for (let z = az0; z <= az1; z++) {
      const edge = x === ax0 || x === ax1 || z === az0 || z === az1;
      if (edge) cells.push([x, z]);
    }
    for (let x = ax0 + 1; x <= ax1 - 1; x++) for (let z = az0 + 1; z <= az1 - 1; z++) cells.push([x, z]);
    let n = 0;
    for (const [x, z] of cells) {
      const r = await place(x, y, z, { standY: y - 1 });
      r.placed ? stats.placed++ : stats.skipped++;
      if (++n % 100 === 0) console.log(`  roof y=${y}: ${n}/${cells.length}`);
    }
    console.log(`  tier at y=${y} done (${cells.length} blocks)`);
  }
  // ridge along z, 5 wide (x) x FZ-2 long, on tier2
  await pickAny(['deepslate', 'granite', 'stone'], x0 + FX / 2, z0 + FZ / 2, y0);
  {
    const y = y0 + WALL_H + 3;
    const xr = Math.floor(FX / 2), cells = [];
    for (let dx = xr - 2; dx <= xr + 2; dx++) for (let dz = 1; dz <= FZ - 2; dz++) cells.push([x0 + dx, z0 + dz]);
    for (const [x, z] of cells) {
      const r = await place(x, y, z, { standY: y - 1 });
      r.placed ? stats.placed++ : stats.skipped++;
    }
    console.log(`ridge done (${cells.length} blocks)`);
  }

  // ---- phase 6: report ----
  const fin = await rawCall('status');
  const ed = await rawCall('world.edits', { since: 0, limit: 1 });
  console.log('\n=== BUILD REPORT ===');
  console.log(`placed=${stats.placed} broken=${stats.broken} skipped=${stats.skipped}`);
  console.log(`agent now at (${fin.agent?.pos?.x}, ${fin.agent?.pos?.y}, ${fin.agent?.pos?.z}) health=${fin.agent?.health}`);
  console.log(`edit log total: ${ed.total ?? ed.edits?.length ?? '?'}`);
}

main()
  .then(() => { bridge.close(); console.log('done'); process.exit(0); })
  .catch((e) => { console.error('FAIL:', e.message); bridge.close(); process.exit(1); });
