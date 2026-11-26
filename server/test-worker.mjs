/* 배프 서버(worker.js) 자동 점검
   실행:  node test-worker.mjs      (Node 22 이상, 설치할 것 없음)
   카카오·네이버·토스·구글(OAuth·Firestore·Identity Toolkit) 서버는 진짜로 부르지 않고 흉내(mock)만 내요.
   Firestore 는 이 파일 안의 "메모리 가짜 Firestore" 가 REST(batchGet·commit·runQuery)를 흉내 내요. */

import worker from './worker.js';

// 워커가 남기는 기록(console.log)은 시험 결과를 어지럽혀서 숨겨요
const log = console.log;
console.log = () => {};

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const fromB64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const jsonB64u = (o) => b64u(enc.encode(JSON.stringify(o)));
/* 앱(브라우저)에서 #baep_auth 를 푸는 방법과 똑같이 풀어요 (atob + TextDecoder) */
function decodeLikeClient(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* PBKDF2 가 몇 번 돌았는지 세요 (없는 아이디도 똑같이 계산하는지 확인용) */
let deriveCount = 0;
const realDerive = crypto.subtle.deriveBits.bind(crypto.subtle);
crypto.subtle.deriveBits = async (...a) => {
  if (a[0] && a[0].name === 'PBKDF2') deriveCount++;
  return realDerive(...a);
};

/* ---------------- 가짜 키 만들기 ---------------- */
const RSA = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const saKeys = await crypto.subtle.generateKey(RSA, true, ['sign', 'verify']); // 가짜 Firebase 서비스 계정
const googleKeys = await crypto.subtle.generateKey(RSA, true, ['sign', 'verify']); // 가짜 구글 securetoken 키
const otherKeys = await crypto.subtle.generateKey(RSA, true, ['sign', 'verify']); // 엉뚱한 키 (위조 시험)

const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', saKeys.privateKey)).toString('base64');
const pem = '-----BEGIN PRIVATE KEY-----\n' + pkcs8.match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
const PROJECT = 'baep-test';
const SA = {
  type: 'service_account',
  project_id: PROJECT,
  private_key_id: 'abc',
  private_key: pem,
  client_email: 'firebase-adminsdk-x@baep-test.iam.gserviceaccount.com',
};
const googleJwk = { ...(await crypto.subtle.exportKey('jwk', googleKeys.publicKey)), kid: 'gkey1', alg: 'RS256', use: 'sig' };

const WORKER = 'https://baep.test.workers.dev';
const GH = 'https://nanaumsin.github.io';
const APP = 'https://appassets.androidplatform.net';
const baseEnv = {
  TOSS_SECRET_KEY: 'test_gsk_SECRET',
  AUTH_STATE_SECRET: 'super-long-random-state-secret-for-tests-1234567890',
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA),
  KAKAO_REST_KEY: 'kakao-rest-key',
  KAKAO_CLIENT_SECRET: 'kakao-client-secret',
  KAKAO_ADMIN_KEY: 'kakao-admin-key',
  NAVER_CLIENT_ID: 'naver-id',
  NAVER_CLIENT_SECRET: 'naver-secret',
};

/* ================= 가짜 Firestore (메모리) =================
   db: '컬렉션/문서' → {fields(Firestore 형식), createTime, updateTime} */
const FS_ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const FS_API = `https://firestore.googleapis.com/v1/${FS_ROOT}`;
const GTOKEN = 'ya29.fake-access-token';
const db = new Map();
const authUsers = new Set(); // 가짜 Firebase Auth 사용자 uid 목록
let tick = 0;
const stamp = () => new Date(Date.UTC(2026, 10, 26) + ++tick).toISOString().replace('Z', '000Z'); // 매번 다른 updateTime

/* 시험 쪽 변환기 (워커와 따로 만들어서 서로 확인해요) */
function V(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(V) } };
  return { mapValue: { fields: F(v) } };
}
const F = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, V(v)]));
function unV(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(unV);
  if ('mapValue' in v) return unF(v.mapValue.fields || {});
  throw new Error('모르는 값 ' + JSON.stringify(v));
}
const unF = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, unV(v)]));
const eqV = (a, b) => JSON.stringify(unV(a)) === JSON.stringify(unV(b));

function put(path, obj) {
  const t = stamp();
  db.set(path, { fields: F(obj), createTime: t, updateTime: t });
}
const doc = (path) => (db.has(path) ? unF(db.get(path).fields) : null);
const raw = (path) => db.get(path);

const pathOf = (name) => {
  if (!name.startsWith(FS_ROOT + '/')) throw new Error('잘못된 문서 이름 ' + name);
  return name.slice(FS_ROOT.length + 1);
};
const fsErr = (status, code, message) => jsonRes(status, { error: { code: status, status: code, message } });
const docJson = (path, d) => ({ name: FS_ROOT + '/' + path, fields: d.fields, createTime: d.createTime, updateTime: d.updateTime });

function fsBatchGet(body) {
  return jsonRes(
    200,
    body.documents.map((n) => {
      const p = pathOf(n);
      return db.has(p) ? { found: docJson(p, db.get(p)), readTime: stamp() } : { missing: n, readTime: stamp() };
    }),
  );
}
function fsCommit(body) {
  if (mockMode.beforeCommit) {
    const f = mockMode.beforeCommit;
    mockMode.beforeCommit = null; // 한 번만
    f();
  }
  if (mockMode.commitFail) return fsErr(500, 'INTERNAL', 'boom');
  const staged = new Map(db); // 전부 되거나 전부 안 되게: 복사본에 먼저 해 봐요
  const results = [];
  for (const w of body.writes) {
    const name = w.update ? w.update.name : w.delete;
    const p = pathOf(name);
    if (p.split('/').length !== 2) return fsErr(400, 'INVALID_ARGUMENT', 'path');
    const cur = staged.get(p);
    const pre = w.currentDocument;
    if (pre) {
      if (pre.exists === false && cur) return fsErr(409, 'ALREADY_EXISTS', 'Document already exists: ' + name);
      if (pre.exists === true && !cur) return fsErr(404, 'NOT_FOUND', 'No document to update: ' + name);
      if (pre.updateTime && (!cur || cur.updateTime !== pre.updateTime)) return fsErr(400, 'FAILED_PRECONDITION', 'stale');
    }
    if (w.delete) {
      staged.delete(p);
      results.push({ updateTime: stamp() });
      continue;
    }
    let fields;
    if (w.updateMask) {
      fields = { ...((cur && cur.fields) || {}) };
      for (const fp of w.updateMask.fieldPaths) {
        if (fp.includes('.')) throw new Error('가짜 Firestore 는 맨 위 필드만 지원해요: ' + fp);
        if (fp in w.update.fields) fields[fp] = w.update.fields[fp];
        else delete fields[fp];
      }
      for (const k of Object.keys(w.update.fields)) if (!w.updateMask.fieldPaths.includes(k)) return fsErr(400, 'INVALID_ARGUMENT', 'mask');
    } else fields = { ...w.update.fields };
    const transformResults = [];
    for (const t of w.updateTransforms || []) {
      const old = fields[t.fieldPath];
      if (t.increment) {
        const n = (old && 'integerValue' in old ? Number(old.integerValue) : 0) + Number(t.increment.integerValue);
        fields[t.fieldPath] = { integerValue: String(n) };
      } else if (t.removeAllFromArray) {
        const vals = (old && old.arrayValue && old.arrayValue.values) || [];
        fields[t.fieldPath] = { arrayValue: { values: vals.filter((x) => !t.removeAllFromArray.values.some((y) => eqV(x, y))) } };
      } else if (t.appendMissingElements) {
        const vals = (old && old.arrayValue && old.arrayValue.values) || [];
        fields[t.fieldPath] = { arrayValue: { values: [...vals, ...t.appendMissingElements.values.filter((y) => !vals.some((x) => eqV(x, y)))] } };
      } else throw new Error('모르는 transform');
      transformResults.push(fields[t.fieldPath]);
    }
    const ut = stamp();
    staged.set(p, { fields, createTime: cur ? cur.createTime : ut, updateTime: ut });
    results.push(transformResults.length ? { updateTime: ut, transformResults } : { updateTime: ut });
  }
  db.clear();
  for (const [k, v] of staged) db.set(k, v);
  fsStats.commits++;
  return jsonRes(200, { writeResults: results, commitTime: stamp() });
}
function fsRunQuery(body) {
  const q = body.structuredQuery;
  const col = q.from[0].collectionId;
  const ff = q.where.fieldFilter;
  const out = [];
  for (const [p, d] of db) {
    if (p.split('/')[0] !== col) continue;
    const v = d.fields[ff.field.fieldPath];
    if (!v) continue;
    if (ff.op === 'EQUAL' && eqV(v, ff.value)) out.push({ document: docJson(p, d), readTime: stamp() });
    if (ff.op === 'ARRAY_CONTAINS' && v.arrayValue && (v.arrayValue.values || []).some((x) => eqV(x, ff.value))) out.push({ document: docJson(p, d), readTime: stamp() });
  }
  return jsonRes(200, out.length ? out : [{ readTime: stamp() }]);
}
const fsStats = { commits: 0 };

