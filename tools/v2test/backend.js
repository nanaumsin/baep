// 테스트용 가짜 백엔드: Firestore(메모리 + firestore.rules 를 단순하게 흉내) + 워커(ARCH-v2 API) + 토스 SDK
const fs = require('fs');
const path = require('path');
const FAKE_SDK = fs.readFileSync(path.join(__dirname, 'fake-firebase.js'), 'utf8');

const B = { docs: new Map(), log: [], workerCalls: [], writes: [], denied: [], secrets: new Map(), deletedUids: new Set() };
const b64 = s => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = s => Buffer.from(s, 'base64url').toString('utf8');
const now = () => Date.now();
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const ADMIN_IDS = ['opsadmin'];
const RESERVED = ['admin', 'baeum', 'friend', 'demo', 'baep', 'root', 'system', 'test'];
const ID_RE = /^[a-z][a-z0-9]{3,19}$/;
const LESSON = { 60: [20000, 30000], 90: [25000, 40000] };
const OUTING_PRICE = 60000;

function resolveSV(v) { if (v && typeof v === 'object') { if (v.__sv === 'ts') return now(); if (Array.isArray(v)) return v.map(resolveSV); const o = {}; for (const k in v) o[k] = resolveSV(v[k]); return o; } return v; }
function claimsOf(tok) {
  if (!tok || typeof tok !== 'string' || !tok.startsWith('idt.')) return null;
  try { const o = JSON.parse(unb64(tok.slice(4))); if (B.deletedUids.has(o.uid)) return null; return { uid: o.uid, anon: !!o.anon, ...(o.claims || {}) }; } catch (e) { return null; }
}
const customToken = (uid, claims) => 'ct.' + b64(JSON.stringify({ uid, claims }));
const get = p => B.docs.has(p) ? clone(B.docs.get(p)) : null;
const put = (p, d) => B.docs.set(p, clone(d));

