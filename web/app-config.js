/* 배프 앱 모드 — 다른 파일보다 먼저 읽혀요 (index.html · admin.html · board.html · kiosk.html)

   'demo' : 발표·시연용 (지금 값)
            - 시연 계정 baeum / friend / admin (비밀번호 1234) 으로 들어갈 수 있어요.
              시연 계정은 이 기기 안에서만 움직이고, 서버·Firestore 에는 아무것도 쓰지 않아요.
            - 화면 아래 '시연용' 막대·버튼, 로그인 화면의 시연 계정 안내, '먼저 둘러볼게요' 버튼이 보여요.
            - 진짜 회원가입·로그인·결제도 그대로 서버로 해요.
   'live' : 실제 서비스
            - 시연 계정이 없어요 (baeum / friend / admin 으로 로그인할 수 없어요).
            - 시연 막대·시연 버튼·시연 안내·'시연:' 링크가 모두 숨겨져요.
            - 운영자 화면은 admin.html 로만 들어가요.

   실제 사용자에게 내보낼 때는 아래 값을 'live' 로 바꿔요. */
window.BAEP_MODE = 'demo';

(function () {
  var m = window.BAEP_MODE === 'live' ? 'live' : 'demo';
  window.BAEP_MODE = m;
  try { document.documentElement.classList.add('baep-' + m); } catch (e) {}
})();
