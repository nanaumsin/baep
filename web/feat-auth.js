/* feat-auth.js — 배프 간편로그인(카카오·네이버) · Firebase 로그인 연결 · 회원 탈퇴
   index.html 맨 끝에서 auth-config.js 다음에 읽혀요. index.html은 고치지 않고, 이미 있는 전역(S·SC·A·render·getDB·saveAcct 등)을 감싸서 붙여요.

   흐름
   1) 로그인 화면에 [카카오로 시작하기] [네이버로 시작하기]
      - BAEP_AUTH.workerUrl 이 비어 있으면: "준비 중" 안내 + 시연용(카카오 로그인 성공한 것처럼) 계속하기
      - 있으면: 워커(/auth/<provider>/start)로 이동 → 돌아올 때 #baep_auth=<base64url JSON> 또는 #baep_auth_error=<code>
   2) 돌아오면: Firebase가 있으면 signInWithCustomToken → baep_users/{uid} 확인
      - 있으면 연결된 예전 계정(legacyId)으로 바로 로그인
      - 없으면 역할 고르기 → 기존 가입 화면(이름·휴대폰 미리 채움, 아이디·비밀번호 칸은 숨김) → 가입 끝나면 baep_users/{uid} 저장
      - Firebase가 없으면 같은 일을 이 폰 localStorage(baep_social_<uid>)로만 해요(시연용)
   3) Firebase가 있으면 시작할 때 익명 로그인 → 보안 규칙(request.auth != null)을 통과하게. getDB 는 로그인 준비를 기다려요.
   4) 회원 탈퇴: 배움님·프렌드 '내 프로필' 맨 아래 → 확인 화면 → 지우기
   5) 로그아웃하면 카카오·네이버로 들어온 Firebase 로그인도 끝내요(그 뒤 다시 익명으로) */
