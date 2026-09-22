import {ServiceLogo} from './ServiceLogo';
import {appearance,defaultAppearance} from './preferences';
import {browser} from 'wxt/browser';
import React,{useEffect,useRef,useState} from 'react';
import {createRoot,Root} from 'react-dom/client';
import { Platform,Target,assertSamePost,normalize,postType } from './model';
import {Context,collect,context,authorPosts,mixPosts} from './platform';
import {awemeDetail} from '../entrypoints/dy.content/api/aweme';
import {rpc} from './rpc';
import {css} from './style';
import {sendMessage} from '../utils/messaging';
import {detectImageExtension} from '../utils/image-format';
import {decodeImageDownloadBytes,imageDownloadFolderName,imageDownloadOutputFilename,validateImageUrl,type ImageDownloadFile} from '../utils/image-download';
import {currentImageIndex} from './current-image';

type DirectoryPickerWindow = Window & {
 showDirectoryPicker?: (options?: {mode:'readwrite'})=>Promise<FileSystemDirectoryHandle>;
};
type ImageState = 'pending'|'saving'|'success'|'failed';
type PanelKind = 'sync'|'batch'|'eagle'|'download'|'mix'|null;

// Panel, message and busy state must survive toolbar remounts: Douyin note
// pages keep replacing the player container node, which remounts this
// component mid-operation and would otherwise silently swallow the result or
// error message. State lives at module scope and is mirrored into React on
// every remount via useFeedback.
const feedback:{panel:PanelKind;message:string;busy:boolean;listeners:Set<()=>void>}={panel:null,message:'',busy:false,listeners:new Set()};
function setFeedback(patch:{panel?:PanelKind;message?:string;busy?:boolean}){Object.assign(feedback,patch);for(const l of[...feedback.listeners])l();}
function useFeedback(){const [snap,setSnap]=useState({panel:feedback.panel,message:feedback.message,busy:feedback.busy});useEffect(()=>{const listen=()=>setSnap({panel:feedback.panel,message:feedback.message,busy:feedback.busy});listen();feedback.listeners.add(listen);return()=>{feedback.listeners.delete(listen);};},[]);return snap;}
// Safe storage.onChanged access for content scripts: after the extension is
// reloaded, old pages keep running with an invalidated context where
// browser.storage is undefined. Degrade to a no-op instead of throwing.
function listenStorageChanged(fn:(changes:any,area:string)=>void):()=>void{
 try{browser.storage?.onChanged?.addListener(fn);}catch{console.info('[简采] 扩展已更新，本页提示功能停用；刷新页面后恢复');}
 return()=>{try{browser.storage?.onChanged?.removeListener(fn);}catch{}};
}

async function uniqueImageFolder(parent:FileSystemDirectoryHandle,base:string):Promise<FileSystemDirectoryHandle>{
 for(let suffix=1;suffix<=10000;suffix++){
  const name=suffix===1?base:`${base} (${suffix})`;
  try{
   const candidate=await parent.getDirectoryHandle(name);
   let occupied=false;for await(const _entry of candidate.values()){occupied=true;break;}
   if(!occupied)return candidate;
  }catch(e){
   if(e instanceof DOMException&&e.name==='NotFoundError')return parent.getDirectoryHandle(name,{create:true});
   if(e instanceof DOMException&&e.name==='TypeMismatchError')continue;
   throw e;
  }
 }
 throw new Error('无法创建唯一作品文件夹，请更换父目录后重试');
}

async function fetchImageBytes(file:ImageDownloadFile,platform:Platform,signal:AbortSignal):Promise<{blob:Blob;extension:string}>{
 const result=await sendMessage('fetchImageDownload',{url:validateImageUrl(file.url,platform),platform});
 if(signal.aborted)throw new Error('页面已切换，已停止后续保存');
 validateImageUrl(result.finalUrl,platform);
 const bytes=decodeImageDownloadBytes(result.base64);
 const blob=new Blob([bytes.buffer as ArrayBuffer]);
 const response={headers:{get:(name:string)=>name.toLowerCase()==='content-type'?result.contentType||null:null}};
 return {blob,extension:await detectImageExtension(response,blob)};
}