/* ---------------- 가짜 바깥 서버 (fetch 흉내) ---------------- */
let calls = [];
let mockMode = {}; // 시험마다 실패를 흉내 내고 싶을 때
const jsonRes = (status, body, headers) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...(headers || {}) } });

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const headers = new Headers(init.headers || {});
  const body = init.body ? String(init.body) : '';
  calls.push({ url, method: init.method || 'GET', headers, body });
  const u = new URL(url);
  const gAuth = () => headers.get('Authorization') === 'Bearer ' + GTOKEN;
  if (url.startsWith(FS_API + ':')) {
    if (!gAuth()) return fsErr(401, 'UNAUTHENTICATED', 'no token');
    if (mockMode.fsDown) return fsErr(503, 'UNAVAILABLE', 'down');
    const verb = url.slice(FS_API.length + 1);
    const b = JSON.parse(body);
    if (verb === 'batchGet') return fsBatchGet(b);
    if (verb === 'commit') return fsCommit(b);
    if (verb === 'runQuery') return fsRunQuery(b);
  }
  switch (u.origin + u.pathname) {
    case 'https://oauth2.googleapis.com/token': {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return jsonRes(400, { error: 'unsupported_grant_type' });
      const v = await verifyRS256(form.get('assertion'), saKeys.publicKey);
      if (!v.ok || v.payload.aud !== 'https://oauth2.googleapis.com/token' || v.payload.iss !== SA.client_email) return jsonRes(400, { error: 'invalid_grant' });
      return jsonRes(200, { access_token: GTOKEN, expires_in: 3599, token_type: 'Bearer' });
    }
    case `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:delete`: {
      if (!gAuth()) return jsonRes(401, { error: { message: 'UNAUTHENTICATED' } });
      const { localId } = JSON.parse(body);
      if (!authUsers.has(localId)) return jsonRes(400, { error: { code: 400, message: 'USER_NOT_FOUND' } });
      authUsers.delete(localId);
      return jsonRes(200, { kind: 'identitytoolkit#DeleteAccountResponse' });
    }
    case 'https://kauth.kakao.com/oauth/token':
      if (mockMode.kakaoTokenFail) return jsonRes(400, { error: 'invalid_grant', error_code: 'KOE320' });
      return jsonRes(200, { access_token: 'kakao-access', token_type: 'bearer' });
    case 'https://kapi.kakao.com/v2/user/me':
      if (mockMode.kakaoProfileFail) return jsonRes(401, { code: -401 });
      return jsonRes(200, {
        id: 1234567890,
        properties: { nickname: '배프할머니' },
        kakao_account: { profile: { nickname: '김배프' }, email: 'kim@example.com', is_email_valid: true, phone_number: '+82 10-1111-2222' },
      });
    case 'https://nid.naver.com/oauth2.0/token':
      if (mockMode.naverTokenFail) return jsonRes(200, { error: 'invalid_request', error_description: 'no valid data' });
      return jsonRes(200, { access_token: 'naver-access', token_type: 'bearer' });
    case 'https://openapi.naver.com/v1/nid/me':
      return jsonRes(200, {
        resultcode: '00',
        message: 'success',
        response: { id: 'nAvEr_ID-1', nickname: '길동이', name: '홍길동', email: 'hong@naver.com', mobile: '010-1234-5678' },
      });
    case 'https://api.tosspayments.com/v1/payments/confirm': {
      const b = JSON.parse(body);
      if (mockMode.tossFail) return jsonRes(400, { code: 'REJECT_CARD_COMPANY', message: '카드사에서 거절했어요' });
      return jsonRes(200, {
        paymentKey: b.paymentKey,
        orderId: b.orderId,
        totalAmount: b.amount,
        status: 'DONE',
        method: '간편결제',
        easyPay: { provider: '토스페이' },
        approvedAt: '2026-11-26T10:00:00+09:00',
        receipt: { url: 'https://receipt.example/1' },
        secret: 'ps_SHOULD_NOT_LEAK',
      });
    }
    case 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com':
      return jsonRes(200, { keys: [googleJwk] }, { 'Cache-Control': 'public, max-age=20000' });
    case 'https://kapi.kakao.com/v1/user/unlink':
      return jsonRes(200, { id: Number(new URLSearchParams(body).get('target_id')) });
  }
  throw new Error('예상 못한 fetch: ' + url);
};

/* ---------------- 시험 도구 ---------------- */
let pass = 0;
let fail = 0;
const results = [];
async function test(name, fn) {
  calls = [];
  mockMode = {};
  db.clear();
  authUsers.clear();
  try {
    await fn();
    pass++;
    results.push('  ✔ ' + name);
  } catch (e) {
    fail++;
    results.push('  ✘ ' + name + '\n      → ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n        ') : e));
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || '조건이 거짓이에요');
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '값이 달라요') + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}
function call(path, { method = 'GET', headers = {}, body, env = baseEnv } = {}) {
  const req = new Request(WORKER + path, { method, headers, body, redirect: 'manual' });
  return worker.fetch(req, env, { waitUntil() {} });
}
/* JSON 으로 POST 하고 {status, j, res} 를 돌려줘요 */
async function post(path, obj, { headers = {}, env = baseEnv, origin = GH } = {}) {
  const h = { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...headers };
  const res = await call(path, { method: 'POST', headers: h, body: typeof obj === 'string' ? obj : JSON.stringify(obj), env });
  return { status: res.status, j: await res.json(), res };
}
const bearer = (t) => ({ Authorization: 'Bearer ' + t });
function fragmentOf(res) {
  const loc = res.headers.get('Location');
  assert(loc, 'Location 헤더가 없어요');
  const u = new URL(loc);
  return { url: u, hash: u.hash.slice(1), key: u.hash.slice(1).split('=')[0], value: u.hash.slice(1).split('=').slice(1).join('=') };
}
/* /start 를 불러서 state 와 쿠키를 얻어요 */
async function start(provider, ret = GH + '/index.html', env = baseEnv) {
  const res = await call(`/auth/${provider}/start?return=${encodeURIComponent(ret)}`, { env });
  eq(res.status, 302, 'start 는 302');
  const loc = new URL(res.headers.get('Location'));
  const cookie = (res.headers.get('Set-Cookie') || '').split(';')[0];
  return { res, loc, state: loc.searchParams.get('state'), cookie };
}
async function verifyRS256(jwt, publicKey) {
  const [h, p, s] = jwt.split('.');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, fromB64u(s), enc.encode(h + '.' + p));
  return { ok, header: JSON.parse(dec.decode(fromB64u(h))), payload: JSON.parse(dec.decode(fromB64u(p))) };
}
async function makeIdToken({ sub = 'kakao:1234567890', aud = PROJECT, iss = 'https://securetoken.google.com/' + PROJECT, exp, key = googleKeys.privateKey, kid = 'gkey1', claims = {} } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = jsonB64u({ alg: 'RS256', kid, typ: 'JWT' });
  const p = jsonB64u({ iss, aud, sub, user_id: sub, iat: now - 10, exp: exp ?? now + 3600, auth_time: now - 10, ...claims });
  const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(s);
}
/* 가입을 마친 회원의 ID 토큰 (서버가 만든 커스텀 토큰으로 로그인한 것처럼 acct/role claim 이 있어요) */
const memberToken = (acct, role = 'mentee', sub = 'acct:' + acct) => makeIdToken({ sub, claims: { acct, role, provider: 'password' } });
const withNow = async (ms, fn) => {
  const realNow = Date.now;
  Date.now = () => realNow() + ms;
  try {
    return await fn();
  } finally {
    Date.now = realNow;
  }
};
const tossCalls = () => calls.filter((c) => c.url.includes('tosspayments'));

/* =================================================================== */
log('\n배프 서버 점검 시작\n');

/* ---------- 설정 확인 ---------- */
await test('GET / : 설정 상태가 true/false·개수로만 나와요', async () => {
  const res = await call('/', { env: { ...baseEnv, ADMIN_IDS: 'baepadmin, BADID!!, other1 ,' } });
  eq(res.status, 200);
  const j = await res.json();
  eq(j.ok, true);
  eq(j.configured, { toss: true, kakao: true, naver: true, firebase: true, stateSecret: true, kakaoUnlink: true });
  eq(j.firestore, true);
  eq(j.adminIds, 2, '규칙에 맞는 아이디만 셈');
  assert(Array.isArray(j.routes) && j.routes.length > 8, 'routes 목록');
  const text = JSON.stringify(j);
  assert(!text.includes('SECRET') && !text.includes('PRIVATE KEY') && !text.includes('baepadmin'), '비밀값·운영자 아이디가 보이면 안 돼요');
  eq(j.allowedOrigins, [GH, 'https://hohowww12.github.io', APP], '기본 허용 주소');
  const empty = await (await call('/', { env: {} })).json();
  eq(empty.configured, { toss: false, kakao: false, naver: false, firebase: false, stateSecret: false, kakaoUnlink: false });
  eq(empty.firestore, false);
  eq(empty.adminIds, 0);
});

/* ---------- 로그인 시작 ---------- */
await test('카카오 start : 카카오 로그인 주소로 302 + 서명된 state + 쿠키', async () => {
  const { loc, state, cookie, res } = await start('kakao');
  eq(loc.origin + loc.pathname, 'https://kauth.kakao.com/oauth/authorize');
  eq(loc.searchParams.get('client_id'), 'kakao-rest-key');
  eq(loc.searchParams.get('response_type'), 'code');
  eq(loc.searchParams.get('redirect_uri'), WORKER + '/auth/kakao/callback');
  assert(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(state), 'state 는 base64url.서명 모양');
  const data = JSON.parse(dec.decode(fromB64u(state.split('.')[0])));
  eq(data.p, 'kakao');
  eq(data.r, GH + '/index.html');
  assert(data.e - Date.now() / 1000 > 500 && data.e - Date.now() / 1000 <= 600, '약 10분 뒤 만료');
  assert(cookie.startsWith('__Host-baep_oauth=' + data.n), '쿠키에 nonce');
  assert(/Secure/.test(res.headers.get('Set-Cookie')) && /HttpOnly/.test(res.headers.get('Set-Cookie')), '쿠키 보안 속성');
});

await test('네이버 start : 네이버 로그인 주소로 302', async () => {
  const { loc } = await start('naver', APP + '/assets/index.html');
  eq(loc.origin + loc.pathname, 'https://nid.naver.com/oauth2.0/authorize');
  eq(loc.searchParams.get('client_id'), 'naver-id');
  eq(loc.searchParams.get('redirect_uri'), WORKER + '/auth/naver/callback');
  assert(loc.searchParams.get('state'), 'state 있음');
});

