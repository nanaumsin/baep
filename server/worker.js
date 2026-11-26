/* =====================================================================
   배프 서버 v2 (Cloudflare Worker 하나로 다 해요 · 설치할 것 없음 · WebCrypto 만 써요)
   약속(계약) 문서: docs/ARCH-v2.md — 주소·필드 이름을 바꾸지 마세요.

   하는 일
   1) 아이디/비밀번호 계정
      GET  /auth/check-id?id=<아이디>   → {ok, available}  (가입 화면 "중복 확인")
      POST /auth/login   {id, pw}       → {ok, token, acct, role}
      POST /auth/signup  {id?, pw?, role, account, profile?}
           - 아이디/비밀번호 가입: Authorization 헤더 없이
           - 카카오·네이버 가입: Authorization: Bearer <Firebase ID 토큰> (uid 가 kakao:/naver:)
      비밀번호는 PBKDF2-SHA256(10만 번)으로 바꿔서 baep_secrets/<아이디> 에만 저장해요.
   2) 결제 승인   POST /pay/confirm  (Bearer ID 토큰 필수)
      {paymentKey, orderId, amount, kind:'lesson'|'outing', refId}
      서버가 예약 문서의 주인·금액을 먼저 확인하고 → 토스 승인 → 결제 기록과 결제 상태를 직접 적어요.
      예전 주소 POST / 도 같은 일을 해요 (Bearer 없으면 AUTH_REQUIRED).
   3) 카카오·네이버 간편로그인
      GET /auth/kakao/start?return=<돌아갈 주소>   → 카카오 로그인 화면으로 보내요
      GET /auth/naver/start?return=<돌아갈 주소>   → 네이버 로그인 화면으로 보내요
      GET /auth/<kakao|naver>/callback             → 로그인이 끝나면 여기로 돌아와요.
          Firebase "커스텀 토큰"을 만들어 앱 주소 뒤에 #baep_auth=... 로 붙여 돌려보내요.
          이미 가입한 사람이면 acct(계정 아이디)·role 도 같이 넣어 줘요.
          실패하면 #baep_auth_error=<코드> 로 돌려보내요.
   4) 회원 탈퇴   POST /auth/delete  (Bearer ID 토큰)
      서버가 Firestore 문서와 Firebase 로그인 계정을 지우고, 카카오면 연결 끊기까지 해요.
   5) 설정 확인   GET /
      "설정됐는지"만 true/false·개수로 보여줘요. (키 값 자체는 절대 보여주지 않아요)

   저장 형식 약속
   - 서버가 적는 시각(createdAt, updatedAt, paidAt, lockUntil, scrubbedAt)은 전부
     "1970-01-01부터 센 밀리초 정수"(앱의 Date.now() 와 같은 숫자)예요.
     단, baep_payments 의 approvedAt 은 토스가 준 글자 그대로(ISO, 예: 2026-11-26T10:00:00+09:00) 저장해요.
   - 서버는 서비스 계정으로 Firestore 를 쓰기 때문에 보안 규칙을 거치지 않아요(규칙은 앱용이에요).

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
     ADMIN_IDS                 Text    (선택) 운영자 계정 아이디들, 쉼표로 구분 (예: baepadmin)
     KAKAO_REST_KEY            Text    카카오 REST API 키
     KAKAO_CLIENT_SECRET       Secret  (선택) 카카오 Client Secret 을 "사용함"으로 켰을 때만
     KAKAO_ADMIN_KEY           Secret  (선택) 카카오 Admin 키 — 탈퇴 때 연결 끊기용
     NAVER_CLIENT_ID           Text    네이버 Client ID
     NAVER_CLIENT_SECRET       Secret  네이버 Client Secret
   ===================================================================== */

/* ---------- 결제 금액표 (여기만 고치면 돼요. 앱의 요금표와 똑같아야 해요) ---------- */
const LESSON_AMOUNTS = new Set([
  20000, // 1:1 수업 60분
  25000, // 1:1 수업 90분
  30000, // 2:1 부부 수업 60분
  40000, // 2:1 부부 수업 90분
]);
const OUTING_PRICE = 60000; // 나들이 1인 2시간 (시간당 30,000원 × 2시간)
const OUTING_MAX_PEOPLE = 4; // 신청자 1명 + 동반자 최대 3명
/* 금액 조작을 막으려고, 아래 목록에 있는 금액만 승인해요 (예약 문서와 한 번 더 맞춰 봐요). */
const ALLOWED_AMOUNTS = new Set([...LESSON_AMOUNTS, ...Array.from({ length: OUTING_MAX_PEOPLE }, (_, i) => OUTING_PRICE * (i + 1))]);

/* ALLOWED_ORIGINS 를 비워두면 이 주소들만 허용해요.
   - 깃허브 페이지 주소
   - 안드로이드 앱(웹뷰) 안의 주소 */
const DEFAULT_ORIGINS = ['https://nanaumsin.github.io', 'https://hohowww12.github.io', 'https://appassets.androidplatform.net'];

const STATE_TTL_SEC = 10 * 60; // 로그인 시작 후 10분 안에 끝내야 해요
const NONCE_COOKIE = '__Host-baep_oauth'; // 로그인을 시작한 브라우저와 끝낸 브라우저가 같은지 확인하는 쿠키

/* ---------- 계정 규칙 ---------- */
const ID_RE = /^[a-z][a-z0-9]{3,19}$/;
const PW_MIN = 6; // 어르신이 쓰기 쉽게 6자 이상 (README 참고). 길이만 봐요(숫자만 6자리도 돼요).
const PW_MAX = 64;
const PBKDF2_ITER = 100000; // Cloudflare 가 허용하는 최대값. 문서마다 iter 를 같이 저장해서 나중에 바꿔도 돼요.
const LOCK_FAILS = 5; // 연속 5번 틀리면
const LOCK_MS = 10 * 60 * 1000; // 10분 잠가요
const PAY_LOCK_MS = 2 * 60 * 1000; // 같은 예약을 두 창에서 동시에 결제하는 것 막기 (2분)
/* 가입으로 쓸 수 없는 아이디: 시연 계정 이름, 그리고 간편로그인 전용 kakao…/naver… */
const RESERVED_IDS = new Set(['admin', 'baeum', 'friend', 'demo', 'baep', 'root', 'system', 'test']);
const RESERVED_PREFIX = /^(kakao|naver)/;
/* 앱이 보낸 account 에서 서버가 버리는 필드 (서버만 정해요) */
const ACCOUNT_FORBIDDEN = ['pw', 'pw2', 'role', 'approved', 'paid', 'paidAt', 'orderId', 'createdAt', 'ownerUids', 'admin'];
/* 공개 프로필(baep_profiles)에 남기는 필드 — ARCH-v2 §2 */
const PROFILE_FIELDS = ['name', 'school', 'major', 'grade', 'age', 'gender', 'dong', 'road', 'rad', 'intro', 'topics', 'wdays', 'times'];
const MAX_ACCOUNT_BYTES = 50 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_STR = 2000;

