import fs from 'node:fs';
import path from 'node:path';
import { specToGroups } from './engine.ts';
import type { BuildSpec } from './buildspec.ts';
export interface Cell { x:number;y:number;z:number;mat:string;phase:string }
export const key=(c:{x:number;y:number;z:number})=>`${c.x},${c.y},${c.z}`;
export function loadCompound(file:string) {
  const spec=JSON.parse(fs.readFileSync(file,'utf8'));
  if(spec.version!==1||spec.footprint.fx<100||spec.footprint.fz<100)throw Error('compound requires version 1 and footprint >= 100 x 100');
  if(!Number.isInteger(spec.site.x0)||!Number.isInteger(spec.site.z0))throw Error('site coordinates must be integers');
  const base=path.dirname(path.resolve(file));
  const modules=spec.modules.map((m:any)=>({...m,spec:JSON.parse(fs.readFileSync(path.join(base,m.file),'utf8'))}));
  for(const m of modules) {
    const s=m.spec as BuildSpec; const {fx,fz}=s.footprint;
    if(m.dx-1<0||m.dz-1<0||m.dx+fx>=spec.footprint.fx||m.dz+fz>=spec.footprint.fz)throw Error(`module out of bounds: ${m.name}`);
    const perimeter=(p:any)=>p.dx===0||p.dz===0||p.dx===fx-1||p.dz===fz-1;
    if([...s.pillars,...s.doors,...s.windows].some(p=>!perimeter(p)))throw Error(`non-perimeter detail: ${m.name}`);
    const pp=new Set(s.pillars.map(p=>`${p.dx},${p.dz}`));
    if([...s.doors,...s.windows].some(p=>pp.has(`${p.dx},${p.dz}`)))throw Error(`opening on pillar: ${m.name}`);
    for(const t of s.roofTiers)if(t.y<=s.wallHeight||t.rect.x0>t.rect.x1||t.rect.z0>t.rect.z1)throw Error(`invalid roof: ${m.name}`);
    for(const mat of Object.values(s.materials))if(!(mat in s.slots))throw Error(`missing material slot: ${mat}`);
  }
  for(const f of spec.features) {
    const r=f.box;
    if(!Object.values(r).every(Number.isInteger)||r.x0>r.x1||r.y0>r.y1||r.z0>r.z1)throw Error(`invalid box: ${f.label}`);
    if(r.x0<0||r.z0<0||r.x1>=spec.footprint.fx||r.z1>=spec.footprint.fz||r.y0<0||r.y1>22)throw Error(`feature out of bounds: ${f.label}`);
  }
  return {spec,modules};
}
export function compile(compound:ReturnType<typeof loadCompound>,ground:number) {
  const {spec,modules}=compound; const cells=new Map<string,Cell>(); const openings=new Map<string,{x:number;y:number;z:number}>();
  for(const m of modules) {
    const s={...m.spec,site:{x0:spec.site.x0+m.dx,z0:spec.site.z0+m.dz,groundTopY:ground}} as BuildSpec;
    for(const g of specToGroups(s))for(const c of g.cells)cells.set(key(c),{...c,mat:g.mat,phase:m.label});
    // Require empty doorways in verification as well as solid blocks.
    for(const d of s.doors)for(let y=1;y<=d.height;y++) {
      const c={x:s.site.x0+d.dx,y:ground+1+y,z:s.site.z0+d.dz}; openings.set(key(c),c);
    }
  }
  for(const f of spec.features)for(let y=f.box.y0;y<=f.box.y1;y++)for(let x=f.box.x0;x<=f.box.x1;x++)for(let z=f.box.z0;z<=f.box.z1;z++) {
    const c={x:spec.site.x0+x,y:ground+1+y,z:spec.site.z0+z};
    if(f.mat==='air'){cells.delete(key(c));openings.set(key(c),c);}
    else {cells.set(key(c),{...c,mat:f.mat,phase:f.label});openings.delete(key(c));}
  }
  // Both ends of the gatehouse must stay walk-through.
  for(const c of openings.values())cells.delete(key(c));
  const result=[...cells.values()].sort((a,b)=>a.y-b.y||a.mat.localeCompare(b.mat)||a.x-b.x||a.z-b.z);
  return {cells:result,openings:[...openings.values()]};
}
