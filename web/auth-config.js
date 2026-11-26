/* 배프 간편로그인 설정
   workerUrl : Cloudflare 워커 주소. 비워두면 카카오·네이버 버튼은 "준비 중" 안내(시연용 가입)만 해요.
   kakao / naver : 버튼을 보여줄지 (네이버는 개발자센터 설정을 마친 뒤 true 로 바꿔요) */
window.BAEP_AUTH = {
  workerUrl: 'https://baep.bc0521.workers.dev',
  kakao: true,
  naver: false
};
