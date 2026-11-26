/* 배프 간편로그인 설정
   workerUrl : Cloudflare 워커 주소 (예: https://baep.<계정>.workers.dev). 비워두면 카카오·네이버 버튼은 "준비 중" 안내만 해요.
   kakao / naver : 버튼을 보여줄지 */
window.BAEP_AUTH = {
  workerUrl: '',
  kakao: true,
  naver: true
};
