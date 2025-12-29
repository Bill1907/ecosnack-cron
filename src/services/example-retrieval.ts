/**
 * 예시 검색 서비스 - 피드백 루프 기반 동적 Few-shot 예시 제공
 *
 * DB에 저장된 고품질 분석 예시를 검색하여
 * 새로운 기사 분석 시 프롬프트에 포함
 */

import { getPrisma } from "@/services/database.ts";
import type { RawNewsArticle } from "@/types/index.ts";
import { log } from "@/utils/index.ts";

// ============================================
// 타입 정의
// ============================================

export interface RetrievedExample {
  title: string;
  description: string | null;
  source: string | null;
  region: string | null;
  category: string | null;
  headlineSummary: string | null;
  soWhat: unknown;
  impactAnalysis: unknown;
  relatedContext: unknown;
  keywords: string[];
  sentiment: unknown;
  importanceScore: number | null;
  qualityRating: number | null;
}

// ============================================
// 예시 검색 함수
// ============================================

/**
 * 프롬프트에 포함할 좋은 예시 검색
 *
 * 우선순위:
 * 1. isExemplar=true 인 기사
 * 2. 같은 카테고리 우선
 * 3. 같은 지역 우선
 * 4. 최근 30일 내 기사
 * 5. qualityRating 높은 순
 *
 * @param article - 분석할 기사 (유사한 예시 찾기 위한 기준)
 * @param limit - 반환할 최대 예시 수
 * @returns 검색된 예시 목록
 */
export async function getExamplesForPrompt(
  article: RawNewsArticle,
  limit: number = 2
): Promise<RetrievedExample[]> {
  try {
    const prisma = getPrisma();

    // 30일 전 날짜 계산
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 기사 제목에서 카테고리 추론 (간단한 키워드 매칭)
    const inferredCategory = inferCategory(article.title);

    // 1차: isExemplar=true 인 기사 검색
    const exemplars = await prisma.article.findMany({
      where: {
        isExemplar: true,
        headlineSummary: { not: null }, // 분석 완료된 기사만
        ...(inferredCategory && { category: inferredCategory }),
      },
      orderBy: [{ qualityRating: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        title: true,
        description: true,
        source: true,
        region: true,
        category: true,
        headlineSummary: true,
        soWhat: true,
        impactAnalysis: true,
        relatedContext: true,
        keywords: true,
        sentiment: true,
        importanceScore: true,
        qualityRating: true,
      },
    });

    // 충분한 예시가 있으면 반환
    if (exemplars.length >= limit) {
      log(`피드백 루프: ${exemplars.length}개 exemplar 예시 사용`);
      return exemplars;
    }

    // 2차: exemplar가 부족하면 높은 평점 기사로 보완
    const remaining = limit - exemplars.length;
    const highRated = await prisma.article.findMany({
      where: {
        isExemplar: false,
        qualityRating: { gte: 4 }, // 4점 이상만
        headlineSummary: { not: null },
        createdAt: { gte: thirtyDaysAgo },
        // 이미 선택된 기사 제외 (title 기준으로 필터링)
        title: { notIn: exemplars.map((ex: RetrievedExample) => ex.title) },
        ...(article.region && { region: article.region }),
      },
      orderBy: [{ qualityRating: "desc" }, { createdAt: "desc" }],
      take: remaining,
      select: {
        title: true,
        description: true,
        source: true,
        region: true,
        category: true,
        headlineSummary: true,
        soWhat: true,
        impactAnalysis: true,
        relatedContext: true,
        keywords: true,
        sentiment: true,
        importanceScore: true,
        qualityRating: true,
      },
    });

    const combined = [...exemplars, ...highRated];
    log(`피드백 루프: ${combined.length}개 예시 사용 (exemplar: ${exemplars.length}, highRated: ${highRated.length})`);

    return combined;
  } catch (error) {
    // DB 오류 시 빈 배열 반환 (기본 예시 사용하도록)
    log(`예시 검색 오류: ${error}`, "warn");
    return [];
  }
}

/**
 * 제목에서 카테고리 추론
 */
function inferCategory(title: string): string | null {
  const lowerTitle = title.toLowerCase();

  const categoryKeywords: Record<string, string[]> = {
    policy: [
      "fed",
      "연준",
      "금리",
      "interest rate",
      "fomc",
      "한은",
      "기준금리",
      "통화정책",
      "central bank",
    ],
    economy: [
      "gdp",
      "cpi",
      "인플레이션",
      "inflation",
      "경제성장",
      "실업률",
      "unemployment",
      "물가",
      "경기",
    ],
    business: [
      "실적",
      "영업이익",
      "매출",
      "earnings",
      "revenue",
      "profit",
      "분기",
      "quarter",
      "ceo",
    ],
    markets: [
      "코스피",
      "kospi",
      "s&p",
      "nasdaq",
      "주가",
      "stock",
      "채권",
      "bond",
      "유가",
      "oil",
    ],
    trade: [
      "수출",
      "수입",
      "export",
      "import",
      "관세",
      "tariff",
      "무역",
      "trade",
    ],
    finance: ["은행", "bank", "대출", "loan", "예금", "deposit", "금융"],
  };

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((kw) => lowerTitle.includes(kw))) {
      return category;
    }
  }

  return null;
}

/**
 * 검색된 예시를 프롬프트용 텍스트로 포맷팅
 */
export function formatRetrievedExample(example: RetrievedExample): string {
  return `
### DB 저장 예시: ${example.title}

**입력 정보:**
- 제목: ${example.title}
- 설명: ${example.description ?? "(없음)"}
- 출처: ${example.source ?? "Unknown"}
- 카테고리: ${example.category ?? "Unknown"}

**분석 결과 (품질 평가: ${example.qualityRating ?? "미평가"}/5):**
- 요약: ${example.headlineSummary}
- 중요도: ${example.importanceScore}/10
- 키워드: ${example.keywords.join(", ")}
`;
}

/**
 * 기사에 exemplar 마킹
 */
export async function markAsExemplar(
  articleId: number,
  qualityRating: number = 5,
  notes?: string
): Promise<void> {
  const prisma = getPrisma();

  await prisma.article.update({
    where: { id: articleId },
    data: {
      isExemplar: true,
      qualityRating,
      feedbackNotes: notes,
      reviewedAt: new Date(),
    },
  });

  log(`기사 #${articleId}를 exemplar로 마킹 (품질: ${qualityRating}/5)`);
}

/**
 * 기사 품질 평가
 */
export async function rateArticle(
  articleId: number,
  rating: number,
  notes?: string
): Promise<void> {
  const prisma = getPrisma();

  await prisma.article.update({
    where: { id: articleId },
    data: {
      qualityRating: Math.min(5, Math.max(1, rating)), // 1-5 범위 강제
      feedbackNotes: notes,
      reviewedAt: new Date(),
    },
  });

  log(`기사 #${articleId} 품질 평가: ${rating}/5`);
}

/**
 * 피드백 통계 조회
 */
export async function getFeedbackStats(): Promise<{
  totalReviewed: number;
  exemplarCount: number;
  avgRating: number;
}> {
  const prisma = getPrisma();

  const [totalReviewed, exemplarCount, avgResult] = await Promise.all([
    prisma.article.count({ where: { qualityRating: { not: null } } }),
    prisma.article.count({ where: { isExemplar: true } }),
    prisma.article.aggregate({
      _avg: { qualityRating: true },
      where: { qualityRating: { not: null } },
    }),
  ]);

  return {
    totalReviewed,
    exemplarCount,
    avgRating: avgResult._avg.qualityRating ?? 0,
  };
}
