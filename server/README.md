# 배프 서버 (Cloudflare Worker) — v2

`worker.js` 파일 하나가 **아이디/비밀번호 계정 + 결제 승인 + 카카오·네이버 로그인 + 회원 탈퇴**를 다 해요.
서버와 앱이 함께 지키는 약속은 `docs/ARCH-v2.md` 에 있어요. (주소·필드 이름은 그 문서가 기준이에요)

| 파일 | 뭐예요 |
|---|---|
| `worker.js` | Cloudflare 에 붙여넣을 서버 코드 |
| `firestore.rules` | Firebase Firestore 보안 규칙 (앱이 "내 것만" 읽고 쓰게) |
| `rules-checklist.md` | 규칙을 게시한 뒤 직접 확인할 표 (53가지) |
| `test-worker.mjs` | 서버 자동 점검 (`node test-worker.mjs`, 설치할 것 없음) |

---

## 0. v2 에서 바뀐 것

- **비밀번호 확인을 서버가 해요.** 예전엔 앱이 Firestore 에서 남의 계정 문서(비밀번호 포함)를 읽어서 비교했어요. 이제 비밀번호는 서버만 볼 수 있는 `baep_secrets` 에 **암호화(PBKDF2, 10만 번)** 해서 저장하고, 앱은 서버가 준 "로그인 표(토큰)"로만 로그인해요.
- **5번 틀리면 10분 잠겨요.** (남이 비밀번호를 계속 넣어 보는 것 막기)
- **가입도 서버가 해요.** 앱이 보낸 내용 중 `role`(역할)·`approved`(승인)·`paid`(결제) 같은 중요한 칸은 서버가 버리고 직접 정해요.
- **결제 승인 전에 서버가 예약을 확인해요.** 내 예약인지, 프렌드가 수락했는지, 금액이 맞는지, 이미 결제했는지 본 다음에만 토스에 승인을 요청해요. 결제 기록도 서버가 직접 적어요.
- **결제 주소는 이제 로그인해야 쓸 수 있어요.** 로그인 표 없이 부르면 `AUTH_REQUIRED` 로 거절해요.
- **탈퇴하면 서버가 다 지워요.** 계정·프로필·신청서·로그인 계정까지 서버가 지워요. (앱이 직접 지우던 방식은 끝)
- **운영자(관리자)는 `ADMIN_IDS` 에 적은 계정만** 돼요. 가입으로는 절대 운영자가 될 수 없어요.
- **Firestore 규칙을 새로 짰어요.** 내 계정·내 예약·내 결제만 보이고, 남의 것은 못 봐요.

## 1. 다시 올리기 (코드를 고쳤을 때마다)

1. 깃허브에서 `server/worker.js` 를 열고 **Raw** 버튼 → 화면 전체 선택(Ctrl+A) → 복사(Ctrl+C)
2. https://dash.cloudflare.com → **Workers & Pages** → `baep` 워커 → **Edit code**
3. 안에 있던 코드를 전부 지우고(Ctrl+A → Delete) 붙여넣기(Ctrl+V)
4. 오른쪽 위 **Deploy** → 끝나면 `https://baep.bc0521.workers.dev/` 를 열어서 `"version":2` 가 보이는지 확인

> 처음 만드는 경우: Workers & Pages → Create → Create Worker → 이름 `baep` → Deploy → 위 2~4번.

## 2. 환경변수

워커 → **Settings** → **Variables and Secrets** → **Add** → 이름·값 입력.
Type 이 **Secret** 인 것은 꼭 Secret 으로 골라요 (한 번 넣으면 값이 다시 안 보여요. 그게 정상이에요).
다 넣고 **Deploy** 를 눌러야 적용돼요.

