// Minimal OBS WebSocket v5 CLI. Password is read locally, never printed.
// node scripts/obs-client.mjs status|setup|start|stop|call <RequestType> [JSON]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const configFile=path.join(process.env.APPDATA,'obs-studio/plugin_config/obs-websocket/config.json');
export class OBS {
  ws=null;pending=new Map();id=1;
  async connect() {
    const cfg=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8')):{};
    const password=process.env.OBS_PASSWORD??cfg.server_password??'';
    const hash=s=>crypto.createHash('sha256').update(s).digest('base64');
    await new Promise((resolve,reject)=>{
      const ws=new WebSocket(process.env.OBS_URL??`ws://127.0.0.1:${cfg.server_port??4455}`);this.ws=ws;
      const timer=setTimeout(()=>{ws.close();reject(Error('OBS handshake timeout'));},10000);
      ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('OBS unavailable; launch OBS with WebSocket enabled'));});
      ws.addEventListener('message',({data})=>{
        const m=JSON.parse(String(data));
        if(m.op===0) {const d={rpcVersion:1,eventSubscriptions:0};if(m.d.authentication)d.authentication=hash(hash(password+m.d.authentication.salt)+m.d.authentication.challenge);ws.send(JSON.stringify({op:1,d}));}
        else if(m.op===2){clearTimeout(timer);resolve();}
        else if(m.op===7){const p=this.pending.get(m.d.requestId);if(p){clearTimeout(p.timer);this.pending.delete(m.d.requestId);m.d.requestStatus.result?p.resolve(m.d.responseData??{}):p.reject(Error(`${m.d.requestType}: ${m.d.requestStatus.comment??m.d.requestStatus.code}`));}}
      });
      ws.addEventListener('close',()=>{clearTimeout(timer);reject(Error('OBS connection closed'));for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('OBS connection closed'));}this.pending.clear();});
    });
  }
  call(requestType,requestData={}) {
    const requestId=String(this.id++);
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(requestId);reject(Error(`OBS ${requestType} timeout`));},15000);this.pending.set(requestId,{resolve,reject,timer});this.ws.send(JSON.stringify({op:6,d:{requestType,requestId,requestData}}));});
  }
  close(){this.ws?.close();}
}
export async function waitRecord(obs,active){for(let i=0;i<100;i++){const state=await obs.call('GetRecordStatus');if(state.outputActive===active)return state;await new Promise(r=>setTimeout(r,100));}throw Error('OBS recording state did not change');}
export async function startLocalRecord(obs) {
  const before=await obs.call('GetRecordStatus');if(before.outputActive)throw Error('OBS already recording; not taking ownership of an existing take');
  await obs.call('StartRecord');
  for(let i=0;i<20;i++){const r=await obs.call('GetRecordStatus');if(r.outputActive){const o=await obs.call('GetOutputSettings',{outputName:'simple_file_output'});return {...r,outputPath:o.outputSettings.path};}await new Promise(r=>setTimeout(r,100));}
  // Some first-run/hidden-window OBS sessions suppress frontend StartRecord.
  // Use the already initialized record output, with a NEW filename, never the previous take.
  const outputName='simple_file_output';const {outputSettings}=await obs.call('GetOutputSettings',{outputName});
  if(!outputSettings.path)throw Error('OBS recording output is not initialized; make an initial recording in OBS first');
  const {recordDirectory}=await obs.call('GetRecordDirectory');
  const outputPath=path.join(recordDirectory,`PTC-${new Date().toISOString().replaceAll(':','-')}-${crypto.randomBytes(3).toString('hex')}.mkv`);
  await obs.call('SetOutputSettings',{outputName,outputSettings:{...outputSettings,path:outputPath}});
  await obs.call('StartOutput',{outputName});return {...await waitRecord(obs,true),outputPath};
}
export async function stopLocalRecord(obs) {
  // The frontend's last-filename cache can lag when output-level start was used.
  const {outputSettings}=await obs.call('GetOutputSettings',{outputName:'simple_file_output'});
  await obs.call('StopRecord');await waitRecord(obs,false);
  return {outputPath:outputSettings.path};
}
async function setup(obs) {
  const sceneName='PTC - Siheyuan';
  const scenes=await obs.call('GetSceneList');if(!scenes.scenes.some(s=>s.sceneName===sceneName))await obs.call('CreateScene',{sceneName});
  const kinds=await obs.call('GetInputKindList');
  const inputKind=kinds.inputKinds.find(x=>x.startsWith('monitor_capture'));if(!inputKind)throw Error('OBS display capture unavailable');
  const inputName='PTC - Fullscreen';
  const inputs=await obs.call('GetInputList');
  if(!inputs.inputs.some(s=>s.inputName===inputName))await obs.call('CreateInput',{sceneName,inputName,inputKind,inputSettings:{monitor:0,capture_cursor:false},sceneItemEnabled:true});
  // Get monitor properties from OBS itself rather than guessing display identifiers.
  const defaults=await obs.call('GetInputSettings',{inputName});
  let properties,propertyName='monitor_id';try{properties=await obs.call('GetInputPropertiesListPropertyItems',{inputName,propertyName});}catch{propertyName='monitor';properties=await obs.call('GetInputPropertiesListPropertyItems',{inputName,propertyName});}
  const primary=properties.propertyItems.find(p=>p.itemEnabled&&String(p.itemName).includes('1920x1080'))??properties.propertyItems.find(p=>p.itemEnabled);
  if(primary)await obs.call('SetInputSettings',{inputName,inputSettings:{[propertyName]:primary.itemValue,capture_cursor:false},overlay:true});
  const video=await obs.call('GetVideoSettings');
  const item=await obs.call('GetSceneItemId',{sceneName,sourceName:inputName});
  await obs.call('SetSceneItemTransform',{sceneName,sceneItemId:item.sceneItemId,sceneItemTransform:{positionX:0,positionY:0,boundsType:'OBS_BOUNDS_SCALE_INNER',boundsWidth:video.baseWidth,boundsHeight:video.baseHeight}});
  await obs.call('SetCurrentProgramScene',{sceneName});
  // A WGC capture of the fullscreen game excludes desktop automation cursor halos.
  // Keep the requested monitor capture behind it as a separate available source.
  if(kinds.inputKinds.includes('window_capture')) {
    const clean='PTC - Minecraft clean';const list=await obs.call('GetInputList');
    if(!list.inputs.some(x=>x.inputName===clean))await obs.call('CreateInput',{sceneName,inputName:clean,inputKind:'window_capture',inputSettings:{cursor:false},sceneItemEnabled:false});
    const choices=await obs.call('GetInputPropertiesListPropertyItems',{inputName:clean,propertyName:'window'});
    const game=choices.propertyItems.find(x=>x.itemEnabled&&String(x.itemName).includes('Minecraft'));
    if(game){
      await obs.call('SetInputSettings',{inputName:clean,inputSettings:{window:game.itemValue,method:2,cursor:false,client_area:true},overlay:true});
      const cleanItem=await obs.call('GetSceneItemId',{sceneName,sourceName:clean});
      await obs.call('SetSceneItemTransform',{sceneName,sceneItemId:cleanItem.sceneItemId,sceneItemTransform:{positionX:0,positionY:0,boundsType:'OBS_BOUNDS_SCALE_INNER',boundsWidth:video.baseWidth,boundsHeight:video.baseHeight}});
      await obs.call('SetSceneItemEnabled',{sceneName,sceneItemId:cleanItem.sceneItemId,sceneItemEnabled:true});
    }
  }
  const folder=path.join(root,'artifacts/siheyuan-104/recordings');fs.mkdirSync(folder,{recursive:true});
  if(!(await obs.call('GetRecordStatus')).outputActive)await obs.call('SetRecordDirectory',{recordDirectory:folder});
  console.log(JSON.stringify({sceneName,inputKind,monitor:primary?.itemName,video,recordDirectory:folder}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const obs=new OBS();try{
    await obs.connect();const cmd=process.argv[2]??'status';
    if(cmd==='setup')await setup(obs);
    else if(cmd==='status')console.log(JSON.stringify({version:await obs.call('GetVersion'),record:await obs.call('GetRecordStatus')}));
    else if(cmd==='start')console.log(JSON.stringify(await startLocalRecord(obs)));
    else if(cmd==='stop')console.log(JSON.stringify(await stopLocalRecord(obs)));
    else if(cmd==='call')console.log(JSON.stringify(await obs.call(process.argv[3],JSON.parse(process.argv[4]??'{}'))));
    else throw Error('unknown command '+cmd);
  }catch(e){console.error('FAIL:',e.message);process.exitCode=1;}finally{obs.close();}
}
