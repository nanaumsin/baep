/* feat-auth.js — 배프 간편로그인(카카오·네이버) · 회원 탈퇴
   index.html 맨 끝에서 읽혀요. index.html 의 전역(S·SC·A·render, 그리고 v2 로그인 부분의 api·signInToken·enterAccount·SES 등)을 써요.
   약속: docs/ARCH-v2.md

   흐름
   1) 로그인 화면에 [카카오로 시작하기] [네이버로 시작하기]
      - 워커 주소(auth-config.js workerUrl)가 없거나 Firebase 가 없으면: "준비 중" 안내 (+ 'demo' 모드에서는 시연용으로 계속하기 — 이 기기 안에서만)
      - 있으면: 워커(/auth/<provider>/start)로 이동 → 돌아올 때 #baep_auth=<base64url JSON> 또는 #baep_auth_error=<code>
   2) 돌아오면: signInWithCustomToken(token) → ID 토큰 claims 확인
      - claims.acct 가 있으면(이미 가입한 사람) 그 계정으로 바로 로그인
      - 없으면 역할 고르기 → 가입 화면(이름·휴대폰 미리 채움, 아이디·비밀번호 칸 없음)
        → 가입 완료 때 POST /auth/signup (Authorization: Bearer <ID 토큰>) → 받은 token 으로 다시 로그인
      (baep_users 연결 문서는 서버가 만들어요. 앱은 쓰지 않아요)
   3) 회원 탈퇴: '내 프로필' 맨 아래 → 확인 화면 → POST /auth/delete (Bearer) → 서버가 계정·문서·로그인을 지워요
   4) 로그아웃하면 Firebase 로그인도 끝내요 (그 뒤 공개 정보 읽기용 익명 로그인) */