await test('허용 안 된 return 주소는 거절 (HTML 안내, 리다이렉트 없음)', async () => {
  for (const bad of ['https://evil.example.com/', 'https://hohowww12.github.io.evil.com/', 'javascript:alert(1)', '', 'http://hohowww12.github.io/']) {
    const res = await call('/auth/kakao/start?return=' + encodeURIComponent(bad));
    eq(res.status, 400, '거절: ' + bad);
    assert(!res.headers.get('Location'), '리다이렉트 없음');
    assert((res.headers.get('Content-Type') || '').includes('text/html'), 'HTML 안내');
  }
  const res = await call('/auth/kakao/start');
  eq(res.status, 400, 'return 없음');
});

await test('ALLOWED_ORIGINS 를 직접 정하면 그 주소만 허용', async () => {
  const env = { ...baseEnv, ALLOWED_ORIGINS: 'https://my.site , http://localhost:8080' };
  const ok = await call('/auth/kakao/start?return=' + encodeURIComponent('http://localhost:8080/index.html'), { env });
  eq(ok.status, 302);
  const no = await call('/auth/kakao/start?return=' + encodeURIComponent(GH + '/'), { env });
  eq(no.status, 400);
});

await test('설정이 빠지면 return#baep_auth_error=config', async () => {
  const env = { ...baseEnv, KAKAO_REST_KEY: '' };
  const res = await call('/auth/kakao/start?return=' + encodeURIComponent(GH + '/'), { env });
  eq(res.status, 302);
  const f = fragmentOf(res);
  eq(f.hash, 'baep_auth_error=config');
  const env2 = { ...baseEnv, FIREBASE_SERVICE_ACCOUNT: '{not json' };
  eq(fragmentOf(await call('/auth/naver/start?return=' + encodeURIComponent(GH + '/'), { env: env2 })).hash, 'baep_auth_error=config');
});

/* ---------- 콜백 ---------- */
await test('카카오 callback : 커스텀 토큰이 진짜 서명 + aud/uid/claims 맞음 + 한글 이름', async () => {
  const ret = GH + '/baep/index.html?x=1';
  const { state, cookie } = await start('kakao', ret);
  const res = await call(`/auth/kakao/callback?code=CODE123&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
  eq(res.status, 302);
  const f = fragmentOf(res);
  eq(f.url.origin + f.url.pathname + f.url.search, ret, '원래 주소로 돌아감');
  eq(f.key, 'baep_auth');
  assert(/^[A-Za-z0-9_-]+$/.test(f.value), 'base64url (패딩 없음)');
  const auth = decodeLikeClient(f.value);
  eq(auth.uid, 'kakao:1234567890');
  eq(auth.provider, 'kakao');
  eq(auth.name, '김배프');
  eq(auth.email, 'kim@example.com');
  eq(auth.phone, '010-1111-2222');
  assert(!('acct' in auth) && !('role' in auth), '가입 전이면 acct/role 없음');
  const v = await verifyRS256(auth.token, saKeys.publicKey);
  assert(v.ok, '서비스 계정 공개키로 서명 확인');
  eq(v.header.alg, 'RS256');
  eq(v.payload.aud, 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
  eq(v.payload.iss, SA.client_email);
  eq(v.payload.sub, SA.client_email);
  eq(v.payload.uid, 'kakao:1234567890');
  eq(v.payload.claims, { provider: 'kakao' });
  eq(v.payload.exp - v.payload.iat, 3600);
  // 카카오 토큰 요청 내용 확인
  const t = calls.find((c) => c.url === 'https://kauth.kakao.com/oauth/token');
  const form = new URLSearchParams(t.body);
  eq(t.method, 'POST');
  eq(form.get('grant_type'), 'authorization_code');
  eq(form.get('client_id'), 'kakao-rest-key');
  eq(form.get('client_secret'), 'kakao-client-secret');
  eq(form.get('redirect_uri'), WORKER + '/auth/kakao/callback');
  eq(form.get('code'), 'CODE123');
  eq(calls.find((c) => c.url.includes('/v2/user/me')).headers.get('Authorization'), 'Bearer kakao-access');
  assert(/Max-Age=0/.test(res.headers.get('Set-Cookie') || ''), '쿠키 지움');
});

await test('callback : 이미 가입한 소셜 사용자면 토큰 claims 와 fragment 에 acct·role', async () => {
  put('baep_users/kakao:1234567890', { acct: 'kakao1234567890', role: 'mentor', provider: 'kakao', createdAt: 1 });
  const { state, cookie } = await start('kakao');
  const res = await call(`/auth/kakao/callback?code=C&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
  const auth = decodeLikeClient(fragmentOf(res).value);
  eq(auth.acct, 'kakao1234567890');
  eq(auth.role, 'mentor');
  const v = await verifyRS256(auth.token, saKeys.publicKey);
  eq(v.payload.claims, { acct: 'kakao1234567890', role: 'mentor', provider: 'kakao' });
  // 연결표에 admin 이 적혀 있어도 소셜 계정은 admin 이 못 돼요
  put('baep_users/kakao:1234567890', { acct: 'kakao1234567890', role: 'admin', provider: 'kakao' });
  const s2 = await start('kakao');
  const a2 = decodeLikeClient(fragmentOf(await call(`/auth/kakao/callback?code=C&state=${encodeURIComponent(s2.state)}`, { headers: { Cookie: s2.cookie } })).value);
  eq(a2.role, 'mentee');
});

await test('callback : Firestore 가 잠시 안 되면 가입 전처럼 로그인은 계속돼요', async () => {
  put('baep_users/kakao:1234567890', { acct: 'kakao1234567890', role: 'mentee' });
  mockMode.fsDown = true;
  const { state, cookie } = await start('kakao');
  const f = fragmentOf(await call(`/auth/kakao/callback?code=C&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } }));
  eq(f.key, 'baep_auth');
  eq(decodeLikeClient(f.value).acct, undefined);
});

await test('카카오 Client Secret 을 안 쓰면 client_secret 을 안 보내요', async () => {
  const env = { ...baseEnv, KAKAO_CLIENT_SECRET: '' };
  const { state, cookie } = await start('kakao', GH + '/', env);
  const res = await call(`/auth/kakao/callback?code=C&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie }, env });
  eq(fragmentOf(res).key, 'baep_auth');
  const form = new URLSearchParams(calls.find((c) => c.url === 'https://kauth.kakao.com/oauth/token').body);
  eq(form.has('client_secret'), false);
});

await test('네이버 callback : 토큰 + 이름/이메일/휴대폰', async () => {
  const { state, cookie } = await start('naver', APP + '/assets/index.html');
  const res = await call(`/auth/naver/callback?code=NCODE&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
  const f = fragmentOf(res);
  eq(f.url.origin, APP);
  eq(f.key, 'baep_auth');
  const auth = decodeLikeClient(f.value);
  eq(auth.uid, 'naver:nAvEr_ID-1');
  eq(auth.provider, 'naver');
  eq(auth.name, '홍길동');
  eq(auth.email, 'hong@naver.com');
  eq(auth.phone, '010-1234-5678');
  const v = await verifyRS256(auth.token, saKeys.publicKey);
  assert(v.ok, '서명 확인');
  eq(v.payload.uid, 'naver:nAvEr_ID-1');
  eq(v.payload.claims, { provider: 'naver' });
  const form = new URLSearchParams(calls.find((c) => c.url === 'https://nid.naver.com/oauth2.0/token').body);
  eq(form.get('client_secret'), 'naver-secret');
  eq(form.get('state'), state);
  eq(form.get('code'), 'NCODE');
});

await test('state 를 고치면(위조) HTML 안내만, 리다이렉트 없음', async () => {
  const { state, cookie } = await start('kakao');
  const [body, sig] = state.split('.');
  const data = JSON.parse(dec.decode(fromB64u(body)));
  const evilBody = jsonB64u({ ...data, r: 'https://evil.example.com/' });
  const flip = (s) => s.slice(0, -2) + (s.at(-2) === 'A' ? 'B' : 'A') + s.at(-1);
  for (const bad of [evilBody + '.' + sig, body + '.' + flip(sig), flip(body) + '.' + sig, body, 'garbage', '']) {
    const res = await call(`/auth/kakao/callback?code=X&state=${encodeURIComponent(bad)}`, { headers: { Cookie: cookie } });
    eq(res.status, 400, '거절');
    assert(!res.headers.get('Location'), '리다이렉트 없음');
    assert((await res.text()).includes('로그인 정보를 확인하지 못했어요'), '한글 안내');
  }
  eq(calls.filter((c) => c.url.includes('oauth/token')).length, 0, '토큰 교환 안 함');
});

await test('다른 키로 서명한 state 도 거절', async () => {
  const { state, cookie } = await start('kakao', GH + '/', { ...baseEnv, AUTH_STATE_SECRET: 'another-secret' });
  const res = await call(`/auth/kakao/callback?code=X&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
  eq(res.status, 400);
});

await test('카카오 state 를 네이버 콜백에 쓰면 거절', async () => {
  const { state, cookie } = await start('kakao');
  const res = await call(`/auth/naver/callback?code=X&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
  eq(res.status, 400);
});

await test('10분 지난 state → #baep_auth_error=state', async () => {
  const { state, cookie } = await start('kakao');
  await withNow(11 * 60 * 1000, async () => {
    const res = await call(`/auth/kakao/callback?code=X&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
    eq(fragmentOf(res).hash, 'baep_auth_error=state');
  });
  eq(calls.filter((c) => c.url.includes('oauth/token')).length, 0, '토큰 교환 안 함');
});

await test('쿠키가 없거나 다르면(다른 브라우저) → #baep_auth_error=state', async () => {
  const { state } = await start('kakao');
  eq(fragmentOf(await call(`/auth/kakao/callback?code=X&state=${encodeURIComponent(state)}`)).hash, 'baep_auth_error=state');
  eq(
    fragmentOf(await call(`/auth/kakao/callback?code=X&state=${encodeURIComponent(state)}`, { headers: { Cookie: '__Host-baep_oauth=other' } })).hash,
    'baep_auth_error=state',
  );
});

