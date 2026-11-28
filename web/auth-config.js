/* 배프 간편로그인 설정
   workerUrl : Cloudflare 워커 주소. 비워두면 카카오 버튼은 "준비 중" 안내(시연용 가입)만 해요.
   kakao : 카카오 버튼을 보여줄지
   naver : 네이버 로그인은 쓰지 않기로 했어요 (false 유지) */
window.BAEP_AUTH = {
  workerUrl: 'https://baep.bc0521.workers.dev',
  kakao: true,
  naver: false
};
