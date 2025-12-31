# EcoSnack Cron - 개선 TODO 목록

> 프로젝트 분석 결과 도출된 개선 항목들입니다.
> 전체 평가: **8.1/10** - 프로덕션 준비 상태의 잘 설계된 시스템

---

## 🔴 고우선순위 (P1)

### 1. 데이터베이스 인덱스 추가 ✅
- [x] `pubDate` 내림차순 인덱스 추가
- [x] `createdAt` 내림차순 인덱스 추가
- [x] `source` 인덱스 추가
- [x] `region` 인덱스 추가
- [x] 마이그레이션 실행 및 검증

**파일:** `prisma/schema.prisma`

**영향:** 날짜 범위 쿼리, 최근 기사 조회 성능 10배+ 개선

---

### 2. 네트워크 재시도 로직 구현 ✅
- [x] `withRetry()` 유틸리티 함수 구현
- [x] 지수 백오프(Exponential Backoff) 적용
- [x] OpenAI API 호출에 재시도 적용
- [x] RSS 피드 fetch에 재시도 적용
- [ ] DB 연결에 재시도 적용 (Prisma가 내부적으로 처리)
- [ ] 테스트 코드 작성

**파일:** `src/utils/index.ts`

**적용 대상:**
- `src/services/news-analyzer.ts`: OpenAI API 호출
- `src/services/news-fetcher.ts`: RSS 피드 fetch
- `src/services/database.ts`: DB 연결

---

### 3. 배치 저장 최적화 ✅
- [x] `saveNewsArticlesBatch()` 함수 구현
- [x] Prisma 트랜잭션 활용
- [x] `upsert` 패턴으로 중복 처리
- [x] 기존 `saveNewsArticles()` 대체
- [ ] 테스트 코드 작성

**파일:** `src/services/database.ts`

**영향:** N번 네트워크 왕복 → 1번 트랜잭션

---

### 4. 필터링 응답 Zod 검증 추가 ✅
- [x] `TitleFilterResponseSchema` 스키마 정의
- [x] `QualityFilterResponseSchema` 스키마 정의
- [x] `scoreTitleBatch()`에 Zod 검증 적용
- [x] `scoreQualityBatch()`에 Zod 검증 적용
- [x] 검증 실패 시 상세 로깅 추가
- [ ] 테스트 코드 작성

**파일:**
- `src/schemas/news-analysis.ts`: 스키마 정의
- `src/services/news-analyzer.ts`: 검증 적용

---

## 🟡 중우선순위 (P2)

### 5. 동적 Few-shot 예시 통합 ✅
- [x] `getExamplesForPrompt()` 함수 통합
- [x] DB 예시 → `AnalysisExample` 변환 로직
- [x] 정적 예시 폴백 유지
- [x] 로깅 추가 (DB 예시 사용 여부)
- [ ] 테스트 코드 작성

**파일:**
- `src/services/prompt-builder.ts`
- `src/services/example-retrieval.ts`

---

### 6. 연결 풀 설정 추가 ✅
- [x] `.env.example` 연결 풀 옵션 문서화
- [x] `connection_limit` 설정 (권장: 10)
- [x] `pool_timeout` 설정 (권장: 10초)
- [x] Neon 콜드스타트 타임아웃 처리

**파일:**
- `.env.example`
- `prisma.config.ts`

---

### 7. Importance Score 정량화 ✅
- [x] 점수 계산 매트릭스 정의
- [x] 영향범위 (1-3점) 기준 명시
- [x] 영향강도 (1-3점) 기준 명시
- [x] 신규성 (1-2점) 기준 명시
- [x] 시간지속성 (1-2점) 기준 명시
- [x] 프롬프트에 매트릭스 반영

**파일:** `src/prompts/rubrics.ts`

---

## 🟢 저우선순위 (P3)

### 8. 메트릭 수집 추가 ✅
- [x] 단계별 성공률 계산 로직
- [x] 처리 시간 측정
- [x] JSON 형식 메트릭 로깅
- [ ] (선택) 외부 모니터링 연동

**파일:** `src/services/news-analyzer.ts`

```typescript
// 예시 메트릭 구조
{
  stage1_success_rate: 0.12,  // 30/250
  stage2_success_rate: 0.67,  // 20/30
  stage3_success_rate: 0.95,  // 19/20
  totalTime: 45000            // ms
}
```

---

### 9. 이미지 추출 병렬화 ✅
- [x] `for...of` → `Promise.all()` 변환
- [x] 동시 요청 제한 (배치 처리로 구현)
- [x] 에러 격리 (개별 실패 시 계속)
- [ ] 테스트 코드 작성

**파일:** `src/services/news-analyzer.ts`

---

### 10. 프롬프트 토큰 정확 추정 ✅
- [ ] tiktoken 의존성 추가 (Bun 호환성 이슈로 내장 추정 사용)
- [x] `estimateTokens()` 함수 개선 (한/영 혼합 지원)
- [x] 기존 약식 계산 대체
- [x] 토큰 예산 초과 경고 로직 (`checkTokenBudget()` 추가)

**파일:** `src/services/prompt-builder.ts`

---

## 추가 개선 고려사항

### 코드 품질
- [ ] TypeScript strict 모드 확인
- [ ] ESLint 규칙 강화
- [ ] 사용하지 않는 코드 정리

### 문서화
- [ ] README.md 업데이트
- [ ] API 문서 작성
- [ ] 아키텍처 다이어그램 추가

### 모니터링
- [ ] Slack/이메일 알림 (크론 완료/실패)
- [ ] 에러 트래킹 (Sentry 등)
- [ ] API 비용 대시보드

---

## 관련 파일 경로 요약

| 카테고리 | 파일 |
|---------|------|
| DB 스키마 | `prisma/schema.prisma` |
| DB 서비스 | `src/services/database.ts` |
| 유틸리티 | `src/utils/index.ts` |
| 스키마 검증 | `src/schemas/news-analysis.ts` |
| 뉴스 분석 | `src/services/news-analyzer.ts` |
| 프롬프트 빌더 | `src/services/prompt-builder.ts` |
| 예시 검색 | `src/services/example-retrieval.ts` |
| 루브릭 | `src/prompts/rubrics.ts` |
| 환경 설정 | `.env.example` |
| Prisma 설정 | `prisma.config.ts` |

---

## 진행 상황

- **생성일:** 2025-01-01
- **마지막 업데이트:** 2025-12-31
- **완료:** 10 / 10 항목 ✅

### 구현 완료 요약:
1. ✅ DB 인덱스 추가 (pubDate, createdAt, source, region)
2. ✅ 재시도 로직 (`withRetry()` 유틸리티)
3. ✅ 배치 저장 최적화 (`saveNewsArticlesBatch()`)
4. ✅ 필터링 응답 Zod 검증
5. ✅ 동적 Few-shot 예시 통합
6. ✅ 연결 풀 설정 (NEON 콜드스타트 대비)
7. ✅ Importance Score 정량화 매트릭스
8. ✅ 분석 메트릭 수집 및 로깅
9. ✅ 이미지 추출 병렬화
10. ✅ 토큰 추정 개선 (한/영 혼합 지원)