await test('사용자가 취소 → #baep_auth_error=cancelled (카카오·네이버)', async () => {
  const k = await start('kakao');
  const r1 = await call(`/auth/kakao/callback?error=access_denied&error_description=User%20denied%20access&state=${encodeURIComponent(k.state)}`, {
    headers: { Cookie: k.cookie },
  });
  eq(fragmentOf(r1).hash, 'baep_auth_error=cancelled');
  const n = await start('naver');
  const r2 = await call(`/auth/naver/callback?error=access_denied&error_description=Canceled+By+User&state=${encodeURIComponent(n.state)}`, {
    headers: { Cookie: n.cookie },
  });
  eq(fragmentOf(r2).hash, 'baep_auth_error=cancelled');
  const r3 = await call(`/auth/kakao/callback?error=server_error&state=${encodeURIComponent(k.state)}`, { headers: { Cookie: k.cookie } });
  eq(fragmentOf(r3).hash, 'baep_auth_error=provider');
});

await test('토큰 교환 실패 → token, 회원정보 실패 → profile (비밀값 노출 없음)', async () => {
  let s = await start('kakao');
  mockMode = { kakaoTokenFail: true };
  let res = await call(`/auth/kakao/callback?code=X&state=${encodeURIComponent(s.state)}`, { headers: { Cookie: s.cookie } });
  eq(fragmentOf(res).hash, 'baep_auth_error=token');
  assert(!res.headers.get('Location').includes('secret'), '비밀값 없음');
  s = await start('kakao');
  mockMode = { kakaoProfileFail: true };
  res = await call(`/auth/kakao/callback?code=X&state=${encodeURIComponent(s.state)}`, { headers: { Cookie: s.cookie } });
  eq(fragmentOf(res).hash, 'baep_auth_error=profile');
  s = await start('naver');
  mockMode = { naverTokenFail: true };
  res = await call(`/auth/naver/callback?code=X&state=${encodeURIComponent(s.state)}`, { headers: { Cookie: s.cookie } });
  eq(fragmentOf(res).hash, 'baep_auth_error=token');
});

