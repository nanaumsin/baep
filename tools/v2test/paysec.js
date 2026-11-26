const PAYC=Object.assign({mode:'test',clientKey:''},window.BAEP_PAY||{});
delete PAYC.testSecretKey;   /* 시크릿 키는 서버(워커)에만 있어요. 브라우저에서 승인하지 않아요 */
const TP_KEY='baep3_paysnap';
/* 진짜 결제창: 서버 로그인한 진짜 계정 + 워커 주소가 있을 때만. 시연 계정·둘러보기는 예전 연습 결제창 */
const tossOn=()=>PAYC.mode!=='off'&&MODE==='app'&&!KIOSK&&!!PAYC.clientKey&&!!WORKER&&live();
let TP=null,TP_LAST=null;
const tpLoad=()=>window.TossPayments?Promise.resolve():new Promise((ok,no)=>{const s=document.createElement('script');s.src='https://js.tosspayments.com/v2/standard';s.onload=ok;s.onerror=()=>no(new Error('sdk'));document.head.appendChild(s)});
const tpOrder=()=>'baep-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
const tpRows=o=>o.rows||(o.kind==='lesson'?(()=>{const t=tutor(S.tid)||{name:''};return [['상품',`배프 1:1 수업 · ${DUR[S.dur].l}`],['프렌드 · 일시',`${t.name} · ${when(S.day,S.slot)}`]]})():[]);
function tpDraw(){let el=document.querySelector('.pyw.tp');if(!TP){if(el)el.remove();return}
 if(TP.note){if(el)el.remove();el=document.createElement('div');el.className='pyw tp';el.setAttribute('role','dialog');phone().appendChild(el);el.innerHTML=`<div class="ck-s">${TP.note}</div>`;return}
 if(!el){el=document.createElement('div');el.className='pyw tp';el.setAttribute('role','dialog');el.setAttribute('aria-label','결제');phone().appendChild(el);
  el.innerHTML=`<div class="ck-s tp-s"><div class="ck-h"><b>결제하기</b><button class="ck-x" data-a="tp-close" aria-label="닫기">${I('x')}</button></div>
  <div><div class="small muted">${TP.who==='child'?esc(S.sr.name)+' 님 '+(TP.kind==='outing'?'나들이 참가비':'수업료'):'결제할 금액'}</div><div class="ck-amt">${won(TP.amount)}</div></div>
  ${tpRows(TP).map(([k,v])=>`<div class="ck-row"><span>${k}</span><b>${v}</b></div>`).join('')}
  ${PAYC.mode==='test'?`<div class="tp-test">테스트 결제예요 · 결제창은 진짜지만 돈은 나가지 않아요</div>`:''}
  <div id="tp-methods"></div><div id="tp-agree"></div><p class="ck-note tp-msg" aria-live="polite"></p>
  <button class="btn y" data-a="tp-go" disabled>${won(TP.amount)} 결제하기</button></div>`}
 const m=el.querySelector('.tp-msg'),g=el.querySelector('[data-a="tp-go"]');if(m)m.textContent=TP.err||(!TP.ready?'결제창을 불러오고 있어요…':TP.busy?'결제 화면으로 넘어가고 있어요…':'');if(g)g.disabled=!TP.ready||!!TP.busy}
const tpNote=(kind,title,body,btns)=>{TP={note:`<div class="ck-mid">${kind==='spin'?'<div class="ck-spin"></div>':kind==='ok'?`<div class="okmark">${I('check')}</div>`:'<div class="ck-bad">!</div>'}<b style="font-size:1.15em">${title}</b><p class="small muted" style="margin:0">${body}</p></div>${(btns||[]).map(([l,a,v,c])=>`<button class="btn ${c||'ghost'}" data-a="${a}"${v?` data-v="${v}"`:''}>${l}</button>`).join('')}`,screen:S.screen};tpDraw()};
/* 결제 열기 — 1:1 수업·나들이가 같이 써요. amount 는 요청 문서(수업) 또는 나들이 신청서의 금액이에요 (서버가 다시 확인해요) */
window.BAEP_TOSS_PAY=function(o){o=o||{};const amount=Math.round(+o.amount||0);
 if(!(amount>0)||!o.kind||!o.refId){toast('결제 정보를 다시 확인해 주세요');return false}
 if(!live()){toast('로그인한 뒤 결제할 수 있어요');return false}
 if(!tossOn()){toast('지금은 결제를 준비 중이에요. 잠시 후 다시 해 주세요',3200);return false}
 tossOpen({amount,orderName:String(o.orderName||'배프 결제').slice(0,90),kind:o.kind==='outing'?'outing':'lesson',refId:String(o.refId),who:o.who==='child'?'child':'self',rows:o.rows||null});return true};
