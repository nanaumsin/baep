# Firestore 규칙 확인표 (firestore.rules v2)

규칙은 이 컴퓨터에서 흉내 낼 수 없어서(에뮬레이터·인터넷 없음) **게시한 뒤 직접** 확인해요.

## 확인하는 법

Firebase 콘솔 → Firestore Database → **규칙** 탭 → 오른쪽 위 **규칙 플레이그라운드**(Rules Playground)

1. 시뮬레이션 유형(get / list(query) / create / update / delete)과 위치(경로)를 골라요.
2. **인증됨** 을 켜고 공급자를 `custom` 으로, **Firebase UID** 와 **토큰 페이로드**에 아래 표의 값을 넣어요.
   예) `{"acct":"mom1","role":"mentee","provider":"password"}`
3. update 는 "기존 문서"(DB에 실제로 있어야 해요) + "새 문서 데이터"를 넣어요. 그래서 먼저 콘솔에서 **시험용 문서**를 만들어 두세요(아래 준비).
4. **실행** → 표의 기대값(✅ 허용 / ❌ 거절)과 같은지 봐요.

> 앱으로 확인하는 쿼리(list) 줄은 플레이그라운드보다 **실제 앱**(또는 브라우저 콘솔에서 `firebase.firestore()...get()`)으로 보는 게 정확해요. 규칙이 쿼리를 증명 못 하면 `Missing or insufficient permissions` 가 나요.

## 준비 (콘솔에서 손으로 만드는 시험 문서)

| 경로 | 내용 |
|---|---|
| `baep_profiles/frnd1` | `{approved:true, acct:"frnd1", name:"김민지", wdays:["토"], times:["14:00"]}` |
| `baep_profiles/frnd2` | `{approved:false, acct:"frnd2", name:"이수진"}` |
| `baep_accounts/mom1` | `{role:"mentee", createdAt:1, ownerUids:["acct:mom1"], sr:{name:"김복순"}}` |
| `baep_requests/rq1` | `{rid:"rq1", from:"mom1", to:"frnd1", st:"wait", dur:60, amount:20000, day:20608, time:"14:00"}` (20608 = 2026-06-04 목요일 → 안 맞는 날) |
| `baep_requests/rq2` | `{rid:"rq2", from:"mom1", to:"frnd1", st:"ok", dur:60, amount:20000, paid:true}` |
| `baep_outing_apps/o1_mom1` | `{acct:"mom1", oid:"o1", team:"o1_1"}` |
| `baep_outing_teams/o1_1` | `{oid:"o1", memberAccts:["mom1"], friendAccts:["frnd1"]}` |
| `baep_payments/pay1` | `{acct:"mom1", amount:20000}` |
| `baep_secrets/mom1` | `{pwHash:"x"}` |

토큰 이름: **엄마** = uid `acct:mom1`, `{"acct":"mom1","role":"mentee"}` · **프렌드** = uid `acct:frnd1`, `{"acct":"frnd1","role":"mentor"}` · **남** = uid `acct:dad2`, `{"acct":"dad2","role":"mentee"}` · **운영자** = uid `acct:baepadmin`, `{"acct":"baepadmin","role":"admin"}` · **익명** = 공급자 anonymous, 페이로드 없음 · **가입 전 카카오** = uid `kakao:999`, `{"provider":"kakao"}`

## 확인표

