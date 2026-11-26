/* =====================================================================
   배프 서버 (Cloudflare Worker 하나로 다 해요 · 무료 요금제로 충분해요)

   하는 일
   1) 결제 승인   POST /pay/confirm  (또는 POST /)
      앱이 토스 결제창에서 돌아오면 {paymentKey, orderId, amount}를 보내고,
      이 서버가 시크릿 키로 토스페이먼츠 "결제 승인 API"를 불러 결제를 끝내요.
   2) 카카오·네이버 간편로그인
      GET /auth/kakao/start?return=<돌아갈 주소>   → 카카오 로그인 화면으로 보내요
      GET /auth/naver/start?return=<돌아갈 주소>   → 네이버 로그인 화면으로 보내요
      GET /auth/<kakao|naver>/callback             → 로그인이 끝나면 여기로 돌아와요.
          Firebase "커스텀 토큰"을 만들어 앱 주소 뒤에 #baep_auth=... 로 붙여 돌려보내요.
          실패하면 #baep_auth_error=<코드> 로 돌려보내요.
   3) 회원 탈퇴 도우미   POST /auth/delete
      (헤더 Authorization: Bearer <Firebase ID 토큰>)
      카카오로 가입한 사람이면 카카오 "연결 끊기"까지 해 줘요.
      ※ Firebase 로그인 계정 삭제와 Firestore 문서 삭제는 앱(브라우저)에서 직접 해요.
         순서: ① 이 주소 호출 → ② Firestore 문서 지우기 → ③ firebase.auth().currentUser.delete()
   4) 설정 확인   GET /
      {ok, routes, configured:{toss,kakao,naver,firebase,...}} 처럼 "설정됐는지"만 true/false 로 보여줘요.
      (키 값 자체는 절대 보여주지 않아요)

   실패 코드(#baep_auth_error=...) 목록
     cancelled : 사용자가 로그인/동의를 취소했어요
     state     : 로그인 시간이 지났거나(10분) 다른 브라우저에서 돌아왔어요 → 다시 시도
     config    : 서버 설정(환경변수)이 빠졌어요 → GET / 로 확인
     token     : 카카오/네이버에서 로그인 확인(토큰 교환)에 실패했어요
     profile   : 카카오/네이버 회원정보를 못 가져왔어요
     firebase  : Firebase 토큰 만들기에 실패했어요 (서비스 계정 키 확인)
     provider  : 카카오/네이버가 알 수 없는 오류를 돌려줬어요

   환경변수 (워커 Settings → Variables and Secrets) — 자세한 건 README.md
     TOSS_SECRET_KEY           Secret  토스 시크릿 키 (test_gsk_... / live_gsk_...)
     ALLOWED_ORIGINS           Text    허용할 앱 주소들, 쉼표로 구분 (비우면 아래 DEFAULT_ORIGINS)
     AUTH_STATE_SECRET         Secret  아무 긴 랜덤 문자열 (로그인 위조 방지용 서명 키)
     FIREBASE_SERVICE_ACCOUNT  Secret  Firebase 서비스 계정 키 JSON 파일 내용 통째로
     KAKAO_REST_KEY            Text    카카오 REST API 키
     KAKAO_CLIENT_SECRET       Secret  (선택) 카카오 Client Secret 을 "사용함"으로 켰을 때만
     KAKAO_ADMIN_KEY           Secret  (선택) 카카오 Admin 키 — 탈퇴 때 연결 끊기용
     NAVER_CLIENT_ID           Text    네이버 Client ID
     NAVER_CLIENT_SECRET       Secret  네이버 Client Secret
   ===================================================================== */

/* ---------- 결제 금액표 (여기만 고치면 돼요. 앱의 요금표와 똑같아야 해요) ----------
   금액 조작을 막으려고, 아래 목록에 있는 금액만 승인해요. */
