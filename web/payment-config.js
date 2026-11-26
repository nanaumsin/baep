/* 배프 결제 설정 (토스페이먼츠 결제위젯)
   mode
     'test' : 진짜 결제창이 뜨지만 돈은 나가지 않아요. 발표·시연용.
     'live' : 실제 결제. 사업자 계약·카드사 심사가 끝난 뒤에만! confirmUrl 이 꼭 있어야 해요.
     'off'  : 예전 연습 결제창(가짜)만 써요.
   clientKey     : 토스페이먼츠 개발자센터 > API 키 > 결제위젯 연동 키 > 클라이언트 키
                   (지금 값은 토스페이먼츠 문서용 공개 테스트 키예요. 팀 테스트 키로 바꾸면 개발자센터에서 테스트 결제내역을 볼 수 있어요)
   testSecretKey : 'test' 모드에서만 쓰는 테스트 시크릿 키. 라이브 시크릿 키는 절대 여기에 넣지 마세요(누구나 볼 수 있어요).
   confirmUrl    : 결제 승인 서버 주소 (server/toss-confirm-worker.js 를 올린 주소). 넣으면 이 서버로 승인해요. */
window.BAEP_PAY = {
  mode: 'test',
  clientKey: 'test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm',
  testSecretKey: 'test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6',
  confirmUrl: ''
};