const FIREBASE_AUD =
  'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SCOPE =
  'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform';

const ROUTES = [
  'GET  /',
  'GET  /auth/check-id?id=<id>',
  'POST /auth/login',
  'POST /auth/signup',
  'POST /pay/confirm',
  'POST /  (결제 승인, 예전 주소 호환 · Bearer 필요)',
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
      if (path === '/auth/check-id' && req.method === 'GET') return await checkId(url, env, cors);
      if (path === '/auth/login' && req.method === 'POST') return await login(req, env, origins, cors);
      if (path === '/auth/signup' && req.method === 'POST') return await signup(req, env, origins, cors);

      if (['/', '/pay/confirm', '/auth/delete', '/auth/check-id', '/auth/login', '/auth/signup'].includes(path) || m) {
        return fail(405, 'METHOD', '이 주소는 그 방식으로 부를 수 없어요', cors);
      }
      return fail(404, 'NOT_FOUND', '없는 주소예요', cors);
    } catch (e) {
      // 내부 오류 내용(키 등)이 밖으로 새지 않게 짧은 메시지만 돌려줘요.
      if (e instanceof FsError) {
        console.log('firestore error', e.status, e.code);
        return fail(503, 'DB', '저장소에 잠시 연결하지 못했어요. 잠시 후 다시 해 주세요', cors);
      }
      console.log('unhandled', e && e.stack ? e.stack : e);
      return fail(500, 'SERVER', '서버에서 문제가 생겼어요. 잠시 후 다시 해 주세요', cors);
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
/* 에러 응답 약속: {ok:false, code, message} (ARCH-v2 §2) */
function fail(status, code, message, headers, extra) {
  return json(status, { ok: false, code, message, ...(extra || {}) }, headers);
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
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
async function sha256Hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/* 요청 본문(JSON) 읽기: 너무 크면 거절해요 */
async function readJson(req, maxBytes = MAX_BODY_BYTES) {
  let text;
  try {
    text = await req.text();
  } catch {
    return { error: 'BAD_JSON' };
  }
  if (enc.encode(text).length > maxBytes) return { error: 'BAD_INPUT' };
  try {
    const v = JSON.parse(text);
    return { body: isObj(v) ? v : {} };
  } catch {
    return { error: 'BAD_JSON' };
  }
}
const badJson = (cors) => fail(400, 'BAD_JSON', '요청 형식이 잘못됐어요', cors);
const badInput = (cors) => fail(400, 'BAD_INPUT', '입력한 내용이 너무 길거나 형식이 맞지 않아요', cors);

/* ============================ 설정 확인 ============================ */

function health(env, origins, cors) {
  const sa = readServiceAccount(env);
  return json(
    200,
    {
      ok: true,
      service: 'baep-server',
      version: 2,
      routes: ROUTES,
      configured: {
        toss: !!env.TOSS_SECRET_KEY,
        kakao: !!env.KAKAO_REST_KEY,
        naver: !!(env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET),
        firebase: !!sa,
        stateSecret: !!env.AUTH_STATE_SECRET, // 간편로그인에 꼭 필요해요
        kakaoUnlink: !!env.KAKAO_ADMIN_KEY, // 탈퇴 때 카카오 연결 끊기 (선택)
      },
      firestore: !!sa, // 서비스 계정 JSON 을 제대로 읽었는지 (Firestore·계정 기능에 꼭 필요)
      adminIds: adminIds(env).size, // 운영자 계정 "개수"만 보여줘요
      allowedOrigins: origins, // 공개돼도 괜찮은 정보(앱 주소)예요
      amounts: [...ALLOWED_AMOUNTS],
    },
    cors,
  );
}

function adminIds(env) {
  return new Set(
    String(env.ADMIN_IDS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => ID_RE.test(s)),
  );
}

/* ============================ Firestore (SDK 없이 REST) ============================ */

class FsError extends Error {
  constructor(status, code, message) {
    super('firestore ' + status + ' ' + code);
    this.status = status;
    this.code = code || '';
    this.detail = message || '';
  }
  get conflict() {
    // 이미 있는 문서를 만들려 했거나(ALREADY_EXISTS), 그 사이 누가 고쳤을 때(FAILED_PRECONDITION)
    return this.status === 409 || this.code === 'ALREADY_EXISTS' || this.code === 'FAILED_PRECONDITION' || this.code === 'ABORTED';
  }
  get notFound() {
    return this.status === 404 || this.code === 'NOT_FOUND';
  }
}

/* ---- 구글 OAuth 액세스 토큰 (서비스 계정 JWT → 1시간짜리 토큰, 만료 5분 전까지 재사용) ---- */
let _gtok = { email: '', token: '', exp: 0 };
async function googleAccessToken(sa) {
  if (_gtok.token && _gtok.email === sa.client_email && _gtok.exp - 5 * 60 * 1000 > Date.now()) return _gtok.token;
  const key = await importPrivateKey(sa);
  const iat = nowSec();
  const assertion = await signJwtRS256({ iss: sa.client_email, scope: GOOGLE_SCOPE, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 }, key);
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new FsError(r.status || 500, 'OAUTH', j.error || '');
  const ttl = Math.max(60, Number(j.expires_in) || 3600);
  _gtok = { email: sa.client_email, token: j.access_token, exp: Date.now() + ttl * 1000 };
  return _gtok.token;
}

/* ---- JS 값 ↔ Firestore 값(fields) ----
   string → stringValue, 정수 → integerValue, 소수 → doubleValue, true/false → booleanValue,
   null → nullValue, 배열 → arrayValue, 객체 → mapValue, Date → timestampValue.
   시각은 Date 대신 밀리초 정수로 저장하는 게 이 서버의 약속이에요(맨 위 설명). */
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { nullValue: null };
    return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.filter((x) => x !== undefined).map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}
function toFields(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined) f[k] = toValue(v);
  return f;
}
function fromValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fromValue);
  if ('mapValue' in v) return fromFields((v.mapValue && v.mapValue.fields) || {});
  if ('referenceValue' in v) return v.referenceValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  return null;
}
function fromFields(fields) {
  const o = {};
  for (const [k, v] of Object.entries(fields || {})) o[k] = fromValue(v);
  return o;
}

