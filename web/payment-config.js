/* 배프 결제 설정 (토스페이먼츠 결제위젯)
   mode
     'test' : 진짜 결제창이 뜨지만 돈은 나가지 않아요. 발표·시연용.
     'live' : 실제 결제. 사업자 계약·카드사 심사가 끝난 뒤에만! (워커의 TOSS_SECRET_KEY 도 live_gsk_... 로)
     'off'  : 진짜 결제창을 쓰지 않아요 (진짜 계정은 결제할 수 없고, 시연 계정은 연습 결제창만).
   clientKey : 토스페이먼츠 개발자센터 > API 키 > 결제위젯 연동 키 > 클라이언트 키
               (지금 값은 토스페이먼츠 문서용 공개 테스트 키예요. 팀 테스트 키로 바꾸면 개발자센터에서 테스트 결제내역을 볼 수 있어요)

   결제 승인은 언제나 서버가 해요: 앱이 auth-config.js 의 workerUrl + '/pay/confirm' 으로
   로그인 토큰(Bearer)과 함께 {paymentKey, orderId, amount, kind, refId} 를 보내요.
   시크릿 키는 절대 이 파일에 넣지 마세요(누구나 볼 수 있어요). 워커 환경변수 TOSS_SECRET_KEY 에만 둬요.
   시연 계정(baeum 등)·시연 프렌드와의 수업은 진짜 결제창 대신 예전 연습 결제창(돈 안 나감)이 떠요. */
window.BAEP_PAY = {
  mode: 'test',
  clientKey: 'test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm'
};