// ---------------- 규칙 흉내 (server/firestore.rules v2) ----------------
const changedKeys = (a, b) => { a = a || {}; b = b || {}; const ks = new Set([...Object.keys(a), ...Object.keys(b)]); return [...ks].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])); };
const only = (ch, list) => ch.every(k => list.includes(k));
const any = (ch, list) => ch.some(k => list.includes(k));
const PAY = ['paid', 'paidAt', 'orderId', 'payLock', 'payLockAt'];
const PROFILE_F = ['name', 'school', 'major', 'grade', 'age', 'gender', 'dong', 'road', 'rad', 'intro', 'topics', 'wdays', 'times', 'updatedAt'];
const OUT_SERVER = ['paid', 'paidAt', 'orderId', 'payLock', 'payLockAt', 'amount', 'team', 'status'];
const W = ['일', '월', '화', '수', '목', '금', '토'];
function approvedFriend(acct) { const p = get('baep_profiles/' + acct); return !!(p && p.approved === true); }
function openSlot(d) { const p = get('baep_profiles/' + d.to); if (!p || p.approved !== true) return false; return Number.isInteger(d.day) && d.day >= 1000 && typeof d.time === 'string' && (p.times || []).includes(d.time) && (p.wdays || []).includes(W[(d.day + 4) % 7]); }
function canRead(p, d, c) {
  if (!c) return false; const me = c.acct || null; const member = !!me; const admin = member && c.role === 'admin';
  const [col, id] = p.split('/');
  if (d == null) return true; // 없는 문서 읽기는 테스트에선 허용(앱은 쿼리를 써요)
  switch (col) {
    case 'baep_secrets': return false;
    case 'baep_users': return c.uid === id;
    case 'baep_accounts': return (member && me === id) || admin;
    case 'baep_profiles': return d.approved === true || (member && me === id) || admin;
    case 'baep_requests': return (member && (d.from === me || d.to === me || d.payerAcct === me)) || admin;
    case 'baep_payments': return (member && d.acct === me) || admin;
    case 'baep_outings': return true;
    case 'baep_outing_apps': { if ((member && d.acct === me) || admin) return true; if (member && d.team) { const t = get('baep_outing_teams/' + (typeof d.team === 'string' ? d.team : d.oid + '_' + d.team)); return !!(t && (t.friendAccts || []).includes(me)); } return false; }
    case 'baep_outing_teams': return admin || (member && ((d.memberAccts || []).includes(me) || (d.friendAccts || []).includes(me)));
    case 'baep_sms': return admin;
  }
  return false;
}
function canWrite(op, p, old, nw, c) {
  if (!c) return 'no auth'; const me = c.acct || null; const member = !!me; const admin = member && c.role === 'admin';
  const [col, id] = p.split('/');
  const ch = op === 'create' ? Object.keys(nw) : op === 'delete' ? [] : changedKeys(old, nw);
  const ok = v => v ? null : `${op} ${p} denied (changed: ${ch.join(',')})`;
  switch (col) {
    case 'baep_accounts': if (op !== 'update') return ok(false);
      return ok((member && me === id && !any(ch, ['role', 'approved', 'createdAt', 'ownerUids']) && Object.keys(nw).length <= 300) || (admin && only(ch, ['approved']) && typeof nw.approved === 'boolean'));
    case 'baep_profiles': if (op !== 'update') return ok(false);
      return ok((member && me === id && only(ch, PROFILE_F)) || (admin && only(ch, ['approved']) && typeof nw.approved === 'boolean'));
    case 'baep_requests': {
      if (op === 'create') { const d = nw; return ok(member && c.role === 'mentee' && d.from === me && d.st === 'wait' && !any(Object.keys(d), PAY) && typeof d.to === 'string' && d.to !== me && approvedFriend(d.to) && Number.isInteger(d.amount) && (LESSON[+d.dur] || []).includes(d.amount) && (d.rid === undefined || d.rid === id) && (!d.memo || d.memo.length <= 1000) && (!d.who || d.who.length <= 100) && Object.keys(d).length <= 40); }
      if (op === 'delete') return ok(false);
      if (!member || any(ch, PAY)) return ok(false);
      const friend = old.to === me && only(ch, ['st', 'why', 'updated', 'fdone']) && (nw.st === old.st || (old.st === 'wait' && ['ok', 'no'].includes(nw.st)) || (old.st === 'ok' && nw.st === 'cancel' && old.paid !== true));
      const sender = old.from === me && old.paid !== true && only(ch, ['st', 'inst', 'day', 'time', 'place', 'pk', 'memo', 'updated', 'payerAcct', 'payer']) && (!any(ch, ['day', 'time', 'place', 'pk']) || old.st === 'wait') && (nw.st === old.st || (['wait', 'ok'].includes(old.st) && nw.st === 'cancel') || (old.st === 'wait' && nw.st === 'ok' && nw.inst === true && openSlot(nw)));
      return ok(friend || sender);
    }
    case 'baep_outings': return ok(admin);
    case 'baep_outing_apps': {
      if (op === 'create') return ok(member && nw.acct === me && typeof nw.oid === 'string' && id === nw.oid + '_' + me && !any(Object.keys(nw), OUT_SERVER) && (!nw.companions || nw.companions.length <= 3) && Object.keys(nw).length <= 40);
      if (op === 'delete') return ok(member && old.acct === me && old.paid !== true);
      return ok((member && old.acct === me && !any(ch, OUT_SERVER.concat(['acct', 'oid'])) && (old.paid !== true || !any(ch, ['companions', 'comp'])) && (!nw.companions || nw.companions.length <= 3)) || (admin && only(ch, ['team', 'status'])));
    }
    case 'baep_outing_teams': return ok(admin);
    case 'baep_sms': return ok(admin);
  }
  return ok(false);
}
function fsOp(body) {
  const c = claimsOf(body.token);
  B.log.push({ op: body.op, path: body.path || body.col, acct: c && c.acct });
  if (body.op === 'auth') return {};
  if (body.op === 'get') { const d = get(body.path); if (!canRead(body.path, d, c)) return deny(`get ${body.path}`, c); return { data: d }; }
  if (body.op === 'query') {
    const res = [];
    for (const [p, d] of B.docs) { const [col, id] = p.split('/'); if (col !== body.col) continue;
      const m = (body.filters || []).every(([f, op, v]) => op === '==' ? d[f] === v : op === 'array-contains' ? Array.isArray(d[f]) && d[f].includes(v) : false);
      if (!m) continue; if (!canRead(p, d, c)) return deny(`query ${body.col} ${JSON.stringify(body.filters)} (doc ${id})`, c); res.push({ id, data: clone(d) }); }
    return { docs: res };
  }
  const p = body.path; const old = get(p); let nw; let op;
  if (body.op === 'set') { const data = resolveSV(body.data); nw = body.merge && old ? Object.assign({}, old, data) : data; op = old ? 'update' : 'create'; }
  else if (body.op === 'update') { if (!old) return { error: 'not-found', message: 'no doc ' + p }; nw = Object.assign({}, old, resolveSV(body.data)); op = 'update'; }
  else if (body.op === 'delete') { if (!old) return {}; op = 'delete'; }
  const why = canWrite(op, p, old, nw, c);
  if (why) return deny(why, c);
  B.writes.push({ op, path: p, acct: c && c.acct, data: clone(nw) });
  if (op === 'delete') B.docs.delete(p); else put(p, nw);
  return {};
}
function deny(msg, c) { B.denied.push({ msg, acct: c && c.acct }); return { error: 'permission-denied', message: msg }; }