| 이름 | Type | 넣을 값 | 꼭? |
|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | **Secret** | Firebase 서비스 계정 키 JSON 파일 내용 **통째로** (아래 설명) | **꼭** (계정·결제·탈퇴·로그인 전부) |
| `AUTH_STATE_SECRET` | **Secret** | 아무 긴 랜덤 문자열 (아래 설명) | 카카오·네이버 |
| `TOSS_SECRET_KEY` | **Secret** | **지금은** `web/payment-config.js` 의 `testSecretKey` 값(토스 문서용 공개 테스트 키, `test_gsk_docs_` 로 시작)을 그대로 넣어요. 진짜 결제를 시작하면 `live_gsk_...` 로 바꿔요 | 결제 |
| `ADMIN_IDS` | Text | 운영자 계정 아이디, 여러 개면 쉼표로 (예: `baepadmin`) — 아래 "운영자 만들기" 순서를 꼭 지켜요 | 운영자 |
| `ALLOWED_ORIGINS` | Text | 앱 주소들, 쉼표로 구분. 비워두면 `https://nanaumsin.github.io,https://hohowww12.github.io,https://appassets.androidplatform.net` | 선택 |
| `KAKAO_REST_KEY` | Text | 카카오 디벨로퍼스 → 내 애플리케이션 → 앱 키 → **REST API 키** | 카카오 |
| `KAKAO_CLIENT_SECRET` | **Secret** | 카카오 → 보안 → Client Secret 을 "사용함"으로 켰을 때만 그 코드 | 선택 |
| `KAKAO_ADMIN_KEY` | **Secret** | 카카오 → 앱 키 → **Admin 키** (탈퇴 때 카카오 연결 끊기용) | 선택 |
| `NAVER_CLIENT_ID` | Text | 네이버 개발자센터 → 내 애플리케이션 → Client ID | 네이버 |
| `NAVER_CLIENT_SECRET` | **Secret** | 같은 곳의 Client Secret | 네이버 |

이미 넣어 둔 값(`AUTH_STATE_SECRET`, `KAKAO_REST_KEY`, `KAKAO_CLIENT_SECRET`, `FIREBASE_SERVICE_ACCOUNT`)은 그대로 두면 돼요.
**새로 넣을 것: `TOSS_SECRET_KEY`(Secret), `ADMIN_IDS`(Text).**

**AUTH_STATE_SECRET 만들기** — 브라우저 아무 페이지에서 F12 → Console 에 `crypto.randomUUID() + crypto.randomUUID()` → 나온 글자(따옴표 빼고)를 넣어요.

**FIREBASE_SERVICE_ACCOUNT 받기** — Firebase 콘솔 → ⚙ 프로젝트 설정 → **서비스 계정** 탭 → **새 비공개 키 생성** → JSON 파일
→ 메모장으로 열어 `{` 부터 `}` 까지 전부 복사 → 값에 붙여넣기.
⚠ 이 파일은 프로젝트 "마스터 열쇠"예요. 깃허브·카톡에 올리지 말고, 넣은 뒤엔 컴퓨터에서 지워요.
(서버는 이 열쇠로 Firestore 와 Firebase 로그인 계정을 직접 관리해요. 그래서 서버가 쓰는 건 보안 규칙을 거치지 않아요.)

## 3. 잘 됐는지 확인

브라우저로 `https://baep.bc0521.workers.dev/` 를 열어요.

```json
{"ok":true, "version":2, "configured":{"toss":true,"kakao":true,"naver":false,"firebase":true,"stateSecret":true,"kakaoUnlink":false},
 "firestore":true, "adminIds":1, ...}
```

- `firestore:false` → `FIREBASE_SERVICE_ACCOUNT` 를 덜 복사했을 가능성이 커요.
- `adminIds` 는 운영자 계정 **개수**만 보여줘요(아이디는 안 보여요).
- 키 값 자체는 절대 보여주지 않으니 안심하세요.

## 4. Firestore 규칙 게시하기