async function writeImageFile(folder:FileSystemDirectoryHandle,name:string,blob:Blob):Promise<void>{
 try{await folder.getFileHandle(name);throw new Error('同名文件已存在，未覆盖');}
 catch(e){if(!(e instanceof DOMException&&e.name==='NotFoundError'))throw e;}
 const file=await folder.getFileHandle(name,{create:true});let writable:FileSystemWritableFileStream|undefined;
 try{writable=await file.createWritable();await writable.write(blob);await writable.close();}
 catch(e){try{await writable?.abort();}catch{}try{await folder.removeEntry(name);}catch{}throw e;}
}

function Toolbar({c}:{c:Context}){
 const fb=useFeedback();const panel=fb.panel,message=fb.message,busy=fb.busy;
 const setPanel=(p:PanelKind)=>setFeedback({panel:p}),setMessage=(m:string)=>setFeedback({message:m}),setBusy=(b:boolean)=>setFeedback({busy:b}); const [targets,setTargets]=useState<Target[]>([]),[target,setTarget]=useState(''),[mode,setMode]=useState('limit'),[limit,setLimit]=useState(20),[destination,setDestination]=useState('local');
 const [imageTask,setImageTask]=useState<{folderName:string;files:ImageDownloadFile[]}>();
 const [fullImageTask,setFullImageTask]=useState<{folderName:string;files:ImageDownloadFile[]}>();
 const [imageChoice,setImageChoice]=useState<'all'|'current'>();
 const [currentIndex,setCurrentIndex]=useState<number>();
 const [imageStates,setImageStates]=useState<ImageState[]>([]),[imageErrors,setImageErrors]=useState<Array<string|undefined>>([]),[imageOutputNames,setImageOutputNames]=useState<Array<string|undefined>>([]);
 const imageFolder=useRef<FileSystemDirectoryHandle>();
 const imageAbort=useRef<AbortController>();
 const pickerWindow=window as DirectoryPickerWindow;
 const [targetPicked,setTargetPicked]=useState(false);
 const [features,setFeatures]=useState(defaultAppearance);
 const [mixInfo,setMixInfo]=useState<any>(),[mixProgress,setMixProgress]=useState('');
 const [eagle,setEagle]=useState<any>(),[folder,setFolder]=useState('');
 const stop=useRef<AbortController>();
 const active=useRef(true);
 const currentPost=async()=>{assertSamePost(c,context(c.platform));const post=await collect(c);if(!active.current)throw new Error('页面已切换，已取消上一条作品的操作');assertSamePost(c,context(c.platform));return post;};
 useEffect(()=>{const changed=(changes:any,area:string)=>{if(area==='local'&&changes.defaults)setFeatures(appearance(changes.defaults.newValue?.appearance));};
  // Extension reloads invalidate old content-script contexts where
  // browser.storage becomes undefined; never let that throw here.
  const unlisten=listenStorageChanged(changed);
  rpc<any>('preferences').then(async pref=>{setFeatures(appearance(pref.appearance));const list=await rpc<Target[]>('targets');const same=list.filter(t=>t.platform===c.platform);setTargets(same);setTarget(same.find(t=>t.id===(pref.targets?.[c.platform]||pref.targets?.[c.platform+':video']||pref.targets?.[c.platform+':image']))?.id||'');if(pref.eagle&&appearance(pref.appearance).eagle){const info=await rpc('eagleInfo');if(info.libraryId===pref.eagle.libraryId){setEagle(info);setFolder(pref.eagle.folderId);}}}).catch(()=>{});
  return ()=>{unlisten();active.current=false;stop.current?.abort();imageAbort.current?.abort();};},[]);
 const execute=async(fn:()=>Promise<void>,errorPanel:'sync'|'download'='sync')=>{if(busy)return;setBusy(true);setMessage('正在处理…');try{await fn();}catch(e){setPanel(panel||errorPanel);setMessage((e as Error).message);}finally{setBusy(false);}};
 const open=async(kind:'sync'|'batch'|'eagle'|'mix')=>{setPanel(kind);setMessage('');try{if(kind==='eagle'){setEagle(await rpc('eagleInfo'));return;}if(kind==='mix'){if(c.platform!=='dy')throw new Error('合集采集仅支持抖音');const detail=(await awemeDetail(c.id)).aweme_detail;assertSamePost(c,context(c.platform));if(!detail?.mix_info?.mix_id)throw new Error('当前作品没有可读取的合集');setMixInfo(detail.mix_info);}const list=await rpc<Target[]>('targets');const same=list.filter(t=>t.platform===c.platform);setTargets(same);setTarget(target&&same.some(t=>t.id===target)?target:same[0]?.id||'');}catch(e){setMessage((e as Error).message);}};
 const sync=async()=>{setPanel('sync');if(!target)throw new Error('请先选择或配置目标表');const p=await currentPost();await rpc('savePost',p);const r=await rpc('sync',{key:p.key,targetId:target,useDefault:!targetPicked});setMessage(`信息已${r.updated?'更新':'保存'}并回读验证\n${r.warnings.length?'部分素材未新增：\n'+r.warnings.join('\n'):'素材处理完成'}`);};
 const batch=async()=>{if(destination==='feishu'&&!target)throw new Error('请先配置目标表');if(mode==='limit'&&(!Number.isInteger(limit)||limit<1))throw new Error('请输入正整数数量');stop.current=new AbortController();let success=0,failed=0,partial=0;const errors:string[]=[];
  try{for await(const p of authorPosts(c,mode,limit,stop.current.signal)){
   if(stop.current.signal.aborted)break;
   try{const post=await collect(p);if(stop.current.signal.aborted)break;await rpc('savePost',post);success++;if(destination==='feishu'){const result=await rpc('sync',{key:post.key,targetId:target,useDefault:!targetPicked});if(result.warnings.length){partial++;errors.push(`${p.id}：${result.warnings.join('；')}`);}}}
   catch(e){failed++;errors.push(`${p.id}：${(e as Error).message}`);if(/登录|验证|频繁|风控|captcha|游标/i.test((e as Error).message))throw e;}
   setMessage(`已存本地 ${success} 条；失败 ${failed} 条；部分素材 ${partial} 条\n${errors.slice(-5).join('\n')}`);
   await new Promise(r=>setTimeout(r,1200));
  }}catch(e){errors.push('采集终止：'+(e as Error).message);}finally{setMessage(`${stop.current.signal.aborted?'已停止':'本轮结束'}：本地 ${success} 条，失败 ${failed} 条，部分素材 ${partial} 条。\n${mode==='loaded'?'仅处理当前已加载作品。\n':''}${errors.join('\n')}`);}
 };
 const importToEagle=async()=>{setPanel('eagle');if(!eagle)throw new Error('请先连接 Eagle');const p=await currentPost();await rpc('savePost',p);const result=await rpc('eagleImport',{key:p.key,folderId:folder,library:eagle.libraryId});setMessage(`Eagle 已确认 ${result.items.length} 个素材（已有 ${result.items.filter((x:any)=>x.reused).length} 个）`);};
 const mixSync=async()=>{if(c.platform!=='dy')throw new Error('合集采集仅支持抖音');if(!mixInfo?.mix_id)throw new Error('没有取得合集信息');if(!target)throw new Error('请先选择抖音视频目标表');const controller=new AbortController();stop.current=controller;let success=0,failed=0,partial=0;const errors:string[]=[];try{for await(const raw of mixPosts(String(mixInfo.mix_id),controller.signal)){if(controller.signal.aborted)break;assertSamePost(c,context(c.platform));const id=String(raw.aweme_id);const href=raw.share_url||`https://www.douyin.com/video/${id}`;try{let post=normalize('dy',raw,href,raw.author);if(!post.media.some(m=>m.field==='视频文件'||m.field==='视频图片'))post=await collect({platform:'dy',id,href,kind:'post'},raw.author);if(controller.signal.aborted)break;await rpc('savePost',post);const result=await rpc('sync',{key:post.key,targetId:target,useDefault:false});success++;if(result.warnings.length){partial++;errors.push(`${id}：${result.warnings.join('；')}`);}}catch(e){failed++;errors.push(`${id}：${(e as Error).message}`);if(/登录|验证|频繁|风控|captcha|游标/i.test((e as Error).message))throw e;}const progress=`已处理 ${success+failed} 条：成功 ${success}，失败 ${failed}，部分素材 ${partial}`;setMixProgress(progress);setMessage(`${progress}\n${errors.slice(-3).join('\n')}`);await new Promise(r=>setTimeout(r,800));}}catch(e){errors.push('采集终止：'+(e as Error).message);}finally{setMixProgress('');setMessage(`${controller.signal.aborted?'已停止':'合集采集结束'}：成功 ${success} 条，失败 ${failed} 条，部分素材 ${partial} 条。${errors.length?'\n'+errors.join('\n'):''}`);}};
 const chooseImageTask=(choice:'all'|'current')=>{if(!fullImageTask)return;const files=choice==='current'&&currentIndex!==undefined?[fullImageTask.files[currentIndex]]:fullImageTask.files;imageAbort.current?.abort();imageFolder.current=undefined;const next={folderName:fullImageTask.folderName,files};setImageTask(next);setImageChoice(choice);setImageStates(next.files.map(()=>'pending'));setImageErrors(next.files.map(()=>undefined));setImageOutputNames(next.files.map(()=>undefined));setMessage(choice==='current'&&currentIndex!==undefined?`已选择第 ${currentIndex+1} 张图片，请点击“选择文件夹并保存”开始下载`:`已选择全部 ${next.files.length} 张图片，请点击“选择文件夹并保存”开始下载`);};
 const download=async()=>{const p=await currentPost();const files=p.media.filter(m=>!m.field.includes('封面')&&!m.field.includes('音频'));if(!files.length)throw new Error('未取得可下载媒体');if(postType(p)==='image'){const next={folderName:imageDownloadFolderName(p.id,p.fields['笔记标题']||p.fields['视频描述']),files:files.map((m,index)=>({url:m.url,filename:m.name,sourceIndex:index}))};let visible:number|undefined;try{visible=currentImageIndex(c.platform,files.map(file=>file.url));}catch(e){console.info('[简采] 当前图片识别失败',(e as Error).message);}imageAbort.current?.abort();imageFolder.current=undefined;setFullImageTask(next);setImageTask(undefined);setImageChoice(undefined);setCurrentIndex(visible);setImageStates([]);setImageErrors([]);setImageOutputNames([]);setPanel('download');setMessage(visible===undefined?`已取得 ${next.files.length} 张图片；当前图片暂未识别，可选择下载全部图片`:`已取得 ${next.files.length} 张图片，当前显示第 ${visible+1} 张`);return;}for(const m of files)await sendMessage('download',{url:m.url,filename:`简采/${m.name}`});setPanel('sync');setMessage(`已提交 ${files.length} 个下载任务，请在 Chrome 下载列表查看完成状态`);};
 const saveImages=async()=>{if(!imageTask)return;if(!pickerWindow.showDirectoryPicker)throw new Error('当前 Chrome 不支持直接选择本地目录，请升级 Chrome；未开始保存');const controller=new AbortController();imageAbort.current=controller;try{const parentPromise=imageFolder.current?Promise.resolve(imageFolder.current):pickerWindow.showDirectoryPicker({mode:'readwrite'});const parent=await parentPromise;if(controller.signal.aborted)return;const folder=imageFolder.current||await uniqueImageFolder(parent,imageTask.folderName);imageFolder.current=folder;const states=[...imageStates],errors=[...imageErrors],outputNames=[...imageOutputNames];for(const index of imageTask.files.map((_,i)=>i).filter(i=>states[i]!=='success')){if(controller.signal.aborted){setMessage(`已停止；已保存 ${states.filter(x=>x==='success').length}/${imageTask.files.length} 张，已写入文件保留`);return;}states[index]='saving';errors[index]=undefined;setImageStates([...states]);setImageErrors([...errors]);setMessage(`正在保存 ${index+1}/${imageTask.files.length}…`);try{const fetched=await fetchImageBytes(imageTask.files[index],c.platform,controller.signal);if(controller.signal.aborted)throw new Error('页面已切换，已停止后续保存');const name=imageDownloadOutputFilename(imageTask.files[index].sourceIndex??index,fetched.extension);await writeImageFile(folder,name,fetched.blob);outputNames[index]=name;states[index]='success';}catch(e){states[index]='failed';errors[index]=e instanceof Error?e.message:String(e);}setImageStates([...states]);setImageErrors([...errors]);setImageOutputNames([...outputNames]);}const failed=states.filter(x=>x==='failed').length,saved=states.filter(x=>x==='success').length;if(failed)setMessage(`已保存 ${saved}/${imageTask.files.length} 张；${failed} 张失败，可点击“重试失败项”，不会覆盖已存在文件。`);else setMessage(`已按顺序保存 ${saved} 张图片到「${imageTask.folderName}」`);}catch(e){if(e instanceof DOMException&&e.name==='AbortError')setMessage('已取消选择目录，尚未开始保存');else throw e;}finally{if(imageAbort.current===controller)imageAbort.current=undefined;}};
 const more=async(kind:string)=>{const p=await currentPost();if(kind==='copy'){await navigator.clipboard.writeText(Object.entries(p.fields).map(([k,v])=>`${k}：${Array.isArray(v)?v.join('、'):v}`).join('\n'));setPanel('sync');setMessage('已复制作品信息');return;}if(kind==='post-comment'){await sendMessage('openTaskDialog',{name:kind,post:{postId:c.id,commentCount:Number(p.fields['评论量']||0),title:p.fields['笔记标题']||p.fields['视频描述'],url:c.href}});}else {const {awemeDetail}=await import('../entrypoints/dy.content/api/aweme');const a=(await awemeDetail(c.id)).aweme_detail;assertSamePost(c,context(c.platform));if(!active.current)throw new Error('页面已切换');if(!a?.mix_info?.mix_id)throw new Error('当前视频没有可读取的合集');await sendMessage('openTaskDialog',{name:'mix-post',mixInfo:a.mix_info});}};
 return <><div className="bar" aria-label="简采工具栏" data-build="20260923.03">{c.kind==='post'?<>{features.download&&<button disabled={busy} onClick={()=>execute(download,'download')}>↓ 下载</button>}{features.feishu&&<button disabled={busy} onClick={()=>target?execute(sync):open('sync')}><ServiceLogo name="feishu" tone="white"/>飞书</button>}{features.eagle&&<button disabled={busy} onClick={()=>eagle?execute(importToEagle):open('eagle')}><ServiceLogo name="eagle" tone="white"/>Eagle</button>}{features.more&&<details><summary>更多 ···</summary><div className="menu"><button onClick={()=>open('sync')}>选择飞书目标表</button><button onClick={()=>open('eagle')}>选择 Eagle 文件夹</button><button onClick={()=>execute(()=>more('copy'))}>复制信息</button><button onClick={()=>execute(()=>more('post-comment'))}>导出评论</button>{c.platform==='dy'&&<><button onClick={()=>execute(()=>open('mix'))}>采集合集到飞书</button><button onClick={()=>execute(()=>more('mix-post'))}>导出合集 Excel</button></>}<button onClick={()=>rpc('openOptions')}>采集列表 / 设置</button></div></details>}</>:<><button disabled={busy} onClick={()=>open('batch')}>＋ 采集主页作品</button><button onClick={()=>rpc('openOptions')}>采集列表</button></>}</div>
 {panel&&<section className="panel" aria-label="简采面板"><button className="close" disabled={busy} onClick={()=>setPanel(null)}>关闭</button><h3>{panel==='batch'?'采集主页作品':panel==='mix'?'采集合集到飞书':panel==='eagle'?'导入 Eagle':panel==='download'?'下载图文':'保存作品'}</h3>
 {panel==='eagle'&&<><p className="muted">{eagle?.library||'正在连接 Eagle…'}</p><label>Eagle 文件夹</label><select disabled={busy} value={folder} onChange={e=>setFolder(e.target.value)}><option value="">未分类</option>{eagle?.folders?.map((f:any)=><option key={f.id} value={f.id}>{f.name}</option>)}</select><p className="muted">自动识别图文或视频：保存顺序图片或原视频，并写入标题、完整文案、作者、标签与来源链接。没有 20 MB 限制。</p></>}
 {panel==='batch'&&<><label>采集范围</label><select disabled={busy} value={mode} onChange={e=>setMode(e.target.value)}><option value="limit">指定数量</option><option value="loaded">当前已加载作品</option><option value="all">全部公开可访问作品</option></select>{mode==='limit'&&<input aria-label="采集数量" type="number" min="1" value={limit} disabled={busy} onChange={e=>setLimit(Number(e.target.value))}/>}<label>保存方式</label><select disabled={busy} value={destination} onChange={e=>setDestination(e.target.value)}><option value="local">本地采集列表（可导出 Excel）</option><option value="feishu">本地列表 + 飞书</option></select></>}
 {panel==='mix'&&<><p className="muted">合集：{mixInfo?.mix_name||'未命名合集'}，预计 {mixInfo?.statis?.updated_to_episode??'未知'} 条。按合集顺序串行采集，已完成记录会保留。</p><label>飞书目标表</label><select disabled={busy} value={target} onChange={e=>{setTarget(e.target.value);setTargetPicked(true);}}><option value="">选择抖音目标表</option>{targets.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><p className="muted">图文和视频会按作品类型自动路由到对应抖音表；重复作品更新采集字段，人工字段保留。</p></>}
 {panel==='download'&&<><p className="muted">仅保存 JPG / PNG，保持来源尺寸；其他图片格式无损转为 PNG。目录只需选择一次，已有内容时会新建作品文件夹。</p>{!imageChoice&&fullImageTask&&<div className="actions image-choice"><button className="primary" disabled={busy||currentIndex===undefined} onClick={()=>chooseImageTask('current')}>{currentIndex===undefined?'当前图片未识别':`下载当前图片（第 ${currentIndex+1} 张）`}</button><button disabled={busy} onClick={()=>chooseImageTask('all')}>下载全部图片（{fullImageTask.files.length} 张）</button></div>}{imageChoice&&<><p className="muted">{imageChoice==='current'?'已选择当前显示图片。':'已选择整组图片。'}可返回上一步切换下载范围。</p><ol className="image-files">{imageTask?.files.map((file,index)=>{const state=imageStates[index]||'pending';return <li key={`${file.url}-${file.sourceIndex??index}`} className={state}>{imageOutputNames[index]||file.filename} · {state==='success'?'已保存':state==='saving'?'保存中…':state==='failed'?'失败':'待保存'}{imageErrors[index]&&<small>（{imageErrors[index]}）</small>}</li>;})}</ol><div className="actions"><button className="primary" disabled={busy||imageStates.length>0&&imageStates.every(state=>state==='success')} onClick={()=>execute(saveImages,'download')}>{imageStates.length>0&&imageStates.every(state=>state==='success')?'已全部保存':imageStates.some(state=>state==='failed')?'重试失败项':'选择文件夹并保存'}</button><button disabled={busy} onClick={()=>{setImageChoice(undefined);setImageTask(undefined);imageFolder.current=undefined;}}>返回选择</button></div></>}</>}
 {(panel==='sync'||(panel==='batch'&&destination==='feishu'))&&<><label>飞书目标表</label><select disabled={busy} value={target} onChange={e=>{setTarget(e.target.value);setTargetPicked(true);}}><option value="">选择目标表</option>{targets.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><p className="muted">{features.uploadMedia?'上传封面与素材；图片组内任一张超过 15 MB 则整组仅保留链接，单个文件超过 20 MB 同样仅保留链接。':'仅同步文字信息与素材链接，不上传附件。'}</p></>}
 {panel!=='download'&&<div className="actions"><button className="primary" disabled={busy} onClick={()=>execute(panel==='batch'?batch:panel==='mix'?mixSync:panel==='eagle'?importToEagle:sync)}>{panel==='batch'?'开始采集':panel==='mix'?'开始采集合集':panel==='eagle'?'导入并验证':'同步这条作品'}</button>{busy&&(panel==='batch'||panel==='mix')&&<button onClick={()=>stop.current?.abort()}>停止</button>}<button onClick={()=>rpc('openOptions')}>打开采集列表 / 设置</button></div>}<div role="status" className="message">{message}</div></section>}
 </>;
}
export function mountCollector(platform:Platform){let host:HTMLElement|undefined,root:Root|undefined,key='';let lastAnchor:Element|undefined;
 const tick=()=>{const c=context(platform);const next=c?`${c.kind}:${c.id}`:'';let anchor:Element|undefined;
  if(c?.kind==='post'){if(platform==='xhs'){anchor=document.querySelector('#noteContainer .media-container')||document.querySelector('#noteContainer .video-player')||document.querySelector('#noteContainer')||undefined;}else{const isNotePage=location.pathname.startsWith('/note/');anchor=isNotePage?document.querySelector('[data-e2e="player-container"].note-detail-container.newVideoPlayer')||document.querySelector('[data-e2e="feed-active-video"]')||document.querySelector('xg-video-container')?.parentElement||undefined:document.querySelector('[data-e2e="feed-active-video"]')||document.querySelector('xg-video-container')?.parentElement||undefined;}}
  else if(c)anchor=platform==='xhs'?document.querySelector('#userPageContainer .user-info')||undefined:document.querySelector('[data-e2e="user-info"]')||undefined;
  if(key===next&&host?.isConnected&&anchor===lastAnchor)return;
  root?.unmount();host?.remove();root=undefined;host=undefined;key=next;lastAnchor=anchor;
  if(!c||!anchor)return;host=document.createElement('compact-collector');const shadow=host.attachShadow({mode:'open'});const style=document.createElement('style');style.textContent=css;shadow.append(style);const container=document.createElement('div');shadow.append(container);
  if(c.kind==='post'){host.style.cssText='position:absolute;left:16px;top:16px;z-index:2147483600;';if(getComputedStyle(anchor).position==='static')(anchor as HTMLElement).style.position='relative';anchor.append(host);}else{host.style.cssText='display:block;margin:12px 0;position:relative;z-index:100;';anchor.after(host);}
  for(const event of ['click','keydown','keyup','pointerdown'])host.addEventListener(event,e=>e.stopPropagation());root=createRoot(container);root.render(<Toolbar key={next} c={c}/>);
 };const timer=window.setInterval(()=>{try{tick();}catch(e){console.info('[简采] 工具栏本次更新失败（扩展可能已更新，刷新页面恢复）',e);}},700);tick();return ()=>{clearInterval(timer);root?.unmount();host?.remove();};}
