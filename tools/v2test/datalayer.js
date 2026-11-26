/* ===================== 앱 모드 · 로그인 · 저장소 (v2 보안 구조, docs/ARCH-v2.md) =====================
   - 비밀번호 확인·가입·결제 승인·운영자 권한은 모두 서버(워커)가 해요. 앱은 서버가 준 Firebase custom token 으로만 로그인해요.
   - 시연 계정(baeum / friend / admin, 1234)은 BAEP_MODE 'demo' 에서만 있고, 이 기기 안에서만 움직여요 (Firestore·서버 안 씀).
   - Firestore 는 "내 것만" 읽고 써요. 규칙: server/firestore.rules */
const DEMO_MODE=window.BAEP_MODE!=='live';
const APP_Q=new URLSearchParams(location.search);
const PAGE_MODE=APP_Q.has('s')?'frame':(window.__BOARD?'board':'app');
const IN_ANDROID=/BaepApp/.test(navigator.userAgent||'');
const ADMIN_APP=PAGE_MODE==='app'&&!window.__KIOSK&&APP_Q.get('app')==='admin'&&!IN_ANDROID;   // 운영자 화면(admin.html → index.html?app=admin). 안드로이드 앱에서는 절대 안 열려요
const FB_CFG=window.FIREBASE_CONFIG&&window.FIREBASE_CONFIG.projectId?window.FIREBASE_CONFIG:null;
const WORKER=String((window.BAEP_AUTH||{}).workerUrl||'').trim().replace(/\/+$/,'');
const NET=PAGE_MODE==='app'&&!window.__KIOSK&&!!FB_CFG;           // Firebase·서버를 쓰는 실제 앱 화면일 때만
const ACCOUNTS=DEMO_MODE?{baeum:{pw:'1234',role:'mentee',demo:true},friend:{pw:'1234',role:'mentor',demo:true},admin:{pw:'1234',role:'admin',demo:true}}:{};
const DEMO_IDS=['baeum','friend','admin','baeum01','fr01'];
const isDemoAcct=id=>!!(id&&ACCOUNTS[id]&&ACCOUNTS[id].demo);
/* 서버가 확인해 준 로그인 (ID 토큰 claims: acct·role·provider). 신원은 이것만 믿어요 (localStorage 는 믿지 않아요) */
const SES={acct:null,role:null,uid:null,provider:null};
const live=()=>NET&&!!SES.acct&&typeof S!=='undefined'&&S.me===SES.acct&&!isDemoAcct(S.me);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const within=(p,ms,v=null)=>Promise.race([p,sleep(ms).then(()=>v)]);
const lsg=k=>{if(PAGE_MODE==='frame')return null;try{return localStorage.getItem(k)}catch(e){return null}};
const lss=(k,v)=>{if(PAGE_MODE==='frame')return true;try{localStorage.setItem(k,v);return true}catch(e){return false}};
const lsd=k=>{try{localStorage.removeItem(k)}catch(e){}};
/* 예전 버전이 이 폰에 남긴 계정 사본(비밀번호 해시 포함)·간편로그인 연결 정보는 지워요 */
try{Object.keys(localStorage).forEach(k=>{if(k.startsWith('baep_social_'))lsd(k);else if(k.startsWith('baep3_acc_')){const v=lsg(k)||'';if(/"pw2?"\s*:/.test(v))lsd(k)}})}catch(e){}

/* ---------- Firebase (app · firestore · auth compat) ---------- */
const FB_V='10.12.2';
const loadJs=src=>new Promise((ok,no)=>{const t=document.createElement('script');t.src=src;t.onload=ok;t.onerror=()=>no(new Error('load '+src));document.head.appendChild(t)});
let _fbP=null;
function fbReady(){if(!NET)return Promise.resolve(null);
 if(!_fbP)_fbP=(async()=>{try{const b=`https://www.gstatic.com/firebasejs/${FB_V}/`;
   if(!window.firebase||!firebase.initializeApp)await loadJs(b+'firebase-app-compat.js');
   await Promise.all([firebase.firestore?0:loadJs(b+'firebase-firestore-compat.js'),firebase.auth?0:loadJs(b+'firebase-auth-compat.js')]);
   if(!firebase.apps.length)firebase.initializeApp(FB_CFG);
   const au=firebase.auth();await within(new Promise(r=>{const un=au.onAuthStateChanged(()=>{un();r()})}),6000);
   window.__BAEP_STORE='firebase';return firebase}
  catch(e){console.warn('[배프] Firebase 연결 실패',e);_fbP=null;window.__BAEP_STORE='local';return null}})();
 return _fbP}
