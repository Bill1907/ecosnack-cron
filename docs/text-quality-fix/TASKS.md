# TASKS — 생성 텍스트 오염 차단 + 수집 결함 2건

한 행 = 한 커밋. 상태: ⬜ 대기 · 🟦 진행 · ✅ 완료(해시) · ❌ 막힘. 계획과 역할은 `PLAN.md`.

| ID | 커밋 메시지 | 담당 | 쓰기 범위 | 완료 기준 (RED → GREEN) | 하네스 | 상태 |
|---|---|---|---|---|---|---|
| T0 | `docs: 생성 텍스트 오염 차단 계획, 코퍼스 라벨, 피드 조사` | 나 (R1·R2·A1 결과) | `docs/text-quality-fix/**`, `tests/fixtures/feeds/**` | 라벨 JSON에 의심 구간 전부(현재 스캔 기준 기사 16 + 리포트 27곳)가 오염/정상으로 분류돼 있고, 오염에는 고친 문장이 있다 | — | ⬜ |
| T1 | `feat: 생성 텍스트의 외국 문자·지시문 누출 검출기` | W1 | `src/utils/script-guard.ts`, `tests/script-guard.test.ts`, `tests/fixtures/script-contamination.json` | RED: 테스트가 모듈 없음으로 실패. GREEN: `detector_expected=true` 47개 전부 검출, 라벨된 정상 0건, 지시문 누출 문장(「일본어 사용 금지 유의하세요」「100자 내외 설명입니다」 등) 검출, 「내부 규정을 재점검」 같은 정상 문장 통과, 아랍·칸나다·가나 단독 케이스와 입력 원문에 있는 한자 허용 케이스 포함 | H1, H2 | ⬜ |
| T2 | `fix: 기사 분석에 외국 문자가 섞이면 다시 생성` | W1 | `src/services/openai-client.ts`, `src/services/news-analyzer.ts`, `tests/news-analyzer.test.ts` 또는 새 테스트 | RED: 목 OpenAI가 1회차 오염, 2회차 정상 응답을 줄 때 지금 코드는 오염 결과를 그대로 반환한다. GREEN: 호출 2회, 결과는 정상. 끝까지 오염이면 그 기사는 null(스킵)이고 로그에 `언어 오염` | H1, H3 | ⬜ |
| T3 | `fix: 리포트에 외국 문자가 섞이면 다시 생성` | W1 | `src/services/daily-report.ts`, 리포트 테스트 | RED: 오염 응답이 저장 경로까지 간다. GREEN: 재시도 후 정상이면 저장, 끝까지 오염이면 throw하고 저장 함수는 불리지 않는다. 입력 기사 제목에 있는 한자(「美 10년물」)는 통과 | H1, H3 | ⬜ |
| T4 | `fix: 404 나는 Yahoo Finance 피드를 CBS MoneyWatch로 교체` | W1 | `src/services/news-fetcher.ts`, `tests/news-fetcher.test.ts` | RED: 소스 목록에 `finance.yahoo.com/news/rssindex`가 있다. GREEN: 없고, 새 피드의 실제 XML 픽스처가 제목·링크·발행시각을 가진 항목 N개(R2 측정값)로 파싱된다 | H1 | ⬜ |
| T5 | `fix: 기사 일괄 저장을 트랜잭션 없는 단일 INSERT로` | W1 | `src/services/database.ts`, `tests/database.test.ts` | RED: 저장이 `$transaction`을 쓴다. GREEN: `createMany({ skipDuplicates: true })` 한 번, 반환값이 신규 수, 실패 시 개별 저장 폴백은 유지 | H1, H6 | ⬜ |
| T6 | `chore: 저장된 오염 텍스트 치환 스크립트` | 나 | `scripts/repair-script-contamination.ts` | 입력은 `labels/labels.json` + R1b의 `labels/meta-labels.json`. 기본은 dry-run(바꿀 행·전후 문장 출력). 적용 뒤 H2 재스캔에서 「오염」 라벨 0건, 지시문 누출 문구 0건, 「정상」 라벨 수 그대로. heyvona.com 10/12 페이지에 `盈彩票` 0건 | H2 | ⬜ |
| R-x | `docs(review): <ID> 판정` | V1 | `docs/text-quality-fix/reviews/` | 판정 파일은 코드 커밋과 따로 | — | ⬜ |

## 발견했지만 미룬 것

`PLAN.md` §8 참고(10월 이전 리포트 재생성, 근거 검증 음성 대조, 피드 실패 알림, 말투 점수).
