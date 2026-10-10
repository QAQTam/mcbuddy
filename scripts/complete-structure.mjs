#!/usr/bin/env node
// Completion pass: fill every missing cell of the designed structure at
// x[47..65] z[-120..-101], y0=88 — ring@90, tier1 21x22@91, tier2 17x18@92,
// ridge 5x18@93. Multi-pass until no progress.
import net from 'node:net';

const X0 = 47, Z0 = -120, FX = 19, FZ = 20, Y0 = 88;
const bridge = { buf: '', pend: new Map(), id: 1, sock: null };
function call(method, params, timeoutMs = 9000) {
  return new Promise((res, rej) => {
    const id = bridge.id++;
    const t = setTimeout(() => { bridge.pend.delete(id); rej(new Error(method + ' timeout')); }, timeoutMs);
    bridge.pend.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
    bridge.sock.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
async function raw(method, params, tries = 4) {
  for (let a = 1; ; a++) {
    try { return await call(method, params); }
    catch (e) { if (a >= tries) throw e; await sleep(500 * a); }
  }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const s = net.connect(25731, '127.0.0.1');
bridge.sock = s;
s.setEncoding('utf8');
s.on('data', c => {
  bridge.buf += c; let i;
  while ((i = bridge.buf.indexOf('\n')) >= 0) {
    const l = bridge.buf.slice(0, i).trim(); bridge.buf = bridge.buf.slice(i + 1);
    if (!l) continue;
    const m = JSON.parse(l); const p = bridge.pend.get(m.id);
    if (p) { bridge.pend.delete(m.id); m.error ? p.rej(new Error(m.error.message ?? JSON.stringify(m.error))) : p.res(m.result); }
  }
});

const stats = { placed: 0, occupied: 0, failed: 0 };
let failedCells = [];

function cellList() {
  const cells = [];
  // ring @90 (walls top-up)
  for (let dx = 0; dx < FX; dx++) for (let dz = 0; dz < FZ; dz++) {
    if (dx === 0 || dz === 0 || dx === FX - 1 || dz === FZ - 1) cells.push([X0 + dx, 90, Z0 + dz]);
  }
  // tier1 21x22 @91: cells above walls first, then overhang ring, then interior
  const ax0 = X0 - 1, ax1 = X0 + FX, az0 = Z0 - 1, az1 = Z0 + FZ;
  for (let dx = 0; dx < FX; dx++) for (let dz = 0; dz < FZ; dz++) {
    if (dx === 0 || dz === 0 || dx === FX - 1 || dz === FZ - 1) cells.push([X0 + dx, 91, Z0 + dz]);
  }
  for (let x = ax0; x <= ax1; x++) for (let z = az0; z <= az1; z++) {
    if (x === ax0 || x === ax1 || z === az0 || z === az1) cells.push([x, 91, z]);
  }
  for (let x = ax0 + 1; x <= ax1 - 1; x++) for (let z = az0 + 1; z <= az1 - 1; z++) cells.push([x, 91, z]);
  // tier2 17x18 @92
  for (let x = X0 + 1; x <= X0 + FX - 2; x++) for (let z = Z0 + 1; z <= Z0 + FZ - 2; z++) cells.push([x, 92, z]);
  // ridge 5x18 @93
  const xr = Math.floor(FX / 2);
  for (let dx = xr - 2; dx <= xr + 2; dx++) for (let dz = 1; dz <= FZ - 2; dz++) cells.push([X0 + dx, 93, Z0 + dz]);
  return cells;
}

async function occupied(x, y, z) {
  const r = await raw('world.column', { x, z, y0: y, y1: Math.min(y + 1, y + 1) });
  if (!r.loaded) return true; // treat unloaded as done, don't spin
  const row = r.column.find(v => Number(v.split(' ')[0]) === y);
  if (!row) return false;
  const id = row.split(' ')[1].replace('block.minecraft.', '');
  return id !== 'air';
}

async function tryPlace(x, y, z) {
  for (let t = 0; t < 4; t++) {
    const r = await raw('agent.place', { x, y, z });
    if (r.placed) { stats.placed++; return true; }
    const reason = r.reason ?? '';
    if (reason.includes('no solid neighbour')) { stats.failed++; return false; }
    if (r.within_reach === false || reason.includes('empty hand')) {
      const spots = [[1.5, 0.5], [-1.5, 0.5], [0.5, 1.5], [0.5, -1.5], [2.5, 0.5], [0.5, -2.5]];
      const sp = spots[t % spots.length];
      try { await raw('agent.teleport', { x: x + sp[0], y: y, z: z + sp[1] }); } catch { }
    }
    await sleep(150);
  }
  stats.failed++; return false;
}

async function main() {
  const st = await raw('status');
  if (!st.agent?.spawned) throw new Error('agent not spawned');
  const cells = cellList();
  console.log(`cells: ${cells.length}`);
  for (let pass = 1; pass <= 8; pass++) {
    const before = stats.placed;
    let occupiedNow = 0;
    const stillMissing = [];
    for (const [x, y, z] of cells) {
      if (await occupied(x, y, z)) { occupiedNow++; continue; }
      const ok = await tryPlace(x, y, z);
      if (!ok) stillMissing.push([x, y, z]);
    }
    console.log(`pass ${pass}: occupied=${occupiedNow} placed=${stats.placed - before} missing=${stillMissing.length}`);
    if (stillMissing.length === 0) { console.log('structure complete'); break; }
    if (stats.placed === before) { console.log('no progress; stopping'); failedCells = stillMissing; break; }
  }
  console.log('\n=== COMPLETE REPORT ===');
  console.log(`placed=${stats.placed} occupied=${stats.occupied} failed=${stats.failed}`);
  if (failedCells.length) console.log('missing:', failedCells.slice(0, 12).map(c => c.join(',')).join(' | '), failedCells.length > 12 ? `+${failedCells.length - 12} more` : '');
}

main().then(() => { s.destroy(); process.exit(0); }).catch(e => { console.error('FAIL:', e.message); s.destroy(); process.exit(1); });
