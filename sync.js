/* My Anchor V7.1: authenticated, optimistic, durable cross-device sync. */
(function(root){
'use strict';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const copy=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function identity(x){if(!object(x))return null;return x.id||x.studyTaskId||x.sentAt||null}
function merge(before,after,remote,path=''){
 if(same(before,after))return copy(remote);
 if(after===undefined)return undefined;
 // A remote deletion wins over an edit to a previously existing item.
 if(before!==undefined&&remote===undefined)return undefined;
 if(before===undefined&&object(after)&&object(remote))before={};
 if(before===undefined&&Array.isArray(after)&&Array.isArray(remote))before=[];
 if(before===undefined&&path.startsWith('/ticketWallet/')&&typeof after==='number'&&typeof remote==='number')return remote+after;
 if(object(before)&&object(after)&&object(remote)){
  const result=copy(remote);
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
   if(['__proto__','prototype','constructor'].includes(key))continue;
   if(same(before[key],after[key]))continue;
   const value=merge(before[key],after[key],remote[key],path+'/'+key);
   if(value===undefined)delete result[key];else result[key]=value;
  }return result;
 }
 if(Array.isArray(before)&&Array.isArray(after)&&Array.isArray(remote)){
  if([...before,...after,...remote].every(x=>identity(x))){
   const old=new Map(before.map(x=>[identity(x),x])),next=new Map(after.map(x=>[identity(x),x])),result=new Map(remote.map(x=>[identity(x),copy(x)]));
   for(const id of new Set([...old.keys(),...next.keys()])){
    if(same(old.get(id),next.get(id)))continue;
    const value=merge(old.get(id),next.get(id),result.get(id),path+'/'+id);
    if(value===undefined)result.delete(id);else result.set(id,value);
   }return [...result.values()];
  }
  // Preserve duplicates (for example two identical legacy ticket entries).
  const count=list=>{const m=new Map();list.forEach(x=>{const k=JSON.stringify(x);m.set(k,(m.get(k)||0)+1)});return m};
  const old=count(before),next=count(after),result=copy(remote);
  for(const key of new Set([...old.keys(),...next.keys()])){
   const delta=(next.get(key)||0)-(old.get(key)||0);
   if(delta>0)for(let i=0;i<delta;i++)result.push(JSON.parse(key));
   if(delta<0)for(let i=0;i<-delta;i++){const index=result.findIndex(x=>JSON.stringify(x)===key);if(index>=0)result.splice(index,1)}
  }return result;
 }
 if(path.startsWith('/ticketWallet/')&&typeof before==='number'&&typeof after==='number'&&typeof remote==='number')return Math.max(0,remote+after-before);
 return copy(after);
}
const enc=k=>k.replace(/^myAnchorV2\./,'');
const decode=v=>{if(v===null||v===undefined)return undefined;try{return JSON.parse(v)}catch(e){return v}};
const encode=v=>v===undefined?null:JSON.stringify(v);
function mergeValue(key,before,after,remote){
 // Values are stored as strings to preserve the existing local data format.
 const isJSON=v=>{try{JSON.parse(v);return v!==null}catch(e){return false}};
 if(after===null)return null;
 if(before===null){
  if(isJSON(after)&&isJSON(remote))return encode(merge(undefined,decode(after),decode(remote),'/'+key));
  return after;
 }
 if(!isJSON(before)||!isJSON(after))return after;
 const value=merge(decode(before),decode(after),decode(remote),'/'+key);
 return encode(value);
}
function applyOperations(doc,ops){
 const result=copy(doc);if(!ops.length)return {doc:result,discarded:0};result.data=result.data||{};result.applied=result.applied||{};
 let discarded=0;
 for(const op of ops){
  if((result.applied[op.client]||0)>=op.seq)continue;
  if(op.epoch!==result.epoch){discarded++;result.applied[op.client]=op.seq;continue}
  if(op.reset){result.data=copy(op.keep);result.epoch=op.nextEpoch}
  else{const key=enc(op.key),value=mergeValue(key,op.before,op.after,result.data[key]??null);if(value===null)delete result.data[key];else result.data[key]=value}
  result.applied[op.client]=op.seq;
 }
 return {doc:result,discarded};
}
const exported={merge,mergeValue,applyOperations};
if(typeof module!=='undefined'&&module.exports){module.exports=exported;return}
const native=root.localStorage,AUTH='anchorSync.auth',CONFIG='anchorSync.config',QUEUE='anchorSync.queue',BACKUP='anchorSync.backup',EPOCH='anchorSync.epoch';
const sharedKey=k=>/^myAnchorV2\./.test(k)&&!['myAnchorV2.trialResetV6025','myAnchorV2.sapixDraftRanges'].includes(k);
const read=(key,fallback)=>{try{return JSON.parse(native.getItem(key))??fallback}catch(e){return fallback}};
const uid=()=>root.crypto.randomUUID();
let client=root.sessionStorage.getItem('anchorSync.client');if(!client){client=uid();root.sessionStorage.setItem('anchorSync.client',client)}
let config=read(CONFIG,null),auth=read(AUTH,null),epoch=read(EPOCH,null),busy=false,paused=true,silent=false,seq=Number(root.sessionStorage.getItem('anchorSync.seq')||0),timer=null;
let currentStatus='この端末に保存しています';
let queue=read(QUEUE,[]);
const status=(message)=>{currentStatus=message;const el=document.getElementById('syncStatus');if(el)el.textContent=message};
function snapshot(){const result={};for(let i=0;i<native.length;i++){const key=native.key(i);if(sharedKey(key))result[enc(key)]=native.getItem(key)}return result}
function backup(reason){native.setItem(BACKUP,JSON.stringify({at:new Date().toISOString(),reason,data:snapshot()}))}
function persistQueue(){native.setItem(QUEUE,JSON.stringify(queue))}
function operation(fields){seq++;root.sessionStorage.setItem('anchorSync.seq',String(seq));return {client,seq,epoch,...fields}}
function changed(key,before,after){if(silent||!sharedKey(key)||same(before,after)||!auth||!config)return;queue=read(QUEUE,queue);queue.push(operation({key,before,after}));persistQueue();status('この端末に保存済み・共有待ち');schedule()}
const storage={getItem:key=>native.getItem(key),setItem(key,value){const before=native.getItem(key);native.setItem(key,value);changed(key,before,String(value))},removeItem(key){const before=native.getItem(key);native.removeItem(key);changed(key,before,null)},key:i=>native.key(i),get length(){return native.length}};
root.anchorStorage=storage;
function reset(run){if(!auth||!config)return run();const original=epoch;silent=true;try{run()}finally{silent=false}const keep=snapshot();const next=uid();queue=read(QUEUE,queue);queue.push(operation({reset:true,keep,epoch:original,nextEpoch:next}));epoch=next;native.setItem(EPOCH,JSON.stringify(epoch));persistQueue();status('初期化を共有待ち');schedule()}
async function jsonRequest(url,options={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
 try{const response=await fetch(url,{...options,signal:controller.signal,cache:'no-store'});const body=await response.json();return {response,body}}finally{clearTimeout(timeout)}
}
function validateConfig(value){
 const url=new URL(value.databaseURL);
 if(url.protocol!=='https:'||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(url.hostname)||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('保存先URLを確認してください。');
 if(!/^AIza[A-Za-z0-9_-]{20,}$/.test(value.apiKey))throw new Error('APIキーを確認してください。');
 return {databaseURL:url.origin,apiKey:value.apiKey};
}
async function token(){
 if(auth.idToken&&auth.until>Date.now()+60000)return auth.idToken;
 const {response,body}=await jsonRequest('https://securetoken.googleapis.com/v1/token?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:auth.refreshToken}).toString()});
 if(!response.ok){if(response.status===400||response.status===401){paused=true;throw new Error('共有ログインの有効期限が切れました。もう一度ログインしてください。')}throw new Error('共有に接続できません。')}
 auth={...auth,idToken:body.id_token,refreshToken:body.refresh_token,until:Date.now()+Number(body.expires_in)*1000};native.setItem(AUTH,JSON.stringify(auth));return auth.idToken;
}
async function database(method='GET',body,etag){
 const idToken=await token(),url=config.databaseURL+'/families/'+encodeURIComponent(auth.uid)+'.json?auth='+encodeURIComponent(idToken);
 const headers={'Content-Type':'application/json','X-Firebase-ETag':'true'};if(etag)headers['if-match']=etag;
 const result=await jsonRequest(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(result.response.status===412)return {conflict:true};
 if(!result.response.ok)throw new Error(result.response.status===401||result.response.status===403?'共有の接続設定を確認してください（ログイン・保存ルール）。':'共有に接続できません。');
 const receivedETag=result.response.headers.get('etag');if(method==='GET'&&!receivedETag)throw new Error('共有の同時更新を確認できません。接続設定を確認してください。');
 return {doc:result.body,etag:receivedETag};
}
function validDoc(doc){return doc&&doc.schema===1&&typeof doc.epoch==='string'&&(!doc.data||object(doc.data))}
function importData(doc){
 if(!validDoc(doc))throw new Error('共有手帳の形式を確認できません。');
 const data=doc.data||{};silent=true;
 try{
  for(let i=native.length-1;i>=0;i--){const key=native.key(i);if(sharedKey(key)&&!(enc(key)in data))native.removeItem(key)}
  for(const [key,value]of Object.entries(data))if(sharedKey('myAnchorV2.'+key)&&typeof value==='string')native.setItem('myAnchorV2.'+key,value);
  native.setItem('myAnchorV2.trialResetV6025','done');
 }finally{silent=false}
 epoch=doc.epoch;native.setItem(EPOCH,JSON.stringify(epoch));document.dispatchEvent(new Event('anchorDataChanged'));
}
function schedule(){clearTimeout(timer);if(!paused)timer=setTimeout(()=>tick(),300)}
async function tick(){
 if(busy||paused||!auth||!config||document.hidden)return;busy=true;
 try{
  // Read queue again so another tab cannot silently lose pending operations.
  queue=read(QUEUE,queue);const batch=copy(queue);let remote,discarded=0;
  for(let attempt=0;attempt<6;attempt++){
   const readResult=await database();if(!validDoc(readResult.doc))throw new Error('共有手帳が見つかりません。設定を確認してください。');
   const applied=applyOperations(readResult.doc,batch);discarded=applied.discarded;remote=applied.doc;
   if(!same(remote,readResult.doc)){
    const write=await database('PUT',remote,readResult.etag);if(write.conflict)continue;
   }
   const ids=new Set(batch.map(x=>x.client+':'+x.seq));queue=read(QUEUE,queue).filter(x=>!ids.has(x.client+':'+x.seq));persistQueue();
   if(discarded)backup('別の端末で初期化されたため、未共有の変更を予備保存');
   // Include edits made during the request, without marking them acknowledged.
   const view=applyOperations(remote,queue).doc;
   const isDifferent=!same(snapshot(),view.data||{});if(isDifferent)importData(view);else{epoch=view.epoch;native.setItem(EPOCH,JSON.stringify(epoch))}
   status(discarded?'別端末で初期化されました。未共有の記録は予備保存しました。':queue.length?'この端末に保存済み・共有待ち':'共有済み ✓');return;
  }
  throw new Error('同時に更新されています。少し待って再接続します。');
 }catch(e){status(navigator.onLine===false?'この端末に保存済み・接続後に共有':e.name==='AbortError'||e instanceof TypeError?'接続待ち・記録はこの端末に保存済み':e.message)}finally{busy=false;if(queue.length&&!paused)timer=setTimeout(()=>tick(),5000)}
}
async function connect(value,email,password,create){
 if(busy)throw new Error('共有処理が終わるまでお待ちください。');
 const pendingBefore=read(QUEUE,queue);
 const checked=validateConfig(value);
 let {response,body}=await jsonRequest('https://identitytoolkit.googleapis.com/v1/accounts:'+(create?'signUp':'signInWithPassword')+'?key='+encodeURIComponent(checked.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
 if(create&&!response.ok&&body.error?.message?.includes('EMAIL_EXISTS')){({response,body}=await jsonRequest('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(checked.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})}))}
 if(!response.ok){const code=body.error?.message||'';throw new Error(code.includes('EMAIL_EXISTS')?'このメールは登録済みです。「共有手帳を開く」を使ってください。':code.includes('OPERATION_NOT_ALLOWED')?'Firebaseでメール／パスワードログインを有効にしてください。':'共有ログインを確認してください。メールとパスワード、Firebaseの設定を確認してね。')}
 if(pendingBefore.length&&(!auth||auth.uid!==body.localId||!same(config,checked)))throw new Error('未共有の記録があります。先に元の共有手帳へ接続してください。');
 const previous={config,auth,paused,epoch};config=checked;auth={uid:body.localId,idToken:body.idToken,refreshToken:body.refreshToken,until:Date.now()+Number(body.expiresIn)*1000};paused=true;
 try{
  const result=await database();let doc=result.doc;
  if(doc===null){
   if(!create)throw new Error('共有手帳がまだありません。お母さんの端末から共有を開始してください。');
   doc={schema:1,epoch:uid(),data:snapshot(),applied:{}};
   const written=await database('PUT',doc,result.etag);if(written.conflict)throw new Error('手帳が更新されました。もう一度開いてください。');
  }
  if(!validDoc(doc))throw new Error('共有手帳の形式が違います。');
  backup('共有手帳へ接続する前の端末記録');native.setItem(CONFIG,JSON.stringify(config));native.setItem(AUTH,JSON.stringify(auth));
  queue=pendingBefore;paused=false;importData(applyOperations(doc,queue).doc);status(queue.length?'この端末に保存済み・共有待ち':'共有済み ✓');if(queue.length)schedule();
 }catch(e){({config,auth,paused,epoch}=previous);throw e}
}
function setupUI(){
 status(currentStatus);
 const dialog=document.getElementById('syncDialog'),form=document.getElementById('syncForm'),message=document.getElementById('syncFormStatus');
 const open=()=>{if(config){document.getElementById('syncDatabaseURL').value=config.databaseURL;document.getElementById('syncApiKey').value=config.apiKey}message.textContent='';document.getElementById('syncPassword').value='';dialog.showModal()};
 for(const id of ['openSync','openMotherSync'])document.getElementById(id).onclick=open;
 document.getElementById('closeSync').onclick=()=>dialog.close();
 document.getElementById('syncNow').onclick=()=>{if(auth){tick()}else open()};
 form.onsubmit=async event=>{
  event.preventDefault();const create=event.submitter?.id==='syncCreate';const buttons=[...form.querySelectorAll('button[type=submit]')];buttons.forEach(b=>b.disabled=true);message.textContent='共有手帳に接続しています…';
  try{await connect({databaseURL:document.getElementById('syncDatabaseURL').value.trim(),apiKey:document.getElementById('syncApiKey').value.trim()},document.getElementById('syncEmail').value.trim(),document.getElementById('syncPassword').value,create);document.getElementById('syncPassword').value='';dialog.close();location.reload()}
  catch(e){message.textContent=e.message}finally{buttons.forEach(b=>b.disabled=false)}
 };
 document.getElementById('syncShare').onclick=async()=>{
  if(!auth||!config){message.textContent='先に共有手帳に接続してください。';return}
  const url=new URL(location.href);url.hash='anchor-connect='+encodeURIComponent(JSON.stringify(config));
  // Login passwords and tokens are never included in the invitation.
  const field=document.getElementById('syncInvite');field.value=url.href;field.hidden=false;
  try{if(navigator.share)await navigator.share({title:'My Anchor 勉強手帳',url:url.href});else{await navigator.clipboard.writeText(url.href);message.textContent='共有リンクをコピーしました。同じ共有ログインで開いてね。'}}catch(e){message.textContent='下の共有リンクをコピーして送ってね。'}
 };
 document.getElementById('syncBackup').onclick=()=>{const saved=native.getItem(BACKUP)||JSON.stringify({at:new Date().toISOString(),data:snapshot()});const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([saved],{type:'application/json'}));a.download='My_Anchor_backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
 const fragment=location.hash.match(/^#anchor-connect=(.+)$/);if(fragment){try{const invite=validateConfig(JSON.parse(decodeURIComponent(fragment[1])));document.getElementById('syncDatabaseURL').value=invite.databaseURL;document.getElementById('syncApiKey').value=invite.apiKey;history.replaceState(null,'',location.pathname+location.search);dialog.showModal()}catch(e){status('共有リンクを確認してください。')}}
}
root.AnchorSync={storage,reset,tick,connect,setupUI,sharedKey,snapshot,ready:(async()=>{
 if(!config||!auth)return;try{config=validateConfig(config);paused=false;await tick()}catch(e){status('共有設定を確認してください。')}
})()};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});root.addEventListener('online',tick);root.addEventListener('pageshow',tick);setInterval(()=>tick(),10000);
})(typeof window==='undefined'?globalThis:window);
