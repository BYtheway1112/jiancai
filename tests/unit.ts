import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import {normalize,numberValue,sizeAllowed,LIMIT,mergePost,migratePost,assertNextCursor,Target,postType} from '../src/collector/model';
import {Feishu,mappedFields,mediaUrl,mediaDownloadTimeout,Field} from '../src/collector/feishu';
import {workbook} from '../src/collector/excel';
const x=()=>normalize('xhs',{note_id:'abc',title:'=SUM(A1)',desc:'完整正文\n#话题',type:'video',user:{user_id:'u',nickname:'作者'},interact_info:{liked_count:'1.2万',collected_count:'0'},video:{capa:{duration:180},media:{stream:{h264:[{master_url:'https://sns-video-bd.xhscdn.com/test.mp4',size:100}]}}}},'https://www.xiaohongshu.com/explore/abc',undefined,1000);
const target:Target={id:'t',name:'test',contentType:'video',platform:'xhs',base:'base',table:'table',mapping:{笔记ID:'ID',笔记内容:'正文',点赞量:'赞',笔记视频:'视频'}};
const fields=[{field_id:'id',field_name:'ID',type:1},{field_id:'body',field_name:'正文',type:1},{field_id:'like',field_name:'赞',type:2},{field_id:'video',field_name:'视频',type:17}];
test('unknown numbers remain missing; zero stays zero',()=>{assert.equal(numberValue('1.2万'),12000);assert.equal(numberValue(null),undefined);assert.equal(x().fields['评论量'],undefined);assert.equal(x().fields['收藏量'],0);});
test('official 20 MB inclusive and unknown fails closed',()=>{assert.equal(LIMIT,20971520);assert.equal(sizeAllowed(LIMIT),true);for(const s of [LIMIT+1,undefined,NaN,0,-1])assert.equal(sizeAllowed(s),false);});
test('dedup updates fields and platform key isolates IDs',()=>{const p=x();const next={...p,fields:{笔记ID:'abc',点赞量:14000}};assert.equal(mergePost(p,next).fields['笔记内容'],p.fields['笔记内容']);assert.equal(mergePost(p,next).fields['点赞量'],14000);assert.notEqual(p.key,normalize('dy',{aweme_id:'abc'},'https://www.douyin.com/video/abc').key);});
test('invalid or repeated pagination stops',()=>{assert.throws(()=>assertNextCursor('a','a',true));assert.throws(()=>assertNextCursor(0,undefined,true));assert.doesNotThrow(()=>assertNextCursor('a','b',true));});
test('only mapped fields are written',()=>{const p=x();p.fields['手工备注']='do not overwrite';assert.deepEqual(mappedFields(p,target,fields),{ID:'abc',正文:'完整正文\n#话题',赞:12000});});
test('media only supported public https CDN',()=>{assert.throws(()=>mediaUrl('http://127.0.0.1/x'));assert.throws(()=>mediaUrl('https://xhscdn.com.evil.test/x'));assert.throws(()=>mediaUrl('https://u:p@xhscdn.com/x'));});
test('real XLSX roundtrip, platforms separated, formula text not executable',()=>{const wb=workbook([x(),normalize('dy',{aweme_id:'7675594554086657332',desc:'抖音完整内容'},'https://www.douyin.com/video/7675594554086657332')]);const data=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});fs.mkdirSync('../test-results',{recursive:true});fs.writeFileSync('../test-results/roundtrip.xlsx',data);const back=XLSX.read(data,{type:'buffer'});assert.deepEqual(back.SheetNames,['小红书视频','抖音视频']);const rows=XLSX.utils.sheet_to_json<any>(back.Sheets['小红书视频']);assert.equal(rows[0]['笔记内容'],'完整正文\n#话题');assert.equal(rows[0]['笔记标题'],'=SUM(A1)');const cells=Object.values(back.Sheets['小红书视频']);assert(!cells.some((c:any)=>c?.f));});

test('Douyin image posts prefer ordered original image URLs and keep image-only fields',()=>{
 const p=normalize('dy',{aweme_id:'dy-image',media_type:2,desc:'抖音图文',statistics:{digg_count:4},images:[
  {download_url_list:['https://p3.douyinpic.com/img/one~tplv-dy-water-v10.webp'],url_list:['https://p3.douyinpic.com/img/one.jpg']},
  {download_url_list:['https://p9.douyinpic.com/img/two~tplv-dy-water-v10.webp'],url_list:['https://p9.douyinpic.com/img/two.webp']},
 ]},'https://www.douyin.com/note/dy-image');
 assert.equal(postType(p),'image');
 assert.equal(p.fields['视频类型'],'图集');
 assert.equal(p.fields['图片数量'],2);
 assert.equal(p.fields['视频图片链接'],'https://p3.douyinpic.com/img/one.jpg\nhttps://p9.douyinpic.com/img/two.webp');
 assert.deepEqual(p.media.filter(m=>m.field==='视频图片').map(m=>m.url),['https://p3.douyinpic.com/img/one.jpg','https://p9.douyinpic.com/img/two.webp']);
 assert.equal(p.fields['视频时长'],undefined);assert.equal(p.fields['视频文件链接'],undefined);assert.equal(p.fields['音频文件链接'],undefined);
 const sheets=workbook([p]);assert.deepEqual(sheets.SheetNames,['抖音图文']);
});