const ALLOWED_AMOUNTS = new Set([
  20000, // 1:1 수업 60분
  25000, // 1:1 수업 90분
  30000, // 2:1 부부 수업 60분
  40000, // 2:1 부부 수업 90분
  60000, // 나들이 1인 2시간 (시간당 30,000원 × 2시간)
]);

/* ALLOWED_ORIGINS 를 비워두면 이 주소들만 허용해요.
   - 깃허브 페이지 주소
   - 안드로이드 앱(웹뷰) 안의 주소 */
const DEFAULT_ORIGINS = ['https://nanaumsin.github.io', 'https://hohowww12.github.io', 'https://appassets.androidplatform.net'];

const STATE_TTL_SEC = 10 * 60; // 로그인 시작 후 10분 안에 끝내야 해요
const NONCE_COOKIE = '__Host-baep_oauth'; // 로그인을 시작한 브라우저와 끝낸 브라우저가 같은지 확인하는 쿠키

const FIREBASE_AUD =
  'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const ROUTES = [
  'GET  /',
  'POST /pay/confirm',
  'POST /  (결제 승인, 예전 주소 호환)',
  'GET  /auth/kakao/start?return=<url>',
  'GET  /auth/naver/start?return=<url>',
  'GET  /auth/kakao/callback',
  'GET  /auth/naver/callback',
  'POST /auth/delete',
];

/* ===================================================================== */

export default {
  async fetch(req, env, ctx) {
    env = env || {};
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const origins = allowedOrigins(env);
    const cors = corsHeaders(req, origins);

    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

      if (path === '/' && req.method === 'GET') return health(env, origins, cors);
      if ((path === '/' || path === '/pay/confirm') && req.method === 'POST') return await payConfirm(req, env, origins, cors);

      const m = path.match(/^\/auth\/(kakao|naver)\/(start|callback)$/);
      if (m && req.method === 'GET') {
        return m[2] === 'start' ? await authStart(m[1], url, env, origins) : await authCallback(m[1], req, url, env);
      }
      if (path === '/auth/delete' && req.method === 'POST') return await authDelete(req, env, origins, cors);

      if (path === '/' || path === '/pay/confirm' || path === '/auth/delete' || m) {
        return json(405, { code: 'METHOD', message: '이 주소는 그 방식으로 부를 수 없어요' }, cors);
      }
      return json(404, { code: 'NOT_FOUND', message: '없는 주소예요' }, cors);
    } catch (e) {
      // 내부 오류 내용(키 등)이 밖으로 새지 않게 짧은 메시지만 돌려줘요.
      console.log('unhandled', e && e.stack ? e.stack : e);
      return json(500, { code: 'SERVER', message: '서버에서 문제가 생겼어요. 잠시 후 다시 해 주세요' }, cors);
    }
  },
};

/* ============================ 공통 도구 ============================ */

function allowedOrigins(env) {
  // 예전 워커의 ALLOWED_ORIGIN(한 개)도 그대로 읽어요.
  const raw = env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || '';
  const list = raw.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  return list.length ? list : DEFAULT_ORIGINS.slice();
}

/* 결제 승인·탈퇴처럼 브라우저 fetch 로 부르는 곳의 출처 검사.
   ALLOWED_ORIGINS 에 '*' 가 있으면 모든 사이트 허용(시험용). */
function originOk(origin, origins) {
  if (origins.includes('*')) return true;
  return !!origin && origins.includes(origin);
}

