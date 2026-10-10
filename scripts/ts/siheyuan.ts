// node scripts/ts/siheyuan.ts plan|survey|build|verify|shots [--spec path] [--director]
// No fill/setblock/materialize. Every block is a genuine agent.place operation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bridge, sleep, groundOf, freecamOn, shot } from './mcbuddy.ts';
import { loadCompound,compile,key,type Cell } from './compound.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),mode=args[0]??'plan';
const option=(n:string)=>args.indexOf(n)>=0?args[args.indexOf(n)+1]:undefined;
const file=path.resolve(option('--spec')??path.join(root,'specs/siheyuan-104.json'));
const design=loadCompound(file),s=design.spec;
const out=path.resolve(option('--out')??path.join(root,'artifacts/siheyuan-104'));
fs.mkdirSync(out,{recursive:true});
const siteFile=path.join(out,'site.json');
const trace=fs.createWriteStream(path.join(out,'ptc-trace.ndjson'),{flags:'a'});
const log=(event:string,data:any={})=>{const v={time:new Date().toISOString(),event,...data};trace.write(JSON.stringify(v)+'\n');console.log(JSON.stringify(v));};
const b=new Bridge();
let lastWrite=0,cameraActive=false;
const call=async(method:string,params:any={})=>{
  // Actions are never automatically retried; uncertain outcomes are read back.
  const result=await b.call(method,params,12000);return result;
};
const paced=async(method:string,params:any)=>{await sleep(Math.max(0,120-(Date.now()-lastWrite)));lastWrite=Date.now();return call(method,params);};
async function column(x:number,z:number,y0:number,y1:number,rpc:Bridge=b) {
  const r=await rpc.call('world.column',{x,z,y0,y1},12000);
  if(!r.loaded||!r.column)throw Error(`UNLOADED column ${x},${z}; move the human player near the site`);
  return r.column.map((v:string)=>{const [y,block]=v.split(' ');return {y:Number(y),block:block.replace('block.minecraft.','')};});
}
const air=(m:string)=>['air','cave_air','void_air','short_grass','tall_grass','leaf_litter'].includes(m);
async function healthy() {
  const st=await call('status');
  if(!st.agent?.spawned)throw Error('buddy not spawned: /buddy spawn');
  if(st.pause.server_paused)throw Error('world is paused; resume before running');
  if(mode==='build'&&!st.pause.dev_writes)throw Error('dev_writes must be true for placement positioning');
  if(mode==='build'&&st.agent.gamemode!=='creative')throw Error('buddy must be creative');
  return st;
}
async function ground() {
  if(fs.existsSync(siteFile)) {const r=JSON.parse(fs.readFileSync(siteFile,'utf8'));if(r.x0!==s.site.x0||r.z0!==s.site.z0)throw Error('saved site differs from spec');return r.groundTopY;}
  const st=await call('status');const near=Math.floor(st.agent.pos.y);
  const rows=await column(s.site.x0-2,s.site.z0-2,near-8,near+15);
  const g=groundOf(rows);if(g===null)throw Error('ground not found in 24-row external probe');
  fs.writeFileSync(siteFile,JSON.stringify({...s.site,groundTopY:g,footprint:s.footprint,worldAgent:st.agent.dimension},null,2));return g;
}
async function readAll(cells:{x:number;y:number;z:number}[],g:number) {
  const cols=[...new Map(cells.map(c=>[`${c.x},${c.z}`,{x:c.x,z:c.z}])).values()];
  const blocks=new Map<string,string>();
  // The server serializes messages per TCP socket. Separate perception-only
  // sockets let all three columns share a tick without exceeding 4 requests/tick.
  const readers=[new Bridge(),new Bridge(),new Bridge()];
  await Promise.all(readers.map(r=>r.connect(10000)));
  try {for(let i=0;i<cols.length;i+=3) {
    // Three concurrent perception calls, then a 120ms breather: <=4 requests/tick.
    const group=cols.slice(i,i+3);
    const result=await Promise.all(group.map((c,j)=>column(c.x,c.z,g+1,g+23,readers[j])));
    result.forEach((rows,j)=>rows.forEach((r:any)=>blocks.set(`${group[j].x},${r.y},${group[j].z}`,r.block)));
    if(i%300===0)log('readback',{columns:i,total:cols.length});
    await sleep(120);
  }}finally {readers.forEach(r=>r.close());}
  return blocks;
}
async function verify(plan:ReturnType<typeof compile>,g:number) {
  const actual=await readAll([...plan.cells,...plan.openings],g);
  const missing:Cell[]=[],wrong:any[]=[],blocked:any[]=[];let ok=0;
  for(const c of plan.cells){const a=actual.get(key(c));if(a===c.mat)ok++;else if(a&&air(a))missing.push(c);else wrong.push({...c,got:a??'UNLOADED'});}
  for(const c of plan.openings){const a=actual.get(key(c));if(!a||!air(a))blocked.push({...c,got:a??'UNLOADED'});}
  const report={ok,air:missing.length,other:wrong.length,total:plan.cells.length,blockedDoorways:blocked.length,missing,wrong,blocked};
  fs.writeFileSync(path.join(out,'verify.json'),JSON.stringify(report,null,2));
  console.log(`verify: ok=${ok} air=${missing.length} other=${wrong.length} total=${plan.cells.length} blockedDoorways=${blocked.length}`);
  log('verify',{ok,air:missing.length,other:wrong.length,total:plan.cells.length,blockedDoorways:blocked.length});return report;
}
async function overview(g:number,name:string,side=0) {
  const center={x:s.site.x0+52,y:g+5,z:s.site.z0+52};
  const p=side===1?{x:center.x,y:g+85,z:center.z+10}:side===2?{x:s.site.x0+51.5,y:g+4.2,z:s.site.z0+116}:{x:center.x+65,y:g+55,z:center.z+75};
  const look=side===2?{x:s.site.x0+51.5,y:g+4.5,z:s.site.z0+96}:center;
  await freecamOn(b,p,look);cameraActive=true;await sleep(800);
  const st=await call('status');if(st.pause.client_paused)throw Error('pause menu visible; close it before screenshots');
  await shot(b,path.join(out,name+'.png'),1);log('shot',{file:name+'.png'});
}
async function build(plan:ReturnType<typeof compile>,g:number) {
  const existing=await readAll([...plan.cells,...plan.openings],g);
  const conflicts=plan.cells.filter(c=>{const a=existing.get(key(c));return a!==c.mat&&a&&!air(a);});
  const blocked=plan.openings.filter(c=>!air(existing.get(key(c))??'UNLOADED'));
  if(conflicts.length||blocked.length){fs.writeFileSync(path.join(out,'conflicts.json'),JSON.stringify({conflicts,blocked},null,2));throw Error(`preflight: ${conflicts.length} solid conflicts, ${blocked.length} blocked openings; no blocks changed`);}
  log('preflight-ok',{cells:plan.cells.length,footprint:s.footprint});
  await overview(g,'00-before');
  let mat='',placed=0,skipped=0;const failed:Cell[]=[];
  let previousY=NaN;
  async function select(m:string) {if(mat===m)return;const r=await call('agent.give',{item:'minecraft:'+m,count:64,slot:0});if(!r.given)throw Error(`give failed: ${m}`);mat=m;}
  async function fill(c:Cell) {
    await select(c.mat);
    for(let attempt=0;attempt<4;attempt++) {
      if(attempt>0) {
        // Ask the mod to find an ACTUALLY standable open neighbour, including roofs.
        const p=await call('agent.stand_for',{x:c.x,y:c.y,z:c.z,radius:5});
        if(p.reachable&&p.stand) {
          const xyz=String(p.stand).match(/-?\d+(?:\.\d+)?/g)?.map(Number);
          if(!xyz||xyz.length!==3)throw Error('unexpected stand coordinate: '+p.stand);
          const moved=await call('agent.teleport',{x:xyz[0],y:xyz[1],z:xyz[2]});
          if(!moved.moved)continue;
        } else {
          const offsets=[[0.5,2.5],[2.5,0.5],[0.5,-2.5],[-2.5,0.5]];
          const [dx,dz]=offsets[attempt-1];
          const moved=await call('agent.teleport',{x:c.x+dx,y:c.y,z:c.z+dz});
          if(!moved.moved)continue;
        }
        await sleep(120); // allow pending teleport acknowledgement before use-item packet
      }
      let r:any;
      try{r=await paced('agent.place',{x:c.x,y:c.y,z:c.z,bp:s.name});}
      catch(e){const rows=await column(c.x,c.z,c.y,c.y);if(rows[0]?.block===c.mat)return true;throw e;}
      if(r.placed&&r.target_after===c.mat)return true;
      if(r.target_after===c.mat)return true;
      if(r.reason?.includes('no solid neighbour'))return false;
    }
    return false;
  }
  for(let i=0;i<plan.cells.length;i++) {
    const c=plan.cells[i];
    if(c.y!==previousY) {
      if(!Number.isNaN(previousY)&&args.includes('--director'))await overview(g,`layer-${previousY-g-1}`);
      previousY=c.y;log('layer',{relativeY:c.y-g-1,index:i});
    }
    if(existing.get(key(c))===c.mat){skipped++;continue;}
    if(await fill(c)){placed++;existing.set(key(c),c.mat);}else failed.push(c);
    if(i%100===0){log('progress',{index:i,total:plan.cells.length,placed,skipped,failed:failed.length});fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({index:i,total:plan.cells.length,placed,skipped,failed:failed.length,last:c}));}
    if(failed.length>40&&placed<50)throw Error('early placement failure threshold reached; inspect bridge positioning');
    if(i%500===0)await healthy();
  }
  // A 5x5 crown growing from its center can need four support-frontier passes.
  for(let pass=1;pass<=6&&failed.length;pass++) {
    const todo=failed.splice(0);log('repair-pass',{pass,count:todo.length});
    for(const c of todo)if(await fill(c)){placed++;}else failed.push(c);
  }
  fs.writeFileSync(path.join(out,'residual.json'),JSON.stringify(failed,null,2));
  log('build-end',{placed,skipped,residual:failed.length});
  fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({state:'verifying',index:plan.cells.length,total:plan.cells.length,placed,skipped,failed:failed.length},null,2));
  const v=await verify(plan,g);if(v.air||v.other||v.blockedDoorways)throw Error('verification incomplete; inspect verify.json and rerun build');
  fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({state:'complete',index:plan.cells.length,total:plan.cells.length,placed,skipped,failed:0,verify:{ok:v.ok,air:v.air,other:v.other,blockedDoorways:v.blockedDoorways}},null,2));
  await overview(g,'final-overview');await overview(g,'final-plan',1);await overview(g,'final-gate',2);
}
try {
  if(mode==='plan') {
    const p=compile(design,-61);const byMaterial:any={};for(const c of p.cells)byMaterial[c.mat]=(byMaterial[c.mat]??0)+1;
    fs.writeFileSync(path.join(out,'plan-summary.json'),JSON.stringify({name:s.name,footprint:s.footprint,cells:p.cells.length,doorwayCells:p.openings.length,byMaterial},null,2));
    log('plan',{footprint:s.footprint,cells:p.cells.length,byMaterial});
  } else {
    await b.connect(10000);await healthy();const g=await ground();const plan=compile(design,g);
    log('site',{...s.site,groundTopY:g,cells:plan.cells.length});
    if(mode==='survey') {
      const sample=[];for(let x=0;x<=104;x+=13)for(let z=0;z<=104;z+=13)sample.push({x:s.site.x0+x,y:g,z:s.site.z0+z});
      const tops=[];for(const c of sample){const rows=await column(c.x,c.z,g-1,g+22);tops.push({x:c.x,z:c.z,ground:groundOf(rows)});await sleep(120);}
      fs.writeFileSync(path.join(out,'survey.json'),JSON.stringify(tops,null,2));
      if(tops.some(t=>t.ground!==g))throw Error('site not flat and empty; inspect survey.json');
      await overview(g,'survey');log('survey-ok',{samples:tops.length,ground:g});
    } else if(mode==='build')await build(plan,g);
    else if(mode==='verify'){const v=await verify(plan,g);if(v.air||v.other||v.blockedDoorways)process.exitCode=1;}
    else if(mode==='shots'){await overview(g,'final-overview');await overview(g,'final-plan',1);await overview(g,'final-gate',2);}
    else throw Error('unknown command '+mode);
  }
} catch(e:any){log('FAIL',{message:e.message});process.exitCode=1;}
finally {if(cameraActive)await b.call('camera.off').catch(()=>{});b.close();trace.end();}
