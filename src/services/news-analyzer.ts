import OpenAI from "openai";
import * as cheerio from "cheerio";
import { zodResponseFormat } from "openai/helpers/zod";
import { config } from "@/config/index.ts";
import {
  NewsAnalysisResultSchema,
  type NewsAnalysisResult,
} from "@/schemas/news-analysis.ts";
import type {
  RawNewsArticle,
  AnalyzedNewsArticle,
  AnalysisResult,
  TitleFilteredArticle,
  QualityFilteredArticle,
  TitleFilterResponse,
  QualityFilterResponse,
} from "@/types/index.ts";
import { log, getErrorMessage } from "@/utils/index.ts";

// ============================================
// OpenAI 클라이언트 (싱글톤)
// ============================================

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.openai.apiKey,
    });
    log("OpenAI 클라이언트 초기화 완료");
  }
  return openaiClient;
}

// ============================================
// OpenAI 프롬프트 - 필터링용
// ============================================

const TITLE_FILTER_SYSTEM_PROMPT = `You are an expert financial news editor. Evaluate news article titles for their newsworthiness and economic/financial relevance.

Score each article from 0-100 based on:
- Economic/financial significance (40 points): Central bank decisions, major economic indicators, market-moving events
- Market impact potential (30 points): Likely to affect stock markets, currencies, or commodities
- Timeliness and freshness (20 points): Breaking news, recent developments
- Clarity and informativeness (10 points): Clear, informative headline

Return JSON format:
{
  "articles": [
    {"index": 0, "score": 85, "reason": "Major Fed policy announcement"},
    {"index": 1, "score": 60, "reason": "Company earnings report"}
  ]
}

Focus on:
- Central bank decisions, interest rates
- Major company earnings, M&A, IPOs
- Economic indicators (GDP, inflation, employment)
- Trade policies, regulations
- Market-moving events

Deprioritize:
- Clickbait or sensational titles
- Opinion pieces without clear news value
- Overly technical without context`;

const QUALITY_FILTER_SYSTEM_PROMPT = `You are a senior news curator selecting the highest quality economic news articles for a general audience.

Score each article from 0-100 based on:
- Content depth and substance (30 points): Based on title and description
- Source reliability (25 points): Major outlets (CNBC, Bloomberg, WSJ, 매일경제, 한경) score higher
- Visual content availability (25 points): Articles with images (hasImage: true) score higher
- Reader engagement value (20 points): Relevance and interest to general audience

Return JSON format:
{
  "articles": [
    {"index": 0, "score": 90, "reason": "In-depth analysis from trusted source with image"},
    {"index": 1, "score": 75, "reason": "Good content but no image"}
  ]
}

Prioritize:
- Articles with available images (hasImage: true)
- In-depth analysis over brief mentions
- Data-driven reporting
- Clear explanations of complex topics`;

// ============================================
// OpenAI 프롬프트 - 상세 분석용
// ============================================

const DETAILED_ANALYSIS_SYSTEM_PROMPT = `You are an expert economic analyst. Analyze this news article and provide comprehensive insights.

## Instructions
- 한국어 기사는 한국어로, 영어 기사는 영어로 분석
- 추측보다는 기사 내용에 기반한 분석
- 투자 조언이 아닌 정보 분석임을 명시
- importance_score는 1-10 사이 정수
- confidence는 0.0-1.0 사이 소수
- time_horizon: "short" (1주 이내), "medium" (1-3개월), "long" (1년 이상)

## Analysis Focus
1. headline_summary: 1문장으로 핵심 요약
2. so_what: 왜 중요한지, 시장 시그널, 영향 기간
3. impact_analysis: 투자자/직장인/소비자 각각에 미치는 영향
4. related_context: 배경, 연관 이슈, 향후 주목점
5. keywords: 핵심 키워드 3-7개
6. category: economy|finance|business|markets|policy|trade
7. sentiment: positive|negative|neutral|mixed + 신뢰도
8. importance_score: 1-10 정수`;

// ============================================
// Stage 1: 제목 기반 필터링 (250 → 30)
// ============================================