1. https://console.firebase.google.com → 배프 프로젝트 → **Firestore Database** → 위쪽 **규칙** 탭
2. 안에 있던 내용을 전부 지우고 `firestore.rules` 내용을 통째로 붙여넣기 → **게시**
3. 1분쯤 뒤 `rules-checklist.md` 표대로 **규칙 플레이그라운드**에서 몇 줄 확인해 봐요.
4. Authentication → 로그인 방법 → **익명** 은 계속 켜 두세요 (로그인 전 프렌드 목록·나들이 목록 보기용)

## 5. 운영자(관리자) 만들기 — 순서가 중요해요

1. 앱(`index.html`)에서 **보통 회원가입**으로 운영자용 계정을 만들어요. 예: 아이디 `baepadmin`, 긴 비밀번호
2. 워커 환경변수 `ADMIN_IDS` 에 `baepadmin` 을 넣고 **Deploy**
3. `admin.html` 에서 `baepadmin` 으로 로그인 → 운영자 화면이 열려요

- **꼭 1번(가입)을 먼저** 해요. `ADMIN_IDS` 에 먼저 넣으면 그 아이디로는 가입이 막혀요 (남이 그 아이디를 먼저 가져가서 운영자가 되는 걸 막으려고요).
- 운영자 권한은 **아이디/비밀번호로 로그인할 때만** 생겨요. 가입 응답이나 카카오·네이버 로그인으로는 생기지 않아요.
- 운영자를 빼려면 `ADMIN_IDS` 에서 지우고 Deploy → 다음 로그인부터 보통 회원이에요. (이미 받은 로그인 표는 최대 1시간 더 쓸 수 있어요)
- 운영자 비밀번호는 길게(12자 이상) 만들어 주세요.

## 6. 앱(web/)에 주소 넣기

- `web/payment-config.js` → `confirmUrl: 'https://baep.bc0521.workers.dev/pay/confirm'`
- `web/auth-config.js` → `workerUrl: 'https://baep.bc0521.workers.dev'` (끝에 `/` 없이)

결제 금액은 `worker.js` 맨 위 `LESSON_AMOUNTS`(20,000 · 25,000 · 30,000 · 40,000원)와 `OUTING_PRICE`(나들이 1인 60,000원)에 있어요.
앱 요금을 바꾸면 여기와 `firestore.rules` 의 `lessonAmountOk` 도 같이 바꾸고 다시 Deploy·게시해요.

## 7. 서버 주소 한눈에 보기 (앱 만드는 분용)

모든 실패 응답은 `{"ok":false, "code":"영문코드", "message":"한국어 안내"}` 모양이에요.

| 주소 | 하는 일 | 자주 나오는 실패 코드 |
|---|---|---|
| `GET /auth/check-id?id=` | 아이디 중복 확인 → `{ok, available}` | `BAD_ID` |
| `POST /auth/login` `{id, pw}` | 로그인 → `{ok, token, acct, role}` | `BAD_LOGIN`(401), `LOCKED`(429, `retryAfter` 초) |
| `POST /auth/signup` | 가입 → `{ok, token, acct, role}` | `BAD_ID`, `BAD_PW`, `BAD_ROLE`, `BAD_INPUT`, `ID_TAKEN`(409) |
| `POST /pay/confirm` (Bearer) | 결제 승인 → `{ok:true, …토스 응답, recorded}` | `AUTH_REQUIRED`, `NOT_OWNER`(403), `NOT_PAYABLE`(409), `ALREADY_PAID`(409), `PAY_IN_PROGRESS`(409), `BAD_AMOUNT`, `REF_NOT_FOUND`(404) |
| `POST /auth/delete` (Bearer) | 탈퇴 → `{ok, deleted:{…개수}, kakaoUnlinked}` | `AUTH_REQUIRED`, `BAD_TOKEN` |
| `GET /` | 설정 확인 | |
| 어디서든 | 저장소 연결이 잠깐 안 될 때 | `DB`(503) — 잠시 뒤 다시 |