async function tossOpen(o){TP_LAST=o;TP=Object.assign({},o,{ready:false,screen:S.screen});tpDraw();
 try{await tpLoad();if(!TP)return;const tp=TossPayments(PAYC.clientKey);
  /* 비회원 결제. 카드 저장 같은 회원 결제를 쓰려면 계정마다 바뀌지 않는 고유값(추측 불가)을 넣어요 */
  const w=tp.widgets({customerKey:TossPayments.ANONYMOUS});
  await w.setAmount({currency:'KRW',value:TP.amount});
  await Promise.all([w.renderPaymentMethods({selector:'#tp-methods',variantKey:'DEFAULT'}),w.renderAgreement({selector:'#tp-agree',variantKey:'AGREEMENT'})]);
  if(!TP)return;TP.w=w;TP.ready=true}
 catch(e){console.warn('toss',e);if(!TP)return;TP.err='결제창을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.'}
 tpDraw()}
A['tp-close']=()=>{TP=null;tpDraw()};
A['tp-retry']=()=>{TP=null;tpDraw();if(TP_LAST)tossOpen(TP_LAST)};
/* 결제 앱으로 넘어갔다 돌아오기 때문에, 떠나기 전 화면 상태를 잠깐 저장해 둬요 (비밀번호 칸은 빼고) */
const snapS=()=>{const c=JSON.parse(JSON.stringify(S));if(c.sr){delete c.sr.pw;delete c.sr.pw2}if(c.tu){delete c.tu.pw;delete c.tu.pw2;if(c.tu.photo)c.tu.photo='sample'}delete c.login;delete c.adl;return c};
A['tp-go']=async()=>{if(!TP||!TP.w||TP.busy)return;TP.busy=true;TP.err='';tpDraw();const orderId=tpOrder();
 const order={orderId,amount:TP.amount,who:TP.who,kind:TP.kind,refId:TP.refId,orderName:TP.orderName,rows:TP.rows,screen:TP.screen,at:Date.now()};
 try{localStorage.setItem(TP_KEY,JSON.stringify({order,acct:S.me,S:snapS()}))}catch(e){}
 const back=location.origin+location.pathname;
 try{await TP.w.requestPayment({orderId,orderName:TP.orderName,successUrl:back+'?toss=ok',failUrl:back+'?toss=fail',customerName:S.sr.name||'배움님'})}
 catch(e){console.warn('toss req',e);if(TP){TP.busy=false;TP.err=e&&/CANCEL/.test(e.code||'')?'':((e&&e.message)||'결제를 시작하지 못했어요');tpDraw()}}};
/* 1:1 수업 결제: 진짜 요청(Firestore)이면 진짜 결제창 → 서버 승인, 아니면(시연) 연습 결제창 */
const remoteLesson=()=>!!(S.req&&S.req.remote&&S.req.rid);
const lessonName=()=>{const t=tutor(S.tid)||{name:''};return `배프 1:1 수업 · ${t.name} 프렌드 (${DUR[S.dur].l})`};
const _ckPay=A.pay;A.pay=()=>{if(remoteLesson()){window.BAEP_TOSS_PAY({amount:S.req.amount||DUR[S.dur].p,orderName:lessonName(),kind:'lesson',refId:S.req.rid,who:'self'});return}_ckPay()};
const _cPayNow=A['c-paynow'];A['c-paynow']=()=>{const k=S.child.req;if(!k)return;if(remoteLesson()){Object.assign(S,{tid:k.tid,day:k.day,slot:k.slot,place:k.place,dur:k.dur});window.BAEP_TOSS_PAY({amount:S.req.amount||DUR[S.dur].p,orderName:lessonName(),kind:'lesson',refId:S.req.rid,who:'child'});return}_cPayNow()};
/* 서버 승인 뒤: 결제 상태는 서버가 쓴 문서(paid:true)로만 확인해요 */
window.BAEP_WAIT_PAID=(path,ms)=>new Promise(async res=>{const db=await myDB();if(!db){res(null);return}let un=null,fin=false;
 const end=v=>{if(fin)return;fin=true;clearTimeout(t);try{un&&un()}catch(e){}res(v)};const t=setTimeout(()=>end(null),ms||20000);
 try{un=db.doc(path).onSnapshot(sn=>{const d=sn.exists?sn.data():null;if(d&&d.paid===true)end(d)},()=>end(null))}catch(e){end(null)}});
function tpDone(o,res){const prov=res.easyPay&&res.easyPay.provider;const how=prov||res.method||'결제';
 S.method=how;S.lastPay={orderId:res.orderId||o.orderId,paymentKey:res.paymentKey,amount:res.totalAmount||o.amount,method:how,at:res.approvedAt,receipt:res.receipt&&res.receipt.url,test:PAYC.mode==='test'||!!res.mId&&/^tg/.test(res.mId),day:S.day};
 TP=null;tpDraw();
 if(o.who==='child'){S.payer='child';_pay();S.childPaid=true;S.childSent=false;S.child.req=null;S.child.paidKeys.push('b'+S.booking.day);pNoti('결제 완료','자녀분이 수업료 결제를 마쳤어요. 수업이 확정됐어요','card');S.child.back='done';S.hist=[];S.screen='c_paid';render();toast(how+'로 결제했어요')}
 else{S.payer='self';_pay()}
 const p=S.ad.pays[S.ad.pays.length-1];if(p&&p.me)Object.assign(p,{how,orderId:S.lastPay.orderId,pk:res.paymentKey,receipt:S.lastPay.receipt,test:S.lastPay.test})}