/* Firestore 도우미. 경로는 'baep_accounts/abcd' 처럼 "컬렉션/문서" 로 줘요.
   모든 호출을 POST(batchGet·commit·runQuery)로 해서, 문서 이름에 ':' 같은 글자가 있어도 주소가 안 깨져요. */
function firestore(sa) {
  const root = `projects/${sa.project_id}/databases/(default)/documents`;
  const api = `https://firestore.googleapis.com/v1/${root}`;
  const name = (path) => `${root}/${path}`;
  const call = async (verb, body) => {
    const token = await googleAccessToken(sa);
    const r = await fetch(`${api}:${verb}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = (Array.isArray(j) ? j[0] : j) || {};
      throw new FsError(r.status, (e.error && e.error.status) || '', (e.error && e.error.message) || '');
    }
    return j;
  };
  const docOut = (d) => ({ path: d.name.slice(root.length + 1), id: d.name.split('/').pop(), data: fromFields(d.fields), updateTime: d.updateTime });

  const fs = {
    name,
    /* 여러 문서 한 번에 읽기 → [{path,id,data,updateTime} | null, ...] (없으면 null) */
    async getMany(paths) {
      if (!paths.length) return [];
      const res = await call('batchGet', { documents: paths.map(name) });
      const byName = new Map();
      for (const x of Array.isArray(res) ? res : []) if (x.found) byName.set(x.found.name, docOut(x.found));
      return paths.map((p) => byName.get(name(p)) || null);
    },
    async get(path) {
      return (await fs.getMany([path]))[0];
    },
    /* 여러 쓰기를 "전부 되거나 전부 안 되게" 한 번에 (Firestore commit) */
    async commit(writes) {
      if (!writes.length) return { writeResults: [] };
      return call('commit', { writes });
    },
    /* ---- commit 에 넣을 쓰기 하나하나 ---- */
    // 없을 때만 만들기 (이미 있으면 commit 전체가 실패해요 → 아이디 중복을 동시에 눌러도 안전)
    wCreate: (path, data) => ({ update: { name: name(path), fields: toFields(data) }, currentDocument: { exists: false } }),
    // 일부 필드만 고치기. remove 에 적은 필드는 지워요. pre: {exists:true} | {updateTime:'...'}
    wPatch: (path, data, { remove = [], pre = { exists: true }, transforms } = {}) => {
      const w = {
        update: { name: name(path), fields: toFields(data) },
        updateMask: { fieldPaths: [...Object.keys(data), ...remove] },
      };
      if (pre) w.currentDocument = pre;
      if (transforms && transforms.length) w.updateTransforms = transforms;
      return w;
    },
    wDelete: (path) => ({ delete: name(path) }),
    async create(path, data) {
      return fs.commit([fs.wCreate(path, data)]);
    },
    async patch(path, data, opts) {
      return fs.commit([fs.wPatch(path, data, opts)]);
    },
    async del(path) {
      return fs.commit([fs.wDelete(path)]);
    },
    /* 같음(==) / 배열에 들어 있음(array-contains) 검색 → [{path,id,data,updateTime}] */
    async query(collectionId, field, value, op = 'EQUAL', limit = 500) {
      const res = await call('runQuery', {
        structuredQuery: {
          from: [{ collectionId }],
          where: { fieldFilter: { field: { fieldPath: field }, op, value: toValue(value) } },
          limit,
        },
      });
      return (Array.isArray(res) ? res : []).filter((x) => x.document).map((x) => docOut(x.document));
    },
  };
  return fs;
}

/* ---- Identity Toolkit: Firebase 로그인 계정 지우기 ---- */
async function deleteAuthUser(sa, uid) {
  const token = await googleAccessToken(sa);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:delete`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid }),
  });
  if (r.ok) return true;
  const j = await r.json().catch(() => ({}));
  const msg = (j.error && j.error.message) || '';
  if (/USER_NOT_FOUND/.test(msg)) return false; // 이미 지워짐 → 괜찮아요
  throw new FsError(r.status, 'IDENTITY', msg);
}

/* ============================ 비밀번호 ============================ */

async function pbkdf2(pw, saltBytes, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: iter }, key, 256);
  return new Uint8Array(bits);
}
/* 길이와 상관없이 끝까지 다 비교해서 "몇 번째 글자에서 틀렸는지" 시간이 새지 않게 */
function constantTimeEqual(a, b) {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i % a.length] || 0) ^ (b[i % b.length] || 0);
  return diff === 0;
}
async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(pw, salt, PBKDF2_ITER);
  return { pwHash: bytesToB64url(hash), salt: bytesToB64url(salt), iter: PBKDF2_ITER };
}
const DUMMY_SALT = new Uint8Array(16).fill(7);

/* ============================ 입력 정리 ============================ */