- 아이디는 영문 소문자로 시작, 영문 소문자·숫자 4~20자. 대문자로 적어도 서버가 소문자로 바꿔요(휴대폰 자판이 첫 글자를 대문자로 만들 때가 많아서요).
- `admin, baeum, friend, demo, baep, root, system, test` 와 `kakao…`, `naver…` 로 시작하는 아이디는 가입에 못 써요 (시연 계정·간편로그인용).
- **비밀번호는 6자 이상 64자 이하**예요. 어르신이 쓰기 쉽게 8자가 아니라 6자로 정했어요(숫자 6자리도 돼요). 대신 5번 틀리면 10분 잠기고, 비밀번호는 서버만 알아요.
- 가입한 프렌드는 `approved:false` 로 시작해요. 운영자가 승인하면 공개 목록에 나와요.

## 8. 저장 형식 약속

- 서버가 적는 시각(`createdAt`, `updatedAt`, `paidAt`, `lockUntil`, `scrubbedAt`)은 모두 **밀리초 숫자**예요 (앱의 `Date.now()` 와 같아요).
- 결제 기록(`baep_payments/<주문번호>`)의 `approvedAt` 만 토스가 준 글자 그대로예요 (예: `2026-11-26T10:00:00+09:00`).
- 결제 기록에는 나중에 환불할 때 쓰려고 `paymentKey` 와 `createdAt` 도 같이 적어요.

## 9. 결제는 이렇게 돌아가요

1. 배움님이 수업을 요청해요 (`baep_requests`, `st:'wait'`, `amount` 포함)
2. 프렌드가 수락해요 (`st:'ok'`). 프렌드가 열어둔 요일·시간이면 배움님이 바로 `st:'ok'` 로 예약할 수 있어요(규칙이 프렌드 프로필의 `wdays`·`times` 를 확인해요).
3. 토스 결제창 → 앱이 `POST /pay/confirm` (로그인 표와 함께)
4. 서버가 확인: 내 요청인지(`from` 또는 자녀 `payerAcct`) · `st` 가 `'ok'` 인지 · 금액이 문서의 `amount` 와 같은지 · 이미 결제했는지
5. 다른 창에서 같은 예약을 동시에 결제하지 못하게 잠깐 표시(`payLock`)를 하고 → 토스 승인
6. 서버가 `baep_payments/<주문번호>` 를 만들고 예약 문서에 `{paid:true, paidAt, orderId, amount}` 를 적어요
7. 만약 토스 승인은 됐는데 기록이 실패하면 `recorded:false` 가 와요 → 운영자가 Cloudflare **Logs** 의 `PAYMENT RECORD FAILED` 와 토스 관리자 화면을 맞춰 봐 주세요.

나들이는 `kind:'outing'`, `refId:'<나들이번호>_<아이디>'` 이고, 금액은 `60,000원 × (1 + 동반자 수)` 예요.

## 10. 탈퇴는 이렇게 돌아가요

앱이 `POST /auth/delete` (헤더 `Authorization: Bearer <Firebase ID 토큰>`) 하나만 부르면 서버가:

- **지워요**: `baep_accounts`, `baep_secrets`, `baep_profiles`, `baep_users`(연결된 모든 로그인), 내 나들이 신청서 전부,
  아직 수락 안 됐거나 거절·취소된 내 수업 요청(결제 안 된 것)
- **나들이 팀 명단**에서 내 아이디를 빼요
- **남겨요(거래 기록)**: 수락됐거나 결제된 수업 요청은 남기되, 이름은 `탈퇴한 회원` 으로 바꾸고
  `age, area, dist, memo, place, phone, ph, address, addr, road, jibun, apt, dong, name` 칸은 지워요.
- **남겨요(5년)**: `baep_payments` 결제 기록 (전자상거래법). 안에는 아이디·금액·일시·결제수단만 있어요.
- **Firebase 로그인 계정**도 지워요. 카카오 회원이면 (`KAKAO_ADMIN_KEY` 있을 때) 카카오 연결도 끊어요.
- 여러 번 불러도 괜찮아요(이미 지운 건 넘어가요).