async function getDB(){const fb=await within(fbReady(),10000);return fb?fb.firestore():null}
async function fbUser(){const fb=await within(fbReady(),10000);return fb?fb.auth().currentUser:null}
/* 로그인 전 공개 정보(승인된 프렌드·나들이 일정) 읽기용 익명 로그인 — 필요할 때만 */
async function pubDB(){const fb=await within(fbReady(),10000);if(!fb)return null;const au=fb.auth();
 if(!au.currentUser){try{await within(au.signInAnonymously(),8000)}catch(e){return null}}return fb.firestore()}
/* 내 계정(서버가 확인한 로그인)일 때만 Firestore. 시연 계정·둘러보기는 null → 이 기기 안에서만 */
async function myDB(){return live()?await getDB():null}
/* 서버가 준 custom token 으로 로그인하고 claims 읽기 */
async function signInToken(token){const fb=await within(fbReady(),10000);if(!fb||!token)return null;
 try{const au=fb.auth();await within(au.signInWithCustomToken(token),15000);const u=au.currentUser;if(!u||u.isAnonymous)return null;
  const c=((await u.getIdTokenResult())||{}).claims||{};Object.assign(SES,{uid:u.uid,acct:c.acct||null,role:c.role||null,provider:c.provider||null});
  return {uid:u.uid,acct:SES.acct,role:SES.role,provider:SES.provider}}
 catch(e){console.warn('[배프] 로그인 토큰 확인 실패',e);return null}}
/* 로그아웃: Firebase 로그아웃 → (공개 정보 읽기용) 익명 로그인 */
async function signOutAll(anon=true){Object.assign(SES,{acct:null,role:null,uid:null,provider:null});
 const fb=window.firebase&&firebase.apps&&firebase.apps.length&&firebase.auth?firebase:null;if(!fb)return;
 try{await fb.auth().signOut()}catch(e){}
 if(anon){try{await within(fb.auth().signInAnonymously(),8000)}catch(e){}}}

/* ---------- 워커(서버) API ---------- */
const AUTH_MSG={BAD_LOGIN:'아이디나 비밀번호가 맞지 않아요',LOCKED:'여러 번 틀려서 10분 동안 잠겼어요. 잠시 후 다시 해 주세요',
 ID_TAKEN:'이미 있는 아이디예요. 다른 아이디를 적어 주세요',BAD_ID:'아이디는 영문 소문자로 시작하고, 영문 소문자·숫자 4~20자로 적어 주세요',
 BAD_PW:'비밀번호는 6자 이상 적어 주세요',BAD_ROLE:'가입 종류를 다시 골라 주세요',BAD_INPUT:'입력한 내용을 다시 확인해 주세요',
 NET:'인터넷 연결을 확인해 주세요',AUTH_REQUIRED:'다시 로그인해 주세요',NO_SERVER:'아직 서버 설정 전이에요. 운영자에게 알려 주세요'};
const errMsg=r=>(r&&AUTH_MSG[r.code])||(r&&r.message)||'잠시 후 다시 해 주세요';
/* o.bearer: 지금 Firebase 로그인한 사람의 ID 토큰을 붙여요 (결제 승인·탈퇴·간편로그인 가입) */
async function api(path,body,o={}){if(!WORKER)return {ok:false,code:'NO_SERVER'};
 const h={};if(body)h['Content-Type']='application/json';
 if(o.bearer){const u=await fbUser();if(!u||u.isAnonymous)return {ok:false,code:'AUTH_REQUIRED'};try{h.Authorization='Bearer '+await u.getIdToken()}catch(e){return {ok:false,code:'NET'}}}
 const ac=typeof AbortController!=='undefined'?new AbortController():null;const tm=setTimeout(()=>{try{ac&&ac.abort()}catch(e){}},20000);
 try{const r=await fetch(WORKER+path,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined,signal:ac?ac.signal:undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok===false)return Object.assign({},j,{ok:false,status:r.status,code:j.code||('HTTP_'+r.status)});
  return Object.assign({},j,{ok:true})}
 catch(e){return {ok:false,code:'NET'}}finally{clearTimeout(tm)}}

