# 배프 작업 이어하기 메모 (2026-11-26 중단)

## 끝난 것 (main 브랜치, 실제 사이트에 반영됨)
- Firebase 프로젝트 baep-f3465 (Firestore 서울, 익명 로그인 켜짐, v1 보안 규칙 게시됨)
- 사이트: https://nanaumsin.github.io/baep/web/ — Firebase 연결, 카카오 로그인 실제 동작 확인
- Cloudflare 워커 https://baep.bc0521.workers.dev (v1 코드) + 비밀값 AUTH_STATE_SECRET, KAKAO_REST_KEY, KAKAO_CLIENT_SECRET, FIREBASE_SERVICE_ACCOUNT
- 카카오 앱 "배프"(ID 1667053): 로그인 ON, 닉네임 필수 동의, 리다이렉트 URI 등록
- server/ 폴더: v2 서버 코드 완성 (테스트 54개 통과) — 아직 Cloudflare 에 배포 전

## 진행 중이던 것 (브랜치 v2-wip, 미완성 — main 에 합치지 말 것)
- 설계 문서: docs/ARCH-v2.md (서버·앱 공통 약속)
- 앱(web/) v2 수정: 서버 로그인/가입, 시연·실서비스 모드(app-config.js), 나들이 Firestore 저장, 나들이 토스 결제, admin.html 분리
  → 중간에 멈춤. 다음에 v2-wip 의 web/ 를 이어서 완성하고 테스트해야 해요.
- 서버 팀이 남긴 앱 쪽 맞춰야 할 점: server/README.md, server/rules-checklist.md 참고

## 다음에 할 순서
1. (Claude) v2-wip 의 앱 수정 마무리 + 브라우저 테스트
2. (사용자) Cloudflare 에 새 worker.js 붙여넣고 Deploy, TOSS_SECRET_KEY 추가
3. (Claude) 테스트 계정으로 로그인/가입 CPU 한도 확인 (무료 요금제 10ms — PBKDF2 10만 회가 넘치면 횟수 조정 또는 유료 $5)
4. (Claude) v2 보안 규칙 게시 + 앱을 main 에 반영 + rules-checklist 실사용 검증
5. (사용자) 운영자 계정 가입 → Cloudflare ADMIN_IDS 에 그 아이디 추가
6. 남은 것: 네이버 로그인(크롬에서), 개인정보처리방침 빈칸, 실결제(사업자 후), 플레이스토어
