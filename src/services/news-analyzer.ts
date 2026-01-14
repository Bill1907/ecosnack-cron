import OpenAI from "openai";
import * as cheerio from "cheerio";
import { zodResponseFormat } from "openai/helpers/zod";
import { config } from "@/config/index.ts";
import { calculateRecencyScore } from "@/utils/index.ts";
import { z } from "zod";
import {
  NewsAnalysisResultSchema,
  TitleFilterResponseSchema,
  QualityFilterResponseSchema,
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
import { log, getErrorMessage, withRetry } from "@/utils/index.ts";
import { buildAnalysisPrompt } from "@/services/prompt-builder.ts";
import { getExistingLinks } from "@/services/database.ts";

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
1. headline_summary: 2-3문장으로 핵심 요약 (무엇이 일어났는지, 왜 중요한지, 예상 영향 포함)
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

  // 복합 점수(titleScore + recencyScore)순 정렬 후 상위 N개 선택
  allScored.sort((a, b) => {
    const compositeA = a.titleScore + calculateRecencyScore(a.pubDate);
    const compositeB = b.titleScore + calculateRecencyScore(b.pubDate);
    return compositeB - compositeA;
  });
  const filtered = allScored.slice(0, config.openai.titleFilterLimit);

  log(`Stage 1 완료: ${filtered.length}개 기사 선별 (최고점: ${filtered[0]?.titleScore}, 최저점: ${filtered[filtered.length - 1]?.titleScore}, 최신성 가산점 적용)`);
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
    const response = await withRetry(
      () =>
        client.chat.completions.create({
          model: config.openai.model,
          messages: [
            { role: "system", content: TITLE_FILTER_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 2000,
        }),
      { retries: 3, delay: 1000 }
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    // Zod로 파싱 및 검증
    const parseResult = TitleFilterResponseSchema.safeParse(JSON.parse(content));

    if (!parseResult.success) {
      log(`제목 필터링 Zod 검증 실패: ${JSON.stringify(parseResult.error.issues)}`, "error");
      return batch.map((a) => ({
        ...a,
        titleScore: 50,
        filterReason: "응답 검증 실패로 기본 점수 부여",
      }));
    }

    const parsed = parseResult.data;

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
  log(`${articles.length}개 기사 이미지 추출 시작 (병렬)...`);

  const CONCURRENCY_LIMIT = 5; // 동시 요청 제한
  const results: TitleFilteredArticle[] = [];

  // 배치로 나누어 처리
  for (let i = 0; i < articles.length; i += CONCURRENCY_LIMIT) {
    const batch = articles.slice(i, i + CONCURRENCY_LIMIT);

    const batchResults = await Promise.allSettled(
      batch.map(async (article) => {
        const imageUrl = await extractImageUrl(article.link);
        return {
          ...article,
          imageUrl: imageUrl ?? undefined,
        };
      })
    );

    // 성공한 결과만 추가 (실패 시 원본 기사 유지)
    batchResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        const original = batch[index];
        if (original) {
          results.push(original); // 실패 시 원본 유지
        }
      }
    });
  }

  const successCount = results.filter((r) => r.imageUrl).length;
  log(`이미지 추출 완료: ${successCount}/${articles.length}개 성공`);

  return results;
}

// ============================================
// Stage 2: 품질 필터링 (30 → 20)
// ============================================