/* ---------- 내 계정 문서 baep_accounts/{acct} ---------- */
const LSA='baep3_acc_';          // 이 폰에 남기는 내 계정 사본 (비밀번호 없음 · 서버 로그인 뒤에만 씀)
const stripPw=o=>{if(!o||typeof o!=='object')return o;const c=JSON.parse(JSON.stringify(o));delete c.pw;delete c.pw2;return c};
const ACC_OK=['sr','tu','state'];  // 앱이 고칠 수 있는 필드 (role·approved·createdAt·ownerUids·pw 는 절대 안 보내요)
async function loadOwnAcct(acct){if(!SES.acct||SES.acct!==acct)return null;let a=null;const db=await getDB();
 if(db){for(let t=0;t<2&&!a;t++){try{const sn=await within(db.doc('baep_accounts/'+acct).get(),9000);if(sn&&sn.exists)a=JSON.parse(JSON.stringify(sn.data()||{}));if(sn)break}catch(e){if(!e||e.code!=='unavailable')break;await sleep(600)}}}
 if(!a){try{a=JSON.parse(lsg(LSA+acct)||'null')}catch(e){a=null}if(a)a.cached=true}
 if(a){delete a.pw;delete a.pw2;delete a.demo;if(a.sr)a.sr=stripPw(a.sr);if(a.tu)a.tu=stripPw(a.tu)}
 return a}
async function saveAcct(id,a){if(!a)return false;ACCOUNTS[id]=a;
 if(a.demo||!SES.acct||id!==SES.acct)return true;                 // 시연·이 기기 계정은 메모리에만
 const patch={};ACC_OK.forEach(k=>{if(a[k]!==undefined&&a[k]!==null)patch[k]=k==='state'?a[k]:clean({[k]:a[k]})[k]});
 const body=JSON.parse(JSON.stringify(patch));
 lss(LSA+id,JSON.stringify(body));
 const db=await getDB();if(!db)return false;
 for(let t=0;t<2;t++){try{await db.doc('baep_accounts/'+id).update(body);return true}catch(e){if(!e||e.code!=='unavailable')return false;await sleep(500+Math.random()*500)}}return false}
/* 운영자: 승인 대기 프렌드 (baep_profiles where approved==false) */
async function syncApps(){if(!live()||SES.role!=='admin')return;const db=await getDB();if(!db)return;
 try{const q=await db.collection('baep_profiles').where('approved','==',false).get();let n=0;
  for(const d of q.docs){if(S.ad.apps.some(x=>x.acct===d.id))continue;const u=d.data()||{};let x={};
   try{const a=await db.doc('baep_accounts/'+d.id).get();if(a.exists){const ad=a.data()||{};const t=ad.tu||{};x={crime:!!t.crime,date:ad.date||'',phone:t.phone||''}}}catch(e){}
   S.ad.apps.unshift({id:'acc-'+d.id,acct:d.id,name:u.name||d.id,school:u.school||'',major:((u.major||'')+' '+(u.grade||'')).trim(),age:u.age||'',gender:u.gender||'',dong:u.dong||'영통동',addr:u.road||u.dong||'',rad:u.rad||3,date:x.date||'',crime:!!x.crime,doc:'',st:'대기',me:true});n++}
  if(n&&S.screen==='admin')render()}catch(e){console.warn('[배프] 승인 대기 목록을 못 읽었어요',e)}}
/* 로그인한 계정의 진행 상태(예약·결제·수업 단계 등)를 계정에 저장 */
const KEEP={mentee:['sr','req','booking','bphase','history','note','paid','skills','notis','sms','payer','method','tid','day','slot','place','dur','accepted','rv'],
 mentor:['tu','tc','reqs','tPast','tUp','money','tnotis','tDone']};
