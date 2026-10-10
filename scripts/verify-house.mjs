import net from 'node:net';
const bridge = { buf: '', pend: new Map(), id: 1, sock: null };
function call(method, params) {
  return new Promise((res, rej) => {
    const id = bridge.id++;
    bridge.pend.set(id, { res, rej });
    bridge.sock.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
const X0 = 47, Z0 = -120, FX = 19, FZ = 20;
const s = net.connect(25731, '127.0.0.1');
bridge.sock = s;
s.setEncoding('utf8');
s.on('connect', async () => {
  s.on('data', c => { bridge.buf += c; let i; while ((i = bridge.buf.indexOf('\n')) >= 0) { const l = bridge.buf.slice(0, i).trim(); bridge.buf = bridge.buf.slice(i + 1); if (!l) continue; const m = JSON.parse(l); const p = bridge.pend.get(m.id); if (p) { bridge.pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } } });
  const levels = [
    ['ring', 90, (dx, dz) => dx === 0 || dz === 0 || dx === FX - 1 || dz === FZ - 1],
    ['tier1', 91, (dx, dz) => dx >= -1 && dx <= FX && dz >= -1 && dz <= FZ],
    ['tier2', 92, (dx, dz) => dx >= 1 && dx <= FX - 2 && dz >= 1 && dz <= FZ - 2],
  ];
  for (const [name, y, test] of levels) {
    let ok = 0, missing = [];
    const pts = [];
    for (let dx = -1; dx <= FX; dx++) for (let dz = -1; dz <= FZ; dz++) if (test(dx, dz)) pts.push([dx, dz]);
    for (const [dx, dz] of pts) {
      const r = await call('world.column', { x: X0 + dx, z: Z0 + dz, y0: y, y1: y });
      const row = r.loaded ? r.column.find(v => Number(v.split(' ')[0]) === y) : null;
      const id = row ? row.split(' ')[1].replace('block.minecraft.', '') : 'unloaded';
      if (id !== 'air') ok++; else missing.push(`${X0 + dx},${y},${Z0 + dz}`);
    }
    console.log(`${name}@${y}: ${ok}/${pts.length} occupied${missing.length ? ' MISSING: ' + missing.slice(0, 8).join(' ') : ''}`);
  }
  let ok = 0, missing = [];
  const xr = 9;
  for (let dx = xr - 2; dx <= xr + 2; dx++) for (let dz = 1; dz <= FZ - 2; dz++) {
    const r = await call('world.column', { x: X0 + dx, z: Z0 + dz, y0: 93, y1: 93 });
    const row = r.loaded ? r.column.find(v => Number(v.split(' ')[0]) === 93) : null;
    const id = row ? row.split(' ')[1].replace('block.minecraft.', '') : 'unloaded';
    if (id !== 'air') ok++; else missing.push(`${X0 + dx},93,${Z0 + dz}`);
  }
  console.log(`ridge@93: ${ok}/90${missing.length ? ' MISSING: ' + missing.slice(0, 8).join(' ') : ''}`);
  // door + windows check
  for (const [x, y, z] of [[55, 87, -120], [56, 87, -120], [55, 88, -120], [56, 88, -120]]) {
    const r = await call('world.column', { x, z, y0: y, y1: y });
    const row = r.column.find(v => Number(v.split(' ')[0]) === y);
    console.log(`door cell ${x},${y},${z}: ${row.split(' ')[1]}`);
  }
  s.destroy(); process.exit(0);
});