function sortByCompositeQualityScore(
  articles: QualityFilteredArticle[]
): QualityFilteredArticle[] {
  return [...articles].sort((a, b) => {
    const compositeA = a.qualityScore + calculateRecencyScore(a.pubDate);
    const compositeB = b.qualityScore + calculateRecencyScore(b.pubDate);
    return compositeB - compositeA;
  });
}

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
    const sorted = sortByCompositeQualityScore(qualityScored);
    const result = sorted.slice(0, config.openai.qualityFilterLimit);
    log(`Stage 2 완료: ${result.length}개 기사 선별 (이미지 있는 기사만, 최신성 가산점 적용)`);
    return result;
  }

  const qualityScoredWithImage = await scoreQualityBatch(hasImage);
  const sortedWithImage = sortByCompositeQualityScore(qualityScoredWithImage);

  const remaining = config.openai.qualityFilterLimit - hasImage.length;
  let sortedNoImage: QualityFilteredArticle[] = [];

  if (remaining > 0 && noImage.length > 0) {
    const qualityScoredNoImage = await scoreQualityBatch(noImage);
    sortedNoImage = sortByCompositeQualityScore(qualityScoredNoImage);
  }

  const result = [
    ...sortedWithImage,
    ...sortedNoImage.slice(0, remaining),
  ];

  log(
    `Stage 2 완료: ${result.length}개 기사 선별 (이미지 ${sortedWithImage.length}개 + 비이미지 ${Math.min(remaining, sortedNoImage.length)}개, 최신성 가산점 적용)`
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
    const response = await withRetry(
      () =>
        client.chat.completions.create({
          model: config.openai.model,
          messages: [
            { role: "system", content: QUALITY_FILTER_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 2000,
        }),
      { retries: 3, delay: 1000 }
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    // Zod로 파싱 및 검증
    const parseResult = QualityFilterResponseSchema.safeParse(JSON.parse(content));

    if (!parseResult.success) {
      log(`품질 필터링 Zod 검증 실패: ${JSON.stringify(parseResult.error.issues)}`, "error");
      return articles.map((a) => ({
        ...a,
        qualityScore: 50,
        hasValidImage: !!a.imageUrl,
      }));
    }

    const parsed = parseResult.data;

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

  // 동적 프롬프트 생성 (Few-shot, Rubric, CoT 포함)
  const { system, user } = await buildAnalysisPrompt(article);

  try {
    const response = await withRetry(
      () =>
        client.chat.completions.create({
          model: config.openai.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: zodResponseFormat(NewsAnalysisResultSchema, "news_analysis"),
          temperature: 0.4,
          max_tokens: 3000,
        }),
      { retries: 3, delay: 1000 }
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    // Zod로 파싱 및 검증
    const parsed = NewsAnalysisResultSchema.parse(JSON.parse(content));
    return parsed;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    log(`상세 분석 오류 (${article.title.substring(0, 30)}...): ${errorMessage}`, "error");

    // Zod 검증 에러 상세 로깅
    if (error instanceof z.ZodError) {
      log(`Zod 검증 실패 상세: ${JSON.stringify(error.issues)}`, "error");
    }

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

  // 분석 성공한 기사만 필터링 (분석 실패 시 저장하지 않음)
  const analyzedArticles: AnalyzedNewsArticle[] = results
    .filter((result): result is { article: QualityFilteredArticle; analysis: NewsAnalysisResult } =>
      result.analysis !== null
    )
    .map(({ article, analysis }) => ({
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
    }));

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
// Stage 0: 중복 기사 사전 필터링
// ============================================

async function filterDuplicates(
  articles: RawNewsArticle[]
): Promise<RawNewsArticle[]> {
  if (articles.length === 0) {
    return [];
  }

  log(`Stage 0: ${articles.length}개 기사 중복 필터링 시작...`);

  try {
    const links = articles.map((a) => a.link);
    const existingLinks = await getExistingLinks(links);

    if (existingLinks.size === 0) {
      log(`중복 없음: 모든 기사가 신규`);
      return articles;
    }

    const newArticles = articles.filter((a) => !existingLinks.has(a.link));
    log(
      `Stage 0 완료: ${existingLinks.size}개 중복 제외, ${newArticles.length}개 신규 기사`
    );
    return newArticles;
  } catch (error) {
    log(
      `중복 필터링 DB 조회 실패, 모든 기사 진행: ${getErrorMessage(error)}`,
      "warn"
    );
    return articles;
  }
}

// ============================================
// 메인 Export
// ============================================

export async function analyzeNews(
  articles: RawNewsArticle[]
): Promise<AnalysisResult> {
  const startTime = Date.now();
  log(`${articles.length}개 뉴스 분석 시작...`);

  if (articles.length === 0) {
    return { success: true, articles: [] };
  }

  try {
    // Stage 0: 중복 기사 사전 필터링 (DB에 이미 존재하는 기사 제외)
    const stage0Start = Date.now();
    const uniqueArticles = await filterDuplicates(articles);
    const stage0Time = Date.now() - stage0Start;

    if (uniqueArticles.length === 0) {
      log("모든 기사가 이미 데이터베이스에 존재합니다.");
      return { success: true, articles: [] };
    }

    // Stage 1: 제목 기반 필터링 (250 → 30)
    const stage1Start = Date.now();
    const titleFiltered = await filterByTitles(uniqueArticles);
    const stage1Time = Date.now() - stage1Start;

    // Stage 2: 품질 필터링 + 이미지 추출 (30 → 20)
    const stage2Start = Date.now();
    const qualityFiltered = await filterByQuality(titleFiltered);
    const stage2Time = Date.now() - stage2Start;

    // Stage 3: 상세 AI 분석 (20개 병렬 처리)
    const stage3Start = Date.now();
    const analyzedArticles = await analyzeArticlesInParallel(qualityFiltered);
    const stage3Time = Date.now() - stage3Start;

    const withImages = analyzedArticles.filter((a) => a.imageUrl);
    const withFullAnalysis = analyzedArticles.filter((a) => a.soWhat);

    // 메트릭 계산 및 로깅
    const totalTime = Date.now() - startTime;
    const metrics = {
      total_articles: articles.length,
      unique_articles: uniqueArticles.length,
      stage0_duplicate_rate: ((articles.length - uniqueArticles.length) / articles.length).toFixed(2),
      stage1_pass_rate: (titleFiltered.length / uniqueArticles.length).toFixed(2),
      stage2_pass_rate: titleFiltered.length > 0 ? (qualityFiltered.length / titleFiltered.length).toFixed(2) : "0.00",
      stage3_success_rate: qualityFiltered.length > 0 ? (withFullAnalysis.length / qualityFiltered.length).toFixed(2) : "0.00",
      final_with_images: withImages.length,
      final_with_analysis: withFullAnalysis.length,
      timing_ms: {
        stage0_dedup: stage0Time,
        stage1_title: stage1Time,
        stage2_quality: stage2Time,
        stage3_analysis: stage3Time,
        total: totalTime,
      },
    };

    log(`📊 분석 메트릭: ${JSON.stringify(metrics)}`);

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