test('Douyin image type survives a detail response with no usable image URL',()=>{
 const p=normalize('dy',{aweme_id:'dy-image-empty',media_type:2,desc:'图片暂未返回'},'https://www.douyin.com/note/dy-image-empty');
 assert.equal(postType(p),'image');assert.equal(p.fields['视频类型'],'图集');assert.equal(p.fields['图片数量'],0);assert.match(p.warnings.join(' '),/未取得图片原图链接/);
});

test('Douyin type detection uses media_type and does not infer image from URLs',()=>{
 const p=normalize('dy',{aweme_id:'dy-video-with-image',media_type:4,images:[{download_url_list:['https://p3.douyinpic.com/img/preview.jpg']}],video:{play_addr:{url_list:['https://p3.douyinvod.com/video.mp4']}}},'https://www.douyin.com/video/dy-video-with-image');
 assert.equal(postType(p),'video');
 assert.equal(p.fields['视频类型'],'视频');
 assert.equal(p.fields['视频文件链接'],'https://p3.douyinvod.com/video.mp4');
 assert.equal(p.fields['视频图片链接'],undefined);
});

test('merging a changed Douyin type removes stale media fields in both directions',()=>{
 const image=normalize('dy',{aweme_id:'same',media_type:2,images:[{url_list:['https://p3.douyinpic.com/img/a.jpg']}]},'https://www.douyin.com/note/same');
 const video=normalize('dy',{aweme_id:'same',media_type:4,video:{duration:1000,play_addr:{url_list:['https://p3.douyinvod.com/video.mp4'],data_size:10}},music:{play_url:{url_list:['https://p3.douyinstatic.com/a.mp3']}},statistics:{}},'https://www.douyin.com/video/same');
 const imageAfterVideo=mergePost({...video,fields:{...video.fields,'视频时长':'0:01','视频文件链接':'old','视频文件':'old','音频文件链接':'old','音频文件':'old'}},image);
 assert.equal(imageAfterVideo.fields['视频时长'],undefined);assert.equal(imageAfterVideo.fields['视频文件链接'],undefined);assert.equal(imageAfterVideo.fields['音频文件'],undefined);
 const videoAfterImage=mergePost({...image,fields:{...image.fields,'视频图片链接':'old','视频图片':'old','图片数量':1}},video);
 assert.equal(videoAfterImage.fields['视频图片链接'],undefined);assert.equal(videoAfterImage.fields['视频图片'],undefined);assert.equal(videoAfterImage.fields['图片数量'],undefined);
});
test('legacy Douyin image records migrate old image attachments and stale video fields',()=>{
 const current=normalize('dy',{aweme_id:'legacy-image',media_type:2,images:[{url_list:['https://p3.douyinpic.com/img/one.jpg']},{url_list:['https://p3.douyinpic.com/img/two.jpg']} ]},'https://www.douyin.com/note/legacy-image');
 const legacy={...current,fields:{...current.fields,'视频类型':'视频','视频时长':'0:02','视频文件链接':'legacy-video','音频文件链接':'legacy-audio','音频文件':'legacy-audio'},media:current.media.map(item=>item.field==='视频图片'?{...item,field:'视频文件',name:item.name.replace('-视频图片-','-视频文件-')}:item).concat([{field:'音频文件',url:'https://p3.douyinstatic.com/audio.mp3',name:'legacy-image-音频文件-1.mp3'}])};
 const migrated=migratePost(legacy);
 assert.equal(migrated.fields['视频时长'],undefined);assert.equal(migrated.fields['视频文件链接'],undefined);assert.equal(migrated.fields['音频文件链接'],undefined);assert.equal(migrated.fields['音频文件'],undefined);
 assert.deepEqual(migrated.media.filter(item=>item.field==='视频图片').map(item=>item.name),['legacy-image-视频图片-1.jpg','legacy-image-视频图片-2.jpg']);
 assert.equal(migrated.media.some(item=>item.field==='视频文件'||item.field==='音频文件'),false);
 assert.equal(migratePost(migrated),migrated);
});
test('oversized and unknown media never uploaded',async()=>{const original=globalThis.fetch;let uploads=0;globalThis.fetch=async(url:any)=>{if(String(url).includes('upload_all'))uploads++;return new Response('',{status:200});};try{const f=new Feishu({appId:'a',secret:'b'});await assert.rejects(f.attachment({field:'视频',url:'https://sns-video-bd.xhscdn.com/x',name:'x.mp4',size:LIMIT+1},'base'),/20 MB/);await assert.rejects(f.attachment({field:'视频',url:'https://sns-video-bd.xhscdn.com/x',name:'x.mp4'},'base'),/无法确认/);assert.equal(uploads,0);}finally{globalThis.fetch=original;}});
test('actual overlimit response stops before upload',async()=>{const original=globalThis.fetch;let uploads=0;globalThis.fetch=async(url:any,init:any)=>{if(String(url).includes('upload'))uploads++;if(init?.method==='HEAD')return new Response(null,{headers:{'content-length':'10'}});return new Response(new Uint8Array(LIMIT+1),{headers:{'content-type':'video/mp4'}});};try{await assert.rejects(new Feishu({appId:'a',secret:'b'}).attachment({field:'视频',url:'https://sns-video-bd.xhscdn.com/x',name:'x.mp4'},'base'),/实际文件超过/);assert.equal(uploads,0);}finally{globalThis.fetch=original;}});
test('retry after metadata success uses existing ID; partial attachment reported',async()=>{class Fake extends Feishu{record:any;writes:string[]=[];async fields(){return fields;}async attachment():Promise<any>{throw new Error('超过 20 MB，仅保存链接');}async call(path:string,method='GET',body?:any):Promise<any>{if(path.includes('/search'))return {items:this.record?[this.record]:[]};if(method==='POST'||method==='PUT'){this.writes.push(method);this.record={record_id:'r',fields:{...this.record?.fields,...body.fields,手写:'保留'}};return {record:this.record};}return {record:this.record};}}const f=new Fake({appId:'a',secret:'b'});const first=await f.sync(x(),target);assert.equal(first.updated,false);assert.equal(first.warnings.length,1);const second=await f.sync(x(),target);assert.equal(second.updated,true);assert.deepEqual(f.writes,['POST','PUT']);assert.equal(f.record.fields.手写,'保留');});
test('duplicate remote IDs refuse writes',async()=>{class Fake extends Feishu{async fields(){return fields;}async call(){return {items:[{record_id:'1'},{record_id:'2'}]};}}await assert.rejects(new Fake({appId:'a',secret:'b'}).sync(x(),target),/多个相同/);});
import {eagleAssets,eaglePayload,eagleTags} from '../src/collector/eagle';
test('Eagle saves originals over 20 MB, preserves source and order',()=>{const p=x();p.media[0].size=LIMIT+1;p.media.push({field:'笔记封面',url:'https://sns-img-bd.xhscdn.com/a.jpg',name:'cover.jpg'});assert.equal(eagleAssets(p).length,1);const payload=eaglePayload(p,0,'folder');assert.equal(payload.folderId,'folder');assert.equal(payload.website,p.fields['笔记链接']);assert(payload.annotation.includes('完整正文\n#话题'));assert(payload.name.startsWith('[xhs-abc-1]'));});
test('Eagle metadata is typed, searchable and keeps the full post copy',()=>{const p=x();p.fields['笔记话题']=['测试话题'];const payload=eaglePayload(p,0);assert.equal(payload.annotation.includes('作品类型：小红书视频'),true);assert.equal(payload.annotation.includes('素材字段：笔记视频'),true);assert.equal(payload.annotation.includes('来源文案：完整正文\n#话题'),true);assert.deepEqual(payload.tags,['简采','小红书','视频','测试话题']);assert.deepEqual(eagleTags(p),payload.tags);});
test('Eagle payload mirrors Feishu metadata for all four platform and media types',()=>{
 const samples=[
  normalize('xhs',{note_id:'xhs-image',title:'小红书图文标题',desc:'小红书完整正文\n#图文',type:'normal',user:{user_id:'xu',nickname:'小红书作者'},image_list:[{url_default:'https://sns-img-bd.xhscdn.com/xhs-image-1.jpg'},{url_default:'https://sns-img-bd.xhscdn.com/xhs-image-2.jpg'}],tag_list:[{name:'小红书话题'}]},'https://www.xiaohongshu.com/explore/xhs-image'),
  x(),
  normalize('dy',{aweme_id:'dy-video',desc:'抖音视频文案\n#视频',media_type:4,author:{uid:'du',nickname:'抖音作者'},statistics:{},video:{play_addr:{url_list:['https://p3.douyinvod.com/dy-video.mp4']}}},'https://www.douyin.com/video/dy-video'),
  normalize('dy',{aweme_id:'dy-image',desc:'抖音图文文案\n#图集',media_type:2,author:{uid:'du',nickname:'抖音图文作者'},statistics:{},images:[{url_list:['https://p3.douyinpic.com/dy-image-1.jpg']},{url_list:['https://p3.douyinpic.com/dy-image-2.jpg']}]},'https://www.douyin.com/note/dy-image')
 ];
 assert.deepEqual(samples.map(postType),['image','video','video','image']);
 for(const post of samples){
  const assets=eagleAssets(post);assert(assets.length>0);
  const payload=eaglePayload(post,0);
  assert.match(payload.annotation,/简采元数据：3/);
  assert.match(payload.annotation,/【来源文案】/);
  assert.match(payload.annotation,/【检索摘要】/);
  assert.match(payload.annotation,/【可借鉴】/);
  assert.match(payload.annotation,/【制作路线】/);
  assert.match(payload.annotation,/【核对说明】/);
  assert.match(payload.annotation,/【来源链接】/);
  assert.match(payload.annotation,/平台：(小红书|抖音)/);
  assert.match(payload.annotation,/作品类型：/);
  assert.match(payload.annotation,/内容标题：/);
  assert.match(payload.annotation,/来源文案：/);
  assert.match(payload.annotation,/完整采集字段：/);
  assert.match(payload.annotation,/素材序号：1\//);
  assert(payload.name.includes(post.platform==='xhs'?'小红书':'抖音'));
  assert.equal(payload.website,post.fields[post.platform==='xhs'?'笔记链接':'视频链接']);
 }
 const image=eaglePayload(samples[3],1);
 assert.match(image.annotation,/素材序号：2\/2/);
 assert.match(image.annotation,/素材文件名：dy-image-视频图片-2\.jpg/);
});
test('XHS page snapshot camelCase retains counters and original media',()=>{
 const p=normalize('xhs',{noteId:'snapshot',type:'video',user:{userId:'author',nickname:'作者'},interactInfo:{likedCount:'123',collectedCount:'0',commentCount:'5'},imageList:[{urlDefault:'https://sns-img-bd.xhscdn.com/cover.jpg'}],video:{media:{stream:{h264:[{masterUrl:'https://sns-video-bd.xhscdn.com/original.mp4'}]}}}},'https://www.xiaohongshu.com/explore/snapshot');
 assert.equal(p.fields['点赞量'],123);assert.equal(p.fields['收藏量'],0);assert.equal(p.fields['评论量'],5);assert.equal(p.fields['博主ID'],'author');assert.equal(p.media.length,2);assert.equal(p.fields['笔记视频链接'],'https://sns-video-bd.xhscdn.com/original.mp4');
});
import {assertSamePost} from '../src/collector/model';
test('multi-page cursor cycle stops and post navigation cancels stale actions',()=>{
 assert.throws(()=>assertNextCursor('b','a',true,new Set(['a','b'])),/循环/);
 const expected={platform:'xhs' as const,id:'old',kind:'post'};
 assert.doesNotThrow(()=>assertSamePost(expected,{...expected}));
 for(const actual of [undefined,{...expected,id:'new'},{...expected,kind:'author'},{...expected,platform:'dy' as const}])assert.throws(()=>assertSamePost(expected,actual),/页面已切换/);
});
test('partial image retry appends missing files and preserves user attachments',async()=>{
 const post=normalize('xhs',{note_id:'images',type:'normal',image_list:[{url_default:'https://sns-img-bd.xhscdn.com/1.jpg'},{url_default:'https://sns-img-bd.xhscdn.com/2.jpg'}]},'https://www.xiaohongshu.com/explore/images');
 const t:Target={...target,contentType:'image',mapping:{笔记ID:'ID',笔记图片:'图片'}};
 class Fake extends Feishu{
  record:any={record_id:'r',fields:{ID:'images',手写:'保留',图片:[{file_token:'manual',name:'用户附件.jpg'}]}};
  attempts:string[]=[];fail=true;
  async fields(){return [{field_id:'id',field_name:'ID',type:1},{field_id:'images',field_name:'图片',type:17}];}
  async attachment(m:any){this.attempts.push(m.name);if(m.name.endsWith('-2-原图.jpg')&&this.fail)throw new Error('temporary failure');return {file_token:m.name};}
  async call(path:string,method='GET',body?:any):Promise<any>{
   if(path.includes('/search'))return {items:[structuredClone(this.record)]};
   if(method==='PUT'){
    const update=structuredClone(body.fields);
    if(update.图片)update.图片=update.图片.map((f:any)=>({file_token:f.file_token,name:f.file_token==='manual'?'用户附件.jpg':f.file_token}));
    this.record.fields={...this.record.fields,...update};
   }
   return {record:structuredClone(this.record)};
  }
 }
 const f=new Fake({appId:'a',secret:'b'});
 const first=await f.sync(post,t);assert.equal(first.warnings.length,1);assert.equal(f.record.fields.图片.length,2);
 f.fail=false;const second=await f.sync(post,t);assert.equal(second.warnings.length,0);assert.equal(f.record.fields.图片.length,3);assert.equal(f.record.fields.图片[0].file_token,'manual');assert.equal(f.record.fields.手写,'保留');
 assert.equal(f.attempts.filter(n=>n.endsWith('-1-原图.jpg')).length,1);assert.equal(f.attempts.filter(n=>n.endsWith('-2-原图.jpg')).length,2);
 await f.sync(post,t);assert.equal(f.attempts.length,3);
});
test('XHS underscored codec names resolve original video streams',()=>{
 const p=normalize('xhs',{note_id:'codec',type:'video',video:{media:{stream:{h_264:[{master_url:'https://sns-video-bd.xhscdn.com/low.mp4',size:100}],h_265:[{master_url:'https://sns-video-bd.xhscdn.com/high.mp4',size:200}]}}}},'https://www.xiaohongshu.com/explore/codec');
 assert.equal(p.fields['笔记视频链接'],'https://sns-video-bd.xhscdn.com/high.mp4');assert.equal(p.media[0].size,200);
});
test('public Douyin play-count placeholder is blank without discarding real zero likes',()=>{
 const p=normalize('dy',{aweme_id:'dy',statistics:{play_count:0,digg_count:0}},'https://www.douyin.com/video/dy');assert.equal(p.fields['播放量'],undefined);assert.equal(p.fields['点赞量'],0);
 assert.equal(mergePost({...p,fields:{...p.fields,播放量:123}},p).fields['播放量'],undefined);
 const t:Target={...target,platform:'dy',mapping:{视频ID:'ID',播放量:'播放'}};
 assert.deepEqual(mappedFields(p,t,[...fields,{field_id:'plays',field_name:'播放',type:2}]),{ID:'dy',播放:null});
 assert.equal(normalize('dy',{aweme_id:'dy',statistics:{play_count:123}},'https://www.douyin.com/video/dy').fields['播放量'],123);
});
import {fieldDefinition} from '../src/collector/model';
test('missing mapped columns are created once, with compatible types and readback',async()=>{
 class Fake extends Feishu{
  cols:Field[]=[{field_id:'manual',field_name:'手工备注',type:1}];writes:any[]=[];
  async fields(){return structuredClone(this.cols);}
  async call(path:string,method='GET',body?:any):Promise<any>{assert.equal(method,'POST');this.writes.push(body);this.cols.push({...body,field_id:String(this.cols.length)});return {field:this.cols.at(-1)};}
 }
 const f=new Fake({appId:'a',secret:'b'});const t:Target={...target,mapping:{笔记ID:'ID',笔记内容:'正文',点赞量:'点赞',笔记视频:'视频',采集时间:'采集日期',笔记链接:'来源',笔记封面:''}};
 await f.ensureFields(t);assert.equal(f.writes.length,6);assert.deepEqual(f.writes.map(x=>x.type),[1,1,2,17,5,15]);await f.ensureFields(t);assert.equal(f.writes.length,6);assert.equal(f.cols[0].field_name,'手工备注');assert.equal(fieldDefinition('视频ID').type,1);
});
test('ambiguous field creation is resolved by readback without duplicate creation',async()=>{
 class Fake extends Feishu{
  cols:Field[]=[];writes=0;
  async fields(){return this.cols;}
  async call(path:string,method='GET',body?:any):Promise<any>{this.writes++;this.cols.push({...body,field_id:'new'});throw new Error('request timed out');}
 }
 const f=new Fake({appId:'a',secret:'b'});const t={...target,mapping:{笔记ID:'ID'}};assert.equal((await f.ensureFields(t)).length,1);assert.equal(f.writes,1);
});
test('delayed field visibility retries reads after success or timeout, never creates twice',async()=>{
 for(const ambiguous of [false,true]){
  class Fake extends Feishu{
   writes=0;readsAfterWrite=0;column:Field|undefined;
   async fields(){return this.column&&++this.readsAfterWrite>=3?[this.column]:[];}
   async call(path:string,method='GET',body?:any):Promise<any>{
    this.writes++;this.column={...body,field_id:'new'};
    if(ambiguous)throw new Error('request timed out');
    return {field:this.column};
   }
  }
  const f=new Fake({appId:'a',secret:'b'});
  const columns=await f.ensureFields({...target,mapping:{笔记ID:'ID'}});
  assert.equal(columns[0].field_id,'new');assert.equal(f.writes,1);assert.equal(f.readsAfterWrite,3);
 }
});
test('unconfirmed field creation stops before record writes with a bounded number of reads',async()=>{
 class Fake extends Feishu{
  writes=0;reads=0;
  async fields(){this.reads++;return [];}
  async call(path:string,method='GET',body?:any):Promise<any>{assert(path.endsWith('/fields'));this.writes++;return {};}
 }
 const f=new Fake({appId:'a',secret:'b'});
 await assert.rejects(f.sync(x(),{...target,mapping:{笔记ID:'ID'}}),/创建后未能回读/);
 assert.equal(f.writes,1);assert.equal(f.reads,5);
});

test('XHS EF stream groups retain original URLs without relying on codec group names',()=>{
 const p=normalize('xhs',{noteId:'ef',type:'video',video:{media:{stream:{EF4:[{masterUrl:'https://sns-video-bd.xhscdn.com/720.mp4',size:18373187}],EF5:[{masterUrl:'https://sns-video-bd.xhscdn.com/1080.mp4',size:24966711}],EF6:[],metadata:{size:99999999}}}}},'https://www.xiaohongshu.com/explore/ef');
 assert.equal(p.fields['笔记视频链接'],'https://sns-video-bd.xhscdn.com/1080.mp4');assert.equal(p.media[0].size,24966711);
});

import {resolveTarget} from '../src/collector/model';
test('XHS image and video route to distinct tables; absent or ambiguous routes fail',()=>{
 const pic=normalize('xhs',{note_id:'pic',type:'normal'},'https://www.xiaohongshu.com/explore/pic');
 const imageTarget:Target={...target,id:'image',contentType:'image',table:'images'};
 assert.equal(resolveTarget(pic,target,[target,imageTarget]).table,'images');
 assert.throws(()=>resolveTarget(pic,target,[target]));
 assert.throws(()=>resolveTarget(pic,target,[target,imageTarget,{...imageTarget,id:'other',table:'other'}]));
 const wb=workbook([x(),pic]);assert.deepEqual(wb.SheetNames,['小红书视频','小红书图文']);
});
test('record verification tolerates delayed fields without rewriting the record',async()=>{
 class Fake extends Feishu{
  writes=0;reads=0;record:any;
  async fields(){return fields;}
  async call(path:string,method='GET',body?:any):Promise<any>{
   if(path.includes('/search'))return {items:[]};
   if(method==='POST'){this.writes++;this.record={record_id:'r',fields:body.fields};return {record:this.record};}
   this.reads++;return {record:this.reads<3?{record_id:'r',fields:{...this.record.fields,赞:1}}:this.record};
  }
 }
 const f=new Fake({appId:'a',secret:'b'});const p=x();p.media=[];
 assert.equal((await f.sync(p,target)).recordId,'r');assert.equal(f.writes,1);assert.equal(f.reads,3);
});
test('XHS mismatched target rejects before remote reads or writes',async()=>{
 class Fake extends Feishu{async fields():Promise<Field[]>{throw new Error('unexpected remote access');}}
 await assert.rejects(new Fake({appId:'a',secret:'b'}).sync(x(),{...target,contentType:'image'}),/专用表/);
});

import {sameFieldValue} from '../src/collector/feishu';
test('Feishu numeric-string readback compares numeric fields while preserving text IDs',()=>{
 assert(sameFieldValue(11,'11',2));assert(sameFieldValue(0,'0',2));assert(!sameFieldValue(11,'12',2));
 assert(!sameFieldValue('001','1',1));assert(!sameFieldValue(11,'11',1));
 assert(sameFieldValue('',null,1));assert(sameFieldValue('',undefined,1));assert(!sameFieldValue(0,null,2));assert(!sameFieldValue(false,null,1));
 for(const v of ['',null,'11abc','NaN','Infinity'])assert(!sameFieldValue(11,v,2));
});
import {appearance,preferencePatch} from '../src/collector/preferences';
test('popup preferences merge toggles and separate XHS defaults without accepting credentials',()=>{
 assert.equal(appearance({eagle:false}).download,true);assert.equal(appearance({eagle:false}).eagle,false);
 const image:Target={...target,id:'image',contentType:'image',table:'images'};
 assert.deepEqual(preferencePatch({targetId:'image',secret:'ignore'},[target,image]),{targets:{'xhs:image':'image'}});
 assert.throws(()=>preferencePatch({targetId:'missing'},[target]));
 assert.throws(()=>preferencePatch({appearance:{eagle:'false'}},[target]));
});
test('disabled Feishu media uploads still save metadata and never call attachment upload',async()=>{
 class Fake extends Feishu{
  record:any;async fields(){return fields;}
  async attachment():Promise<any>{throw new Error('must not upload');}
  async call(path:string,method='GET',body?:any):Promise<any>{if(path.includes('/search'))return {items:[]};if(method==='POST')this.record={record_id:'r',fields:body.fields};return {record:this.record};}
 }
 const result=await new Fake({appId:'a',secret:'b'}).sync(x(),target,{uploadMedia:false});assert.equal(result.recordId,'r');assert.deepEqual(result.warnings,[]);
});

import {chooseSyncTarget} from '../src/collector/preferences';
test('popup defaults route by post type while explicit target choices remain effective',()=>{
 const a=target,b={...target,id:'preferred',table:'second'},other={...target,id:'other',base:'otherBase',table:'remote'};
 assert.equal(chooseSyncTarget(x(),a,[a,b,other],{'xhs:video':'preferred'},true).id,'preferred');
 assert.equal(chooseSyncTarget(x(),a,[a,b],{'xhs:video':'preferred'},false).id,a.id);
 assert.equal(chooseSyncTarget(x(),a,[a,other],{'xhs:video':'other'},true).id,'other');
 const image=normalize('xhs',{note_id:'pic',type:'normal'},'https://www.xiaohongshu.com/explore/pic');
 assert.throws(()=>chooseSyncTarget(image,a,[a],{},true));
});

test('Douyin defaults route image and video posts to independent targets while legacy defaults stay video',()=>{
 const video=normalize('dy',{aweme_id:'route-video',media_type:4},'https://www.douyin.com/video/route-video');
 const image=normalize('dy',{aweme_id:'route-image',media_type:2,images:[{url_list:['https://p3.douyinpic.com/img/a.jpg']}]},'https://www.douyin.com/note/route-image');
 const videoTarget:Target={id:'dy-video',name:'抖音视频',platform:'dy',contentType:'video',base:'dy-base',table:'videos',mapping:{}};
 const imageTarget:Target={id:'dy-image',name:'抖音图文',platform:'dy',contentType:'image',base:'dy-base',table:'images',mapping:{}};
 assert.equal(chooseSyncTarget(image,videoTarget,[videoTarget,imageTarget],{'dy:video':'dy-video','dy:image':'dy-image'},true).id,'dy-image');
 assert.equal(chooseSyncTarget(video,imageTarget,[videoTarget,imageTarget],{'dy:video':'dy-video','dy:image':'dy-image'},true).id,'dy-video');
 assert.equal(chooseSyncTarget(video,videoTarget,[videoTarget],{},true).id,'dy-video');
});

test('toolbar button preferences preserve old settings and allow all entries hidden',()=>{const previous=appearance({download:false,eagle:false,feishu:true});assert.equal(previous.more,true);const patch=preferencePatch({appearance:{more:false}},[]);const updated=appearance({...previous,...patch.appearance});assert.equal(updated.download,false);assert.equal(updated.feishu,true);assert.equal(updated.more,false);assert.throws(()=>preferencePatch({appearance:{more:'false'}},[]));const legacy=appearance({collect:false} as any);assert.equal(legacy.more,true);});

test('attachment network failures identify the failing stage and never upload a partial download',async()=>{
 const original=globalThis.fetch;let uploads=0;
 class Fake extends Feishu{async call():Promise<any>{uploads++;throw new Error('network error');}}
 const media={field:'笔记视频',url:'https://sns-webpic-qc.xhscdn.com/test.mp4',name:'test.mp4',size:3};
 try{
  for(const stage of ['connect','read','upload']){
   uploads=0;
   globalThis.fetch=async(_url:any,init:any)=>{
    if(init?.method==='HEAD')return new Response(null,{headers:{'content-length':'3'}});
    if(stage==='connect')throw new Error('network error');
    if(stage==='read')return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.error(new Error('network error'));}}),{headers:{'content-type':'video/mp4'}});
    return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'video/mp4'}});
   };
   // Connect/read failures retry to exhaustion and degrade to the calm
   // link-only notice; upload failures still surface the Feishu stage.
   await assert.rejects(new Fake({appId:'a',secret:'b'}).attachment(media,'base'),stage==='upload'?/飞书附件上传失败/:/素材下载不稳定，本次仅保存链接/);
   assert.equal(uploads,stage==='upload'?1:0);
  }
 }finally{globalThis.fetch=original;}
});

