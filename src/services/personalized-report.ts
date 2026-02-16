import { zodResponseFormat } from "openai/helpers/zod";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { config } from "@/config/index.ts";
import { getPrisma } from "@/services/database.ts";
import { getDailyArticles } from "@/services/daily-report.ts";
import {
  getEligibleUsers,
  updateUserPreference,
  getUserPreference,
} from "@/services/user-preferences.ts";
import { getOpenAIClient } from "@/services/openai-client.ts";
import { DailyReportAIResponseSchema } from "@/schemas/daily-report.ts";
import type { DailyReportAIResponse } from "@/schemas/daily-report.ts";
import type { NewsRecord } from "@/types/index.ts";
import type { UserPreferences, ScoredArticle, EligibleUser } from "@/types/user-preferences.ts";
import type {
  DailyReportData,
  ExecutiveSummary,
  MarketOverview,
  KeyInsight,
  RelatedArticle,
  EvidenceItem,
} from "@/types/daily-report.ts";
import { buildArticleUrl } from "@/types/daily-report.ts";
import { log, getErrorMessage, withRetry, getKSTDate } from "@/utils/index.ts";

// ============================================
// 개인화 시스템 프롬프트
// ============================================

function buildPersonalizedSystemPrompt(preferences: UserPreferences): string {
  const categories = preferences.topCategories
    .slice(0, 3)
    .map((c) => c.category)
    .join(", ");
  const keywords = preferences.topKeywords.slice(0, 5).join(", ");

  return `당신은 전문 경제 애널리스트입니다. 사용자 맞춤형 데일리 리포트를 작성해주세요.

## 사용자 관심사
- 관심 분야: ${categories || "전반적"}
- 관심 키워드: ${keywords || "없음"}
- 선호 감성: ${preferences.sentimentBias || "중립"}

## 작성 가이드라인

### 개인화 요구사항
- 사용자 관심 분야에 해당하는 뉴스를 우선적으로 다뤄주세요
- 관심 키워드와 관련된 내용은 더 깊이 분석해주세요
- 사용자 맞춤형 인사이트와 조언을 제공해주세요

### 톤 & 스타일
- 친근하고 접근하기 쉬운 톤 사용
- 경제 전문 용어는 간단한 설명과 함께 사용
- 독자에게 말 걸듯 작성

### 제목 작성 가이드라인
- 숫자 활용, 질문 형태, 감정 단어 사용
- 개인화: "당신의", "내" 등으로 연결감 부여

### 콘텐츠 요구사항
1. **Executive Summary** - 사용자 관심사 중심의 핵심 요약
2. **Market Overview** - 관심 분야 중심의 시장 동향
3. **Key Insights** - 사용자에게 특히 유용한 인사이트 2-5개

### 언어 규칙 (필수!)
- 모든 응답은 반드시 한국어로만 작성
- 영문 고유명사/경제 약어는 그대로 사용 가능

### 텍스트 포맷 규칙
- 마크다운 문법 사용 금지
- 텍스트 내 기사 참조 삽입 금지
- 모든 텍스트는 순수한 일반 텍스트로 작성

### 응답 형식
- 모든 필드를 빠짐없이 채워주세요
- 최소 글자수 요구사항을 충족해주세요
- JSON 형식으로 응답`;
}

// ============================================
// 기사 점수 계산 (선호도 기반)
// ============================================

function scoreArticleForUser(
  article: NewsRecord,
  preferences: UserPreferences
): ScoredArticle {
  let score = article.importanceScore ?? 5;
  const matchedCategories: string[] = [];
  const matchedKeywords: string[] = [];

  // 카테고리 매칭 (가중치 반영)
  if (article.category) {
    const categoryMatch = preferences.topCategories.find(
      (c) => c.category === article.category
    );
    if (categoryMatch) {
      score += categoryMatch.weight * 3; // 최대 +3점
      matchedCategories.push(article.category);
    }
  }

  // 키워드 매칭
  if (article.keywords) {
    for (const keyword of article.keywords) {
      if (preferences.topKeywords.includes(keyword)) {
        score += 0.5; // 키워드당 +0.5점
        matchedKeywords.push(keyword);
      }
    }
  }

  // 소스 매칭
  if (article.source && preferences.preferredSources.includes(article.source)) {
    score += 0.5;
  }

  return {
    articleId: article.id,
    score,
    matchedCategories,
    matchedKeywords,
  };
}