const clean=o=>{const c=JSON.parse(JSON.stringify(o));if(c.sr){delete c.sr.pw;delete c.sr.pw2}if(c.tu){delete c.tu.pw;delete c.tu.pw2;if(c.tu.photo)c.tu.photo='sample'}return c};
let _svT=null,_svLast='';
function snapState(){const a=S.me&&ACCOUNTS[S.me];if(!a||a.demo||!KEEP[a.role])return null;const st={};KEEP[a.role].forEach(k=>st[k]=S[k]);return [S.me,a,clean(st)]}
function saveState(now){const sn=snapState();if(!sn)return;const [id,a,st]=sn;const js=JSON.stringify(st);if(js===_svLast)return;
 clearTimeout(_svT);const go=()=>{_svLast=js;a.state=st;if(a.role==='mentee'&&S.sr)a.sr=stripPw(S.sr);saveAcct(id,a).then(ok=>{if(!ok)_svLast=''})};if(now)go();else _svT=setTimeout(go,700)}
function loadState(a){if(!a.state)return;const st=JSON.parse(JSON.stringify(a.state));(KEEP[a.role]||[]).forEach(k=>{if(st[k]!==undefined&&st[k]!==null&&typeof S[k]==='object'&&S[k]&&!Array.isArray(S[k])&&!Array.isArray(st[k]))S[k]=Object.assign(S[k],st[k]);else if(st[k]!==undefined)S[k]=st[k]});
 _svLast=JSON.stringify(clean((()=>{const o={};KEEP[a.role].forEach(k=>o[k]=S[k]);return o})()))}

/* ---------- 예약 요청 baep_requests/{rid} — 배움님 요청 → 프렌드 수락 → 결제(서버가 paid 기록) ----------
   진짜 계정끼리는 Firestore, 시연(시연 계정·둘러보기·시연 프렌드)은 이 기기 안 저장소(localStorage, 같은 폰의 다른 탭에도 보여요) */
const reqKey=tid=>tid==='t1'?'friend':((tutor(tid)||{}).acct||null);
const LREQ_K='baep3_demo_reqs';let _lreqMem={};const _lreqFns=new Set();
const lreqAll=()=>{const j=lsg(LREQ_K);if(j==null)return _lreqMem;try{return JSON.parse(j)||{}}catch(e){return {}}};
const lreqFire=()=>{const all=lreqAll();_lreqFns.forEach(f=>{try{f(all)}catch(e){console.warn(e)}})};
function lreqPut(rid,d,merge){const all=lreqAll();all[rid]=merge?Object.assign({},all[rid]||{},d):d;
 const ks=Object.keys(all);if(ks.length>40)ks.sort((a,b)=>(all[a].created||0)-(all[b].created||0)).slice(0,ks.length-40).forEach(k=>delete all[k]);
 _lreqMem=all;lss(LREQ_K,JSON.stringify(all));setTimeout(lreqFire,0)}
addEventListener('storage',e=>{if(e.key===LREQ_K)lreqFire()});
const lreqOn=fn=>{_lreqFns.add(fn);setTimeout(()=>{if(_lreqFns.has(fn))fn(lreqAll())},0);return ()=>{_lreqFns.delete(fn)}};
async function reqWrite(rid,data,remote){if(!remote){lreqPut(rid,data);return true}const db=await myDB();if(!db)return false;
 try{return await within(db.doc('baep_requests/'+rid).set(data).then(()=>true),12000,false)}catch(e){console.warn('[배프] 요청 저장 실패',e);return false}}
async function reqUpdate(rid,data,remote){if(!remote){lreqPut(rid,data,true);return true}const db=await myDB();if(!db)return false;
 try{return await within(db.doc('baep_requests/'+rid).update(data).then(()=>true),12000,false)}catch(e){console.warn('[배프] 요청 수정 실패',e);return false}}