/* ---------- 구글 액세스 토큰 ---------- */
await test('구글 OAuth : 서비스 계정 JWT 로 토큰을 받고, 만료 5분 전까지 재사용', async () => {
  await withNow(2 * 3600 * 1000, async () => {
    // 2시간 뒤(앞 시험에서 받은 토큰은 만료) → 새로 받아요
    await call('/auth/check-id?id=newuser1');
    const t = calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token');
    eq(t.length, 1, '한 번 받음');
    const form = new URLSearchParams(t[0].body);
    const v = await verifyRS256(form.get('assertion'), saKeys.publicKey);
    assert(v.ok, '서비스 계정 키로 서명');
    eq(v.payload.iss, SA.client_email);
    eq(v.payload.aud, 'https://oauth2.googleapis.com/token');
    eq(v.payload.scope, 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform');
    eq(v.payload.exp - v.payload.iat, 3600);
    calls = [];
    await call('/auth/check-id?id=newuser2');
    eq(calls.filter((c) => c.url.includes('oauth2.googleapis.com')).length, 0, '재사용');
  });
  await withNow(2 * 3600 * 1000 + 56 * 60 * 1000, async () => {
    calls = [];
    await call('/auth/check-id?id=newuser3');
    eq(calls.filter((c) => c.url.includes('oauth2.googleapis.com')).length, 1, '만료 5분 전이면 새로 받아요');
  });
});

/* ---------- 아이디 확인 ---------- */
await test('check-id : 형식이 틀리면 BAD_ID, 있으면 false, 없으면 true, 예약어는 false', async () => {
  for (const bad of ['', 'abc', '1abcd', 'ab_cd', 'a'.repeat(21), '한글아이디']) {
    const res = await call('/auth/check-id?id=' + encodeURIComponent(bad));
    eq(res.status, 400, bad);
    const j = await res.json();
    eq(j.ok, false);
    eq(j.code, 'BAD_ID');
  }
  eq(await (await call('/auth/check-id?id=grandma1')).json(), { ok: true, available: true });
  put('baep_secrets/grandma1', { pwHash: 'x', salt: 'y' });
  eq(await (await call('/auth/check-id?id=grandma1')).json(), { ok: true, available: false });
  eq((await (await call('/auth/check-id?id=GrandMa1')).json()).available, false, '대문자는 소문자로 바꿔서 봐요');
  for (const r of ['admin', 'baeum', 'friend', 'kakao12345', 'naverabc']) eq((await (await call('/auth/check-id?id=' + r)).json()).available, false, r);
  eq((await (await call('/auth/check-id?id=boss1', { env: { ...baseEnv, ADMIN_IDS: 'boss1' } })).json()).available, false, 'ADMIN_IDS');
});

/* ---------- 가입 ---------- */
const menteeAccount = () => ({
  date: '11월 26일',
  pw: '123456',
  pw2: '123456',
  role: 'admin',
  approved: true,
  paid: true,
  paidAt: 1,
  orderId: 'x',
  createdAt: 0,
  ownerUids: ['evil'],
  admin: true,
  sr: { name: '김복순', phone: '010-1111-2222', pw: '123456', pw2: '123456', agree: [true, true, true], age: 72, score: 1.5, memo: null },
});

await test('가입(아이디/비번) : 문서 4가지 규칙대로 + 금지 필드 버림 + 토큰 claims', async () => {
  deriveCount = 0;
  const { status, j } = await post('/auth/signup', { id: ' Grandma1 ', pw: '123456', role: 'mentee', account: menteeAccount(), profile: { name: 'x' } });
  eq(status, 200);
  eq(j.ok, true);
  eq(j.acct, 'grandma1');
  eq(j.role, 'mentee');
  const v = await verifyRS256(j.token, saKeys.publicKey);
  assert(v.ok, '서명');
  eq(v.payload.uid, 'acct:grandma1');
  eq(v.payload.claims, { acct: 'grandma1', role: 'mentee', provider: 'password' });
  eq(deriveCount, 1, 'PBKDF2 한 번');

  const sec = doc('baep_secrets/grandma1');
  eq(sec.iter, 100000);
  eq(fromB64u(sec.salt).length, 16, 'salt 16바이트');
  eq(fromB64u(sec.pwHash).length, 32, 'SHA-256 해시');
  eq([sec.role, sec.fails, sec.lockUntil, sec.uids], ['mentee', 0, 0, ['acct:grandma1']]);
  assert(Number.isInteger(sec.createdAt) && sec.createdAt > 1.7e12, 'createdAt 은 밀리초 정수');

  const acc = doc('baep_accounts/grandma1');
  for (const k of ['pw', 'pw2', 'approved', 'paid', 'paidAt', 'orderId', 'admin']) assert(!(k in acc), '버려야 해요: ' + k);
  eq(acc.role, 'mentee');
  eq(acc.ownerUids, ['acct:grandma1']);
  assert(acc.createdAt > 1.7e12, 'createdAt 서버 값');
  eq(acc.sr, { name: '김복순', phone: '010-1111-2222', agree: [true, true, true], age: 72, score: 1.5, memo: null }, '안쪽 pw 도 버림');
  // Firestore 값 형식 확인 (정수/소수/불/널/배열/맵)
  const f = raw('baep_accounts/grandma1').fields;
  eq(f.createdAt.integerValue !== undefined, true, '정수는 integerValue');
  eq(f.sr.mapValue.fields.score, { doubleValue: 1.5 });
  eq(f.sr.mapValue.fields.age, { integerValue: '72' });
  eq(f.sr.mapValue.fields.memo, { nullValue: null });
  eq(f.sr.mapValue.fields.agree.arrayValue.values[0], { booleanValue: true });
  assert(!db.has('baep_profiles/grandma1'), '배움님은 공개 프로필 없음');
  assert(![...db.keys()].some((k) => k.startsWith('baep_users/')), '아이디 가입은 baep_users 없음');
  assert(!JSON.stringify(j).includes(sec.pwHash), '응답에 해시 없음');
});

await test('가입(프렌드) : approved:false + 공개 프로필은 허용 필드만', async () => {
  const tu = { name: '김민지', school: '경희대', major: '산업경영', grade: '3학년', age: '22', gender: '여', dong: '영통동', road: '청명로 21', rad: 3, intro: '안녕하세요', topics: ['taxi'], wdays: ['토'], times: ['14:00'], phone: '010-9999-8888', bank: '국민', acct: '12345678', crime: 'file.pdf', pw: 'secret12' };
  const { status, j } = await post('/auth/signup', { id: 'minji22', pw: 'abcdef', role: 'mentor', account: { tu, date: 'x' } });
  eq(status, 200);
  eq(j.role, 'mentor');
  const acc = doc('baep_accounts/minji22');
  eq(acc.approved, false);
  eq(acc.role, 'mentor');
  assert(!('pw' in acc.tu), 'tu.pw 버림');
  const p = doc('baep_profiles/minji22');
  eq(Object.keys(p).sort(), [...'name school major grade age gender dong road rad intro topics wdays times'.split(' '), 'approved', 'acct', 'updatedAt'].sort());
  eq([p.approved, p.acct, p.name, p.times], [false, 'minji22', '김민지', ['14:00']]);
  // profile 을 따로 보내면 그걸 써요 (전화번호 같은 건 버림)
  const r2 = await post('/auth/signup', { id: 'minji23', pw: 'abcdef', role: 'mentor', account: {}, profile: { name: '이수진', phone: '010', approved: true, acct: 'evil' } });
  eq(r2.status, 200);
  eq(doc('baep_profiles/minji23'), { name: '이수진', approved: false, acct: 'minji23', updatedAt: doc('baep_profiles/minji23').updatedAt });
});

await test('가입 : 입력 검사 (BAD_ID·BAD_PW·BAD_ROLE·BAD_INPUT·ID_TAKEN)', async () => {
  const ok = { id: 'goodid1', pw: '123456', role: 'mentee', account: {} };
  const cases = [
    [{ ...ok, id: 'ab' }, 400, 'BAD_ID'],
    [{ ...ok, id: '1abcd' }, 400, 'BAD_ID'],
    [{ ...ok, id: undefined }, 400, 'BAD_ID'],
    [{ ...ok, pw: '12345' }, 400, 'BAD_PW'],
    [{ ...ok, pw: 'x'.repeat(65) }, 400, 'BAD_PW'],
    [{ ...ok, pw: 123456 }, 400, 'BAD_PW'],
    [{ ...ok, role: 'admin' }, 400, 'BAD_ROLE'],
    [{ ...ok, role: undefined }, 400, 'BAD_ROLE'],
    [{ ...ok, account: { memo: 'x'.repeat(2001) } }, 400, 'BAD_INPUT'],
    [{ ...ok, account: { big: Array.from({ length: 30 }, () => 'y'.repeat(1900)) } }, 400, 'BAD_INPUT'],
    [{ ...ok, account: { grid: [[1, 2]] } }, 400, 'BAD_INPUT'],
    [{ ...ok, account: { __name__: 1 } }, 400, 'BAD_INPUT'],
    [{ ...ok, account: 'text' }, 400, 'BAD_INPUT'],
    [{ ...ok, id: 'admin' }, 409, 'ID_TAKEN'],
    [{ ...ok, id: 'kakao12345' }, 409, 'ID_TAKEN'],
  ];
  for (const [body, st, code] of cases) {
    const { status, j } = await post('/auth/signup', body);
    eq([status, j.ok, j.code], [st, false, code], JSON.stringify(body).slice(0, 80));
    assert(typeof j.message === 'string' && /요/.test(j.message), '한국어 해요체 안내');
  }
  eq((await post('/auth/signup', 'not json')).j.code, 'BAD_JSON');
  eq((await post('/auth/signup', { x: 'y'.repeat(70 * 1024) })).j.code, 'BAD_INPUT', '본문이 너무 커요');
  eq((await post('/auth/signup', { ...ok, id: 'boss1' }, { env: { ...baseEnv, ADMIN_IDS: 'boss1' } })).j.code, 'ID_TAKEN', 'ADMIN_IDS 아이디는 가입으로 못 가져요');
  eq((await post('/auth/signup', ok, { origin: 'https://evil.example.com' })).status, 403, '다른 사이트');
  eq(db.size, 0, '실패하면 아무것도 안 만들어요');
  eq((await post('/auth/signup', ok)).status, 200);
  const again = await post('/auth/signup', ok);
  eq([again.status, again.j.code], [409, 'ID_TAKEN']);
});

await test('가입 : 같은 아이디를 동시에 만들면(경쟁) 한쪽만 성공 · 문서가 반쯤 생기지 않아요', async () => {
  // 서버가 commit 하기 직전에 다른 사람이 같은 아이디의 비밀 문서를 먼저 만든 상황
  mockMode.beforeCommit = () => put('baep_secrets/raceid1', { pwHash: 'other', salt: 'other', role: 'mentee' });
  const { status, j } = await post('/auth/signup', { id: 'raceid1', pw: '123456', role: 'mentor', account: { a: 1 } });
  eq([status, j.code], [409, 'ID_TAKEN']);
  assert(!db.has('baep_accounts/raceid1') && !db.has('baep_profiles/raceid1'), '계정·프로필 문서가 안 생겼어요');
  eq(doc('baep_secrets/raceid1').pwHash, 'other', '먼저 만든 사람 것 그대로');
});

await test('소셜 가입 : Bearer(kakao) → kakao<숫자> 아이디, baep_users 연결, 보낸 id 는 무시', async () => {
  const tok = await makeIdToken({ sub: 'kakao:1234567890', claims: { provider: 'kakao' } });
  const { status, j } = await post('/auth/signup', { id: 'hacker1', pw: 'whatever', role: 'mentee', account: { sr: { name: '김배프' } } }, { headers: bearer(tok) });
  eq(status, 200);
  eq([j.acct, j.role], ['kakao1234567890', 'mentee']);
  const v = await verifyRS256(j.token, saKeys.publicKey);
  eq(v.payload.uid, 'kakao:1234567890');
  eq(v.payload.claims, { acct: 'kakao1234567890', role: 'mentee', provider: 'kakao' });
  const u = doc('baep_users/kakao:1234567890');
  eq([u.acct, u.role, u.provider], ['kakao1234567890', 'mentee', 'kakao']);
  eq(doc('baep_accounts/kakao1234567890').ownerUids, ['kakao:1234567890']);
  const sec = doc('baep_secrets/kakao1234567890');
  eq([sec.pwHash, sec.uids], ['', ['kakao:1234567890']], '소셜 계정은 비밀번호 없음');
  assert(!db.has('baep_accounts/hacker1'), '보낸 id 무시');
  // 비밀번호 로그인으로는 못 들어가요
  eq((await post('/auth/login', { id: 'kakao1234567890', pw: 'whatever' })).j.code, 'BAD_LOGIN');
  // 다시 불러도 같은 계정 (역할을 바꿔 보내도 처음 것)
  const commits = fsStats.commits;
  const again = await post('/auth/signup', { role: 'mentor', account: {} }, { headers: bearer(tok) });
  eq([again.status, again.j.acct, again.j.role], [200, 'kakao1234567890', 'mentee']);
  eq(fsStats.commits, commits, '새로 쓰지 않음');
});

await test('소셜 가입 : 네이버 아이디 만들기 (영숫자만, 길거나 이상하면 해시)', async () => {
  const r1 = await post('/auth/signup', { role: 'mentor', account: {}, profile: { name: '홍길동' } }, { headers: bearer(await makeIdToken({ sub: 'naver:nAvEr_ID-1' })) });
  eq([r1.status, r1.j.acct, r1.j.role], [200, 'navernaverid1', 'mentor']);
  eq(doc('baep_profiles/navernaverid1').approved, false);
  const longUid = 'naver:' + 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  const r2 = await post('/auth/signup', { role: 'mentee', account: {} }, { headers: bearer(await makeIdToken({ sub: longUid })) });
  const hex = Buffer.from(await crypto.subtle.digest('SHA-256', enc.encode(longUid))).toString('hex');
  eq(r2.j.acct, 'naver' + hex.slice(0, 15));
  assert(/^[a-z][a-z0-9]{3,19}$/.test(r2.j.acct), '아이디 규칙');
  const r3 = await post('/auth/signup', { role: 'mentee', account: {} }, { headers: bearer(await makeIdToken({ sub: 'naver:___' })) });
  assert(/^naver[0-9a-f]{15}$/.test(r3.j.acct), '영숫자가 없으면 해시');
  // 대소문자만 다른 다른 사람(naver:NaVeR_iD-1)이 이미 navernaverid1 을 쓰고 있으면 해시 아이디로
  const r4 = await post('/auth/signup', { role: 'mentee', account: {} }, { headers: bearer(await makeIdToken({ sub: 'naver:NaVeR_iD-1' })) });
  const hex4 = Buffer.from(await crypto.subtle.digest('SHA-256', enc.encode('naver:NaVeR_iD-1'))).toString('hex');
  eq([r4.status, r4.j.acct], [200, 'naver' + hex4.slice(0, 15)]);
  eq(doc('baep_users/naver:nAvEr_ID-1').acct, 'navernaverid1', '먼저 가입한 사람은 그대로');
});

await test('소셜 가입 : 동시에 두 번 눌러도 먼저 된 계정을 돌려줘요', async () => {
  const tok = await makeIdToken({ sub: 'kakao:777' });
  mockMode.beforeCommit = () => {
    put('baep_users/kakao:777', { acct: 'kakao777', role: 'mentor', provider: 'kakao' });
    put('baep_secrets/kakao777', { pwHash: '', role: 'mentor' });
  };
  const { status, j } = await post('/auth/signup', { role: 'mentee', account: {} }, { headers: bearer(tok) });
  eq([status, j.acct, j.role], [200, 'kakao777', 'mentor']);
});

await test('소셜 가입 : 소셜이 아닌 토큰·가짜 토큰은 401', async () => {
  for (const sub of ['acct:someone', 'AnonUid123', 'kakao:', 'line:123']) {
    const { status, j } = await post('/auth/signup', { role: 'mentee', account: {} }, { headers: bearer(await makeIdToken({ sub })) });
    eq([status, j.code], [401, 'BAD_TOKEN'], sub);
  }
  eq((await post('/auth/signup', { role: 'mentee' }, { headers: bearer(await makeIdToken({ key: otherKeys.privateKey })) })).status, 401);
  eq(db.size, 0);
});

/* ---------- 로그인 ---------- */
async function signupPw(id, pw = '123456', role = 'mentee', env = baseEnv) {
  const r = await post('/auth/signup', { id, pw, role, account: {} }, { env });
  eq(r.status, 200, 'signup ' + id);
}

await test('로그인 : 맞으면 토큰(acct:<아이디>, claims) · 대문자/공백 아이디도 돼요', async () => {
  await signupPw('grandpa7', '7777aa', 'mentor');
  const { status, j } = await post('/auth/login', { id: ' GrandPa7', pw: '7777aa' });
  eq(status, 200);
  eq([j.ok, j.acct, j.role], [true, 'grandpa7', 'mentor']);
  const v = await verifyRS256(j.token, saKeys.publicKey);
  eq(v.payload.uid, 'acct:grandpa7');
  eq(v.payload.claims, { acct: 'grandpa7', role: 'mentor', provider: 'password' });
  assert(!JSON.stringify(j).includes(doc('baep_secrets/grandpa7').pwHash), '해시 노출 없음');
});

await test('로그인 : 없는 아이디와 틀린 비밀번호는 똑같이 BAD_LOGIN (없는 아이디도 PBKDF2 계산)', async () => {
  await signupPw('grandpa7');
  deriveCount = 0;
  const a = await post('/auth/login', { id: 'grandpa7', pw: 'wrong-pw' });
  eq(deriveCount, 1);
  const b = await post('/auth/login', { id: 'nobody99', pw: 'wrong-pw' });
  eq(deriveCount, 2, '없는 아이디도 한 번 계산');
  eq([a.status, b.status], [401, 401]);
  eq(a.j, b.j, '응답이 완전히 같아요');
  eq(a.j.code, 'BAD_LOGIN');
  eq((await post('/auth/login', { id: 'x', pw: '' })).j.code, 'BAD_LOGIN');
  eq((await post('/auth/login', { id: 'grandpa7', pw: 'x'.repeat(5000) })).j.code, 'BAD_LOGIN', '너무 긴 비밀번호');
  eq((await post('/auth/login', 'nope')).j.code, 'BAD_JSON');
  eq((await post('/auth/login', { id: 'grandpa7', pw: '123456' }, { origin: 'https://evil.example.com' })).status, 403);
});

await test('로그인 : 5번 틀리면 10분 잠금(LOCKED 429) → 맞는 비번도 거절 → 10분 뒤 풀림', async () => {
  await signupPw('lockme1', 'right-pw');
  for (let i = 1; i <= 4; i++) {
    const r = await post('/auth/login', { id: 'lockme1', pw: 'bad' + i });
    eq([r.status, r.j.code], [401, 'BAD_LOGIN'], i + '번째');
    eq(doc('baep_secrets/lockme1').fails, i, '틀린 횟수 +1');
  }
  const fifth = await post('/auth/login', { id: 'lockme1', pw: 'bad5' });
  eq([fifth.status, fifth.j.code], [429, 'LOCKED']);
  eq(fifth.res.headers.get('Retry-After'), '600');
  const s = doc('baep_secrets/lockme1');
  assert(s.lockUntil - Date.now() > 590000 && s.lockUntil - Date.now() <= 600000, 'lockUntil = 지금+10분');
  deriveCount = 0;
  const still = await post('/auth/login', { id: 'lockme1', pw: 'right-pw' });
  eq([still.status, still.j.code], [429, 'LOCKED'], '잠긴 동안은 맞아도 거절');
  eq(deriveCount, 0, '잠긴 동안은 비밀번호를 계산하지도 않아요');
  await withNow(9 * 60 * 1000, async () => eq((await post('/auth/login', { id: 'lockme1', pw: 'right-pw' })).status, 429, '9분 뒤도 잠김'));
  await withNow(10 * 60 * 1000 + 1000, async () => {
    const r = await post('/auth/login', { id: 'lockme1', pw: 'right-pw' });
    eq([r.status, r.j.acct], [200, 'lockme1'], '10분 뒤 풀림');
  });
  const after = doc('baep_secrets/lockme1');
  eq([after.fails, after.lockUntil], [0, 0], '성공하면 초기화');
});

await test('로그인 : 중간에 성공하면 틀린 횟수가 0 으로', async () => {
  await signupPw('reset01', 'right-pw');
  await post('/auth/login', { id: 'reset01', pw: 'x1' });
  await post('/auth/login', { id: 'reset01', pw: 'x2' });
  eq(doc('baep_secrets/reset01').fails, 2);
  eq((await post('/auth/login', { id: 'reset01', pw: 'right-pw' })).status, 200);
  eq(doc('baep_secrets/reset01').fails, 0);
});

await test('운영자 : ADMIN_IDS 계정은 로그인 때만 role admin (가입 응답·소셜은 아님)', async () => {
  await signupPw('baepadmin', 'admin-pw-1'); // 먼저 가입하고
  const env = { ...baseEnv, ADMIN_IDS: 'someone, BaepAdmin' }; // 그다음 ADMIN_IDS 에 넣어요
  const { status, j } = await post('/auth/login', { id: 'baepadmin', pw: 'admin-pw-1' }, { env });
  eq([status, j.role], [200, 'admin']);
  eq((await verifyRS256(j.token, saKeys.publicKey)).payload.claims, { acct: 'baepadmin', role: 'admin', provider: 'password' });
  eq(doc('baep_accounts/baepadmin').role, 'mentee', '계정 문서는 그대로');
  eq((await post('/auth/login', { id: 'baepadmin', pw: 'admin-pw-1' })).j.role, 'mentee', 'ADMIN_IDS 에서 빼면 바로 일반 회원');
});

/* ---------- 결제 승인 ---------- */
const payBody = (amount, extra = {}) => ({ paymentKey: 'tgen_20261125abcdef', orderId: 'baep-ORDER_123456', amount, kind: 'lesson', refId: 'r1', ...extra });
const seedLesson = (data = {}) => put('baep_requests/r1', { rid: 'r1', from: 'mom1', to: 'frnd1', st: 'ok', dur: 60, amount: 20000, who: '김복순', ...data });

await test('결제 OPTIONS(사전 요청) : 허용된 앱 주소를 그대로 돌려줘요', async () => {
  const res = await call('/pay/confirm', { method: 'OPTIONS', headers: { Origin: APP, 'Access-Control-Request-Method': 'POST' } });
  eq(res.status, 204);
  eq(res.headers.get('Access-Control-Allow-Origin'), APP);
  assert(/Content-Type/.test(res.headers.get('Access-Control-Allow-Headers')), 'Content-Type 허용');
  assert(/Authorization/.test(res.headers.get('Access-Control-Allow-Headers')), 'Authorization 허용');
  const bad = await call('/pay/confirm', { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com' } });
  eq(bad.headers.get('Access-Control-Allow-Origin'), null);
});

await test('결제 : 다른 사이트(Origin)에서 오면 403', async () => {
  for (const origin of ['https://evil.example.com', null]) {
    const { status, j } = await post('/pay/confirm', payBody(20000), { origin, headers: bearer(await memberToken('mom1')) });
    eq([status, j.code], [403, 'ORIGIN']);
  }
  eq(tossCalls().length, 0, '토스를 부르지 않음');
});

await test('결제 : 로그인(Bearer) 없으면 401 AUTH_REQUIRED (/pay/confirm 과 예전 / 둘 다)', async () => {
  seedLesson();
  for (const path of ['/pay/confirm', '/']) {
    const { status, j } = await post(path, payBody(20000));
    eq([status, j.ok, j.code], [401, false, 'AUTH_REQUIRED'], path);
  }
  // 가입 전 소셜 사용자·익명 토큰(acct 없음)도 안 돼요
  for (const tok of [await makeIdToken({ sub: 'kakao:1' }), await makeIdToken({ sub: 'AnonUid' })]) {
    const { status, j } = await post('/pay/confirm', payBody(20000), { headers: bearer(tok) });
    eq([status, j.code], [401, 'AUTH_REQUIRED']);
  }
  const forged = await post('/pay/confirm', payBody(20000), { headers: bearer(await makeIdToken({ key: otherKeys.privateKey, claims: { acct: 'mom1' } })) });
  eq([forged.status, forged.j.code], [401, 'BAD_TOKEN']);
  eq(tossCalls().length, 0);
  eq(doc('baep_requests/r1').paid, undefined);
});

await test('결제 : 금액표에 없는 금액·이상한 주문은 400', async () => {
  const h = { headers: bearer(await memberToken('mom1')) };
  for (const amt of [100, 19999, 50000, '20000원', '20000', null, 20000.5]) {
    const { status, j } = await post('/pay/confirm', payBody(amt), h);
    eq([status, j.code, j.message], [400, 'BAD_AMOUNT', '결제 금액이 수업료와 달라요'], String(amt));
  }
  eq((await post('/pay/confirm', 'not json', h)).j.code, 'BAD_JSON');
  eq((await post('/pay/confirm', payBody(20000, { orderId: 'a b' }), h)).j.code, 'BAD_ORDER');
  eq((await post('/pay/confirm', payBody(20000, { kind: 'gift' }), h)).j.code, 'BAD_ORDER');
  eq((await post('/pay/confirm', payBody(20000, { refId: '../baep_secrets/x' }), h)).j.code, 'BAD_ORDER', '경로 끼워넣기 막기');
  eq((await post('/pay/confirm', payBody(20000, { refId: undefined }), h)).j.code, 'BAD_ORDER');
  eq(tossCalls().length, 0, '토스를 부르지 않음');
});

await test('결제(수업) : 정상 → 토스 승인 → baep_payments 기록 + 요청 문서 paid', async () => {
  for (const [path, amt, dur, origin] of [
    ['/pay/confirm', 20000, 60, GH],
    ['/pay/confirm', 25000, 90, APP],
    ['/', 30000, 60, GH],
    ['/pay/confirm', 40000, 90, APP],
  ]) {
    db.clear();
    calls = [];
    seedLesson({ amount: amt, dur });
    const { status, j, res } = await post(path, payBody(amt), { origin, headers: bearer(await memberToken('mom1')) });
    eq(status, 200, `${path} ${amt}`);
    eq(res.headers.get('Access-Control-Allow-Origin'), origin);
    eq([j.ok, j.totalAmount, j.status, j.recorded], [true, amt, 'DONE', true]);
    assert(!('secret' in j), 'secret 은 빼고 돌려줘요');
    const t = tossCalls()[0];
    eq(t.headers.get('Authorization'), 'Basic ' + btoa('test_gsk_SECRET:'));
    eq(t.headers.get('Idempotency-Key'), 'baep-ORDER_123456');
    eq(JSON.parse(t.body), { paymentKey: 'tgen_20261125abcdef', orderId: 'baep-ORDER_123456', amount: amt });
    const p = doc('baep_payments/baep-ORDER_123456');
    eq(
      [p.acct, p.kind, p.refId, p.amount, p.method, p.approvedAt, p.status, p.receipt, p.paymentKey],
      ['mom1', 'lesson', 'r1', amt, '토스페이', '2026-11-26T10:00:00+09:00', 'DONE', 'https://receipt.example/1', 'tgen_20261125abcdef'],
    );
    const r = doc('baep_requests/r1');
    eq([r.paid, r.orderId, r.amount, r.st, r.who], [true, 'baep-ORDER_123456', amt, 'ok', '김복순']);
    assert(Number.isInteger(r.paidAt) && r.paidAt > 1.7e12, 'paidAt 밀리초 정수');
    assert(!('payLock' in r) && !('payLockAt' in r), '결제 중 표시는 지워요');
  }
});

await test('결제(수업) : 자녀(payerAcct)도 결제할 수 있어요', async () => {
  seedLesson({ payerAcct: 'son1' });
  const { status, j } = await post('/pay/confirm', payBody(20000), { headers: bearer(await memberToken('son1')) });
  eq([status, j.ok], [200, true]);
  eq(doc('baep_payments/baep-ORDER_123456').acct, 'son1');
});

await test('결제(수업) : 남의 요청 403 · 수락 전 409 · 금액 다름 400 · 없는 요청 404 (토스 안 부름)', async () => {
  const mom = { headers: bearer(await memberToken('mom1')) };
  seedLesson();
  let r = await post('/pay/confirm', payBody(20000), { headers: bearer(await memberToken('stranger1')) });
  eq([r.status, r.j.code], [403, 'NOT_OWNER']);
  r = await post('/pay/confirm', payBody(20000), { headers: bearer(await memberToken('frnd1', 'mentor')) });
  eq([r.status, r.j.code], [403, 'NOT_OWNER'], '받은 프렌드도 결제자가 아니에요');
  for (const st of ['wait', 'no', 'cancel']) {
    seedLesson({ st });
    r = await post('/pay/confirm', payBody(20000), mom);
    eq([r.status, r.j.code], [409, 'NOT_PAYABLE'], st);
  }
  seedLesson({ amount: 25000, dur: 90 });
  r = await post('/pay/confirm', payBody(20000), mom);
  eq([r.status, r.j.code], [400, 'BAD_AMOUNT'], '문서 금액과 다름');
  seedLesson({ amount: undefined });
  r = await post('/pay/confirm', payBody(20000), mom);
  eq([r.status, r.j.code], [400, 'BAD_AMOUNT'], '문서에 금액이 없음');
  seedLesson();
  r = await post('/pay/confirm', payBody(60000), mom);
  eq([r.status, r.j.code], [400, 'BAD_AMOUNT'], '수업에 나들이 금액');
  r = await post('/pay/confirm', payBody(20000, { refId: 'nothere' }), mom);
  eq([r.status, r.j.code], [404, 'REF_NOT_FOUND']);
  eq(tossCalls().length, 0);
  assert(!db.has('baep_payments/baep-ORDER_123456'));
  assert(!('payLock' in doc('baep_requests/r1')), '잠금 표시 없음');
});

await test('결제 : 이미 결제된 것은 409 ALREADY_PAID (같은 주문번호 기록이 있어도)', async () => {
  const mom = { headers: bearer(await memberToken('mom1')) };
  seedLesson({ paid: true, orderId: 'old-order-1' });
  let r = await post('/pay/confirm', payBody(20000), mom);
  eq([r.status, r.j.code, r.j.orderId], [409, 'ALREADY_PAID', 'old-order-1']);
  seedLesson();
  put('baep_payments/baep-ORDER_123456', { acct: 'mom1', refId: 'r0' });
  r = await post('/pay/confirm', payBody(20000), mom);
  eq([r.status, r.j.code], [409, 'ALREADY_PAID']);
  eq(tossCalls().length, 0);
  // 정상 결제 뒤 다시 보내도 409
  db.clear();
  seedLesson();
  eq((await post('/pay/confirm', payBody(20000), mom)).status, 200);
  r = await post('/pay/confirm', payBody(20000), mom);
  eq([r.status, r.j.code], [409, 'ALREADY_PAID']);
  eq(tossCalls().length, 1, '토스는 한 번만');
});

await test('결제 : 다른 창에서 결제 중이면 409 PAY_IN_PROGRESS (2분 지나면 풀림)', async () => {
  const mom = { headers: bearer(await memberToken('mom1')) };
  seedLesson({ payLock: 'other-order-9', payLockAt: Date.now() - 1000 });
  let r = await post('/pay/confirm', payBody(20000), mom);
  eq([r.status, r.j.code], [409, 'PAY_IN_PROGRESS']);
  eq(tossCalls().length, 0);
  seedLesson({ payLock: 'other-order-9', payLockAt: Date.now() - 3 * 60 * 1000 });
  eq((await post('/pay/confirm', payBody(20000), mom)).status, 200, '오래된 잠금은 무시');
  // 확인한 뒤 그 사이에 문서가 바뀌면(동시 결제) 잠금이 실패해요
  db.clear();
  seedLesson();
  calls = [];
  mockMode.beforeCommit = () => seedLesson({ memo: '그 사이 바뀜' });
  r = await post('/pay/confirm', payBody(20000), mom);
  eq([r.status, r.j.code], [409, 'PAY_IN_PROGRESS']);
  eq(tossCalls().length, 0);
});

await test('결제 : 토스가 거절하면 그 오류를 돌려주고, 문서는 결제 안 됨 + 잠금 풀림', async () => {
  seedLesson();
  mockMode.tossFail = true;
  const { status, j } = await post('/pay/confirm', payBody(20000), { headers: bearer(await memberToken('mom1')) });
  eq([status, j.ok, j.code, j.message], [400, false, 'REJECT_CARD_COMPANY', '카드사에서 거절했어요']);
  const r = doc('baep_requests/r1');
  assert(!r.paid && !('payLock' in r), '결제 안 됨 · 잠금 풀림');
  assert(!db.has('baep_payments/baep-ORDER_123456'));
});

await test('결제 : 승인은 됐는데 기록이 실패하면 ok:true + recorded:false (운영자 확인용)', async () => {
  seedLesson();
  // 잠금 commit 은 되고, 그 뒤 기록 commit 두 번은 실패
  mockMode.beforeCommit = () => {
    mockMode.beforeCommit = () => {
      mockMode.commitFail = true;
    };
  };
  const { status, j } = await post('/pay/confirm', payBody(20000), { headers: bearer(await memberToken('mom1')) });
  eq([status, j.ok, j.recorded], [200, true, false]);
});

await test('결제(나들이) : 금액 = 60,000 × (1+동반자) · 본인 신청만', async () => {
  const body = (amount) => payBody(amount, { kind: 'outing', refId: 'o1_mom1', orderId: 'baep-OUT_000001' });
  const mom = { headers: bearer(await memberToken('mom1')) };
  put('baep_outing_apps/o1_mom1', { acct: 'mom1', oid: 'o1', companions: [{ name: '이순자' }] });
  let r = await post('/pay/confirm', body(60000), mom);
  eq([r.status, r.j.code], [400, 'BAD_AMOUNT'], '동반자 1명이면 2인 요금');
  r = await post('/pay/confirm', body(120000), { headers: bearer(await memberToken('other1')) });
  eq([r.status, r.j.code], [403, 'NOT_OWNER']);
  r = await post('/pay/confirm', body(120000), mom);
  eq([r.status, r.j.ok], [200, true]);
  const a = doc('baep_outing_apps/o1_mom1');
  eq([a.paid, a.orderId, a.amount], [true, 'baep-OUT_000001', 120000]);
  eq(doc('baep_payments/baep-OUT_000001').kind, 'outing');
  // 혼자, 예전 모양(comp 하나)
  put('baep_outing_apps/o2_mom1', { acct: 'mom1', oid: 'o2' });
  eq((await post('/pay/confirm', payBody(60000, { kind: 'outing', refId: 'o2_mom1', orderId: 'baep-OUT_000002' }), mom)).status, 200);
  put('baep_outing_apps/o3_mom1', { acct: 'mom1', oid: 'o3', comp: { name: '남편' } });
  eq((await post('/pay/confirm', payBody(120000, { kind: 'outing', refId: 'o3_mom1', orderId: 'baep-OUT_000003' }), mom)).status, 200);
  put('baep_outing_apps/o4_mom1', { acct: 'mom1', oid: 'o4', companions: [1, 2, 3, 4] });
  eq((await post('/pay/confirm', payBody(240000, { kind: 'outing', refId: 'o4_mom1', orderId: 'baep-OUT_000004' }), mom)).j.code, 'BAD_AMOUNT', '5명은 안 돼요');
});

await test('결제 : 시크릿 키가 없으면 500 NO_KEY / 예전 ALLOWED_ORIGIN 변수도 읽어요', async () => {
  const mom = bearer(await memberToken('mom1'));
  const r = await post('/pay/confirm', payBody(20000), { headers: mom, env: { ...baseEnv, TOSS_SECRET_KEY: '' } });
  eq([r.status, r.j.code], [500, 'NO_KEY']);
  seedLesson();
  const env = { ...baseEnv, ALLOWED_ORIGIN: 'https://old.site' };
  eq((await post('/pay/confirm', payBody(20000), { origin: 'https://old.site', headers: mom, env })).status, 200);
  eq((await post('/pay/confirm', payBody(20000), { origin: GH, headers: mom, env })).status, 403);
});

/* ---------- 탈퇴 ---------- */
function seedMember() {
  put('baep_secrets/mom1', { pwHash: 'h', salt: 's', iter: 100000, role: 'mentee', uids: ['acct:mom1', 'kakao:999'] });
  // ownerUids 에 남의 uid(acct:dad2)가 끼어 있어도(규칙 실수 등) 서버는 연결이 확인된 것만 지워요
  put('baep_accounts/mom1', { role: 'mentee', ownerUids: ['acct:mom1', 'acct:dad2'], sr: { name: '김복순', phone: '010-1111-2222' } });
  put('baep_users/kakao:999', { acct: 'mom1', role: 'mentee', provider: 'kakao' });
  put('baep_requests/rw', { from: 'mom1', to: 'fr1', st: 'wait' });
  put('baep_requests/rn', { from: 'mom1', to: 'fr1', st: 'no' });
  put('baep_requests/rc', { from: 'mom1', to: 'fr1', st: 'cancel' });
  put('baep_requests/rok', { from: 'mom1', to: 'fr1', st: 'ok', who: '김복순', age: 72, area: '영통동', dist: 1.2, memo: '천천히', place: '집', pk: 'home', amount: 20000, day: 20600, time: '14:00' });
  put('baep_requests/rpaid', { from: 'mom1', to: 'fr1', st: 'ok', paid: true, orderId: 'o-1', who: '김복순', phone: '010-1111-2222', address: '수원시', amount: 20000 });
  put('baep_requests/rcpaid', { from: 'mom1', to: 'fr1', st: 'cancel', paid: true, who: '김복순' });
  put('baep_requests/other', { from: 'dad2', to: 'fr1', st: 'wait', who: '박영수' });
  put('baep_outing_apps/o1_mom1', { acct: 'mom1', oid: 'o1' });
  put('baep_outing_apps/o2_mom1', { acct: 'mom1', oid: 'o2', paid: true });
  put('baep_outing_apps/o1_dad2', { acct: 'dad2', oid: 'o1' });
  put('baep_outing_teams/o1_1', { oid: 'o1', memberAccts: ['mom1', 'dad2'], friendAccts: ['fr1'] });
  put('baep_payments/o-1', { acct: 'mom1', kind: 'lesson', refId: 'rpaid', amount: 20000 });
  authUsers.add('acct:mom1');
  authUsers.add('kakao:999');
  authUsers.add('acct:dad2');
}

await test('탈퇴 : 계정 문서·연결·신청 삭제, 수락/결제된 요청은 개인정보만 지움, Auth 계정 삭제, 카카오 끊기', async () => {
  seedMember();
  const tok = await memberToken('mom1');
  const { status, j, res } = await post('/auth/delete', {}, { origin: APP, headers: bearer(tok) });
  eq(status, 200);
  eq(res.headers.get('Access-Control-Allow-Origin'), APP);
  eq([j.ok, j.uid, j.acct, j.kakaoUnlinked], [true, 'acct:mom1', 'mom1', true]);
  eq(j.deleted, { accounts: 1, secrets: 1, profiles: 0, users: 1, outingApps: 2, requests: 3, requestsScrubbed: 3, teams: 1, authUsers: 2 });
  for (const p of ['baep_secrets/mom1', 'baep_accounts/mom1', 'baep_users/kakao:999', 'baep_requests/rw', 'baep_requests/rn', 'baep_requests/rc', 'baep_outing_apps/o1_mom1', 'baep_outing_apps/o2_mom1']) {
    assert(!db.has(p), '지워져야 해요: ' + p);
  }
  const ok = doc('baep_requests/rok');
  eq([ok.who, ok.fromName, ok.scrubbed, ok.from, ok.amount, ok.day, ok.time, ok.pk], ['탈퇴한 회원', '탈퇴한 회원', true, 'mom1', 20000, 20600, '14:00', 'home']);
  for (const k of ['age', 'area', 'dist', 'memo', 'place']) assert(!(k in ok), '개인정보 지움: ' + k);
  const paid = doc('baep_requests/rpaid');
  eq([paid.paid, paid.orderId, paid.who], [true, 'o-1', '탈퇴한 회원']);
  assert(!('phone' in paid) && !('address' in paid), '연락처·주소 지움');
  eq(doc('baep_requests/rcpaid').who, '탈퇴한 회원', '결제된 건 취소돼도 기록으로 남김');
  eq(doc('baep_requests/other').who, '박영수', '남의 요청은 그대로');
  assert(db.has('baep_outing_apps/o1_dad2'));
  eq(doc('baep_outing_teams/o1_1').memberAccts, ['dad2'], '팀 명단에서 빠짐');
  eq(doc('baep_payments/o-1').acct, 'mom1', '결제 기록은 5년 보관');
  eq([...authUsers], ['acct:dad2'], 'Firebase 로그인 계정 2개 삭제');
  const unlink = calls.filter((c) => c.url === 'https://kapi.kakao.com/v1/user/unlink');
  eq(unlink.length, 1);
  eq(unlink[0].headers.get('Authorization'), 'KakaoAK kakao-admin-key');
  eq(new URLSearchParams(unlink[0].body).get('target_id'), '999');

  // 한 번 더 불러도 괜찮아요 (이미 지워진 것은 넘어가요)
  const again = await post('/auth/delete', {}, { headers: bearer(tok) });
  eq(again.status, 200);
  eq(again.j.deleted, { accounts: 0, secrets: 0, profiles: 0, users: 0, outingApps: 0, requests: 0, requestsScrubbed: 0, teams: 0, authUsers: 0 });
});

await test('탈퇴 : 소셜 토큰에 acct 가 없어도 baep_users 연결로 찾아서 지워요 (프렌드 프로필 포함)', async () => {
  put('baep_users/naver:abc', { acct: 'naverabc', role: 'mentor', provider: 'naver' });
  put('baep_accounts/naverabc', { role: 'mentor', ownerUids: ['naver:abc'] });
  put('baep_secrets/naverabc', { pwHash: '', uids: ['naver:abc'] });
  put('baep_profiles/naverabc', { name: '프렌드', approved: true });
  authUsers.add('naver:abc');
  const { j } = await post('/auth/delete', {}, { headers: bearer(await makeIdToken({ sub: 'naver:abc' })) });
  eq([j.ok, j.acct, j.kakaoUnlinked], [true, 'naverabc', false]);
  eq([j.deleted.accounts, j.deleted.profiles, j.deleted.users, j.deleted.authUsers], [1, 1, 1, 1]);
  eq(db.size, 0);
  eq(calls.filter((c) => c.url.includes('unlink')).length, 0, '네이버는 연결 끊기 안 함');
});

await test('탈퇴 : 진짜 ID 토큰이면 카카오 연결 끊기 → {ok:true,kakaoUnlinked:true}', async () => {
  const tok = await makeIdToken();
  const res = await call('/auth/delete', { method: 'POST', headers: { Origin: APP, Authorization: 'Bearer ' + tok } });
  eq(res.status, 200);
  eq(res.headers.get('Access-Control-Allow-Origin'), APP);
  const j = await res.json();
  eq(j.ok, true);
  eq(j.kakaoUnlinked, true);
  const u = calls.find((c) => c.url === 'https://kapi.kakao.com/v1/user/unlink');
  assert(u, '연결 끊기 호출');
  eq(u.method, 'POST');
  eq(u.headers.get('Authorization'), 'KakaoAK kakao-admin-key');
  const form = new URLSearchParams(u.body);
  eq(form.get('target_id_type'), 'user_id');
  eq(form.get('target_id'), '1234567890');
  assert(calls.filter((c) => c.url.includes('jwk/securetoken')).length <= 1, '구글 공개키는 많아야 한 번');
});

await test('탈퇴 : 구글 공개키(JWKS)는 한 번만 받아서 재사용', async () => {
  const tok = await makeIdToken({ sub: 'naver:abc' });
  await call('/auth/delete', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } });
  await call('/auth/delete', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } });
  eq(calls.filter((c) => c.url.includes('jwk/securetoken')).length, 0, '앞 시험에서 받은 키 재사용');
});

