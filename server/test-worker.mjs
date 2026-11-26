/* 배프 서버(worker.js) 자동 점검
   실행:  node test-worker.mjs      (Node 22 이상, 설치할 것 없음)
   카카오·네이버·토스·구글 서버는 진짜로 부르지 않고 흉내(mock)만 내요. */

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
const GH = 'https://hohowww12.github.io';
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
  switch (u.origin + u.pathname) {
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
      return jsonRes(200, { paymentKey: b.paymentKey, orderId: b.orderId, totalAmount: b.amount, status: 'DONE', method: '간편결제', secret: 'ps_SHOULD_NOT_LEAK' });
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
async function makeIdToken({ sub = 'kakao:1234567890', aud = PROJECT, iss = 'https://securetoken.google.com/' + PROJECT, exp, key = googleKeys.privateKey, kid = 'gkey1' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = jsonB64u({ alg: 'RS256', kid, typ: 'JWT' });
  const p = jsonB64u({ iss, aud, sub, user_id: sub, iat: now - 10, exp: exp ?? now + 3600, auth_time: now - 10 });
  const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(s);
}

/* =================================================================== */
log('\n배프 서버 점검 시작\n');

/* ---------- 설정 확인 ---------- */
await test('GET / : 설정 상태가 true/false 로만 나와요', async () => {
  const res = await call('/');
  eq(res.status, 200);
  const j = await res.json();
  eq(j.ok, true);
  eq(j.configured, { toss: true, kakao: true, naver: true, firebase: true, stateSecret: true, kakaoUnlink: true });
  assert(Array.isArray(j.routes) && j.routes.length > 5, 'routes 목록');
  assert(!JSON.stringify(j).includes('SECRET') && !JSON.stringify(j).includes('PRIVATE KEY'), '비밀값이 보이면 안 돼요');
  eq(j.allowedOrigins, [GH, APP], '기본 허용 주소');
  const empty = await (await call('/', { env: {} })).json();
  eq(empty.configured, { toss: false, kakao: false, naver: false, firebase: false, stateSecret: false, kakaoUnlink: false });
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
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60 * 1000;
  try {
    const res = await call(`/auth/kakao/callback?code=X&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
    eq(fragmentOf(res).hash, 'baep_auth_error=state');
  } finally {
    Date.now = realNow;
  }
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

/* ---------- 결제 승인 ---------- */
const payBody = (amount) => JSON.stringify({ paymentKey: 'tgen_20261125abcdef', orderId: 'baep-ORDER_123456', amount });

await test('결제 OPTIONS(사전 요청) : 허용된 앱 주소를 그대로 돌려줘요', async () => {
  const res = await call('/pay/confirm', { method: 'OPTIONS', headers: { Origin: APP, 'Access-Control-Request-Method': 'POST' } });
  eq(res.status, 204);
  eq(res.headers.get('Access-Control-Allow-Origin'), APP);
  assert(/Content-Type/.test(res.headers.get('Access-Control-Allow-Headers')), 'Content-Type 허용');
  const bad = await call('/pay/confirm', { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com' } });
  eq(bad.headers.get('Access-Control-Allow-Origin'), null);
});

await test('결제 : 다른 사이트(Origin)에서 오면 403', async () => {
  for (const headers of [{ Origin: 'https://evil.example.com', 'Content-Type': 'application/json' }, { 'Content-Type': 'application/json' }]) {
    const res = await call('/pay/confirm', { method: 'POST', headers, body: payBody(20000) });
    eq(res.status, 403);
    eq((await res.json()).code, 'ORIGIN');
  }
  eq(calls.length, 0, '토스를 부르지 않음');
});

await test('결제 : 금액표에 없는 금액은 400 BAD_AMOUNT', async () => {
  for (const amt of [100, 19999, 50000, '20000원', null]) {
    const res = await call('/pay/confirm', { method: 'POST', headers: { Origin: GH, 'Content-Type': 'application/json' }, body: payBody(amt) });
    eq(res.status, 400);
    const j = await res.json();
    eq(j.code, 'BAD_AMOUNT');
    eq(j.message, '결제 금액이 수업료와 달라요');
  }
  const r = await call('/pay/confirm', { method: 'POST', headers: { Origin: GH }, body: 'not json' });
  eq((await r.json()).code, 'BAD_JSON');
  const r2 = await call('/pay/confirm', { method: 'POST', headers: { Origin: GH }, body: JSON.stringify({ paymentKey: 'x', orderId: 'a b', amount: 20000 }) });
  eq((await r2.json()).code, 'BAD_ORDER');
  eq(calls.length, 0, '토스를 부르지 않음');
});

await test('결제 : 정상 요청은 토스로 승인 (5가지 금액, /pay/confirm 과 / 둘 다)', async () => {
  for (const [path, amt, origin] of [
    ['/pay/confirm', 20000, GH],
    ['/pay/confirm', 25000, APP],
    ['/', 30000, GH],
    ['/pay/confirm', 40000, APP],
    ['/pay/confirm', 60000, APP],
  ]) {
    calls = [];
    const res = await call(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: payBody(amt) });
    eq(res.status, 200, `${path} ${amt}`);
    eq(res.headers.get('Access-Control-Allow-Origin'), origin);
    const j = await res.json();
    eq(j.totalAmount, amt);
    eq(j.status, 'DONE');
    assert(!('secret' in j), 'secret 은 빼고 돌려줘요');
    const t = calls[0];
    eq(t.url, 'https://api.tosspayments.com/v1/payments/confirm');
    eq(t.headers.get('Authorization'), 'Basic ' + btoa('test_gsk_SECRET:'));
    eq(t.headers.get('Idempotency-Key'), 'baep-ORDER_123456');
    eq(JSON.parse(t.body), { paymentKey: 'tgen_20261125abcdef', orderId: 'baep-ORDER_123456', amount: amt });
  }
});

await test('결제 : 시크릿 키가 없으면 500 NO_KEY / 예전 ALLOWED_ORIGIN 변수도 읽어요', async () => {
  const r = await call('/pay/confirm', { method: 'POST', headers: { Origin: GH }, body: payBody(20000), env: { ...baseEnv, TOSS_SECRET_KEY: '' } });
  eq(r.status, 500);
  eq((await r.json()).code, 'NO_KEY');
  const env = { ...baseEnv, ALLOWED_ORIGIN: 'https://old.site' };
  eq((await call('/pay/confirm', { method: 'POST', headers: { Origin: 'https://old.site' }, body: payBody(20000), env })).status, 200);
  eq((await call('/pay/confirm', { method: 'POST', headers: { Origin: GH }, body: payBody(20000), env })).status, 403);
});

/* ---------- 탈퇴 ---------- */
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
  eq(calls.filter((c) => c.url.includes('jwk/securetoken')).length, 1, '구글 공개키 한 번 받음');
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
    const j = await (await call('/auth/delete', { method: 'POST', headers: { Authorization: 'Bearer ' + (await makeIdToken({ sub })) } })).json();
    eq(j, { ok: true, uid: sub, kakaoUnlinked: false });
    eq(calls.filter((c) => c.url.includes('unlink')).length, 0);
  }
  const env = { ...baseEnv, KAKAO_ADMIN_KEY: '' };
  const j = await (await call('/auth/delete', { method: 'POST', headers: { Authorization: 'Bearer ' + (await makeIdToken()) }, env })).json();
  eq(j.kakaoUnlinked, false);
});

await test('탈퇴 : 가짜/만료/다른 프로젝트 토큰은 401', async () => {
  const now = Math.floor(Date.now() / 1000);
  const bads = [
    await makeIdToken({ key: otherKeys.privateKey }), // 엉뚱한 키로 서명
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
  eq((await call('/auth/delete', { method: 'POST', headers: { Origin: GH } })).status, 401, '토큰 없음');
  eq(calls.filter((c) => c.url.includes('unlink')).length, 0, '연결 끊기 안 함');
  const evil = await call('/auth/delete', { method: 'POST', headers: { Origin: 'https://evil.example.com', Authorization: 'Bearer ' + (await makeIdToken()) } });
  eq(evil.status, 403, '다른 사이트');
});

await test('없는 주소 404, 잘못된 방식 405', async () => {
  eq((await call('/nope')).status, 404);
  eq((await call('/auth/delete')).status, 405);
  eq((await call('/pay/confirm')).status, 405);
});

/* =================================================================== */
log(results.join('\n'));
log(`\n결과: ${pass}개 통과, ${fail}개 실패\n`);
process.exit(fail ? 1 : 0);
