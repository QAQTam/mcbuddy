// Repeatable local workflow. Start OBS first; Minecraft must be in-world.
// node scripts/ptc-siheyuan-workflow.mjs build|tour [--no-record]
// Build is resumable and non-destructive; it never erases the courtyard for another take.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {OBS,startLocalRecord,stopLocalRecord} from './obs-client.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mode=process.argv[2]??'tour',record=!process.argv.includes('--no-record');
const obs=new OBS();let ownsRecording=false;
const out=path.join(root,'artifacts/siheyuan-104');fs.mkdirSync(out,{recursive:true});
const logs=[];
const log=(event,data={})=>{const entry={time:new Date().toISOString(),event,...data};logs.push(entry);console.log(JSON.stringify(entry));};
function run(file,args=[]){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,file),...args],{cwd:root,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`${file} exited ${code}`)));});}
async function waitRecord(active) {for(let n=0;n<40;n++){const r=await obs.call('GetRecordStatus');if(r.outputActive===active)return;await new Promise(r=>setTimeout(r,250));}throw Error('OBS did not reach requested recording state');}
try {
  if(!['build','tour'].includes(mode))throw Error('usage: build|tour [--no-record]');
  await run('scripts/ts/siheyuan.ts',['plan']);
  if(record){await obs.connect();await startLocalRecord(obs);ownsRecording=true;log('record-start');}
  if(mode==='build'){
    // Empty-site surveying is only for the first run; roofs would bias later samples.
    if(!fs.existsSync(path.join(out,'progress.json'))&&!fs.existsSync(path.join(out,'verify.json')))await run('scripts/ts/siheyuan.ts',['survey']);
    else log('resume-existing-build');
    await run('scripts/ts/siheyuan.ts',['build','--director']);
    log('build-verified');
  } else {
    const verify=JSON.parse(fs.readFileSync(path.join(out,'verify.json'),'utf8'));
    if(verify.air||verify.other||verify.blockedDoorways)throw Error('courtyard must pass verification before the final tour');
  }
  await run('scripts/ts/director-siheyuan.ts');
  log('director-complete');
}catch(e){log('FAIL',{message:e.message});process.exitCode=1;}
finally{
  if(ownsRecording){try{const saved=await stopLocalRecord(obs);log('record-saved',saved);}catch(e){log('record-stop-failed',{message:e.message});process.exitCode=1;}}
  obs.close();fs.writeFileSync(path.join(out,`workflow-${mode}-${Date.now()}.json`),JSON.stringify(logs,null,2));
}
