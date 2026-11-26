const L = require('./lib'); const { A, sleep, check, shot, BE } = L; const B = BE.B;
const vis = (p, sel) => p.evaluate(s => [...document.querySelectorAll(s)].filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed' && getComputedStyle(e).display !== 'none').length, sel);
const txt = p => p.evaluate(() => document.getElementById('app').innerText);
function netCounter(c) { const n = { fs: 0, worker: 0, urls: [] }; c.on('request', r => { const u = r.url(); if (u.startsWith('https://fakefs.test')) { n.fs++; n.urls.push(u + ' ' + (r.postData() || '').slice(0, 80)); } if (u.includes('workers.dev')) { n.worker++; n.urls.push(u); } }); return n; }
(async () => {
  await L.start('/home/claude/BaepApp/web');

  /* 1. 시연 계정: 외부 호출 0건 */
  for (const [id, scr] of [['baeum', 'home'], ['friend', 'thome'], ['admin', 'admin']]) {
    const { c, p } = await L.ctx('demo-' + id); const n = netCounter(c);
    await p.goto(L.ROOT + '/index.html'); await sleep(900);
    await A(p, 'spl-go'); await p.fill('#lg-id', id); await p.fill('#lg-pw', '1234'); await A(p, 'login'); await sleep(900);
    const s = await L.st(p);
    if (id === 'baeum') { await p.evaluate(() => { S.screen = 'list'; render(); }); await sleep(500); await A(p, 'tutor', 't1'); }
    await sleep(1200);
    check(`demo ${id}: enters ${scr} with 0 Firestore/worker calls`, s.screen === scr && s.me === id && !s.ses.acct && n.fs === 0 && n.worker === 0, { s: s.screen, n });
    if (id === 'admin') await shot(p, 'x1-demo-admin');
    await c.close();
  }

  /* 2. live 모드: 시연 UI 숨김, 시연 계정 없음, 운영자 입구 없음 */
  { const { c, p } = await L.ctx('live', { mode: 'live' });
    await p.goto(L.ROOT + '/index.html'); await sleep(900);
    check('live: html.baep-live', await p.evaluate(() => document.documentElement.classList.contains('baep-live') && window.BAEP_MODE === 'live'));
    await A(p, 'spl-go'); await sleep(300); await shot(p, 'x2-live-login');
    const t = await txt(p);
    check('live: no demo text/buttons on login', !/시연|둘러볼게요|1234/.test(t) && (await vis(p, '.demo-bar,.j-demo,.j-acc,[data-a="ad-enter"],[data-a="demo"]')) === 0, t.slice(0, 300));
    check('live: no operator entry in user app', !/운영자/.test(t) && !(await p.locator('[data-a="ad-enter"]:visible').count()));
    await p.fill('#lg-id', 'baeum'); await p.fill('#lg-pw', '1234'); await A(p, 'login'); await sleep(800);
    const s = await L.st(p);
    check('live: demo account baeum/1234 does not exist', s.screen !== 'home' && !s.me && B.workerCalls.some(x => x.path === '/auth/login' && x.body.id === 'baeum'), s);
    await c.close(); }

  /* 3. demo 모드 사용자 앱: 운영자 입구는 시연 링크만, 운영자 로그인 화면 없음 */
  { const { p, c } = await L.ctx('demo-entry');
    await p.goto(L.ROOT + '/index.html'); await sleep(800); await A(p, 'spl-go');
    check('demo user app: no real operator login form', !(await p.locator('#ad-id').count()));
    await c.close(); }

  /* 4. 안드로이드: app=admin 거부 */
  { const { p, c } = await L.ctx('android', { ua: 'Mozilla/5.0 (Linux; Android 14) BaepApp/1.0' });
    await p.goto(L.ROOT + '/index.html?app=admin'); await sleep(1000);
    const s = await L.st(p);
    check('android: app=admin refused', s.screen !== 'adlogin' && s.screen !== 'admin' && !/app=admin/.test(p.url()), { s: s.screen, url: p.url() });
    await c.close(); }

  /* 5. 카카오 복귀: acct 있음 → 바로 로그인 */
  BE.put('baep_accounts/kakao777', { role: 'mentee', sr: { name: '카카오님' }, createdAt: 1, ownerUids: ['kakao:777'] });
  B.secrets.set('kakao777', { pw: null, role: 'mentee', uids: ['kakao:777'] });
  { const { p, c } = await L.ctx('kakao-acct');
    const payload = BE.b64(JSON.stringify({ provider: 'kakao', token: BE.customToken('kakao:777', { acct: 'kakao777', role: 'mentee', provider: 'kakao' }), name: '카카오님', acct: 'kakao777', role: 'mentee' }));
    await p.goto(L.ROOT + '/index.html#baep_auth=' + payload); await sleep(2000);
    const s = await L.st(p);
    check('kakao return with acct → home', s.screen === 'home' && s.me === 'kakao777' && s.ses.provider === 'kakao' && !/baep_auth/.test(p.url()), { s, url: p.url() });
    await shot(p, 'x3-kakao-acct');
    await c.close(); }

  /* 6. 카카오 복귀: acct 없음 → 역할 고르기 → 가입(/auth/signup Bearer) */
  { const { p, c } = await L.ctx('kakao-new');
    const payload = BE.b64(JSON.stringify({ provider: 'kakao', token: BE.customToken('kakao:888', { provider: 'kakao' }), name: '새카카오', phone: '010-7777-8888' }));
    await p.goto(L.ROOT + '/index.html#baep_auth=' + payload); await sleep(2000);
    let s = await L.st(p);
    check('kakao return without acct → pick role', s.screen === 'pick' && !s.me, s);
    await shot(p, 'x4-kakao-pick');
    await A(p, 'au-role', 'self'); await sleep(300); await shot(p, 'x5-kakao-signup');
    const hasId = await p.locator('#sr-id:visible').count();
    if (hasId) { await p.fill('#sr-id', 'kakaonew1'); }
    if (await p.locator('#sr-name').count()) await p.fill('#sr-name', '새카카오');
    if (await p.locator('#sr-phone').count()) await p.fill('#sr-phone', '010-7777-8888');
    await p.fill('#sr-q', '청명로 21'); await A(p, 'addr-search', 'sr'); await A(p, 'addr-pick', 'sr-0');
    await A(p, 'agree', 'sr-all'); await A(p, 'sr-done'); await sleep(1500);
    s = await L.st(p); const su = (B.signups || []).find(x => x.provider === 'kakao');
    check('kakao signup via Bearer → home', s.screen === 'home' && s.me === 'kakao888' && su && !su.keys.includes('pw') && !!BE.get('baep_users/kakao:888'), { s, su, toast: await L.toastText(p) });
    check('kakao signup: no client baep_users/baep_social writes', !B.writes.some(w => /baep_users|baep_social/.test(w.path)));
    await c.close(); }

  /* 7. ?s= 미리보기 · board.html · 뒤로가기 훅 */
  { const { p, c } = await L.ctx('frame'); const n = netCounter(c);
    await p.goto(L.ROOT + '/index.html?s=home'); await sleep(1200);
    check('?s=home preview renders', await p.evaluate(() => S.screen === 'home' && document.getElementById('app').innerText.length > 50) && n.fs === 0 && n.worker === 0, n);
    await p.goto(L.ROOT + '/board.html'); await sleep(2500);
    check('board.html renders', await p.evaluate(() => document.body.innerText.length > 100));
    await shot(p, 'x6-board');
    await p.goto(L.ROOT + '/index.html'); await sleep(800); await A(p, 'spl-go'); await A(p, 'go', 'pick');
    check('android back hook #app [data-a=back] exists', (await p.locator('#app [data-a=back]').count()) > 0);
    await c.close(); }

  console.log('ERRORS', L.errors);
  const fails = L.results.filter(r => !r.ok).length; console.log(`extra: ${L.results.length - fails} pass, ${fails} fail`);
  require('fs').writeFileSync('/home/claude/v2test/extra-result.json', JSON.stringify({ results: L.results, errors: L.errors }, null, 1));
  await L.stop();
})().catch(async e => { console.error('CRASH', e); console.log('ERRORS', L.errors); await L.stop(); process.exit(1); });
