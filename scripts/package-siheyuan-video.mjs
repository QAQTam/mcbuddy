// Package recorded source takes. Inputs are listed explicitly in media-manifest.json.
// node scripts/package-siheyuan-video.mjs [--ffmpeg ABS_PATH] [--speed 20] [--only-director]
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'artifacts/siheyuan-104');
const args=process.argv.slice(2),opt=n=>args.indexOf(n)>=0?args[args.indexOf(n)+1]:undefined;
const ffmpeg=opt('--ffmpeg')??process.env.FFMPEG_PATH??'E:/videos/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe';
const speed=Number(opt('--speed')??20);if(!Number.isFinite(speed)||speed<1)throw Error('invalid speed');
const manifest=JSON.parse(fs.readFileSync(path.join(out,'media-manifest.json'),'utf8'));
const sourceFiles=manifest.construction.map(file=>path.resolve(file));
if(!sourceFiles.length||sourceFiles.some(file=>!fs.existsSync(file)||!fs.statSync(file).size))throw Error('construction takes missing/empty');
const list=path.join(out,'construction-concat.txt');
const escape=p=>p.replaceAll('\\','/').replaceAll("'","'\\''");
fs.writeFileSync(list,sourceFiles.map(p=>`file '${escape(p)}'`).join('\n')+'\n');
async function run(args){await new Promise((resolve,reject)=>{const p=spawn(ffmpeg,['-hide_banner','-nostdin',...args],{stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(`ffmpeg exited ${code}`)));});}
try {
  // Original files are preserved. Refuse to overwrite prior exports.
  const timelapse=path.join(out,`construction-${speed}x.mp4`);
  if(!args.includes('--only-director'))await run(['-itsscale',String(1/speed),'-f','concat','-safe','0','-i',list,'-an','-c:v','libx264','-preset','fast','-crf','20','-r','30','-movflags','+faststart',timelapse]);
  else if(!fs.existsSync(timelapse))throw Error('existing timelapse required for --only-director');
  if(manifest.director){
    const showcase=path.join(out,'siheyuan-director.mp4');
    await run(['-i',path.resolve(manifest.director),'-c','copy','-movflags','+faststart',showcase]);
    manifest.exports={timelapse,showcase};
  } else manifest.exports={timelapse};
  fs.writeFileSync(path.join(out,'media-manifest.json'),JSON.stringify(manifest,null,2));
  console.log(JSON.stringify(manifest.exports));
}catch(e){console.error('FAIL:',e.message);process.exitCode=1;}
