import net from 'node:net';
const bridge = { buf: '', pend: new Map(), id: 1, sock: null };
function call(method, params) {
  return new Promise((res, rej) => {
    const id = bridge.id++;
    bridge.pend.set(id, { res, rej });
    bridge.sock.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
const s = net.connect(25731, '127.0.0.1');
bridge.sock = s;
s.setEncoding('utf8');
s.on('connect', async () => {
  s.on('data', c => { bridge.buf += c; let i; while ((i = bridge.buf.indexOf('\n')) >= 0) { const l = bridge.buf.slice(0, i).trim(); bridge.buf = bridge.buf.slice(i + 1); if (!l) continue; const m = JSON.parse(l); const p = bridge.pend.get(m.id); if (p) { bridge.pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } } });
  const pts = [];
  for (let i = 0; i <= 4; i++) for (let j = 2; j <= 7; j++) pts.push([23 + 6 * i, -138 + 6 * j]);
  for (const [x, z] of pts) {
    const r = await call('world.column', { x, z, y0: 80, y1: 92 });
    const tops = r.column.filter(r2 => { const id = r2.split(' ')[1].replace('block.minecraft.', ''); return !['air', 'short_grass', 'tall_grass', 'fern'].includes(id) && Number(r2.split(' ')[0]) >= 83; });
    console.log(x, z, '->', tops.join(' | '));
  }
  s.destroy(); process.exit(0);
});