| # | 누가 | 동작 | 경로 | 데이터 / 조건 | 기대 |
|---|---|---|---|---|---|
| 1 | 운영자 | get | `baep_secrets/mom1` | — | ❌ |
| 2 | 엄마 | get | `baep_secrets/mom1` | 내 것이어도 | ❌ |
| 3 | 가입 전 카카오 | get | `baep_users/kakao:999` | 본인 uid | ✅ |
| 4 | 가입 전 카카오 | create | `baep_users/kakao:999` | `{acct:"mom1"}` (남의 계정 가로채기) | ❌ |
| 5 | 엄마 | get | `baep_accounts/mom1` | — | ✅ |
| 6 | 남 | get | `baep_accounts/mom1` | — | ❌ |
| 7 | 엄마 | update | `baep_accounts/mom1` | `sr.name` 만 바꿈 | ✅ |
| 8 | 엄마 | update | `baep_accounts/mom1` | `role:"admin"` 또는 `approved:true` | ❌ |
| 9 | 엄마 | update | `baep_accounts/mom1` | `set()` 으로 `sr` 만 있는 문서 통째 덮어쓰기 (role·ownerUids 사라짐) | ❌ |
| 10 | 운영자 | update | `baep_accounts/mom1` | `approved:true` 만 | ✅ |
| 11 | 운영자 | update | `baep_accounts/mom1` | `approved:true, role:"mentor"` | ❌ |
| 12 | 익명 | list | `baep_profiles` | `where approved == true` | ✅ |
| 13 | 익명 | get | `baep_profiles/frnd2` | 미승인 | ❌ |
| 14 | 엄마 | list | `baep_profiles` | `where approved == false` | ❌ |
| 15 | 운영자 | list | `baep_profiles` | `where approved == false` | ✅ |
| 16 | 프렌드(frnd1) | update | `baep_profiles/frnd1` | `intro:"안녕하세요"` | ✅ |
| 17 | 프렌드(frnd1) | update | `baep_profiles/frnd1` | `approved:false→true` 또는 `phone:"010…"` 추가 | ❌ |
| 18 | 엄마 | create | `baep_requests/rq9` | `{rid:"rq9", from:"mom1", to:"frnd1", st:"wait", dur:60, amount:20000}` | ✅ |
| 19 | 엄마 | create | `baep_requests/rq9` | 18번과 같은데 `amount:20000, dur:90` (90분을 60분 값에) | ❌ |
| 20 | 엄마 | create | `baep_requests/rq9` | 18번 + `paid:true` | ❌ |
| 21 | 엄마 | create | `baep_requests/rq9` | 18번인데 `to:"frnd2"` (미승인 프렌드) | ❌ |
| 22 | 남 | create | `baep_requests/rq9` | `from:"mom1"` (남인 척) | ❌ |
| 23 | 프렌드(frnd1) | create | `baep_requests/rq9` | 18번 그대로 (role mentor) | ❌ |
| 24 | 프렌드(frnd1) | list | `baep_requests` | `where to == "frnd1"` | ✅ |
| 25 | 엄마 | list | `baep_requests` | `where from == "mom1"` | ✅ |
| 26 | 남 | list | `baep_requests` | `where to == "frnd1"` (남의 받은함) | ❌ |
| 27 | 남(dad2, 자녀 역할) | list | `baep_requests` | rq1 에 `payerAcct:"dad2"` 를 넣어 두고 `where payerAcct == "dad2"` | ✅ |
| 28 | 프렌드(frnd1) | update | `baep_requests/rq1` | `st:"wait"→"ok", updated:<숫자>` | ✅ |
| 29 | 프렌드(frnd1) | update | `baep_requests/rq1` | `st:"ok", paid:true` | ❌ |
| 30 | 프렌드(frnd1) | update | `baep_requests/rq1` | `amount:40000` | ❌ |
| 31 | 엄마 | update | `baep_requests/rq1` | `st:"wait"→"ok"` (스스로 수락) | ❌ |
| 32 | 엄마 | update | `baep_requests/rq1` | 먼저 콘솔에서 rq1 의 `day` 를 `20610`(2026-06-06 토요일)으로 바꿔 두고 → `st:"ok", inst:true` (열어둔 토 14:00) | ✅ |
| 32-1 | 엄마 | update | `baep_requests/rq1` | `day:20608`(목요일) 그대로 `st:"ok", inst:true` (열지 않은 날) | ❌ |
| 33 | 엄마 | update | `baep_requests/rq1` | `st:"cancel"` | ✅ |
| 34 | 엄마 | update | `baep_requests/rq1` | `dur:90` (금액 바꾸기 꼼수) | ❌ |
| 35 | 엄마 | update | `baep_requests/rq2` | 결제된 요청 `st:"cancel"` | ❌ |
| 36 | 엄마 | delete | `baep_requests/rq1` | — | ❌ |
| 37 | 엄마 | get | `baep_payments/pay1` | — | ✅ |
| 38 | 남 | get | `baep_payments/pay1` | — | ❌ |
| 39 | 엄마 | create | `baep_payments/pay9` | 아무 내용 | ❌ |
| 40 | 익명 | list | `baep_outings` | 전체 | ✅ |
| 41 | 엄마 | create | `baep_outings/o9` | 아무 내용 | ❌ |
| 42 | 엄마 | create | `baep_outing_apps/o2_mom1` | `{acct:"mom1", oid:"o2", companions:[{name:"남편"}]}` | ✅ |
| 43 | 엄마 | create | `baep_outing_apps/o2_dad2` | `{acct:"mom1", oid:"o2"}` (문서 번호가 내 것이 아님) | ❌ |
| 44 | 엄마 | create | `baep_outing_apps/o2_mom1` | 42번 + `paid:true` 또는 `team:"o2_1"` | ❌ |
| 45 | 프렌드(frnd1) | get | `baep_outing_apps/o1_mom1` | 같은 팀(o1_1) 프렌드 | ✅ |
| 46 | 남 | get | `baep_outing_apps/o1_mom1` | — | ❌ |
| 47 | 운영자 | list | `baep_outing_apps` | `where oid == "o1"` | ✅ |
| 48 | 운영자 | update | `baep_outing_apps/o1_mom1` | `team:"o1_2", status:"done"` | ✅ |
| 49 | 엄마 | list | `baep_outing_teams` | `where memberAccts array-contains "mom1"` | ✅ |
| 50 | 남 | get | `baep_outing_teams/o1_1` | — | ❌ |
| 51 | 엄마 | get | `baep_sms/x` | — | ❌ |
| 52 | 운영자 | create | `baep_sms/x` | `{to:"…", body:"…"}` | ✅ |
| 53 | 엄마 | get | `anything_else/x` | 규칙에 없는 컬렉션 | ❌ |

## 읽으면서 다시 확인한 것 (규칙을 고칠 때도 지켜 주세요)

- `me()` 는 토큰에 acct 가 없으면 `null` → `member()` 를 꼭 같이 써요. (안 그러면 `from == null` 인 문서를 익명이 읽을 수 있어요)
- 쿼리 규칙(list)은 `resource.data.<필드> == me()` 처럼 **필드를 바로** 비교해요. `get('필드', 기본값)` 을 쓰면 쿼리를 증명 못 할 수 있어요.
- `diff().affectedKeys()` 는 "지운 필드"도 포함해요 → 앱은 `set()` 덮어쓰기 대신 `update()`/`set(…,{merge:true})` 를 써야 해요.
- 결제 표시 필드(`paid, paidAt, orderId, payLock, payLockAt`)는 앱 규칙 어디에서도 쓸 수 없어요. 서버(서비스 계정)만 써요.
- 프렌드가 나들이 신청서를 **검색**(where)하면 거절돼요(규칙이 팀 문서를 읽어야 해서 증명 불가). 팀 문서의 `memberAccts` 로 `<oid>_<acct>` 문서를 하나씩 `get()` 하세요.