let _rqUn=null,_inUn=null,_inFirst=true,_lfAt=0;
let onLessonPaid=null,PAYING_RID=null;   // 결제 승인 뒤 '수업 확정'으로 넘기는 함수 (v3 결제 부분에서 채워요)
function unwatchAll(){if(_rqUn){_rqUn();_rqUn=null}if(_inUn){_inUn();_inUn=null}}
async function watchReq(){if(_rqUn){_rqUn();_rqUn=null}const r=S.req;if(!r||!r.rid)return;
 const on=d=>{if(!d||!S.req||S.req.rid!==r.rid)return;
  if(r.remote&&d.paid===true){if(PAYING_RID!==r.rid&&onLessonPaid)onLessonPaid(d);return}   // 결제 상태는 서버가 쓴 문서만 믿어요
  if(d.st==='ok'&&S.req.st==='wait')reqAccept();else if((d.st==='no'&&S.req.st==='wait')||(d.st==='cancel'&&S.req.st!=='no'))reqDecline()};
 if(!r.remote){_rqUn=lreqOn(all=>on(all[r.rid]));return}
 const db=await myDB();if(!db||!S.req||S.req.rid!==r.rid)return;
 try{_rqUn=db.doc('baep_requests/'+r.rid).onSnapshot(sn=>{if(sn.exists)on(sn.data()||{})},e=>console.warn('[배프] 요청 보기 실패',e))}catch(e){}}
async function watchInbox(){if(_inUn){_inUn();_inUn=null}_inFirst=true;
 if(live()){if(SES.role!=='mentor')return;const db=await myDB();if(!db)return;
  try{_inUn=db.collection('baep_requests').where('to','==',S.me).onSnapshot(q=>inbox(q.docs.map(d=>({...(d.data()||{}),remote:true}))),e=>console.warn('[배프] 받은 요청 보기 실패',e))}catch(e){}return}
 _inUn=lreqOn(all=>inbox(Object.values(all).filter(d=>d&&d.to==='friend')))}
const isPaidReq=d=>d.remote?d.paid===true:(d.st==='paid'||d.paid===true);
function inbox(list){let ch=false;const first=_inFirst;_inFirst=false;const done=S.tDone||[];
 /* 열어둔 시간에 들어온 예약은 바로 수락 (프렌드 앱이 수락으로 바꿔요) */
 list.filter(d=>d.inst&&d.st==='wait'&&!done.includes(d.rid)).forEach(d=>{d.st='ok';reqUpdate(d.rid,{st:'ok',updated:Date.now()},!!d.remote)});
 const w=list.filter(d=>d.st==='wait'&&!done.includes(d.rid)&&!(S.tDecl&&S.tDecl.r.rid===d.rid)&&!(S.tc&&S.tc.rid===d.rid)).sort((a,b)=>(b.created||0)-(a.created||0)).map(d=>({...d,id:'db-'+d.rid}));
 const before=S.reqs.filter(r=>r.rid).map(r=>r.rid).join();
 const fresh=w.filter(d=>!S.reqs.some(r=>r.rid===d.rid));
 S.reqs=[...w,...S.reqs.filter(r=>!r.rid)];
 if(before!==w.map(d=>d.rid).join())ch=true;
 if(!first)fresh.forEach(d=>tnoti('새 수업 요청',`${d.who} 배움님이 수업을 요청했어요`));
 if(S.tc&&S.tc.rid){const d=list.find(x=>x.rid===S.tc.rid);if(d&&isPaidReq(d)&&S.tc.st==='pay'){S.tc.st='conf';ch=true;tnoti('결제 완료',`${d.who} 배움님이 결제했어요. 수업이 확정됐어요`)}}
 if(!S.tc){const d=list.filter(x=>(x.st==='ok'||isPaidReq(x))&&!x.fdone&&!done.includes(x.rid)).sort((a,b)=>(b.updated||0)-(a.updated||0))[0];if(d){S.tc={...d,id:'db-'+d.rid,st:isPaidReq(d)?'conf':'pay'};ch=true}}
 if(ch&&(TUTOR_TAB[S.screen]||S.screen==='tpending'))render()}