async function filterByTitles(
  articles: RawNewsArticle[]
): Promise<TitleFilteredArticle[]> {
  log(`Stage 1: ${articles.length}개 기사 제목 기반 필터링 시작...`);

  if (articles.length <= config.openai.titleFilterLimit) {
    log(`필터링 불필요 (기사 수 ${articles.length}개 ≤ ${config.openai.titleFilterLimit}개)`);
    return articles.map((a) => ({
      ...a,
      titleScore: 100,
      filterReason: "필터링 불필요 (기사 수 적음)",
    }));
  }

  const client = getOpenAIClient();
  const batchSize = 50;
  const allScored: TitleFilteredArticle[] = [];

  // 배치 처리
  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(articles.length / batchSize);

    log(`배치 ${batchNumber}/${totalBatches} 처리 중 (${batch.length}개 기사)...`);

    const scoredBatch = await scoreTitleBatch(client, batch, i);
    allScored.push(...scoredBatch);
  }

  // 점수순 정렬 후 상위 N개 선택
  allScored.sort((a, b) => b.titleScore - a.titleScore);
  const filtered = allScored.slice(0, config.openai.titleFilterLimit);

  log(`Stage 1 완료: ${filtered.length}개 기사 선별 (최고점: ${filtered[0]?.titleScore}, 최저점: ${filtered[filtered.length - 1]?.titleScore})`);
  return filtered;
}

