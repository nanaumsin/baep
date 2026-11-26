# 배프 서버 (Cloudflare Worker)

`worker.js` 파일 하나가 **결제 승인 + 카카오·네이버 로그인 + 탈퇴 도우미**를 다 해요.
예전 `toss-confirm-worker.js` 를 대신해요. (무료 요금제로 충분해요)

| 파일 | 뭐예요 |
|---|---|
| `worker.js` | Cloudflare 에 붙여넣을 서버 코드 |
| `firestore.rules` | Firebase Firestore 보안 규칙 |
| `test-worker.mjs` | 서버 자동 점검 (`node test-worker.mjs`, 설치할 것 없음) |

---

## 1. 워커 올리기 (처음 한 번)

1. https://dash.cloudflare.com 가입 → 로그인
2. 왼쪽 **Workers & Pages** → **Create** → **Create Worker**(Hello World) → 이름 예: `baep` → **Deploy**
3. **Edit code** → 안에 있던 코드를 전부 지우고 `worker.js` 내용을 통째로 붙여넣기 → 오른쪽 위 **Deploy**
4. 워커 주소를 복사해요. 예: `https://baep.<계정이름>.workers.dev` (아래에서 `<워커>` 라고 부를게요)

예전 결제 워커가 이미 있으면, 그 워커의 코드만 바꿔서 붙여넣어도 돼요. (예전 `ALLOWED_ORIGIN` 변수도 읽어요)

## 2. 환경변수 넣기

워커 → **Settings** → **Variables and Secrets** → **Add** → 이름·값 입력.
Type 이 **Secret** 인 것은 꼭 Secret 으로 골라요 (한 번 넣으면 값이 다시 안 보여요. 그게 정상이에요).
다 넣고 **Deploy** 를 눌러야 적용돼요.

| 이름 | Type | 넣을 값 | 꼭? |
|---|---|---|---|
| `TOSS_SECRET_KEY` | **Secret** | 토스페이먼츠 개발자센터 → API 키 → 결제위젯 연동 키 → 시크릿 키 (`test_gsk_...` / 실결제 `live_gsk_...`) | 결제 |
| `ALLOWED_ORIGINS` | Text | 앱 주소들, 쉼표로 구분. 비워두면 `https://hohowww12.github.io,https://appassets.androidplatform.net` | 선택 |
| `AUTH_STATE_SECRET` | **Secret** | 아무 긴 랜덤 문자열 (아래 설명) | 로그인 |
| `FIREBASE_SERVICE_ACCOUNT` | **Secret** | Firebase 서비스 계정 키 JSON 파일 내용 **통째로** (아래 설명) | 로그인·탈퇴 |
| `KAKAO_REST_KEY` | Text | 카카오 디벨로퍼스 → 내 애플리케이션 → 앱 키 → **REST API 키** | 카카오 |
| `KAKAO_CLIENT_SECRET` | **Secret** | 카카오 → 보안 → Client Secret 을 "사용함"으로 켰을 때만 그 코드 | 선택 |
| `KAKAO_ADMIN_KEY` | **Secret** | 카카오 → 앱 키 → **Admin 키** (탈퇴 때 카카오 연결 끊기용) | 선택 |
| `NAVER_CLIENT_ID` | Text | 네이버 개발자센터 → 내 애플리케이션 → Client ID | 네이버 |
| `NAVER_CLIENT_SECRET` | **Secret** | 같은 곳의 Client Secret | 네이버 |

**AUTH_STATE_SECRET 만들기** — 아무도 못 맞힐 긴 글자면 돼요 (40자 이상 추천).
- 비밀번호 생성기(크롬 비밀번호 제안, 1Password 등)로 40자짜리 하나 만들어 붙여넣기, 또는
- 브라우저 아무 페이지에서 F12 → Console 에 붙여넣고 엔터:
  `crypto.randomUUID() + crypto.randomUUID()`
  나온 글자(따옴표 빼고)를 값으로 넣어요. 바꾸면 진행 중인 로그인만 실패하고 다른 문제는 없어요.

**FIREBASE_SERVICE_ACCOUNT 받기**
Firebase 콘솔 → ⚙ 프로젝트 설정 → **서비스 계정** 탭 → **새 비공개 키 생성** → JSON 파일 다운로드
→ 메모장으로 열어 `{` 부터 `}` 까지 전부 복사 → 값에 붙여넣기.
⚠ 이 파일은 프로젝트 "마스터 열쇠"예요. 깃허브·카톡에 올리지 말고, 넣은 뒤엔 컴퓨터에서 지워요.

## 3. 잘 됐는지 확인

브라우저로 `<워커>/` 를 열어요. 이런 게 보이면 돼요:

```json
{"ok":true, "configured":{"toss":true,"kakao":true,"naver":true,"firebase":true,"stateSecret":true,"kakaoUnlink":false}, ...}
```

