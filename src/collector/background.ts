import {appearance,preferencePatch,routeKey,chooseSyncTarget} from './preferences';
import {onMessage} from '../utils/messaging';
import {eagleInfo,importEagle} from './eagle';
import { browser } from 'wxt/browser';
import { mergePost, migratePost, Post, Target } from './model';
import { Credentials, Feishu } from './feishu';
let tail:Promise<any>=Promise.resolve();
const serial=<T>(fn:()=>Promise<T>):Promise<T>=>{const next=tail.then(fn,fn);tail=next.catch(()=>{});return next;};
async function posts():Promise<Record<string,Post>>{
 const stored=((await browser.storage.local.get('posts')).posts||{}) as Record<string,Post>;
 const all:Record<string,Post>={};let changed=false;
 for(const [key,post] of Object.entries(stored)){const migrated=migratePost(post);all[key]=migrated;if(migrated!==post)changed=true;}
 if(changed)await browser.storage.local.set({posts:all});
 return all;
}
async function targets():Promise<Target[]>{return ((await browser.storage.local.get('targets')).targets||[]) as Target[];}
async function client(){const c=(await browser.storage.local.get('credentials')).credentials as Credentials;if(!c?.appId||!c?.secret)throw new Error('请先在采集列表的设置中配置飞书应用');return new Feishu(c);}
function validPost(p:any):asserts p is Post{if(!p||!['xhs','dy'].includes(p.platform)||typeof p.id!=='string'||p.key!==`${p.platform}:${p.id}`||!p.fields||!Array.isArray(p.media))throw new Error('作品数据无效');}
export function registerCollector(){
 // Config and credentials must not be readable through storage from content scripts.
 (browser.storage.local as any).setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});
 onMessage('compact',({data:message,sender})=>{
  const {action,data}=message;
  const own=sender.id===browser.runtime.id;
  const trusted=own&&sender.url?.startsWith(browser.runtime.getURL('/'));
  const content=own&&/^https:\/\/www\.(xiaohongshu|douyin)\.com\//.test(sender.url||'');
  const run=async()=>{
   if(!trusted&&!content)throw new Error('来源不受支持');
   if(['getConfig','saveConfig','tables','fields','ensureFields','saveTarget','savePreferences','saveEagleFolder'].includes(action)&&!trusted)throw new Error('此操作仅限扩展设置页');
   switch(action){
    case 'savePost':validPost(data);return serial(async()=>{const all=await posts();all[data.key]=mergePost(all[data.key],data);await browser.storage.local.set({posts:all});return all[data.key];});
    case 'listPosts':if(!trusted)throw new Error('仅限采集列表');return serial(async()=>Object.values(await posts()).sort((a,b)=>Number(b.fields['采集时间'])-Number(a.fields['采集时间'])));
    case 'preferences':{const p:any=(await browser.storage.local.get('defaults')).defaults||{};return {...p,appearance:appearance(p.appearance)};}
    case 'savePreferences':return serial(async()=>{const p:any=(await browser.storage.local.get('defaults')).defaults||{};const patch=preferencePatch(data,await targets());const next={...p,appearance:appearance({...p.appearance,...patch.appearance}),targets:{...p.targets,...patch.targets}};await browser.storage.local.set({defaults:next});return next;});
    case 'saveEagleFolder':return serial(async()=>{const info=await eagleInfo();if(info.libraryId!==data.libraryId||data.folderId&&!info.folders.some(f=>f.id===data.folderId))throw new Error('Eagle资源库或文件夹已变化，请重新连接');const p:any=(await browser.storage.local.get('defaults')).defaults||{};p.eagle={libraryId:info.libraryId,folderId:data.folderId};await browser.storage.local.set({defaults:p});return p;});
    case 'targets':return (await targets()).map(({mapping,...t})=>t);
    case 'eagleInfo':return eagleInfo();
    case 'eagleImport':return serial(async()=>{const p=(await posts())[data.key];if(!p)throw new Error('作品未采集');const result=await importEagle(p,data.folderId,data.library);const defaults:any=(await browser.storage.local.get('defaults')).defaults||{};defaults.eagle={libraryId:data.library,folderId:data.folderId};await browser.storage.local.set({defaults});return result;});
    case 'openOptions':await browser.runtime.openOptionsPage();return true;
    case 'getConfig':{const c=(await browser.storage.local.get('credentials')).credentials as Credentials|undefined;return {appId:c?.appId||'',hasSecret:!!c?.secret,targets:await targets()};}
    case 'saveConfig':{if(!/^cli_[a-zA-Z0-9]+$/.test(data.appId))throw new Error('App ID 格式不正确');const old=(await browser.storage.local.get('credentials')).credentials as Credentials|undefined;const c={appId:data.appId,secret:data.secret||(old?.appId===data.appId?old?.secret:'')};if(!c.secret)throw new Error('请填写 App Secret');await browser.storage.local.set({credentials:c});return true;}
    case 'tables':if(!/^[a-zA-Z0-9]+$/.test(data))throw new Error('多维表格 token 无效');return (await client()).tables(data);
    case 'fields':return (await client()).fields(data);
    case 'ensureFields':return serial(async()=>{if(!data?.base||!data?.table||!['xhs','dy'].includes(data.platform)||!data.mapping)throw new Error('目标表配置无效');return (await client()).ensureFields(data);});
    case 'saveTarget':{if(!data.name||!['xhs','dy'].includes(data.platform)||!data.base||!data.table)throw new Error('请完成目标表配置');return serial(async()=>{const all=await targets();const existing=all.find(t=>t.id===data.id);const typeOf=(target:Target)=>target.contentType||(target.platform==='dy'?'video':undefined);if(data.platform==='xhs'){if(!['video','image'].includes(data.contentType))throw new Error('请选择小红书图文或视频');}else if(data.contentType&&!['video','image'].includes(data.contentType))throw new Error('请选择抖音图文或视频');const incomingType=data.platform==='dy'?(data.contentType||'video'):data.contentType;if(all.some(t=>t.id!==data.id&&t.platform===data.platform&&t.base===data.base&&t.table===data.table&&typeOf(t)!==incomingType))throw new Error(`${data.platform==='dy'?'抖音':'小红书'}图文和视频不能使用同一张数据表`);const t={...data,id:data.id||crypto.randomUUID()};if(data.platform==='dy'&&!data.contentType&&!existing)t.contentType='video';const i=all.findIndex(x=>x.id===t.id);if(i<0)all.push(t);else all[i]=t;await browser.storage.local.set({targets:all});return t;});}
    case 'sync':return serial(async()=>{const all=await posts();const post=all[data.key];const configured=await targets();const selected=configured.find(t=>t.id===data.targetId);if(!post||!selected)throw new Error('作品或目标表不存在');const prefs:any=(await browser.storage.local.get('defaults')).defaults||{};const target=chooseSyncTarget(post,selected,configured,prefs.targets,!!data.useDefault);const result=await (await client()).sync(post,target,{uploadMedia:appearance(prefs.appearance).uploadMedia});const receipts=((await browser.storage.local.get('receipts')).receipts||{}) as Record<string,any>;receipts[post.key+'@'+target.id]={...result,time:Date.now()};const defaults:any=(await browser.storage.local.get('defaults')).defaults||{};defaults.targets={...defaults.targets,[routeKey(target)]:target.id};await browser.storage.local.set({receipts,defaults});return result;});
    case 'snapshot':{if(!content||!sender.tab?.id)throw new Error('仅限平台页面');const r=await browser.scripting.executeScript({target:{tabId:sender.tab.id},world:'MAIN',func:()=>{const s=(window as any).__INITIAL_STATE__;const unwrap=(v:any)=>v?._rawValue||v?._value||v;const notes=unwrap(s?.note?.noteDetailMap);return notes?JSON.parse(JSON.stringify(notes)):null;}});return r[0]?.result;}
    default:throw new Error('未知操作');
   }
  };
  return run().then(data=>({ok:true,data})).catch(e=>({ok:false,error:(e as Error).message}));
 });
}
