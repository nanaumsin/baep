# 배프 안드로이드 앱

배프 웹 프로토타입(`web/` 폴더의 HTML)을 그대로 앱 화면 전체에 띄우는 안드로이드 앱이에요.
화면·기능은 웹과 똑같고, 앱에 맞게 아래 것들만 더했어요.

- 결제: 토스 결제창에서 카카오페이·토스페이·카드사 앱으로 넘어갔다가 다시 돌아와요
- 새 창 링크(연습 사이트, 영수증 등): 앱 위에 덮는 화면으로 열리고, 맨 위 **닫고 배프로 돌아가기**로 닫아요
- 휴대폰 뒤로가기 버튼 = 화면 왼쪽 위 "뒤로" 버튼. 첫 화면에서는 두 번 누르면 앱이 닫혀요
- 상태바·하단 버튼·키보드에 화면이 가리지 않아요
- 아이콘: 파란 원 + 노란 원 웃는 얼굴 로고

## 새로 추가된 것 (2026-11-25)

- `web/feat-auth.js` — 카카오 간편로그인, 회원 탈퇴. 설정: `web/auth-config.js`
- `web/feat-outing.js` — 나들이 (목록·신청·AI 팀 배정·운영자 확정·문자). 가격 등은 파일 맨 위 숫자만 바꾸면 돼요
- `web/privacy.html` — 개인정보처리방침 (노란 칸 채우기)
- `web/delete-account.html` — 계정 삭제 안내 (플레이스토어용)
- `server/` — 결제 승인 + 로그인 서버(Cloudflare 워커)와 Firestore 보안 규칙. 설정법은 `server/README.md`

## 여는 법

1. 이 폴더(`BaepApp`)의 압축을 풀어요. 경로에 한글이 없는 곳이 좋아요 (예: `C:\dev\BaepApp`).
2. 안드로이드 스튜디오 → **Open** → `BaepApp` 폴더 선택.
3. 처음에는 Gradle 동기화로 필요한 파일을 내려받느라 몇 분 걸려요. (인터넷 필요)
   - "Android Gradle Plugin을 업데이트할까요?" 하고 물어보면 그대로 둬도 되고 업데이트해도 돼요.
4. 위쪽 기기 목록에서 에뮬레이터나 USB로 연결한 폰을 고르고 ▶ (Run).
   - 실제 폰: 설정 → 휴대전화 정보 → 소프트웨어 정보 → 빌드번호 7번 눌러 개발자 모드 → USB 디버깅 켜기.

## 고칠 때

| 하고 싶은 것 | 어디를 |
|---|---|
| 화면·문구·기능 | `web/index.html` (다른 화면은 `kiosk.html`, `practice.html`, `board.html`) |
| 결제 키·모드 | `web/payment-config.js` |
| 여러 폰이 같은 데이터 보기 | `web/firebase-config.js` 에 Firebase 설정 넣기 (받은 압축파일엔 이 파일이 없었어요) |
| 앱 이름 | `app/src/main/res/values/strings.xml` 의 `app_name` |
| 아이콘 | `app/src/main/res/drawable/ic_launcher_foreground.xml` (또는 안드로이드 스튜디오 → res 우클릭 → New → Image Asset) |
| 앱 고유 이름(패키지) | `app/build.gradle` 의 `applicationId` (지금 `kr.baepu.app`) |

`web/` 파일을 고친 뒤 다시 ▶ 누르면 앱에 반영돼요.

## 알아둘 점

- **인터넷이 필요해요.** 글꼴(구글 폰트), 3D 첫 화면(three.js), 토스 결제, Firebase를 인터넷에서 불러와요.
- **결제 승인 서버(`confirmUrl`)를 쓰게 되면**: 앱 안에서는 웹 주소가 `https://appassets.androidplatform.net` 이에요.
  `server/toss-confirm-worker.js` 의 `ALLOWED_ORIGIN` 이 깃허브 주소 하나만 허용하면 앱에서 승인이 막히니,
  앱 주소도 허용하도록 고쳐야 해요.
- **태블릿**은 화면 폭이 넓어서 웹에서처럼 "폰 모양 시연 화면"으로 보여요. 휴대폰은 꽉 찬 앱 화면이에요.
- 화면은 세로 고정이에요 (가로로 돌리면 폭이 넓어져 시연 화면으로 바뀌기 때문).
- 글씨 크기는 휴대폰 설정 대신 앱 안의 **글자 크게** 버튼을 따라요 (레이아웃이 깨지지 않게).

## 플레이스토어용 파일 만들기

Build → **Generate Signed App Bundle / APK** → Android App Bundle(.aab) → 새 키 만들기(키 파일과 비밀번호는 꼭 따로 보관) → release.
그냥 친구 폰에 깔아볼 APK는 Build → Build App Bundle(s) / APK(s) → Build APK(s).

## 아이폰은?

안드로이드 스튜디오로 만든 앱은 **안드로이드폰 전용**이에요 (갤럭시뿐 아니라 픽셀·LG 등 안드로이드 8.0 이상이면 다 돼요).
아이폰 앱은 **맥(Mac) + Xcode**가 있어야 만들 수 있고, 앱스토어에 올리려면 애플 개발자 계정(연 99달러)이 필요해요.
`web/` 폴더를 그대로 써서 아이폰용 껍데기를 따로 만들면 돼요.
