# 2026-01-29 Vividly 개발 회고: CalDAV 동기화 및 성능 최적화

## 🎯 목표
1. CalDAV 동기화 오류 (수정 시 반영 안 됨, 409 Conflict) 디버깅
2. 무한 렌더링으로 인한 앱 성능 저하 해결
3. 양방향 동기화(맥/아이폰 ↔ Vividly) 속도 및 자동화 개선

## 🐛 발견된 버그 및 이슈
1. **409 Conflict (Duplicate Key)**
   - 원인: `syncSelectedCalendars` 로직에서 이미 존재하는 이벤트를 `insert` 하려 하여 DB 유니크 제약 위반 발생.
   - 증상: 동기화가 실패하고, 이로 인해 업데이트 로직 등 후속 작업이 차단됨.
2. **Infinite Render Loop (무한 렌더링)**
   - 원인: `App.tsx`에서 `getWeekStartForDate` 등의 함수를 `props`로 전달할 때, 익명 함수로 작성하여 렌더링마다 새로운 참조가 생성됨. 이로 인해 `useAppData`의 `useEffect`가 무한 재실행.
   - 증상: `WeekCard Re-rendered` 로그가 폭발적으로 발생, 브라우저 성능 저하 및 이벤트 핸들링 누락.
3. **CalDAV UID Mapping 누락**
   - 원인: `fetchEvents` (API)에서 `caldav_uid` 컬럼을 가져오긴 했으나, 프론트엔드 모델(`caldavUid`)로 매핑하지 않음.
   - 증상: 이벤트 수정 시 `Has UID: false`로 인식되어 동기화 로직을 건너뜀 (`Skipping CalDAV sync`).
4. **Calendar Metadata Type 누락**
   - 원인: 캘린더 메타데이터에 `type: 'caldav'`가 명시되지 않은 경우 동기화 대상에서 제외됨.
   - 증상: CalDAV URL을 가지고 있음에도 동기화 시도조차 하지 않음.
5. **단방향 같은 양방향 (수동 동기화)**
   - 증상: 맥 캘린더에서 수정한 내용이 Vividly에 즉시 뜨지 않고, 새로고침이나 수동 조작이 필요했음.

## 🛠️ 해결 및 개선 사항

### 1. Robust Sync Logic (Upsert 도입)
- `caldav.ts`의 `createEvent` 호출을 **`upsertEvent`**로 변경.
- 이미 존재하는 이벤트는 자연스럽게 내용을 업데이트하고, 없는 이벤트는 생성하도록 하여 409 에러 원천 차단.

### 2. 성능 최적화 (useCallback)
- `App.tsx`의 헬퍼 함수들을 **`useCallback`**으로 감싸서 참조 안정성(Referential Stability) 확보.
- 무한 렌더링 고리를 끊고 앱 성능 정상화.

### 3. 데이터 무결성 확보
- `api.ts`의 `fetchEvents` 함수에서 `caldav_uid` → `caldavUid` 매핑 추가.
- `MainLayout.tsx`에서 캘린더 타입 체크 로직을 유연하게 변경 (URL 기반 감지 추가).

### 4. 자동 동기화 (Auto Sync)
- `MainLayout` 마운트 시 (2초 후) 자동으로 변경사항을 동기화.
- **5분 간격**으로 주기적 동기화(Polling)를 수행하여, 맥 캘린더의 변경사항을 Vividly에 자동 반영.

## 📝 배운 점
- **로그의 중요성**: `[DEBUG]` 로그를 적재적소에 심어 로직의 흐름(Flow) 제어가 어디서 끊기는지 파악하는 것이 결정적이었음.
- **참조의 저주**: React에서 함수 Props 전달 시 `useCallback`을 놓치면 치명적인 무한 루프를 유발할 수 있음을 재확인.
- **DB와 클라이언트 모델 불일치**: 스네이크 케이스(`caldav_uid`)와 카멜 케이스(`caldavUid`) 사이의 매핑 누락은 찾기 힘든 버그의 주범.
- **사용자 경험(UX)**: 기술적으로 동기화가 가능해도, "자동"으로 되지 않으면 사용자는 "느리다"고 느낀다.

## 🚀 향후 과제
- 동기화 중임을 알리는 UI 인디케이터(Spinner 등) 추가 고려.
- Edge Function의 **ETag** 검증 로직을 더 정교하게 다듬어 동시 편집 충돌 방지 강화.

---
**Verified by Antigravity**
**Date:** 2026-01-29
