// Pure authoring step: no game access. Generates a compound and ordinary BuildSpecs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'specs/siheyuan');
fs.mkdirSync(dir, { recursive: true });
const mats = { foundation:'stone_bricks', wall:'polished_diorite', pillar:'red_terracotta', roof:'deepslate_tiles', ridge:'polished_blackstone' };
const slots = Object.fromEntries(Object.values(mats).map((m,i)=>[m,i]));
const modules:any[] = [];
function hall(name:string,label:string,dx:number,dz:number,fx:number,fz:number,face:string,h=4) {
  const pillars:any[]=[]; const doors:any[]=[]; const windows:any[]=[];
  const longX=fx>=fz;
  for(let x=0;x<fx;x++) for(let z=0;z<fz;z++) {
    if(!(x===0||x===fx-1||z===0||z===fz-1))continue;
    const corner=(x===0||x===fx-1)&&(z===0||z===fz-1);
    const rhythm=longX?(z===0||z===fz-1)&&x%6===0:(x===0||x===fx-1)&&z%6===0;
    if(corner||rhythm)pillars.push({dx:x,dz:z});
  }
  const cx=Math.floor(fx/2),cz=Math.floor(fz/2);
  for(let n=-1;n<=1;n++)doors.push({dx:face==='east'?fx-1:face==='west'?0:cx+n,dz:face==='south'?fz-1:face==='north'?0:cz+n,height:3});
  const doorKeys=new Set(doors.map(d=>`${d.dx},${d.dz}`));
  for(let i=pillars.length-1;i>=0;i--)if(doorKeys.has(`${pillars[i].dx},${pillars[i].dz}`))pillars.splice(i,1);
  const occupied=new Set([...pillars,...doors].map(p=>`${p.dx},${p.dz}`));
  for(let x=0;x<fx;x++)for(let z=0;z<fz;z++) {
    if(!(x===0||x===fx-1||z===0||z===fz-1)||occupied.has(`${x},${z}`))continue;
    const t=longX?x:z;
    if(t%6===2||t%6===3)for(let y=2;y<=3;y++)windows.push({dx:x,dz:z,y});
  }
  const tiers:any[]=[];
  // Full lower ceiling, inward stacked hipped roof and a narrow longitudinal ridge.
  tiers.push({y:h+1,rect:{x0:-1,x1:fx,z0:-1,z1:fz},mat:'roof'});
  for(let inset=1;inset<=3;inset++)tiers.push({y:h+1+inset,rect:{x0:inset,x1:fx-1-inset,z0:inset,z1:fz-1-inset},mat:'roof'});
  tiers.push({y:h+5,rect:longX?{x0:2,x1:fx-3,z0:cz,z1:cz}:{x0:cx,x1:cx,z0:2,z1:fz-3},mat:'ridge'});
  const spec={name,site:{x0:dx,z0:dz,groundTopY:null},footprint:{fx,fz},wallHeight:h,materials:mats,slots,pillars,doors,windows,roofTiers:tiers};
  fs.writeFileSync(path.join(dir,`${name}.json`),JSON.stringify(spec,null,2)+'\n');
  modules.push({name,label,dx,dz,file:`siheyuan/${name}.json`});
}
hall('north-hall','正房 · 明德堂',36,12,31,15,'south',5);
hall('west-wing','西厢 · 书斋',12,34,13,31,'east');
hall('east-wing','东厢 · 客舍',78,34,13,31,'west');
hall('south-west','倒座西房 · 茶室',12,82,25,11,'north');
hall('south-east','倒座东房 · 膳厅',66,82,25,11,'north');
hall('gatehouse','垂花门楼',46,91,11,11,'north');
// Declarative boxes are inclusive relative coordinates; all use player placement.
const features:any[]=[];
const box=(label:string,mat:string,x0:number,x1:number,y0:number,y1:number,z0:number,z1:number)=>features.push({label,mat,box:{x0,x1,y0,y1,z0,z1}});
// 104 x 104 enclosed site, with a centered 11-wide south gateway.
for(const [label,x0,x1,z0,z1] of [['西界',0,0,0,103],['东界',103,103,0,103],['北界',1,102,0,0],['南界西',1,45,103,103],['南界东',57,102,103,103]] as any[]) {
  box(label+'基座','stone_bricks',x0,x1,0,0,z0,z1);
  box(label+'粉墙','polished_diorite',x0,x1,1,3,z0,z1);
  box(label+'瓦帽','deepslate_tiles',x0,x1,4,4,z0,z1);
}
// Gray-stone axial path; gate walk-through is made by an additional rear opening.
box('中轴甬道','stone_bricks',50,52,0,0,27,102);
box('庭院横径','stone_bricks',25,77,0,0,48,50);
box('正房月台','stone_bricks',34,68,0,0,27,29);
box('南院横径','stone_bricks',10,92,0,0,77,79);
box('门楼后门','air',50,52,1,3,101,101);
// Cloister: supported continuous gray eaves, red columns and ground-level paving.
for(const x of [28,73]) {
  box('抄手游廊地坪','stone_bricks',x,x+2,0,0,29,76);
  for(let z=29;z<=76;z+=6)box('游廊朱柱','red_terracotta',x+1,x+1,1,4,z,z);
  box('游廊连枋','stripped_dark_oak_log',x+1,x+1,4,4,29,76);
  box('游廊檐顶','deepslate_tiles',x,x+2,5,5,29,76);
  box('游廊脊线','polished_blackstone',x+1,x+1,6,6,29,76);
}
// Screen wall, with a golden medallion facing the entrance.
box('影壁台','stone_bricks',44,58,0,0,85,86);
box('影壁朱边','red_terracotta',45,57,1,4,85,85);
box('影壁粉心','polished_diorite',46,56,2,3,86,86);
box('影壁金纹','gold_block',50,52,2,3,87,87);
box('影壁瓦檐','deepslate_tiles',44,58,5,5,84,87);
box('影壁脊','polished_blackstone',45,57,6,6,85,86);
// Four symmetric planted courts: bordered squares and handcrafted cherry trees.
for(const [cx,cz] of [[40,39],[62,39],[40,62],[62,62]]) {
  for(const [x0,x1,z0,z1] of [[cx-4,cx+4,cz-4,cz-4],[cx-4,cx+4,cz+4,cz+4],[cx-4,cx-4,cz-3,cz+3],[cx+4,cx+4,cz-3,cz+3]])box('花池边石','stone_bricks',x0,x1,0,0,z0,z1);
  box('海棠树干','cherry_log',cx,cx,0,4,cz,cz);
  box('海棠低冠','cherry_leaves',cx-2,cx+2,5,5,cz-2,cz+2);
  box('海棠高冠','cherry_leaves',cx-1,cx+1,6,6,cz-1,cz+1);
  box('花池灯座','stone_bricks',cx-3,cx-3,0,1,cz-3,cz-3);
  box('花池宫灯','glowstone',cx-3,cx-3,2,2,cz-3,cz-3);
}
// Furnishing with solid/support-safe blocks, not unsupported props.
box('书斋书架','bookshelf',13,13,1,2,37,45);
box('书斋案几','stripped_dark_oak_log',17,20,1,1,40,40);
box('客舍卧榻','red_terracotta',84,87,1,1,38,41);
box('客舍屏风','stripped_dark_oak_log',84,84,1,3,45,49);
box('茶室长案','stripped_dark_oak_log',18,29,1,1,86,86);
box('膳厅长案','stripped_dark_oak_log',73,84,1,1,86,86);
box('正堂主位','red_terracotta',47,55,1,1,16,17);
box('正堂匾额','stripped_dark_oak_log',47,55,4,4,26,26);
for(const [x,z] of [[47,26],[55,26],[24,49],[78,49],[46,92],[56,92]]) {
  box('立灯柱','red_terracotta',x,x,1,3,z,z);
  box('宫灯','glowstone',x,x,4,4,z,z);
}
const compound={version:1,name:'siheyuan-104',label:'海棠四合院',site:{x0:-52,z0:40,groundTopY:null},footprint:{fx:104,fz:104},modules,features};
fs.writeFileSync(path.join(root,'specs/siheyuan-104.json'),JSON.stringify(compound,null,2)+'\n');
console.log(`Wrote ${modules.length} BuildSpecs and ${features.length} declarative features.`);
