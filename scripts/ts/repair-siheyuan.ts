// Targeted residual repair, used after the main builder has finished its placement phase.
// Each new attempt first moves to an actually standable neighbour. No destructive edits.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Bridge,sleep} from './mcbuddy.ts';
import {loadCompound,compile,key} from './compound.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.join(root,'artifacts/siheyuan-104');
const file=path.join(out,'residual.json');
let todo=JSON.parse(fs.readFileSync(file,'utf8'));
const site=JSON.parse(fs.readFileSync(path.join(out,'site.json'),'utf8'));
const wanted=compile(loadCompound(path.join(root,'specs/siheyuan-104.json')),site.groundTopY);
// Include the four corrected lamp foundations explicitly declared by the revised spec.
for(const c of wanted.cells.filter(c=>c.phase==='花池灯座'&&c.y===site.groundTopY+1))if(!todo.some((r:any)=>key(r)===key(c)))todo.push(c);
todo.sort((a:any,b:any)=>a.y-b.y||a.x-b.x||a.z-b.z);
const b=new Bridge();await b.connect(10000);
try {
  for(let pass=1;pass<=8&&todo.length;pass++) {
    const remaining=[];
    for(const c of todo) {
      const col:any=await b.call('world.column',{x:c.x,z:c.z,y0:c.y,y1:c.y});
      if(!col.loaded)throw Error('repair chunk unloaded');
      const got=col.column[0]?.split(' ')[1]?.replace('block.minecraft.','');
      if(got===c.mat)continue;
      if(!['air','short_grass','tall_grass','leaf_litter'].includes(got))throw Error(`repair collision at ${c.x},${c.y},${c.z}: ${got}`);
      const stand:any=await b.call('agent.stand_for',{x:c.x,y:c.y,z:c.z,radius:5});
      let xyz:number[]|undefined;
      if(stand.reachable)xyz=String(stand.stand).match(/-?\d+(?:\.\d+)?/g)?.map(Number);
      // stand_for searches only +/-3 vertical blocks and refuses leaf footing.
      // A canopy corner at Y0+5 remains reachable from adjacent open ground.
      else xyz=[c.x-1.5,site.groundTopY+1,c.z+0.5];
      if(!xyz||xyz.length!==3)throw Error('unexpected stand coordinate');
      const moved:any=await b.call('agent.teleport',{x:xyz[0],y:xyz[1],z:xyz[2]});
      if(!moved.moved){remaining.push(c);continue;}
      await b.call('agent.give',{item:'minecraft:'+c.mat,count:64,slot:0});await sleep(120);
      const result:any=await b.call('agent.place',{x:c.x,y:c.y,z:c.z,bp:'siheyuan-104-repair'});
      if(result.target_after!==c.mat){remaining.push(c);console.log(JSON.stringify({target:c,result}));}
      else console.log(`repaired ${c.x},${c.y},${c.z} ${c.mat}`);
      await sleep(120);
    }
    todo=remaining;fs.writeFileSync(file,JSON.stringify(todo,null,2));console.log(`repair pass ${pass}: residual=${todo.length}`);
  }
  if(todo.length)process.exitCode=1;
}finally {b.close();}
