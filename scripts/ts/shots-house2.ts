// shots-house2.ts — retake the two QA freecam shots
import fs from 'node:fs';
import { Bridge, freecamOn, freecamOff, shot, sleep } from './mcbuddy.ts';

const b = new Bridge();
await b.connect(10_000);
fs.mkdirSync('.qaqh/tmp', { recursive: true });
const look = { x: 14 + 19 / 2, y: -60 + 1, z: -14 + 20 / 2 };
await freecamOn(b, { x: look.x + 30, y: -60 + 14, z: look.z + 30 }, look);
await sleep(500);
await shot(b, '.qaqh/tmp/house2-far.png', 2);
await freecamOn(b, { x: look.x, y: -60 + 3, z: look.z + 18 }, look);
await sleep(500);
await shot(b, '.qaqh/tmp/house2-close.png', 2);
await freecamOff(b);
console.log('QA shots saved: .qaqh/tmp/house2-far.png / house2-close.png');
process.exit(0);
