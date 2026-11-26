# 배프 v2 보안 구조 (서버·클라이언트 공통 계약)

이 문서는 서버(server/worker.js)와 앱(web/*)이 **똑같이 따라야 하는 약속**이에요. 이름·필드·주소를 바꾸지 마세요.

Firebase 프로젝트: `baep-f3465` (Firestore 서울). 워커: `https://baep.bc0521.workers.dev`.
Firestore DB는 새로 만든 빈 DB라 옛 데이터 이전은 필요 없어요.

## 0. 원칙
- 비밀번호 확인·가입·결제 승인·관리자 권한은 **전부 서버(워커)** 가 해요. 앱은 서버가 준 Firebase custom token 으로만 로그인해요.
- Firestore 보안 규칙은 `request.auth.token.acct`(내 계정 아이디)와 `request.auth.token.role` 로 "내 것만" 허용해요.
- 시연 계정(baeum / friend / admin, 비밀번호 1234)은 **이 기기 안에서만** 동작하고 Firestore·서버를 절대 쓰지 않아요.

## 1. 신원(토큰)
- 아이디/비번 계정: Firebase uid = `acct:<아이디>`
- 카카오/네이버 계정: uid = `kakao:<id>` / `naver:<id>` (기존과 같음)
- custom token 의 `claims`(= ID 토큰에 그대로 실림):
  - `acct`: 연결된 배프 계정 아이디 (없으면 claim 자체가 없음 = 아직 가입 전 소셜 사용자)
  - `role`: `'mentee'` | `'mentor'` | `'admin'`
  - `provider`: `'password'` | `'kakao'` | `'naver'`
- 관리자: 워커 환경변수 `ADMIN_IDS`(쉼표 구분 계정 아이디 목록)에 있는 계정만 로그인 때 `role:'admin'` 을 받아요. 가입으로는 절대 admin 이 될 수 없어요.
- 아이디 규칙: 영문 소문자로 시작, 영문 소문자·숫자 4~20자 (`/^[a-z][a-z0-9]{3,19}$/`). 소셜 가입 계정은 서버가 `kakao<숫자>` / `naver<영숫자>` 형태로 만들어 줘요(앱 기존 방식과 같게, 20자 넘으면 서버가 해시로 줄임).
- 앱은 로그인 직후 `firebase.auth().signInWithCustomToken(token)`. 익명 로그인은 **로그인 전 공개 정보(프렌드 목록, 나들이 목록) 읽기용**으로만 유지.

## 2. 워커 API (모두 JSON, CORS 는 ALLOWED_ORIGINS)
에러 응답 형식: `{ "ok": false, "code": "<영문코드>", "message": "<한국어 해요체>" }` + 알맞은 HTTP 상태.

| 메서드 경로 | 인증 | 요청 | 응답 |
|---|---|---|---|
| GET `/auth/check-id?id=` | 없음 | — | `{ok:true, available:true|false}` (형식이 틀리면 `BAD_ID` 400). 가입 화면의 "아이디 중복 확인"용 |
| POST `/auth/login` | 없음 | `{id, pw}` | `{ok:true, token, acct, role}` · 실패 `BAD_LOGIN`(401) · 5번 틀리면 10분 잠금 `LOCKED`(429) |
| POST `/auth/signup` | 없음(아이디/비번) 또는 `Authorization: Bearer <소셜 사용자 ID토큰>` | `{id?, pw?, role:'mentee'|'mentor', account:{...}, profile?:{...}}` | `{ok:true, token, acct, role}` · `ID_TAKEN`(409) · `BAD_ID`/`BAD_PW`/`BAD_ROLE`/`BAD_INPUT`(400) |
| GET `/auth/kakao/start` 등 | — | (기존과 같음) | 콜백 fragment `#baep_auth=` 의 JSON 에 `acct`, `role` 추가 (이미 가입한 소셜 사용자면 들어 있음) |
| POST `/auth/delete` | Bearer ID토큰 | `{}` | `{ok:true, deleted:{...}, kakaoUnlinked}` — 서버가 Firestore 문서·Auth 사용자까지 지움 |
| POST `/pay/confirm` | Bearer ID토큰 (필수, acct 있어야 함) | `{paymentKey, orderId, amount, kind:'lesson'|'outing', refId}` | Toss 승인 후 `{ok:true, ...토스 응답(secret 제거)}` · 서버가 결제 기록과 대상 문서의 결제 상태를 직접 기록 |
| POST `/` | — | 예전 호환: Bearer 없으면 `AUTH_REQUIRED`(401) | |
| GET `/` | — | 상태 점검(기존 + `adminIds:<개수>`, `firestore:<bool>`) | |

- 비밀번호 저장: PBKDF2-SHA256, 무작위 16바이트 salt, 반복 100,000회 → `baep_secrets/{acct}` = `{pwHash, salt, iter, role, fails, lockUntil, createdAt, uids:[...]}` (클라이언트 접근 불가).
- 가입 시 서버가 만드는 문서:
  - `baep_accounts/{acct}` = 앱이 보낸 `account` 객체 + 서버가 덮어쓰는 필드 `{role, approved:(mentor면 false, 아니면 없음), createdAt, ownerUids:[uid]}`.
    - 보낸 `account` 에 `pw`, `role`, `approved`, `paid*` 같은 필드가 있으면 서버가 버려요.
  - mentor 면 `baep_profiles/{acct}` = `profile` 객체(공개해도 되는 필드만: name, school, major, grade, age, gender, dong, road, rad, intro, topics, wdays, times) + `{approved:false, acct, updatedAt}`.
  - 소셜 가입이면 `baep_users/{uid}` = `{acct, role, provider, createdAt}`.
- 결제 승인(`/pay/confirm`) 후 서버 기록:
  - `baep_payments/{orderId}` = `{acct, kind, refId, amount, method, approvedAt, status:'DONE', receipt}`
  - kind `'lesson'` → `baep_requests/{refId}` 에 `{paid:true, paidAt, orderId, amount}` (요청 문서의 `from` 이 결제자 acct 이거나, 자녀 결제의 경우 `payerAcct` 가 결제자 acct 여야 함)
  - kind `'outing'` → `baep_outing_apps/{refId}` 에 `{paid:true, paidAt, orderId, amount}` (`acct` 가 결제자)
  - 금액 검증: lesson 은 요청 문서의 `amount` 와 일치, outing 은 `OUTING_PRICE × 인원(1+동반자 수)` 와 일치 (서버 상수 `OUTING_PRICE = 60000`).

## 3. Firestore 컬렉션과 규칙 요약 (server/firestore.rules)
`me()` = `request.auth.token.acct`, `isAdmin()` = `request.auth.token.role == 'admin'`, `signedIn()` = `request.auth != null`, `member()` = `me() != null`.

| 컬렉션 | 읽기 | 쓰기 |
|---|---|---|
| `baep_secrets/{id}` | 금지 | 금지 (서버만) |
| `baep_users/{uid}` | 본인 uid | 금지 (서버만) |
| `baep_accounts/{id}` | 본인(`me()==id`) · 관리자 | 생성 금지(서버만) · 본인 수정 가능하되 `role, approved, createdAt, ownerUids` 변경 금지 · 관리자는 `approved` 만 수정 가능 · 삭제 금지(서버만) |
| `baep_profiles/{id}` | `approved==true` 면 로그인 전(익명) 포함 누구나 · 미승인은 본인·관리자 | 생성 금지(서버만) · 본인 수정(단 `approved, acct` 변경 금지) · 관리자 `approved` 수정 |
| `baep_requests/{rid}` | `from==me()` · `to==me()` · `payerAcct==me()` · 관리자 | 생성: `from==me()` 이고 role mentee, `st=='wait'`, `paid` 없음 · 수정: 받은 프렌드는 `st`(wait→ok/no), `why`, `updated` 만 · 보낸 사람은 `st`→`cancel`, 일정 필드 · `paid*` 는 아무도(서버만) · 삭제 금지 |
| `baep_payments/{orderId}` | `acct==me()` · 관리자 | 금지(서버만) |
| `baep_outings/{oid}` | 누구나(익명 포함) | 관리자만 |
| `baep_outing_apps/{oid_acct}` | 본인 · 관리자 · 이 신청자가 속한 팀의 프렌드(`friendAccts` 에 me()) | 생성/수정: 본인(`acct==me()`), 단 `paid*`, `team`, `status` 는 금지 · 관리자는 `team`, `status` 수정 가능 |
| `baep_outing_teams/{oid_teamNo}` | 관리자 · `memberAccts` 또는 `friendAccts` 에 me() | 관리자만 |
| `baep_sms/{id}` | 관리자 | 관리자 (문자 기록, 실제 발송 아님) |
| 그 밖 | 금지 | 금지 |

규칙에서 쓰는 쿼리는 반드시 규칙과 맞게: 예) 프렌드 받은 요청 `where('to','==',me)`, 내 요청 `where('from','==',me)`, 공개 프렌드 `baep_profiles where('approved','==',true)`, 승인 대기 `baep_profiles where('approved','==',false)` (관리자만).

## 4. 관리자 화면 분리
- 운영자 화면은 `web/admin.html` 로만 들어가요 (`index.html?app=admin` 으로 넘겨서 같은 코드를 쓰되, 관리자 모드일 때만 운영자 화면을 그림).
- 사용자 앱(`index.html`, 안드로이드 앱)에서는 운영자 링크·운영자 로그인이 보이지 않아요. 안드로이드 앱 빌드에는 `admin.html` 이 들어가지 않아요(gradle `ignoreAssetsPattern`).
- 진짜 보호는 화면이 아니라 서버 규칙: 관리자 claim 이 없으면 운영자 화면을 열어도 데이터가 안 읽혀요.
- 시연 모드(`window.BAEP_MODE==='demo'`, 기본값)에서는 사용자 앱 로그인 화면의 "운영자" 시연 링크를 남겨 두되, 시연 계정 admin/1234 는 이 기기 안의 가짜 데이터만 보여요. `'live'` 모드에서는 시연 계정·시연 버튼·시연 막대가 모두 숨겨져요.