class BadInput extends Error {}
/* Firestore 에 넣어도 되는 모양으로 정리: 긴 글자·이상한 키·배열 속 배열은 거절 */
function sanitize(v, depth = 0) {
  if (depth > 8) throw new BadInput('depth');
  if (v === null) return null;
  if (typeof v === 'string') {
    if (v.length > MAX_STR) throw new BadInput('str');
    return v;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    if (v.length > 300) throw new BadInput('arr');
    return v.filter((x) => x !== undefined).map((x) => {
      if (Array.isArray(x)) throw new BadInput('nested array');
      return sanitize(x, depth + 1);
    });
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length > 300) throw new BadInput('keys');
    const o = {};
    for (const k of keys) {
      if (!k || k.length > 200 || /^__.*__$/.test(k)) throw new BadInput('key'); // Firestore 가 못 쓰는 키
      if (v[k] === undefined || typeof v[k] === 'function') continue;
      o[k] = sanitize(v[k], depth + 1);
    }
    return o;
  }
  return undefined; // 함수 등은 버려요
}
/* 비밀번호 칸은 어디에 있든 버려요 (예: account.sr.pw, account.tu.pw2) */
function dropPasswords(v) {
  if (Array.isArray(v)) return v.map(dropPasswords);
  if (isObj(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (k !== 'pw' && k !== 'pw2') o[k] = dropPasswords(x);
    return o;
  }
  return v;
}
function cleanAccount(raw) {
  if (raw !== undefined && !isObj(raw)) throw new BadInput('account');
  const a = dropPasswords(sanitize(raw || {}));
  for (const k of ACCOUNT_FORBIDDEN) delete a[k];
  if (enc.encode(JSON.stringify(a)).length > MAX_ACCOUNT_BYTES) throw new BadInput('size');
  return a;
}
function cleanProfile(raw) {
  if (!isObj(raw)) return {};
  const p = {};
  for (const k of PROFILE_FIELDS) {
    const v = raw[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') p[k] = sanitize(v);
    else if (Array.isArray(v)) p[k] = sanitize(v.filter((x) => typeof x === 'string' || typeof x === 'number').slice(0, 50));
  }
  return p;
}

/* ============================ 계정: 아이디 확인 ============================ */

const normId = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
const badIdMsg = '아이디는 영문 소문자로 시작하고, 영문 소문자·숫자로 4~20자로 만들어 주세요';
/* 가입으로 가질 수 없는 아이디 (시연 계정 이름, kakao…/naver…, 그리고 ADMIN_IDS 에 이미 적힌 아이디) */
function reservedId(id, env) {
  return RESERVED_IDS.has(id) || RESERVED_PREFIX.test(id) || adminIds(env).has(id);
}

async function checkId(url, env, cors) {
  const id = normId(url.searchParams.get('id'));
  if (!ID_RE.test(id)) return fail(400, 'BAD_ID', badIdMsg, cors);
  const sa = readServiceAccount(env);
  if (!sa) return fail(500, 'CONFIG', '서버에 Firebase 설정이 없어요', cors);
  if (reservedId(id, env)) return json(200, { ok: true, available: false }, cors);
  const fs = firestore(sa);
  const [sec, acc] = await fs.getMany([`baep_secrets/${id}`, `baep_accounts/${id}`]);
  return json(200, { ok: true, available: !sec && !acc }, cors);
}

/* ============================ 계정: 로그인 ============================ */

async function login(req, env, origins, cors) {
  const origin = req.headers.get('Origin');
  if (origin && !originOk(origin, origins)) return fail(403, 'ORIGIN', '허용되지 않은 사이트예요', cors);
  const sa = readServiceAccount(env);
  if (!sa) return fail(500, 'CONFIG', '서버에 Firebase 설정이 없어요', cors);
  const { body, error } = await readJson(req, 8 * 1024);
  if (error) return error === 'BAD_INPUT' ? badInput(cors) : badJson(cors);

  const id = normId(body.id);
  const pw = typeof body.pw === 'string' ? body.pw : '';
  const badLogin = () => fail(401, 'BAD_LOGIN', '아이디 또는 비밀번호가 맞지 않아요', cors);

  const fs = firestore(sa);
  const sec = ID_RE.test(id) && pw && pw.length <= PW_MAX ? await fs.get(`baep_secrets/${id}`) : null;
  const s = sec && sec.data;
  if (!s || !s.pwHash || !s.salt) {
    // 없는 아이디도 똑같이 시간을 써서 "있는 아이디인지" 알 수 없게 해요
    await pbkdf2(pw || 'x', DUMMY_SALT, PBKDF2_ITER);
    return badLogin();
  }
  const now = Date.now();
  if (Number(s.lockUntil) > now) return locked(Number(s.lockUntil) - now, cors);

  const got = await pbkdf2(pw, b64urlToBytes(s.salt), Number(s.iter) || PBKDF2_ITER);
  const ok = constantTimeEqual(got, b64urlToBytes(s.pwHash));
  const path = `baep_secrets/${id}`;
  if (!ok) {
    // 틀린 횟수는 Firestore 가 직접 +1 해요 (동시에 여러 번 눌러도 정확히 세요)
    const r = await fs.commit([
      fs.wPatch(path, { lastFailAt: now }, { transforms: [{ fieldPath: 'fails', increment: { integerValue: '1' } }] }),
    ]);
    const tr = r.writeResults && r.writeResults[0] && r.writeResults[0].transformResults;
    const fails = tr && tr[0] ? fromValue(tr[0]) : Number(s.fails || 0) + 1;
    if (fails >= LOCK_FAILS) {
      await fs.patch(path, { fails: 0, lockUntil: now + LOCK_MS });
      return locked(LOCK_MS, cors);
    }
    return badLogin();
  }
  if (Number(s.fails) || Number(s.lockUntil)) await fs.patch(path, { fails: 0, lockUntil: 0 });

  const role = adminIds(env).has(id) ? 'admin' : s.role === 'mentor' ? 'mentor' : 'mentee';
  const token = await mintCustomToken(sa, 'acct:' + id, { acct: id, role, provider: 'password' });
  return json(200, { ok: true, token, acct: id, role }, cors);
}
function locked(ms, cors) {
  const sec = Math.max(1, Math.ceil(ms / 1000));
  return fail(429, 'LOCKED', `비밀번호를 ${LOCK_FAILS}번 틀려서 잠시 로그인을 멈췄어요. ${Math.ceil(sec / 60)}분 뒤에 다시 해 주세요`, { ...cors, 'Retry-After': String(sec) }, { retryAfter: sec });
}

/* ============================ 계정: 가입 ============================ */

/* 소셜 가입 계정 아이디: kakao<숫자> / naver<영숫자>. 규칙에 안 맞거나 20자가 넘으면 naver + 해시 15자 */
async function socialIdFor(uid) {
  const [provider, ...rest] = uid.split(':');
  const pid = rest.join(':');
  const clean = pid.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cand = provider + clean;
  if (provider === 'kakao' && /^\d+$/.test(pid) && ID_RE.test(cand)) return cand;
  if (provider === 'naver' && clean && ID_RE.test(cand)) return cand;
  return provider + (await sha256Hex(uid)).slice(0, 15);
}

async function signup(req, env, origins, cors) {
  const origin = req.headers.get('Origin');
  if (origin && !originOk(origin, origins)) return fail(403, 'ORIGIN', '허용되지 않은 사이트예요', cors);
  const sa = readServiceAccount(env);
  if (!sa) return fail(500, 'CONFIG', '서버에 Firebase 설정이 없어요', cors);
  const { body, error } = await readJson(req);
  if (error) return error === 'BAD_INPUT' ? badInput(cors) : badJson(cors);

  // 소셜 가입이면 ID 토큰부터 확인
  const bearer = (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  let social = null;
  if (bearer) {
    try {
      social = await verifyIdToken(bearer[1].trim(), sa.project_id);
    } catch (e) {
      console.log('id token rejected', e && e.message);
      return fail(401, 'BAD_TOKEN', '로그인 정보가 맞지 않아요. 다시 로그인해 주세요', cors);
    }
    if (!/^(kakao|naver):[^/]{1,100}$/.test(social.uid)) return fail(401, 'BAD_TOKEN', '카카오·네이버로 로그인한 뒤 가입해 주세요', cors);
  }

  const role = body.role;
  if (role !== 'mentee' && role !== 'mentor') return fail(400, 'BAD_ROLE', '배움님 또는 프렌드 중에서 골라 주세요', cors);

  let account, profile;
  try {
    account = cleanAccount(body.account);
    profile = role === 'mentor' ? cleanProfile(isObj(body.profile) ? body.profile : isObj(body.account && body.account.tu) ? body.account.tu : {}) : null;
  } catch (e) {
    if (e instanceof BadInput) return badInput(cors);
    throw e;
  }

  const fs = firestore(sa);
  const now = Date.now();

  /* ---- 소셜 가입 ---- */
  if (social) {
    const uid = social.uid;
    const provider = uid.split(':')[0];
    const existing = await linkedAccount(fs, uid);
    if (existing) return issueSocial(sa, uid, provider, existing, cors); // 이미 가입함 → 같은 계정 토큰 (몇 번 불러도 같아요)

    // 앱이 보낸 id 는 무시해요. 네이버 아이디가 대소문자만 다른 사람과 겹치면 해시 아이디로 한 번 더 시도해요.
    const first = await socialIdFor(uid);
    const hashed = provider + (await sha256Hex(uid)).slice(0, 15);
    for (const id of first === hashed ? [first] : [first, hashed]) {
      try {
        await fs.commit(signupWrites(fs, { id, uid, role, provider, account, profile, now, secret: { pwHash: '', salt: '', iter: 0 } }));
      } catch (e) {
        if (!(e instanceof FsError) || !e.conflict) throw e;
        // 동시에 두 번 눌렀으면 먼저 된 쪽 계정을 돌려줘요
        const again = await linkedAccount(fs, uid);
        if (again) return issueSocial(sa, uid, provider, again, cors);
        continue;
      }
      const token = await mintCustomToken(sa, uid, { acct: id, role, provider });
      return json(200, { ok: true, token, acct: id, role }, cors);
    }
    return fail(409, 'ID_TAKEN', '아이디를 만들지 못했어요. 운영자에게 알려 주세요', cors);
  }

  /* ---- 아이디/비밀번호 가입 ---- */
  const id = normId(body.id);
  if (!ID_RE.test(id)) return fail(400, 'BAD_ID', badIdMsg, cors);
  const pw = body.pw;
  if (typeof pw !== 'string' || pw.length < PW_MIN || pw.length > PW_MAX) {
    return fail(400, 'BAD_PW', `비밀번호는 ${PW_MIN}자 이상 ${PW_MAX}자 이하로 만들어 주세요`, cors);
  }
  const taken = () => fail(409, 'ID_TAKEN', '이미 있는 아이디예요. 다른 아이디를 적어 주세요', cors);
  if (reservedId(id, env)) return taken();
  const uid = 'acct:' + id;
  const secret = await hashPassword(pw);
  try {
    await fs.commit(signupWrites(fs, { id, uid, role, provider: 'password', account, profile, now, secret }));
  } catch (e) {
    if (e instanceof FsError && e.conflict) return taken();
    throw e;
  }
  // 가입 응답에는 절대 admin 을 주지 않아요 (운영자 권한은 로그인할 때만)
  const token = await mintCustomToken(sa, uid, { acct: id, role, provider: 'password' });
  return json(200, { ok: true, token, acct: id, role }, cors);
}

/* 가입 때 한 번에(전부 되거나 전부 안 되게) 만드는 문서들. 모두 "없을 때만 만들기" */
function signupWrites(fs, { id, uid, role, provider, account, profile, now, secret }) {
  const writes = [
    fs.wCreate(`baep_secrets/${id}`, { ...secret, role, fails: 0, lockUntil: 0, createdAt: now, uids: [uid] }),
    fs.wCreate(`baep_accounts/${id}`, {
      ...account,
      role,
      ...(role === 'mentor' ? { approved: false } : {}),
      createdAt: now,
      ownerUids: [uid],
    }),
  ];
  if (role === 'mentor') writes.push(fs.wCreate(`baep_profiles/${id}`, { ...(profile || {}), approved: false, acct: id, updatedAt: now }));
  if (provider !== 'password') writes.push(fs.wCreate(`baep_users/${uid}`, { acct: id, role, provider, createdAt: now }));
  return writes;
}

/* 소셜 uid 에 연결된 배프 계정 {acct, role} (없으면 null) */
async function linkedAccount(fs, uid) {
  if (!uid || uid.includes('/')) return null;
  const u = await fs.get(`baep_users/${uid}`);
  if (!u || !u.data || typeof u.data.acct !== 'string' || !u.data.acct) return null;
  const role = u.data.role === 'mentor' ? 'mentor' : 'mentee'; // 소셜 계정은 admin 이 될 수 없어요
  return { acct: u.data.acct, role };
}
async function issueSocial(sa, uid, provider, link, cors) {
  const token = await mintCustomToken(sa, uid, { acct: link.acct, role: link.role, provider });
  return json(200, { ok: true, token, acct: link.acct, role: link.role }, cors);
}

/* 요청에서 Firebase ID 토큰을 꺼내 확인 → {uid, claims} 또는 에러 응답 */
async function requireUser(req, sa, cors) {
  const m = (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return { res: fail(401, 'AUTH_REQUIRED', '로그인이 필요해요. 다시 로그인해 주세요', cors) };
  try {
    return { user: await verifyIdToken(m[1].trim(), sa.project_id) };
  } catch (e) {
    console.log('id token rejected', e && e.message);
    return { res: fail(401, 'BAD_TOKEN', '로그인 정보가 맞지 않아요. 다시 로그인해 주세요', cors) };
  }
}

/* ============================ 결제 승인 ============================ */

async function payConfirm(req, env, origins, cors) {
  if (!originOk(req.headers.get('Origin'), origins)) return fail(403, 'ORIGIN', '허용되지 않은 사이트예요', cors);
  if (!env.TOSS_SECRET_KEY) return fail(500, 'NO_KEY', '서버에 시크릿 키가 설정되지 않았어요', cors);
  const sa = readServiceAccount(env);
  if (!(req.headers.get('Authorization') || '').trim()) return fail(401, 'AUTH_REQUIRED', '로그인한 뒤 결제할 수 있어요', cors);
  if (!sa) return fail(500, 'CONFIG', '서버에 Firebase 설정이 없어요', cors);
  const { user, res } = await requireUser(req, sa, cors);
  if (res) return res;
  const acct = typeof user.claims.acct === 'string' ? user.claims.acct : '';
  if (!ID_RE.test(acct)) return fail(401, 'AUTH_REQUIRED', '가입을 마친 뒤 결제할 수 있어요', cors);

  const { body: b, error } = await readJson(req, 8 * 1024);
  if (error) return error === 'BAD_INPUT' ? badInput(cors) : badJson(cors);
  const paymentKey = typeof b.paymentKey === 'string' ? b.paymentKey : '';
  const orderId = typeof b.orderId === 'string' ? b.orderId : '';
  const amount = b.amount;
  const kind = b.kind;
  const refId = typeof b.refId === 'string' ? b.refId : '';

  if (!paymentKey || paymentKey.length > 200 || !/^[A-Za-z0-9_-]{6,64}$/.test(orderId)) {
    return fail(400, 'BAD_ORDER', '주문 정보가 잘못됐어요', cors);
  }
  if (!Number.isSafeInteger(amount) || !ALLOWED_AMOUNTS.has(amount)) return fail(400, 'BAD_AMOUNT', '결제 금액이 수업료와 달라요', cors);
  if ((kind !== 'lesson' && kind !== 'outing') || !/^[A-Za-z0-9_-]{1,128}$/.test(refId)) {
    return fail(400, 'BAD_ORDER', '무엇을 결제하는지 알 수 없어요', cors);
  }

  /* ① 결제 대상 문서를 먼저 확인해요 (주인·상태·금액) */
  const fs = firestore(sa);
  const targetPath = (kind === 'lesson' ? 'baep_requests/' : 'baep_outing_apps/') + refId;
  const [target, prevPay] = await fs.getMany([targetPath, `baep_payments/${orderId}`]);
  if (!target) return fail(404, 'REF_NOT_FOUND', '결제할 예약을 찾지 못했어요', cors);
  const d = target.data;
  if (kind === 'lesson') {
    if (d.from !== acct && d.payerAcct !== acct) return fail(403, 'NOT_OWNER', '내 예약만 결제할 수 있어요', cors);
  } else if (d.acct !== acct) return fail(403, 'NOT_OWNER', '내 신청만 결제할 수 있어요', cors);
  if (d.paid === true || prevPay) return fail(409, 'ALREADY_PAID', '이미 결제했어요', cors, { orderId: d.orderId || orderId });
  if (kind === 'lesson') {
    // 프렌드가 수락(st:'ok')한 요청만 결제해요. (열어둔 시간 바로 예약도 규칙이 확인한 뒤 st:'ok' 가 돼요)
    if (d.st !== 'ok') return fail(409, 'NOT_PAYABLE', '프렌드가 수락한 뒤에 결제할 수 있어요', cors);
    if (!LESSON_AMOUNTS.has(amount) || d.amount !== amount) return fail(400, 'BAD_AMOUNT', '결제 금액이 수업료와 달라요', cors);
  } else {
    const people = 1 + companionCount(d);
    if (people > OUTING_MAX_PEOPLE || amount !== OUTING_PRICE * people) return fail(400, 'BAD_AMOUNT', '결제 금액이 참가비와 달라요', cors);
  }
  const now = Date.now();
  if (d.payLock && d.payLock !== orderId && now - Number(d.payLockAt || 0) < PAY_LOCK_MS) {
    return fail(409, 'PAY_IN_PROGRESS', '다른 창에서 결제하고 있어요. 잠시 후 다시 확인해 주세요', cors);
  }
  /* ② "지금 이 주문으로 결제 중" 표시 (그 사이 누가 문서를 바꿨으면 실패 → 두 번 결제 방지) */
  try {
    await fs.patch(targetPath, { payLock: orderId, payLockAt: now }, { pre: { updateTime: target.updateTime } });
  } catch (e) {
    if (e instanceof FsError && (e.conflict || e.notFound)) return fail(409, 'PAY_IN_PROGRESS', '예약 정보가 막 바뀌었어요. 잠시 후 다시 해 주세요', cors);
    throw e;
  }

  /* ③ 토스 승인 */
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
  if (!r.ok) {
    await fs.patch(targetPath, {}, { remove: ['payLock', 'payLockAt'] }).catch((e) => console.log('unlock failed', e && e.message));
    return fail(r.status, j.code || 'TOSS', j.message || '승인에 실패했어요', cors);
  }

  /* ④ 결제 기록 + 대상 문서에 "결제됨" (한 번에) */
  const { secret, ...safe } = j; // 브라우저에는 secret 을 빼고 돌려줘요
  const payDoc = {
    acct,
    kind,
    refId,
    amount,
    method: (j.easyPay && j.easyPay.provider) || j.method || '',
    approvedAt: j.approvedAt || '',
    status: j.status || 'DONE',
    receipt: (j.receipt && j.receipt.url) || '',
    paymentKey,
    createdAt: now,
  };
  const writes = [
    fs.wCreate(`baep_payments/${orderId}`, payDoc),
    fs.wPatch(targetPath, { paid: true, paidAt: now, orderId, amount }, { remove: ['payLock', 'payLockAt'] }),
  ];
  let recorded = false;
  for (let t = 0; t < 2 && !recorded; t++) {
    try {
      await fs.commit(writes);
      recorded = true;
    } catch (e) {
      console.log('PAYMENT RECORD FAILED', orderId, e && e.message); // 운영자가 토스 관리자 화면과 맞춰 봐야 해요
    }
  }
  return json(200, { ok: true, ...safe, recorded }, cors);
}
/* 동반자 수: companions 배열 (예전 앱 모양 comp:{...} 하나도 1명으로 셈) */
function companionCount(d) {
  if (Array.isArray(d.companions)) return d.companions.length;
  return isObj(d.comp) ? 1 : 0;
}

/* ============================ 간편로그인 ============================ */

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
  const failTo = (code) => errorRedirect(ret, code, [clearNonceCookie]);

  // 사용자가 취소했거나 카카오/네이버가 오류를 돌려준 경우
  const err = q.get('error');
  if (err) {
    const desc = (q.get('error_description') || '').toLowerCase();
    const cancelled = err === 'access_denied' || /cancel/.test(desc) || /cancel/.test(err);
    return failTo(cancelled ? 'cancelled' : 'provider');
  }
  if (!st.ok) return failTo('state'); // 10분이 지났어요
  if (!getCookie(req, NONCE_COOKIE) || getCookie(req, NONCE_COOKIE) !== data.n) return failTo('state');

  const code = q.get('code');
  if (!code) return failTo('token');
  if (!providerConfigured(provider, env)) return failTo('config');
  const sa = readServiceAccount(env);
  if (!sa) return failTo('config');

  const redirectUri = `${url.origin}/auth/${provider}/callback`;

  // ① 코드 → 액세스 토큰
  let accessToken;
  try {
    accessToken = provider === 'kakao' ? await kakaoToken(code, redirectUri, env) : await naverToken(code, q.get('state'), env);
  } catch (e) {
    console.log('token exchange failed', provider, e && e.message);
    return failTo('token');
  }
  if (!accessToken) return failTo('token');

  // ② 회원정보
  let profile;
  try {
    profile = provider === 'kakao' ? await kakaoProfile(accessToken) : await naverProfile(accessToken);
  } catch (e) {
    console.log('profile failed', provider, e && e.message);
    return failTo('profile');
  }
  if (!profile || !profile.id) return failTo('profile');

  // ③ 이미 가입한 사람인지 (baep_users/<uid>) — 확인을 못 하면 "가입 전"으로 보내요 (가입하면 같은 계정을 돌려줘요)
  const uid = `${provider}:${profile.id}`;
  let link = null;
  try {
    link = await linkedAccount(firestore(sa), uid);
  } catch (e) {
    console.log('link lookup failed', e && e.message);
  }

  // ④ Firebase 커스텀 토큰
  let token;
  try {
    token = await mintCustomToken(sa, uid, link ? { acct: link.acct, role: link.role, provider } : { provider });
  } catch (e) {
    console.log('custom token failed', e && e.message);
    return failTo('firebase');
  }

  /* 앱으로 돌려보내기: <return>#baep_auth=<base64url(UTF-8 JSON)>
     앱(브라우저)에서 읽는 법 — 한글 이름이 깨지지 않게 꼭 TextDecoder 로 풀어 주세요:
       const s = location.hash.slice('#baep_auth='.length);
       const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
       const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
       const auth = JSON.parse(new TextDecoder().decode(bytes)); // {token, uid, provider, name, email, phone, acct?, role?}
       history.replaceState(null, '', location.pathname + location.search); // 주소창에서 토큰 지우기
       await firebase.auth().signInWithCustomToken(auth.token);
     값이 없으면 name/email/phone 은 빈 문자열('')이에요. acct/role 은 이미 가입한 사람일 때만 있어요. */
  const payload = {
    token,
    uid,
    provider,
    name: profile.name || '',
    email: profile.email || '',
    phone: profile.phone || '',
    ...(link ? { acct: link.acct, role: link.role } : {}),
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

/* Firebase 커스텀 토큰 (앱에서 signInWithCustomToken 으로 로그인할 때 쓰는 1시간짜리 표)
   claims 는 로그인 뒤 ID 토큰에 그대로 실려서, Firestore 규칙의 request.auth.token.acct / role 이 돼요. */
async function mintCustomToken(sa, uid, claims) {
  const key = await importPrivateKey(sa);
  const iat = nowSec();
  return signJwtRS256(
    { iss: sa.client_email, sub: sa.client_email, aud: FIREBASE_AUD, iat, exp: iat + 3600, uid, claims: claims || {} },
    key,
  );
}

/* ---- Firebase ID 토큰 확인 (요청이 진짜 본인인지) ---- */
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

/* ============================ 회원 탈퇴 ============================ */

/* 탈퇴해도 남기는 수업 요청(수락·결제된 것)에서 지우는 개인정보 필드.
   남는 것: 누가(acct 아이디)·언제·무엇을·얼마에 — 전자상거래법상 거래 기록(5년). */
const SCRUB_REMOVE = ['age', 'area', 'dist', 'memo', 'place', 'phone', 'ph', 'address', 'addr', 'road', 'jibun', 'apt', 'dong', 'name'];
const WITHDRAWN_NAME = '탈퇴한 회원';

async function authDelete(req, env, origins, cors) {
  // 브라우저에서 온 요청이면 허용된 앱 주소인지 확인해요 (토큰 검사는 아래에서 따로 해요)
  const origin = req.headers.get('Origin');
  if (origin && !originOk(origin, origins)) return fail(403, 'ORIGIN', '허용되지 않은 사이트예요', cors);

  const sa = readServiceAccount(env);
  if (!sa) return fail(500, 'CONFIG', '서버에 Firebase 설정이 없어요', cors);
  const { user, res } = await requireUser(req, sa, cors);
  if (res) return res;
  const uid = user.uid;
  const fs = firestore(sa);

  // ① 어떤 배프 계정인지: 토큰의 acct → (없으면) acct:<아이디> uid → (없으면) baep_users 연결
  let acct = typeof user.claims.acct === 'string' && ID_RE.test(user.claims.acct) ? user.claims.acct : '';
  if (!acct && uid.startsWith('acct:') && ID_RE.test(uid.slice(5))) acct = uid.slice(5);
  if (!acct && !uid.includes('/')) {
    const u = await fs.get(`baep_users/${uid}`);
    if (u && typeof u.data.acct === 'string' && ID_RE.test(u.data.acct)) acct = u.data.acct;
  }

  // ② 이 계정에 연결된 모든 로그인(uid) 모으기
  //    baep_secrets.uids(서버만 씀)는 그대로 믿고, baep_accounts.ownerUids 는 baep_users 연결로 한 번 더 확인해요.
  const trusted = new Set([uid]);
  const maybe = new Set();
  const deleted = { accounts: 0, secrets: 0, profiles: 0, users: 0, outingApps: 0, requests: 0, requestsScrubbed: 0, teams: 0, authUsers: 0 };
  if (acct) {
    const [sec, acc, prof] = await fs.getMany([`baep_secrets/${acct}`, `baep_accounts/${acct}`, `baep_profiles/${acct}`]);
    for (const x of (sec && sec.data.uids) || []) if (typeof x === 'string') trusted.add(x);
    for (const x of (acc && acc.data.ownerUids) || []) if (typeof x === 'string') maybe.add(x);
    trusted.add('acct:' + acct);
    deleted.secrets = sec ? 1 : 0;
    deleted.accounts = acc ? 1 : 0;
    deleted.profiles = prof ? 1 : 0;
  }
  const okUid = (x) => typeof x === 'string' && x.length > 0 && x.length <= 128 && !x.includes('/');
  const candidates = [...new Set([...trusted, ...maybe])].filter(okUid);
  const candDocs = await fs.getMany(candidates.map((x) => `baep_users/${x}`));
  const uidList = candidates.filter((x, i) => trusted.has(x) || (acct && candDocs[i] && candDocs[i].data.acct === acct));
  deleted.users = candidates.filter((x, i) => candDocs[i] && uidList.includes(x)).length;

  // ③ Firestore 정리 (없는 문서를 지워도 괜찮아요 → 몇 번 불러도 같아요)
  const writes = uidList.map((x) => fs.wDelete(`baep_users/${x}`));
  if (acct) {
    writes.push(fs.wDelete(`baep_accounts/${acct}`), fs.wDelete(`baep_secrets/${acct}`), fs.wDelete(`baep_profiles/${acct}`));

    for (const a of await fs.query('baep_outing_apps', 'acct', acct)) {
      writes.push(fs.wDelete(a.path));
      deleted.outingApps++;
    }
    for (const r of await fs.query('baep_requests', 'from', acct)) {
      const keep = r.data.paid === true || !['wait', 'no', 'cancel'].includes(r.data.st);
      if (!keep) {
        writes.push(fs.wDelete(r.path));
        deleted.requests++;
      } else if (!r.data.scrubbed) {
        // 수락·결제된 요청은 거래 기록으로 남기되, 이름·주소·연락처 같은 개인정보는 지워요
        writes.push(fs.wPatch(r.path, { who: WITHDRAWN_NAME, fromName: WITHDRAWN_NAME, scrubbed: true, scrubbedAt: Date.now() }, { remove: SCRUB_REMOVE }));
        deleted.requestsScrubbed++;
      }
    }
    // 나들이 팀 명단에서 빼기
    const teams = new Map();
    for (const f of ['memberAccts', 'friendAccts']) for (const t of await fs.query('baep_outing_teams', f, acct, 'ARRAY_CONTAINS')) teams.set(t.path, t);
    for (const t of teams.values()) {
      const rm = { removeAllFromArray: { values: [toValue(acct)] } };
      writes.push(fs.wPatch(t.path, { updatedAt: Date.now() }, { transforms: [{ fieldPath: 'memberAccts', ...rm }, { fieldPath: 'friendAccts', ...rm }] }));
      deleted.teams++;
    }
  }
  // commit 한 번에 최대 500개라 나눠서 보내요
  for (let i = 0; i < writes.length; i += 400) await fs.commit(writes.slice(i, i + 400));

  // ④ Firebase 로그인 계정 지우기 (이미 없으면 넘어가요)
  for (const x of uidList) if (await deleteAuthUser(sa, x)) deleted.authUsers++;

  // ⑤ 카카오 연결 끊기 (KAKAO_ADMIN_KEY 가 있을 때)
  let kakaoUnlinked = false;
  if (env.KAKAO_ADMIN_KEY) {
    for (const x of uidList.filter((u) => u.startsWith('kakao:'))) {
      try {
        const r = await fetch('https://kapi.kakao.com/v1/user/unlink', {
          method: 'POST',
          headers: {
            Authorization: 'KakaoAK ' + env.KAKAO_ADMIN_KEY,
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
          },
          body: formBody({ target_id_type: 'user_id', target_id: x.slice('kakao:'.length) }),
        });
        if (r.ok) kakaoUnlinked = true;
        else console.log('kakao unlink failed', r.status);
      } catch (e) {
        console.log('kakao unlink error', e && e.message);
      }
    }
  }
  // 네이버는 사용자가 네이버 → 내정보 → 이력관리 → 연결된 서비스 관리 에서 직접 끊을 수 있어요.
  // baep_payments(결제 기록)는 전자상거래법(5년) 때문에 남겨요. 안에는 acct 아이디·금액·일시만 있어요.
  return json(200, { ok: true, uid, acct: acct || null, deleted, kakaoUnlinked }, cors);
}
