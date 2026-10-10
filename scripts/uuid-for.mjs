// offline uuid (v3, same as vanilla nameUUIDFromBytes("OfflinePlayer:"+name))
import crypto from 'node:crypto';
const name = process.argv[2] ?? 'tsy3m';
const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
h[6] = (h[6] & 0x0f) | 0x30;
h[8] = (h[8] & 0x3f) | 0x80;
const s = h.toString('hex');
console.log(`${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`);
