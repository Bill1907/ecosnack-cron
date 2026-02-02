import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { config } from "@/config/index.ts";
import { getPrisma } from "@/services/database.ts";
import {
  DailyReportAIResponseSchema,
  type DailyReportAIResponse,
} from "@/schemas/daily-report.ts";
import {
  type DailyReportData,
  type ExecutiveSummary,
  type MarketOverview,
  type KeyInsight,
  type RelatedArticle,
  type EvidenceItem,
  buildArticleUrl,
} from "@/types/daily-report.ts";
import type { NewsRecord } from "@/types/index.ts";
import { log, getErrorMessage, withRetry, getKSTDate } from "@/utils/index.ts";
import {
  validateEvidence,
  calculateEvidenceScore,
} from "@/services/evidence-validator.ts";
import {
  evaluateReportQuality,
  calculateFinalQualityScore,
} from "@/services/quality-evaluator.ts";
import { getOpenAIClient } from "@/services/openai-client.ts";

// ============================================
// 시스템 프롬프트
// ============================================

const DAILY_REPORT_SYSTEM_PROMPT = `당신은 전문 경제 애널리스트입니다. 오늘 수집/분석된 경제 뉴스들을 종합하여 깊이 있는 데일리 리포트를 작성해주세요.

## 작성 가이드라인

### 톤 & 스타일
- 친근하고 접근하기 쉬운 톤 사용 ("~해요", "~입니다" 혼용 가능)
- 경제 전문 용어는 간단한 설명이나 비유와 함께 사용
- 독자에게 말 걸듯 작성 (예: "주목해볼 만해요", "눈여겨보시면 좋겠어요")
- 구체적인 수치와 데이터를 포함하되, 맥락과 함께 설명

### 제목 작성 가이드라인 (title, headline) - 중요!
- 숫자 활용: "TOP 5", "100만원", "10억" 등 구체적 수치로 관심 유도
- 질문 형태: "~일까?", "~해도 될까?", "왜?" 로 호기심 유발
- 감정 단어: "충격", "눈물", "공포", "열풍" 등 감정 자극
- 개인화: "내 월급", "당신의", "우리 집" 등 독자와 연결
- 대립 구도: "vs", "전쟁", "승자" 등 긴장감 조성
- 말줄임표 활용: "...근데", "...결국" 으로 궁금증 유발

예시:
- BAD: "코스피 상승세 지속" → GOOD: "코스피 5000 간다? 전문가들 의견 갈려"
- BAD: "환율 상승" → GOOD: "환율 1500원 간다? 해외여행 포기해야 하나"
- BAD: "삼성전자 실적 발표" → GOOD: "삼성전자, 어닝 서프라이즈...근데 왜 주가는?"
- BAD: "금리 동결 전망" → GOOD: "Fed 금리 동결...내 대출이자는 언제 내려가나"

### 콘텐츠 요구사항
1. **Executive Summary**
   - headline: 오늘의 핵심을 50자 이내로
   - overview: 600자 이상, 오늘 경제 뉴스의 가장 중요한 흐름 설명
   - highlights: 가장 중요한 뉴스 3-5개 선정, 각각 왜 중요한지 설명

2. **Market Overview**
   - summary: 400자 이상, 시장 전반의 흐름
   - sections: 2-5개 섹션 (국내 증시, 글로벌 금융, 환율/금리 등)
   - 각 섹션에 구체적 수치 포함 (코스피 +1.2% 등)

3. **Key Insights**
   - 2-5개의 핵심 인사이트
   - 각각 심층 분석과 함께 투자자/직장인/소비자 별 영향 분석
   - 근거(evidence)의 articleId 필드에 관련 기사 ID 기록
   - 실행 가능한 조언 1-3개

### 중요 규칙
- 모든 분석은 제공된 기사 데이터에 기반해야 함
- 추측보다는 기사 내용에서 도출된 인사이트 중심
- 투자 조언이 아닌 정보 분석임을 명시

### 언어 규칙 (필수!)
- 모든 응답은 반드시 한국어로만 작성해야 합니다
- 일본어, 중국어 등 다른 언어 절대 사용 금지
- 영문 고유명사(예: Fed, FOMC)나 경제 약어(예: GDP, ETF, S&P500)는 그대로 사용 가능
- "ご了承", "なお" 같은 일본어 표현 사용 금지

### 텍스트 포맷 규칙 (중요!)
- 마크다운 문법 사용 금지 (**, *, #, - 등의 서식 문자 사용하지 않음)
- 텍스트 내에 기사 참조 삽입 금지 (예: "(articleId: 15)", "[기사 6190]" 등 사용하지 않음)
- 기사 참조는 반드시 evidence.articleId, relatedArticleIds 등 지정된 필드에만 기록
- 모든 텍스트는 순수한 일반 텍스트로 작성

### 응답 형식
- 모든 필드를 빠짐없이 채워주세요
- 최소 글자수 요구사항을 반드시 충족해야 합니다
- JSON 형식으로 응답`;

