import {Target,Post,postType,resolveTarget} from './model';
export interface Appearance {download:boolean;more:boolean;eagle:boolean;feishu:boolean;uploadMedia:boolean}
export const defaultAppearance:Appearance={download:true,more:true,eagle:true,feishu:true,uploadMedia:true};
export function appearance(value:Partial<Appearance>={}):Appearance{return Object.fromEntries(Object.entries(defaultAppearance).map(([key,v])=>[key,typeof value[key as keyof Appearance]==='boolean'?value[key as keyof Appearance]:v])) as unknown as Appearance;}
export function routeKey(t:Target){return t.platform==='xhs'?`xhs:${t.contentType||'unconfigured'}`:`dy:${t.contentType||'video'}`;}
export function preferencePatch(data:any,targets:Target[]){
 const patch:any={};
 if(data?.appearance){patch.appearance={};for(const key of Object.keys(defaultAppearance)){if(key in data.appearance){if(typeof data.appearance[key]!=='boolean')throw new Error('开关值无效');patch.appearance[key]=data.appearance[key];}}}
 if(data?.targetId){const target=targets.find(t=>t.id===data.targetId);if(!target)throw new Error('目标配置不存在');if(target.platform==='xhs'&&!target.contentType)throw new Error('请先设置目标的图文或视频类型');if(target.contentType&&!['video','image'].includes(target.contentType))throw new Error('目标作品类型无效');patch.targets={[routeKey(target)]:target.id};}
 if(!patch.appearance&&!patch.targets)throw new Error('没有可保存的设置');return patch;
}

export function chooseSyncTarget(post:Post,selected:Target,targets:Target[],defaults:Record<string,string>={},useDefault=false){
 if(selected.platform!==post.platform)throw new Error('作品平台与目标表不一致');
 const type=postType(post);
 const key=post.platform==='xhs'?`xhs:${type}`:`dy:${type}`;
 const legacy=post.platform==='dy'&&type==='video'?defaults.dy:undefined;
 const preferred=targets.find(t=>t.id===(defaults[key]||legacy)&&(useDefault||t.base===selected.base));
 const selectedType=selected.contentType||(post.platform==='dy'?'video':undefined);
 const candidate=useDefault&&preferred?preferred:selectedType===type?selected:preferred||selected;
 return resolveTarget(post,candidate,targets);
}