(function(){
'use strict';
if(window.__BAEP_AUTH_LOADED)return;              // 두 번 읽혀도 한 번만 붙이기
window.__BAEP_AUTH_LOADED=true;
if(typeof S==='undefined'||typeof SC==='undefined'||typeof A==='undefined'||typeof render!=='function'||typeof api!=='function'){console.warn('[feat-auth] 앱 본문을 찾지 못해 건너뛰어요');return}

/* ---------- 0. 설정 · 작은 도구 ---------- */
const CFG=Object.assign({workerUrl:'',kakao:true,naver:true},window.BAEP_AUTH||{});
const PAGE=window.__V3MODE||'app';                  // 'app' | 'frame'(전체 화면 보기 안 작은 화면) | 'board'
const ACTIVE=PAGE==='app'&&!window.__KIOSK&&!ADMIN_APP;   // 실제로 눌러 쓰는 사용자 앱일 때만 시작 동작(해시 처리)
const REAL=()=>NET&&!!WORKER;                       // 진짜 간편로그인을 쓸 수 있어요
const PROV={kakao:'카카오',naver:'네이버'};
const lget=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lset=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
const ldel=k=>{try{localStorage.removeItem(k)}catch(e){}};
const K_UI='baep_auth_ui',K_DEMO='baep3_demo_social_';
const ph=()=>document.getElementById('phone');
const E=v=>(typeof esc==='function'?esc(v):String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'));
const T=(m,ms)=>{try{toast(m,ms)}catch(e){}};
const rand=n=>{const a=new Uint8Array(n);try{crypto.getRandomValues(a)}catch(e){for(let i=0;i<n;i++)a[i]=Math.random()*256|0}return [...a].map(x=>'abcdefghijkmnpqrstuvwxyz23456789'[x%32]).join('')};
/* 휴대폰 번호 맞추기: +82 10-1234-5678 → 010-1234-5678 */
const normPhone=p=>{let d=String(p||'').replace(/[^\d+]/g,'');if(d.startsWith('+82'))d='0'+d.slice(3).replace(/^0/,'');d=d.replace(/\D/g,'');
 if(/^01\d{8,9}$/.test(d))return d.length===10?`${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`:`${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;return ''};
/* base64url → 글자 (한글 이름이 깨지지 않게 TextDecoder) */
const b64json=s=>{s=String(s).replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const bin=atob(s);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return JSON.parse(new TextDecoder().decode(u))};

/* ---------- 1. 가입 중인 간편로그인 사람 ----------
   PEND = {provider, label, name, email, phone, uid, fb:true}      진짜(서버 로그인함, 아직 acct 없음)
        = {provider, label, name, demo:true, localId}               시연(이 기기 안에서만)
   index.html 의 가입 완료(sr-done·tu-submit)가 window.BAEP_SOCIAL 을 보고 /auth/signup 을 Bearer 로 불러요 */
let PEND=null;
const setPend=p=>{PEND=p;window.BAEP_SOCIAL=p};
async function cancelPend(){const p=PEND;setPend(null);if(p&&p.fb&&!SES.acct)await signOutAll(true)}

/* ---------- 2. 로그인 화면 버튼 ---------- */
const snsBtns=()=>{if(!CFG.kakao&&!CFG.naver)return '';
 return `<div class="au-sns">${CFG.kakao?`<button class="btn kakao au-btn" data-a="au-sns" data-v="kakao"><span class="kb"></span>카카오로 시작하기</button>`:''}${CFG.naver?`<button class="btn naver au-btn" data-a="au-sns" data-v="naver"><span class="nb">N</span>네이버로 시작하기</button>`:''}</div><div class="au-or"><span>또는 아이디로 로그인</span></div>`};
const _scJoin=SC.join;
SC.join=()=>{const h=_scJoin();const at='<div class="card login">';return h.includes(at)?h.replace(at,snsBtns()+at):h};

/* 안내 창 (결제창처럼 휴대폰 화면 위에 덮기) */
function sheet(html){closeSheet();if(!html)return;const el=document.createElement('div');el.className='au-ov';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.innerHTML=`<div class="au-s">${html}</div>`;
 el.addEventListener('click',e=>{if(e.target===el)closeSheet()});(ph()||document.body).appendChild(el)}
function closeSheet(){document.querySelectorAll('.au-ov').forEach(x=>x.remove())}

A['au-sns']=prov=>{prov=prov==='naver'?'naver':'kakao';const nm=PROV[prov];
 if(!REAL()){const had=DEMO_MODE&&!!lget(K_DEMO+prov);
  sheet(`<div class="ck-h"><b>${nm}로 시작하기</b><button class="ck-x" data-a="au-close" aria-label="닫기">${I('x')}</button></div>
   <div class="au-mid"><span class="au-ic ${prov}">${prov==='naver'?'N':'<span class="kb"></span>'}</span><b>간편로그인은 준비 중이에요</b><p>운영자 설정 전이라 아직 ${nm} 계정으로 들어갈 수 없어요.<br>지금은 아이디·비밀번호로 로그인하거나 회원가입을 해 주세요.</p></div>
   ${DEMO_MODE?`<div class="demo-bar au-demo"><span>시연용</span><small>발표·시연 때만 써요. 진짜 ${nm} 로그인은 하지 않고, 이 기기 안에서만 움직여요.</small></div>
   <button class="btn ${prov} au-btn demo-only" data-a="au-demo" data-v="${prov}">${had?'시연용 · 가입한 사람처럼 들어가기':`시연용 · ${nm} 로그인한 것처럼 계속하기`}</button>
   ${had?`<button class="link demo-only" data-a="au-demo" data-v="${prov}-new" style="align-self:center">시연용 · 처음 가입하는 것처럼 보기</button>`:''}`:''}
   <button class="btn ghost" data-a="au-close">닫기</button>`);return}
 /* 실제: 워커로 이동. 돌아왔을 때 글자 크기 같은 화면 상태만 되살려요 */
 lset(K_UI,JSON.stringify({big:!!S.big,provider:prov,at:Date.now()}));
 const ret=location.origin+location.pathname;
 location.assign(`${WORKER}/auth/${prov}/start?return=${encodeURIComponent(ret)}`)};
A['au-close']=()=>closeSheet();
/* 시연: 진짜 로그인 없이 가짜 프로필(김배움)로 계속 — 이 기기 안에서만 (Firestore·서버 안 씀) */
A['au-demo']=v=>{if(!DEMO_MODE)return;closeSheet();const fresh=/-new$/.test(v||'');const prov=String(v||'kakao').replace(/-new$/,'')==='naver'?'naver':'kakao';
 let saved=null;try{saved=JSON.parse(lget(K_DEMO+prov)||'null')}catch(e){}
 if(saved&&!fresh&&saved.acct&&saved.account){/* 전에 시연으로 가입했던 사람 */
  const id=saved.acct;ACCOUNTS[id]=Object.assign({role:saved.role,demo:true,local:true},saved.account);S.me=id;S.hist=[];
  if(saved.role==='mentee'){Object.assign(S.sr,saved.account.sr||{});setHome();S.member.mentee=true;S.screen='home'}
  else{Object.assign(S.tu,saved.account.tu||{});S.member.mentor=true;addMe();S.screen=S.tu.approved?'thome':'tpending'}
  render();T((saved.role==='mentee'?S.sr.name+' 님':S.tu.name+' 프렌드님')+', 어서 오세요 ('+PROV[prov]+' · 시연)');return}
 if(fresh)ldel(K_DEMO+prov);
 setPend({provider:prov,label:PROV[prov],name:'김배움',email:'',phone:'',demo:true,localId:prov+'demo'+rand(5)});
 S.hist=['join'];S.screen='pick';render();T('김배움 님, 반가워요! 어떻게 쓰실지 골라 주세요',2600)};
/* 시연 가입이 끝나면 이 기기에 기억 (다음에 '가입한 사람처럼 들어가기') */
addEventListener('baep:session',e=>{const d=e.detail||{};if(d.live||!d.acct||!/^(kakao|naver)demo/.test(d.acct))return;const a=ACCOUNTS[d.acct];if(!a)return;
 const prov=d.acct.startsWith('naver')?'naver':'kakao';const account={};['sr','tu','date'].forEach(k=>{if(a[k])account[k]=stripPw(a[k])});
 lset(K_DEMO+prov,JSON.stringify({acct:d.acct,role:d.role,account}))});

/* ---------- 3. 역할 고르기 · 가입 화면 (간편로그인으로 가입 중일 때만 바뀜) ---------- */
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
 if(v==='mentor'){Object.assign(S.tu,{id:'',pw:'',pw2:'',name:p.name||S.tu.name,phone:p.phone||''});A.join('mentor');return}
 const kid=v==='child';Object.assign(S.sr,{id:'',pw:'',pw2:'',byChild:kid});
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
/* 가입이 끝나면 (index.html 이 BAEP_SOCIAL 을 비워요) 여기도 정리 */
addEventListener('baep:session',()=>{if(!window.BAEP_SOCIAL)PEND=null});

/* ---------- 4. 내 프로필 → 회원 탈퇴 ---------- */
const socialNow=()=>SES.acct&&S.me===SES.acct&&PROV[SES.provider]?SES.provider:(S.me&&/^(kakao|naver)demo/.test(S.me)?(S.me.startsWith('naver')?'naver':'kakao'):null);
const wdLink=()=>`<button class="link au-wd" data-a="au-wd">회원 탈퇴</button>`;
const meLine=h=>{const p=socialNow();return p?h.replace(/로그인 아이디 · [^<]*/,`${PROV[p]} 계정으로 로그인했어요`):h};
const addWd=h=>{const at='<button class="btn ghost" data-a="logo">로그아웃</button>';return h.includes(at)&&!h.includes('data-a="au-wd"')?meLine(h).replace(at,at+wdLink()):h};
const _scMine=SC.mine;SC.mine=()=>addWd(_scMine());
const _scTmine=SC.tmine;SC.tmine=()=>addWd(_scTmine());

let WD={ok:false,busy:false};
SC.au_wd=()=>{const a=S.me&&ACCOUNTS[S.me];const mentor=a?a.role==='mentor':S.member.mentor&&!S.member.mentee;const p=socialNow();const nm=p?PROV[p]:'';
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
/* 이 폰에 남은 그 계정의 것 지우기 */
const wipeLocal=id=>{if(!id)return;ldel('baep3_acc_'+id);ldel('baep3_paysnap');
 try{Object.keys(localStorage).filter(k=>k.startsWith('baep3_')&&k.endsWith('_'+id)).forEach(ldel)}catch(e){}
 ['kakao','naver'].forEach(p=>{try{const x=JSON.parse(lget(K_DEMO+p)||'null');if(x&&x.acct===id)ldel(K_DEMO+p)}catch(e){}})};
A['au-wd-go']=async()=>{if(!WD.ok||WD.busy)return;const id=S.me;const a=id&&ACCOUNTS[id];
 /* 시연 계정·둘러보기·이 기기 시연 가입: 서버에 아무것도 없어요 → 로그아웃만 */
 if(!id||!a||a.demo||DEMO_IDS.includes(id)||!live()){const local=!!(a&&a.local);WD={ok:false,busy:false};if(local){wipeLocal(id);delete ACCOUNTS[id]}A.logo();T(local?'시연 가입 정보를 지우고 로그아웃했어요':'시연 계정은 지우지 않고 로그아웃했어요',2800);return}
 WD.busy=true;render();
 const r=await api('/auth/delete',{},{bearer:true});
 if(!r.ok){WD.busy=false;render();T(r.code==='AUTH_REQUIRED'?'보안 확인이 필요해요. 다시 로그인한 뒤 한 번 더 탈퇴를 눌러 주세요':'탈퇴하지 못했어요. '+errMsg(r),4200);return}
 /* 서버가 Firestore 문서·로그인 계정까지 지웠어요. 이 폰 정리 → 첫 화면으로 */
 wipeLocal(id);delete ACCOUNTS[id];try{S.ad.apps=S.ad.apps.filter(x=>x.acct!==id)}catch(e){}
 setPend(null);WD={ok:false,busy:false};
 A.logo();T('탈퇴했어요. 그동안 고마웠어요',3200)};

/* ---------- 5. 로그아웃 · 화면 이동 정리 ---------- */
const _logo=A.logo;
A.logo=(...x)=>{const p=PEND;setPend(null);closeSheet();const r=_logo(...x);if(p&&p.fb&&!SES.acct)signOutAll(true);return r};
const _render=render;
render=function(){
 if(S.screen==='join'&&PEND)cancelPend();   // 가입하다 첫 화면으로 돌아오면 취소
 if(S.screen!=='join')closeSheet();
 if(S.screen!=='au_wd')WD={ok:false,busy:false};
 return _render.apply(this,arguments)};

/* ---------- 6. 워커에서 돌아왔을 때 (#baep_auth=… / #baep_auth_error=…) ---------- */
function readHash(){const h=location.hash||'';const m=h.match(/[#&]baep_auth=([^&]+)/),er=h.match(/[#&]baep_auth_error=([^&]+)/);if(!m&&!er)return null;
 try{history.replaceState(null,'',location.pathname+location.search)}catch(e){try{location.hash=''}catch(_){}}   // 토큰이 주소창·기록에 남지 않게 바로 지워요
 if(er)return {error:decodeURIComponent(er[1])};
 try{return {data:b64json(decodeURIComponent(m[1]))}}catch(e){console.warn('[feat-auth] 로그인 정보 해석 실패',e);return {error:'bad_payload'}}}
async function handleReturn(r){
 try{const ui=JSON.parse(lget(K_UI)||'null');if(ui&&Date.now()-ui.at<36e5)S.big=!!ui.big}catch(e){}ldel(K_UI);
 S.hist=[];S.screen='join';render();
 if(r.error){T(/cancel/i.test(r.error)?'로그인을 취소했어요':'로그인하지 못했어요. 다시 해 주세요',3000);return}
 const d=r.data||{};const prov=d.provider==='naver'?'naver':'kakao';
 if(!d.token||!NET){T('로그인하지 못했어요. 다시 해 주세요',3000);return}
 T(PROV[prov]+' 계정을 확인하고 있어요…',6000);
 /* 토큰으로 로그인하고, 누구인지는 Firebase 가 알려준 claims 를 믿어요 (주소의 값은 믿지 않아요) */
 const s=await signInToken(d.token);
 if(!s){T('로그인하지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요',3600);return}
 if(s.acct){
  if(s.role==='admin'){await signOutAll(true);T('운영자 계정은 운영자 화면에서만 로그인할 수 있어요',3600);return}
  const ok=await enterAccount(s.acct,s.role,{via:PROV[prov]});
  if(!ok){await signOutAll(true);T('계정 정보를 불러오지 못했어요. 잠시 후 다시 해 주세요',3600)}
  return}
 /* 처음 온 사람: 역할 고르기 → 가입 (가입 완료 때 /auth/signup 을 Bearer 로) */
 setPend({provider:prov,label:PROV[prov],uid:s.uid,name:String(d.name||'').trim(),email:d.email||'',phone:normPhone(d.phone),fb:true});
 S.hist=['join'];S.screen='pick';render();
 T((PEND.name?PEND.name+' 님, 반가워요! ':'')+'어떻게 쓰실지 골라 주세요',2600)}

/* ---------- 7. 모양 ---------- */
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

/* ---------- 8. 시작 ---------- */
if(ACTIVE){const r=readHash();
 if(r)handleReturn(r).catch(e=>{console.warn('[feat-auth]',e);T('로그인하지 못했어요. 다시 해 주세요',3000)});
 else if(S.screen==='join')render();   // 로그인 화면이 이미 떠 있으면 버튼이 보이게 다시 그리기
 /* 같은 페이지에서 주소 끝(#)만 바뀌어 돌아온 경우 */
 window.addEventListener('hashchange',()=>{const r=readHash();if(!r)return;handleReturn(r).catch(e=>{console.warn('[feat-auth]',e);T('로그인하지 못했어요. 다시 해 주세요',3000)})})}
/* 확인·테스트용 */
window.__BAEP_AUTH_DEBUG={get pending(){return PEND},b64json,normPhone};
})();