// ============================================
// 해당 날짜의 기사 조회
// ============================================

export async function getDailyArticles(
  targetDate?: Date
): Promise<NewsRecord[]> {
  const db = getPrisma();
  const date = targetDate ?? getKSTDate();

  // 해당 날짜의 시작과 끝 시간 계산 (KST 기준)
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const articles = await db.article.findMany({
    where: {
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
    orderBy: [
      { importanceScore: "desc" },
      { createdAt: "desc" },
    ],
  });

  return articles.map((a) => ({
    id: a.id,
    title: a.title,
    link: a.link,
    description: a.description,
    pubDate: a.pubDate,
    source: a.source,
    region: a.region,
    imageUrl: a.imageUrl,
    headlineSummary: a.headlineSummary,
    soWhat: a.soWhat as NewsRecord["soWhat"],
    impactAnalysis: a.impactAnalysis as NewsRecord["impactAnalysis"],
    relatedContext: a.relatedContext as NewsRecord["relatedContext"],
    keywords: a.keywords,
    category: a.category as NewsRecord["category"],
    sentiment: a.sentiment as NewsRecord["sentiment"],
    importanceScore: a.importanceScore,
    createdAt: a.createdAt,
  }));
}

// ============================================
// AI 분석용 기사 데이터 포맷팅
// ============================================

function formatArticlesForAI(articles: NewsRecord[]): string {
  return articles
    .map((a, index) => {
      const parts = [
        `[기사 ${index + 1}] ID: ${a.id}`,
        `제목: ${a.title}`,
        `출처: ${a.source ?? "Unknown"}`,
        `중요도: ${a.importanceScore ?? "N/A"}/10`,
      ];

      if (a.headlineSummary) {
        parts.push(`요약: ${a.headlineSummary}`);
      }

      if (a.soWhat) {
        parts.push(`핵심 포인트: ${a.soWhat.main_point}`);
        parts.push(`시장 신호: ${a.soWhat.market_signal}`);
      }

      if (a.impactAnalysis) {
        parts.push(`투자자 영향: ${a.impactAnalysis.investors.summary}`);
        parts.push(`직장인 영향: ${a.impactAnalysis.workers.summary}`);
        parts.push(`소비자 영향: ${a.impactAnalysis.consumers.summary}`);
      }

      if (a.keywords && a.keywords.length > 0) {
        parts.push(`키워드: ${a.keywords.join(", ")}`);
      }

      if (a.sentiment) {
        parts.push(`감성: ${a.sentiment.overall}`);
      }

      return parts.join("\n");
    })
    .join("\n\n---\n\n");
}

// ============================================
// AI로 데일리 리포트 분석
// ============================================

async function analyzeForDailyReport(
  articles: NewsRecord[]
): Promise<DailyReportAIResponse> {
  const client = getOpenAIClient();

  // 상위 30개 기사만 사용 (토큰 제한)
  const topArticles = articles.slice(0, 30);
  const articleIds = topArticles.map((a) => a.id);
  const formattedArticles = formatArticlesForAI(topArticles);

  const userPrompt = `## 오늘의 주요 경제 뉴스 (상위 ${topArticles.length}개)

사용 가능한 기사 ID 목록: [${articleIds.join(", ")}]

${formattedArticles}

---

위 ${topArticles.length}개의 경제 뉴스를 종합 분석하여 데일리 리포트를 작성해주세요.

주의사항:
1. relatedArticleIds, articleId 필드에는 위 목록에 있는 기사 ID만 사용하세요
2. 모든 분석에 근거가 되는 기사 ID를 명시해주세요
3. 최소 글자수 요구사항을 반드시 충족해주세요`;

  const response = await withRetry(
    () =>
      client.chat.completions.create({
        model: config.openai.model,
        messages: [
          { role: "system", content: DAILY_REPORT_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: zodResponseFormat(DailyReportAIResponseSchema, "daily_report"),
        max_completion_tokens: 12000,
      }),
    { retries: 3, delay: 2000 }
  );

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI");
  }

  const parsed = DailyReportAIResponseSchema.parse(JSON.parse(content));
  return parsed;
}

// ============================================
// AI 응답을 DailyReportData로 변환
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
        case "neutral":
          neutralCount++;
          break;
        case "mixed":
          neutralCount++;
          break;
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
      overall: overallSentiment,
      positiveCount,
      negativeCount,
      neutralCount,
    },
    articleCount: articles.length,
    articleIds: articles.map((a) => a.id),
  };
}

