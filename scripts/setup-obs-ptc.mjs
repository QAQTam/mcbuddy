// One-time first-run OBS profile bootstrap; never overwrites existing user configs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=path.join(process.env.APPDATA,'obs-studio');
function create(name,text){const file=path.join(base,name);fs.mkdirSync(path.dirname(file),{recursive:true});if(!fs.existsSync(file))fs.writeFileSync(file,text);}
create('plugin_config/obs-websocket/config.json',JSON.stringify({first_load:false,server_enabled:true,server_port:4455,alerts_enabled:false,auth_required:true,server_password:crypto.randomBytes(24).toString('base64url')},null,2));
create('global.ini','[General]\nFirstRun=false\nPre19Defaults=false\nPre21Defaults=false\nPre23Defaults=false\nPre24.1Defaults=false\n\n[Basic]\nProfile=PTC\nProfileDir=PTC\nSceneCollection=PTC\nSceneCollectionFile=PTC\n\n[BasicWindow]\nPreviewEnabled=true\n');
create('user.ini','[General]\nFirstRun=false\n\n[Basic]\nProfile=PTC\nProfileDir=PTC\nSceneCollection=PTC\nSceneCollectionFile=PTC.json\n');
create('basic/profiles/PTC/basic.ini',`[General]\nName=PTC\n\n[Video]\nBaseCX=1920\nBaseCY=1080\nOutputCX=1920\nOutputCY=1080\nFPSType=0\nFPSCommon=30\n\n[Output]\nMode=Simple\n\n[SimpleOutput]\nFilePath=${path.join(root,'artifacts/siheyuan-104/recordings').replaceAll('\\','/')}\nRecFormat2=mkv\nRecQuality=Small\nRecEncoder=x264\nVBitrate=12000\nABitrate=160\n\n[Audio]\nSampleRate=48000\nChannelSetup=Stereo\n`);
create('basic/scenes/PTC.json',JSON.stringify({name:'PTC',current_scene:'PTC - Siheyuan',current_program_scene:'PTC - Siheyuan',scene_order:[{name:'PTC - Siheyuan'}],sources:[{name:'PTC - Siheyuan',id:'scene',versioned_id:'scene',settings:{items:[]}}]},null,2));
console.log('PTC OBS profile ready; existing configs preserved. WebSocket credentials remain local.');
