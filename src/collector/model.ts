import {douyinImageSource,xhsImageSource} from '../utils/image-source';
export type Platform = 'xhs' | 'dy';
export type Value = string | number | string[];
export interface Media { field: string; url: string; name: string; size?: number }
export interface Post { key: string; platform: Platform; id: string; fields: Record<string, Value>; media: Media[]; warnings: string[] }
export interface Target { id: string; name: string; platform: Platform; base: string; table: string; mapping: Record<string,string>; contentType?: 'video' | 'image' }
export const LIMIT = 20 * 1024 * 1024;
export const schemas: Record<Platform,string[]> = {
 xhs: '笔记ID,笔记链接,博主ID,博主链接,博主昵称,小红书号,博主简介,粉丝数,获赞与收藏,笔记类型,笔记标题,笔记内容,笔记话题,点赞量,收藏量,评论量,分享量,发布时间,更新时间,IP地址,采集时间,笔记视频时长,图片数量,笔记封面链接,笔记视频链接,笔记图片链接,笔记封面,笔记视频,笔记图片'.split(','),
 dy: '视频ID,视频链接,达人UID,达人链接,抖音号,达人昵称,达人简介,粉丝数,获赞,视频类型,视频描述,视频标签,视频话题,点赞量,收藏量,评论量,分享量,推荐量,播放量,发布时间,采集时间,视频时长,图片数量,所属合集,锚点信息,大家都在搜,视频文件链接,视频封面链接,视频图片链接,音频文件链接,视频文件,视频封面,音频文件,视频图片'.split(',')
};
export const attachmentNames = new Set(['笔记封面','笔记视频','笔记图片','视频文件','视频封面','音频文件','视频图片']);
const numericNames=new Set('粉丝数,获赞与收藏,点赞量,收藏量,评论量,分享量,获赞,推荐量,播放量,图片数量'.split(','));
export function fieldDefinition(source:string,name=source){
 const type=attachmentNames.has(source)?17:numericNames.has(source)?2:source.endsWith('时间')?5:source.endsWith('链接')?15:1;
 return {field_name:name,type,...(type===2?{property:{formatter:'0'}}:type===5?{property:{date_formatter:'yyyy/MM/dd HH:mm'}}:{})};
}
export function numberValue(v: unknown): number | undefined {
 if (v === null || v === undefined || v === '') return;
 if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
 const m = String(v).replace(/,/g,'').trim().match(/^(\d+(?:\.\d+)?)(万|亿|w|k)?$/i);
 return m ? Number(m[1]) * ({万:1e4,亿:1e8,w:1e4,k:1e3}[m[2]?.toLowerCase()] || 1) : undefined;
}
function url(v:any): string | undefined { return typeof v === 'string' ? v.replace(/^http:/,'https:') : undefined; }
function first(v:any): string | undefined { return url(v?.url_list?.[0] || v?.url_default || v?.url_pre || v?.info_list?.find((x:any)=>x.image_scene==='WB_DFT')?.url || v?.info_list?.[0]?.url || v?.url); }
function duration(ms:any): string | undefined { const n=numberValue(ms); if(n===undefined)return; const s=Math.floor(n/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
export function normalize(platform:Platform, raw:any, source:string, author?:any, now=Date.now()):Post {
 // XHS page snapshots use camelCase; its HTTP API uses snake_case.
 if(platform==='xhs') raw=xhsApiKeys(raw);
 const id=String(platform==='xhs'?raw.note_id||raw.noteId||'':raw.aweme_id||'');
 if(!id) throw new Error('没有取得作品 ID，未保存');
 const fields: Record<string,Value>={}; const media:Media[]=[]; const warnings:string[]=[];
 const put=(key:string,value:any)=>{if(value!==undefined&&value!==null&&value!=='')fields[key]=value;};
 const num=(key:string,v:any)=>put(key,numberValue(v));
 const add=(field:string,src:string|undefined,ext:string,index=0,size?:number)=>{if(src)media.push({field,url:src,name:`${id}-${field}-${index+1}.${ext}`,size});};
 put('采集时间',now);
 if(platform==='xhs') {
  const u=raw.user||{}, a=author?.basic_info||{}, stats=raw.interact_info||{};
  put('笔记ID',id);put('笔记链接',source);put('博主ID',u.user_id);put('博主链接',u.user_id?`https://www.xiaohongshu.com/user/profile/${u.user_id}`:undefined);put('博主昵称',u.nickname);
  put('小红书号',a.red_id);put('博主简介',a.desc);
  for(const i of author?.interactions||[]) {if(i.type==='fans')num('粉丝数',i.count);if(i.type==='interaction')num('获赞与收藏',i.count);}
  const video=raw.type==='video';put('笔记类型',video?'视频':'图文');put('笔记标题',raw.title);put('笔记内容',raw.desc);put('笔记话题',raw.tag_list?.map((t:any)=>t.name).filter(Boolean));
  num('点赞量',stats.liked_count);num('收藏量',stats.collected_count);num('评论量',stats.comment_count);num('分享量',stats.share_count);
  num('发布时间',raw.time);num('更新时间',raw.last_update_time);put('IP地址',raw.ip_location);
  const images=(raw.image_list||[]).map(xhsImageSource).filter(Boolean); const cover=images[0];put('笔记封面链接',cover);add('笔记封面',cover,'jpg');
  if(video){const v=raw.video;const stream=v?.media?.stream;const track=Object.values(stream||{}).flatMap(group=>Array.isArray(group)?group:[]).filter(t=>t?.master_url).sort((a,b)=>(numberValue(b.size)||0)-(numberValue(a.size)||0))[0];const src=url(track?.master_url)|| (v?.consumer?.origin_video_key?`https://sns-video-bd.xhscdn.com/${v.consumer.origin_video_key}`:undefined);put('笔记视频链接',src);put('笔记视频时长',duration(v?.capa?.duration!==undefined?v.capa.duration*1000:v?.media?.video?.duration));add('笔记视频',src,'mp4',0,numberValue(track?.size));}
  else {num('图片数量',images.length);put('笔记图片链接',images.join('\n'));images.forEach((x:string,i:number)=>add('笔记图片',x,'jpg',i));}
 } else {
  const u=author||raw.author||{},s=raw.statistics||{},video=raw.video||{}, images=(Array.isArray(raw.images)?raw.images:[]).map(douyinImageSource).filter(Boolean);
  // The API contract marks image posts with the numeric media_type=2. Do not
  // infer the post type from image URLs: a video response can contain related
  // or preview images and must remain routed to the video target.
  const isImage=raw.media_type===2;
  put('视频ID',id);put('视频链接',source);put('达人UID',u.uid);put('达人链接',u.sec_uid?`https://www.douyin.com/user/${u.sec_uid}`:undefined);put('抖音号',u.unique_id||u.short_id);put('达人昵称',u.nickname);put('达人简介',u.signature);num('粉丝数',u.follower_count);num('获赞',u.total_favorited);
  put('视频类型',isImage?'图集':'视频');put('视频描述',raw.desc);put('视频话题',raw.text_extra?.filter((x:any)=>x.hashtag_name).map((x:any)=>x.hashtag_name));put('视频标签',raw.video_tag?.map((x:any)=>x.tag_name).filter(Boolean));
  for(const [k,v] of Object.entries({'点赞量':s.digg_count,'收藏量':s.collect_count,'评论量':s.comment_count,'分享量':s.share_count,'推荐量':s.recommend_count}))num(k,v);
  // Public Douyin responses use zero as an unavailable play-count placeholder.
  const plays=numberValue(s.play_count);if(plays!==undefined&&plays>0)put('播放量',plays);
  const t=numberValue(raw.create_time);put('发布时间',t===undefined?undefined:t*1000);if(!isImage)put('视频时长',duration(video.duration||raw.duration));put('所属合集',raw.mix_info?.mix_name);put('锚点信息',raw.anchor_info?.title);put('大家都在搜',raw.suggest_words?.suggest_words?.map((x:any)=>x.words?.map((y:any)=>y.word).join('、')).filter(Boolean).join('、'));
  if(isImage&&images.length!==(raw.images||[]).length)throw new Error(`部分抖音图片未取得无水印链接（${images.length}/${(raw.images||[]).length} 张可用），未保存，请待作品加载完成后重试`);
  const cover=isImage?images[0]:first(video.cover);put('视频封面链接',cover);add('视频封面',cover,'jpg');
  if(isImage){
   num('图片数量',images.length);put('视频图片链接',images.join('\n'));images.forEach((x:string,i:number)=>add('视频图片',x,'jpg',i));
   if(!images.length)warnings.push('已识别为抖音图文，但未取得图片原图链接，请待作品加载完成后重试');
  }
  else {const src=first(video.play_addr);put('视频文件链接',src);add('视频文件',src,'mp4',0,numberValue(video.play_addr?.data_size));const audio=first(raw.music?.play_url);put('音频文件链接',audio);add('音频文件',audio,'mp3');}
 }
 return {key:`${platform}:${id}`,platform,id,fields,media,warnings};
}
function xhsApiKeys(value:any):any {
 if(Array.isArray(value))return value.map(xhsApiKeys);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[
  key.replace(/[A-Z]/g,letter=>'_'+letter.toLowerCase()),xhsApiKeys(item)
 ]));
}
export function mergePost(old:Post|undefined,next:Post):Post {
 const fields={...old?.fields,...next.fields};
 if(next.platform==='dy'){
  if(next.fields['播放量']===undefined)delete fields['播放量'];
  if(postType(next)==='image'){
   for(const name of ['视频时长','视频文件链接','视频文件','音频文件链接','音频文件'])delete fields[name];
  }else{
   for(const name of ['图片数量','视频图片链接','视频图片'])delete fields[name];
  }
 }
 return {...next,fields};
}
export function migratePost(post:Post):Post {
 if(post.platform!=='dy')return post;
 let changed=false;
 const fields={...post.fields};
 if(fields['播放量']===0){delete fields['播放量'];changed=true;}
 const imageLinks=fields['视频图片链接'];
 const hasImageEvidence=fields['视频类型']==='图集'||typeof imageLinks==='string'&&imageLinks.length>0||Array.isArray(imageLinks)&&imageLinks.length>0||post.media.some(item=>item.field==='视频图片');
 if(hasImageEvidence){
  if(fields['视频类型']!=='图集'){fields['视频类型']='图集';changed=true;}
  for(const name of ['视频时长','视频文件链接','视频文件','音频文件链接','音频文件'])if(name in fields){delete fields[name];changed=true;}
  const media:Post['media']=[];
  for(const item of post.media){
   if(item.field==='音频文件'){changed=true;continue;}
   if(item.field==='视频文件'){
    changed=true;
    media.push({...item,field:'视频图片',name:item.name.replace(/-视频文件-(\d+)(\.[^.]+)$/,'-视频图片-$1$2')});
   }else media.push(item);
  }
  if(changed)return {...post,fields,media};
 }
 return changed?{...post,fields}:post;
}
export function sizeAllowed(size:unknown):boolean {return typeof size==='number'&&Number.isFinite(size)&&size>0&&size<=LIMIT;}
export function assertNextCursor(previous:string|number,next:string|number|undefined,hasMore:boolean,seen?:Set<string>){if(hasMore&&(next===undefined||String(previous)===String(next)||seen?.has(String(next))))throw new Error('分页游标未前进或发生循环，已停止；已采集结果保留');}
export function assertSamePost(expected:{platform:Platform;id:string;kind:string},actual?:{platform:Platform;id:string;kind:string}){
 if(!actual||actual.kind!=='post'||expected.kind!=='post'||actual.id!==expected.id||actual.platform!==expected.platform)throw new Error('页面已切换，已取消上一条作品的操作，请在当前作品重新点击');
}

export function postType(post:Post):'video'|'image'{return post.platform==='xhs'&&post.fields['笔记类型']==='图文'||post.platform==='dy'&&post.fields['视频类型']==='图集'?'image':'video';}
export function resolveTarget(post:Post,selected:Target,targets:Target[]):Target{
 if(post.platform!==selected.platform)throw new Error('作品平台与目标表不一致');
 const type=postType(post);
 const selectedType=selected.contentType||(post.platform==='dy'?'video':undefined);
 if(selectedType===type)return selected;
 const matches=targets.filter(t=>t.platform===post.platform&&t.base===selected.base&&(t.contentType||(post.platform==='dy'?'video':undefined))===type&&t.table!==selected.table);
 if(matches.length!==1)throw new Error(`请配置并选择${post.platform==='dy'?'抖音':'小红书'}${type==='image'?'图文':'视频'}专用目标表`);
 return matches[0];
}
