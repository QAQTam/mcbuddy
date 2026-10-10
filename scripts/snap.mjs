#!/usr/bin/env node
// Grab an image from the bridge and save it as a PNG file.
//   node scripts/snap.mjs map [radius] [out.png]     top-down block map (server-rendered)
//   node scripts/snap.mjs shot [downscale] [out.png]  game window screenshot (client framebuffer)
import net from 'node:net';
import fs from 'node:fs';

const PORT = 25731, HOST = '127.0.0.1';
const [, , cmd, arg1, arg2] = process.argv;
const out = arg2 ?? (cmd === 'map' ? '.qaqh/tmp/map.png' : '.qaqh/tmp/shot.png');

const bridge = { buf: '', pend: new Map(), id: 1, sock: null };
function call(method, params) {
  return new Promise((res, rej) => {
    const id = bridge.id++;
    const t = setTimeout(() => { bridge.pend.delete(id); rej(new Error(method + ' timeout')); }, 10000);
    bridge.pend.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
    bridge.sock.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
const s = net.connect(PORT, HOST);
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
s.on('connect', async () => {
  try {
    if (cmd === 'map') {
      const st = await call('status');
      const r = await call('world.map', { x: Number(process.env.MAP_X ?? st.agent?.pos?.x ?? 0), z: Number(process.env.MAP_Z ?? st.agent?.pos?.z ?? 0), radius: Number(arg1 ?? 40) });
      fs.mkdirSync(out.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
      fs.writeFileSync(out, Buffer.from(r.data_base64, 'base64'));
      console.log(`map saved: ${out} (${r.size}x${r.size}, heights ${r.height_min}..${r.height_max}, ${r.bytes} bytes)`);
    } else if (cmd === 'shot') {
      const r = await call('camera.shot', { downscale: Number(arg1 ?? 2) });
      fs.mkdirSync(out.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
      fs.writeFileSync(out, Buffer.from(r.data_base64, 'base64'));
      console.log(`shot saved: ${out} (${r.bytes} bytes)`);
    } else {
      console.error('usage: snap.mjs map|shot');
      process.exitCode = 2;
    }
    s.destroy(); process.exit(0);
  } catch (e) { console.error('FAIL:', e.message); s.destroy(); process.exit(1); }
});
