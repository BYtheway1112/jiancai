import {prepareImage} from '../utils/image-format';
import {assertCleanImageSource} from '../utils/image-source';
import { LIMIT, Post, Target, sizeAllowed, attachmentNames,fieldDefinition,schemas,postType } from './model';
export interface Credentials { appId:string; secret:string }
export interface Field { field_id:string;field_name:string;type:number;property?:any }
const origin='https://open.feishu.cn/open-apis';
const allowedSuffixes=['xhscdn.com','douyin.com','douyinvod.com','douyinpic.com','byteimg.com','ibytedtos.com','pstatp.com','snssdk.com','bytecdn.cn','douyinstatic.com'];
export function mediaUrl(value:string){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||(u.hostname!=='ci.xiaohongshu.com'&&!allowedSuffixes.some(s=>u.hostname===s||u.hostname.endsWith('.'+s))))throw new Error('素材地址不在支持的 CDN 范围内');return u.href;}
class MediaNetworkError extends Error {}
const MB=1048576;
// Large originals need more than a fixed 45s: scale with known size, clamped to 45–120s.
export function mediaDownloadTimeout(size?:number){return Math.max(45000,Math.min(120000,Math.round((size&&size>0?size:0)/MB*15000)));}
async function downloadMedia(src:string,size?:number):Promise<Blob>{
 let lastNetwork:MediaNetworkError|undefined;
 for(let attempt=0;attempt<3;attempt++){
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),mediaDownloadTimeout(size));
  try{
   let response:Response;
   try{response=await fetch(src,{credentials:'omit',cache:'no-store',signal:abort.signal});}catch(e){throw new MediaNetworkError('素材连接失败：'+(e as Error).message);}
   if(!response.ok||!response.body)throw new Error(`素材下载失败（HTTP ${response.status}），未上传`);
   const reader=response.body.getReader();const chunks:Uint8Array[]=[];let actual=0;
   while(true){
    let part:ReadableStreamReadResult<Uint8Array>;
    try{part=await reader.read();}catch(e){throw new MediaNetworkError(abort.signal.aborted?'素材下载超时':'素材下载中断：'+(e as Error).message);}
    if(part.done)break;actual+=part.value.byteLength;
    if(actual>LIMIT)throw new Error('实际文件超过 20 MB，未上传');
    chunks.push(part.value);
   }
   if(!sizeAllowed(actual))throw new Error('素材文件为空，未上传');
   const type=response.headers.get('content-type')||'application/octet-stream';
   if(type.includes('text/')||type.includes('json'))throw new Error('返回内容不是媒体文件，未上传');
   return new Blob(chunks as BlobPart[],{type});
  }catch(e){
   // Retry only the read-only download. Never retry a possibly completed upload here.
   if(!(e instanceof MediaNetworkError))throw e;lastNetwork=e;
  }finally{clearTimeout(timer);abort.abort();}
  await new Promise(resolve=>setTimeout(resolve,attempt===0?500:1500));
 }
 // Exhausted retries: degrade to a calm skip-with-link notice instead of a raw
 // network error. The record keeps the material link and the next sync resumes
 // the missing attachment, so nothing is lost and nothing is faked as complete.
 throw new MediaNetworkError('素材下载不稳定，本次仅保存链接；重新同步会自动补传');
}
export function mappedFields(post:Post,target:Target,columns:Field[]) {
 const result:Record<string,any>={};
 for(const [source,value] of Object.entries(post.fields)){
  const name=target.mapping[source];if(!name||attachmentNames.has(source))continue;
  const f=columns.find(c=>c.field_name===name);if(!f)throw new Error(`目标字段不存在：${name}`);
  if(f.type===1)result[name]=Array.isArray(value)?value.join('\n'):String(value);
  else if(f.type===2){if(typeof value==='number')result[name]=value;else throw new Error(`数字字段类型不匹配：${name}`);}
  else if(f.type===3)result[name]=Array.isArray(value)?value[0]:String(value);
  else if(f.type===4)result[name]=Array.isArray(value)?value:[String(value)];
  else if(f.type===5){if(typeof value==='number')result[name]=value;else throw new Error(`日期字段类型不匹配：${name}`);}
  else if(f.type===15)result[name]={link:String(value),text:String(value)};
  else throw new Error(`字段不可写或类型不支持：${name}`);
 }
 const plays=target.mapping['播放量'];
 if(post.platform==='dy'&&plays&&post.fields['播放量']===undefined)result[plays]=null;
 return result;
}
export function sameFieldValue(expected:any,actual:any,type:number):boolean{
 if((expected===null||expected==='')&&(actual==null||actual===''))return true;
 let normalized=Array.isArray(actual)&&actual.every((x:any)=>x?.type==='text')?actual.map((x:any)=>x.text).join(''):actual;
 // Feishu may return numeric cells as decimal strings even for type 2.
 if((type===2||type===5)&&typeof expected==='number'&&typeof normalized==='string'&&/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(normalized)){
  const numeric=Number(normalized);if(Number.isFinite(numeric))normalized=numeric;
 }
 return JSON.stringify(normalized)===JSON.stringify(expected);
}
 // Images above this size are the ones that keep tripping mid-download network
 // errors. If any image in a group exceeds it, the whole group stays link-only.
 export const SOFT_LIMIT=15*1024*1024;