await test('탈퇴 : 네이버·익명 계정은 연결 끊기 안 함, 관리자 키 없으면 false', async () => {
  for (const sub of ['naver:abc', 'AnonUid123']) {
    calls = [];
    authUsers.add(sub);
    const j = await (await call('/auth/delete', { method: 'POST', headers: { Authorization: 'Bearer ' + (await makeIdToken({ sub })) } })).json();
    eq([j.ok, j.uid, j.acct, j.kakaoUnlinked, j.deleted.authUsers], [true, sub, null, false, 1]);
    eq(calls.filter((c) => c.url.includes('unlink')).length, 0);
  }
  const env = { ...baseEnv, KAKAO_ADMIN_KEY: '' };
  const j = await (await call('/auth/delete', { method: 'POST', headers: { Authorization: 'Bearer ' + (await makeIdToken()) }, env })).json();
  eq(j.kakaoUnlinked, false);
});

await test('탈퇴 : 가짜/만료/다른 프로젝트 토큰은 401', async () => {
  seedMember();
  const now = Math.floor(Date.now() / 1000);
  const bads = [
    await makeIdToken({ key: otherKeys.privateKey, claims: { acct: 'mom1' } }), // 엉뚱한 키로 서명
    await makeIdToken({ aud: 'other-project' }),
    await makeIdToken({ iss: 'https://securetoken.google.com/other-project' }),
    await makeIdToken({ exp: now - 5 }),
    await makeIdToken({ kid: 'unknown-kid' }),
    'not.a.token',
    '',
  ];
  for (const t of bads) {
    const res = await call('/auth/delete', { method: 'POST', headers: { Origin: GH, Authorization: 'Bearer ' + t } });
    eq(res.status, 401, '거절');
  }
  const none = await call('/auth/delete', { method: 'POST', headers: { Origin: GH } });
  eq([none.status, (await none.json()).code], [401, 'AUTH_REQUIRED'], '토큰 없음');
  eq(calls.filter((c) => c.url.includes('unlink')).length, 0, '연결 끊기 안 함');
  const evil = await call('/auth/delete', { method: 'POST', headers: { Origin: 'https://evil.example.com', Authorization: 'Bearer ' + (await memberToken('mom1')) } });
  eq(evil.status, 403, '다른 사이트');
  assert(db.has('baep_accounts/mom1') && authUsers.has('acct:mom1'), '아무것도 안 지워짐');
});

await test('Firestore 가 안 되면 503 DB (내부 내용은 안 보여요)', async () => {
  mockMode.fsDown = true;
  const { status, j } = await post('/auth/login', { id: 'grandma1', pw: '123456' });
  eq([status, j.ok, j.code], [503, false, 'DB']);
  assert(!JSON.stringify(j).includes('UNAVAILABLE'));
});

await test('없는 주소 404, 잘못된 방식 405', async () => {
  eq((await call('/nope')).status, 404);
  eq((await call('/auth/delete')).status, 405);
  eq((await call('/pay/confirm')).status, 405);
  eq((await call('/auth/login')).status, 405);
  eq((await call('/auth/signup')).status, 405);
  eq((await call('/auth/check-id', { method: 'POST' })).status, 405);
  const j = await (await call('/nope')).json();
  eq([j.ok, j.code], [false, 'NOT_FOUND']);
});

/* =================================================================== */
log(results.join('\n'));
log(`\n결과: ${pass}개 통과, ${fail}개 실패\n`);
process.exit(fail ? 1 : 0);