test('interrupted media download retries once without cache and discards partial bytes',async()=>{
 const original=globalThis.fetch;let downloads=0,uploads=0;
 class Fake extends Feishu{async call(_path:string,_method:string,body:any):Promise<any>{uploads++;assert.equal(body.get('size'),'3');assert.deepEqual([...new Uint8Array(await body.get('file').arrayBuffer())],[1,2,3]);return {file_token:'ok'};}}
 try{
  globalThis.fetch=async(_url:any,init:any)=>{
   if(init?.method==='HEAD')return new Response(null,{headers:{'content-length':'3'}});
   downloads++;assert.equal(init.cache,'no-store');
   if(downloads===1){let pulls=0;return new Response(new ReadableStream({pull(c){if(pulls++===0)c.enqueue(new Uint8Array([9]));else c.error(new Error('network error'));}}),{headers:{'content-type':'video/mp4'}});}
   return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'video/mp4'}});
  };
  assert.deepEqual(await new Fake({appId:'a',secret:'b'}).attachment({field:'笔记视频',url:'https://sns-webpic-qc.xhscdn.com/test.mp4',name:'test.mp4'},'base'),{file_token:'ok'});
  assert.equal(downloads,2);assert.equal(uploads,1);
 }finally{globalThis.fetch=original;}
});