function corsHeaders(req, origins) {
  const origin = req.headers.get('Origin');
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (origins.includes('*')) h['Access-Control-Allow-Origin'] = '*';
  else if (origin && origins.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(status, body, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(headers || {}), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function redirect(location, extraHeaders) {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const [k, v] of extraHeaders || []) h.append(k, v);
  return new Response(null, { status: 302, headers: h });
}

/* 돌아갈 주소를 알 수 없을 때 보여주는 작은 안내 화면 */
function errorPage(status, title, detail) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>배프 로그인</title>
<style>body{font-family:system-ui,-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:#f6f7fb;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
.c{background:#fff;border-radius:18px;padding:28px 24px;max-width:340px;margin:16px;box-shadow:0 4px 20px rgba(0,0,0,.08);text-align:center}
h1{font-size:22px;margin:0 0 12px}p{font-size:18px;line-height:1.6;color:#444;margin:0 0 20px}
button{font-size:18px;padding:12px 22px;border:0;border-radius:12px;background:#2f6bff;color:#fff}</style></head>
<body><div class="c"><h1>${esc(title)}</h1><p>${esc(detail)}</p><button onclick="history.length>1?history.back():window.close()">돌아가기</button></div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/* ---- base64url (UTF-8 안전) ----
   base64url = 보통 base64 에서 + → -, / → _ 로 바꾸고 끝의 = 를 뺀 것. */
function bytesToB64url(bytes) {
  let bin = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const enc = new TextEncoder();
const dec = new TextDecoder();
const jsonToB64url = (obj) => bytesToB64url(enc.encode(JSON.stringify(obj)));
const b64urlToJson = (s) => JSON.parse(dec.decode(b64urlToBytes(s)));

const nowSec = () => Math.floor(Date.now() / 1000);
function randomId(n = 16) {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(n)));
}
function getCookie(req, name) {
  const raw = req.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}
function formBody(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  return p.toString();
}

/* ============================ 설정 확인 ============================ */

function health(env, origins, cors) {
  const sa = readServiceAccount(env);
  return json(
    200,
    {
      ok: true,
      service: 'baep-server',
      routes: ROUTES,
      configured: {
        toss: !!env.TOSS_SECRET_KEY,
        kakao: !!env.KAKAO_REST_KEY,
        naver: !!(env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET),
        firebase: !!sa,
        stateSecret: !!env.AUTH_STATE_SECRET, // 간편로그인에 꼭 필요해요
        kakaoUnlink: !!env.KAKAO_ADMIN_KEY, // 탈퇴 때 카카오 연결 끊기 (선택)
      },
      allowedOrigins: origins, // 공개돼도 괜찮은 정보(앱 주소)예요
      amounts: [...ALLOWED_AMOUNTS],
    },
    cors,
  );
}

/* ============================ 1. 결제 승인 ============================ */

async function payConfirm(req, env, origins, cors) {
  if (!originOk(req.headers.get('Origin'), origins)) return json(403, { code: 'ORIGIN', message: '허용되지 않은 사이트예요' }, cors);
  if (!env.TOSS_SECRET_KEY) return json(500, { code: 'NO_KEY', message: '서버에 시크릿 키가 설정되지 않았어요' }, cors);

  let b;
  try {
    b = await req.json();
  } catch {
    return json(400, { code: 'BAD_JSON', message: '요청 형식이 잘못됐어요' }, cors);
  }
  b = b || {};
  const paymentKey = String(b.paymentKey || '');
  const orderId = String(b.orderId || '');
  const amount = Number(b.amount);

  // 금액 조작 막기: 정해진 금액만 승인해요. (주문을 DB에 저장하게 되면 orderId로 저장된 금액과 비교하세요)
  if (!paymentKey || paymentKey.length > 200 || !/^[A-Za-z0-9_-]{6,64}$/.test(orderId)) {
    return json(400, { code: 'BAD_ORDER', message: '주문 정보가 잘못됐어요' }, cors);
  }
  if (!ALLOWED_AMOUNTS.has(amount)) return json(400, { code: 'BAD_AMOUNT', message: '결제 금액이 수업료와 달라요' }, cors);

  const r = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(env.TOSS_SECRET_KEY + ':'),
      'Content-Type': 'application/json',
      'Idempotency-Key': orderId, // 같은 주문을 두 번 승인하지 않게
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return json(r.status, { code: j.code, message: j.message || '승인에 실패했어요' }, cors);

  // 브라우저에는 화면에 필요한 값만 돌려줘요
  const { secret, ...safe } = j;
  return json(200, safe, cors);
}

/* ============================ 2. 간편로그인 ============================ */

/* ---- state: "누가, 어디로 돌아갈지"를 서명해서 들고 다니는 쪽지 ----
   형식: base64url(JSON {p:provider, r:return, n:nonce, e:만료시각}) + "." + base64url(HMAC-SHA256 서명)
   서버에 저장할 필요가 없어요(stateless). 서명 키는 AUTH_STATE_SECRET. */
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signState(data, secret) {
  const body = jsonToB64url(data);
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return body + '.' + bytesToB64url(sig);
}
/* 결과: {ok:true,data} | {ok:false, reason:'bad'|'expired', data?}
   - 'bad'     : 서명이 틀렸거나 모양이 이상함 → 돌아갈 주소도 믿을 수 없음
   - 'expired' : 서명은 맞는데 시간이 지남 → 돌아갈 주소는 믿을 수 있음 */
async function verifyState(token, secret) {
  try {
    const [body, sig, extra] = String(token || '').split('.');
    if (!body || !sig || extra !== undefined) return { ok: false, reason: 'bad' };
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlToBytes(sig), enc.encode(body));
    if (!valid) return { ok: false, reason: 'bad' };
    const data = b64urlToJson(body);
    if (!data || typeof data !== 'object' || typeof data.r !== 'string' || typeof data.p !== 'string') return { ok: false, reason: 'bad' };
    if (!(Number(data.e) > nowSec())) return { ok: false, reason: 'expired', data };
    return { ok: true, data };
  } catch {
    return { ok: false, reason: 'bad' };
  }
}

/* 돌아갈 주소 검사: 허용된 앱 주소(ALLOWED_ORIGINS)로만 돌려보내요.
   ('*' 는 로그인에선 무시해요 — 아무 사이트로나 토큰을 보내면 안 되니까요) */
function checkReturnUrl(ret, origins) {
  if (!ret || ret.length > 2000) return null;
  let u;
  try {
    u = new URL(ret);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  if (!origins.includes(u.origin)) return null;
  u.hash = '';
  return u.toString();
}

function withFragment(ret, key, value) {
  const u = new URL(ret);
  u.hash = key + '=' + value;
  return u.toString();
}
const errorRedirect = (ret, code, extra) => redirect(withFragment(ret, 'baep_auth_error', code), extra);
const clearNonceCookie = ['Set-Cookie', `${NONCE_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`];

function providerConfigured(provider, env) {
  if (provider === 'kakao') return !!env.KAKAO_REST_KEY;
  if (provider === 'naver') return !!(env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET);
  return false;
}

async function authStart(provider, url, env, origins) {
  const ret = checkReturnUrl(url.searchParams.get('return'), origins);
  if (!ret) {
    return errorPage(400, '허용되지 않은 주소예요', '배프 앱에서 다시 로그인 버튼을 눌러 주세요.');
  }
  if (!env.AUTH_STATE_SECRET || !providerConfigured(provider, env) || !readServiceAccount(env)) {
    return errorRedirect(ret, 'config');
  }

  const nonce = randomId(16);
  const state = await signState({ p: provider, r: ret, n: nonce, e: nowSec() + STATE_TTL_SEC }, env.AUTH_STATE_SECRET);
  const redirectUri = `${url.origin}/auth/${provider}/callback`;

  let authUrl;
  if (provider === 'kakao') {
    authUrl = new URL('https://kauth.kakao.com/oauth/authorize');
    authUrl.searchParams.set('client_id', env.KAKAO_REST_KEY);
  } else {
    authUrl = new URL('https://nid.naver.com/oauth2.0/authorize');
    authUrl.searchParams.set('client_id', env.NAVER_CLIENT_ID);
  }
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);

  // 같은 브라우저에서 돌아왔는지 확인하려고 짧은 쿠키를 남겨요 (남이 만든 로그인 링크로 엉뚱한 계정에 로그인되는 것 방지)
  return redirect(authUrl.toString(), [
    ['Set-Cookie', `${NONCE_COOKIE}=${nonce}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_SEC}`],
  ]);
}

async function authCallback(provider, req, url, env) {
  const q = url.searchParams;
  if (!env.AUTH_STATE_SECRET) return errorPage(500, '서버 설정이 아직 안 됐어요', '운영자에게 알려 주세요. (AUTH_STATE_SECRET)');

  const st = await verifyState(q.get('state'), env.AUTH_STATE_SECRET);
  if (!st.ok && st.reason === 'bad') {
    return errorPage(400, '로그인 정보를 확인하지 못했어요', '배프 앱으로 돌아가서 로그인 버튼을 다시 눌러 주세요.');
  }
  const data = st.data;
  // 서명이 맞아도, 돌아갈 주소가 지금도 허용 목록에 있는지 한 번 더 확인해요.
  const ret = checkReturnUrl(data.r, allowedOrigins(env));
  if (!ret || data.p !== provider) {
    return errorPage(400, '로그인 정보를 확인하지 못했어요', '배프 앱으로 돌아가서 로그인 버튼을 다시 눌러 주세요.');
  }
  const fail = (code) => errorRedirect(ret, code, [clearNonceCookie]);

  // 사용자가 취소했거나 카카오/네이버가 오류를 돌려준 경우
  const err = q.get('error');
  if (err) {
    const desc = (q.get('error_description') || '').toLowerCase();
    const cancelled = err === 'access_denied' || /cancel/.test(desc) || /cancel/.test(err);
    return fail(cancelled ? 'cancelled' : 'provider');
  }
  if (!st.ok) return fail('state'); // 10분이 지났어요
  if (!getCookie(req, NONCE_COOKIE) || getCookie(req, NONCE_COOKIE) !== data.n) return fail('state');

  const code = q.get('code');
  if (!code) return fail('token');
  if (!providerConfigured(provider, env)) return fail('config');
  const sa = readServiceAccount(env);
  if (!sa) return fail('config');

  const redirectUri = `${url.origin}/auth/${provider}/callback`;

  // ① 코드 → 액세스 토큰
  let accessToken;
  try {
    accessToken = provider === 'kakao' ? await kakaoToken(code, redirectUri, env) : await naverToken(code, q.get('state'), env);
  } catch (e) {
    console.log('token exchange failed', provider, e && e.message);
    return fail('token');
  }
  if (!accessToken) return fail('token');

  // ② 회원정보
  let profile;
  try {
    profile = provider === 'kakao' ? await kakaoProfile(accessToken) : await naverProfile(accessToken);
  } catch (e) {
    console.log('profile failed', provider, e && e.message);
    return fail('profile');
  }
  if (!profile || !profile.id) return fail('profile');

  // ③ Firebase 커스텀 토큰
  const uid = `${provider}:${profile.id}`;
  let token;
  try {
    token = await mintCustomToken(sa, uid, { provider });
  } catch (e) {
    console.log('custom token failed', e && e.message);
    return fail('firebase');
  }

  /* 앱으로 돌려보내기: <return>#baep_auth=<base64url(UTF-8 JSON)>
     앱(브라우저)에서 읽는 법 — 한글 이름이 깨지지 않게 꼭 TextDecoder 로 풀어 주세요:
       const s = location.hash.slice('#baep_auth='.length);
       const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
       const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
       const auth = JSON.parse(new TextDecoder().decode(bytes)); // {token, uid, provider, name, email, phone}
       history.replaceState(null, '', location.pathname + location.search); // 주소창에서 토큰 지우기
       await firebase.auth().signInWithCustomToken(auth.token);
     값이 없으면 name/email/phone 은 빈 문자열('')이에요. */
  const payload = {
    token,
    uid,
    provider,
    name: profile.name || '',
    email: profile.email || '',
    phone: profile.phone || '',
  };
  return redirect(withFragment(ret, 'baep_auth', jsonToB64url(payload)), [clearNonceCookie]);
}

/* ---- 카카오 ---- */
async function kakaoToken(code, redirectUri, env) {
  const r = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: formBody({
      grant_type: 'authorization_code',
      client_id: env.KAKAO_REST_KEY,
      redirect_uri: redirectUri,
      code,
      client_secret: env.KAKAO_CLIENT_SECRET, // 비어 있으면 안 보내요
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('kakao token ' + r.status + ' ' + (j.error_code || j.error || ''));
  return j.access_token;
}
async function kakaoProfile(accessToken) {
  const r = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
  });
  if (!r.ok) throw new Error('kakao me ' + r.status);
  const j = await r.json();
  const acc = j.kakao_account || {};
  const prof = acc.profile || {};
  return {
    id: j.id != null ? String(j.id) : '',
    name: acc.name || prof.nickname || (j.properties && j.properties.nickname) || '',
    email: acc.email && acc.is_email_valid !== false ? acc.email : '',
    phone: normalizePhone(acc.phone_number), // 비즈 앱 + 동의했을 때만 와요
  };
}

/* ---- 네이버 ---- */
async function naverToken(code, state, env) {
  const r = await fetch('https://nid.naver.com/oauth2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: formBody({
      grant_type: 'authorization_code',
      client_id: env.NAVER_CLIENT_ID,
      client_secret: env.NAVER_CLIENT_SECRET,
      code,
      state,
    }),
  });
  const j = await r.json().catch(() => ({}));
  // 네이버는 실패해도 200 에 {error: ...} 를 줄 때가 있어요
  if (!r.ok || j.error) throw new Error('naver token ' + r.status + ' ' + (j.error || ''));
  return j.access_token;
}
async function naverProfile(accessToken) {
  const r = await fetch('https://openapi.naver.com/v1/nid/me', { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!r.ok) throw new Error('naver me ' + r.status);
  const j = await r.json();
  if (j.resultcode && j.resultcode !== '00') throw new Error('naver me ' + j.resultcode);
  const p = j.response || {};
  return {
    id: p.id ? String(p.id) : '',
    name: p.name || p.nickname || '',
    email: p.email || '',
    phone: normalizePhone(p.mobile),
  };
}

/* "+82 10-1234-5678" → "010-1234-5678" */
function normalizePhone(s) {
  if (!s) return '';
  let t = String(s).trim();
  t = t.replace(/^\+82\s*-?\s*0?/, '0');
  return t;
}

/* ============================ Firebase ============================ */

/* FIREBASE_SERVICE_ACCOUNT: Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성"
   으로 받은 JSON 파일 내용을 통째로 넣어요. */
function readServiceAccount(env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!sa || !sa.client_email || !sa.private_key || !sa.project_id) return null;
    return sa;
  } catch {
    return null;
  }
}