const PAY_DONE={
 lesson:async(o,res)=>{tpNote('spin','결제를 확인하고 있어요','화면을 닫지 말고 잠시만 기다려 주세요');PAYING_RID=o.refId;
  const d=await window.BAEP_WAIT_PAID('baep_requests/'+o.refId,20000);PAYING_RID=null;
  if(!d){tpNote('bad','결제 확인이 늦어지고 있어요','결제는 승인됐어요. 잠시 뒤 홈에서 다시 확인해 주세요. 계속 안 보이면 고객센터(1588-0000)로 알려 주세요.',[['닫기','tp-close']]);if(S.req&&S.req.rid)watchReq();return}
  if(!S.req||S.req.rid!==o.refId){TP=null;tpDraw();render();return}
  tpDone(o,res)},
 outing:async(o,res)=>{if(typeof window.BAEP_OUTING_PAID==='function'){TP=null;tpDraw();await window.BAEP_OUTING_PAID(o,res)}else{TP=null;tpDraw();render()}}};
/* 결제를 기다리던 요청이 (다른 기기·나중에) 서버에서 결제 완료로 바뀌면 수업 확정으로 */
onLessonPaid=d=>{if(!S.req||!S.req.remote||S.req.rid!==d.rid)return;S.payer=S.payer||'self';_pay();toast('결제가 확인됐어요. 수업이 확정됐어요',2600)};
async function tpReturn(){if(MODE!=='app')return;const q=new URLSearchParams(location.search);const st=q.get('toss');if(!st)return;
 history.replaceState(null,'',location.pathname);
 let snap=null;try{snap=JSON.parse(localStorage.getItem(TP_KEY)||'null')}catch(e){}
 try{localStorage.removeItem(TP_KEY)}catch(e){}
 if(!snap||!snap.S||!snap.order||Date.now()-snap.order.at>36e5){render();toast('결제 정보를 찾지 못했어요. 처음부터 다시 해 주세요',3200);return}
 /* 신원은 서버 로그인으로만: 결제하던 계정과 지금 로그인한 계정이 같아야 해요 */
 if(!SES.acct||snap.acct!==SES.acct){render();toast('로그인이 끝나서 결제를 이어갈 수 없어요. 다시 로그인한 뒤 확인해 주세요',4200);return}
 Object.keys(snap.S).forEach(k=>{if(k!=='me')S[k]=snap.S[k]});S.me=SES.acct;const o=snap.order;TP_LAST=o;S.screen=o.screen||(o.who==='child'?'c_pay':'pay');S.hist=S.hist||[];render();
 if(S.req&&S.req.rid&&o.kind!=='lesson'){try{watchReq()}catch(e){}}
 if(st==='fail'){const code=q.get('code')||'';if(/CANCEL/.test(code)){toast('결제를 취소했어요');return}
  tpNote('bad','결제가 안 됐어요',esc(q.get('message')||'다시 시도해 주세요')+'<br>돈은 나가지 않았어요.',[['다시 결제하기','tp-retry','','y'],['닫기','tp-close']]);return}
 const b={paymentKey:q.get('paymentKey'),orderId:q.get('orderId'),amount:Number(q.get('amount'))};
 if(!b.paymentKey||b.orderId!==o.orderId||b.amount!==o.amount){tpNote('bad','결제를 멈췄어요','주문 정보가 맞지 않아요. 돈은 나가지 않았어요.',[['다시 결제하기','tp-retry','','y'],['닫기','tp-close']]);return}
 tpNote('spin','결제를 확인하고 있어요','화면을 닫지 말고 잠시만 기다려 주세요');
 const r=await api('/pay/confirm',{...b,kind:o.kind,refId:o.refId},{bearer:true});
 if(!r.ok){console.warn('confirm',r);tpNote('bad','결제가 안 됐어요',esc(errMsg(r))+'<br>승인되지 않아 돈은 나가지 않았어요. 혹시 빠져나갔다면 고객센터(1588-0000)로 알려 주세요.',[['다시 결제하기','tp-retry','','y'],['닫기','tp-close']]);return}
 await (PAY_DONE[o.kind]||PAY_DONE.lesson)(o,r)}
/* 진짜 결제창을 쓰면 결제 수단은 결제창 안에서 골라요 */
const TP_INFO=`<div class="sec">결제 방법</div><div class="card tp-info"><span>${I('card')}</span><span><b>다음 화면에서 골라요</b><small class="muted">카카오페이 · 토스페이 · 네이버페이 · 페이코 · 카드 · 계좌이체</small></span></div>`;
const _scPayT=SC.pay;SC.pay=()=>{const h=_scPayT();return remoteLesson()&&tossOn()?h.replace(/<div class="sec">결제 방법<\/div>[\s\S]*?(?=\n <\/main>)/,TP_INFO):h};
const _scCPay=SC.c_pay;SC.c_pay=()=>{const h=_scCPay();return remoteLesson()&&tossOn()?h.replace(/<div class="sec">결제 방법<\/div>[\s\S]*?(?=\n <button class="link" data-a="c-skip")/,TP_INFO):h};