/**
 * 사용자 선호도에 맞게 기사 필터링 및 정렬
 */
function filterArticlesForUser(
  articles: NewsRecord[],
  preferences: UserPreferences
): NewsRecord[] {
  // 각 기사에 점수 부여
  const scoredArticles = articles.map((article) => ({
    article,
    scored: scoreArticleForUser(article, preferences),
  }));

  // 점수순 정렬
  scoredArticles.sort((a, b) => b.scored.score - a.scored.score);

  // 상위 30개 선정
  return scoredArticles.slice(0, 30).map((s) => s.article);
}

// ============================================
// AI 분석용 포맷팅
// ============================================

function formatArticlesForAI(articles: NewsRecord[]): string {
  return articles
    .map((a, index) => {
      const parts = [
        `[기사 ${index + 1}] ID: ${a.id}`,
        `제목: ${a.title}`,
        `출처: ${a.source ?? "Unknown"}`,
        `카테고리: ${a.category ?? "N/A"}`,
        `중요도: ${a.importanceScore ?? "N/A"}/10`,
      ];

      if (a.headlineSummary) {
        parts.push(`요약: ${a.headlineSummary}`);
      }

      if (a.soWhat) {
        parts.push(`핵심 포인트: ${a.soWhat.main_point}`);
      }

      if (a.keywords && a.keywords.length > 0) {
        parts.push(`키워드: ${a.keywords.join(", ")}`);
      }

      return parts.join("\n");
    })
    .join("\n\n---\n\n");
}

// ============================================
// AI 리포트 생성
// ============================================

async function generatePersonalizedAIReport(
  articles: NewsRecord[],
  preferences: UserPreferences
): Promise<DailyReportAIResponse> {
  const client = getOpenAIClient();
  const articleIds = articles.map((a) => a.id);
  const formattedArticles = formatArticlesForAI(articles);

  const systemPrompt = buildPersonalizedSystemPrompt(preferences);

  const userPrompt = `## 오늘의 주요 경제 뉴스 (${articles.length}개, 관심사 기반 선별)

사용 가능한 기사 ID 목록: [${articleIds.join(", ")}]

${formattedArticles}

---

위 기사들을 종합 분석하여 사용자 맞춤형 데일리 리포트를 작성해주세요.

주의사항:
1. relatedArticleIds, articleId 필드에는 위 목록의 기사 ID만 사용
2. 사용자 관심 분야(${preferences.topCategories.map((c) => c.category).join(", ")})를 중점적으로 다뤄주세요
3. 최소 글자수 요구사항을 충족해주세요`;

  const response = await withRetry(
    () =>
      client.chat.completions.create({
        model: config.openai.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: zodResponseFormat(DailyReportAIResponseSchema, "personalized_report"),
        max_completion_tokens: 12000,
      }),
    { retries: 3, delay: 2000 }
  );

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI");
  }

  return DailyReportAIResponseSchema.parse(JSON.parse(content));
}

// ============================================
// 데이터 변환
// ============================================

function buildRelatedArticlesFromIds(
  ids: number[],
  articlesMap: Map<number, NewsRecord>
): RelatedArticle[] {
  return ids
    .filter((id) => articlesMap.has(id))
    .map((id) => {
      const article = articlesMap.get(id)!;
      return {
        id: article.id,
        title: article.title,
        url: buildArticleUrl(article.id),
        importance: article.importanceScore ?? 5,
      };
    });
}

