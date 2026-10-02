# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

경제 뉴스를 수집하고 AI로 분석하여 NEON PostgreSQL에 저장하는 크론 작업 시스템. Cloudflare Workers Cron Triggers 로 운영 (2026-10 Render 에서 이전).

## 주요 명령어

```bash
# 뉴스 수집/분석 실행 (--dry-run: 저장 안 함)
bun run cron

# 데일리 리포트 생성 — 기준일 = 실행 시각 기준 KST 어제
bun run report
bun run report --date 2026-09-26                       # 특정 날짜
bun run report --from 2026-08-01 --to 2026-08-19       # 백필
bun run report --date 2026-09-30 --dry-run --out /tmp  # 저장 없이 본문 JSON 확인

# 개발 모드 (watch)
bun run dev

# 테스트
bun test
bun run test:tz              # TZ=UTC / Asia/Seoul 두 번 (날짜 계산 검증)
bun test --watch              # watch 모드
bun test tests/specific.test.ts  # 단일 파일

# 타입 체크
bun run typecheck

# Prisma
bun run db:generate   # 클라이언트 생성
bun run db:push       # 스키마 푸시
bun run db:studio     # Studio 실행
```

## 아키텍처

### 뉴스 수집 파이프라인 (`src/jobs/collect-news.ts`, CLI `src/index.ts`)
```
RSS 수집 → Stage 0: 중복 필터링 → Stage 1: 제목 점수 (Jev, 250→30)
         → Stage 2: 품질 점수 (Jev) + 이미지 추출 (30→20)
         → Stage 3: 상세 분석 (gpt-6-luna, 병렬) → DB 저장
Stage 3 성공률 < 50% 이면 exit 1 (0개 저장하고 성공으로 끝나지 않게)
```

### 데일리 리포트 파이프라인 (`src/jobs/report.ts`, CLI `src/generate-report.ts`)
```
기준일(KST 어제) 00:00~24:00 기사 조회 → 종합 분석 (gpt-6-luna)
→ 근거 검증 (Jev Choice, 확신도 < 0.8 은 gpt-5.6-luna 재판정) → 품질 평가 (Jev Score ×6)
→ DB 저장 (upsert)
```

### 모델 역할
- **판정 (Jev, TypeSafe System One)**: 제목/품질 점수, 근거 검증, 리포트 품질 평가 — `services/jev-client.ts`
- **생성 (OpenAI)**: 기사 분석, 리포트 작성 — `services/openai-client.ts` 의 `createStructured()` 만 쓴다
- gpt-5 이후 모델은 `max_tokens` / `temperature≠1` 을 400 으로 거부 → `max_completion_tokens` 만, temperature 는 보내지 않는다
- 판정 실패를 "유효"나 기본 점수로 메우지 않는다. 근거는 `unverified`, 점수 서비스는 LLM 폴백 후에도 실패하면 throw

### 날짜
- 날짜 계산은 `utils/kst.ts` 의 순수 함수만 쓴다 (`setHours`, 로컬 TZ 의존 금지). Render 는 TZ=Asia/Seoul, Workers 는 UTC
- `report_date`(Postgres date) 는 `toDbDate("YYYY-MM-DD")` = UTC 자정

### 핵심 서비스
- `services/news-fetcher.ts` - RSS 피드 수집
- `services/news-analyzer.ts` - 3단계 필터링 + AI 분석
- `services/article-scoring.ts` - 제목/품질 점수 (Jev → LLM 폴백)
- `services/evidence-validator.ts`, `services/quality-evaluator.ts` - 리포트 근거·품질 판정 (Jev)
- `services/daily-report.ts` - 데일리 리포트 생성
- `services/database.ts` - Prisma + NEON 어댑터
- `services/prompt-builder.ts` - Few-shot + CoT 프롬프트 동적 생성

### AI 분석 구조
- `schemas/news-analysis.ts` - 개별 뉴스 분석 Zod 스키마
- `schemas/daily-report.ts` - 리포트 Zod 스키마 (OpenAI Structured Outputs용)
- `prompts/` - Few-shot 예시, 루브릭, Chain-of-Thought 프롬프트

## 기술 스택

- **Runtime**: Bun (Node.js, npm, vite 대신 Bun 사용)
- **Database**: NEON PostgreSQL + Prisma 7 + @prisma/adapter-neon
- **AI**: OpenAI (생성: gpt-6-luna, 재판정: gpt-5.6-luna), TypeSafe Jev `jev-1.13.0` (판정)
- **Validation**: Zod

## 코드 규칙

- Bun 우선 사용 (`bun`, `bun test`, `bunx`)
- 파일명: kebab-case
- TypeScript strict mode
- 한글 주석 허용
- JSON 필드 Prisma 저장 시 `as unknown as Prisma.InputJsonValue` 패턴 사용

## DB 모델

**Article** - 개별 뉴스 기사 + AI 분석 결과 (soWhat, impactAnalysis, relatedContext)
**DailyReport** - 일일 종합 리포트 (executiveSummary, marketOverview, keyInsights)

## 배포

Cloudflare Workers (`src/worker.ts`, `wrangler.jsonc`, Workers Paid 플랜 필요):
- 뉴스 수집: UTC `0 0,6,12,18 * * *` (KST 03/09/15/21시)
- 리포트 생성: UTC `0 22 * * *` (KST 07시, 기준일 = KST 어제)
- 배포: `bunx wrangler deploy` (크론 식을 바꾸면 `src/worker.ts` 의 `CRONS` 도 같이 — 테스트가 검사한다)
- 비밀값: `bunx wrangler secret put DATABASE_URL | OPENAI_API_KEY | TYPESAFE_API_KEY | OPENAI_MODEL`
- 로컬 검증: `.env` 를 `.dev.vars` 로 복사 + `DRY_RUN=true` → `bunx wrangler dev --test-scheduled` 후
  `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+22+*+*+*"`
- 수동 실행·백필은 Workers 가 아니라 로컬 CLI (`bun run report --from ... --to ...`)

Render Cron Jobs(Docker, `Dockerfile`)는 2026-10-02 정지 — 되돌릴 때만 Resume.