`false` 인 항목은 그 환경변수가 빠졌거나 잘못된 거예요. (`firebase:false` 면 JSON 을 덜 복사했을 가능성이 커요)
값 자체는 절대 보여주지 않으니 안심하세요.

## 4. 앱(web/)에 주소 넣기

- `web/payment-config.js` → `confirmUrl: '<워커>/pay/confirm'`
  (앱이 이 주소로 바로 `POST {paymentKey, orderId, amount}` 를 보내요. 예전처럼 `<워커>` 만 넣어도 돼요)
- `web/auth-config.js` → `workerUrl: '<워커>'` (끝에 `/` 없이)

결제 금액은 `worker.js` 맨 위 `ALLOWED_AMOUNTS` 에 있어요 (20,000 · 25,000 · 30,000 · 40,000 · 60,000원).
앱 요금을 바꾸면 여기도 같이 바꾸고 다시 Deploy 해요. 목록에 없는 금액은 승인을 거절해요.

## 5. 카카오 디벨로퍼스 설정 (https://developers.kakao.com)

1. 내 애플리케이션 → 애플리케이션 추가 (앱 이름: 배프)
2. **앱 설정 → 플랫폼 → Web** → 사이트 도메인에 `https://hohowww12.github.io` 와 `<워커>` 등록
3. **제품 설정 → 카카오 로그인** → 활성화 **ON**
4. **Redirect URI** 에 정확히 이것 등록:
   `<워커>/auth/kakao/callback`
5. **동의항목** → 닉네임(필수), 카카오계정 이메일(선택). 전화번호는 비즈 앱 전환 후에만 받을 수 있어요.
6. (선택) 보안 → Client Secret 을 켰다면 `KAKAO_CLIENT_SECRET` 도 넣기

## 6. 네이버 개발자센터 설정 (https://developers.naver.com)

1. Application → 애플리케이션 등록 → 사용 API: **네이버 로그인**
2. 제공 정보: 이름, 이메일, 휴대전화번호 (필요한 것만 체크)
3. 로그인 오픈 API 서비스 환경 → **PC 웹** 과 **Mobile 웹** 둘 다 추가하고 각각:
   - 서비스 URL: `https://hohowww12.github.io`
   - 네이버 로그인 Callback URL: `<워커>/auth/naver/callback`
4. 처음엔 "개발 중" 상태라 **멤버관리**에 등록한 네이버 아이디만 로그인돼요. 실제 서비스 전엔 **검수 요청**을 해야 해요.

## 7. Firebase 설정

1. Authentication → 시작하기 → 로그인 방법 → **익명** 사용 설정 (예전 데모 계정용)
   (카카오·네이버는 커스텀 토큰이라 따로 켤 게 없어요)
2. Firestore → **규칙** 탭 → 내용 전부 지우고 `firestore.rules` 붙여넣기 → **게시**

## 탈퇴는 이렇게 돌아가요

앱이 ① `POST <워커>/auth/delete` (헤더 `Authorization: Bearer <Firebase ID 토큰>`) → 서버가 토큰을 확인하고,
카카오 회원이면(`KAKAO_ADMIN_KEY` 있을 때) 카카오 연결 끊기 → `{ok:true, kakaoUnlinked:true/false}`
→ ② 앱이 Firestore 문서(`baep_users/<uid>` 등)를 지우고 → ③ 앱이 `currentUser.delete()` 로 Firebase 계정을 지워요.
네이버는 사용자가 네이버 → 내정보 → 이력관리 → 연결된 서비스 관리 에서 끊을 수 있어요.

## 로그인 실패 코드 (`#baep_auth_error=...`)

| 코드 | 뜻 | 해결 |
|---|---|---|
| `cancelled` | 사용자가 취소했어요 | 그냥 다시 시도 |
| `state` | 10분이 지났거나, 시작한 브라우저와 끝난 브라우저가 달라요 | 다시 시도 |
| `config` | 환경변수가 빠졌어요 | `<워커>/` 에서 false 항목 확인 |
| `token` | 카카오/네이버 토큰 교환 실패 | Redirect/Callback URL, 키, Client Secret 확인 |
| `profile` | 회원정보를 못 받았어요 | 동의항목 확인 |
| `firebase` | Firebase 토큰을 못 만들었어요 | `FIREBASE_SERVICE_ACCOUNT` 다시 붙여넣기 |
| `provider` | 카카오/네이버 쪽 알 수 없는 오류 | 잠시 후 다시 |

자세한 원인은 Cloudflare 워커 → **Logs**(Real-time logs)에서 볼 수 있어요.

## 고친 뒤 점검 (선택)

컴퓨터에 Node 22 가 있으면 이 폴더에서 `node test-worker.mjs` → `결과: N개 통과, 0개 실패` 가 나오면 OK.
