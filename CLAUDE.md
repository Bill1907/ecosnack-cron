# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Economic news aggregation and AI analysis cron system. Collects RSS feeds, filters/analyzes articles through a multi-stage AI pipeline, stores results in NEON PostgreSQL, and generates daily reports. Deployed on Render as Docker-based cron jobs.

Frontend: [heyvoan.com](https://heyvoan.com) (separate repo)

## Quick Reference

```bash
# Core commands
bun run cron                      # Run news collection/analysis pipeline
bun run report                    # Generate daily report
bun run report:personal           # Generate personalized reports
bun run dev                       # Dev mode (watch)

# Testing
bun test                          # Run all tests
bun test --watch                  # Watch mode
bun test tests/specific.test.ts   # Single file

# Type checking
bun run typecheck                 # tsc --noEmit

# Database (Prisma)
bun run db:generate               # Generate Prisma client
bun run db:push                   # Push schema to DB
bun run db:migrate                # Run migrations
bun run db:studio                 # Open Prisma Studio
```

## Architecture

### News Collection Pipeline (`src/index.ts`)

```
RSS feeds (6 sources) → Stage 0: Dedup (DB link check)
                       → Stage 1: Title filtering (250 → 30, AI scored)
                       → Stage 2: Quality filtering + image extraction (30 → 20)
                       → Stage 3: Detailed AI analysis (parallel, 3min timeout each)
                       → Batch upsert to DB
```

### Daily Report Pipeline (`src/generate-report.ts`)

```
Fetch today's articles (top 30) → AI comprehensive analysis
  → Quality evaluation (6 dimensions, optional)
  → Evidence validation (optional)
  → Upsert DailyReport to DB
  → Generate personalized reports for eligible users (3+ bookmarks)
```

### Personalized Report Pipeline (`src/generate-personalized-report.ts`)

```
Fetch eligible users (3+ bookmarks) → Score articles by user preferences
  → Generate personalized report per user → Upsert PersonalizedDailyReport
```

### Directory Structure

```
src/
├── index.ts                        # Entry: news collection cron
├── generate-report.ts              # Entry: daily report generation
├── generate-personalized-report.ts # Entry: personalized reports
├── generate-reports-batch.ts       # Entry: batch backfill reports
├── config/
│   └── index.ts                    # Env config loading & validation
├── services/
│   ├── news-fetcher.ts             # RSS feed collection (6 sources)
│   ├── news-analyzer.ts            # 4-stage filtering + AI analysis
│   ├── daily-report.ts             # Daily report generation
│   ├── personalized-report.ts      # Personalized report generation
│   ├── database.ts                 # Prisma + NEON serverless adapter
│   ├── openai-client.ts            # OpenAI client singleton (120s timeout)
│   ├── prompt-builder.ts           # Dynamic few-shot + CoT prompt assembly
│   ├── example-retrieval.ts        # Few-shot example fetching from DB
│   ├── quality-evaluator.ts        # AI self-evaluation (6 dimensions)
│   ├── evidence-validator.ts       # Evidence relevance validation
│   └── user-preferences.ts         # User preference analysis
├── schemas/
│   ├── news-analysis.ts            # Article analysis Zod schemas
│   ├── daily-report.ts             # Report Zod schemas (Structured Outputs)
│   ├── quality-evaluation.ts       # Quality/evidence validation schemas
│   └── personalized-report.ts      # Personalized report schemas
├── types/
│   ├── index.ts                    # Core types (RawNewsArticle → AnalyzedNewsArticle pipeline)
│   ├── daily-report.ts             # Report data types + buildArticleUrl()
│   └── user-preferences.ts         # User preference & scoring types
├── prompts/
│   ├── examples.ts                 # Few-shot examples (policy, earnings, macro)
│   ├── rubrics.ts                  # Scoring rubrics (importance, sentiment, category)
│   └── chain-of-thought.ts         # CoT templates + tone guidelines
└── utils/
    └── index.ts                    # Logging, retry, timeout, KST dates, sanitization
tests/
├── utils.test.ts
├── config.test.ts
├── database.test.ts
├── news-analyzer.test.ts
├── news-fetcher.test.ts
├── with-timeout.test.ts
└── sanitize-meta-comments.test.ts
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Runtime** | Bun |
| **Language** | TypeScript (strict mode) |
| **Database** | NEON PostgreSQL + Prisma 7 + @prisma/adapter-neon |
| **AI** | OpenAI API (gpt-4o-mini / gpt-5-mini), zodResponseFormat for Structured Outputs |
| **Validation** | Zod 4 |
| **RSS Parsing** | fast-xml-parser |
| **HTML Parsing** | cheerio (image extraction) |
| **Deployment** | Render Cron Jobs (Docker, oven/bun:1-alpine) |

## Database Models (Prisma)

5 models in `prisma/schema.prisma`:

- **Article** - News articles + AI analysis (soWhat, impactAnalysis, relatedContext as JSONB). Feedback fields (qualityRating, isExemplar) for few-shot learning. Indexed on pubDate, createdAt, source, region, category, isExemplar, qualityRating.
- **DailyReport** - Daily comprehensive report (executiveSummary, marketOverview, keyInsights). Unique on reportDate. Optional qualityEvaluation and evidenceValidation.
- **User** - Clerk-based auth (clerkId as PK). Relations to bookmarks, preferences, personalized reports.
- **Bookmark** - User article bookmarks. Unique on (userId, articleId). Cascade delete.
- **UserPreference** - Computed from bookmarks (topCategories, topKeywords, preferredSources, sentimentBias). Unique on userId.
- **PersonalizedDailyReport** - Per-user daily reports. Unique on (userId, reportDate). Same structure as DailyReport + preferenceSnapshot.

### JSON Field Pattern

When saving JSON to Prisma, always cast:
```typescript
soWhat: analysisResult.so_what as unknown as Prisma.InputJsonValue
```

## Code Conventions

- **Package manager**: Always use `bun` (not npm/yarn). Use `bunx` for CLI tools.
- **File naming**: kebab-case (`news-analyzer.ts`, `daily-report.ts`)
- **TypeScript**: Strict mode enabled. Path alias `@/*` maps to `src/*`.
- **Comments**: Korean comments are standard throughout the codebase
- **Error handling**: Use `withRetry()` for network calls (3 retries, exponential backoff). Use `withTimeout()` for AI calls.
- **Logging**: Use `log(message, level)` from `utils/index.ts` (KST timestamps)
- **AI responses**: Always use `zodResponseFormat` with Zod schemas for structured OpenAI outputs
- **Database operations**: Use batch upsert with unique constraint handling for idempotency
- **Prompt engineering**: Dynamic few-shot examples from DB (isExemplar articles) with static fallback

## RSS Sources

6 feeds defined in `services/news-fetcher.ts`:
- CNBC Business News (en/global)
- CNBC Economy (en/global)
- Yahoo Finance (en/global)
- MBN (ko/kr)
- Maeil Business (ko/kr)
- Hankyung (ko/kr)

## Environment Variables

Required (see `.env.example`):
- `DATABASE_URL` - NEON PostgreSQL connection string (with pooling params)
- `OPENAI_API_KEY` - OpenAI API key
- `OPENAI_MODEL` - Model name (default: gpt-5-mini)

Optional:
- `NEWS_API_KEY` - News API key (unused currently)
- `TZ` - Timezone (default: Asia/Seoul)
- `SKIP_QUALITY_EVAL` - Skip quality evaluation step in report generation
- `SKIP_EVIDENCE_CHECK` - Skip evidence validation step in report generation

## Deployment

Render Cron Jobs (Docker):
- **News collection**: `bun run cron` (every 6 hours)
- **Daily report**: `bun run report` (once daily)
- **Personalized reports**: `bun run report:personal`

Same Docker image, different commands via Render command override.

## Type Pipeline

```
RawNewsArticle → TitleFilteredArticle → QualityFilteredArticle → AnalyzedNewsArticle → DB
```

Each stage progressively enriches the article with scores and AI analysis results.