const tDoneAdd=rid=>{if(!rid)return;S.tDone=(S.tDone||[]).filter(x=>x!==rid).concat(rid).slice(-60)};
/* 승인된 프렌드 (baep_profiles where approved==true · 공개 정보) — 진짜 계정으로 로그인했을 때만 */
async function loadFriends(force){if(!live())return;if(!force&&Date.now()-_lfAt<15000)return;_lfAt=Date.now();const db=await pubDB();if(!db)return;
 try{const q=await db.collection('baep_profiles').where('approved','==',true).get();let n=0;
  q.docs.forEach(d=>{if(d.id===S.me)return;const u=d.data()||{};const id='acc-'+d.id;const rd=ROADS.find(x=>x[0]===u.road);const dd=rd?[rd[6],rd[7]]:(DONGS[u.dong]||DONGS['영통동']);
   const t={id,acct:d.id,name:u.name||d.id,school:u.school||'',major:((u.major||'')+' '+(u.grade||'')).trim(),age:+u.age||21,gender:u.gender||'여',lat:dd[0],lon:dd[1],rad:+u.rad||3,rating:5.0,reviews:0,price:20000,color:'#CDEBDD',approved:true,
    intro:u.intro||'새로 온 프렌드예요. 천천히, 여러 번 알려드릴게요.',topics:u.topics&&u.topics.length?u.topics:['taxi'],tags:['새 프렌드'],wd:(u.wdays&&u.wdays.length?u.wdays:['토']).map(x=>W.indexOf(x)),slots:u.times&&u.times.length?u.times:['14:00'],full:{},revs:[]};
   const i=TUTORS.findIndex(x=>x.id===id);if(i>=0)TUTORS.splice(i,1,t);else{TUTORS.push(t);n++}});
  if(n&&['list','topic','detail'].includes(S.screen))render()}catch(e){console.warn('[배프] 프렌드 목록을 못 읽었어요',e)}}
/* 가입 (아이디·비밀번호 또는 간편로그인). 서버가 계정을 만들고 token 을 돌려줘요. 비밀번호는 서버로만 보내고 어디에도 남기지 않아요 */
const ID_RE=/^[a-z][a-z0-9]{3,19}$/;
async function doSignup({role,id,pw,account,profile}){const soc=window.BAEP_SOCIAL||null;
 account=stripPw(account);
 if((soc&&soc.demo)||(!WORKER&&DEMO_MODE&&!soc)){/* 시연: 서버 없이 이 기기 메모리에만 */
  const lid=soc?soc.localId:id;if(!soc&&ACCOUNTS[lid])return {ok:false,code:'ID_TAKEN'};
  ACCOUNTS[lid]=Object.assign({role,demo:true,local:true},account,role==='mentor'?{approved:false}:{});window.BAEP_SOCIAL=null;return {ok:true,acct:lid,role,local:true}}
 if(!NET)return {ok:false,code:'NO_SERVER'};
 if(!soc){const c=await api('/auth/check-id?id='+encodeURIComponent(id));if(!c.ok)return c;if(c.available===false)return {ok:false,code:'ID_TAKEN'}}
 const body={role,account};if(profile)body.profile=profile;if(!soc){body.id=id;body.pw=pw}
 const r=await api('/auth/signup',body,soc?{bearer:true}:{});if(!r.ok)return r;
 const s=await signInToken(r.token);if(!s||!s.acct)return {ok:false,code:'SIGNED_NO_LOGIN',message:'가입은 됐어요. 로그인 화면에서 다시 로그인해 주세요'};
 window.BAEP_SOCIAL=null;return {ok:true,acct:s.acct,role:s.role||role}}
/* 프렌드 공개 프로필에 들어가는 필드만 (재학증명서·계좌·전화번호는 빼요) */
const pubProfile=u=>({name:u.name||'',school:u.school||'',major:u.major||'',grade:u.grade||'',age:+u.age||'',gender:u.gender||'',dong:u.dong||'',road:u.road||'',rad:+u.rad||3,intro:u.intro||'',topics:(u.topics||[]).slice(),wdays:(u.wdays||[]).slice(),times:(u.times||[]).slice()});
async function updateProfile(){const db=await myDB();if(!db||SES.role!=='mentor')return false;const u=S.tu;
 try{await db.doc('baep_profiles/'+S.me).update({dong:u.dong||'',road:u.road||'',rad:+u.rad||3,intro:u.intro||'',topics:u.topics.slice(),wdays:u.wdays.slice(),times:u.times.slice(),updatedAt:Date.now()});return true}
 catch(e){console.warn('[배프] 프로필 저장 실패',e);toast('프로필을 저장하지 못했어요. 인터넷 연결을 확인해 주세요',3600);return false}}