test('media download timeout scales with known size and stays clamped 45-120s',()=>{
 assert.equal(mediaDownloadTimeout(undefined),45000);
 assert.equal(mediaDownloadTimeout(0),45000);
 assert.equal(mediaDownloadTimeout(1024*1024),45000);
 assert.equal(mediaDownloadTimeout(5*1048576),75000);
 assert.equal(mediaDownloadTimeout(10*1048576),120000);
 assert.equal(mediaDownloadTimeout(50*1048576),120000);
});

test('exhausted media downloads degrade to a calm link-only notice instead of a raw network error',async()=>{
 const original=globalThis.fetch;let downloads=0;
 try{
  globalThis.fetch=async(_url:any,init:any)=>{
   if(init?.method==='HEAD')return new Response(null,{headers:{'content-length':'3'}});
   downloads++;
   return new Response(new ReadableStream({start(c){c.error(new Error('network error'));}}),{headers:{'content-type':'video/mp4'}});
  };
  await assert.rejects(()=>new Feishu({appId:'a',secret:'b'}).attachment({field:'笔记视频',url:'https://sns-webpic-qc.xhscdn.com/test.mp4',name:'test.mp4'},'base'),/素材下载不稳定，本次仅保存链接/);
  assert.equal(downloads,3);
 }finally{globalThis.fetch=original;}
});

