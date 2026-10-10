// node scripts/ts/director-siheyuan.ts [--record] [--speed N] [--shot NAME] [--preview]
// wall-clock timed smoothstep moves with shortest-arc yaw; OBS records independently at 30fps.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bridge,lookYawPitch,sleep,shot as capture } from './mcbuddy.ts';
import { OBS,startLocalRecord,stopLocalRecord } from '../obs-client.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);const option=(k:string)=>args.indexOf(k)>=0?args[args.indexOf(k)+1]:undefined;
const out=path.join(root,'artifacts/siheyuan-104');
const site=JSON.parse(fs.readFileSync(path.join(out,'site.json'),'utf8'));
const script=JSON.parse(fs.readFileSync(path.join(root,'specs/siheyuan-director.json'),'utf8'));
const speed=Number(option('--speed')??1);if(!Number.isFinite(speed)||speed<=0)throw Error('--speed must be positive');
const selected=option('--shot');const shots=script.shots.filter((s:any)=>!selected||s.name.includes(selected));
if(!shots.length)throw Error('no matching shots');
const relative=(a:number[])=>({x:site.x0+a[0],y:site.groundTopY+1+a[1],z:site.z0+a[2]});
const mix=(a:number[],b:number[],t:number)=>a.map((v,i)=>v+(b[i]-v)*t);
const ease=(t:number)=>t*t*(3-2*t);
function pose(s:any,t:number) {
  t=ease(t);let p,look;
  if(s.orbit){const o=s.orbit,a=o.angle0+(o.angle1-o.angle0)*t;p=[o.center[0]+Math.cos(a)*o.radius,o.height,o.center[2]+Math.sin(a)*o.radius];look=o.center;}
  else {p=mix(s.from.pos,s.to.pos,t);look=mix(s.from.look,s.to.look,t);}
  const pos=relative(p);return {...pos,...lookYawPitch(pos,relative(look))};
}
const b=new Bridge(),obs=new OBS();let camera=false,recording=false,previousYaw:number|undefined;
const entries:any[]=[];let runStart=Date.now();
const log=(event:string,data:any)=>{const row={time:new Date().toISOString(),elapsedMs:Date.now()-runStart,event,...data};entries.push(row);console.log(JSON.stringify(row));};
async function recordState(want:boolean) {
  for(let i=0;i<40;i++){const r:any=await obs.call('GetRecordStatus');if(r.outputActive===want)return r;await sleep(250);}throw Error('OBS did not reach requested recording state');
}
process.on('SIGINT',()=>{process.exitCode=130;globalThis['ptcInterrupted']=true;});
try {
  await b.connect(10000);const st:any=await b.call('status');if(st.pause.client_paused||st.pause.server_paused)throw Error('close the pause menu before directing');
  await b.call('camera.on',pose(shots[0],0));camera=true;await sleep(1500);
  if(args.includes('--record')){
    await obs.connect();const before:any=await obs.call('GetRecordStatus');if(before.outputActive)throw Error('OBS already recording; stop your current take before starting director --record');
    await startLocalRecord(obs);recording=true;runStart=Date.now();log('record-start',{});
  }
  for(const s of shots) {
    if(globalThis['ptcInterrupted'])break;
    log('shot-start',{name:s.name});let start=Date.now();const duration=args.includes('--preview')?1000:s.seconds*1000/speed;
    await b.call('camera.on',pose(s,0));await sleep(500);start=Date.now();
    let t=0;
    do {
      const cycle=Date.now();t=Math.min(1,(cycle-start)/duration);const p=pose(s,t);
      if(previousYaw!==undefined)p.yaw=previousYaw+(((p.yaw-previousYaw+180)%360+360)%360-180);
      previousYaw=p.yaw;
      await b.call('camera.set',p);
      await sleep(Math.max(0,1000/script.fps-(Date.now()-cycle)));
    }while(t<1&&!globalThis['ptcInterrupted']);
    await capture(b,path.join(out,s.name+'.png'),1);log('shot-end',{name:s.name});
    const live:any=await b.call('status');if(live.pause.client_paused)throw Error('pause menu appeared during take');
  }
}catch(e:any){log('FAIL',{message:e.message});process.exitCode=1;}
finally {
  if(recording){try{const saved:any=await stopLocalRecord(obs);log('record-saved',saved);fs.writeFileSync(path.join(out,'director-recording.json'),JSON.stringify(saved,null,2));}catch(e:any){log('record-stop-failed',{message:e.message});process.exitCode=1;}}
  // Return camera control even after errors, and stop only recordings we started.
  if(camera)await b.call('camera.off').catch(()=>{});b.close();obs.close();
  fs.writeFileSync(path.join(out,'director-timeline.json'),JSON.stringify(entries,null,2));
}
