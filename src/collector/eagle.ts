import {fetchPreparedImage} from '../utils/image-fetch';
import {encodeImageDownloadBytes} from '../utils/image-download';
import {Post,postType,Value} from './model';
import {mediaUrl} from './feishu';
const endpoint='http://localhost:41595';
export async function eagleCall(path:string,body?:any){let r:Response;try{r=await fetch(endpoint+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(body?120000:15000)});}catch{throw new Error('无法连接 Eagle，或导入仍在处理中；请打开 Eagle 后检查，不要立即重复导入');}if(!r.ok)throw new Error(`Eagle 接口失败（${r.status}）`);const j=await r.json();if(j.status!=='success')throw new Error('Eagle 返回失败，请检查当前资源库');return j.data;}
export async function eagleInfo(){const lib=await eagleCall('/api/library/info');const roots=await eagleCall('/api/folder/list');const folders:{id:string;name:string}[]=[];const walk=(list:any[],parent='')=>{for(const f of list){const name=parent+f.name;folders.push({id:f.id,name});walk(f.children||[],name+' / ');}};walk(roots||[]);return {libraryId:lib.library?.path||lib.path,library:lib.library?.name||lib.name||lib.library?.path||lib.path||'当前 Eagle 资源库',folders};}
export function eagleAssets(post:Post){return post.media.filter(m=>!m.field.includes('封面')&&!m.field.includes('音频'));}
function displayType(post:Post):string{return `${post.platform==='xhs'?'小红书':'抖音'}${postType(post)==='image'?'图文':'视频'}`;}
function displayTitle(post:Post):string{return String(post.fields['笔记标题']||post.fields['视频描述']||post.id).split('\n')[0].trim().slice(0,90)||post.id;}
function displayAuthor(post:Post):string{return String(post.fields['博主昵称']||post.fields['达人昵称']||'').trim();}
function displayBody(post:Post):string{return String(post.fields['笔记内容']||post.fields['视频描述']||'').trim();}
function displaySource(post:Post):string{return String(post.fields['笔记链接']||post.fields['视频链接']||'').trim();}
function displayTopicText(post:Post):string{
 const values=['笔记话题','视频话题','视频标签'].flatMap(name=>{
  const value=post.fields[name];return Array.isArray(value)?value.map(String):typeof value==='string'?[value]:[];
 });
 return [...new Set(values.map(v=>v.replace(/^#+/,'').replace(/\[话题\]/g,'').trim()).filter(Boolean))].join('、');
}
function formatFieldValue(value:Value):string{return Array.isArray(value)?value.join('、'):String(value);}
function compactName(value:string,maxBytes=150):string{
 let result=value.replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim();
 while(new TextEncoder().encode(result).byteLength>maxBytes&&result.length>1)result=result.slice(0,-1).trim();
 return result;
}
export function eagleTags(post:Post):string[]{
 const values=['简采',post.platform==='xhs'?'小红书':'抖音',postType(post)==='image'?'图文':'视频'];
 for(const name of ['笔记话题','视频话题','视频标签']){
  const value=post.fields[name];
  if(Array.isArray(value))values.push(...value.map(String));
  else if(typeof value==='string')values.push(...value.split(/[、,，\n]/));
 }
 return [...new Set(values.map(value=>value.replace(/^#+/,'').replace(/\[话题\]/g,'').trim()).filter(Boolean))].slice(0,24);
}
export function eaglePayload(post:Post,index:number,folderId?:string){
 const media=eagleAssets(post)[index];if(!media)throw new Error('没有可导入的媒体');
 const key=`${post.platform}-${post.id}-${index+1}`;
 const title=displayTitle(post),type=displayType(post),author=displayAuthor(post),body=displayBody(post),source=displaySource(post);
 const total=eagleAssets(post).length;
 const fields=Object.entries(post.fields).map(([k,v])=>`${k}：${formatFieldValue(v)}`).join('\n');
 // Keep the annotation compatible with the five-section format used by
 // Feishu-to-Eagle imports. The first section is always the unmodified post
 // copy; the short summary and production route are deliberately marked as
 // metadata-only because the extension does not perform visual analysis.
 const annotation=[
  `简采来源：${key}`,
  '【来源文案】',
  body||'未取得来源文案',
  '',
  '【检索摘要】',
  title,
  '',
  '【可借鉴】',
  '待后续轻拆；先保留来源和可检索元数据。',
  '',
  '【制作路线】',
  '待人工复核',
  '',
  '【核对说明】',
  `简采直接采集；平台：${post.platform==='xhs'?'小红书':'抖音'}；作品类型：${type}；来源键：${key}；素材序号：${index+1}/${total}；未进行视觉内容推断`,
  '',
  '【来源链接】',
  source||'未取得来源链接',
  '',
  '简采元数据：3',
  `平台：${post.platform==='xhs'?'小红书':'抖音'}`,
  `作品类型：${type}`,
  `作品ID：${post.id}`,
  `作者：${author||'未取得'}`,
  `内容标题：${title}`,
  `素材序号：${index+1}/${total}`,
  `素材字段：${media.field}`,
  `素材文件名：${media.name}`,
  `素材链接：${mediaUrl(media.url)}`,
  `来源链接：${source||'未取得'}`,
  `来源文案：${body||'未取得'}`,
  `话题/标签：${displayTopicText(post)||'未取得'}`,
  '',
  '完整采集字段：',
  fields
 ].join('\n');
 const name=compactName(`[${key}] ${type}｜${author?author+'｜':''}${title}`);
 return {url:mediaUrl(media.url),name,website:source,tags:eagleTags(post),annotation,...(folderId?{folderId}:{}),headers:{referer:post.platform==='xhs'?'https://www.xiaohongshu.com/':'https://www.douyin.com/'}};
}
export async function importEagle(post:Post,folderId:string,expectedLibrary:string){const current=await eagleInfo();if(current.libraryId!==expectedLibrary)throw new Error('Eagle 资源库已切换，请重新选择目标');if(folderId&&!current.folders.some(f=>f.id===folderId))throw new Error('Eagle 文件夹不存在');const media=eagleAssets(post);if(!media.length)throw new Error('没有取得原视频或图片链接');const results:any[]=[];
 for(let i=0;i<media.length;i++){
  const payload=eaglePayload(post,i,folderId);const marker=`简采来源：${post.platform}-${post.id}-${i+1}\n`;
  const imageAsset=/图片|封面/.test(media[i].field);
  const formatMarker='简采图片格式：JPG/PNG-v1\n';
  if(imageAsset)payload.annotation=marker+formatMarker+payload.annotation.slice(marker.length);
  const find=async()=>{const items=await eagleCall('/api/item/list?limit=100&keyword='+encodeURIComponent(`[${post.platform}-${post.id}-${i+1}]`));return (items||[]).find((x:any)=>!x.isDeleted&&x.annotation?.startsWith(marker)&&(!imageAsset||x.annotation.includes(formatMarker)));};
  let item=await find();const reused=!!item;
  if(item){
   // Keep the existing binary file, but refresh metadata from the latest
   // page snapshot so re-importing a post updates its title/copy/tags/source
   // and follows the folder selected for this import.
   await eagleCall('/api/item/update',{id:item.id,name:payload.name,tags:payload.tags,annotation:payload.annotation,url:payload.website,folderId:folderId||''});
  }
  let importError:unknown;if(!item){try{
   if(/图片|封面/.test(media[i].field)){const prepared=await fetchPreparedImage(media[i].url,post.platform);payload.url=`data:${prepared.extension==='jpg'?'image/jpeg':'image/png'};base64,${encodeImageDownloadBytes(new Uint8Array(await prepared.blob.arrayBuffer()))}`;}
   await eagleCall('/api/item/addFromURL',payload);}catch(e){importError=e;}}
  // A timeout is ambiguous: query before deciding whether a retry is safe.
  for(let attempt=0;!item&&attempt<8;attempt++){item=await find();if(item)break;await new Promise(r=>setTimeout(r,1500));}
  if(!item)throw new Error(importError?(importError as Error).message:'Eagle 尚未返回可验证的素材；请检查 Eagle 后重试');
  const verified=await eagleCall('/api/item/info?id='+encodeURIComponent(item.id));if(!verified?.annotation?.startsWith(marker)||verified.url!==payload.website||!(verified.size>0)||!eagleTags(post).every(tag=>(verified.tags||[]).includes(tag)))throw new Error('Eagle 来源、元数据或文件回读未通过，请检查后重试');
  if(/图片|封面/.test(media[i].field)&&!['jpg','jpeg','png'].includes(String(verified.ext).toLowerCase()))throw new Error('Eagle 已有旧格式图片，未覆盖；请先处理已有旧素材，再重新导入');
  results.push({id:item.id,reused,name:item.name});
 }
 return {items:results,library:current.library};
}
