# EcoSnack Cron - 경제 뉴스 수집 및 분석 시스템

## 프로젝트 개요

경제 뉴스를 수집하고 분석하여 NEON 데이터베이스에 저장하는 크론 작업 시스템

### 핵심 기능
- 뉴스 URL에서 경제 뉴스 데이터 수집
- 한국 시간(KST) 기준 매일 오전 8시 실행
- 뉴스 분석 및 요약
- NEON PostgreSQL 데이터베이스에 저장

## 기술 스택

- **Runtime**: Bun
- **Language**: TypeScript
- **Database**: NEON PostgreSQL
- **ORM**: Prisma 7
- **Scheduling**: Cron job (외부 스케줄러 또는 시스템 cron)

## 프로젝트 구조

```
ecosnack-cron/
├── src/
│   ├── index.ts           # 메인 엔트리포인트
│   ├── config/
│   │   └── index.ts       # 환경 설정
│   ├── services/
│   │   ├── news-fetcher.ts    # 뉴스 수집 서비스
│   │   ├── news-analyzer.ts   # 뉴스 분석 서비스
│   │   └── database.ts        # Prisma DB 연결
│   ├── types/
│   │   └── index.ts       # 타입 정의
│   └── utils/
│       └── index.ts       # 유틸리티 함수
├── prisma/
│   └── schema.prisma      # Prisma 스키마
├── prisma.config.ts       # Prisma 설정 (NEON 어댑터)
├── tests/
│   └── *.test.ts          # 테스트 파일
├── .env                   # 환경 변수 (gitignore)
├── .env.example           # 환경 변수 예시
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

## 환경 변수

```env
# Database (NEON PostgreSQL)
DATABASE_URL=postgresql://user:pass@host.neon.tech/db?sslmode=require

# News API (필요시)
NEWS_API_KEY=your_api_key

# Timezone
TZ=Asia/Seoul
```

## 개발 규칙

### 코드 스타일
- TypeScript strict mode 사용
- 함수형 프로그래밍 선호
- 에러 핸들링 필수
- 한글 주석 허용

### 네이밍 컨벤션
- 파일: kebab-case (예: news-fetcher.ts)
- 변수/함수: camelCase
- 타입/인터페이스: PascalCase
- 상수: UPPER_SNAKE_CASE

### 커밋 메시지
- feat: 새 기능
- fix: 버그 수정
- refactor: 리팩토링
- docs: 문서 수정
- chore: 설정 변경

## 주요 명령어

```bash
# 개발 실행
bun run dev

# 프로덕션 실행
bun run start

# 테스트
bun test

# 타입 체크
bun run typecheck

# 크론 작업 수동 실행
bun run cron

# Prisma 명령어
bun run db:generate   # Prisma 클라이언트 생성
bun run db:push       # 스키마를 DB에 푸시
bun run db:migrate    # 마이그레이션 생성/실행
bun run db:studio     # Prisma Studio 실행
```

## 데이터베이스 스키마

### articles 테이블 (Prisma Article 모델)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL | Primary Key |
| title | TEXT | 뉴스 제목 |
| link | TEXT UNIQUE | 뉴스 링크 |
| description | TEXT | 뉴스 설명 |
| pub_date | TIMESTAMPTZ | 발행일 |
| source | VARCHAR(100) | 뉴스 출처 |
| region | VARCHAR(10) | 지역 |
| headline_summary | TEXT | AI 요약 |
| so_what | JSONB | AI 분석 - So What |
| impact_analysis | JSONB | AI 분석 - 영향도 |
| related_context | JSONB | AI 분석 - 관련 컨텍스트 |
| keywords | TEXT[] | 키워드 배열 |
| category | VARCHAR(50) | 카테고리 |
| sentiment | JSONB | 감성 분석 |
| importance_score | INTEGER | 중요도 점수 |
| created_at | TIMESTAMPTZ | 생성일 |

## 참고 사항

- 한국 시간(KST, UTC+9) 기준으로 스케줄링
- 뉴스 중복 수집 방지 로직 (link UNIQUE 제약)
- Prisma 7 + NEON 어댑터 사용
- API 레이트 리밋 고려