function transformAIResponseToReportData(
  aiResponse: DailyReportAIResponse,
  articles: NewsRecord[],
  targetDate: Date
): DailyReportData {
  const articlesMap = new Map(articles.map((a) => [a.id, a]));

  // Executive Summary 변환
  const executiveSummary: ExecutiveSummary = {
    headline: aiResponse.executiveSummary.headline,
    overview: aiResponse.executiveSummary.overview,
    highlights: aiResponse.executiveSummary.highlights.map((h) => {
      const article = articlesMap.get(h.relatedArticleId);
      return {
        title: h.title,
        description: h.description,
        relatedArticle: article
          ? {
              id: article.id,
              title: article.title,
              url: buildArticleUrl(article.id),
              importance: article.importanceScore ?? 5,
            }
          : {
              id: h.relatedArticleId,
              title: "기사 정보 없음",
              url: buildArticleUrl(h.relatedArticleId),
              importance: 5,
            },
      };
    }),
    sentiment: aiResponse.executiveSummary.sentiment,
  };

  // Market Overview 변환
  const marketOverview: MarketOverview = {
    summary: aiResponse.marketOverview.summary,
    sections: aiResponse.marketOverview.sections.map((s) => ({
      title: s.title,
      content: s.content,
      keyData: s.keyData,
      relatedArticles: buildRelatedArticlesFromIds(s.relatedArticleIds, articlesMap),
    })),
    outlook: aiResponse.marketOverview.outlook,
    watchList: aiResponse.marketOverview.watchList,
  };

  // Key Insights 변환
  const keyInsights: KeyInsight[] = aiResponse.keyInsights.map((insight) => ({
    title: insight.title,
    summary: insight.summary,
    analysis: insight.analysis,
    implications: insight.implications,
    evidence: insight.evidence.map((e): EvidenceItem => ({
      text: e.text,
      articleId: e.articleId ?? undefined,
      articleUrl: e.articleId ? buildArticleUrl(e.articleId) : undefined,
      source: e.source ?? undefined,
    })),
    relatedArticles: buildRelatedArticlesFromIds(insight.relatedArticleIds, articlesMap),
    actionItems: insight.actionItems,
    impact: insight.impact,
    timeHorizon: insight.timeHorizon,
  }));

  // 감성 분석 집계
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;

  for (const article of articles) {
    if (article.sentiment) {
      switch (article.sentiment.overall) {
        case "positive":
          positiveCount++;
          break;
        case "negative":
          negativeCount++;
          break;
        default:
          neutralCount++;
      }
    }
  }

  const overallSentiment =
    positiveCount > negativeCount + neutralCount
      ? "positive"
      : negativeCount > positiveCount + neutralCount
      ? "negative"
      : positiveCount === negativeCount
      ? "mixed"
      : "neutral";

  return {
    reportDate: targetDate,
    title: aiResponse.title,
    executiveSummary,
    marketOverview,
    keyInsights,
    topKeywords: aiResponse.topKeywords,
    sentimentAnalysis: {
      overall: overallSentiment as "positive" | "negative" | "neutral" | "mixed",
      positiveCount,
      negativeCount,
      neutralCount,
    },
    articleCount: articles.length,
    articleIds: articles.map((a) => a.id),
  };
}

// ============================================
// DB 저장
// ============================================

