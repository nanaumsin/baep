# 앱(web/) v2 작업 지시서 — 클라이언트 담당용

계약: docs/ARCH-v2.md (필수), server/README.md, server/rules-checklist.md, server/firestore.rules, server/worker.js 가 최종 서버 동작이에요. 서버 코드는 고치지 마세요.

## 목표
1. **web/app-config.js**: `window.BAEP_MODE='demo'|'live'` (기본 'demo'). index/board/kiosk/admin 에서 가장 먼저 로드. live = 시연 계정·시연 막대·시연 버튼·시연 안내 전부 숨김(<html> 클래스 + demo() 래퍼처럼 일괄 처리).
2. **시연 계정(baeum/friend/admin, 1234)은 기기 안에서만**: Firestore·워커 호출 0건. admin 시연 계정도 demo:true. live 에서는 존재하지 않음.
3. **서버 로그인/가입**: 로그인 POST /auth/login → signInWithCustomToken → 내 baep_accounts/{acct} 로드 → 기존 로그인 후 흐름 재사용. 가입: 아이디 확인 GET /auth/check-id, 완료 시 POST /auth/signup {id,pw,role,account,profile}. 비밀번호는 어디에도 저장 금지, HASH 로직 제거. saveAcct 는 merge/update 로 내 문서만, role/approved/createdAt/ownerUids/pw 절대 안 보냄. 프렌드 프로필 수정은 baep_profiles/{acct} 의 화이트리스트 필드(name, school, major, grade, age, gender, dong, road, rad, intro, topics, wdays, times)+updatedAt 만. 세션 복원은 ID토큰 claims.acct 기준. 로그아웃 = signOut 후 익명 로그인. 오류코드 한국어 안내(BAD_LOGIN, LOCKED(retryAfter), ID_TAKEN, BAD_ID, BAD_PW(6자 이상), 네트워크).
   소셜(feat-auth.js): #baep_auth 의 acct 있으면 바로 로그인, 없으면 역할 선택·가입 흐름 후 /auth/signup 에 Bearer(소셜 ID토큰). baep_users·baep_social_* 직접 쓰기 제거.
4. **데이터**: 프렌드 목록 = baep_profiles where approved==true (익명 로그인 필요). 관리자 승인 대기 = baep_profiles where approved==false, 승인 시 baep_profiles 와 baep_accounts 의 approved 둘 다. 수업 요청 생성: from=acct, to=승인된 프렌드 acct, payerAcct=acct, amount(정수, dur 60→20000/2:1 30000, 90→25000/40000), st:'wait', paid 없음, from≠to, 40필드·memo≤1000·who≤100, 즉시예약은 inst:true + time 필드(규칙 확인). 프렌드 수정: st/why/updated/fdone 만(wait→ok|no, 미결제 ok→cancel). 보낸 사람 수정: st,inst,day,time,place,pk,memo,updated,payerAcct,payer 만, 결제 후 불가. 받은함 where to==acct, 내 요청은 문서 id 로 구독.
5. **결제**: 토스 성공 복귀(?toss=ok…) → POST /pay/confirm (Bearer, {paymentKey,orderId,amount,kind,refId}) → 결제됨 표시는 서버가 쓴 paid:true 를 보고. ALREADY_PAID=성공 처리, PAY_IN_PROGRESS·NOT_PAYABLE·NOT_OWNER·AUTH_REQUIRED·recorded:false 안내. 실계정은 클라이언트 측 testSecretKey 승인 금지(시연 계정만 기존 연습 결제). 리다이렉트 너머로 kind/refId 보존. 수업 결제는 st=='ok' 일 때만. `window.BAEP_TOSS_PAY({amount, orderName, kind, refId})` 공용 함수로 수업·나들이 둘 다.
6. **나들이 → Firestore**(feat-outing.js): 신청 baep_outing_apps/{oid}_{acct} = {oid, acct, name, dong, levels, score, companions:[≤3 {name,rel,phone}], createdAt} (paid,paidAt,orderId,amount,team,status,payLock* 는 클라이언트가 쓰지 않음, 금액은 서버가 60000×(1+동반자 수)). 결제 BAEP_TOSS_PAY kind 'outing'. 미결제 신청은 본인이 삭제 가능. 관리자: oid 로 신청 조회, AI 배정(기존 알고리즘)→ baep_outing_teams/{oid}_{n} = {oid, teamNo, memberAccts, friendAccts, members, friends, warn}, 신청 문서 {team:'<oid>_<n>', status:'assigned'}, 확정 시 status 'confirmed' + baep_sms 기록 + 팀 confirmed:true. 결제 안 된 신청은 배정 제외(결제 대기 표시). 회원: 내 신청 + memberAccts array-contains 로 팀. 프렌드: friendAccts array-contains, 팀원 신청은 문서 id 로. 시연 계정은 기존 localStorage 방식 유지.
7. **회원 탈퇴**: POST /auth/delete (Bearer) → 성공하면 signOut, 이 계정 로컬 데이터 삭제, 처음 화면. 클라이언트 Firestore 삭제 코드 제거. 시연 계정은 로그아웃만.
8. **운영자 분리**: web/admin.html → index.html?app=admin 로 이동(검색어·해시 유지). app=admin 이면 운영자 로그인(/auth/login, claims.role=='admin' 아니면 "운영자 계정이 아니에요") 후 운영자 콘솔만. 사용자 앱에서는 운영자 입구 전부 숨김(demo 모드에서만 시연 링크 유지, 이 경우 로컬 가짜 데이터). 안드로이드(UA 'BaepApp')에서는 app=admin 거부. app/build.gradle 에 admin.html 제외(AGP 8: `androidResources { ignoreAssetsPattern '!admin.html' }`).
9. `?s=` 미리보기·board.html·안드로이드 뒤로가기 훅(`#app [data-a=back]`) 유지.