function attachmentSource(m:Post['media'][number]){const isImage=/图片|封面/.test(m.field);return isImage?assertCleanImageSource(m.url,m.field.startsWith('笔记')?'xhs':'dy'):mediaUrl(m.url);}
async function headSize(src:string):Promise<number|undefined>{try{const head=await fetch(src,{method:'HEAD',credentials:'omit',signal:AbortSignal.timeout(15000)});if(head.ok&&head.headers.has('content-length')&&!head.headers.get('content-encoding'))return Number(head.headers.get('content-length'));}catch{}return undefined;}
export class Feishu {
 private token='';
 constructor(private credentials:Credentials){}
 async authenticate(){const r=await fetch(`${origin}/auth/v3/tenant_access_token/internal`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:this.credentials.appId,app_secret:this.credentials.secret}),signal:AbortSignal.timeout(20000)});const j=await r.json();if(!r.ok||j.code!==0||!j.tenant_access_token)throw new Error(`飞书认证失败（${j.code??r.status}），请检查应用凭证`);this.token=j.tenant_access_token;}
 async call(path:string,method='GET',body?:any){if(!this.token)await this.authenticate();const r=await fetch(origin+path,{method,headers:{Authorization:`Bearer ${this.token}`,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});const j=await r.json();if(!r.ok||j.code!==0)throw new Error(`飞书操作失败（${j.code??r.status}）：${j.msg||'请检查权限或网络'}`);return j.data;}
 async list(path:string){const items:any[]=[];let page='';const seen=new Set<string>();do{const r=await this.call(path+(path.includes('?')?'&':'?')+'page_size=100'+(page?'&page_token='+encodeURIComponent(page):''));items.push(...r.items||[]);if(!r.has_more)break;if(!r.page_token||seen.has(r.page_token))throw new Error('飞书列表分页异常');page=r.page_token;seen.add(page);}while(true);return items;}
 tables(base:string){return this.list(`/bitable/v1/apps/${encodeURIComponent(base)}/tables`);}
 fields(t:Target):Promise<Field[]>{return this.list(`/bitable/v1/apps/${encodeURIComponent(t.base)}/tables/${encodeURIComponent(t.table)}/fields`);}
 async ensureFields(t:Target):Promise<Field[]>{
  let columns=await this.fields(t);
  const mapped=Object.entries(t.mapping).filter(([source,name])=>name&&schemas[t.platform].includes(source));
  if(new Set(mapped.map(([,name])=>name)).size!==mapped.length)throw new Error('多个来源字段不能映射到同一列');
  for(const [source,name]of mapped){
   if(columns.some(f=>f.field_name===name))continue;
   let creationError:unknown;
   try{await this.call(`/bitable/v1/apps/${encodeURIComponent(t.base)}/tables/${encodeURIComponent(t.table)}/fields`,'POST',fieldDefinition(source,name));}
   catch(e){creationError=e;}
   // Field-list can lag behind a successful write. Retry reads only, including
   // after an ambiguous create response; never issue another create here.
   for(const delay of [0,300,900,1800]){
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    columns=await this.fields(t);
    if(columns.some(f=>f.field_name===name))break;
   }
   if(!columns.some(f=>f.field_name===name)){
    if(creationError)throw new Error(`自动创建字段“${name}”失败：${(creationError as Error).message}`);
    throw new Error(`字段“${name}”创建后未能回读，请重试`);
   }
  }
  return columns;
 }
 async attachment(m:Post['media'][number],base:string){
  const isImage=/图片|封面/.test(m.field);
  const src=attachmentSource(m);
  if(m.size!==undefined&&!sizeAllowed(m.size))throw new Error(m.size>LIMIT?'超过 20 MB，仅保存链接':'大小无效，未上传');
  const size=(await headSize(src)) ?? m.size;
  if(!sizeAllowed(size))throw new Error(size&&size>LIMIT?'超过 20 MB，仅保存链接':'无法确认文件大小，未上传');
  let file=await downloadMedia(src,size),name=m.name;
  if(isImage){const prepared=await prepareImage(file);file=prepared.blob;name=name.replace(/\.[^.]+$/,'.'+prepared.extension);}
  if(!sizeAllowed(file.size))throw new Error('转换后的图片超过 20 MB，仅保存链接');
  const body=new FormData();body.append('file_name',name);body.append('parent_type','bitable_file');body.append('parent_node',base);body.append('size',String(file.size));body.append('file',file,name);
  let r:any;try{r=await this.call('/drive/v1/medias/upload_all','POST',body);}catch(e){throw new Error('飞书附件上传失败：'+(e as Error).message);}if(!r.file_token)throw new Error('上传未返回附件凭据');return {file_token:r.file_token};
 }

 async sync(post:Post,target:Target,options:{uploadMedia?:boolean}={}){
  if(post.platform!==target.platform)throw new Error('作品平台与目标表不一致');
  const expectedType=postType(post),targetType=target.contentType||(post.platform==='dy'?'video':undefined);if(targetType!==expectedType)throw new Error(`请使用对应的${post.platform==='dy'?'抖音':'小红书'}图文或视频专用表`);
  const columns=await this.ensureFields(target);const fields=mappedFields(post,target,columns);
  const identity=target.mapping[post.platform==='xhs'?'笔记ID':'视频ID'];
  if(!identity||!columns.some(f=>f.field_name===identity&&f.type===1))throw new Error('请将作品 ID 映射到文本字段');
  const prefix=`/bitable/v1/apps/${encodeURIComponent(target.base)}/tables/${encodeURIComponent(target.table)}/records`;
  const search=await this.call(prefix+'/search?page_size=2','POST',{filter:{conjunction:'and',conditions:[{field_name:identity,operator:'is',value:[post.id]}]}});
  if(search.has_more||search.items?.length>1)throw new Error('目标表已有多个相同作品 ID，请先合并重复记录');
  let existing=search.items?.[0];
  // Save metadata first. A failed attachment never loses the collected record.
  let saved=await this.call(prefix+(existing?'/'+existing.record_id:''),existing?'PUT':'POST',{fields});
  const recordId=saved.record?.record_id||existing?.record_id;if(!recordId)throw new Error('飞书未返回记录 ID');
  const warnings=[...post.warnings];const attachments:Record<string,any[]>={};
  const groups=new Map<string,Post['media']>();
  for(const media of options.uploadMedia===false?[]:post.media){const name=target.mapping[media.field];if(!name)continue;if(!columns.some(f=>f.field_name===name&&f.type===17)){warnings.push(`${name} 不是附件字段，未上传`);continue;}groups.set(name,[...groups.get(name)||[],media]);}
  // Keep user attachments and resume missing files after a partial upload.
  // Generated names include the platform post ID, field and image sequence.
  for(const [name,media]of groups){
   const previous=existing?.fields?.[name]||[];
   const files:any[]=previous.map((f:any)=>({file_token:f.file_token}));
   const renamed=media.map(original=>/图片|封面/.test(original.field)?{...original,name:original.name.replace(/\.[^.]+$/, '-原图.jpg')}:original);
   const pending=renamed.filter(m=>!previous.some((f:any)=>f.name===m.name||/图片|封面/.test(m.field)&&['jpg','jpeg','png'].some(ext=>f.name===m.name.replace(/\.[^.]+$/,'.'+ext))));
   if(!pending.length)continue;
   // Whole-group link-only: if any pending image exceeds the soft limit,
   // upload none of the group. The record keeps the one-shot download link
   // field, so no half-uploaded image set is left behind.
   if(pending.every(m=>/图片|封面/.test(m.field))){
    let oversize=false;
    for(const m of pending){
     try{const s=m.size!==undefined?m.size:await headSize(attachmentSource(m));if(s!==undefined&&s>SOFT_LIMIT){oversize=true;break;}}catch{}
    }
    if(oversize){warnings.push(`${name}：含超过 15 MB 的图片，整组仅保存链接`);continue;}
   }
   let added=false;
   for(const m of pending){
    try{files.push(await this.attachment(m,target.base));added=true;}
    catch(e){warnings.push(`${m.name}：${(e as Error).message}`);}
   }
   if(added)attachments[name]=files;
  }
  if(Object.keys(attachments).length){try{await this.call(prefix+'/'+recordId,'PUT',{fields:attachments});}catch(e){warnings.push('附件关联失败：'+(e as Error).message);}}
  let actual:Record<string,any>={};let mismatch='';
  for(const delay of [0,300,900,1800]){
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
   const readback=await this.call(prefix+'/'+recordId);actual=readback.record?.fields||{};mismatch='';
   for(const [name,value]of Object.entries(fields)){
    if(!sameFieldValue(value,actual[name],columns.find(c=>c.field_name===name)?.type||0)){mismatch=name;break;}
   }
   if(!mismatch)break;
  }
  if(mismatch){const expected=fields[mismatch],received=actual[mismatch];const detail=typeof expected==='number'?`（预期 ${expected}，回读 ${typeof received==='number'||typeof received==='string'&&/^[-+0-9.eE]+$/.test(received)?received:typeof received}）`:'';throw new Error(`记录已写入，但字段回读不一致：${mismatch}${detail}；请检查后重试`);}
  for(const [name,files]of Object.entries(attachments)){const tokens=(actual[name]||[]).map((x:any)=>x.file_token);if(files.some(f=>!tokens.includes(f.file_token)))warnings.push(`${name} 附件回读未通过`);}
  return {recordId,updated:!!existing,warnings};
 }
}