// ============================================
// 메인 함수: 데일리 리포트 생성
// ============================================

export interface GenerateDailyReportOptions {
  skipQualityEvaluation?: boolean;
  skipEvidenceRelevanceCheck?: boolean; // AI 관련성 검증 스킵 (비용 절감)
}

export interface GenerateDailyReportResult {
  success: boolean;
  reportId?: number;
  reportDate?: Date;
  articleCount?: number;
  qualityScore?: number;
  error?: string;
}

export async function generateDailyReport(
  targetDate?: Date,
  options: GenerateDailyReportOptions = {}
): Promise<GenerateDailyReportResult> {
  const { skipQualityEvaluation = false, skipEvidenceRelevanceCheck = false } = options;
  const date = targetDate ?? getKSTDate();
  const dateStr = date.toISOString().split("T")[0];

  log(`=== 데일리 리포트 생성 시작 (${dateStr}) ===`);

  try {
    // 1. 해당 날짜의 기사 조회
    const articles = await getDailyArticles(date);
    log(`${articles.length}개 기사 조회됨`);

    if (articles.length === 0) {
      log("분석할 기사가 없습니다.", "warn");
      return {
        success: false,
        error: "분석할 기사가 없습니다.",
      };
    }

    if (articles.length < 3) {
      log(`기사가 너무 적습니다 (${articles.length}개). 최소 3개 이상 필요.`, "warn");
      return {
        success: false,
        error: `기사가 너무 적습니다 (${articles.length}개). 최소 3개 이상 필요.`,
      };
    }

    // 2. AI 분석
    log("AI 분석 시작...");
    const aiResponse = await analyzeForDailyReport(articles);
    log("AI 분석 완료");

    // 3. 데이터 변환
    const reportData = transformAIResponseToReportData(aiResponse, articles, date);

    // 4. 품질 평가 (선택적)
    if (!skipQualityEvaluation) {
      try {
        // 4-1. 근거 검증
        log("근거 검증 시작...");
        const evidenceValidation = await validateEvidence(reportData, articles, {
          checkRelevance: !skipEvidenceRelevanceCheck,
        });
        reportData.evidenceValidation = evidenceValidation;

        // 4-2. AI 품질 평가
        log("AI 품질 평가 시작...");
        const qualityEvaluation = await evaluateReportQuality(reportData);
        reportData.qualityEvaluation = qualityEvaluation;

        // 4-3. 종합 점수 계산
        const evidenceScore = calculateEvidenceScore(evidenceValidation);
        const finalScore = calculateFinalQualityScore(qualityEvaluation, evidenceScore);
        reportData.qualityScore = finalScore;

        log(`품질 평가 완료 - 종합 점수: ${finalScore}/100 (AI: ${qualityEvaluation.overallScore}, 근거: ${evidenceScore})`);
      } catch (evalError) {
        log(`품질 평가 중 오류 발생 (리포트 저장은 계속): ${getErrorMessage(evalError)}`, "warn");
      }
    } else {
      log("품질 평가 스킵됨 (옵션에 의해)");
    }

    // 5. DB 저장
    const savedReport = await saveDailyReport(reportData);
    log(`데일리 리포트 저장 완료 (ID: ${savedReport.id})`);

    return {
      success: true,
      reportId: savedReport.id,
      reportDate: savedReport.reportDate,
      articleCount: savedReport.articleCount,
      qualityScore: reportData.qualityScore,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    log(`데일리 리포트 생성 실패: ${errorMessage}`, "error");

    if (error instanceof z.ZodError) {
      log(`Zod 검증 실패: ${JSON.stringify(error.issues)}`, "error");
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

// ============================================
// DB 저장 함수
// ============================================

import { Prisma } from "@prisma/client";

export async function saveDailyReport(
  report: DailyReportData
): Promise<{ id: number; reportDate: Date; articleCount: number }> {
  const db = getPrisma();

  // 날짜만 추출 (시간 제거)
  const reportDateOnly = new Date(report.reportDate);
  reportDateOnly.setHours(0, 0, 0, 0);

  const result = await db.dailyReport.upsert({
    where: { reportDate: reportDateOnly },
    create: {
      reportDate: reportDateOnly,
      title: report.title,
      executiveSummary: report.executiveSummary as unknown as Prisma.InputJsonValue,
      marketOverview: report.marketOverview as unknown as Prisma.InputJsonValue,
      keyInsights: report.keyInsights as unknown as Prisma.InputJsonValue,
      topKeywords: report.topKeywords,
      sentimentAnalysis: report.sentimentAnalysis as unknown as Prisma.InputJsonValue,
      articleCount: report.articleCount,
      articleIds: report.articleIds,
      qualityEvaluation: report.qualityEvaluation as unknown as Prisma.InputJsonValue,
      evidenceValidation: report.evidenceValidation as unknown as Prisma.InputJsonValue,
      qualityScore: report.qualityScore,
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
      qualityEvaluation: report.qualityEvaluation as unknown as Prisma.InputJsonValue,
      evidenceValidation: report.evidenceValidation as unknown as Prisma.InputJsonValue,
      qualityScore: report.qualityScore,
    },
  });

  return {
    id: result.id,
    reportDate: result.reportDate,
    articleCount: result.articleCount,
  };
}

// ============================================
// 조회 함수
// ============================================

export async function getDailyReport(
  targetDate: Date
): Promise<DailyReportData | null> {
  const db = getPrisma();

  const reportDateOnly = new Date(targetDate);
  reportDateOnly.setHours(0, 0, 0, 0);

  const report = await db.dailyReport.findUnique({
    where: { reportDate: reportDateOnly },
  });

  if (!report) {
    return null;
  }

  return {
    reportDate: report.reportDate,
    title: report.title,
    executiveSummary: report.executiveSummary as unknown as ExecutiveSummary,
    marketOverview: report.marketOverview as unknown as MarketOverview,
    keyInsights: report.keyInsights as unknown as KeyInsight[],
    topKeywords: report.topKeywords,
    sentimentAnalysis: report.sentimentAnalysis as unknown as DailyReportData["sentimentAnalysis"],
    articleCount: report.articleCount,
    articleIds: report.articleIds,
    qualityEvaluation: report.qualityEvaluation as unknown as DailyReportData["qualityEvaluation"],
    evidenceValidation: report.evidenceValidation as unknown as DailyReportData["evidenceValidation"],
    qualityScore: report.qualityScore ?? undefined,
  };
}

export async function getRecentDailyReports(
  limit: number = 7
): Promise<{ id: number; reportDate: Date; title: string; articleCount: number }[]> {
  const db = getPrisma();

  const reports = await db.dailyReport.findMany({
    orderBy: { reportDate: "desc" },
    take: limit,
    select: {
      id: true,
      reportDate: true,
      title: true,
      articleCount: true,
    },
  });

  return reports;
}