async function scoreTitleBatch(
  client: OpenAI,
  batch: RawNewsArticle[],
  startIndex: number
): Promise<TitleFilteredArticle[]> {
  const articlesForScoring = batch.map((a, i) => ({
    index: startIndex + i,
    title: a.title,
    source: a.source || "Unknown",
  }));

  const prompt = `Evaluate these ${batch.length} news article titles and score each one:

${articlesForScoring.map((a) => `[${a.index}] "${a.title}" (${a.source})`).join("\n")}

Return scores for ALL articles in JSON format.`;

  try {
    const response = await client.chat.completions.create({
      model: config.openai.model,
      messages: [
        { role: "system", content: TITLE_FILTER_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    const parsed: TitleFilterResponse = JSON.parse(content);

    return batch.map((article, i) => {
      const scoreData = parsed.articles.find((s) => s.index === startIndex + i);
      return {
        ...article,
        titleScore: scoreData?.score ?? 0,
        filterReason: scoreData?.reason ?? "점수 없음",
      };
    });
  } catch (error) {
    log(`제목 필터링 배치 오류: ${getErrorMessage(error)}`, "error");
    return batch.map((a) => ({
      ...a,
      titleScore: 50,
      filterReason: "API 오류로 기본 점수 부여",
    }));
  }
}

// ============================================
// 이미지 추출
// ============================================

async function extractImageUrl(articleUrl: string): Promise<string | null> {
  try {
    const response = await fetch(articleUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EcoSnackBot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const imageUrl =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      $('meta[property="og:image:url"]').attr("content") ||
      $("article img").first().attr("src") ||
      $(".article-image img").first().attr("src") ||
      $("main img").first().attr("src");

    if (!imageUrl) {
      return null;
    }

    if (imageUrl.startsWith("//")) {
      return `https:${imageUrl}`;
    }
    if (imageUrl.startsWith("/")) {
      const url = new URL(articleUrl);
      return `${url.origin}${imageUrl}`;
    }

    return imageUrl;
  } catch {
    return null;
  }
}

async function extractImagesForArticles(
  articles: TitleFilteredArticle[]
): Promise<TitleFilteredArticle[]> {
  log(`${articles.length}개 기사 이미지 추출 시작...`);

  const results: TitleFilteredArticle[] = [];
  let successCount = 0;

  for (const article of articles) {
    const imageUrl = await extractImageUrl(article.link);
    results.push({
      ...article,
      imageUrl: imageUrl ?? undefined,
    });

    if (imageUrl) {
      successCount++;
    }
  }

  log(`이미지 추출 완료: ${successCount}/${articles.length}개 성공`);
  return results;
}

// ============================================
// Stage 2: 품질 필터링 (30 → 20)
// ============================================

async function filterByQuality(
  articles: TitleFilteredArticle[]
): Promise<QualityFilteredArticle[]> {
  log(`Stage 2: ${articles.length}개 기사 품질 필터링 시작...`);

  const withImages = await extractImagesForArticles(articles);

  const hasImage = withImages.filter((a) => a.imageUrl);
  const noImage = withImages.filter((a) => !a.imageUrl);

  log(`이미지 있음: ${hasImage.length}개, 없음: ${noImage.length}개`);

  if (hasImage.length >= config.openai.qualityFilterLimit) {
    const qualityScored = await scoreQualityBatch(hasImage);
    qualityScored.sort((a, b) => b.qualityScore - a.qualityScore);
    const result = qualityScored.slice(0, config.openai.qualityFilterLimit);
    log(`Stage 2 완료: ${result.length}개 기사 선별 (이미지 있는 기사만)`);
    return result;
  }

  const qualityScoredWithImage = await scoreQualityBatch(hasImage);
  qualityScoredWithImage.sort((a, b) => b.qualityScore - a.qualityScore);

  const remaining = config.openai.qualityFilterLimit - hasImage.length;
  let qualityScoredNoImage: QualityFilteredArticle[] = [];

  if (remaining > 0 && noImage.length > 0) {
    qualityScoredNoImage = await scoreQualityBatch(noImage);
    qualityScoredNoImage.sort((a, b) => b.qualityScore - a.qualityScore);
  }

  const result = [
    ...qualityScoredWithImage,
    ...qualityScoredNoImage.slice(0, remaining),
  ];

  log(
    `Stage 2 완료: ${result.length}개 기사 선별 (이미지 ${qualityScoredWithImage.length}개 + 비이미지 ${Math.min(remaining, qualityScoredNoImage.length)}개)`
  );
  return result;
}

async function scoreQualityBatch(
  articles: TitleFilteredArticle[]
): Promise<QualityFilteredArticle[]> {
  if (articles.length === 0) {
    return [];
  }

  const client = getOpenAIClient();

  const articlesForScoring = articles.map((a, i) => ({
    index: i,
    title: a.title,
    description: a.description?.substring(0, 200) || "(설명 없음)",
    source: a.source || "Unknown",
    hasImage: !!a.imageUrl,
  }));

  const prompt = `Evaluate these ${articles.length} articles for quality:

${articlesForScoring
  .map(
    (a) => `[${a.index}] "${a.title}"
   Source: ${a.source}
   Description: ${a.description}
   Has Image: ${a.hasImage ? "Yes" : "No"}`
  )
  .join("\n\n")}

Return quality scores for ALL articles in JSON format.`;

  try {
    const response = await client.chat.completions.create({
      model: config.openai.model,
      messages: [
        { role: "system", content: QUALITY_FILTER_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    const parsed: QualityFilterResponse = JSON.parse(content);

    return articles.map((article, i) => {
      const scoreData = parsed.articles.find((s) => s.index === i);
      return {
        ...article,
        qualityScore: scoreData?.score ?? 50,
        hasValidImage: !!article.imageUrl,
      };
    });
  } catch (error) {
    log(`품질 필터링 오류: ${getErrorMessage(error)}`, "error");
    return articles.map((a) => ({
      ...a,
      qualityScore: 50,
      hasValidImage: !!a.imageUrl,
    }));
  }
}

// ============================================
// Stage 3: 상세 AI 분석 (20개 병렬 처리)
// ============================================

async function analyzeArticleWithAI(
  article: QualityFilteredArticle
): Promise<NewsAnalysisResult | null> {
  const client = getOpenAIClient();

  const userPrompt = `뉴스 제목: ${article.title}
링크: ${article.link}
날짜: ${article.pubDate?.toISOString() ?? "Unknown"}
내용: ${article.description ?? "(내용 없음)"}

## Article
- Title: ${article.title}
- Description: ${article.description ?? "(No description)"}
- Source: ${article.source ?? "Unknown"}
- Published: ${article.pubDate?.toISOString() ?? "Unknown"}
- Link: ${article.link}

위 뉴스 기사를 분석해주세요.`;

  try {
    const response = await client.chat.completions.create({
      model: config.openai.model,
      messages: [
        { role: "system", content: DETAILED_ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: zodResponseFormat(NewsAnalysisResultSchema, "news_analysis"),
      temperature: 0.4,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    // Zod로 파싱 및 검증
    const parsed = NewsAnalysisResultSchema.parse(JSON.parse(content));
    return parsed;
  } catch (error) {
    log(`상세 분석 오류 (${article.title.substring(0, 30)}...): ${getErrorMessage(error)}`, "error");
    return null;
  }
}

async function analyzeArticlesInParallel(
  articles: QualityFilteredArticle[]
): Promise<AnalyzedNewsArticle[]> {
  log(`Stage 3: ${articles.length}개 기사 상세 분석 시작 (병렬 처리)...`);

  const analysisPromises = articles.map(async (article, index) => {
    log(`[${index + 1}/${articles.length}] 분석 중: ${article.title.substring(0, 40)}...`);
    const analysis = await analyzeArticleWithAI(article);
    return { article, analysis };
  });

  const results = await Promise.all(analysisPromises);

  const analyzedArticles: AnalyzedNewsArticle[] = results.map(({ article, analysis }) => {
    if (analysis) {
      return {
        title: article.title,
        link: article.link,
        description: article.description,
        pubDate: article.pubDate,
        source: article.source,
        region: article.region,
        imageUrl: article.imageUrl,
        headlineSummary: analysis.headline_summary,
        soWhat: analysis.so_what,
        impactAnalysis: analysis.impact_analysis,
        relatedContext: analysis.related_context,
        keywords: analysis.keywords,
        category: analysis.category,
        sentiment: analysis.sentiment,
        importanceScore: analysis.importance_score,
      };
    } else {
      // 분석 실패시 기본값
      return {
        title: article.title,
        link: article.link,
        description: article.description,
        pubDate: article.pubDate,
        source: article.source,
        region: article.region,
        imageUrl: article.imageUrl,
        headlineSummary: generateSimpleSummary(
          (article.description?.trim() || "") || article.title
        ),
        keywords: [],
        importanceScore: article.qualityScore,
      };
    }
  });

  const successCount = results.filter((r) => r.analysis !== null).length;
  log(`Stage 3 완료: ${successCount}/${articles.length}개 상세 분석 성공`);

  return analyzedArticles;
}

// ============================================
// 요약 생성 (폴백용)
// ============================================

function generateSimpleSummary(content: string): string {
  const cleanContent = content
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanContent.length <= 200) {
    return cleanContent;
  }

  const truncated = cleanContent.substring(0, 200);
  const lastPeriod = truncated.lastIndexOf(".");

  if (lastPeriod > 100) {
    return truncated.substring(0, lastPeriod + 1);
  }

  return truncated + "...";
}

// ============================================
// 메인 Export
// ============================================

export async function analyzeNews(
  articles: RawNewsArticle[]
): Promise<AnalysisResult> {
  log(`${articles.length}개 뉴스 분석 시작...`);

  if (articles.length === 0) {
    return { success: true, articles: [] };
  }

  try {
    // Stage 1: 제목 기반 필터링 (250 → 30)
    const titleFiltered = await filterByTitles(articles);

    // Stage 2: 품질 필터링 + 이미지 추출 (30 → 20)
    const qualityFiltered = await filterByQuality(titleFiltered);

    // Stage 3: 상세 AI 분석 (20개 병렬 처리)
    const analyzedArticles = await analyzeArticlesInParallel(qualityFiltered);

    const withImages = analyzedArticles.filter((a) => a.imageUrl);
    const withFullAnalysis = analyzedArticles.filter((a) => a.soWhat);

    log(
      `총 ${analyzedArticles.length}/${articles.length}개 뉴스 분석 완료 (이미지: ${withImages.length}개, 상세분석: ${withFullAnalysis.length}개)`
    );

    return { success: true, articles: analyzedArticles };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    log(`뉴스 분석 중 오류: ${errorMessage}`, "error");
    return { success: false, articles: [], error: errorMessage };
  }
}