// ---------------- 가짜 워커 ----------------
function J(status, obj) { return { status, body: JSON.stringify(obj) }; }
const F = (status, code, message, extra) => J(status, Object.assign({ ok: false, code, message }, extra || {}));
const pickProfile = p => { const o = {}; for (const k of PROFILE_F) if (p && p[k] !== undefined && k !== 'updatedAt') o[k] = p[k]; return o; };
function worker(method, url, headers, raw) {
  const u = new URL(url); const p = u.pathname.replace(/\/+$/, '') || '/';
  let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (e) { return F(400, 'BAD_INPUT', '형식'); }
  B.workerCalls.push({ method, path: p, body: Object.assign({}, body, body.pw ? { pw: '***' } : {}) });
  const bearer = (headers['authorization'] || '').replace(/^Bearer\s+/, '');
  if (method === 'GET' && p === '/auth/check-id') { const id = String(u.searchParams.get('id') || '').trim().toLowerCase(); if (!ID_RE.test(id)) return F(400, 'BAD_ID', '아이디 형식'); return J(200, { ok: true, available: !B.secrets.has(id) && !RESERVED.includes(id) && !/^(kakao|naver)/.test(id) && !ADMIN_IDS.includes(id) }); }
  if (method === 'POST' && p === '/auth/login') {
    const id = String(body.id || '').trim().toLowerCase(); const s = B.secrets.get(id);
    if (s && s.lockUntil > now()) return F(429, 'LOCKED', '잠겼어요', { retryAfter: Math.ceil((s.lockUntil - now()) / 1000) });
    if (!s || s.pw !== body.pw) { if (s) { s.fails = (s.fails || 0) + 1; if (s.fails >= 5) { s.lockUntil = now() + 600000; s.fails = 0; return F(429, 'LOCKED', '잠겼어요', { retryAfter: 600 }); } } return F(401, 'BAD_LOGIN', '아이디나 비밀번호가 맞지 않아요'); }
    s.fails = 0; const role = ADMIN_IDS.includes(id) ? 'admin' : s.role;
    return J(200, { ok: true, token: customToken('acct:' + id, { acct: id, role, provider: 'password' }), acct: id, role });
  }
  if (method === 'POST' && p === '/auth/signup') {
    const role = body.role; if (!['mentee', 'mentor'].includes(role)) return F(400, 'BAD_ROLE', '역할');
    if (!body.account || typeof body.account !== 'object') return F(400, 'BAD_INPUT', 'account');
    let id, uid, provider;
    if (bearer) { const c = claimsOf(bearer); if (!c || c.anon) return F(401, 'AUTH_REQUIRED', '로그인'); if (c.acct) return F(409, 'ID_TAKEN', '이미 가입'); uid = c.uid; provider = c.provider || uid.split(':')[0]; id = (provider === 'naver' ? 'naver' : 'kakao') + uid.split(':')[1].replace(/[^a-z0-9]/gi, '').toLowerCase(); if (B.secrets.has(id)) return F(409, 'ID_TAKEN', '이미'); }
    else { id = String(body.id || '').trim().toLowerCase(); if (!ID_RE.test(id) || RESERVED.includes(id) || /^(kakao|naver)/.test(id) || ADMIN_IDS.includes(id)) return F(400, 'BAD_ID', '아이디'); if (typeof body.pw !== 'string' || body.pw.length < 6 || body.pw.length > 64) return F(400, 'BAD_PW', '비번'); if (B.secrets.has(id)) return F(409, 'ID_TAKEN', '이미 있는 아이디'); uid = 'acct:' + id; provider = 'password'; }
    const acc = clone(body.account); for (const k of ['pw', 'pw2', 'role', 'approved', 'createdAt', 'ownerUids', ...PAY]) delete acc[k];
    if (JSON.stringify(acc).includes('"pw"')) B.pwLeak = (B.pwLeak || 0) + 1;
    B.secrets.set(id, { pw: provider === 'password' ? body.pw : null, role, uids: [uid] });
    put('baep_accounts/' + id, Object.assign(acc, { role, createdAt: now(), ownerUids: [uid] }, role === 'mentor' ? { approved: false } : {}));
    if (role === 'mentor') put('baep_profiles/' + id, Object.assign(pickProfile(body.profile), { approved: false, acct: id, updatedAt: now() }));
    if (provider !== 'password') put('baep_users/' + uid, { acct: id, role, provider, createdAt: now() });
    B.signups = (B.signups || []).concat([{ id, role, provider, keys: Object.keys(body) }]);
    return J(200, { ok: true, token: customToken(uid, { acct: id, role, provider }), acct: id, role });
  }
  if (method === 'POST' && p === '/pay/confirm') {
    const c = claimsOf(bearer); if (!c || !c.acct) return F(401, 'AUTH_REQUIRED', '로그인');
    const { paymentKey, orderId, amount, kind, refId } = body;
    if (!paymentKey || !/^[A-Za-z0-9_-]{6,64}$/.test(orderId || '')) return F(400, 'BAD_INPUT', '주문');
    if (!['lesson', 'outing'].includes(kind) || !/^[A-Za-z0-9_-]{1,128}$/.test(refId || '')) return F(400, 'BAD_INPUT', 'kind');
    const tp = (kind === 'lesson' ? 'baep_requests/' : 'baep_outing_apps/') + refId; const d = get(tp);
    if (!d) return F(404, 'REF_NOT_FOUND', '없음');
    if (kind === 'lesson' && d.from !== c.acct && d.payerAcct !== c.acct) return F(403, 'NOT_OWNER', '내 예약만');
    if (kind === 'outing' && d.acct !== c.acct) return F(403, 'NOT_OWNER', '내 신청만');
    if (d.paid === true) return F(409, 'ALREADY_PAID', '이미 결제했어요', { orderId: d.orderId });
    if (kind === 'lesson') { if (d.st !== 'ok') return F(409, 'NOT_PAYABLE', '수락 뒤'); if (d.amount !== amount) return F(400, 'BAD_AMOUNT', '금액'); }
    else { const n = 1 + ((d.companions || []).length); if (amount !== OUTING_PRICE * n) return F(400, 'BAD_AMOUNT', '금액'); }
    const at = now();
    put('baep_payments/' + orderId, { acct: c.acct, kind, refId, amount, method: '간편결제', approvedAt: new Date(at).toISOString(), status: 'DONE', receipt: null, paymentKey, createdAt: at });
    put(tp, Object.assign(d, { paid: true, paidAt: at, orderId, amount }));
    B.payments = (B.payments || []).concat([{ kind, refId, amount, acct: c.acct }]);
    return J(200, { ok: true, orderId, paymentKey, totalAmount: amount, method: '간편결제', easyPay: { provider: '토스페이' }, approvedAt: new Date(at).toISOString(), recorded: true });
  }
  if (method === 'POST' && p === '/auth/delete') {
    const c = claimsOf(bearer); if (!c || c.anon) return F(401, 'AUTH_REQUIRED', '로그인');
    const acct = c.acct; const del = { accounts: 0, profiles: 0, outingApps: 0, requests: 0 };
    if (acct) { if (B.docs.delete('baep_accounts/' + acct)) del.accounts++; if (B.docs.delete('baep_profiles/' + acct)) del.profiles++; B.secrets.delete(acct);
      for (const [k, d] of [...B.docs]) { if (k.startsWith('baep_outing_apps/') && d.acct === acct) { B.docs.delete(k); del.outingApps++; } if (k.startsWith('baep_requests/') && (d.from === acct || d.to === acct) && !d.paid && d.st !== 'ok') { B.docs.delete(k); del.requests++; } if (k.startsWith('baep_users/') && d.acct === acct) B.docs.delete(k); } }
    B.deletedUids.add(c.uid); B.deleted = (B.deleted || []).concat([acct]);
    return J(200, { ok: true, uid: c.uid, acct, deleted: del, kakaoUnlinked: false });
  }
  return F(404, 'NOT_FOUND', '없는 주소');
}

