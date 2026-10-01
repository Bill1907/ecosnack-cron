# Cloudflare 이전 전 선행 작업 계획

목표: Workers로 옮기기 전에 막히는 두 가지(모델 호환, KST 날짜)를 Render 위에서 먼저 고치고 검증한다.
브랜치 하나(`fix/models-and-kst`), 커밋은 단계별. 각 단계 끝의 "확인"이 통과해야 다음 단계로 간다.

## 결정 사항 (실측 근거: 2026-10-01 스파이크)

| 역할 | 모델 | 근거 |
|---|---|---|
| Stage 1 제목 점수 | Jev `jev-1.13.0` Score | 150개 제목, terra 기준 상위30 일치 20/30 (4o-mini 19, 5.6-luna 21, 6-luna 21). 0.35초 vs 11~23초, 비용 1/2~1/3 |
| Stage 2 품질 점수 | Jev Score | Stage 1과 같은 형태의 판정 |
| 근거 검증 (evidence) | Jev Choice(supports/contradicts/unrelated) + 신뢰도 0.8 미만만 gpt-5.6-luna(none) 재판정 | 57건 정확도 Jev 0.96 / 4o-mini 0.95 / 5-mini 0.93 / 6-luna 0.96 / 5.6-luna 1.00. Jev 신뢰도≥0.8 → 커버리지 91%, 정확도 100% |
| 리포트 품질 평가 | Jev Score × 6 기준, 종합점수는 코드에서 평균 | 프론트(ecosnack)는 qualityEvaluation 미사용 → feedback 문장 없어져도 영향 없음 |
| Stage 3 기사 분석 | gpt-6-luna | 6/6 성공, 80건/일 $0.17(4o-mini와 동일), 4o-mini보다 기사 범위를 넘지 않는 서술. 지연 25초(병렬이라 무관) |
| 데일리·개인화 리포트 | gpt-6-luna | 9/30 기사 78개로 생성 성공 57초. 품질 비교는 미실시 → 3단계에서 1회 눈으로 확인 |

- gpt-5 계열 이후 모델은 `max_tokens`, `temperature≠1` 를 400으로 거부한다(실측). `max_completion_tokens`만 쓰고 temperature는 보내지 않는다.
- 운영 근거 검증은 2026-03부터 AI 판정이 100% 실패 중(3~9월 근거 1,435건 전부 "AI 관련성 검증 실패"), qualityScore도 3월부터 전부 null. 로컬에서 같은 코드는 동작 → Render 쪽 원인. Jev로 교체하면서 함께 사라지지만, 실패가 조용히 "유효"로 처리되는 구조는 고친다.

## 1단계 — 모델 호출 정리 (차단 ①)

1. `src/config/index.ts`
   - `openai.model` → `models.generate`(기본 `gpt-6-luna`, env `OPENAI_MODEL`), `models.fallbackJudge`(기본 `gpt-5.6-luna`)
   - `typesafe.apiKey`(env `TYPESAFE_API_KEY`), `typesafe.model`(기본 `jev-1.13.0` 고정 — 별칭 금지)
   - `validateConfig()`에 TYPESAFE_API_KEY 필수 추가, `newsApi` 제거
2. `src/services/openai-client.ts` 에 `createStructured({ schema, name, system, user, maxOutputTokens, reasoningEffort? })` 추가
   - `max_completion_tokens`만 사용, temperature 미전송, zod 파싱까지
   - `news-analyzer.ts`의 자체 OpenAI 싱글턴 삭제
3. `src/services/jev-client.ts` 신규 — `fetch`로 `POST https://api.typesafe.ai/v1/systemone`
   - 429/529 지수 백오프, 15초 타임아웃, 응답 `model` 로그
   - SDK 대신 fetch: 의존성 0, Workers에서 그대로 동작
4. 호출부 교체
   - `news-analyzer.ts` Stage 1/2 → Jev Score(헤드라인 25개씩 한 요청, 병렬). Stage 3 → `createStructured`
   - `evidence-validator.ts` → Jev Choice, 신뢰도<0.8 은 fallbackJudge 재판정. "AI 실패 = 유효" 폴백 삭제 → `unverified`로 기록하고 점수에서 제외
   - `quality-evaluator.ts` → Jev Score 6개, `overallScore` 코드 계산. 스키마의 feedback/strengths/improvements 는 제거
   - `daily-report.ts`, `personalized-report.ts` → `createStructured`
