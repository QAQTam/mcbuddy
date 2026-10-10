#!/usr/bin/env node
// Roof fixup for the house at x[47..65] z[-120..-101] y0=88:
//   - break the inverted 25x26 slab @y93 and the stray ridge @y94
//   - add a wall-top ring @y90 so the first roof tier has support
//   - tier1 21x22 @y91, keep tier2 17x18 @y92, ridge 5x18 @y93
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

const stats = { placed: 0, broken: 0, skipped: 0 };

async function teleport(x, y, z) {
  const r = await raw('agent.teleport', { x, y, z });
  if (!r.moved) throw new Error('teleport refused: ' + r.reason);
}
async function place(x, y, z) {
  for (let t = 0; t < 4; t++) {
    const r = await raw('agent.place', { x, y, z });
    if (r.placed) { stats.placed++; return true; }
    const reason = r.reason ?? '';
    if (reason.includes('no solid neighbour')) { stats.skipped++; return false; }
    if (r.within_reach === false) {
      const spots = [[2.5, 0.5], [-2.5, 0.5], [0.5, 2.5], [0.5, -2.5], [1.5, 1.5]];
      const sp = spots[t % spots.length];
      try { await teleport(x + sp[0], y - 1, z + sp[1]); } catch { }
    }
    await sleep(200);
  }
  stats.skipped++; return false;
}
async function breakIfSolid(x, y, z) {
  const r = await raw('agent.break', { x, y, z });
  if (r.broken) stats.broken++;
}

async function main() {
  const st = await raw('status');
  if (!st.agent?.spawned) throw new Error('agent not spawned');
  console.log('agent at', st.agent.pos.x, st.agent.pos.y, st.agent.pos.z);

  // A) break the wrong 25x26 slab @y93 and stray ridge @y94
  console.log('breaking misplaced roof slab @y93 and ridge @y94 ...');
  for (let x = X0 - 3; x <= X0 + FX + 2; x++) {
    for (let z = Z0 - 3; z <= Z0 + FZ + 2; z++) {
      await breakIfSolid(x, 93, z);
      await breakIfSolid(x, 94, z);
    }
    if ((x - X0 + 3) % 8 === 0) console.log(`  slab ${(x - X0 + 4)}/${FX + 6}`);
  }
  console.log('slab removed:', stats.broken);

  // B) wall-top ring @y90 (skip pillars which already reach y90)
  console.log('building wall-top ring @y90 ...');
  const isPillar = (dx, dz) => (dx === 0 || dx === FX - 1) && (dz === 0 || dz === FZ - 1 || dz === 9 || dz === 10)
    || (dz === 0 || dz === FZ - 1) && (dx === 0 || dx === FX - 1 || dx === 4 || dx === 14);
  for (let dx = 0; dx < FX; dx++) for (let dz = 0; dz < FZ; dz++) {
    const per = dx === 0 || dz === 0 || dx === FX - 1 || dz === FZ - 1;
    if (!per || isPillar(dx, dz)) continue;
    await place(X0 + dx, Y0 + 2, Z0 + dz);
  }
  console.log('ring done', stats.placed);

  // C) tier1 21x22 @y91 (ring then fill inward), tier2 17x18 @y92 exists, ridge @y93
  for (const t of [{ y: Y0 + 3, d: 1 }, { y: Y0 + 5, d: 2, ridge: true }]) {
    console.log(`building level y=${t.y} ...`);
    const cells = [];
    const ax0 = X0 - t.d, ax1 = X0 + FX - 1 + t.d, az0 = Z0 - t.d, az1 = Z0 + FZ - 1 + t.d;
    if (!t.ridge) {
      for (let x = ax0; x <= ax1; x++) for (let z = az0; z <= az1; z++) {
        if (x === ax0 || x === ax1 || z === az0 || z === az1) cells.push([x, z]);
      }
      for (let x = ax0 + 1; x <= ax1 - 1; x++) for (let z = az0 + 1; z <= az1 - 1; z++) cells.push([x, z]);
    } else {
      const xr = Math.floor(FX / 2);
      for (let dx = xr - 2; dx <= xr + 2; dx++) for (let dz = 1; dz <= FZ - 2; dz++) cells.push([X0 + dx, Z0 + dz]);
    }
    let n = 0;
    for (const [x, z] of cells) {
      await place(x, t.y, z);
      if (++n % 100 === 0) console.log(`  y=${t.y}: ${n}/${cells.length}`);
    }
    console.log(`  y=${t.y} done (${cells.length} cells)`);
  }

  console.log('\n=== FIXUP REPORT ===');
  console.log(`placed=${stats.placed} broken=${stats.broken} skipped=${stats.skipped}`);
}

main().then(() => { s.destroy(); process.exit(0); }).catch(e => { console.error('FAIL:', e.message); s.destroy(); process.exit(1); });