const imageTarget:Target={id:'t2',name:'test-image',contentType:'image',platform:'xhs',base:'base',table:'table',mapping:{笔记ID:'ID',笔记图片链接:'图片链接',笔记图片:'图片'}};
const imageColumns=[
 {field_id:'id',field_name:'ID',type:1},
 {field_id:'links',field_name:'图片链接',type:1},
 {field_id:'imgs',field_name:'图片',type:17},
];
function imagePost(sizes:number[]){
 const p=normalize('xhs',{note_id:'grp',title:'t',desc:'d',type:'img',image_list:sizes.map((_,i)=>({url:`https://ci.xiaohongshu.com/img${i}`})),user:{user_id:'u',nickname:'n'}},'https://www.xiaohongshu.com/explore/grp',undefined,1000);
 p.media.forEach((m,i)=>{m.size=sizes[i];});
 return p;
}
async function runImageSync(p:ReturnType<typeof imagePost>,uploads:{n:number}){
 const original=globalThis.fetch;let saved:any={};
 class Fake extends Feishu{async call(path:string,method:string='GET',body:any):Promise<any>{
  if(path.includes('/fields'))return {items:imageColumns};
  if(path.endsWith('/search?page_size=2'))return {items:[],has_more:false};
  if(path.includes('/records')&&!path.includes('search')&&method!=='GET'){if(body instanceof FormData){uploads.n++;return {file_token:'tk'};}saved=body.fields;return {record:{record_id:'r1'}};}
  return {record:{fields:saved}};
 }}
 try{globalThis.fetch=async()=>{throw new Error('network should not be touched when sizes are known');};
  return await new Fake({appId:'a',secret:'b'}).sync(p,imageTarget,{});
 }finally{globalThis.fetch=original;}
}

test('images below the official 20 MB limit are attempted individually',async()=>{
 const uploads={n:0};
 const result=await runImageSync(imagePost([1024,16*1024*1024,1024]),uploads);
 assert.equal(uploads.n,0);
 assert.ok(!result.warnings.some(w=>w.includes('整组仅保存链接')),result.warnings.join(' | '));
 assert.ok(result.warnings.some(w=>w.includes('笔记图片-')),result.warnings.join(' | '));
});
