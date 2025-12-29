# AI 분석 품질 개선 진행 상황

## Phase 1: 프롬프트 강화 ✅
- [x] `src/prompts/examples.ts` - Few-shot 예시 작성
  - [x] policy 카테고리 예시
  - [x] earnings 카테고리 예시
  - [x] macro 카테고리 예시
- [x] `src/prompts/rubrics.ts` - 중요도 Rubric 작성
- [x] `src/prompts/chain-of-thought.ts` - CoT 템플릿 작성

## Phase 2: 프롬프트 빌더 ✅
- [x] `src/services/prompt-builder.ts` - 동적 프롬프트 생성
- [x] `src/services/news-analyzer.ts` - 프롬프트 빌더 통합
- [x] 테스트 실행 및 검증 (77 tests passed)

## Phase 3: 피드백 루프 ✅
- [x] `prisma/schema.prisma` - 피드백 필드 추가
- [x] `bunx prisma db push` - 스키마 적용
- [x] `src/services/example-retrieval.ts` - 예시 검색 서비스

## 완료 후 검증
- [ ] 크론 실행하여 분석 품질 확인
- [ ] 이전 분석 결과와 비교

---

## 사용 방법

### 1. 기사 품질 평가 (피드백 루프)
```typescript
import { rateArticle, markAsExemplar } from "@/services/example-retrieval.ts";

// 기사 품질 평가 (1-5점)
await rateArticle(articleId, 5, "매우 깊이 있는 분석");

// 좋은 예시로 마킹 (Few-shot에 사용됨)
await markAsExemplar(articleId, 5, "정책 뉴스 분석의 좋은 예시");
```

### 2. 피드백 통계 확인
```typescript
import { getFeedbackStats } from "@/services/example-retrieval.ts";

const stats = await getFeedbackStats();
// { totalReviewed: 10, exemplarCount: 3, avgRating: 4.2 }
```

### 3. 새 카테고리 예시 추가
`src/prompts/examples.ts`에 새 예시 추가:
```typescript
export const NEW_EXAMPLE: AnalysisExample = {
  category: "trade",
  input: { title: "...", description: "...", source: "...", region: "US" },
  output: { /* NewsAnalysisResult 형식 */ },
  reasoning: "왜 이렇게 분석했는지 설명"
};
```