let _privKey = null; // {email, key} — 한 번 읽은 키는 재사용해요
async function importPrivateKey(sa) {
  if (_privKey && _privKey.email === sa.client_email && _privKey.pem === sa.private_key) return _privKey.key;
  const pem = String(sa.private_key).replace(/\\n/g, '\n');
  const b64 = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, '');
  const key = await crypto.subtle.importKey(
    'pkcs8',
    b64urlToBytes(b64), // 보통 base64 도 그대로 풀려요
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  _privKey = { email: sa.client_email, pem: sa.private_key, key };
  return key;
}

async function signJwtRS256(payload, key) {
  const head = jsonToB64url({ alg: 'RS256', typ: 'JWT' });
  const body = jsonToB64url(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(head + '.' + body));
  return head + '.' + body + '.' + bytesToB64url(sig);
}

/* Firebase 커스텀 토큰 (앱에서 signInWithCustomToken 으로 로그인할 때 쓰는 1시간짜리 표) */
async function mintCustomToken(sa, uid, claims) {
  const key = await importPrivateKey(sa);
  const iat = nowSec();
  return signJwtRS256(
    { iss: sa.client_email, sub: sa.client_email, aud: FIREBASE_AUD, iat, exp: iat + 3600, uid, claims: claims || {} },
    key,
  );
}