async function savePersonalizedReport(
  userId: string,
  report: DailyReportData,
  preferences: UserPreferences
): Promise<{ id: number; reportDate: Date }> {
  const db = getPrisma();

  const reportDateOnly = new Date(report.reportDate);
  reportDateOnly.setHours(0, 0, 0, 0);

  const result = await db.personalizedDailyReport.upsert({
    where: {
      userId_reportDate: {
        userId,
        reportDate: reportDateOnly,
      },
    },
    create: {
      userId,
      reportDate: reportDateOnly,
      title: report.title,
      executiveSummary: report.executiveSummary as unknown as Prisma.InputJsonValue,
      marketOverview: report.marketOverview as unknown as Prisma.InputJsonValue,
      keyInsights: report.keyInsights as unknown as Prisma.InputJsonValue,
      topKeywords: report.topKeywords,
      sentimentAnalysis: report.sentimentAnalysis as unknown as Prisma.InputJsonValue,
      articleCount: report.articleCount,
      articleIds: report.articleIds,
      preferenceSnapshot: {
        topCategories: preferences.topCategories,
        topKeywords: preferences.topKeywords,
        sentimentBias: preferences.sentimentBias,
      } as unknown as Prisma.InputJsonValue,
    },
    update: {
      title: report.title,
      executiveSummary: report.executiveSummary as unknown as Prisma.InputJsonValue,
      marketOverview: report.marketOverview as unknown as Prisma.InputJsonValue,
      keyInsights: report.keyInsights as unknown as Prisma.InputJsonValue,
      topKeywords: report.topKeywords,
      sentimentAnalysis: report.sentimentAnalysis as unknown as Prisma.InputJsonValue,
      articleCount: report.articleCount,
      articleIds: report.articleIds,
      preferenceSnapshot: {
        topCategories: preferences.topCategories,
        topKeywords: preferences.topKeywords,
        sentimentBias: preferences.sentimentBias,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    id: result.id,
    reportDate: result.reportDate,
  };
}

// ============================================
// 메인 함수
// ============================================

export interface GeneratePersonalizedReportResult {
  userId: string;
  success: boolean;
  reportId?: number;
  reportDate?: Date;
  articleCount?: number;
  error?: string;
}

/**
 * 단일 사용자 개인화 리포트 생성
 */
export async function generatePersonalizedReportForUser(
  user: EligibleUser,
  allArticles: NewsRecord[],
  targetDate: Date
): Promise<GeneratePersonalizedReportResult> {
  const { userId } = user;

  try {
    // 1. 선호도 업데이트 (증분)
    await updateUserPreference(userId);

    // 2. 최신 선호도 조회
    const preferences = await getUserPreference(userId);
    if (!preferences) {
      return {
        userId,
        success: false,
        error: "선호도 데이터 없음",
      };
    }

    // 3. 사용자 맞춤 기사 필터링
    const filteredArticles = filterArticlesForUser(allArticles, preferences);

    if (filteredArticles.length < 3) {
      return {
        userId,
        success: false,
        error: `기사 부족 (${filteredArticles.length}개)`,
      };
    }

    // 4. AI 리포트 생성
    log(`사용자 ${userId} 개인화 리포트 생성 중...`);
    const aiResponse = await generatePersonalizedAIReport(filteredArticles, preferences);

    // 5. 데이터 변환
    const reportData = transformAIResponseToReportData(
      aiResponse,
      filteredArticles,
      targetDate
    );

    // 6. DB 저장
    const savedReport = await savePersonalizedReport(userId, reportData, preferences);

    log(`사용자 ${userId} 개인화 리포트 저장 완료 (ID: ${savedReport.id})`);

    return {
      userId,
      success: true,
      reportId: savedReport.id,
      reportDate: savedReport.reportDate,
      articleCount: filteredArticles.length,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    log(`사용자 ${userId} 개인화 리포트 생성 실패: ${errorMessage}`, "error");

    return {
      userId,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * 모든 대상 사용자 개인화 리포트 생성
 */
export async function generateAllPersonalizedReports(
  targetDate?: Date
): Promise<{
  total: number;
  success: number;
  failed: number;
  results: GeneratePersonalizedReportResult[];
}> {
  const date = targetDate ?? getKSTDate();
  const dateStr = date.toISOString().split("T")[0];

  log(`=== 개인화 데일리 리포트 생성 시작 (${dateStr}) ===`);

  // 1. 대상 사용자 조회
  const eligibleUsers = await getEligibleUsers();

  if (eligibleUsers.length === 0) {
    log("개인화 리포트 대상 사용자 없음");
    return { total: 0, success: 0, failed: 0, results: [] };
  }

  // 2. 오늘 기사 조회 (전체)
  const allArticles = await getDailyArticles(date);
  log(`오늘 기사: ${allArticles.length}개`);

  if (allArticles.length < 3) {
    log("분석할 기사 부족", "warn");
    return { total: eligibleUsers.length, success: 0, failed: eligibleUsers.length, results: [] };
  }

  // 3. 각 사용자별 리포트 생성
  const results: GeneratePersonalizedReportResult[] = [];

  for (const user of eligibleUsers) {
    const result = await generatePersonalizedReportForUser(user, allArticles, date);
    results.push(result);
  }

  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;

  log(`=== 개인화 리포트 생성 완료: ${successCount}/${eligibleUsers.length}명 성공 ===`);

  return {
    total: eligibleUsers.length,
    success: successCount,
    failed: failedCount,
    results,
  };
}
