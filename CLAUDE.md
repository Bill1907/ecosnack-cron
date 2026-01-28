# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

경제 뉴스를 수집하고 AI로 분석하여 NEON PostgreSQL에 저장하는 크론 작업 시스템. Render에서 Docker 기반으로 운영.

## 주요 명령어

```bash
# 뉴스 수집/분석 실행
bun run cron

# 데일리 리포트 생성
bun run report

# 개발 모드 (watch)
bun run dev

# 테스트
bun test
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

### 뉴스 수집 파이프라인 (`src/index.ts`)
```
RSS 수집 → Stage 0: 중복 필터링 → Stage 1: 제목 필터링 (250→30)
         → Stage 2: 품질 필터링 + 이미지 추출 (30→20)
         → Stage 3: AI 상세 분석 (병렬) → DB 저장
```

### 데일리 리포트 파이프라인 (`src/generate-report.ts`)
```
오늘 기사 조회 (상위 30개) → AI 종합 분석 → DB 저장 (upsert)
```

### 핵심 서비스
- `services/news-fetcher.ts` - RSS 피드 수집
- `services/news-analyzer.ts` - 3단계 필터링 + AI 분석 (OpenAI)
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
- **AI**: OpenAI API (gpt-4o-mini), zodResponseFormat 사용
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

Render Cron Jobs (Docker):
- 뉴스 수집: `bun run cron` (6시간마다)
- 리포트 생성: `bun run report` (1일 1회)

Docker Command 오버라이드로 같은 이미지에서 다른 작업 실행.
