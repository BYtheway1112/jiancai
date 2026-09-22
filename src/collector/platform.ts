import { normalize, Platform, Post, assertNextCursor } from './model';
import { rpc } from './rpc';
import { webV1Feed } from '../entrypoints/xhs.content/api/note';
import { webV1UserOtherinfo,webV1UserPosted } from '../entrypoints/xhs.content/api/user';
import { awemeDetail,awemePost,mixAweme } from '../entrypoints/dy.content/api/aweme';
import { userProfileOther } from '../entrypoints/dy.content/api/user';
export interface Context { platform:Platform; id:string; href:string; kind:'post'|'author' }
export function context(platform:Platform):Context|undefined {
 const u=new URL(location.href);let id:string|undefined;
 if(platform==='xhs'){
  id=u.pathname.match(/\/(?:explore|discovery\/item)\/([\da-f]{24})/)?.[1];
  // Profile route can contain an open note modal.
  if(!id&&document.querySelector('#noteContainer'))id=u.pathname.match(/\/user\/profile\/[^/]+\/([\da-f]{24})/)?.[1];
 }else id=u.searchParams.get('modal_id')||u.pathname.match(/\/(?:video|note)\/(\d+)/)?.[1]||undefined;
 if(id)return {platform,id,href:u.href,kind:'post'};
 id=platform==='xhs'?u.pathname.match(/\/user\/profile\/([\da-f]{24})\/?$/)?.[1]:u.pathname.match(/\/user\/(MS4w[^/?]+)/)?.[1];
 return id?{platform,id,href:u.href,kind:'author'}:undefined;
}
export async function collect(c:Context,author?:any):Promise<Post>{
 if(c.platform==='xhs'){
  const snap=await rpc<any>('snapshot');let raw=snap?.[c.id]?.note||snap?.[c.id]?.note_card;
  if(!raw){const u=new URL(c.href);const r=await webV1Feed(c.id,u.searchParams.get('xsec_source')||'pc_user',u.searchParams.get('xsec_token')||'');raw=r?.items?.[0]?.note_card;}
  if(!raw||String(raw.note_id||raw.noteId)!==c.id)throw new Error('笔记详情未取得或 ID 不一致，请打开作品后重试');
  const userId=raw.user?.user_id||raw.user?.userId;
  let warning='';if(!author&&userId){try{author=await webV1UserOtherinfo(userId);}catch{warning='博主扩展信息暂未取得';}}
  let p=normalize('xhs',raw,c.href,author);
  if(!p.media.some(m=>m.field!=='笔记封面')){
   // A page snapshot can contain a summary card before the full note arrives.
   try{
    const u=new URL(c.href);const full=(await webV1Feed(c.id,u.searchParams.get('xsec_source')||'pc_user',u.searchParams.get('xsec_token')||''))?.items?.[0]?.note_card;
    if(full&&String(full.note_id)===c.id)p=normalize('xhs',full,c.href,author);
   }catch(e){p.warnings.push('详情补充失败：'+(e as Error).message);}
   if(!p.media.some(m=>m.field!=='笔记封面')){
    p.warnings.push('未取得原视频或图片链接，请待作品加载完成后重试');
    console.info('[简采] 媒体字段诊断',JSON.stringify(mediaShape({video:raw.video,videoPlayInfo:raw.videoPlayInfo}))); 
   }
  }
  if(warning)p.warnings.push(warning);return p;
 }
 let resp:any;try{resp=await awemeDetail(c.id);}catch(e){console.warn('[简采] 抖音详情请求失败',c.id,(e as Error).message);throw new Error('抖音详情接口请求失败：'+(e as Error).message);}
 const raw=resp?.aweme_detail;
 console.info('[简采] 抖音详情',c.id,{接口状态:resp?.status_code,有详情:!!raw,媒体类型:raw?.media_type,图片数:Array.isArray(raw?.images)?raw.images.length:undefined});
 if(!raw||String(raw.aweme_id)!==c.id)throw new Error(`视频详情未取得或 ID 不一致（接口状态 ${resp?.status_code??'无响应'}），请确认登录后重试`);
 let warning='';if(!author&&raw.author?.sec_uid){try{author=(await userProfileOther(raw.author.sec_uid)).user;}catch{warning='达人扩展信息暂未取得';}}
 const p=normalize('dy',raw,c.href,author);if(warning)p.warnings.push(warning);return p;
}
export function loaded(c:Context):Context[]{
 const root=c.platform==='xhs'?document.querySelector('#userPostedFeeds'):document.querySelector('[data-e2e="user-post-list"]');
 if(!root)throw new Error('未找到主页作品列表，请先切换到作品栏');
 const rows=new Map<string,Context>();for(const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')){const u=new URL(a.href);const id=c.platform==='xhs'?u.pathname.match(/\/(?:explore|user\/profile\/[^/]+)\/([\da-f]{24})/)?.[1]:u.pathname.match(/\/(?:video|note)\/(\d+)/)?.[1]||u.searchParams.get('modal_id');if(id)rows.set(id,{...c,id,kind:'post',href:u.href});}return [...rows.values()];
}
export async function* authorPosts(c:Context,mode:string,limit:number,signal:AbortSignal):AsyncGenerator<Context>{
 if(mode==='loaded'){yield* loaded(c);return;}
 let cursor:string|number=c.platform==='xhs'?'':0;const cursors=new Set([String(cursor)]);const seen=new Set<string>();let count=0;
 do{
  if(signal.aborted)return;
  const r:any=c.platform==='xhs'?await webV1UserPosted({user_id:c.id,cursor:String(cursor),num:20,image_formats:'jpg,webp,avif'}):await awemePost({sec_user_id:c.id,max_cursor:Number(cursor),count:20,cut_version:1});
  const entries=c.platform==='xhs'?r?.notes:r?.aweme_list;if(!Array.isArray(entries))throw new Error('主页接口没有返回作品列表，请确认登录状态');
  for(const p of entries){if(signal.aborted)return;const id=c.platform==='xhs'?p.note_id:p.aweme_id;if(!id||seen.has(String(id)))continue;seen.add(String(id));yield {...c,id:String(id),kind:'post',href:c.platform==='xhs'?`https://www.xiaohongshu.com/explore/${id}?xsec_source=pc_user&xsec_token=${encodeURIComponent(p.xsec_token||'')}`:`https://www.douyin.com/video/${id}`};count++;if(mode!=='all'&&count>=limit)return;}
  const next=c.platform==='xhs'?r.cursor:r.max_cursor;if(!r.has_more)return;assertNextCursor(cursor,next,true,cursors);if(!entries.length)throw new Error('返回空页但仍标记有后续数据，已停止');cursor=next;cursors.add(String(next));
  await new Promise(r=>setTimeout(r,1000));
 }while(true);
}

/**
 * Read a Douyin collection in publication order. The endpoint exposes a
 * numeric cursor and may claim that another page exists without advancing
 * it; keep the same loop guard used by creator-homepage collection so a
 * malformed response cannot spin forever.
 */
export async function* mixPosts(mixId:string,signal:AbortSignal):AsyncGenerator<any>{
 let cursor=0;const cursors=new Set([String(cursor)]);const seen=new Set<string>();
 while(true){
  if(signal.aborted)return;
  const result:any=await mixAweme({mix_id:mixId,cursor,count:10});
  const entries=result?.aweme_list;
  if(!Array.isArray(entries))throw new Error('合集接口没有返回作品列表，请确认登录状态');
  if(!entries.length&&result?.has_more)throw new Error('合集接口返回空页但仍有后续数据，已停止；已采集结果保留');
  let added=0;
  for(const raw of entries){
   if(signal.aborted)return;
   const id=String(raw?.aweme_id||'');if(!id||seen.has(id))continue;
   seen.add(id);added++;yield raw;
  }
  if(!result?.has_more)return;
  if(!added)throw new Error('合集分页没有新增作品，已停止；已采集结果保留');
  const next=result.cursor;assertNextCursor(cursor,next,true,cursors);
  cursor=next;cursors.add(String(next));
  await new Promise(r=>setTimeout(r,800));
 }
}

function mediaShape(value:any,depth=0):any{if(depth>7)return typeof value;if(Array.isArray(value))return {length:value.length,sample:value.slice(0,1).map(v=>mediaShape(v,depth+1))};if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,mediaShape(v,depth+1)]));if(typeof value==='string')return /^https?:/.test(value)?'media URL':`string(${value.length})`;return value;}