## 테스트
Playwright(/opt/npm-tools/node_modules/playwright), Chrome(/usr/bin/google-chrome), `python3 -m http.server <port> --directory /home/claude/BaepApp/web`. /home/claude/v2test 에 가짜 Firebase compat SDK(gstatic 경로 가로채기, 규칙 흉내)와 가짜 워커가 있어요(일부 작성됨). 390x844 로 전 흐름 e2e: 배움님 가입·재로그인 → 프렌드 가입 → admin.html 승인 → 목록 노출 → 요청 → 수락 → 결제(toss=ok 복귀 → confirm → paid) → 나들이 신청·결제·AI 배정·확정 → 회원·프렌드 팀 확인 → 탈퇴. 그리고 시연 계정은 외부 호출 0건, live 모드 시연 UI 숨김, 카카오 복귀(acct 있음/없음), LOCKED/BAD_LOGIN 문구, 비운영자 거부, 사용자 앱 운영자 입구 없음, 앱 코드 콘솔 오류 0. 스크린샷 /home/claude/shots/v2-*.png.

## 진행 기록 (progress, 2026-11-26)
- 목표 1~9 모두 코드 반영 완료 (app-config.js, admin.html → index.html?app=admin, 서버 로그인/가입/탈퇴, 요청·결제·나들이 Firestore, gradle ignoreAssetsPattern '!admin.html').
- 마지막 수정: (a) 새로고침·결제 복귀 때 진짜 프렌드(acc-*) 목록이 아직 없어 화면이 깨지던 문제 → enterAccount 가 배움님이면 loadFriends 를 먼저 기다리고, tutor() 는 못 찾은 acc-* 에 임시 카드를 돌려줘요. 이것 때문에 ?toss=ok 복귀 후 /pay/confirm 이 안 불리던 버그가 고쳐졌어요.
  (b) LOCKED 문구는 서버 retryAfter(초)로 분 계산. (c) 수업 결제는 요청 st=='ok' 일 때만(NOT_PAYABLE 안내). (d) 요청 저장 전 undefined 값 제거(진짜 Firestore 는 undefined 를 거절).
- board.html·kiosk.html 은 index.html 복사본: index.html 고친 뒤 `python3 /home/claude/v2test/gen-copies.py` 로 다시 만들어요.
- 테스트: /home/claude/v2test — `node e2e.js` (전체 흐름 34개) · `node extra.js` (시연 외부호출 0건·live 숨김·안드로이드 거부·카카오 복귀·?s=·board·뒤로가기 16개) 모두 통과, 앱 콘솔 오류 0. 스크린샷 /home/claude/shots/v2-*.png.
- 남은 것: 진짜 워커·Firebase(baep-f3465)·토스 테스트 키로 실제 기기 확인(가짜 SDK/워커로만 검증함).