/* 서버 로그인 뒤 내 계정으로 들어가기 (로그인·간편로그인·새로고침 복원 모두 여기로) */
async function enterAccount(acct,role,o={}){const a=await loadOwnAcct(acct);if(!a)return false;a.role=role||a.role;
 if(a.role!=='mentee'&&a.role!=='mentor')return false;ACCOUNTS[acct]=a;
 S.login.err='';S.me=acct;S.hist=[];const via=o.via?` (${o.via})`:'';
 if(a.role==='mentee'){Object.assign(S.sr,a.sr||{});S.sr.pw='';S.sr.pw2='';loadState(a);setHome();S.member.mentee=true;S.screen='home';render();watchReq();if(!o.quiet)toast((S.sr.name||'')+' 님, 어서 오세요'+via)}
 else{Object.assign(S.tu,a.tu||{});S.tu.pw='';S.tu.pw2='';loadState(a);S.tu.approved=!!a.approved;S.member.mentor=true;if(a.approved)addMe();S.screen=a.approved?'thome':'tpending';render();if(a.approved)watchInbox();if(!o.quiet)toast((S.tu.name||'')+' 프렌드님, 어서 오세요'+via)}
 try{dispatchEvent(new CustomEvent('baep:session',{detail:{acct,role:a.role,live:true}}))}catch(e){}
 return true}
/* 시연 계정으로 들어가기 (이 기기 안에서만) */
function enterDemo(id){const a=ACCOUNTS[id];if(!a)return;if(SES.acct)signOutAll(false);S.login.err='';S.hist=[];S.me=id;
 if(a.role==='admin'){S.ad.tab='dash';S.screen='admin';render()}
 else if(a.role==='mentee'){A.demo();S.me=id;render();toast(S.sr.name+' 님, 어서 오세요')}
 else{tutorDemo();S.me=id;render();watchInbox();toast(S.tu.name+' 프렌드님, 어서 오세요')}
 try{dispatchEvent(new CustomEvent('baep:session',{detail:{acct:id,role:a.role,live:false}}))}catch(e){}}
/* 운영자로 들어가기 (운영자 화면 admin.html 에서만) */
function enterAdmin(acct){S.me=acct;ACCOUNTS[acct]={role:'admin'};S.login.err='';S.hist=[];S.ad.tab='dash';S.screen='admin';render();syncApps();loadFriends(true);
 try{dispatchEvent(new CustomEvent('baep:session',{detail:{acct,role:'admin',live:true}}))}catch(e){}}
/* 새로고침했을 때: Firebase 에 남은 로그인의 claims.acct 로 다시 들어가요 */
async function restoreSession(){if(!NET)return false;const fb=await within(fbReady(),10000);if(!fb)return false;const u=fb.auth().currentUser;if(!u||u.isAnonymous)return false;
 let c={};try{c=((await u.getIdTokenResult())||{}).claims||{}}catch(e){return false}
 const idle=()=>!S.me&&!S.member.mentee&&!S.member.mentor&&['splash','join','adlogin'].includes(S.screen);
 if(!c.acct){if(!/[#&]baep_auth=/.test(location.hash))await signOutAll(false);return false}   // 가입을 끝내지 못한 간편로그인은 정리
 if(ADMIN_APP?c.role!=='admin':c.role==='admin')return false;   // 운영자 로그인은 운영자 화면에서만, 사용자 로그인은 사용자 앱에서만
 if(!idle())return false;
 Object.assign(SES,{uid:u.uid,acct:c.acct,role:c.role||null,provider:c.provider||null});
 if(ADMIN_APP){enterAdmin(c.acct);return true}
 const ok=await enterAccount(c.acct,c.role,{quiet:true});if(!ok)Object.assign(SES,{acct:null,role:null});return ok}
