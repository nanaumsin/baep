/* feat-outing.js — 배프 "나들이" (작은 그룹 외출)
   index.html 맨 끝에서 읽혀요. index.html은 고치지 않고, 이미 있는 전역(S·SC·A·render·go·toast·noti 등)을 감싸서 붙여요.

   나들이 = 동네 배움님 2~4명 + 프렌드 1~2명이 함께
     ① 각자 카페로 모이기 → ② 키오스크로 주문 → ③ 공원 산책·사진 미션(사진 찍고 팀 카톡방에 보내기)
     → ④ 택시 부르는 법 배우기 → ⑤ 집에 갈 때 각자 택시 직접 불러 타기
   배움님:  홈 "이웃과 함께 나들이" → 목록 → 소개(키워드 칩·준비수업 배지·가격) → (수업 이력 없으면 추천 시트)
            → 내가 할 수 있는 것 → 함께 갈 분(동반) → 결제 → 신청 완료(팀 배정 중) → 팀 확정 알림·문자
   운영자:  왼쪽 메뉴 "나들이 팀 배정" → 신청자 · [AI 자동 배정] → 팀 옮기기 → [확정하고 문자 보내기]
   프렌드:  홈에 "나들이 배정" 카드
   나들이를 결제해도 '혼자 연습'이 열려요 (S.paid = 1:1 수업 결제 또는 나들이 결제).

   저장소 (docs/ARCH-v2.md)
     진짜 계정(서버 로그인) → Firestore
       신청   baep_outing_apps/{oid}_{acct} = {oid, acct, name, dong, levels, score, companions:[{name,rel,phone}], status:'applied', createdAt, amount}
              결제는 BAEP_TOSS_PAY(kind 'outing', refId = 신청 문서 id) → 서버가 paid 를 써요. 앱은 paid·team·status 를 바꾸지 않아요
       팀     baep_outing_teams/{oid}_{teamNo} (운영자만 씀) · 확정 문자 기록 baep_sms (운영자만)
       남은 자리  baep_outings/{oid}.applied (운영자 화면이 써요 · 누구나 읽음)
     시연 계정·둘러보기 → 이 폰 localStorage(baep3_outing) — 예전과 같아요
   한 화면 보기: index.html?s=join&o=o_list (권장 · 콘솔 오류 없음) 또는 ?s=o_list — o_detail · o_rec · o_apply · o_comp · o_pay · o_paysheet · o_done · o_mine · o_mine_team · o_sms · home_outing · ad_outing · ad_outing_ai · thome_outing */