5. 조용한 실패 차단
   - Stage 1/2: Jev 실패 시 "전부 50점" 대신 generate 모델 LLM 점수로 폴백, 그것도 실패하면 throw
   - Stage 3 성공률 < 50% 이면 `analyzeNews` 가 `success:false` → 크론 exit 1
6. 테스트
   - 실패 중인 23개 정리: 분석 실패 기사는 버린다는 현재 동작 기준으로 기대값 수정, fetch 테스트는 `withRetry` delay 주입으로 5초 안에
   - 신규: `createStructured` 요청 파라미터(max_tokens/temperature 미포함), jev-client 재시도, Stage 3 성공률 가드

확인: `bun run typecheck`, `bun test` 전부 통과 / `bun run cron --dry-run`(저장 생략 플래그 추가)으로 실 RSS→Jev→gpt-6-luna 통과, 분석 성공 ≥ 18/20

## 2단계 — KST 날짜 (차단 ②)

1. `src/utils/kst.ts` 신규 (TZ 무관, 순수 함수)
   - `kstDateString(instant) → "YYYY-MM-DD"`
   - `kstDayRange("YYYY-MM-DD") → { start, end }` = KST 00:00 ~ 다음날 00:00 의 UTC 시각 (`lt end`)
   - `previousKstDate(now) → "YYYY-MM-DD"`
   - `toDbDate("YYYY-MM-DD") → new Date("YYYY-MM-DDT00:00:00Z")` (`@db.Date` 저장용)
2. 리포트 기준일 = 실행 시점 KST 어제
   - `generateDailyReport(dateStr)` / `getDailyArticles(dateStr)` / `saveDailyReport` / `generateAllPersonalizedReports(dateStr)` 를 문자열 날짜로 받는다
   - `setHours`, `getKSTDate()` 를 날짜 계산에서 전부 제거 (`getKSTDate`는 삭제, `log` 타임스탬프는 `toISOString()` 로)
   - 기존 라벨과 연속: 지금도 10/1 실행분이 `2026-09-30` 으로 저장되고 있으므로 고친 뒤에도 같은 날짜가 찍힌다. 마이그레이션 불필요
3. `bun run report -- --date 2026-09-26` 단일 날짜, `--from/--to` 범위 지원. `generate-reports-batch.ts` 삭제
4. 테스트: `TZ=UTC` 와 `TZ=Asia/Seoul` 두 번 돌려 같은 결과 (`kstDayRange`, 경계 23:59/00:00, 월말)

확인: 두 TZ 에서 `bun test` 통과 / `TZ=UTC bun run report -- --date 2026-09-30 --dry-run` 이 9/30 KST 하루치(78개) 조회

## 3단계 — 운영 반영 (Render 그대로)

1. PR → 리뷰 깨끗하면 머지
2. Render 환경변수: `TYPESAFE_API_KEY` 추가, `OPENAI_MODEL=gpt-6-luna` — 코드 머지 후에 바꾼다(순서 반대면 분석 0건)
3. 다음 크론 1회 결과를 DB로 확인: 신규 기사 저장 수, `quality_score` not null, 근거 검증 `unverified` 비율
4. 다음날 07시 리포트: 기사 수가 전날 하루치인지, 본문 1회 읽고 품질 확인
5. 빠진 날짜 백필: 2026-08-01 이후 누락 11일(8/1, 8/3, 8/12, 8/17, 8/19, 9/7, 9/10, 9/11, 9/15, 9/23, 9/26). 이미 있는 리포트는 다시 만들지 않는다(사용자가 본 내용이 바뀜)

이 단계가 이틀 연속 정상이면 Workers 진입점 작업(`src/worker.ts`, `scheduled` 핸들러, UTC 크론 `0 0,6,12,18 * * *`(KST 09/15/21/03시, 지금과 같음) / `0 22 * * *`(KST 07시))으로 넘어간다.