/* ---- Firebase ID 토큰 확인 (탈퇴 요청이 진짜 본인인지) ---- */
let _jwks = { exp: 0, keys: new Map() }; // 구글 공개키 보관함 (워커가 살아 있는 동안 재사용)
async function loadJwks(force) {
  if (!force && _jwks.exp > Date.now() && _jwks.keys.size) return _jwks.keys;
  const r = await fetch(GOOGLE_JWKS_URL);
  if (!r.ok) throw new Error('jwks ' + r.status);
  const j = await r.json();
  const keys = new Map();
  for (const k of j.keys || []) {
    if (!k.kid || k.kty !== 'RSA') continue;
    keys.set(
      k.kid,
      await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']),
    );
  }
  const maxAge = Number(((r.headers.get('Cache-Control') || '').match(/max-age=(\d+)/) || [])[1]) || 3600;
  _jwks = { exp: Date.now() + Math.min(maxAge, 6 * 3600) * 1000, keys };
  return keys;
}

async function verifyIdToken(idToken, projectId) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('format');
  const head = b64urlToJson(parts[0]);
  const p = b64urlToJson(parts[1]);
  if (head.alg !== 'RS256' || !head.kid) throw new Error('alg');
  let keys = await loadJwks(false);
  if (!keys.has(head.kid)) keys = await loadJwks(true); // 구글이 키를 바꿨을 수도 있어요
  const key = keys.get(head.kid);
  if (!key) throw new Error('kid');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('sig');
  const now = nowSec();
  if (p.aud !== projectId) throw new Error('aud');
  if (p.iss !== 'https://securetoken.google.com/' + projectId) throw new Error('iss');
  if (!(p.exp > now)) throw new Error('exp');
  if (p.iat && p.iat > now + 300) throw new Error('iat');
  if (typeof p.sub !== 'string' || !p.sub || p.sub.length > 128) throw new Error('sub');
  return { uid: p.sub, claims: p };
}

