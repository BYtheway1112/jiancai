import {sendMessage} from '../utils/messaging';
export async function rpc<T=any>(action:string,data?:any):Promise<T>{const r:any=await sendMessage('compact',{action,data});if(!r?.ok)throw new Error(r?.error||'扩展后台未响应，请刷新网页');return r.data;}