(function(){
'use strict';
if(window.__BAEP_AUTH_LOADED)return;              // 두 번 읽혀도 한 번만 붙이기
window.__BAEP_AUTH_LOADED=true;
if(typeof S==='undefined'||typeof SC==='undefined'||typeof A==='undefined'||typeof render!=='function'){console.warn('[feat-auth] 앱 본문을 찾지 못해 건너뛰어요');return}

/* ---------- 0. 설정 · 작은 도구 ---------- */
const CFG=Object.assign({workerUrl:'',kakao:true,naver:true},window.BAEP_AUTH||{});
CFG.workerUrl=String(CFG.workerUrl||'').trim().replace(/\/+$/,'');
const MODE=window.__V3MODE||'app';                 // 'app' | 'frame'(전체 화면 보기 안 작은 화면) | 'board'
const LIVE=MODE==='app'&&!window.__KIOSK;          // 실제로 눌러 쓰는 앱일 때만 시작 동작(해시 처리·익명 로그인)
const FB=window.FIREBASE_CONFIG&&window.FIREBASE_CONFIG.projectId?window.FIREBASE_CONFIG:null;
const FB_V='10.12.2';                              // index.html 의 firebase-app/firestore-compat 과 같은 버전
const PROV={kakao:'카카오',naver:'네이버'};
const DEMO_IDS=['baeum','friend','admin','baeum01','fr01'];   // 시연 계정: 절대 지우지 않아요
const K_LINK='baep_social_', K_UI='baep_auth_ui';
const lget=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lset=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
const ldel=k=>{try{localStorage.removeItem(k)}catch(e){}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const within=(p,ms,v=null)=>Promise.race([p,sleep(ms).then(()=>v)]);
const ph=()=>document.getElementById('phone');
const E=v=>(typeof esc==='function'?esc(v):String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'));
const T=(m,ms)=>{try{toast(m,ms)}catch(e){}};
const rand=n=>{const a=new Uint8Array(n);try{crypto.getRandomValues(a)}catch(e){for(let i=0;i<n;i++)a[i]=Math.random()*256|0}return [...a].map(x=>'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x%56]).join('')};
/* 휴대폰 번호 맞추기: +82 10-1234-5678 → 010-1234-5678 */
const normPhone=p=>{let d=String(p||'').replace(/[^\d+]/g,'');if(d.startsWith('+82'))d='0'+d.slice(3).replace(/^0/,'');d=d.replace(/\D/g,'');
 if(/^01\d{8,9}$/.test(d))return d.length===10?`${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`:`${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;return ''};
/* base64url → 글자 (한글 이름이 깨지지 않게 TextDecoder) */
const b64json=s=>{s=String(s).replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const bin=atob(s);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return JSON.parse(new TextDecoder().decode(u))};
/* 예전 계정 아이디: 앱의 아이디 규칙(영문·숫자 4자 이상)에 맞춰 kakao12345 / naver<영문숫자> */
const legacyIdFor=(provider,pid)=>{let p=String(pid||'');let clean=p.replace(/[^a-zA-Z0-9]/g,'');
 if(clean!==p||!clean){let h=0x811c9dc5;for(const c of p){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0}clean=(clean.slice(0,16)||'x')+h.toString(36)}
 return (provider==='naver'?'naver':'kakao')+clean.slice(0,40)};
const loadJs=src=>new Promise((ok,no)=>{if([...document.scripts].some(s=>s.src===src)&&window.firebase&&firebase.auth){ok();return}const t=document.createElement('script');t.src=src;t.onload=ok;t.onerror=()=>no(new Error('load '+src));document.head.appendChild(t)});

/* ---------- 1. Firebase 로그인 (익명 / 카카오·네이버 커스텀 토큰) ---------- */
const _getDB0=getDB;                 // v3가 바꿔 둔 getDB (Firebase 앱·Firestore 를 불러와요)
let _fbAuthP=null,_authP=null,_tokenWanted=false;
/* firebase-auth-compat 불러오기. Firebase 연결이 안 되면 null */
function fbAuth(){if(!FB)return Promise.resolve(null);
 if(!_fbAuthP)_fbAuthP=(async()=>{try{await _getDB0();if(!window.firebase||!firebase.apps||!firebase.apps.length)return null;
   if(!firebase.auth)await loadJs(`https://www.gstatic.com/firebasejs/${FB_V}/firebase-auth-compat.js`);
   const au=firebase.auth();await within(new Promise(r=>{const un=au.onAuthStateChanged(()=>{un();r()})}),5000);return au}
  catch(e){console.warn('[feat-auth] Firebase 로그인 모듈을 못 불러왔어요',e);_fbAuthP=null;return null}})();
 return _fbAuthP}
/* 로그인 준비: 지금 로그인한 사람이 없으면 익명 로그인 (돌아온 토큰이 있으면 그걸 기다려요) */
function authReady(){if(!FB||!LIVE)return Promise.resolve(null);
 if(!_authP)_authP=(async()=>{try{const au=await fbAuth();if(!au)return null;
   if(!au.currentUser&&!_tokenWanted)await au.signInAnonymously();return au.currentUser}
  catch(e){console.warn('[feat-auth] 익명 로그인 실패 (Firebase 콘솔에서 Anonymous 사용 설정을 확인하세요)',e);_authP=null;return null}})();
 return _authP}
const isSocialUser=u=>!!(u&&!u.isAnonymous);
const curUser=()=>{try{return window.firebase&&firebase.auth&&firebase.apps.length?firebase.auth().currentUser:null}catch(e){return null}};
/* getDB 감싸기: Firestore를 쓰기 전에 로그인 준비를 기다려요 (최대 8초, 실패해도 앱은 계속) */
if(FB&&LIVE&&!getDB.__auth){const _g=getDB;
 getDB=async()=>{const db=await _g();if(db&&window.__BAEP_STORE==='firebase'){try{await within(authReady(),8000)}catch(e){}}return db};
 getDB.__auth=true;setTimeout(()=>{authReady()},0)}
const fsOn=async()=>{const db=await _getDB0();return db&&window.__BAEP_STORE==='firebase'&&window.firebase&&firebase.firestore?db:null};

/* ---------- 2. 간편로그인 연결 정보 저장 (Firestore baep_users/{uid} 또는 localStorage) ---------- */
let PEND=null;   // 가입 중인 간편로그인 프로필 {uid,provider,pid,name,email,phone,legacyId,pw,fb,demo}
let CUR=null;    // 지금 간편로그인으로 들어온 사람 {uid,provider,legacyId,fb}
async function linkGet(p){
 if(p.fb){try{const db=await fsOn();if(db){const sn=await within(db.doc('baep_users/'+p.uid).get(),8000);if(sn&&sn.exists)return sn.data();if(sn)return null}}catch(e){console.warn('[feat-auth] baep_users 읽기 실패',e)}}
 try{return JSON.parse(lget(K_LINK+p.uid)||'null')}catch(e){return null}}
async function linkSet(p,doc){lset(K_LINK+p.uid,JSON.stringify({...doc,createdAt:Date.now()}));
 if(p.fb){try{const db=await fsOn();if(db){const ts=firebase.firestore.FieldValue&&firebase.firestore.FieldValue.serverTimestamp?firebase.firestore.FieldValue.serverTimestamp():Date.now();
   await within(db.doc('baep_users/'+p.uid).set({...doc,createdAt:ts}),8000)}}catch(e){console.warn('[feat-auth] baep_users 저장 실패',e)}}}
async function linkDel(uid,fb){ldel(K_LINK+uid);if(fb){try{const db=await fsOn();if(db)await within(db.doc('baep_users/'+uid).delete(),8000)}catch(e){console.warn('[feat-auth] baep_users 삭제 실패',e)}}}

/* 연결된 예전 계정으로 로그인 — A.login 이 아이디·비밀번호 확인 뒤 하는 일과 같아요 */
async function loginLegacy(id,prov){const a=await findAcct(id);if(!a)return false;
 S.login.err='';S.me=id;S.hist=[];const nm=PROV[prov]||'간편로그인';
 if(a.role==='admin'){S.ad.tab='dash';S.screen='admin';render();try{syncApps()}catch(e){}return true}
 if(a.role==='mentee'){Object.assign(S.sr,a.sr||{});loadState(a);setHome();S.member.mentee=true;S.screen='home';render();try{watchReq()}catch(e){}T(S.sr.name+' 님, 어서 오세요 ('+nm+')');return true}
 Object.assign(S.tu,a.tu||{});loadState(a);S.tu.approved=!!a.approved;S.member.mentor=true;if(a.approved)addMe();S.screen=a.approved?'thome':'tpending';render();if(a.approved){try{watchInbox()}catch(e){}}
 T((S.tu.name||'')+' 프렌드님, 어서 오세요 ('+nm+')');return true}

/* 간편로그인 성공 뒤: 이미 가입했으면 로그인, 처음이면 역할 고르기로 */
async function afterSocial(p){p.legacyId=legacyIdFor(p.provider,p.pid);
 const link=await linkGet(p);
 if(link&&link.legacyId){CUR={uid:p.uid,provider:p.provider,legacyId:link.legacyId,fb:p.fb};
  if(await loginLegacy(link.legacyId,p.provider))return;
  CUR=null;await linkDel(p.uid,false)}                                 // 계정이 사라졌으면 연결만 남은 것 → 새로 가입
 PEND={...p,pw:rand(20),phone:normPhone(p.phone)};
 S.hist=['join'];S.screen='pick';render();
 T((p.name?p.name+' 님, 반가워요! ':'')+'어떻게 쓰실지 골라 주세요',2600)}

/* ---------- 3. 로그인 화면 버튼 ---------- */
const snsBtns=()=>{if(!CFG.kakao&&!CFG.naver)return '';
 return `<div class="au-sns">${CFG.kakao?`<button class="btn kakao au-btn" data-a="au-sns" data-v="kakao"><span class="kb"></span>카카오로 시작하기</button>`:''}${CFG.naver?`<button class="btn naver au-btn" data-a="au-sns" data-v="naver"><span class="nb">N</span>네이버로 시작하기</button>`:''}</div><div class="au-or"><span>또는 아이디로 로그인</span></div>`};
const _scJoin=SC.join;
SC.join=()=>{const h=_scJoin();const at='<div class="card login">';return h.includes(at)?h.replace(at,snsBtns()+at):h};

/* 시연·안내 창 (결제창처럼 휴대폰 화면 위에 덮기) */
function sheet(html){closeSheet();if(!html)return;const el=document.createElement('div');el.className='au-ov';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.innerHTML=`<div class="au-s">${html}</div>`;
 el.addEventListener('click',e=>{if(e.target===el)closeSheet()});(ph()||document.body).appendChild(el)}
function closeSheet(){document.querySelectorAll('.au-ov').forEach(x=>x.remove())}

A['au-sns']=prov=>{prov=prov==='naver'?'naver':'kakao';const nm=PROV[prov];
 if(!CFG.workerUrl){const had=!!lget(K_LINK+prov+':demo0001');
  sheet(`<div class="ck-h"><b>${nm}로 시작하기</b><button class="ck-x" data-a="au-close" aria-label="닫기">${I('x')}</button></div>
   <div class="au-mid"><span class="au-ic ${prov}">${prov==='naver'?'N':'<span class="kb"></span>'}</span><b>간편로그인은 준비 중이에요</b><p>운영자 설정 전이라 아직 ${nm} 계정으로 들어갈 수 없어요.<br>지금은 아이디·비밀번호로 로그인하거나 회원가입을 해 주세요.</p></div>
   <div class="demo-bar au-demo"><span>시연용</span><small>발표·시연 때만 써요. 진짜 ${nm} 로그인은 하지 않아요.</small></div>
   <button class="btn ${prov} au-btn" data-a="au-demo" data-v="${prov}">${had?'시연용 · 가입한 사람처럼 들어가기':`시연용 · ${nm} 로그인한 것처럼 계속하기`}</button>
   ${had?`<button class="link" data-a="au-demo" data-v="${prov}-new" style="align-self:center">시연용 · 처음 가입하는 것처럼 보기</button>`:''}
   <button class="btn ghost" data-a="au-close">닫기</button>`);return}
 /* 실제: 워커로 이동. 돌아왔을 때 글자 크기 같은 화면 상태만 되살려요 */
 lset(K_UI,JSON.stringify({big:!!S.big,provider:prov,at:Date.now()}));
 const ret=location.origin+location.pathname;
 location.assign(`${CFG.workerUrl}/auth/${prov}/start?return=${encodeURIComponent(ret)}`)};
A['au-close']=()=>closeSheet();
/* 시연: 진짜 로그인 없이 가짜 프로필(김배움)로 계속 */
A['au-demo']=v=>{closeSheet();const fresh=/-new$/.test(v||'');const prov=String(v||'kakao').replace(/-new$/,'')==='naver'?'naver':'kakao';
 const pid=fresh?'demo'+rand(6):'demo0001';
 afterSocial({uid:prov+':'+pid,provider:prov,pid,name:'김배움',email:'',phone:'',fb:false,demo:true})};

/* ---------- 4. 역할 고르기 · 가입 화면 (간편로그인으로 가입 중일 때만 바뀜) ---------- */
const _scPick=SC.pick;
SC.pick=()=>{const h=_scPick();if(!PEND)return h;const nm=PROV[PEND.provider];
 const opts=`<div class="au-who card"><span class="au-ic sm ${PEND.provider}">${PEND.provider==='naver'?'N':'<span class="kb"></span>'}</span><span><b>${nm} 계정을 확인했어요${PEND.demo?' <em class="au-tag">시연용</em>':''}</b><small>${PEND.name?E(PEND.name)+' 님, ':''}어떻게 쓰실지 골라 주세요</small></span></div>
 <div class="j-opts">
  <button class="j-opt" data-a="au-role" data-v="self"><span class="j-ic y">${I('light')}</span><span class="j-tx"><b>제가 배울래요</b><small>배움님 · 스마트폰을 1:1로 배워요</small></span>${I('back','j-chev')}</button>
  <button class="j-opt" data-a="au-role" data-v="child"><span class="j-ic y">${I('user')}</span><span class="j-tx"><b>부모님 대신 신청해요</b><small>자녀분 · 부모님 수업을 신청하고 결제해요</small></span>${I('back','j-chev')}</button>
  <button class="j-opt" data-a="au-role" data-v="mentor"><span class="j-ic b">${I('camera')}</span><span class="j-tx"><b>선생님으로 활동할래요</b><small>대학생 프렌드 · 재학 확인이 필요해요</small></span>${I('back','j-chev')}</button>
 </div>`;
 return h.replace(/<div class="j-opts">[\s\S]*?<\/main>/,opts+'\n</main>')};
A['au-role']=v=>{const p=PEND;if(!p)return;
 if(v==='mentor'){Object.assign(S.tu,{id:p.legacyId,pw:p.pw,pw2:p.pw,name:p.name||S.tu.name,phone:p.phone||''});A.join('mentor');return}
 const kid=v==='child';Object.assign(S.sr,{id:p.legacyId,pw:p.pw,pw2:p.pw,byChild:kid});
 if(kid){S.sr.name='';S.sr.phone='';S.sr.cphone=p.phone||''}           // 간편로그인 한 사람 = 자녀 → 자녀 번호로
 else{S.sr.name=p.name||'';S.sr.phone=p.phone||'';S.sr.cphone=''}
 S.sms.ph=S.sr.phone;A.join('mentee')};
/* 가입 화면에서 '누가 배우시나요'를 바꾸면 미리 채운 칸도 옮겨요 */
const _srWho=A['sr-who'];
A['sr-who']=v=>{const p=PEND;if(p){const kid=v==='child';
  if(kid&&!S.sr.byChild){if(S.sr.name===p.name)S.sr.name='';if(S.sr.phone===p.phone){S.sr.phone='';S.sms.ph=''}if(!S.sr.cphone)S.sr.cphone=p.phone||''}
  if(!kid&&S.sr.byChild){if(!S.sr.name.trim())S.sr.name=p.name||'';if(!S.sr.phone){S.sr.phone=p.phone||S.sr.cphone||'';S.sms.ph=S.sr.phone}}}
 return _srWho(v)};
/* 아이디·비밀번호 칸 대신 "○○ 계정으로 가입해요" 안내 */
const acctBox=()=>{const nm=PROV[PEND.provider];return `<div class="au-who card"><span class="au-ic sm ${PEND.provider}">${PEND.provider==='naver'?'N':'<span class="kb"></span>'}</span><span><b>${nm} 계정으로 가입해요${PEND.demo?' <em class="au-tag">시연용</em>':''}</b><small>아이디·비밀번호는 만들지 않아도 돼요. 다음부터 '${nm}로 시작하기'만 누르세요.</small></span></div>`};
const swapAcct=(h,p,o)=>{let f='';try{f=acctFields(p,o)}catch(e){}
 if(f&&h.includes(f))return h.replace('<div class="sec">로그인 정보</div>','<div class="sec">로그인</div>').replace(f,acctBox());return h};
const _scSignup=SC.signup;
SC.signup=()=>{const h=_scSignup();if(!PEND)return h;let o=swapAcct(h,'sr',S.sr);
 if(!S.sr.phone&&!S.sr.byChild)o=o.replace('placeholder="010-0000-0000">','placeholder="010-0000-0000" class="au-need">');   // 번호를 못 받았으면 눈에 띄게
 return o};
const _scTsign=SC.tsign;
SC.tsign=()=>{const h=_scTsign();return PEND?swapAcct(h,'tu',S.tu):h};
/* 일반 회원가입에서는 kakao·naver로 시작하는 아이디를 막아요 (간편로그인 계정용) */
const RESV=/^(kakao|naver)/i;
const _srDone=A['sr-done'];A['sr-done']=(...x)=>{if(!PEND&&RESV.test(S.sr.id||'')){T('kakao·naver로 시작하는 아이디는 쓸 수 없어요');return}return _srDone(...x)};
const _tuNext1=A['tu-next1'];A['tu-next1']=(...x)=>{if(!PEND&&RESV.test(S.tu.id||'')){T('kakao·naver로 시작하는 아이디는 쓸 수 없어요');return}return _tuNext1(...x)};

/* 가입이 끝날 때(saveAcct 로 예전 계정이 처음 저장될 때) baep_users/{uid} 연결 저장 */
let _joinedMsg=null;
const _save=saveAcct;
saveAcct=async(id,a)=>{const p=PEND;
 if(p&&id===p.legacyId&&a&&a.role){a.social={provider:p.provider,uid:p.uid};PEND=null;
  const r=await _save(id,a);
  const who=a.role==='mentee'?(a.sr||{}):(a.tu||{});
  linkSet(p,{provider:p.provider,role:a.role,byChild:!!(a.sr&&a.sr.byChild),name:who.name||p.name||'',phone:who.phone||p.phone||'',legacyId:id});
  CUR={uid:p.uid,provider:p.provider,legacyId:id,fb:p.fb};_joinedMsg=PROV[p.provider];
  return r}
 return _save(id,a)};
/* 가입 완료 안내: "아이디 ○○로 로그인하세요" 대신 간편로그인 안내 */
const _toast=toast;
toast=function(m,ms){if(_joinedMsg&&/^가입했어요\. 다음부터 아이디/.test(String(m))){m=`가입했어요. 다음부터 '${_joinedMsg}로 시작하기'만 누르세요`;_joinedMsg=null}return _toast(m,ms)};

/* ---------- 5. 내 프로필 → 회원 탈퇴 ---------- */
const wdLink=()=>`<button class="link au-wd" data-a="au-wd">회원 탈퇴</button>`;
const meLine=h=>CUR&&S.me===CUR.legacyId?h.replace(/로그인 아이디 · [^<]*/,`${PROV[CUR.provider]} 계정으로 로그인했어요`):h;
const addWd=h=>{const at='<button class="btn ghost" data-a="logo">로그아웃</button>';return h.includes(at)&&!h.includes('data-a="au-wd"')?meLine(h).replace(at,at+wdLink()):h};
const _scMine=SC.mine;SC.mine=()=>addWd(_scMine());
const _scTmine=SC.tmine;SC.tmine=()=>addWd(_scTmine());

let WD={ok:false,busy:false,from:null};
SC.au_wd=()=>{const a=S.me&&ACCOUNTS[S.me];const mentor=a?a.role==='mentor':S.member.mentor&&!S.member.mentee;const nm=CUR&&S.me===CUR.legacyId?PROV[CUR.provider]:'';
 const items=[['user','계정 정보','아이디·이름·휴대폰 번호·주소'],['cal','예약·수업 기록','잡아 둔 예약과 지난 수업, 프렌드 메모'],['msg','후기·의견','남긴 수업 후기와 보낸 의견'],
  mentor?['shield','프렌드 정보','재학증명서·정산 계좌·활동 시간']:['chart','연습 기록','혼자 연습한 기록과 숙지도'],nm?['lock',nm+' 연결','다음부터 '+nm+'로 시작하면 새로 가입해야 해요']:null].filter(Boolean);
 const book=!mentor&&S.booking?`<div class="note au-warn">${I('bell')} 남은 수업이 있어요. 탈퇴하면 예약도 함께 취소돼요. 결제한 수업은 먼저 취소·환불을 받아 주세요.</div>`:'';
 return hdr('회원 탈퇴')+`<main class="body au-wdm">
 <h2 class="q">정말 탈퇴하시겠어요?</h2>
 <p class="sub" style="margin:0">탈퇴하면 아래 정보가 <b>바로 지워지고</b>, 다시 되돌릴 수 없어요.</p>
 <div class="card au-list">${items.map(([ic,t,d])=>`<div>${I(ic)}<span><b>${t}</b><small>${d}</small></span></div>`).join('')}</div>
 ${book}
 <div class="note small">결제·환불 기록은 전자상거래법에 따라 <b>5년 동안</b> 따로 보관한 뒤 지워요.</div>
 <div class="agree au-agree"><button class="${WD.ok?'on':''}" data-a="au-wd-ok" aria-pressed="${WD.ok}"><span class="bx">${WD.ok?'✓':''}</span>위 내용을 확인했어요</button></div>
 </main><footer class="cta au-two"><button class="btn ghost" data-a="back">취소</button><button class="btn au-red" data-a="au-wd-go" ${WD.ok&&!WD.busy?'':'disabled'}>${WD.busy?'지우고 있어요…':'탈퇴하기'}</button></footer>`};
try{if(typeof SCN==='object'&&SCN)SCN.au_wd=['번호 없음','회원 탈퇴',1]}catch(e){}
A['au-wd']=()=>{WD={ok:false,busy:false};go('au_wd')};
A['au-wd-ok']=()=>{if(WD.busy)return;WD.ok=!WD.ok;render()};
A['au-wd-go']=async()=>{if(!WD.ok||WD.busy)return;WD.busy=true;render();
 const id=S.me;const a=id&&ACCOUNTS[id];
 /* 시연 계정·둘러보기는 지우지 않고 로그아웃만 */
 if(!id||!a||a.demo||DEMO_IDS.includes(id)){WD.busy=false;A.logo();T('시연 계정은 지우지 않고 로그아웃했어요',2800);return}
 const cur=CUR&&CUR.legacyId===id?CUR:null;
 const uid=cur?cur.uid:(a.social&&a.social.uid)||null;
 let needRelogin=false;
 try{
  const db=await within(getDB(),9000);
  /* 1) 간편로그인 연결 */
  if(uid)await linkDel(uid,!!(FB&&isSocialUser(curUser())));
  /* 2) 예약 요청 · 계정 문서 (규칙에 막히면 넘어가요) */
  if(db){try{if(db.collection){for(const f of ['from','to']){const q=await within(db.collection('baep_requests').where(f,'==',id).get(),6000);if(q&&q.docs)for(const d of q.docs){try{await d.ref.delete()}catch(e){}}}}}catch(e){console.warn('[feat-auth] 예약 삭제 건너뜀',e)}
   try{const r=db.doc('baep_accounts/'+id);if(r&&r.delete)await within(r.delete(),8000)}catch(e){console.warn('[feat-auth] 계정 문서 삭제 실패',e)}}
  /* 3) 워커(카카오·네이버 연결 끊기 등) + Firebase 로그인 계정 */
  const u=curUser();
  if(FB&&isSocialUser(u)){
   if(CFG.workerUrl){try{const tk=await u.getIdToken();await within(fetch(CFG.workerUrl+'/auth/delete',{method:'POST',headers:{Authorization:'Bearer '+tk}}),8000)}catch(e){console.warn('[feat-auth] 워커 삭제 요청 실패(무시)',e)}}
   try{await u.delete()}catch(e){console.warn('[feat-auth] Firebase 계정 삭제 실패',e);if(e&&e.code==='auth/requires-recent-login')needRelogin=true;try{await firebase.auth().signOut()}catch(_){}}
   _authP=null;authReady()}
 }catch(e){console.warn('[feat-auth] 탈퇴 중 문제',e)}
 /* 4) 이 폰에 남은 것 지우기 */
 ldel('baep3_acc_'+id);ldel('baep3_paysnap');if(uid)ldel(K_LINK+uid);
 try{Object.keys(localStorage).filter(k=>k.startsWith('baep3_')&&k.includes(id)).forEach(ldel)}catch(e){}
 delete ACCOUNTS[id];try{S.ad.apps=S.ad.apps.filter(x=>x.acct!==id)}catch(e){}
 CUR=null;PEND=null;WD={ok:false,busy:false};
 A.logo();
 if(needRelogin)T('보안 확인이 필요해요. 다시 로그인한 뒤 한 번 더 탈퇴를 눌러 주세요',4200);
 else T('탈퇴했어요. 그동안 고마웠어요',3200)};

/* ---------- 6. 로그아웃 · 화면 이동 정리 ---------- */
const _logo=A.logo;
A.logo=(...x)=>{const r=_logo(...x);CUR=null;PEND=null;closeSheet();
 const u=curUser();if(FB&&isSocialUser(u)){firebase.auth().signOut().catch(()=>{}).then(()=>{_authP=null;authReady()})}
 return r};
const _render=render;
render=function(){
 if(S.screen==='join'&&PEND){PEND=null;const u=curUser();if(FB&&isSocialUser(u)&&!CUR)firebase.auth().signOut().catch(()=>{}).then(()=>{_authP=null;authReady()})}  // 가입하다 첫 화면으로 돌아오면 취소
 if(S.screen!=='join')closeSheet();
 if(S.screen!=='au_wd')WD={ok:false,busy:false};
 return _render.apply(this,arguments)};

/* ---------- 7. 워커에서 돌아왔을 때 (#baep_auth=… / #baep_auth_error=…) ---------- */
function readHash(){const h=location.hash||'';const m=h.match(/[#&]baep_auth=([^&]+)/),er=h.match(/[#&]baep_auth_error=([^&]+)/);if(!m&&!er)return null;
 try{history.replaceState(null,'',location.pathname+location.search)}catch(e){try{location.hash=''}catch(_){}}   // 토큰이 주소창·기록에 남지 않게 바로 지워요
 if(er)return {error:decodeURIComponent(er[1])};
 try{return {data:b64json(decodeURIComponent(m[1]))}}catch(e){console.warn('[feat-auth] 로그인 정보 해석 실패',e);return {error:'bad_payload'}}}
async function handleReturn(r){
 try{const ui=JSON.parse(lget(K_UI)||'null');if(ui&&Date.now()-ui.at<36e5)S.big=!!ui.big}catch(e){}ldel(K_UI);
 S.hist=[];S.screen='join';render();
 if(r.error){T(/cancel/i.test(r.error)?'로그인을 취소했어요':'로그인하지 못했어요. 다시 해 주세요',3000);return}
 const d=r.data||{};const prov=d.provider==='naver'?'naver':'kakao';
 let uid=String(d.uid||'');const pid=uid.includes(':')?uid.split(':').slice(1).join(':'):uid;
 if(!pid){T('로그인하지 못했어요. 다시 해 주세요',3000);return}
 T(PROV[prov]+' 계정을 확인하고 있어요…',6000);
 let fb=false;
 if(FB){/* Firebase 가 있으면 토큰으로 로그인하고, uid 는 Firebase 가 알려준 값을 믿어요 */
  try{const au=await fbAuth();if(!au)throw new Error('no-firebase');
   const cred=await within(au.signInWithCustomToken(d.token),15000);if(!cred||!au.currentUser)throw new Error('timeout');
   uid=au.currentUser.uid;fb=true}
  catch(e){console.warn('[feat-auth] 커스텀 토큰 로그인 실패',e);_tokenWanted=false;_authP=null;authReady();T('로그인하지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요',3600);return}
  _tokenWanted=false}
 else uid=prov+':'+pid;
 await afterSocial({uid,provider:prov,pid:uid.includes(':')?uid.split(':').slice(1).join(':'):pid,name:String(d.name||'').trim(),email:d.email||'',phone:d.phone||'',fb})}

/* ---------- 8. 모양 ---------- */
if(!document.getElementById('feat-auth-css')){const st=document.createElement('style');st.id='feat-auth-css';st.textContent=`
.btn.naver{background:#03C75A;color:#fff;display:flex;align-items:center;justify-content:center;gap:.5em}
.btn.naver:hover{background:#02B351}
.btn.naver .nb,.au-ic.naver{display:inline-grid;place-items:center;width:1.25em;height:1.25em;border-radius:4px;background:#fff;color:#03C75A;font-weight:900;font-size:.85em;line-height:1;font-family:Arial,sans-serif}
.au-sns{display:flex;flex-direction:column;gap:.5em}
.j .au-sns .btn{min-height:3.1em;font-size:1.08em}
.au-or{display:flex;align-items:center;gap:.6em;color:var(--ink-3);font-size:.82em;font-weight:700;margin:-.1em 0 -.2em}
.au-or::before,.au-or::after{content:"";flex:1;height:1px;background:var(--line)}
.au-ov{position:absolute;inset:0;z-index:45;background:rgba(20,32,45,.45);display:flex;flex-direction:column;justify-content:flex-end;animation:auin .2s ease-out}
@keyframes auin{from{opacity:0}to{opacity:1}}
.au-s{background:var(--paper);border-radius:24px 24px 0 0;padding:1em 1.1em calc(1.2em + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:.75em;max-height:92%;overflow-y:auto;font-size:17px}
.big .au-s{font-size:20px}
.au-mid{display:flex;flex-direction:column;align-items:center;gap:.5em;text-align:center;padding:.6em 0 .2em}
.au-mid b{font-size:1.2em}.au-mid p{margin:0;color:var(--ink-2);font-size:.92em;line-height:1.55}
.au-ic{width:3.2em;height:3.2em;border-radius:16px;display:grid;place-items:center;flex:none;font-weight:900;font-family:Arial,sans-serif;font-size:1.1em}
.au-ic.kakao{background:#FEE500}.au-ic.naver{width:3.2em;height:3.2em;border-radius:16px;background:#03C75A;color:#fff;font-size:1.3em}
.au-ic.sm{width:2.6em;height:2.6em;border-radius:14px}
.au-ic .kb{width:1.35em;height:1.1em;background:#191919;border-radius:50%;position:relative}
.au-ic .kb:after{content:'';position:absolute;left:.25em;bottom:-.28em;border:.25em solid transparent;border-top-color:#191919;border-left-width:.1em}
.au-demo{flex-direction:column;align-items:flex-start;gap:.15em}.au-demo small{font-size:1em}
.au-who{display:flex;align-items:center;gap:.8em;padding:.8em .9em}
.au-who>span:last-child{display:flex;flex-direction:column;gap:.15em}.au-who small{color:var(--ink-2);font-size:.85em;line-height:1.45}
.au-tag{font-style:normal;font-size:.72em;font-weight:800;background:var(--butter-2);color:#8A5A00;border-radius:6px;padding:.1em .45em;vertical-align:2px}
input.au-need{border-color:var(--gold)!important;background:var(--butter-2)}
.au-wd{align-self:center;color:var(--ink-3);font-size:.9em;font-weight:600;margin-top:.2em;min-height:44px}
.au-wdm{gap:.8em}
.au-list{display:flex;flex-direction:column;gap:.75em}
.au-list>div{display:flex;gap:.7em;align-items:flex-start}.au-list svg{width:1.3em;height:1.3em;flex:none;color:var(--coral);margin-top:.1em}
.au-list span{display:flex;flex-direction:column;gap:.1em}.au-list small{color:var(--ink-2);font-size:.85em}
.au-warn{background:var(--coral-2);color:var(--ink);display:flex;gap:.5em;align-items:flex-start}.au-warn svg{width:1.2em;height:1.2em;flex:none;color:var(--coral);margin-top:.15em}
.agree.au-agree button{font-weight:800;font-size:1.05em;min-height:44px}
.cta.au-two{display:grid;grid-template-columns:1fr 1.4fr;gap:.5em}
.btn.au-red{background:var(--coral);color:#fff}
.btn.au-red:disabled{background:#E9C9C1;color:#fff;cursor:not-allowed}
`;document.head.appendChild(st)}

/* ---------- 9. 시작 ---------- */
if(LIVE){const r=readHash();
 if(r){if(r.data&&FB)_tokenWanted=true;handleReturn(r).catch(e=>{console.warn('[feat-auth]',e);T('로그인하지 못했어요. 다시 해 주세요',3000)})}
 else if(S.screen==='join')render();   // 로그인 화면이 이미 떠 있으면 버튼이 보이게 다시 그리기
 /* 같은 페이지에서 주소 끝(#)만 바뀌어 돌아온 경우 */
 window.addEventListener('hashchange',()=>{const r=readHash();if(!r)return;if(r.data&&FB)_tokenWanted=true;handleReturn(r).catch(e=>{console.warn('[feat-auth]',e);T('로그인하지 못했어요. 다시 해 주세요',3000)})})}
/* 확인·테스트용 */
window.__BAEP_AUTH_DEBUG={get pending(){return PEND},get current(){return CUR},legacyIdFor,b64json,normPhone,authReady};
})();
