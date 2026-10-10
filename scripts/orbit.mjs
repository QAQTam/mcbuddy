#!/usr/bin/env node
// Director reel: orbit the house with the freecam, take a shot every 45°.
//   node scripts/orbit.mjs [cx] [cz] [dist] [height]
import net from 'node:net';
import fs from 'node:fs';

const CX = Number(process.argv[2] ?? 56), CZ = Number(process.argv[3] ?? -113);
const DIST = Number(process.argv[4] ?? 26), H = Number(process.argv[5] ?? 12);
const LOOK = { x: CX, y: 90, z: CZ }; // look at wall-top level

const bridge = { buf: '', pend: new Map(), id: 1, sock: null };
function call(method, params, timeoutMs = 9000) {
  return new Promise((res, rej) => {
    const id = bridge.id++;
    const t = setTimeout(() => { bridge.pend.delete(id); rej(new Error(method + ' timeout')); }, timeoutMs);
    bridge.pend.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
    bridge.sock.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
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

function lookYawPitch(px, py, pz, t) {
  const dx = t.x - px, dy = t.y - py, dz = t.z - pz;
  const horiz = Math.hypot(dx, dz);
  const yaw = Math.atan2(dz, dx) * 180 / Math.PI - 90; // MC: yaw 0 = +z
  const pitch = -Math.atan2(dy, horiz) * 180 / Math.PI;
  return { yaw, pitch };
}

async function main() {
  fs.mkdirSync('.qaqh/tmp/reel', { recursive: true });
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    const px = CX + DIST * Math.sin(a), pz = CZ + DIST * Math.cos(a), py = LOOK.y + H;
    const { yaw, pitch } = lookYawPitch(px, py, pz, LOOK);
    await call('camera.on', { x: px, y: py, z: pz, yaw, pitch });
    await new Promise(r => setTimeout(r, 400)); // let a few frames render
    const shot = await call('camera.shot', { downscale: 2 });
    const file = `.qaqh/tmp/reel/orbit-${k}.png`;
    fs.writeFileSync(file, Buffer.from(shot.data_base64, 'base64'));
    console.log(`${file}  (${shot.bytes} bytes)`);
  }
  await call('camera.off', {});
  console.log('reel done');
}

main().then(() => { s.destroy(); process.exit(0); }).catch(e => { console.error('FAIL:', e.message); s.destroy(); process.exit(1); });