(function(){
'use strict';
if(window.__BAEP_OUTING_LOADED)return;
window.__BAEP_OUTING_LOADED=true;
if(typeof S==='undefined'||typeof SC==='undefined'||typeof A==='undefined'||typeof render!=='function'){console.warn('[feat-outing] 앱 본문을 찾지 못해 건너뛰어요');return}

/* =====================================================================
   0. 설정 — 숫자·문구는 여기서만 바꾸면 돼요
   ===================================================================== */
const CFG={
 PRICE_PER_HOUR:30000,      // 시간당 1인 참가비 (원)
 HOURS:2,                   // 나들이 한 번 시간 (시간) → 1인 60,000원
 SENIORS_PER_FRIEND:2,      // 프렌드 1명이 맡는 배움님 최대 수
 MAX_PER_TEAM:4,            // 한 팀(나들이 1회) 배움님 최대 수 → 프렌드 2명
 COMPANION_PAYS:true,       // 동반 신청한 분 참가비도 신청자가 같이 결제 (1인 요금 × 인원)
 GAP_WARN:3,                // 같은 팀 안 수준 점수(0~6) 차이가 이만큼 이상이면 '속도가 달라요' 안내
 DIST_W:1,                  // AI 팀 배정: 동네 거리(km) 가중치
 LEVEL_W:0.6,               // AI 팀 배정: 수준 차이 가중치
 SELF_PAY:'택시비·음료비·식사비는 각자 부담해요',
 BRING:'충전된 휴대폰, 교통카드나 카드',
 CS:'1588-0000',
 /* 준비 수업은 '추천'만 해요. 1:1 수업을 안 들었어도 나들이 신청은 막지 않아요 */
 REC_TEXT:'이번 나들이에서는 직접 택시를 부르고 키오스크로 주문해요. 사용법이 낯설다면, 개인 수업에서 천천히 연습한 뒤 참여하시는 걸 추천해요.'
};
const PRICE=CFG.PRICE_PER_HOUR*CFG.HOURS;

/* 나들이 일정 (시연용 · 수원 영통). date는 ND(연,월-1,일) — 12월은 11
   pk: 지도에 핀을 찍을 장소(index.html의 PL 키), teams: 이 날 여는 팀 수(팀마다 배움님 최대 4명) */
const OUTINGS=[
 {id:'o1',short:'광교호수공원',title:'택시 타고 카페에서 키오스크 주문하기',date:ND(2026,11,5),start:'14:00',
  place:'광교호수공원 앞 카페',placeD:'하동 · 키오스크 있는 카페',pk:'lake',
  walk:'광교호수공원 둘레길 산책',photo:'호수가 보이는 전망 데크에서 팀 사진 찍기',teams:3,topics:['taxi','kiosk','kakao']},
 {id:'o2',short:'영통 중심상가',title:'영통 중심상가 카페에서 주문하고 사진 보내기',date:ND(2026,11,12),start:'10:30',
  place:'영통 중심상가 카페',placeD:'영통역 앞 · 키오스크 있는 카페',pk:'ytst',
  walk:'중심상가 옆 공원 산책',photo:'공원 입구 큰 나무 앞에서 서로 찍어 주기',teams:2,topics:['kiosk','kakao','taxi']},
 {id:'o3',short:'망포역',title:'망포역 카페까지 택시 부르고 키오스크 주문하기',date:ND(2026,11,19),start:'14:00',
  place:'망포역 앞 카페',placeD:'망포동 · 키오스크 있는 카페',pk:'mpst',
  walk:'망포역 근처 산책길',photo:'카페 창가에서 주문한 음료 사진 찍기',teams:1,topics:['taxi','kiosk','kakao']}
];
/* 나들이에서 쓰는 세 가지 기술 (키는 TOPICS 키와 같아요 → 칩을 누르면 그 개인 수업을 찾아요) */
const SKILLS=[['kiosk','키오스크 주문','cup'],['taxi','택시 호출','taxi'],['kakao','카톡 사진 보내기','chat']];
const KW={taxi:'택시 호출',kiosk:'키오스크 주문',kakao:'카톡 사진 보내기'};
/* 자가진단: 점수가 높을수록 익숙 (세 가지 합 0~6) */
const LV={self:['혼자 할 수 있어요',2,'혼자'],help:['조금 도와주면 돼요',1,'도움'],new:['처음이에요',0,'처음']};
const LVK=['self','help','new'];
const REL=['배우자','친구','이웃','형제자매'];
/* 동네 순서·위치: index.html의 DONGS 좌표를 써요 (없는 동은 영통동으로) */
const dongXY=d=>{const c=(typeof DONGS!=='undefined'&&DONGS[d])||[37.2560,127.0665];return {lat:c[0],lon:c[1]}};

/* 시연용 신청자 (가짜) — 광교호수공원(o1)에 7명(동반 1명 포함), 다른 날에도 몇 명 */
const SEED=[
 ['o1','f1','박영자',76,'영통동',{kiosk:'help',taxi:'new',kakao:'help'},null,'본인'],
 ['o1','f2','최길순',79,'영통동',{kiosk:'new',taxi:'new',kakao:'help'},null,'자녀'],
 ['o1','f3','이정자',72,'망포동',{kiosk:'self',taxi:'help',kakao:'self'},null,'본인'],
 ['o1','f4','오말순',74,'원천동',{kiosk:'help',taxi:'help',kakao:'self'},{name:'오남수',age:77,rel:'배우자',ph:'010-****-2231'},'자녀'],
 ['o1','f5','한영희',71,'매탄동',{kiosk:'self',taxi:'self',kakao:'self'},null,'본인'],
 ['o1','f6','정옥희',78,'원천동',{kiosk:'help',taxi:'help',kakao:'self'},null,'자녀'],
 ['o2','f7','윤금자',73,'영통동',{kiosk:'new',taxi:'help',kakao:'help'},null,'본인'],
 ['o2','f8','서말자',80,'망포동',{kiosk:'new',taxi:'new',kakao:'new'},{name:'강순례',age:78,rel:'친구',ph:'010-****-8812'},'자녀'],
 ['o3','f9','임춘자',75,'망포동',{kiosk:'help',taxi:'new',kakao:'help'},null,'본인'],
 ['o3','f10','조영숙',72,'영통동',{kiosk:'help',taxi:'help',kakao:'help'},null,'자녀'],
 ['o3','f11','남궁옥',77,'망포동',{kiosk:'new',taxi:'help',kakao:'help'},null,'본인']
];

/* =====================================================================
   1. 저장소 — 신청자·팀은 이 폰 localStorage(baep3_outing)에, 내 신청은 S.outing에도 (계정 저장 KEEP)
   ===================================================================== */
const MODE=window.__V3MODE||'app';
const LS_KEY='baep3_outing';          // 'baep3_'로 시작 → ?new=1 로 처음부터 열면 함께 지워져요
const lsGet=()=>{if(MODE==='frame')return null;try{return localStorage.getItem(LS_KEY)}catch(e){return null}};
const lsSet=v=>{if(MODE==='frame')return;try{localStorage.setItem(LS_KEY,v)}catch(e){}};
const scoreOf=lv=>SKILLS.reduce((s,[k])=>s+(LV[lv[k]]?LV[lv[k]][1]:0),0);
const mkApp=([oid,id,name,age,dong,lv,comp,payer])=>({id,oid,acct:id,name,age,dong,ph:'010-****-'+String(1000+(+id.slice(1))*733%9000),lv,score:scoreOf(lv),comp,payer,method:'카카오페이',
 amt:PRICE*(comp&&CFG.COMPANION_PAYS?2:1),paidAt:md(TODAYN-((id.charCodeAt(1)*7)%6)-1),st:'assign',notis:[]});
const seed=()=>({v:1,apps:SEED.map(mkApp),ev:Object.fromEntries(OUTINGS.map(o=>[o.id,{st:'none',teams:[],fnoti:{}}]))});
let LOCAL=null;
try{const j=lsGet();if(j){const o=JSON.parse(j);if(o&&o.v===1&&Array.isArray(o.apps))LOCAL=o}}catch(e){}
if(!LOCAL)LOCAL=seed();
OUTINGS.forEach(o=>{if(!LOCAL.ev[o.id])LOCAL.ev[o.id]={st:'none',teams:[],fnoti:{}}});
/* 진짜 계정일 때 Firestore 에서 읽어 온 것 (같은 모양으로 바꿔 둬요) */
const emptyRemote=()=>({v:1,remote:true,apps:[],ev:Object.fromEntries(OUTINGS.map(o=>[o.id,{st:'none',teams:[],fnoti:{}}])),teamIds:{},counts:{},at:0,who:null});
let REMOTE=emptyRemote();
let OUT=LOCAL;
const pickStore=()=>{const r=typeof live==='function'&&live();if(r&&REMOTE.who!==S.me){REMOTE=emptyRemote();REMOTE.who=S.me}OUT=r?REMOTE:LOCAL;return OUT};
const save=()=>{if(OUT!==LOCAL){S.outing=null;return}lsSet(JSON.stringify(LOCAL));const a=myApp();S.outing=a?JSON.parse(JSON.stringify(a)):null};
if(typeof KEEP!=='undefined'&&KEEP.mentee&&!KEEP.mentee.includes('outing'))KEEP.mentee.push('outing');

const OB=id=>OUTINGS.find(o=>o.id===id)||OUTINGS[0];
const EV=id=>OUT.ev[id]||(OUT.ev[id]={st:'none',teams:[],fnoti:{}});
const O=()=>S.o||(S.o={cur:'o1',sheet:null,f:null,ck:null,prep:null,adEv:'o1'});
/* 지금 로그인한 배움님 (시연 계정 baeum·baeum01·로그인 없이 둘러보기는 모두 'baeum') */
const meKey=()=>{const id=S.me;if(!id||id==='baeum01'||id==='baeum')return 'baeum';const a=typeof ACCOUNTS!=='undefined'&&ACCOUNTS[id];return a&&a.role==='mentor'?null:id};
const myApp=()=>{const k=meKey();return k?OUT.apps.find(a=>a.acct===k&&a.st!=='cancel'&&!a.ghost)||null:null};
/* 결제를 마친 신청만 팀 배정에 들어가요 (진짜 신청은 서버가 쓴 paid 로 판단) */
const appsOf=oid=>OUT.apps.filter(a=>a.oid===oid&&a.st!=='cancel'&&!(a.remote&&!a.paid&&!a.ghost));
const unpaidOf=oid=>OUT.apps.filter(a=>a.oid===oid&&a.remote&&!a.paid&&!a.ghost&&a.st!=='cancel');
/* 사람 단위 목록: 신청자 + 동반자(같은 동네·같은 수준으로 봐요) */
const persons=oid=>{const L=[];appsOf(oid).forEach(a=>{L.push({pid:a.id,a,name:a.name,age:a.age,score:a.score,dong:a.dong,comp:false});
 if(a.comp)L.push({pid:a.id+'c',a,name:a.comp.name,age:a.comp.age||'',score:a.score,dong:a.dong,comp:true,rel:a.comp.rel})});return L};
const pById=(oid,pid)=>persons(oid).find(p=>p.pid===pid);
const cap=o=>o.teams*CFG.MAX_PER_TEAM;
const left=o=>Math.max(0,cap(o)-(OUT.remote&&SES.role!=='admin'?Math.max(OUT.counts[o.id]||0,persons(o.id).length):persons(o.id).length));
const fname=n=>String(n||'').length>=3?String(n).slice(1):String(n||'');
const lvName=s=>s>=5?'익숙해요':s>=2?'조금 도움':'처음이에요';
const lvCls=s=>s>=5?'hi':s>=2?'mid':'lo';
const hasLesson=()=>(S.history&&S.history.length>0)||!!S.booking;
const outPaid=()=>{const a=myApp();return !!a&&(!a.remote||a.paid)};

/* 연습 잠금 조건 넓히기: S.paid = 1:1 수업 결제(원래 값) 또는 나들이 결제 */
function hookPaid(){const d=Object.getOwnPropertyDescriptor(S,'paid');if(d&&d.get)return;const v=d?!!d.value:false;
 Object.defineProperty(S,'_paid',{value:v,writable:true,configurable:true,enumerable:false});
 Object.defineProperty(S,'paid',{configurable:true,enumerable:true,get(){return !!this._paid||outPaid()},set(x){this._paid=!!x}})}

/* =====================================================================
   1-2. Firestore (진짜 계정) — 읽어 와서 위와 같은 모양(OUT.apps · OUT.ev)으로 바꿔요
   ===================================================================== */
const docId=(oid,acct)=>oid+'_'+acct;
const LVOK=v=>LV[v]?v:'new';
const normLv=l=>{l=l||{};return {kiosk:LVOK(l.kiosk),taxi:LVOK(l.taxi),kakao:LVOK(l.kakao)}};
const tsMd=t=>{try{const ms=t&&t.toDate?t.toDate().getTime():t&&t.seconds?t.seconds*1000:typeof t==='string'?Date.parse(t):+t;if(!ms)return '';const d=new Date(ms);return `${d.getMonth()+1}월 ${d.getDate()}일`}catch(e){return ''}};
/* 알림을 이미 보여 줬는지 (이 폰 · 계정별) */
const SEEN_K=()=>'baep3_oseen_'+(S.me||'');
const seenGet=()=>{try{return JSON.parse(localStorage.getItem(SEEN_K())||'{}')||{}}catch(e){return {}}};
const seenSet=(k,v)=>{const m=seenGet();m[k]=v||1;try{localStorage.setItem(SEEN_K(),JSON.stringify(m))}catch(e){}};
function fromDoc(id,d){d=safeDeep(d||{});const lv=normLv(d.levels);const c=(Array.isArray(d.companions)?d.companions:[])[0];const sn=seenGet();
 const a={id,oid:OB(d.oid).id,acct:d.acct,name:d.name||d.acct,age:'',dong:d.dong||'영통동',ph:'',lv,score:Number.isFinite(+d.score)?+d.score:scoreOf(lv),
  comp:c?{name:c.name||'',age:'',rel:c.rel||'동반',ph:c.phone||''}:null,payer:'본인',method:'',amt:+d.amount||PRICE*(1+(Array.isArray(d.companions)?d.companions.length:0)),paid:d.paid===true,paidAt:tsMd(d.paidAt)||tsMd(d.createdAt),
  st:d.status==='confirmed'?'team':'assign',status:d.status||'applied',team:d.team||null,notis:[],me:d.acct===S.me,remote:true,known:null,notified:d.status==='confirmed'};
 if(a.st==='team'){const o=OB(a.oid);const k='conf_'+id;a.notis=[{id:k,t:'나들이 팀이 정해졌어요',b:`${mdw(o.date)} ${o.start} ${o.place} · 팀이 정해졌어요. 택시비·음료비는 각자 내요`,shown:!!sn[k],read:sn[k]===2}]}
 return a}
/* 프렌드 카드: 팀 문서에 있는 프렌드가 이 폰 목록에 없으면 이름만 있는 카드를 만들어요 (목록에는 안 보여요) */
const ensureTutor=(acct,name)=>{const id='acc-'+acct;if(acct===S.me&&tutor('me'))return 'me';if(!tutor(id))TUTORS.push({id,acct,name:name||'프렌드',school:'',major:'',age:'',gender:'',lat:37.256,lon:127.0665,rad:3,rating:5,reviews:0,price:20000,color:'#CDEBDD',approved:false,stub:true,intro:'',topics:[],tags:[],wd:[],slots:[],full:{},revs:[]});return id};
function teamFrom(id,t){t=safeDeep(t||{});const oid=OB(t.oid).id;
 const members=(t.members||[]).map(m=>docId(oid,m.acct)+(m.companion?'c':''));
 const friends=(t.friends||[]).map(f=>({tid:ensureTutor(f.acct,f.name),pids:(f.helps||[]).map(String)}));
 return {id,no:+t.teamNo||0,name:(+t.teamNo||1)+'팀',members,friends,confirmed:!!t.confirmed,raw:t}}
/* 다른 팀원은 팀 문서의 이름·수준만으로 보여 줘요 (그분들 신청서는 읽지 않아요) */
function ghosts(teams){const L=[];teams.forEach(tm=>{const by={};(tm.raw.members||[]).forEach(m=>{(by[m.acct]=by[m.acct]||[]).push(m)});
 Object.entries(by).forEach(([acct,ms])=>{const main=ms.find(m=>!m.companion)||ms[0];const cp=ms.find(m=>m.companion);const lv=normLv(main.levels);
  L.push({id:docId(OB(tm.raw.oid).id,acct),oid:OB(tm.raw.oid).id,acct,name:main.name||'',age:'',dong:main.dong||'',ph:'',lv,score:scoreOf(lv),comp:cp?{name:cp.name||'',rel:cp.rel||'동반'}:null,payer:'',amt:0,paid:true,st:tm.confirmed?'team':'assign',notis:[],ghost:true,remote:true})})});return L}
function applyRemote(apps,teamDocs){const R=REMOTE;const teams=teamDocs.map(([id,t])=>teamFrom(id,t)).sort((a,b)=>a.no-b.no);
 const g=ghosts(teams).filter(x=>!apps.some(a=>a.id===x.id));R.apps=apps.concat(g);
 OUTINGS.forEach(o=>{const old=R.ev[o.id]||{};const ts=teams.filter(t=>OB(t.raw.oid).id===o.id);
  R.ev[o.id]={st:ts.length?(ts.every(t=>t.confirmed)?'confirmed':'ai'):'none',teams:ts,fnoti:old.fnoti||{},at:old.at};R.teamIds[o.id]=ts.map(t=>t.id)});
 R.at=Date.now()}
let _rBusy=null;
/* role 에 맞게 다시 읽기 (배움님: 내 신청·내 팀 / 프렌드: 내가 맡은 팀 / 운영자: 고른 나들이 전체) */
async function rLoad(force){pickStore();if(!OUT.remote)return false;if(!force&&Date.now()-REMOTE.at<15000)return false;if(_rBusy)return _rBusy;
 _rBusy=(async()=>{const db=await myDB();if(!db)return false;const me=S.me;
  try{
   const cq=await Promise.all(OUTINGS.map(o=>db.doc('baep_outings/'+o.id).get().catch(()=>null)));cq.forEach((sn,i)=>{if(sn&&sn.exists)REMOTE.counts[OUTINGS[i].id]=+((sn.data()||{}).applied)||0});
   if(SES.role==='admin'){const oid=O().adEv||'o1';
    const q=await db.collection('baep_outing_apps').where('oid','==',oid).get();const apps=q.docs.map(d=>fromDoc(d.id,d.data()));
    /* 문자·나이는 계정 문서에서 (운영자만 읽을 수 있어요) */
    await Promise.all(apps.map(async a=>{try{const sn=await db.doc('baep_accounts/'+a.acct).get();const sr=sn.exists?safeDeep((sn.data()||{}).sr||{}):{};a.ph=sr.phone||'';a.age=sr.age||'';a.payer=sr.byChild?'자녀':'본인'}catch(e){}}));
    const tq=await db.collection('baep_outing_teams').where('oid','==',oid).get();
    const keep=REMOTE.apps.filter(a=>a.oid!==oid&&!a.ghost);applyRemote(keep.concat(apps),tq.docs.map(d=>[d.id,d.data()]))}
   else if(SES.role==='mentor'){const tq=await db.collection('baep_outing_teams').where('friendAccts','array-contains',me).get();applyRemote([],tq.docs.map(d=>[d.id,d.data()]))}
   else{const q=await db.collection('baep_outing_apps').where('acct','==',me).get();const apps=q.docs.map(d=>fromDoc(d.id,d.data()));let teams=[];
    if(apps.some(a=>a.team||a.status!=='applied')){const tq=await db.collection('baep_outing_teams').where('memberAccts','array-contains',me).get();teams=tq.docs.map(d=>[d.id,d.data()])}
    applyRemote(apps,teams)}
   return true}
  catch(e){console.warn('[feat-outing] 나들이 정보를 못 읽었어요',e);return false}})();
 const r=await _rBusy;_rBusy=null;if(r&&S.me===REMOTE.who&&/^o_|^home$|^thome$|^admin$|^practice$|^mine$/.test(S.screen))render();return r}
/* 신청서 만들기/고치기 → 결제. 금액(amount)·status·team·paid 는 서버·운영자만 써요.
   결제 금액 = 1인 참가비 × (1 + 동반자 수) — 서버가 신청서의 동반자 수로 다시 계산해서 확인해요 */
async function rApply(f){const db=await myDB();if(!db)return null;const o=OB(f.oid);const id=docId(o.id,S.me);
 const companions=f.comp?[{name:f.cname,rel:f.crel,phone:f.cph}]:[];const amount=PRICE*(1+companions.length);
 const own={oid:o.id,acct:S.me,name:String(S.sr.name||'').slice(0,100),dong:S.sr.dong||((S.sr.area||'').match(/\S+동/)||['영통동'])[0],levels:Object.assign({},f.lv),score:scoreOf(f.lv),companions};
 const ex=REMOTE.apps.find(a=>a.id===id&&!a.ghost);
 try{if(ex&&ex.paid)return {id,amount,paid:true};
  if(ex)await db.doc('baep_outing_apps/'+id).update(own);
  else await db.doc('baep_outing_apps/'+id).set(Object.assign({},own,{createdAt:Date.now()}));
  return {id,amount}}
 catch(e){console.warn('[feat-outing] 신청 저장 실패',e);return null}}
const payOuting=(id,amount,o,n)=>window.BAEP_TOSS_PAY({amount,orderName:`배프 나들이 · ${o.short} (${n}명)`,kind:'outing',refId:id,
 rows:[['나들이',`${o.short} · ${mdw(o.date)} ${o.start}`],['인원',`${n}명`],['따로 내는 돈','택시비·음료비·식사비 (각자)']]});
/* 결제 승인 뒤 (index.html 이 /pay/confirm 을 부른 다음 여기로): 서버가 신청서에 paid 를 쓰면 신청 완료 */
window.BAEP_OUTING_PAID=async o=>{const ui=window.BAEP_PAY_UI;if(ui)ui.note('spin','결제를 확인하고 있어요','화면을 닫지 말고 잠시만 기다려 주세요');
 const d=await window.BAEP_WAIT_PAID('baep_outing_apps/'+o.refId,20000);await rLoad(true);if(ui)ui.close();
 if(!d){toast('결제는 승인됐어요. 확인이 늦어지고 있어요. 잠시 뒤 다시 확인해 주세요',4200);S.hist=['home'];S.screen='o_mine';render();return}
 const a=myApp();const ob=OB((a&&a.oid)||O().cur);O().ck=null;O().f=null;S.hist=['home'];S.screen='o_done';render();
 noti('나들이 신청 완료',`${mdw(ob.date)} ${ob.short} 나들이 신청을 마쳤어요. 혼자 연습도 열렸어요`);const last=S.notis[S.notis.length-1];if(last)last.go='o_mine'};
/* 운영자: 팀 저장 (팀 문서 + 신청서의 team·status) */
async function rPushTeams(oid){const db=await myDB();if(!db||SES.role!=='admin')return false;const ev=EV(oid);const ps=persons(oid);const P=pid=>ps.find(p=>p.pid===pid);
 const prev=REMOTE.teamIds[oid]||[];const now=[];
 try{for(let i=0;i<ev.teams.length;i++){const tm=ev.teams[i];const no=i+1;const id=oid+'_'+no;now.push(id);const ms=tm.members.map(P).filter(Boolean);const ti=teamInfo(oid,tm);
   const fr=(tm.friends||[]).filter(f=>f.tid&&tutor(f.tid)&&tutor(f.tid).acct);
   const doc={oid,teamNo:no,memberAccts:[...new Set(ms.map(p=>p.a.acct))],friendAccts:[...new Set(fr.map(f=>tutor(f.tid).acct))],
    members:ms.map(p=>p.comp?{acct:p.a.acct,name:p.name,levels:p.a.lv,companion:true,rel:p.rel||''}:{acct:p.a.acct,name:p.name,levels:p.a.lv}),
    friends:fr.map(f=>({acct:tutor(f.tid).acct,name:tutor(f.tid).name,helps:f.pids.slice()})),warn:!!ti.warn,confirmed:ev.st==='confirmed'&&ms.every(p=>p.comp||p.a.st==='team'),updatedAt:Date.now()};
   await db.doc('baep_outing_teams/'+id).set(doc);tm.id=id;tm.no=no;tm.raw=doc;
   for(const acct of doc.memberAccts){const a=OUT.apps.find(x=>x.id===docId(oid,acct));if(!a)continue;
    const upd={};if(a.team!==id)upd.team=id;if(a.status==='applied')upd.status='assigned';   /* team = 팀 문서 번호 (예: o1_1) */
    if(Object.keys(upd).length){await db.doc('baep_outing_apps/'+a.id).update(upd);Object.assign(a,upd)}}}
  for(const id of prev)if(!now.includes(id))await db.doc('baep_outing_teams/'+id).delete();
  REMOTE.teamIds[oid]=now;
  await db.doc('baep_outings/'+oid).set({oid,applied:ps.length,teams:ev.teams.length,updatedAt:Date.now()},{merge:true});REMOTE.counts[oid]=ps.length;
  return true}
 catch(e){console.warn('[feat-outing] 팀 저장 실패',e);toast('팀을 저장하지 못했어요. 운영자 권한과 인터넷 연결을 확인해 주세요',4200);return false}}
/* 운영자: 확정 → 신청서 status 'confirmed' + 문자 기록(baep_sms) + 팀 문서 confirmed */
async function rConfirm(oid){const db=await myDB();if(!db||SES.role!=='admin')return false;const ev=EV(oid);
 try{for(const tm of ev.teams){for(const pid of tm.members){const p=pById(oid,pid);if(!p||p.comp)continue;const a=p.a;if(a.status==='confirmed')continue;
    await db.doc('baep_outing_apps/'+a.id).update({status:'confirmed'});a.status='confirmed';
    await db.doc('baep_sms/out_'+a.id+'_'+Date.now().toString(36)).set({kind:'나들이 팀 확정',oid,teamNo:tm.no||0,acct:a.acct,to:a.name+(a.comp?` 외 1명(${a.comp.name})`:''),ph:a.ph||'',body:smsShort(a),st:'기록',createdAt:Date.now()})}
   await db.doc('baep_outing_teams/'+tm.id).update({confirmed:true});tm.confirmed=true}
  return true}
 catch(e){console.warn('[feat-outing] 확정 저장 실패',e);toast('확정을 저장하지 못했어요. 다시 눌러 주세요',4200);return false}}
addEventListener('baep:session',()=>{pickStore();if(OUT.remote){REMOTE.at=0;rLoad(true)}});
addEventListener('baep:logout',()=>{REMOTE=emptyRemote();OUT=LOCAL});

/* =====================================================================
   2. AI 팀 배정 (시연용 규칙 기반)
      ① 동반 신청은 한 묶음 ② 비슷한 동네(거리)·비슷한 수준(자가진단 합)끼리 ③ 팀당 최대 4명, 되도록 2명 이상
      ④ 프렌드: 세 가지를 가르치는 프렌드 중 모이는 곳에서 가까운 순, 1명이 최대 2명, 전에 만난 프렌드와 짝
   ===================================================================== */
function teamCost(ms){if(!ms.length)return 0;let d=0,n=0;for(let i=0;i<ms.length;i++)for(let j=i+1;j<ms.length;j++){d+=kmBetween(dongXY(ms[i].dong),dongXY(ms[j].dong));n++}
 const sc=ms.map(m=>m.score);return CFG.DIST_W*(n?d/n:0)+CFG.LEVEL_W*(Math.max(...sc)-Math.min(...sc))}
function partition(units,nT){const total=units.reduce((s,u)=>s+u.length,0);const minSz=total>=2*nT?2:1;const avg=total/nT;
 const order=units.slice().sort((a,b)=>b.length-a.length);let best=null,bestC=Infinity;const T=Array.from({length:nT},()=>[]);let steps=0;
 const rec=i=>{if(++steps>400000)return;
  if(i===order.length){if(T.some(t=>t.length<minSz))return;const c=T.reduce((s,t)=>s+teamCost(t)+0.4*Math.abs(t.length-avg),0);if(c<bestC){bestC=c;best=T.map(t=>t.slice())}return}
  const u=order[i];let triedEmpty=false;
  for(const t of T){if(t.length+u.length>CFG.MAX_PER_TEAM)continue;if(!t.length){if(triedEmpty)continue;triedEmpty=true}t.push(...u);rec(i+1);t.splice(t.length-u.length,u.length)}};
 rec(0);return best}
function greedy(units,nT){const T=Array.from({length:nT},()=>[]);
 units.slice().sort((a,b)=>(dongXY(a[0].dong).lat-dongXY(b[0].dong).lat)||(a[0].score-b[0].score)).forEach(u=>{let bi=-1,bc=Infinity;
  T.forEach((t,i)=>{if(t.length+u.length>CFG.MAX_PER_TEAM)return;const c=teamCost([...t,...u])-teamCost(t)+(t.length?0:0.8);if(c<bc){bc=c;bi=i}});
  if(bi<0){T.push([...u])}else T[bi].push(...u)});return T.filter(t=>t.length)}
const unitsOf=ps=>{const m={};ps.forEach(p=>{(m[p.a.id]=m[p.a.id]||[]).push(p)});return Object.values(m)};
/* 전에 수업한 프렌드 (신청할 때 기록) — 같은 팀이면 그 프렌드와 짝 */
const knownTid=a=>a&&a.known||null;
const myKnown=()=>(S.booking&&S.booking.tid)||((S.history||[])[0]||{}).tid||null;
function friendPool(o){const at=PL[o.pk]||PL.cafe;
 return TUTORS.filter(t=>t.approved!==false&&!t.blocked&&!t.stub&&!(OUT.remote&&(t.fake||!t.acct||t.id==='me'))&&(t.topics||[]).some(k=>o.topics.includes(k)))
  .map(t=>({t,s:(t.topics||[]).filter(k=>o.topics.includes(k)).length*10-kmBetween(at,t)})).sort((a,b)=>b.s-a.s).map(x=>x.t)}
/* 팀마다 프렌드 정하고, 배움님을 두 명씩 나눠 맡기기 */
function staff(oid){const o=OB(oid),ev=EV(oid);const pool=friendPool(o);const used=new Set();const ps=persons(oid);const P=pid=>ps.find(p=>p.pid===pid);
 ev.teams.forEach(tm=>tm.members=tm.members.filter(P));ev.teams=ev.teams.filter(tm=>tm.members.length);
 const mean=tm=>tm.members.reduce((s,id)=>s+P(id).score,0)/tm.members.length;
 /* 속도가 느린 팀부터 경험 많은 프렌드 */
 ev.teams.slice().sort((a,b)=>mean(a)-mean(b)).forEach(tm=>{const need=Math.ceil(tm.members.length/CFG.SENIORS_PER_FRIEND);
  let ids=(tm.friends||[]).map(f=>f.tid).filter(id=>id&&!used.has(id)&&tutor(id)).slice(0,need);
  const ms=tm.members.map(P);ms.forEach(m=>{const k=knownTid(m.a);if(k&&!ids.includes(k)&&!used.has(k)&&tutor(k)&&ids.length<need)ids.unshift(k)});
  for(const t of pool){if(ids.length>=need)break;if(!used.has(t.id)&&!ids.includes(t.id))ids.push(t.id)}
  ids=ids.slice(0,need);ids.forEach(id=>used.add(id));
  const F=ids.map(id=>({tid:id,pids:[]}));while(F.length<need)F.push({tid:null,pids:[]});
  const U=unitsOf(ms).sort((a,b)=>a[0].score-b[0].score);const room=f=>CFG.SENIORS_PER_FRIEND-f.pids.length;
  U.slice().forEach(u=>{const k=knownTid(u[0].a);const f=F.find(f=>f.tid&&f.tid===k&&room(f)>=u.length);if(f){f.pids.push(...u.map(m=>m.pid));U.splice(U.indexOf(u),1)}});
  U.forEach(u=>{const f=F.find(f=>room(f)>=u.length)||F.find(f=>room(f)>0)||F[0];f.pids.push(...u.map(m=>m.pid))});
  tm.friends=F});
 ev.teams.forEach((tm,i)=>tm.name=(i+1)+'팀')}
function aiAssign(oid,keep){const ev=EV(oid);const ps=persons(oid);if(!ps.length){ev.teams=[];return}
 if(keep&&ev.teams.length){const inT=new Set(ev.teams.flatMap(t=>t.members));const U=unitsOf(ps.filter(p=>!inT.has(p.pid)));const P=pid=>ps.find(p=>p.pid===pid);
  U.forEach(u=>{let bi=-1,bc=Infinity;ev.teams.forEach((tm,i)=>{if(tm.members.length+u.length>CFG.MAX_PER_TEAM)return;const ms=tm.members.map(P);const c=teamCost([...ms,...u])-teamCost(ms);if(c<bc){bc=c;bi=i}});
   if(bi<0)ev.teams.push({id:'T'+Date.now().toString(36)+ev.teams.length,members:u.map(m=>m.pid),friends:[]});else ev.teams[bi].members.push(...u.map(m=>m.pid))})}
 else{const units=unitsOf(ps);const n=ps.length;const nT=Math.max(1,Math.ceil(n/CFG.MAX_PER_TEAM));
  let T=units.length<=13?partition(units,nT):null;if(!T)T=units.length<=13?partition(units,nT+1):null;if(!T)T=greedy(units,nT);
  const lat=t=>t.reduce((s,m)=>s+dongXY(m.dong).lat,0)/t.length;T.sort((a,b)=>lat(a)-lat(b));
  ev.teams=T.map((t,i)=>({id:'T'+(i+1),members:t.map(m=>m.pid),friends:[]}))}
 if(ev.st!=='confirmed')ev.st='ai';staff(oid)}
const teamOf=(oid,pid)=>EV(oid).teams.find(t=>t.members.includes(pid));
const teamInfo=(oid,tm)=>{const ps=tm.members.map(id=>pById(oid,id)).filter(Boolean);const sc=ps.map(p=>p.score);const gap=sc.length?Math.max(...sc)-Math.min(...sc):0;
 return {ps,gap,warn:gap>=CFG.GAP_WARN,dongs:[...new Set(ps.map(p=>p.dong))],lack:(tm.friends||[]).some(f=>!f.tid)}};
const unassigned=oid=>{const inT=new Set(EV(oid).teams.flatMap(t=>t.members));return persons(oid).filter(p=>!inT.has(p.pid))};
const GAP_MSG='같은 팀 안에서 속도가 조금 달라요. 프렌드가 두 분씩 나눠서 도와드릴게요';
const AI_MSG='AI가 비슷한 동네·비슷한 수준끼리 묶었어요';

/* 팀 확정 문자 */
function smsLines(a){const o=OB(a.oid);const tm=teamOf(a.oid,a.id);if(!tm)return null;const ti=teamInfo(a.oid,tm);
 const names=ti.ps.map(p=>fname(p.name)+(p.pid===a.id?'(나)':'')).join('·');
 const fr=(tm.friends||[]).filter(f=>f.tid).map(f=>tutor(f.tid).name);const mine=(tm.friends||[]).find(f=>f.pids.includes(a.id));
 return {title:'[배프] 나들이 팀이 정해졌어요',rows:[
  ['나들이',o.title],['일시',`${mdw(o.date)} ${range(o.start,CFG.HOURS*60)}`],['모이는 곳',`${o.place} (각자 와 주세요)`],
  ['우리 팀',`${names} 님`],['프렌드',fr.join('·')+(mine&&mine.tid?` (${tutor(mine.tid).name} 프렌드가 ${mine.pids.map(id=>fname((pById(a.oid,id)||{}).name)).join('·')} 님을 도와드려요)`:'')],
  ['준비물',CFG.BRING]],foot:`※ ${CFG.SELF_PAY.replace('부담해요','내요')}. 문의 ${CFG.CS}`}}
const smsShort=a=>{const s=smsLines(a);if(!s)return '';return `${s.title} · ${s.rows[1][1]} · ${OB(a.oid).place} · 팀 ${s.rows[3][1]} · 프렌드 ${s.rows[4][1].split(' (')[0]} · 준비물 ${CFG.BRING} · 택시비·음료비 각자`};

/* 운영자 확정 → 배움님 알림(알림함)·문자 기록, 프렌드 알림 */
function confirmEv(oid){const ev=EV(oid);const o=OB(oid);if(!ev.teams.length)return 0;let n=0;
 const now=mslash(TODAYN)+' '+new Date().toTimeString().slice(0,5);
 ev.teams.forEach(tm=>tm.members.forEach(pid=>{const p=pById(oid,pid);if(!p||p.comp)return;const a=p.a;if(a.st==='team'&&a.notified)return;
  a.st='team';a.team=tm.id;n++;const s=smsLines(a);const tnames=teamInfo(oid,tm).ps.map(x=>fname(x.name)).join('·');
  a.notis.push({id:'on'+a.id+Date.now().toString(36),t:'나들이 팀이 정해졌어요',b:`${mdw(o.date)} ${o.start} ${o.place} · ${tnames} 님과 함께해요. 택시비·음료비는 각자 내요`,shown:false});
  a.notified=true;
  S.ad.smsLog.push({time:now,to:a.name+(a.comp?` 외 1명(${a.comp.name})`:''),ph:a.ph,kind:'나들이 팀 확정',body:smsShort(a),st:'발송 완료',me:!!a.me})}));
 ev.st='confirmed';ev.at=md(TODAYN);save();return n}

/* =====================================================================
   3. 모양 (CSS)
   ===================================================================== */
const css=`
.o-entry{display:flex;align-items:center;gap:.8em;width:100%;text-align:left;border:2px solid #A9DCC6;background:var(--mint-2);border-radius:22px;padding:1em;color:var(--ink)}
.o-entry-ic{width:3em;height:3em;border-radius:50%;background:#fff;display:grid;place-items:center;flex:none;color:var(--mint)}
.o-entry-ic svg{width:1.6em;height:1.6em}
.o-entry-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:.15em}
.o-entry-tx em{font-style:normal;font-weight:800;font-size:.75em;color:#fff;background:var(--mint);border-radius:99px;padding:.1em .6em;align-self:flex-start}
.o-entry-tx b{font-family:var(--f-display);font-weight:400;font-size:1.45em;line-height:1.2}
.o-entry-tx small{font-size:.84em;color:var(--ink-2);line-height:1.4}
.o-entry .j-chev{color:var(--mint)}
.o-hero{margin:-1em -1.1em 0;padding:1.3em 1.1em 1.4em;background:var(--mint-2);display:flex;flex-direction:column;gap:.35em;position:relative;overflow:hidden}
.o-hero::after{content:"";position:absolute;right:-2em;bottom:-2.8em;width:8em;height:8em;border-radius:50%;background:var(--butter);opacity:.75}
.o-hero>*{position:relative;z-index:1}
.o-hero p{margin:0}
.o-hero .r-eyebrow{color:var(--mint)}
.o-hero h2{margin:0;font-family:var(--f-display);font-weight:400;font-size:1.95em;line-height:1.2}
.o-flow3{display:grid;grid-template-columns:repeat(3,1fr);gap:.45em}
.o-flow3 span{display:flex;flex-direction:column;align-items:center;gap:.25em;background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:.65em .3em;font-size:.8em;font-weight:800;text-align:center;line-height:1.3}
.o-flow3 svg{color:var(--mint);width:1.6em;height:1.6em}
.o-card{display:flex;flex-direction:column;gap:.6em;position:relative}
.o-top{display:flex;justify-content:space-between;align-items:center;gap:.5em;flex-wrap:wrap}
.o-date{background:var(--butter);border-radius:99px;padding:.2em .75em;font-weight:800;font-size:.85em}
.o-seat{font-size:.82em;font-weight:800;color:var(--mint);background:var(--mint-2);border-radius:99px;padding:.2em .7em}
.o-seat.few{color:var(--coral);background:var(--coral-2)}
.o-seat.full{color:var(--ink-3);background:var(--line)}
.o-title{margin:0;font-family:var(--f-display);font-weight:400;font-size:1.35em;line-height:1.3}
.o-place{display:flex;align-items:center;gap:.35em;font-weight:700;color:var(--ink-2);font-size:.92em}
.o-place svg{color:var(--coral);flex:none;margin-top:.15em}
.o-place{align-items:flex-start}
.o-place small{font-weight:600;color:var(--ink-3)}
.o-sum dt{flex:none;white-space:nowrap}
.o-kws{display:flex;flex-wrap:wrap;gap:.4em}
.o-kw{display:inline-flex;align-items:center;gap:.3em;border:1.5px solid #9CCDF1;background:var(--sky-2);color:var(--blue-ink);border-radius:99px;padding:.4em .75em;font-weight:800;font-size:.86em;min-height:2.6em}
.o-kw svg{width:1.15em;height:1.15em}
.o-kw:hover{background:var(--sky)}
.o-kw i{font-style:normal;opacity:.6}
.o-prep{display:flex;align-items:flex-start;gap:.45em;background:#FFF1E6;color:#8A4A12;border-radius:14px;padding:.55em .7em;font-size:.86em;line-height:1.4}
.o-prep svg{flex:none;width:1.25em;height:1.25em;margin-top:.05em}
.o-prep b{white-space:nowrap;background:#F5C9A3;color:#6B3608;border-radius:8px;padding:0 .45em;margin-right:.25em}
.o-foot{display:flex;justify-content:space-between;align-items:center;gap:.6em}
.o-foot .btn{width:auto;padding:0 1.2em}
.o-foot small{color:var(--ink-3);font-weight:600}
.o-mine-tag{position:absolute;top:-.6em;right:.9em;background:var(--mint);color:#fff;font-size:.75em;font-weight:800;border-radius:99px;padding:.15em .65em}
.o-big{display:flex;flex-direction:column;gap:.5em;background:var(--paper);border:1px solid var(--line);border-radius:22px;padding:1.1em}
.o-big .big-when{font-size:1.5em}
.o-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.1em}
.o-steps li{display:grid;grid-template-columns:2.4em 1fr;gap:.7em;align-items:start;position:relative;padding-bottom:.7em}
.o-steps li:not(:last-child)::before{content:"";position:absolute;left:1.15em;top:2.4em;bottom:0;width:2px;background:var(--line)}
.o-steps .n{width:2.4em;height:2.4em;border-radius:50%;background:var(--sky-2);color:var(--blue-ink);display:grid;place-items:center;font-weight:800}
.o-steps .n svg{width:1.3em;height:1.3em}
.o-steps b{display:block}
.o-steps small{display:block;color:var(--ink-2);font-size:.85em;line-height:1.4}
.o-steps em{font-style:normal;font-size:.72em;font-weight:800;background:var(--butter);border-radius:99px;padding:.05em .5em;margin-left:.3em;vertical-align:2px}
.o-cap{display:grid;grid-template-columns:repeat(3,1fr);gap:.45em;text-align:center}
.o-cap div{background:var(--bg);border-radius:14px;padding:.6em .3em}
.o-cap b{display:block;font-size:1.15em}
.o-cap small{font-size:.75em;color:var(--ink-2)}
.o-price{display:flex;flex-direction:column;gap:.45em}
.o-price .row{justify-content:space-between}
.o-price .tot{border-top:1px dashed var(--line);padding-top:.5em;font-weight:800;font-size:1.1em}
.o-self{display:flex;align-items:center;gap:.5em;background:var(--coral-2);color:#8E2F18;border-radius:14px;padding:.65em .8em;font-weight:800;font-size:.92em;line-height:1.4}
.o-self svg{flex:none}
.o-sk{display:flex;flex-direction:column;gap:.6em}
.o-sk-h{display:flex;align-items:center;gap:.6em;font-size:1.08em}
.o-sk-h .oi{width:2.4em;height:2.4em;border-radius:12px;background:var(--sky-2);display:grid;place-items:center;color:var(--blue-ink);flex:none}
.o-lvs{display:flex;flex-direction:column;gap:.4em}
.o-lv{display:flex;align-items:center;gap:.6em;border:2px solid var(--line);background:var(--paper);border-radius:14px;padding:.7em .8em;font-weight:800;text-align:left;min-height:3em;font-size:1em}
.o-lv::before{content:"";width:1.2em;height:1.2em;border-radius:50%;border:2px solid #B5C0CA;flex:none;background:#fff}
.o-lv.on{border-color:var(--blue);background:var(--sky-2);color:var(--blue-ink)}
.o-lv.on::before{border-color:var(--blue);background:var(--blue);box-shadow:inset 0 0 0 3px #fff}
.o-rel{display:flex;flex-wrap:wrap;gap:.45em}
.o-rel .chip{min-height:2.6em}
.o-ovl .dsheet{gap:.9em;padding-bottom:1.3em}
.o-ovl .dsheet p.o-rec{font-size:1.05em;line-height:1.6;color:var(--ink)}
.o-recic{width:3em;height:3em;border-radius:50%;background:var(--butter-2);display:grid;place-items:center;color:#8A6500}
.o-recic svg{width:1.6em;height:1.6em}
.o-ovl .btn{min-height:3.2em}
.o-flow{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.55em}
.o-team{display:flex;flex-direction:column;gap:.7em}
.o-ppl{display:flex;flex-wrap:wrap;gap:.45em}
.o-ppl span{display:inline-flex;align-items:center;gap:.35em;background:var(--bg);border-radius:99px;padding:.25em .7em .25em .25em;font-weight:800;font-size:.9em}
.o-ppl span.me{background:var(--butter-2);outline:2px solid var(--gold)}
.o-ppl .av{width:1.8em;height:1.8em;font-size:.85em}
.o-ai{display:flex;gap:.5em;align-items:flex-start;background:var(--sky-2);color:var(--blue-ink);border-radius:14px;padding:.6em .75em;font-size:.9em;font-weight:700;line-height:1.45}
.o-ai svg{flex:none;margin-top:.1em}
.o-warn{display:flex;gap:.5em;align-items:flex-start;background:var(--butter-2);border-radius:14px;padding:.6em .75em;font-size:.9em;line-height:1.45;color:#6B4E00}
.o-warn svg{flex:none;margin-top:.1em}
.o-fcard .kv dd{font-weight:700}
.o-lvp{display:inline-block;font-size:.74em;font-weight:800;border-radius:99px;padding:.15em .6em;white-space:nowrap}
.o-lvp.hi{background:var(--mint-2);color:var(--mint)}.o-lvp.mid{background:var(--butter-2);color:#8A6500}.o-lvp.lo{background:var(--coral-2);color:var(--coral)}
/* 운영자 */
.o-evs{display:flex;gap:.6em;flex-wrap:wrap}
.o-ev{display:flex;flex-direction:column;gap:.1em;align-items:flex-start;text-align:left;border:2px solid var(--line);background:var(--paper);border-radius:14px;padding:.6em .9em;min-width:13em}
.o-ev.on{border-color:var(--blue);background:var(--sky-2)}
.o-ev b{font-size:.95em}.o-ev small{color:var(--ink-2);font-size:.8em}
.o-teams{display:grid;grid-template-columns:repeat(auto-fill,minmax(19em,1fr));gap:.9em;align-items:start}
.o-tcard{display:flex;flex-direction:column;gap:.65em}
.o-tcard.warn{border-color:#F1D98A}
.o-th{display:flex;align-items:center;gap:.5em;flex-wrap:wrap}
.o-th b{font-size:1.1em}
.o-th .sp{flex:1}
.o-mem{display:grid;grid-template-columns:2.2em 1fr auto;gap:.2em .6em;align-items:center;padding:.45em 0;border-top:1px solid var(--line)}
.o-mem .av{width:2.2em;height:2.2em;font-size:.95em;background:var(--sky-2)}
.o-mem small{display:block;color:var(--ink-3);font-size:.8em}
.o-mem select{grid-column:2/4;font:inherit;font-size:.82em;padding:.35em .5em;border:1.5px solid var(--line);border-radius:10px;background:var(--paper);color:var(--ink-2)}
.o-fr{display:flex;align-items:center;gap:.5em;background:var(--bg);border-radius:12px;padding:.45em .6em;font-size:.88em}
.o-fr .av{width:2em;height:2em;font-size:.85em}
.o-fr .av{flex:none}
.o-fr>span:not(.av){flex:1;min-width:0}
.o-fr small{color:var(--ink-2)}
.o-sk3{display:flex;gap:.25em}
.o-sk3 i{font-style:normal;font-size:.72em;font-weight:800;border-radius:6px;padding:.1em .4em;background:var(--line);color:var(--ink-2)}
.o-sk3 i.self{background:var(--mint-2);color:var(--mint)}.o-sk3 i.help{background:var(--butter-2);color:#8A6500}.o-sk3 i.new{background:var(--coral-2);color:var(--coral)}
.o-adbar{display:flex;gap:.6em;flex-wrap:wrap;align-items:center}
.o-adbar .btn{width:auto;padding:0 1.3em}
.o-sms{white-space:normal}
.o-prepnote{display:flex;gap:.5em;align-items:flex-start}
.o-prepnote svg{flex:none;margin-top:.1em}
`;
{const st=document.createElement('style');st.id='feat-outing-css';st.textContent=css;document.head.appendChild(st)}
if(typeof ICONS!=='undefined'){if(!ICONS.users)ICONS.users='M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6';
 if(!ICONS.tree)ICONS.tree='M12 3l5 7h-3l4 6H6l4-6H7zM12 16v5';if(!ICONS.info)ICONS.info='M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.01'}

/* =====================================================================
   4. 화면 조각
   ===================================================================== */
const kwChips=o=>`<div class="o-kws">${o.topics.map(k=>`<button class="o-kw" data-a="o-chip" data-v="${k}" aria-label="${KW[k]} 개인 수업 알아보기">${I(TOPICS[k]?TOPICS[k].i:'light')}${KW[k]} <i>›</i></button>`).join('')}</div>`;
const prepBadge=(long)=>`<div class="o-prep">${I('light')}<span><b>준비수업 필요</b>${long?'나들이 전에 관련 1:1 개인 수업을 한 번 들으면 훨씬 편해요. 꼭 들어야 하는 건 아니에요 — 위 키워드를 누르면 그 수업을 바로 찾아볼 수 있어요.':'관련 1:1 수업을 먼저 들으면 좋아요 (추천)'}</span></div>`;
const seatPill=o=>{const l=left(o);return `<span class="o-seat${l===0?' full':l<=2?' few':''}">${l?`남은 자리 ${l}`:'마감'}</span>`};
const selfPay=()=>`<div class="o-self">${I('won')}<span>${CFG.SELF_PAY}<br><small style="font-weight:600">참가비에는 프렌드 ${CFG.HOURS}시간 동행만 들어 있어요</small></span></div>`;
const lvPill=s=>`<span class="o-lvp ${lvCls(s)}">${lvName(s)} · ${s}/6</span>`;
const sk3=lv=>`<span class="o-sk3">${SKILLS.map(([k,t])=>`<i class="${lv[k]}" title="${t}">${t.split(' ')[0]} ${LV[lv[k]]?LV[lv[k]][2]:'-'}</i>`).join('')}</span>`;
const people=f=>1+(f&&f.comp?1:0);

function entryCard(){const n=OUTINGS.length;const o=OUTINGS[0];
 return `<button class="o-entry" data-a="o-list"><span class="o-entry-ic">${I('users')}</span><span class="o-entry-tx"><em>새로 생겼어요</em><b>이웃과 함께 나들이</b><small>카페에서 키오스크로 주문하고, 공원 산책·사진 미션 뒤 택시를 직접 불러 집에 가요 · ${md(o.date)} 외 ${n-1}개</small></span>${I('back','j-chev')}</button>`}
function statusCard(a){const o=OB(a.oid);
 if(a.remote&&!a.paid)return `<button class="rq no" data-a="o-mine"><span class="rq-st">${I('card')} 나들이 · 결제 대기</span><b>${o.short} 나들이<br>참가비 결제가 아직 안 됐어요</b><span class="rq-when">${mdw(o.date)} ${o.start} · ${o.place}</span><span class="rq-go">결제를 마치면 신청이 끝나요 ›</span></button>`;
 if(a.st==='team'){const tm=teamOf(a.oid,a.id);const ti=tm&&teamInfo(a.oid,tm);const fr=tm?(tm.friends||[]).filter(f=>f.tid).map(f=>tutor(f.tid).name).join('·'):'';
  return `<button class="rq ok" data-a="o-mine"><span class="rq-st">${I('check')} 나들이 팀 확정</span><b>${mdw(o.date)} ${o.start}<br>${ti?ti.ps.filter(p=>p.pid!==a.id).map(p=>fname(p.name)).join('·')+' 님과 함께해요':o.short+' 나들이'}</b><span class="rq-when">${I('pin')} ${o.place}</span><span class="rq-go">프렌드 ${fr} · 자세히 보기 ›</span></button>`}
 return `<button class="rq wait" data-a="o-mine"><span class="rq-st"><i class="dot"></i>나들이 · 팀 배정 중</span><b>${o.short} 나들이<br>팀을 짜고 있어요</b><span class="rq-when">${mdw(o.date)} ${o.start} · ${o.place}</span><span class="rq-go">팀이 정해지면 알림과 문자로 알려드려요 ›</span></button>`}

/* =====================================================================
   5. 배움님 화면
   ===================================================================== */
/* 나들이 목록 */
SC.o_list=()=>{const a=myApp();
 return hdr('이웃과 함께 나들이',{right:bigBtn()})+`<main class="body">
 <section class="o-hero"><p class="r-eyebrow">수업에서 배운 걸 진짜로 써봐요</p><h2>이웃과 함께<br>나들이 가요</h2><p class="small muted">동네 배움님 2~4명과 프렌드가 함께 카페·공원에 가요</p></section>
 <div class="o-flow3"><span>${I('cup')}키오스크로<br>주문하기</span><span>${I('camera')}사진 찍어<br>카톡 보내기</span><span>${I('taxi')}택시 직접<br>불러 집에 가기</span></div>
 ${a?statusCard(a):''}
 ${OUTINGS.map(o=>{const mine=a&&a.oid===o.id;return `<article class="card o-card">${mine?'<span class="o-mine-tag">신청함</span>':''}
  <div class="o-top"><span class="o-date">${mdw(o.date)} ${o.start}</span>${seatPill(o)}</div>
  <h3 class="o-title">${o.title}</h3>
  <div class="o-place">${I('pin')}<span>${o.place} <small>· ${o.walk}</small></span></div>
  ${kwChips(o)}
  ${prepBadge(false)}
  <div class="o-foot"><span class="price tabnum">1인 ${won(PRICE)} <small>· ${CFG.HOURS}시간</small></span><button class="btn y sm" data-a="o-open" data-v="${o.id}">자세히 보기</button></div>
 </article>`}).join('')}
 <p class="small muted" style="margin:0;text-align:center">파란 키워드를 누르면 그 내용을 먼저 1:1로 배울 수 있는<br>개인 수업을 찾아드려요</p>
 </main>`};

/* 나들이 소개 */
SC.o_detail=()=>{const o=OB(O().cur);const a=myApp();const mine=a&&a.oid===o.id;const other=a&&!mine;const l=left(o);
 const st=[['users','각자 카페로 모이기',`${o.place}에 각자 와요. 프렌드가 입구에서 기다려요`,''],
  ['cup','키오스크로 음료 주문',`먹고 싶은 음료를 키오스크로 직접 주문해요`,'키오스크'],
  ['camera','공원 산책 · 사진 미션',`${o.walk} · ${o.photo}, 찍은 사진을 팀 카톡방에 보내요`,'카톡'],
  ['taxi','택시 부르는 법 배우기','프렌드와 함께 택시 앱 호출 화면을 같이 봐요','택시'],
  ['home','집에 갈 때 각자 택시 부르기','배운 대로 각자 택시를 직접 불러 타고 집에 가요','택시']];
 return hdr('나들이 소개')+`<main class="body">
 <div class="o-big">
  <div class="o-top"><span class="o-date">나들이 · ${CFG.HOURS}시간</span>${seatPill(o)}</div>
  <h2 class="q" style="margin:0">${o.title}</h2>
  <div class="big-when">${mdw(o.date)} ${range(o.start,CFG.HOURS*60)}</div>
  <div class="o-place">${I('pin')}<span>${o.place} <small>· ${o.placeD}</small></span></div>
 </div>
 <div class="sec">이번 나들이에서 해봐요</div>
 ${kwChips(o)}
 ${prepBadge(true)}
 <div class="sec">이렇게 진행해요</div>
 <div class="card"><ol class="o-steps">${st.map(([i,t,d,tag],n)=>`<li><span class="n">${I(i)}</span><span><b>${n+1}. ${t}${tag?`<em>${tag}</em>`:''}</b><small>${d}</small></span></li>`).join('')}</ol></div>
 <div class="mapbox">${mapSVG({meet:o.pk})}</div>
 <div class="sec">${I('users')}함께하는 사람</div>
 <div class="card" style="display:flex;flex-direction:column;gap:.6em">
  <div class="o-cap tabnum"><div><b>${CFG.MAX_PER_TEAM}명</b><small>한 팀 배움님 최대</small></div><div><b>${CFG.MAX_PER_TEAM/CFG.SENIORS_PER_FRIEND}명</b><small>한 팀 프렌드</small></div><div><b>${l}자리</b><small>남은 자리 / ${cap(o)}</small></div></div>
  <p class="small muted" style="margin:0">프렌드 1명이 배움님 최대 ${CFG.SENIORS_PER_FRIEND}명을 맡아요. 비슷한 동네·비슷한 수준끼리 팀을 묶고, 함께 신청한 분은 같은 팀이 돼요.</p>
 </div>
 <div class="sec">${I('won')}참가비</div>
 <div class="card o-price tabnum">
  <div class="row"><span>1인 · 시간당</span><b>${won(CFG.PRICE_PER_HOUR)}</b></div>
  <div class="row"><span>나들이 시간</span><b>× ${CFG.HOURS}시간</b></div>
  <div class="row tot"><span>1인 참가비</span><span>${won(PRICE)}</span></div>
  ${selfPay()}
 </div>
 <div class="note small">${I('play')} 나들이를 결제하면 <b>혼자 연습</b>(택시·키오스크·카톡 등)도 열려요. 나들이 전에 미리 연습해 보세요.</div>
 ${demo([['수업 이력 없는 배움님일 때','o-rec-demo']])}
 </main><footer class="cta">${mine?`<button class="btn b" data-a="o-mine">신청 완료 · 내 나들이 보기</button>`:other?`<button class="btn" disabled>이미 다른 나들이를 신청했어요</button>`:l<1?`<button class="btn" disabled>자리가 다 찼어요</button>`:`<button class="btn y" data-a="o-apply">나들이 신청하기 · 1인 ${won(PRICE)}</button>`}</footer>${O().sheet==='rec'?recSheet():''}`};
const recSheet=()=>`<div class="ovl o-ovl" data-a="o-sheet-bg"><div class="dsheet" role="dialog" aria-label="신청 전 안내"><div class="grab"></div>
 <span class="o-recic">${I('light')}</span>
 <h3>신청하기 전에<br>확인해 주세요</h3>
 <p class="o-rec">${CFG.REC_TEXT}</p>
 <button class="btn b" data-a="o-rec-lesson">개인 수업 알아보기</button>
 <button class="btn y" data-a="o-rec-go">나들이 신청하기</button>
 <p class="small muted" style="text-align:center">추천일 뿐이에요. 바로 신청하셔도 괜찮아요</p></div></div>`;

/* ① 내가 할 수 있는 것 */
SC.o_apply=()=>{const f=O().f;if(!f)return SC.o_detail();const all=SKILLS.every(([k])=>f.lv[k]);
 return hdr('나들이 신청')+`<main class="body">${steps(1,3)}
 <h2 class="q">지금 얼마나<br>할 수 있으세요?</h2><p class="sub">정답은 없어요. 비슷한 분들끼리 팀을 짜는 데 써요</p>
 ${SKILLS.map(([k,t,i])=>`<div class="card o-sk"><div class="o-sk-h"><span class="oi">${I(i)}</span><b>${t}</b></div>
  <div class="o-lvs" role="radiogroup" aria-label="${t}">${LVK.map(l=>`<button class="o-lv${f.lv[k]===l?' on':''}" role="radio" aria-checked="${f.lv[k]===l}" data-a="o-lv" data-v="${k}:${l}">${LV[l][0]}</button>`).join('')}</div></div>`).join('')}
 <div class="note blue small">처음이어도 괜찮아요. 프렌드 1명이 배움님 ${CFG.SENIORS_PER_FRIEND}명까지만 맡아서 천천히 도와드려요.</div>
 </main><footer class="cta"><button class="btn y" data-a="o-next1" ${all?'':'disabled'}>${all?'다음':'세 가지를 모두 골라 주세요'}</button></footer>`};

/* ② 함께 갈 분 (동반 신청) */
SC.o_comp=()=>{const f=O().f;if(!f)return SC.o_detail();const o=OB(f.oid);const sp=left(o);
 return hdr('나들이 신청')+`<main class="body">${steps(2,3)}
 <h2 class="q">함께 가실 분이<br>있으세요?</h2><p class="sub">배우자·친구와 같이 신청하면 같은 팀으로 묶어 드려요</p>
 <div class="seg"><button class="${f.comp?'':'on'}" data-a="o-comp" data-v="0">혼자 갈게요</button><button class="${f.comp?'on':''}" data-a="o-comp" data-v="1" ${sp<2?'disabled':''}>함께 갈 분이 있어요</button></div>
 ${sp<2?'<p class="small muted" style="margin:0">남은 자리가 1자리라 이번엔 혼자만 신청할 수 있어요</p>':''}
 ${f.comp?`<div class="card" style="display:flex;flex-direction:column;gap:.8em">
  <div class="fld"><span>어떤 사이인가요?</span><div class="o-rel">${REL.map(r=>`<button class="chip${f.crel===r?' on':''}" data-a="o-rel" data-v="${r}">${r}</button>`).join('')}</div></div>
  <label class="fld"><span>함께 갈 분 이름 <b class="req-star">*</b></span><input id="o-cname" value="${esc(f.cname)}" autocomplete="off" placeholder="예) 이순자"></label>
  <label class="fld"><span>함께 갈 분 휴대폰 <b class="req-star">*</b> <small style="font-weight:600;color:var(--ink-3)">팀 확정 문자를 같이 보내요</small></span><input id="o-cph" inputmode="tel" value="${esc(f.cph)}" placeholder="010-0000-0000"></label>
 </div>
 <div class="note small">함께 가는 분도 1인 참가비(${won(PRICE)})가 있어요. 다음 화면에서 같이 결제해요.</div>`:''}
 </main><footer class="cta"><button class="btn y" data-a="o-next2">다음 · 결제하기</button></footer>`};

/* ③ 결제 */
SC.o_pay=()=>{const f=O().f;if(!f)return SC.o_detail();const o=OB(f.oid);const n=CFG.COMPANION_PAYS?people(f):1;const amt=PRICE*n;
 const childOk=S.sr.byChild&&DEMO_MODE&&!OUT.remote;const kid=childOk&&f.payer==='child';const methods=['카카오페이','토스페이','카카오뱅크','신용·체크카드'];
 const sum=`<div class="card sum o-sum"><div><dt>나들이</dt><dd>${o.title}</dd></div><div><dt>일시</dt><dd>${mdw(o.date)} ${range(o.start,CFG.HOURS*60)}</dd></div><div><dt>모이는 곳</dt><dd>${o.place}</dd></div>
  <div><dt>참가 인원</dt><dd>배움님 ${esc(S.sr.name)}${f.comp?` + ${esc(f.cname)}(${f.crel})`:''} · ${people(f)}명</dd></div>
  <div><dt>참가비</dt><dd class="tabnum">${won(CFG.PRICE_PER_HOUR)} × ${CFG.HOURS}시간${n>1?` × ${n}명`:''}</dd></div>
  <div style="border-top:1px solid var(--line);padding-top:.5em"><dt>결제할 금액</dt><dd class="tabnum" style="font-size:1.25em">${won(amt)}</dd></div></div>`;
 const seg=childOk?`<div class="sec">누가 결제할까요?</div><div class="seg"><button class="${kid?'':'on'}" data-a="o-payer" data-v="self">제가 할게요</button><button class="${kid?'on':''}" data-a="o-payer" data-v="child">자녀에게 부탁</button></div>`:'';
 let body,foot;
 if(kid){body=f.childSent?`<div class="card c-due"><span class="c-pill">요청 보냄</span><b>자녀분이 결제하면 신청이 끝나요</b><span class="small muted">${esc(S.sr.cphone||'010-0000-0000')}(으)로 나들이 참가비 결제 요청 문자를 보냈어요.</span></div>${demo([['자녀 휴대폰에서 결제하기','o-child-pay']])}`
   :`<div class="card"><b>${I('msg')} 자녀분께 결제 요청 문자를 보내요</b><p class="small muted" style="margin:.4em 0 0">받는 번호 <b>${esc(S.sr.cphone||'010-0000-0000')}</b> · 자녀분이 문자 링크를 눌러 결제해요.</p></div>`;
  foot=f.childSent?`<footer class="cta c-two"><button class="btn ghost" data-a="o-child-send">다시 보내기</button><button class="btn y" data-a="o-payer" data-v="self">제가 직접 결제할게요</button></footer>`:`<footer class="cta"><button class="btn b" data-a="o-child-send">자녀분께 결제 요청 보내기</button></footer>`}
 else if(OUT.remote){body=`<div class="sec">결제 방법</div><div class="card tp-info"><span>${I('card')}</span><span><b>다음 화면에서 골라요</b><small class="muted">카카오페이 · 토스페이 · 네이버페이 · 페이코 · 카드 · 계좌이체</small></span></div>`;
  foot=`<footer class="cta"><button class="btn y" data-a="o-pay">${won(amt)} 결제하기</button></footer>`}
 else{body=`<div class="sec">결제 방법</div>${methods.map(m=>`<button class="opt${S.method===m?' on':''}" data-a="method" data-v="${m}"><span class="oi">${I(m.includes('카드')?'card':'won')}</span><span><b>${m}</b></span></button>`).join('')}`;
  foot=`<footer class="cta"><button class="btn y" data-a="o-pay">${won(amt)} 결제하기</button></footer>`}
 return hdr('나들이 결제')+`<main class="body">${steps(3,3)}${sum}${selfPay()}${seg}${body}
 <p class="small muted" style="margin:0">나들이 3일 전까지 취소하면 전액 환불돼요. 결제하면 혼자 연습도 열려요.</p>
 </main>${foot}${O().ck?ckSheet():''}`};
/* 결제창 — 앱의 연습 결제창(.pyw·.ck-*)과 같은 모양 */
function ckSheet(){const c=O().ck;const f=O().f;if(!c||!f)return '';const o=OB(f.oid);const n=CFG.COMPANION_PAYS?people(f):1;const amt=PRICE*n;
 const isCard=S.method.includes('카드');const cards=[['연습카드','····0000'],['연습카드 (한도 초과)','····1111']];let b='';
 if(c.step==='review')b=`<div class="ck-h"><b>${c.child?'자녀분 결제':'결제하기'}</b><button class="ck-x" data-a="o-ck-close" aria-label="닫기">${I('x')}</button></div>
  <div><div class="small muted">${c.child?esc(S.sr.name)+' 님 나들이 참가비':'결제할 금액'}</div><div class="ck-amt">${won(amt)}</div></div>
  <div class="ck-row"><span>상품</span><b>배프 나들이 · ${CFG.HOURS}시간${n>1?` · ${n}명`:''}</b></div>
  <div class="ck-row"><span>나들이</span><b>${o.short} · ${mdw(o.date)} ${o.start}</b></div>
  <div class="ck-row"><span>결제 방법</span><b>${S.method}</b></div>
  <div class="ck-row"><span>따로 내는 돈</span><b>택시비·음료비·식사비 (각자)</b></div>
  ${isCard?`<div class="small" style="font-weight:800">카드를 골라 주세요</div>${cards.map((x,i)=>`<button class="ck-card${c.card===i?' on':''}${i?' warn':''}" data-a="o-ck-card" data-v="${i}"><i></i><span><b>${x[0]}</b><br><small class="muted">${x[1]}</small></span></button>`).join('')}`:''}
  <button class="ck-agree${c.agree?' on':''}" data-a="o-ck-agree"><span class="box">${c.agree?I('check'):''}</span><span>결제 내용을 확인했고 결제에 동의해요 <b>(필수)</b></span></button>
  <button class="btn y" data-a="o-ck-next" ${c.agree?'':'disabled'}>${won(amt)} 결제하기</button>
  <p class="ck-note">시연용 결제창이에요 · 실제로 돈이 나가지 않아요</p>`;
 if(c.step==='pin')b=`<div class="ck-h"><b>결제 비밀번호</b><button class="ck-x" data-a="o-ck-close" aria-label="닫기">${I('x')}</button></div>
  <p style="margin:0;text-align:center">비밀번호 6자리를 눌러 주세요</p>
  <div class="ck-pin">${[0,1,2,3,4,5].map(i=>`<i class="${i<c.pin.length?'on':''}"></i>`).join('')}</div>
  <div class="ck-pad">${['1','2','3','4','5','6','7','8','9','전체 지움','0','지움'].map(k=>`<button class="${k.length>1?'fn':''}" data-a="o-ck-key" data-v="${k}">${k}</button>`).join('')}</div>
  <p class="ck-note">시연이라 아무 숫자 6개나 누르면 돼요</p>`;
 if(c.step==='wait')b=`<div class="ck-mid"><div class="ck-spin"></div><b>결제하고 있어요</b><span class="small muted">화면을 닫지 말고 잠시만 기다려 주세요</span></div>`;
 if(c.step==='fail')b=`<div class="ck-mid"><div class="ck-bad">!</div><b style="font-size:1.15em">결제가 안 됐어요</b><span class="muted">카드 한도를 넘었어요.<br>돈은 나가지 않았어요. 다른 카드로 다시 해 주세요</span></div>
  <button class="btn y" data-a="o-ck-retry">다른 카드 고르기</button><button class="btn ghost" data-a="o-ck-close">나중에 할게요</button>`;
 return `<div class="pyw o-pyw" role="dialog" aria-label="결제"><div class="ck-s">${b}</div></div>`}

/* 신청 완료 */
SC.o_done=()=>{const a=myApp();if(!a)return SC.o_list();const o=OB(a.oid);
 return hdr('신청 완료',{noBack:true})+`<main class="body">
 <div class="result-hd"><div class="okmark">${I('check')}</div><h2 class="q">나들이 신청을<br>마쳤어요</h2><p class="sub" style="margin:0">${a.payer==='자녀'?'자녀분이 참가비를 결제해 주셨어요':won(a.amt)+' 결제 완료'}</p></div>
 <div class="card sum o-sum"><div><dt>나들이</dt><dd>${o.title}</dd></div><div><dt>일시</dt><dd>${mdw(o.date)} ${range(o.start,CFG.HOURS*60)}</dd></div><div><dt>모이는 곳</dt><dd>${o.place}</dd></div><div><dt>지금 상태</dt><dd style="color:var(--blue-ink)">팀 배정 중</dd></div></div>
 <div class="o-ai">${I('users')}<span>AI가 비슷한 동네·비슷한 수준끼리 팀을 묶고, 운영자가 확인하면 <b>알림과 문자</b>로 팀·프렌드·모이는 곳을 알려드려요.</span></div>
 <div class="card" style="display:flex;flex-direction:column;gap:.6em"><b>${I('play')} 혼자 연습이 열렸어요</b><p class="small muted" style="margin:0">나들이 전에 택시 부르기·키오스크 주문·카톡 사진 보내기를 미리 연습해 보세요. 잘못 눌러도 괜찮아요.</p><button class="btn y sm" data-a="tab" data-v="practice">연습하러 가기</button></div>
 </main><footer class="cta"><button class="btn b" data-a="o-mine">내 나들이 보기</button></footer>`};

/* 내 나들이 (팀 배정 중 → 팀 확정) */
SC.o_mine=()=>{const a=myApp();
 if(!a)return hdr('내 나들이')+`<main class="body"><div class="empty">아직 신청한 나들이가 없어요<br><button class="link" data-a="o-list">나들이 둘러보기</button></div></main>`;
 const o=OB(a.oid);
 if(a.remote&&!a.paid)return hdr('내 나들이')+`<main class="body">
  <div class="rq no"><span class="rq-st">${I('card')} 결제 대기</span><b>${o.short} 나들이<br>참가비 결제가 아직 안 됐어요</b><span class="rq-go">결제를 마치면 신청이 끝나요</span></div>
  <div class="card sum o-sum"><div><dt>나들이</dt><dd>${o.title}</dd></div><div><dt>일시</dt><dd>${mdw(o.date)} ${range(o.start,CFG.HOURS*60)}</dd></div><div><dt>참가 인원</dt><dd>${1+(a.comp?1:0)}명</dd></div><div><dt>참가비</dt><dd class="tabnum">${won(a.amt)}</dd></div></div>
  <button class="btn y" data-a="o-repay">${won(a.amt)} 결제하기</button>
  <button class="link" data-a="o-cancel" style="align-self:center">신청 지우기</button></main>`;
 const tm=a.st==='team'&&teamOf(a.oid,a.id);const ti=tm&&teamInfo(a.oid,tm);
 const mineLv=`<div class="card" style="display:flex;flex-direction:column;gap:.5em"><b>내가 할 수 있는 것</b>${SKILLS.map(([k,t])=>`<div class="row" style="justify-content:space-between"><span>${t}</span><span class="o-lvp ${a.lv[k]==='self'?'hi':a.lv[k]==='help'?'mid':'lo'}">${LV[a.lv[k]][0]}</span></div>`).join('')}${a.comp?`<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding-top:.5em"><span>함께 가는 분</span><b>${esc(a.comp.name)} (${esc(a.comp.rel)})</b></div>`:''}</div>`;
 const when_=`<div class="o-big"><div class="big-when">${mdw(o.date)} ${range(o.start,CFG.HOURS*60)}</div><b>${o.title}</b><div class="o-place">${I('pin')}<span>${o.place}</span></div></div>`;
 if(!tm){const ev=EV(a.oid);
  return hdr('내 나들이')+`<main class="body">
  <div class="rq wait"><span class="rq-st"><i class="dot"></i>팀 배정 중</span><b>${o.short} 나들이<br>팀을 짜고 있어요</b><span class="rq-go">보통 나들이 3일 전까지 알려드려요</span></div>
  ${when_}
  <div class="card"><ol class="flow"><li class="done"><span>${I('check')}</span>신청·결제 완료</li><li class="${ev.st==='ai'?'done':'now'}"><span>2</span>AI가 비슷한 동네·수준끼리 팀 묶기</li><li class="${ev.st==='ai'?'now':''}"><span>3</span>운영자 확인</li><li><span>4</span>팀 확정 알림·문자 <em>팀원·프렌드·모이는 곳</em></li></ol></div>
  ${mineLv}${selfPay()}
  ${demo([['운영자 확정','o-demo-confirm']])}
  <button class="link" data-a="o-cancel" style="align-self:center">신청 취소하기</button>
  </main>`}
 const myF=(tm.friends||[]).find(f=>f.pids.includes(a.id));
 return hdr('내 나들이')+`<main class="body">
 <div class="rq ok"><span class="rq-st">${I('check')} 팀이 정해졌어요</span><b>${ti.ps.length}명이 함께<br>나들이 가요</b><span class="rq-go">${tm.name} · 프렌드 ${(tm.friends||[]).filter(f=>f.tid).length}명</span></div>
 ${when_}
 <div class="card o-team"><b>${I('users')} 우리 팀</b>
  <div class="o-ppl">${ti.ps.map(p=>`<span class="${p.pid===a.id?'me':''}"><span class="av" style="background:var(--sky)">${esc(p.name[0])}</span>${esc(fname(p.name))}${p.pid===a.id?' (나)':p.comp?' (동반)':''}</span>`).join('')}</div>
  <b>프렌드</b>
  ${(tm.friends||[]).filter(f=>f.tid).map(f=>{const t=tutor(f.tid);return `<div class="o-fr"><span class="av" style="background:${t.color}">${t.name[0]}</span><span><b>${t.name} 프렌드</b> <small>${t.school}</small><br><small>${f.pids.map(id=>fname((pById(a.oid,id)||{}).name)).join('·')} 님을 도와드려요${f===myF?' · <b style="color:var(--blue-ink)">나를 맡아요</b>':''}</small></span></div>`}).join('')}
  <div class="o-ai">${I('users')}<span>${AI_MSG}</span></div>
  ${ti.warn?`<div class="o-warn">${I('info')}<span>${GAP_MSG}</span></div>`:''}
 </div>
 <div class="mapbox">${mapSVG({meet:o.pk})}</div>
 <div class="card" style="display:flex;flex-direction:column;gap:.5em"><b>${I('bag')} 준비물</b><div class="alarm"><span>${I('check')}충전된 휴대폰</span><span>${I('check')}교통카드나 카드</span></div></div>
 ${selfPay()}
 ${mineLv}
 <button class="btn b" data-a="go" data-v="o_sms">${I('msg')} 받은 문자 보기</button>
 ${demo([['문자 보기','go','o_sms'],['처음부터 다시','o-reset']])}
 </main>`};

/* 팀 확정 문자 (앱의 문자 말풍선 모양) */
SC.o_sms=()=>{const a=myApp();const s=a&&smsLines(a);
 return hdr('문자 메시지')+`<main class="body sms">
 <div class="sms-from"><span class="sms-av">${LOGO(30)}</span><div><b>배프</b><small>${CFG.CS} · 오늘</small></div></div>
 <div class="sms-note">${esc(S.sr.phone||S.sms.ph)}(으)로 보낸 문자예요</div>
 ${s?`<div class="bubble o-sms">${s.title}<br><br>${s.rows.map(([k,v])=>`■ ${k}: ${esc(v).replace(/&lt;b&gt;|&lt;\/b&gt;/g,'')}`).join('<br>')}<br><br>${s.foot}</div>
 <div class="bubble">[배프] 나들이 하루 전과 1시간 전에 한 번 더 알려드릴게요. 휴대폰을 충전해 두세요.</div>`:`<div class="empty">아직 팀 확정 문자가 없어요</div>`}
 <p class="small muted" style="text-align:center;margin:0">택시비·음료비·식사비는 그날 각자 내요</p>
 </main>`};

/* 화면 이름표 · 하단 메뉴 */
Object.assign(SENIOR_TAB,{o_list:'home',o_detail:'home',o_apply:'home',o_comp:'home',o_pay:'home',o_done:'home',o_mine:'home',o_sms:'home'});
if(typeof SCN!=='undefined')Object.assign(SCN,{o_list:['SC-50-1','나들이 목록',1],o_detail:['SC-50-2','나들이 소개',1],o_apply:['SC-50-3','나들이 신청 ① 할 수 있는 것',1],o_comp:['SC-50-4','나들이 신청 ② 함께 갈 분',1],
 o_pay:['SC-50-5','나들이 신청 ③ 결제',1],o_done:['SC-50-6','나들이 신청 완료',1],o_mine:['SC-50-7','내 나들이',1],o_sms:['SC-50-8','나들이 팀 확정 문자',1]});
if(typeof SC_AD!=='undefined')SC_AD.outing=['SC-30-7','운영자 ⑦ 나들이 팀 배정',1];

/* =====================================================================
   6. 기존 화면에 붙이기 (홈 · 혼자 연습 · 배우고 싶은 것 · 프렌드 목록 · 프렌드 홈 · 운영자)
   ===================================================================== */
const FB_LINK='<button class="link" data-a="go" data-v="feedback">앱이 불편하면 알려주세요</button>';
const _home=SC.home;
SC.home=()=>{let h=_home();const a=myApp();
 if(S.paid&&h.includes('prac-tiles off'))['수업 결제 후 열려요','다음 수업을 예약하면 다시 열려요'].forEach(w=>{h=h.replace(pracTiles(false,w),pracTiles(true))});
 const hello=`<div class="hello"><h2>${esc(S.sr.name)} 님,<br>안녕하세요</h2></div>`;
 if(a&&h.includes(hello))h=h.replace(hello,hello+statusCard(a)+(hstate()==='first'?`<button class="opt" data-a="tab" data-v="practice"><span class="oi">${I('play')}</span><span><b>혼자 연습이 열렸어요</b><small>나들이 전에 택시·키오스크·카톡을 미리 연습해 보세요</small></span></button>`:''));
 const i=h.lastIndexOf(FB_LINK);if(i>=0)h=h.slice(0,i)+entryCard()+h.slice(i);
 return h};
const _prac=SC.practice;
SC.practice=()=>{let h=_prac();
 h=h.replace('<b>수업을 결제하면 열려요</b>','<b>수업이나 나들이를 결제하면 열려요</b>')
  .replace('혼자 연습은 프렌드와 수업을 예약하고 결제한 배움님만 쓸 수 있어요.','혼자 연습은 1:1 개인 수업·그룹 수업·나들이 중 하나를 결제한 배움님이 쓸 수 있어요.')
  .replace('우리 동네 프렌드 찾기</button></div>','우리 동네 프렌드 찾기</button><button class="btn ghost" data-a="o-list">이웃과 함께 나들이 보기</button></div>');
 return h.replace(/<\/main>\s*$/,`<div class="sec">연습한 걸 진짜로 해봐요</div>${entryCard()}</main>`)};
const _locked=A['prac-locked'];A['prac-locked']=(...x)=>{_locked&&_locked(...x);toast('1:1 수업이나 나들이를 결제하면 혼자 연습을 쓸 수 있어요')};
/* 키워드 칩 → 개인 수업 찾기 (기존 '배우고 싶은 것' → '내 주변 프렌드' 흐름 그대로, 주제만 미리 골라 둠) */
const _topic=SC.topic;
SC.topic=()=>{let h=_topic();const p=O().prep;if(!p||!p.length)return h;
 return h.replace('<div class="tiles">',`<div class="note o-prepnote">${I('light')}<span>나들이 준비 수업 · <b>${p.map(k=>TOPICS[k].t).join(', ')}</b>을(를) 골라 두었어요. 프렌드와 1:1로 먼저 천천히 연습해 보세요.</span></div><div class="tiles">`)};
const _list=SC.list;
SC.list=()=>{let h=_list();const p=O().prep;if(!p||!p.length)return h;
 h=h.replace(/(data-a="tutor" data-v="([^"]+)">[\s\S]*?<span class="tc-top"><b>[^<]*<\/b>)/g,(m,all,id)=>{const t=tutor(id);const hit=t&&(t.topics||[]).filter(k=>p.includes(k));return hit&&hit.length?all+`<span class="tp match">${hit.map(k=>TOPICS[k].t).join('·')} 가능</span>`:all});
 return h.replace('<div class="filters">',`<div class="note o-prepnote small">${I('light')}<span>노란 표시가 있는 프렌드가 <b>${p.map(k=>TOPICS[k].t).join(', ')}</b>을(를) 가르쳐요</span></div><div class="filters">`)};
/* 내 프로필: 내 나들이 바로가기 */
const _mine=SC.mine;
SC.mine=()=>{const h=_mine();const a=myApp();const i=h.lastIndexOf('</main>');if(i<0)return h;const o=a&&OB(a.oid);
 return h.slice(0,i)+(a?`<button class="opt" data-a="o-mine"><span class="oi">${I('users')}</span><span><b>내 나들이</b><small>${mdw(o.date)} ${o.short} · ${a.st==='team'?'팀 확정':'팀 배정 중'}</small></span></button>`:`<button class="opt" data-a="o-list"><span class="oi">${I('users')}</span><span><b>이웃과 함께 나들이</b><small>카페·공원에서 키오스크·카톡·택시를 직접 해봐요</small></span></button>`)+h.slice(i)};
const _tab=A.tab;A.tab=v=>{if(S.o)S.o.prep=null;_tab(v)};

/* 프렌드 홈: 나들이 배정 카드 */
const myFriendIds=()=>{const ids=['me'];if(OUT.remote&&S.me)ids.push('acc-'+S.me);const a=S.me&&typeof ACCOUNTS!=='undefined'&&ACCOUNTS[S.me];if(!S.me||(a&&a.demo))ids.unshift('t1');return ids};
function friendJobs(){const ids=myFriendIds();const L=[];OUTINGS.forEach(o=>{const ev=EV(o.id);if(ev.st!=='confirmed')return;ev.teams.forEach(tm=>(tm.friends||[]).forEach(f=>{if(f.tid&&ids.includes(f.tid))L.push({o,ev,tm,f})}))});return L}
const _thome=SC.thome;
SC.thome=()=>{let h=_thome();const J=friendJobs();if(!J.length)return h;
 const hello=`<div class="hello"><h2>${esc(S.tu.name)} 님,<br>안녕하세요</h2></div>`;
 const cards=J.map(({o,tm,f})=>{const ti=teamInfo(o.id,tm);const mine=f.pids.map(id=>pById(o.id,id)).filter(Boolean);const others=(tm.friends||[]).filter(x=>x!==f&&x.tid).map(x=>tutor(x.tid).name);
  return `<div class="conf-card o-fcard"><span class="rq-st">${I('users')} 나들이 배정 · 운영자 확정</span><b class="tw">${mdw(o.date)} ${o.start}<br>${o.short} 나들이</b>
  <span class="small">${o.title}</span>
  <dl class="kv"><dt>모이는 곳</dt><dd>${o.place}</dd><dt>내가 맡을 분</dt><dd>${mine.map(p=>`${esc(p.name)} ${lvPill(p.score)}`).join('<br>')}</dd><dt>같은 팀</dt><dd>배움님 ${ti.ps.length}명${others.length?` · ${others.join('·')} 프렌드`:''}</dd><dt>할 것</dt><dd>키오스크 주문 → 공원 사진 미션 → 택시 호출</dd></dl>
  ${ti.warn?`<div class="o-warn">${I('info')}<span>팀 안에서 속도가 달라요. 맡은 두 분 속도에 맞춰 주세요</span></div>`:''}</div>`}).join('');
 return h.includes(hello)?h.replace(hello,hello+cards):h};

/* 운영자: 왼쪽 메뉴 "나들이 팀 배정" */
if(typeof AD_TABS!=='undefined'&&!AD_TABS.some(t=>t[0]==='outing'))AD_TABS.push(['outing','users','나들이 팀 배정']);
const adWait=()=>OUTINGS.reduce((s,o)=>s+unassigned(o.id).length,0);
const _admin=SC.admin;
SC.admin=()=>{let h=_admin();const n=adWait();
 if(n)h=h.replace(/(data-a="ad-tab" data-v="outing">[\s\S]*?<span>나들이 팀 배정<\/span>)/,`$1<em>${n}</em>`);
 if(S.ad.tab==='dash')h=h.replace('<h3 class="ad-h3">오늘 할 일</h3>',`<h3 class="ad-h3">오늘 할 일</h3><button class="ad-todo" data-a="ad-tab" data-v="outing"><span>나들이 팀 배정</span><b class="${n?'hot':''}">${n}명</b>${I('back','j-chev')}</button>`);
 return h};
if(typeof AD_VIEW!=='undefined')AD_VIEW.outing=()=>{const oid=O().adEv||'o1';const o=OB(oid);const ev=EV(oid);const ps=persons(oid);const un=unassigned(oid);const apps=appsOf(oid);
 const pend=ps.filter(p=>!p.comp&&p.a.st!=='team'&&teamOf(oid,p.pid));const locked=ev.st==='confirmed'&&!un.length&&!pend.length;const unpaid=unpaidOf(oid);
 const evs=`<div class="o-evs">${OUTINGS.map(x=>{const e=EV(x.id);return `<button class="o-ev${x.id===oid?' on':''}" data-a="o-ad-ev" data-v="${x.id}"><b>${mdw(x.date)} ${x.start} · ${x.short}</b><small>신청 ${persons(x.id).length}명 / ${cap(x)}자리 · ${e.st==='confirmed'?'확정':e.st==='ai'?'AI 배정됨':'배정 전'}</small></button>`}).join('')}</div>`;
 const kpi=`<div class="ad-kpis tabnum"><div><small>신청</small><b>${apps.length}건</b><span>동반 포함 배움님 ${ps.length}명</span></div><div><small>팀</small><b>${ev.teams.length}팀</b><span>팀당 최대 ${CFG.MAX_PER_TEAM}명</span></div>
  <div><small>필요한 프렌드</small><b>${ev.teams.reduce((s,t)=>s+Math.ceil(t.members.length/CFG.SENIORS_PER_FRIEND),0)||Math.ceil(ps.length/CFG.SENIORS_PER_FRIEND)}명</b><span>1명이 배움님 ${CFG.SENIORS_PER_FRIEND}명</span></div>
  <div><small>상태</small><b>${ev.st==='confirmed'?(un.length?'추가 배정 필요':'확정 · 문자 보냄'):ev.st==='ai'?'운영자 확인 전':'배정 전'}</b><span>${won(PRICE)} × ${ps.length}명 결제 완료</span></div></div>`;
 const rule=`<div class="note blue small">${I('users')} <b>AI 자동 배정 규칙</b> — ① 같은·가까운 동네끼리(주소의 동) ② 비슷한 수준끼리(자가진단 3가지 합 0~6점) ③ 동반 신청은 같은 팀 ④ 팀당 배움님 최대 ${CFG.MAX_PER_TEAM}명 ⑤ 프렌드 1명이 배움님 최대 ${CFG.SENIORS_PER_FRIEND}명, 세 가지를 가르치는 프렌드 중 모이는 곳에서 가까운 순(전에 만난 프렌드와 짝) ⑥ 팀 안 수준 차이가 ${CFG.GAP_WARN}점 이상이면 안내</div>`;
 const table=`<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>이름</th><th>나이</th><th>동네</th><th>할 수 있는 것 (키오스크·택시·카톡)</th><th>수준</th><th>동반</th><th>결제</th><th>신청일</th><th>팀</th></tr></thead><tbody>
  ${ps.map(p=>{const t=teamOf(oid,p.pid);return `<tr class="${p.a.me?'newrow':''}"><td><b>${p.comp?'└ ':''}${esc(p.name)}</b>${p.a.me&&!p.comp?' <span class="ad-pill new">방금 신청</span>':''}</td><td>${p.age||'-'}</td><td>${esc(p.dong)}</td><td>${p.comp?'<span class="muted small">신청자와 같게 봐요</span>':sk3(p.a.lv)}</td><td>${lvPill(p.score)}</td>
   <td>${p.comp?`${esc(p.rel)} · 동반`:p.a.comp?`${esc(p.a.comp.name)} (${esc(p.a.comp.rel)})`:'-'}</td><td>${p.comp?'':`${esc(p.a.payer)} · ${won(p.a.amt)}`}</td><td>${p.comp?'':p.a.paidAt}</td><td>${t?`<b>${t.name}</b>`:'<span class="ad-pill wait">배정 전</span>'}</td></tr>`}).join('')||'<tr><td colspan="9" class="muted">아직 신청자가 없어요</td></tr>'}
  ${unpaid.map(a=>`<tr><td><b>${esc(a.name)}</b>${a.comp?` <small class="muted">+ ${esc(a.comp.name)}</small>`:''}</td><td>${a.age||'-'}</td><td>${esc(a.dong)}</td><td>${sk3(a.lv)}</td><td>${lvPill(a.score)}</td><td>${a.comp?`${esc(a.comp.name)} (${esc(a.comp.rel)})`:'-'}</td><td><span class="ad-pill wait">결제 대기</span></td><td>-</td><td><span class="muted small">결제 후 배정</span></td></tr>`).join('')}
  </tbody></table></div>`;
 const opts=(pid)=>{const cur=teamOf(oid,pid);return `<select data-o-move="${pid}" aria-label="팀 옮기기" ${locked?'disabled':''}><option value="">${cur?cur.name+'에 있어요 · 다른 팀으로 옮기기':'팀 고르기'}</option>${ev.teams.filter(t=>t!==cur).map(t=>`<option value="${t.id}">${t.name}(으)로 옮기기 (${t.members.length}명)</option>`).join('')}<option value="new">새 팀 만들기</option></select>`};
 const teams=ev.teams.length?`<div class="o-ai">${I('users')}<span>${AI_MSG}. 사람을 옮기려면 이름 아래 칸에서 팀을 고르세요. 동반 신청한 분은 함께 옮겨져요.</span></div>
  <div class="o-teams">${ev.teams.map(tm=>{const ti=teamInfo(oid,tm);const sc=ti.ps.map(p=>p.score);
  return `<div class="card o-tcard${ti.warn?' warn':''}"><div class="o-th"><b>${tm.name}</b><span class="ad-pill">${ti.dongs.join('·')}</span><span class="sp"></span><span class="small muted tabnum">배움님 ${ti.ps.length}명 · 수준 ${Math.min(...sc)}~${Math.max(...sc)}점</span></div>
   <div>${ti.ps.map(p=>`<div class="o-mem"><span class="av">${esc(p.name[0])}</span><span><b>${esc(p.name)}</b>${p.comp?` <small style="display:inline">(${esc(p.rel)} · 동반)</small>`:''}${p.a.me&&!p.comp?' <span class="ad-pill new">앱 신청</span>':''}<small>${p.age?p.age+'세 · ':''}${esc(p.dong)}</small></span>${lvPill(p.score)}${opts(p.pid)}</div>`).join('')}</div>
   ${(tm.friends||[]).map(f=>{const t=f.tid&&tutor(f.tid);return t?`<div class="o-fr"><span class="av" style="background:${t.color}">${t.name[0]}</span><span><b>${t.name}</b> 프렌드 <small>${(t.topics||[]).filter(k=>o.topics.includes(k)).map(k=>KW[k]).join('·')}</small><br><small>→ ${f.pids.map(id=>esc(fname((pById(oid,id)||{}).name))).join('·')} 님</small></span></div>`:`<div class="o-fr" style="background:var(--coral-2)"><span class="av">?</span><span><b>프렌드 모집 중</b><br><small>세 가지를 가르칠 프렌드가 더 필요해요</small></span></div>`}).join('')}
   ${ti.warn?`<div class="o-warn">${I('info')}<span>${GAP_MSG}</span></div>`:''}</div>`}).join('')}</div>`:'';
 const bar=`<div class="o-adbar">
  ${ev.st==='confirmed'&&un.length?`<button class="btn b sm" data-a="o-ai" data-v="keep">새 신청자 ${un.length}명 배정</button>`:ev.st==='confirmed'?'':`<button class="btn b sm" data-a="o-ai">${ev.teams.length?'AI로 다시 배정':'AI 자동 배정'}</button>`}
  ${ev.teams.length&&!locked?`<button class="btn y sm" data-a="o-confirm" ${un.length?'disabled':''}>${ev.st==='confirmed'?'새로 배정한 분 확정하기':'확정하고 문자 보내기'}</button>`:''}${unpaid.length?`<span class="small muted">결제 대기 ${unpaid.length}건은 결제가 끝나면 배정할 수 있어요</span>`:''}
  ${locked?`<span class="ad-pill done">확정 · ${ev.at||''} 문자 보냄</span><span class="small muted">배움님 알림함·문자, 프렌드 홈에 팀이 보여요</span>`:un.length&&ev.teams.length?`<span class="small muted">아직 팀이 없는 분이 ${un.length}명 있어요</span>`:''}</div>`;
 return evs+kpi+rule+`<div class="card" style="display:flex;flex-direction:column;gap:.6em"><h3 class="ad-h3" style="margin:0">${o.title} · 신청자</h3>${table}</div>`+bar+teams};

/* =====================================================================
   7. 동작
   ===================================================================== */
const startForm=oid=>{O().f={oid,lv:{kiosk:null,taxi:null,kakao:null},comp:false,cname:'',cph:'',crel:'배우자',payer:S.sr.byChild?S.payer:'self',childSent:false};O().ck=null};
const goPrep=topics=>{O().prep=topics.slice();S.sr.topics=topics.slice();O().sheet=null;go('topic')};
Object.assign(A,{
 'o-list':()=>{O().sheet=null;go('o_list')},
 'o-open':v=>{O().cur=v;O().sheet=null;go('o_detail')},
 'o-mine':()=>go('o_mine'),
 'o-chip':v=>{goPrep([v]);toast(`'${TOPICS[v].t}' 개인 수업을 찾아볼게요`)},
 'o-apply':()=>{const o=OB(O().cur);if(myApp()){go('o_mine');return}if(left(o)<1){toast('자리가 다 찼어요');return}
  if(!hasLesson()){O().sheet='rec';render();return}startForm(o.id);go('o_apply')},
 'o-rec-demo':()=>{O().sheet='rec';render()},
 'o-sheet-bg':(v,el,e)=>{if(e.target===el){O().sheet=null;render()}},
 'o-rec-lesson':()=>{const o=OB(O().cur);goPrep(o.topics.filter(k=>k!=='kakao'));toast('택시·키오스크 개인 수업부터 찾아볼게요')},
 'o-rec-go':()=>{O().sheet=null;startForm(O().cur);go('o_apply')},
 'o-lv':v=>{const [k,l]=v.split(':');const f=O().f;if(!f)return;f.lv[k]=l;render()},
 'o-next1':()=>{const f=O().f;if(!f||!SKILLS.every(([k])=>f.lv[k])){toast('세 가지를 모두 골라 주세요');return}go('o_comp')},
 'o-comp':v=>{const f=O().f;if(!f)return;f.comp=v==='1';render();if(f.comp)setTimeout(()=>{const el=document.getElementById('o-cname');if(el&&!el.value)try{el.focus({preventScroll:true})}catch(e){}},50)},
 'o-rel':v=>{const f=O().f;if(f){f.crel=v;render()}},
 'o-next2':()=>{const f=O().f;if(!f)return;
  if(f.comp){const n=(document.getElementById('o-cname')||{}).value,p=(document.getElementById('o-cph')||{}).value;if(n!=null)f.cname=n.trim();if(p!=null)f.cph=p.trim();
   if(!f.cname){toast('함께 갈 분 이름을 적어 주세요');return}if(!/^01\d-?\d{3,4}-?\d{4}$/.test(f.cph)){toast('휴대폰 번호를 010-0000-0000처럼 적어 주세요');return}
   if(left(OB(f.oid))<2){toast('남은 자리가 모자라요');return}}
  go('o_pay')},
 'o-payer':v=>{const f=O().f;if(!f)return;f.payer=v==='child'?'child':'self';if(f.payer==='self')f.childSent=false;render()},
 'o-child-send':()=>{const f=O().f;if(!f)return;const re=f.childSent;f.childSent=true;const o=OB(f.oid);
  S.ad.smsLog.push({time:mslash(TODAYN)+' '+new Date().toTimeString().slice(0,5),to:'자녀 ('+S.sr.name+')',ph:S.sr.cphone||'010-0000-0000',kind:'나들이 결제 요청',body:`[배프] ${S.sr.name} 님이 ${mdw(o.date)} ${o.short} 나들이 참가비 결제를 부탁하셨어요. ${won(PRICE*(CFG.COMPANION_PAYS?people(f):1))} · 링크에서 결제해 주세요`,st:'발송 완료'});
  render();toast(re?'결제 요청 문자를 다시 보냈어요':'자녀분께 결제 요청 문자를 보냈어요')},
 'o-child-pay':()=>{O().ck={step:'review',card:0,agree:false,pin:'',child:true};render()},
 'o-pay':async()=>{pickStore();if(OUT.remote){const f=O().f;if(!f||O()._busy)return;O()._busy=true;const o=OB(f.oid);const n=people(f);
   const r=await rApply(f);O()._busy=false;if(!r){toast('신청서를 저장하지 못했어요. 인터넷 연결을 확인해 주세요',3400);return}
   if(r.paid){await rLoad(true);S.hist=['home'];S.screen='o_mine';render();return}
   await rLoad(true);payOuting(r.id,r.amount,o,n);return}
  O().ck={step:'review',card:0,agree:false,pin:'',child:false};render()},
 'o-repay':()=>{const a=myApp();if(!a||!a.remote||a.paid)return;payOuting(a.id,a.amt,OB(a.oid),1+(a.comp?1:0))},
 'o-ck-close':()=>{O().ck=null;render()},
 'o-ck-card':v=>{O().ck.card=+v;render()},
 'o-ck-agree':()=>{const c=O().ck;c.agree=!c.agree;render()},
 'o-ck-next':()=>{const c=O().ck;if(!c.agree)return;c.step='pin';c.pin='';render()},
 'o-ck-retry':()=>{const c=O().ck;c.step='review';c.card=0;render()},
 'o-ck-key':v=>{const c=O().ck;if(!c||c.step!=='pin')return;if(v==='지움')c.pin=c.pin.slice(0,-1);else if(v==='전체 지움')c.pin='';else if(c.pin.length<6)c.pin+=v;render();
  if(c.pin.length===6){c.step='wait';render();setTimeout(()=>{if(O().ck!==c)return;if(S.method.includes('카드')&&c.card===1){c.step='fail';render();return}payDone(c.child)},1300)}},
 /* 신청 취소: 휴대폰 기본 확인창 대신 '한 번 더 누르기'로 확인 */
 'o-cancel':async()=>{const a=myApp();if(!a)return;
  if(a.remote){if(a.paid){toast(`결제한 나들이 취소는 고객센터(${CFG.CS})로 연락해 주세요. 3일 전까지는 전액 환불돼요`,4200);return}
   const db=await myDB();try{await db.doc('baep_outing_apps/'+a.id).delete();await rLoad(true);S.hist=[];S.screen='home';render();toast('신청을 지웠어요')}catch(e){toast('지우지 못했어요. 인터넷 연결을 확인해 주세요')}return}const o=O();if(!o.cancelAt||Date.now()-o.cancelAt>4000){o.cancelAt=Date.now();toast('한 번 더 누르면 신청이 취소돼요. 나들이 3일 전까지는 전액 환불돼요',4000);return}o.cancelAt=0;cancelMine();toast('신청을 취소했어요. 참가비는 결제한 수단으로 돌려드려요')},
 'o-reset':()=>{if(OUT.remote)return;cancelMine(true);toast('시연: 처음 상태로 되돌렸어요')},
 'o-demo-confirm':()=>{const a=myApp();if(!a||OUT.remote)return;const ev=EV(a.oid);if(ev.st!=='confirmed')aiAssign(a.oid);else if(!teamOf(a.oid,a.id))aiAssign(a.oid,true);
  confirmEv(a.oid);S.hist=['home'];S.screen='o_mine';render()},
 /* 운영자 */
 'o-ad-ev':v=>{O().adEv=v;render();if(OUT.remote)rLoad(true)},
 'o-ai':async v=>{const oid=O().adEv||'o1';if(!persons(oid).length){toast(unpaidOf(oid).length?'결제를 마친 신청자가 없어요':'신청자가 없어요');return}aiAssign(oid,v==='keep');save();render();if(OUT.remote){if(!await rPushTeams(oid))return;render()}toast(v==='keep'?'새 신청자를 알맞은 팀에 넣었어요':`AI가 ${EV(oid).teams.length}팀으로 묶었어요. 확인하고 확정해 주세요`)},
 'o-confirm':async()=>{const oid=O().adEv||'o1';if(unassigned(oid).length){toast('팀이 없는 분이 있어요');return}const n=confirmEv(oid);render();if(OUT.remote){if(!await rConfirm(oid))return;await rPushTeams(oid);render()}toast(`팀을 확정했어요. 신청자 ${n}분(동반 포함 ${persons(oid).length}명)께 알림과 문자를 보냈어요`)}
});
function moveUnit(oid,pid,to){const ev=EV(oid);const p=pById(oid,pid);if(!p)return;const unit=persons(oid).filter(x=>x.a.id===p.a.id).map(x=>x.pid);
 let dest=to==='new'?null:ev.teams.find(t=>t.id===to);
 const other=unit.length>1;
 if(dest&&dest.members.filter(id=>!unit.includes(id)).length+unit.length>CFG.MAX_PER_TEAM){toast(`${dest.name}은(는) 이미 ${dest.members.length}명이에요. 팀당 최대 ${CFG.MAX_PER_TEAM}명이에요`);render();return}
 ev.teams.forEach(t=>t.members=t.members.filter(id=>!unit.includes(id)));
 if(!dest){dest={id:'T'+Date.now().toString(36),members:[],friends:[]};ev.teams.push(dest)}
 dest.members.push(...unit);ev.teams=ev.teams.filter(t=>t.members.length);staff(oid);save();render();if(OUT.remote)rPushTeams(oid).then(ok=>{if(ok)render()});
 toast(`${p.a.name} 님${other?`(동반 ${p.a.comp.name} 님과 함께)`:''}을 ${dest.name}(으)로 옮겼어요`)}
document.addEventListener('change',e=>{const s=e.target;if(!s.matches||!s.matches('select[data-o-move]'))return;if(!s.value)return;moveUnit(O().adEv||'o1',s.dataset.oMove,s.value)});
document.addEventListener('input',e=>{const f=S.o&&S.o.f;if(!f)return;if(e.target.id==='o-cname')f.cname=e.target.value;if(e.target.id==='o-cph')f.cph=e.target.value});
function payDone(child){const f=O().f;if(!f)return;const o=OB(f.oid);const n=CFG.COMPANION_PAYS?people(f):1;
 const a={id:'a'+Date.now().toString(36),oid:f.oid,acct:meKey()||'baeum',me:true,name:S.sr.name,age:S.sr.age,dong:S.sr.dong||((S.sr.area||'').match(/\S+동/)||['영통동'])[0],ph:S.sr.phone||'010-0000-0000',
  lv:Object.assign({},f.lv),score:scoreOf(f.lv),comp:f.comp?{name:f.cname,age:'',rel:f.crel,ph:f.cph}:null,payer:child?'자녀':'본인',method:S.method,amt:PRICE*n,paidAt:md(TODAYN),st:'assign',notis:[],known:myKnown()};
 OUT.apps.push(a);save();
 S.ad.smsLog.push({time:mslash(TODAYN)+' '+new Date().toTimeString().slice(0,5),to:S.sr.name,ph:a.ph,kind:'나들이 신청',body:`[배프] ${mdw(o.date)} ${o.short} 나들이 신청이 끝났어요. 팀이 정해지면 문자로 알려드려요. 택시비·음료비는 각자 내요`,st:'발송 완료',me:true});
 O().ck=null;O().f=null;S.hist=['home'];S.screen='o_done';render();
 noti(child?'결제 완료':'나들이 신청 완료',child?'자녀분이 나들이 참가비 결제를 마쳤어요. 팀 배정 중이에요':`${mdw(o.date)} ${o.short} 나들이 신청을 마쳤어요. 혼자 연습도 열렸어요`);
 const last=S.notis[S.notis.length-1];if(last)last.go='o_mine';
 if(!child)toast(S.method+'로 결제했어요')}
function cancelMine(hard){const a=myApp();if(!a)return;if(hard){OUT.apps=OUT.apps.filter(x=>x!==a);EV(a.oid).teams.forEach(t=>t.members=t.members.filter(id=>id!==a.id&&id!==a.id+'c'));const ev=EV(a.oid);ev.teams=ev.teams.filter(t=>t.members.length);if(!ev.teams.length)ev.st='none';else staff(a.oid)}
 else{a.st='cancel';const ev=EV(a.oid);ev.teams.forEach(t=>t.members=t.members.filter(id=>id!==a.id&&id!==a.id+'c'));ev.teams=ev.teams.filter(t=>t.members.length);if(ev.teams.length)staff(a.oid)}
 save();S.hist=[];S.screen='home';render()}

/* =====================================================================
   8. render 감싸기: 연습 잠금 조건·계정 저장 연결·알림 전달
   ===================================================================== */
const banner=(t,b)=>{const n=document.getElementById('noti');if(!n)return;n.innerHTML=`<span class="ni">${LOGO(26)}</span><div><b>배프 · ${t}</b><p>${b}</p></div>`;n.hidden=false;clearTimeout(banner._t);banner._t=setTimeout(()=>n.hidden=true,3600)};
function deliver(){let ch=false;
 if(S.member&&S.member.mentee&&SENIOR_TAB[S.screen]){
  /* 다른 기기에서 저장된 내 신청(S.outing)을 이 폰 저장소로 */
  if(OUT===LOCAL&&S.outing&&S.outing.id&&!OUT.apps.some(x=>x.id===S.outing.id)&&S.outing.st!=='cancel'){OUT.apps.push(JSON.parse(JSON.stringify(S.outing)));save()}
  const a=myApp();if(a)(a.notis||[]).forEach(n=>{if(!S.notis.some(x=>x.oid===n.id)){S.notis.push({id:Date.now()+Math.random(),oid:n.id,ic:'users',t:n.t,b:n.b,time:n.shown?'오늘':'방금',go:'o_mine',read:!!n.read});ch=true}
   if(!n.shown){n.shown=true;if(a.remote)seenSet(n.id,1);save();banner(n.t,n.b)}})}
 if(S.member&&S.member.mentor&&typeof TUTOR_TAB!=='undefined'&&TUTOR_TAB[S.screen]){friendJobs().forEach(({o,ev,f})=>{ev.fnoti=ev.fnoti||{};const key='of'+o.id+f.tid;const t='나들이 배정',m=`${mdw(o.date)} ${o.short} 나들이 · 배움님 ${f.pids.length}명을 맡아요`;
  if(!S.tnotis.some(x=>x.oid===key)){S.tnotis.push({id:Date.now()+Math.random(),oid:key,ic:'bell',t,b:m,time:ev.fnoti[f.tid]?'오늘':'방금',read:false});ch=true}
  if(!ev.fnoti[f.tid]&&OUT.remote&&seenGet()[key])ev.fnoti[f.tid]=1;
  if(!ev.fnoti[f.tid]){ev.fnoti[f.tid]=1;if(OUT.remote)seenSet(key,1);save();banner(t,m)}})}
 return ch}
/* 알림 탭을 열면 읽음으로 (다시 로그인해도 빨간 숫자가 다시 뜨지 않게) */
const _notis=SC.notis;SC.notis=()=>{const a=myApp();if(a){let c=false;S.notis.forEach(x=>{if(x.oid){const n=(a.notis||[]).find(n=>n.id===x.oid);if(n&&!n.read){n.read=true;c=true;if(a.remote)seenSet(n.id,2)}}});if(c)save()}return _notis()};
const _render=render;
render=function(){if(!S.o)O();pickStore();hookPaid();_render();if(deliver())_render();
 /* 진짜 계정: 나들이 화면·홈을 열 때 가끔(15초마다) 다시 읽어요 */
 if(OUT.remote&&(/^o_/.test(S.screen)||['home','thome'].includes(S.screen)||(S.screen==='admin'&&S.ad.tab==='outing')))rLoad(false)};
/* 운영자 화면 '나들이 팀 배정' 을 열면 바로 읽기 */
const _adTab=A['ad-tab'];A['ad-tab']=v=>{_adTab(v);if(v==='outing'&&OUT.remote)rLoad(true)};
/* 시연용: 개발자 도구에서 살펴보기 */
window.BAEP_OUTING={CFG,OUTINGS,store:()=>OUT,aiAssign:(oid)=>{aiAssign(oid||'o1');save();render()},confirm:(oid)=>{confirmEv(oid||'o1');render()},reset:()=>{OUT=seed();save();render()}};

/* =====================================================================
   9. 한 화면 보기(?s=) — 나들이 화면들
   ===================================================================== */
if(MODE==='frame'){const Q=new URLSearchParams(location.search);const k=Q.get('o')||Q.get('s');
 const paid=()=>{A.demo();S.sr.topics=['taxi','kiosk']};
 const fresh=()=>{S.member.mentee=true;S.hist=[]};
 const mineApp=(conf)=>{paid();startForm('o1');Object.assign(O().f,{lv:{kiosk:'help',taxi:'new',kakao:'help'}});
  OUT.apps.push({id:'aME',oid:'o1',acct:'baeum',me:true,name:S.sr.name,age:S.sr.age,dong:S.sr.dong,ph:S.sr.phone,lv:{kiosk:'help',taxi:'new',kakao:'help'},score:2,comp:null,payer:'본인',method:'카카오페이',amt:PRICE,paidAt:md(TODAYN),st:'assign',notis:[],known:myKnown()});
  O().f=null;if(conf){aiAssign('o1');confirmEv('o1');myApp().notis.forEach(n=>n.shown=true)}};
 const F={
  o_list:()=>{paid();S.screen='o_list'},
  o_detail:()=>{paid();O().cur='o1';S.screen='o_detail'},
  o_rec:()=>{fresh();O().cur='o1';O().sheet='rec';S.screen='o_detail'},
  o_apply:()=>{fresh();startForm('o1');O().f.lv={kiosk:'help',taxi:'new',kakao:null};S.screen='o_apply'},
  o_comp:()=>{fresh();startForm('o1');Object.assign(O().f,{lv:{kiosk:'help',taxi:'new',kakao:'help'},comp:true,cname:'김철수',cph:'010-3456-7890'});S.screen='o_comp'},
  o_pay:()=>{paid();startForm('o1');O().f.lv={kiosk:'help',taxi:'new',kakao:'help'};S.screen='o_pay'},
  o_paysheet:()=>{paid();startForm('o1');O().f.lv={kiosk:'help',taxi:'new',kakao:'help'};O().ck={step:'review',card:0,agree:true,pin:'',child:false};S.screen='o_pay'},
  o_done:()=>{mineApp(false);S.screen='o_done'},
  o_mine:()=>{mineApp(false);S.screen='o_mine'},
  o_mine_team:()=>{mineApp(true);S.screen='o_mine'},
  o_sms:()=>{mineApp(true);S.screen='o_sms'},
  home_outing:()=>{mineApp(true);S.screen='home'},
  thome_outing:()=>{mineApp(true);tutorDemo();S.member.mentee=false;S.screen='thome'},
  ad_outing:()=>{S.ad.tab='outing';O().adEv='o1';S.screen='admin'},
  ad_outing_ai:()=>{aiAssign('o1');S.ad.tab='outing';O().adEv='o1';S.screen='admin'}};
 if(F[k]){try{F[k]();render()}catch(e){console.error('[feat-outing]',e)}}
 else if(['home','practice','thome','admin','topic','list'].includes(S.screen))render()}
})();