/* ============================ 3. 탈퇴 도우미 ============================ */

async function authDelete(req, env, origins, cors) {
  // 브라우저에서 온 요청이면 허용된 앱 주소인지 확인해요 (토큰 검사는 아래에서 따로 해요)
  const origin = req.headers.get('Origin');
  if (origin && !originOk(origin, origins)) return json(403, { code: 'ORIGIN', message: '허용되지 않은 사이트예요' }, cors);

  const sa = readServiceAccount(env);
  if (!sa) return json(500, { code: 'CONFIG', message: '서버에 Firebase 설정이 없어요' }, cors);

  const m = (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return json(401, { code: 'NO_TOKEN', message: '로그인 정보가 없어요' }, cors);

  let uid;
  try {
    uid = (await verifyIdToken(m[1].trim(), sa.project_id)).uid;
  } catch (e) {
    console.log('id token rejected', e && e.message);
    return json(401, { code: 'BAD_TOKEN', message: '로그인 정보가 맞지 않아요. 다시 로그인해 주세요' }, cors);
  }

  let kakaoUnlinked = false;
  if (uid.startsWith('kakao:') && env.KAKAO_ADMIN_KEY) {
    try {
      const r = await fetch('https://kapi.kakao.com/v1/user/unlink', {
        method: 'POST',
        headers: {
          Authorization: 'KakaoAK ' + env.KAKAO_ADMIN_KEY,
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        },
        body: formBody({ target_id_type: 'user_id', target_id: uid.slice('kakao:'.length) }),
      });
      kakaoUnlinked = r.ok;
      if (!r.ok) console.log('kakao unlink failed', r.status);
    } catch (e) {
      console.log('kakao unlink error', e && e.message);
    }
  }
  // 네이버는 사용자가 네이버 → 내정보 → 이력관리 → 연결된 서비스 관리 에서 직접 끊을 수 있어요.
  return json(200, { ok: true, uid, kakaoUnlinked }, cors);
}
