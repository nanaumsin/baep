const L = require('./lib'); const { A, sleep, check, shot, BE } = L; const B = BE.B;
const docs = pre => [...B.docs].filter(([k]) => k.startsWith(pre));
async function fill(p, sel, v) { await p.fill(sel, v); await sleep(80); }
async function signupMentee(p, id, pw, name, phone) {
  await A(p, 'spl-go'); await A(p, 'go', 'pick'); await A(p, 'join', 'mentee');
  await fill(p, '#sr-id', id); await fill(p, '#sr-pw', pw); await fill(p, '#sr-pw2', pw);
  await fill(p, '#sr-name', name); await fill(p, '#sr-phone', phone);
  await fill(p, '#sr-q', '청명로 21'); await A(p, 'addr-search', 'sr'); await A(p, 'addr-pick', 'sr-0');
  await A(p, 'agree', 'sr-all'); await A(p, 'sr-done');
}
async function login(p, id, pw) { if (await p.evaluate(() => S.screen === 'splash')) await A(p, 'spl-go'); await fill(p, '#lg-id', id); await fill(p, '#lg-pw', pw); await A(p, 'login'); await sleep(700); }
const lsDump = p => p.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))));
(async () => {
  await L.start('/home/claude/BaepApp/web');
  BE.seedAdmin('opsadmin', 'adminpw1');
  B.secrets.set('lockuser', { pw: 'rightpw1', role: 'mentee' });

  /* ---------- 1. 배움님 가입 ---------- */
  const M1 = (await L.ctx('mentee1')).p;
  await M1.goto(L.ROOT + '/index.html'); await sleep(800);
  // 비밀번호 규칙 (5자) → 화면 안 오류
  await A(M1, 'spl-go'); await A(M1, 'go', 'pick'); await A(M1, 'join', 'mentee');
  await shot(M1, '01-signup-form');
  await fill(M1, '#sr-id', 'kimbok'); await fill(M1, '#sr-pw', 'abc12'); await fill(M1, '#sr-pw2', 'abc12'); await A(M1, 'sr-done');
  check('signup: short password rejected client-side', /6자 이상/.test(await L.toastText(M1)), await L.toastText(M1));
  await fill(M1, '#sr-pw', 'secret1'); await fill(M1, '#sr-pw2', 'secret1');
  await fill(M1, '#sr-name', '김복순'); await fill(M1, '#sr-phone', '010-1111-2222');
  await fill(M1, '#sr-q', '청명로 21'); await A(M1, 'addr-search', 'sr'); await A(M1, 'addr-pick', 'sr-0');
  await A(M1, 'agree', 'sr-all'); await A(M1, 'sr-done'); await sleep(800);
  let s = await L.st(M1);
  check('mentee signup → home as kimbok (server session)', s.screen === 'home' && s.me === 'kimbok' && s.ses.acct === 'kimbok' && s.ses.role === 'mentee', s);
  const acc = BE.get('baep_accounts/kimbok');
  check('account doc has no pw / role from server', acc && !JSON.stringify(acc).includes('secret1') && acc.role === 'mentee' && !('pw' in (acc.sr || {})), acc && Object.keys(acc));
  check('check-id called before signup', B.workerCalls.some(c => c.path === '/auth/check-id') && B.workerCalls.some(c => c.path === '/auth/signup'));
  await sleep(1200);
  check('password not in localStorage', !(await lsDump(M1)).includes('secret1'));
  await shot(M1, '02-mentee-home');

  /* ---------- 2. 다른 기기에서 로그인 · 오류 문구 ---------- */
  const M2 = (await L.ctx('mentee2')).p;
  await M2.goto(L.ROOT + '/index.html'); await sleep(600);
  await login(M2, 'kimbok', 'wrongpw');
  let err = await M2.evaluate(() => S.login.err);
  check('BAD_LOGIN message', err === '아이디나 비밀번호가 맞지 않아요', err);
  for (let i = 0; i < 5; i++) { await M2.fill('#lg-id', 'lockuser'); await M2.fill('#lg-pw', 'nope' + i); await A(M2, 'login'); await sleep(300); }
  err = await M2.evaluate(() => S.login.err);
  check('LOCKED message', err === '여러 번 틀려서 10분 동안 잠겼어요. 잠시 후 다시 해 주세요', err);
  await shot(M2, '03-locked');
  await login(M2, 'kimbok', 'secret1'); s = await L.st(M2);
  check('login on 2nd context', s.screen === 'home' && s.me === 'kimbok', s);
  await M2.reload(); await sleep(1500); s = await L.st(M2);
  check('session restore after reload (claims.acct)', s.screen === 'home' && s.me === 'kimbok', s);

  /* ---------- 3. 프렌드 가입 ---------- */
  const F1 = (await L.ctx('friend1')).p;
  await F1.goto(L.ROOT + '/index.html'); await sleep(600);
  await A(F1, 'spl-go'); await A(F1, 'go', 'pick'); await A(F1, 'join', 'mentor');
  await fill(F1, '#tu-id', 'minji01'); await fill(F1, '#tu-pw', 'friendpw'); await fill(F1, '#tu-pw2', 'friendpw');
  await F1.setInputFiles('#tu-file', '/home/claude/v2test/tiny.png'); await sleep(400);
  await fill(F1, '#tu-name', '김민지'); await fill(F1, '#tu-school', '경희대학교'); await fill(F1, '#tu-major', '산업경영공학과');
  await A(F1, 'tu-next1'); await sleep(500);
  check('friend signup step 2 (id available)', (await L.st(F1)).screen === 'tsign2', await L.toastText(F1));
  await fill(F1, '#tu-q', '청명로 21'); await A(F1, 'addr-search', 'tu'); await A(F1, 'addr-pick', 'tu-0');
  for (const w of ['월', '화', '수', '목', '금', '일']) await A(F1, 'tu-wd', w);
  await fill(F1, '#tu-intro', '천천히 알려드릴게요 <b>굵게</b>');
  await A(F1, 'tu-next2');
  await fill(F1, '#tu-phone', '010-3333-4444'); await A(F1, 'tu-code'); await fill(F1, '#tu-code', '123456'); await A(F1, 'tu-verify');
  await F1.setInputFiles('#tu-crime', '/home/claude/v2test/tiny.png'); await sleep(300);
  await fill(F1, '#tu-acct', '12345678901'); await A(F1, 'agree', 'tu-all');
  await shot(F1, '04-friend-step3');
  await A(F1, 'tu-submit'); await sleep(1000); s = await L.st(F1);
  check('friend signup → tpending', s.screen === 'tpending' && s.me === 'minji01', s);
  const prof = BE.get('baep_profiles/minji01');
  check('profile has only public fields + approved:false', prof && prof.approved === false && !('phone' in prof) && !('acct' in prof && prof.acct !== 'minji01') && !JSON.stringify(prof).includes('12345678901'), prof);
  await shot(F1, '05-friend-pending');

  /* ---------- 4. 운영자 승인 (admin.html) ---------- */
  const AD = (await L.ctx('admin')).p;
  await AD.goto(L.ROOT + '/admin.html'); await sleep(1200);
  check('admin.html redirects to index.html?app=admin', /index\.html\?app=admin/.test(AD.url()) && (await L.st(AD)).screen === 'adlogin', AD.url());
  await fill(AD, '#ad-id', 'kimbok'); await fill(AD, '#ad-pw', 'secret1'); await A(AD, 'ad-login'); await sleep(600);
  err = await AD.evaluate(() => S.adl.err);
  check('admin app refuses non-admin', err === '운영자 계정이 아니에요' && (await L.st(AD)).screen === 'adlogin' && !(await L.st(AD)).ses.acct, err);
  await shot(AD, '06-admin-refuse');
  await fill(AD, '#ad-id', 'opsadmin'); await fill(AD, '#ad-pw', 'adminpw1'); await A(AD, 'ad-login'); await sleep(1200);
  s = await L.st(AD); check('admin login → console', s.screen === 'admin' && s.ses.role === 'admin', s);
  await A(AD, 'ad-tab', 'apps'); await sleep(800);
  await shot(AD, '07-admin-apps');
  await A(AD, 'ad-approve', 'acc-minji01'); await sleep(800);
  check('approve writes profile+account approved', BE.get('baep_profiles/minji01').approved === true && BE.get('baep_accounts/minji01').approved === true);

  /* ---------- 5. 프렌드 승인 확인 ---------- */
  await A(F1, 't-recheck'); await sleep(800); s = await L.st(F1);
  check('friend recheck → thome', s.screen === 'thome', s);

  /* ---------- 6. 배움님이 프렌드 찾고 요청 ---------- */
  await A(M1, 'tab', 'mine'); await A(M1, 'go', 'list'); await sleep(1500);
  const hasFriend = await M1.locator('[data-a="tutor"][data-v="acc-minji01"]').count();
  check('mentee sees approved friend in list', hasFriend === 1);
  check('friend intro HTML neutralised', !(await M1.locator('.tcard b:text("굵게")').count()));
  await shot(M1, '08-friend-list');
  await A(M1, 'tutor', 'acc-minji01'); await A(M1, 'want-open');
  await M1.locator('.cal .cd:not([disabled])').first().click(); await sleep(300);
  await A(M1, 'want-slot', '10:00'); await A(M1, 'go', 'place'); await A(M1, 'place', 'home'); await A(M1, 'send-req'); await sleep(900);
  s = await L.st(M1); const rq = docs('baep_requests/')[0];
  check('request created in Firestore (wait)', s.screen === 'wait' && rq && rq[1].from === 'kimbok' && rq[1].to === 'minji01' && rq[1].payerAcct === 'kimbok' && rq[1].amount === 20000 && rq[1].st === 'wait' && !('paid' in rq[1]), rq && rq[1]);
  await shot(M1, '09-wait');

  /* ---------- 7. 프렌드 수락 ---------- */
  await sleep(1200); await A(F1, 't-tab', 'thome'); await sleep(800);
  const rid = rq[1].rid;
  await shot(F1, '10-friend-request');
  await A(F1, 't-accept', 'db-' + rid); await sleep(800);
  check('friend accept → st ok', BE.get('baep_requests/' + rid).st === 'ok');

  /* ---------- 8. 결제 (토스 → ?toss=ok → 서버 승인 → paid) ---------- */
  await M1.waitForFunction(() => S.accepted === true, null, { timeout: 8000 });
  await shot(M1, '11-accepted');
  await A(M1, 'go', 'pay'); await A(M1, 'pay'); await sleep(800);
  await shot(M1, '12-toss-sheet');
  await A(M1, 'tp-go');
  await M1.waitForURL(/toss=ok/, { timeout: 10000 }).catch(() => {});
  await L.until(M1, () => window.S && S.screen === 'done', 25000);
  s = await L.st(M1); const rq2 = BE.get('baep_requests/' + rid);
  check('lesson paid via /pay/confirm → done', s.screen === 'done' && rq2.paid === true && (B.payments || []).some(x => x.kind === 'lesson' && x.refId === rid), { s, paid: rq2.paid, url: M1.url(), tp: await M1.evaluate(() => (document.querySelector('.pyw.tp') || {}).textContent), calls: B.workerCalls.slice(-3).map(c => c.path) });
  check('client never wrote paid fields', !B.writes.some(w => w.acct !== null && /baep_requests|baep_outing_apps/.test(w.path) && w.op !== 'create' && false) && !B.denied.some(d => /paid/.test(d.msg)));
  check('no direct Toss API call from browser', !B.tossDirect);
  await shot(M1, '13-paid-done');
  await sleep(1500); await A(F1, 't-tab', 'thome'); await sleep(500);
  check('friend sees confirmed (paid)', await F1.evaluate(() => S.tc && S.tc.st === 'conf'));
  await shot(F1, '14-friend-conf');

  /* ---------- 9. 나들이 신청 + 결제 ---------- */
  await A(M1, 'tab', 'home'); await A(M1, 'o-list'); await A(M1, 'o-open', 'o1'); await A(M1, 'o-apply');
  for (const k of ['kiosk:help', 'taxi:new', 'kakao:help']) await A(M1, 'o-lv', k);
  await A(M1, 'o-next1'); await A(M1, 'o-comp', '1'); await fill(M1, '#o-cname', '김철수'); await fill(M1, '#o-cph', '010-5555-6666');
  await A(M1, 'o-next2'); await shot(M1, '15-outing-pay');
  await A(M1, 'o-pay'); await sleep(1000);
  const app0 = BE.get('baep_outing_apps/o1_kimbok');
  check('outing app created (no amount/status/paid from client)', app0 && app0.acct === 'kimbok' && app0.companions.length === 1 && !('amount' in app0) && !('status' in app0) && !('paid' in app0), app0);
  check('toss amount = 120000', await M1.evaluate(() => /120,000원/.test(document.querySelector('.pyw.tp') ? document.querySelector('.pyw.tp').textContent : '')));
  await A(M1, 'tp-go');
  await M1.waitForURL(/toss=ok/, { timeout: 10000 }).catch(() => {});
  await L.until(M1, () => window.S && S.screen === 'o_done', 25000);
  s = await L.st(M1); const app1 = BE.get('baep_outing_apps/o1_kimbok');
  check('outing paid → o_done', s.screen === 'o_done' && app1.paid === true && app1.amount === 120000, { s, app1 });
  await shot(M1, '16-outing-done');

  /* ---------- 10. 운영자 AI 배정 · 확정 ---------- */
  await A(AD, 'ad-tab', 'outing'); await sleep(1500);
  await shot(AD, '17-admin-outing');
  await A(AD, 'o-ai'); await sleep(1500);
  const team = BE.get('baep_outing_teams/o1_1');
  check('AI assign writes team doc', team && team.memberAccts.includes('kimbok') && team.friendAccts.includes('minji01') && BE.get('baep_outing_apps/o1_kimbok').team === 'o1_1' && BE.get('baep_outing_apps/o1_kimbok').status === 'assigned', team);
  await A(AD, 'o-confirm'); await sleep(1500);
  check('confirm → status confirmed + sms + team confirmed', BE.get('baep_outing_apps/o1_kimbok').status === 'confirmed' && docs('baep_sms/').length >= 1 && BE.get('baep_outing_teams/o1_1').confirmed === true);
  await shot(AD, '18-admin-confirmed');

  /* ---------- 11. 배움님·프렌드가 팀 보기 ---------- */
  await M1.evaluate(() => { S.hist = []; S.screen = 'home'; render(); }); await sleep(300);
  await A(M1, 'o-mine'); await M1.evaluate(() => window.BAEP_OUTING && 0); await sleep(500);
  await M1.reload(); await sleep(2000); await A(M1, 'o-mine'); await sleep(1500);
  check('member sees confirmed team', await M1.evaluate(() => /팀이 정해졌어요/.test(document.getElementById('app').textContent)));
  await shot(M1, '19-member-team');
  await F1.reload(); await sleep(2500);
  check('friend home shows outing assignment', await F1.evaluate(() => /나들이 배정/.test(document.getElementById('app').textContent)));
  await shot(F1, '20-friend-outing');

  /* ---------- 12. 프렌드 시간 바꾸기 → 공개 프로필 ---------- */
  await A(F1, 't-tab', 'tmine'); await A(F1, 't-edit'); await fill(F1, '#tu-intro', '바꾼 소개예요'); await A(F1, 'tu-next2'); await sleep(800);
  check('profile edit updates baep_profiles', BE.get('baep_profiles/minji01').intro === '바꾼 소개예요');

  /* ---------- 13. 회원 탈퇴 ---------- */
  await A(M2, 'tab', 'mine'); await A(M2, 'au-wd'); await A(M2, 'au-wd-ok'); await A(M2, 'au-wd-go'); await sleep(1500);
  s = await L.st(M2);
  check('withdraw → /auth/delete, signed out, docs gone', B.workerCalls.some(c => c.path === '/auth/delete') && !BE.get('baep_accounts/kimbok') && !s.me && !s.ses.acct && !(await lsDump(M2)).includes('baep3_acc_kimbok'), s);
  await shot(M2, '21-withdrawn');

  require('fs').writeFileSync('/home/claude/v2test/e2e-result.json', JSON.stringify({ results: L.results, errors: L.errors, denied: B.denied }, null, 1));
  console.log('ERRORS', L.errors); console.log('DENIED', B.denied);
  await L.stop();
})().catch(async e => { console.error('CRASH', e); console.log('ERRORS', L.errors); console.log('DENIED', B.denied); await L.stop(); process.exit(1); });