네이버는 사용자가 네이버 → 내정보 → 이력관리 → 연결된 서비스 관리 에서 직접 끊을 수 있어요.

## 11. 카카오 디벨로퍼스 설정 (https://developers.kakao.com)

1. 내 애플리케이션 → 애플리케이션 추가 (앱 이름: 배프)
2. **앱 설정 → 플랫폼 → Web** → 사이트 도메인에 `https://nanaumsin.github.io` 와 워커 주소 등록
3. **제품 설정 → 카카오 로그인** → 활성화 **ON**
4. **Redirect URI** 에 정확히 이것 등록: `https://baep.bc0521.workers.dev/auth/kakao/callback`
5. **동의항목** → 닉네임(필수), 카카오계정 이메일(선택). 전화번호는 비즈 앱 전환 후에만 받을 수 있어요.
6. (선택) 보안 → Client Secret 을 켰다면 `KAKAO_CLIENT_SECRET` 도 넣기

## 12. 네이버 개발자센터 설정 (https://developers.naver.com)

1. Application → 애플리케이션 등록 → 사용 API: **네이버 로그인**
2. 제공 정보: 이름, 이메일, 휴대전화번호 (필요한 것만 체크)
3. 로그인 오픈 API 서비스 환경 → **PC 웹** 과 **Mobile 웹** 둘 다 추가하고 각각:
   - 서비스 URL: `https://nanaumsin.github.io/baep/`
   - 네이버 로그인 Callback URL: `https://baep.bc0521.workers.dev/auth/naver/callback`
4. 처음엔 "개발 중" 상태라 **멤버관리**에 등록한 네이버 아이디만 로그인돼요. 실제 서비스 전엔 **검수 요청**을 해야 해요.

## 로그인 실패 코드 (`#baep_auth_error=...`)

| 코드 | 뜻 | 해결 |
|---|---|---|
| `cancelled` | 사용자가 취소했어요 | 그냥 다시 시도 |
| `state` | 10분이 지났거나, 시작한 브라우저와 끝난 브라우저가 달라요 | 다시 시도 |
| `config` | 환경변수가 빠졌어요 | 워커 주소 `/` 에서 false 항목 확인 |
| `token` | 카카오/네이버 토큰 교환 실패 | Redirect/Callback URL, 키, Client Secret 확인 |
| `profile` | 회원정보를 못 받았어요 | 동의항목 확인 |
| `firebase` | Firebase 토큰을 못 만들었어요 | `FIREBASE_SERVICE_ACCOUNT` 다시 붙여넣기 |
| `provider` | 카카오/네이버 쪽 알 수 없는 오류 | 잠시 후 다시 |

자세한 원인은 Cloudflare 워커 → **Logs**(Real-time logs)에서 볼 수 있어요. (비밀번호·키는 기록에 절대 안 남겨요)

## 알아 두면 좋은 것

- **무료 요금제 주의**: 비밀번호 암호화(10만 번 계산)는 CPU 를 꽤 써요. 로그인·가입 때 Cloudflare 가 "CPU 한도 초과(오류 1102)" 를 내면
  Workers 유료 요금제(월 5달러)로 올리는 게 가장 쉬워요. (`worker.js` 의 `PBKDF2_ITER` 를 줄여도 되지만 보안이 약해져요. 이미 가입한 사람은 저장된 횟수로 계속 확인돼요)
- **로그인을 너무 많이 시도하는 공격**이 걱정되면 Cloudflare → Security → WAF → Rate limiting 에서 `/auth/login` 에 분당 횟수 제한을 걸 수 있어요.

## 고친 뒤 점검 (선택)

컴퓨터에 Node 22 가 있으면 `node server/test-worker.mjs` → `결과: 54개 통과, 0개 실패` 가 나오면 OK.
(가짜 Firestore·가짜 토스·가짜 카카오로 점검해요. 진짜 서버는 안 불러요)
