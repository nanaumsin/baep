
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