const TOSS_SDK = `window.TossPayments=function(ck){return {widgets:function(o){var amt=0;return {
  setAmount:async function(a){amt=a.value},
  renderPaymentMethods:async function(o){var el=document.querySelector(o.selector);if(el)el.innerHTML='<div class="fake-toss">가짜 토스 결제수단 · '+amt+'원</div>'},
  renderAgreement:async function(o){var el=document.querySelector(o.selector);if(el)el.innerHTML='<div class="fake-toss">약관 동의</div>'},
  requestPayment:async function(r){window.__tossReq=r;var u=r.successUrl+(r.successUrl.indexOf('?')<0?'?':'&')+'paymentKey=pk_test_'+Math.random().toString(36).slice(2,10)+'&orderId='+encodeURIComponent(r.orderId)+'&amount='+amt;setTimeout(function(){location.href=u},50)}}}}};
window.TossPayments.ANONYMOUS='ANON';`;

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
async function install(ctx, opts = {}) {
  await ctx.route(/^https:\/\/www\.gstatic\.com\/firebasejs\//, r => {
    const u = r.request().url(); B.log.push({ op: 'sdk', path: u.split('/').pop() });
    r.fulfill({ status: 200, contentType: 'application/javascript', body: /app-compat/.test(u) ? FAKE_SDK : '/* fake: 이미 app-compat 에 들어 있어요 */' }); });
  await ctx.route('https://fakefs.test/**', async r => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    let out; try { out = fsOp(JSON.parse(r.request().postData() || '{}')); } catch (e) { out = { error: 'internal', message: String(e && e.stack || e) }; }
    r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(out) }); });
  await ctx.route('https://baep.bc0521.workers.dev/**', async r => { const q = r.request(); if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const out = worker(q.method(), q.url(), q.headers(), q.postData());
    r.fulfill({ status: out.status, contentType: 'application/json', headers: CORS, body: out.body }); });
  await ctx.route('https://js.tosspayments.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: TOSS_SDK }));
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route(/^https:\/\/cdnjs\.cloudflare\.com\//, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await ctx.route(/^https:\/\/api\.tosspayments\.com\//, r => { B.tossDirect = (B.tossDirect || 0) + 1; r.abort(); });
}
function seedAdmin(id, pw) { B.secrets.set(id, { pw, role: 'admin', uids: ['acct:' + id] }); put('baep_accounts/' + id, { role: 'admin', createdAt: now(), ownerUids: ['acct:' + id] }); }
module.exports = { B, install, seedAdmin, customToken, get, put, b64 };
