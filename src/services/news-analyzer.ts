import * as cheerio from "cheerio";
import { z } from "zod";
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
} from "@/types/index.ts";
import { log, getErrorMessage, withTimeout, calculateRecencyScore } from "@/utils/index.ts";
import { buildAnalysisPrompt } from "@/services/prompt-builder.ts";
import { getExistingLinks } from "@/services/database.ts";
import { createStructured } from "@/services/openai-client.ts";
import { scoreHeadlines, scoreQuality } from "@/services/article-scoring.ts";

/** Stage 3 성공률이 이보다 낮으면 크론을 실패로 끝낸다 (0개 저장 + 성공 종료 방지) */
export const MIN_STAGE3_SUCCESS_RATE = 0.5;

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

  const scores = await scoreHeadlines(articles);
  const allScored: TitleFilteredArticle[] = articles.map((a, i) => ({
    ...a,
    titleScore: scores[i]!,
    filterReason: "headline score",
  }));

  // 복합 점수(titleScore + recencyScore)순 정렬 후 상위 N개 선택
  allScored.sort(
    (a, b) =>
      b.titleScore + calculateRecencyScore(b.pubDate) -
      (a.titleScore + calculateRecencyScore(a.pubDate))
  );
  const filtered = allScored.slice(0, config.openai.titleFilterLimit);

  log(`Stage 1 완료: ${filtered.length}개 기사 선별 (최고점: ${filtered[0]?.titleScore}, 최저점: ${filtered[filtered.length - 1]?.titleScore}, 최신성 가산점 적용)`);
  return filtered;
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

  for (let i = 0; i < articles.length; i += CONCURRENCY_LIMIT) {
    const batch = articles.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(
      batch.map(async (article) => ({
        ...article,
        imageUrl: (await extractImageUrl(article.link)) ?? undefined,
      }))
    );
    results.push(...batchResults);
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
  return [...articles].sort(
    (a, b) =>
      b.qualityScore + calculateRecencyScore(b.pubDate) -
      (a.qualityScore + calculateRecencyScore(a.pubDate))
  );
}

async function scoreQualityBatch(
  articles: TitleFilteredArticle[]
): Promise<QualityFilteredArticle[]> {
  const scores = await scoreQuality(articles);
  return articles.map((a, i) => ({
    ...a,
    qualityScore: scores[i]!,
    hasValidImage: !!a.imageUrl,
  }));
}

async function filterByQuality(
  articles: TitleFilteredArticle[]
): Promise<QualityFilteredArticle[]> {
  log(`Stage 2: ${articles.length}개 기사 품질 필터링 시작...`);

  const withImages = await extractImagesForArticles(articles);
  const hasImage = withImages.filter((a) => a.imageUrl);
  const noImage = withImages.filter((a) => !a.imageUrl);
  log(`이미지 있음: ${hasImage.length}개, 없음: ${noImage.length}개`);

  const limit = config.openai.qualityFilterLimit;
  const remaining = Math.max(0, limit - hasImage.length);

  // 이미지 있는 기사 우선, 모자라면 이미지 없는 기사로 채운다
  const [scoredWithImage, scoredNoImage] = await Promise.all([
    scoreQualityBatch(hasImage),
    remaining > 0 ? scoreQualityBatch(noImage) : Promise.resolve([]),
  ]);

  const sortedWithImage = sortByCompositeQualityScore(scoredWithImage).slice(0, limit);
  const sortedNoImage = sortByCompositeQualityScore(scoredNoImage).slice(0, remaining);
  const result = [...sortedWithImage, ...sortedNoImage];

  log(
    `Stage 2 완료: ${result.length}개 기사 선별 (이미지 ${sortedWithImage.length}개 + 비이미지 ${sortedNoImage.length}개, 최신성 가산점 적용)`
  );
  return result;
}

// ============================================
// Stage 3: 상세 AI 분석 (20개 병렬 처리)
// ============================================

async function analyzeArticleWithAI(
  article: QualityFilteredArticle
): Promise<NewsAnalysisResult | null> {
  // 동적 프롬프트 생성 (Few-shot, Rubric, CoT 포함)
  const { system, user } = await buildAnalysisPrompt(article);

  try {
    return await createStructured({
      schema: NewsAnalysisResultSchema,
      name: "news_analysis",
      system,
      user,
      maxOutputTokens: 8000,
      timeoutMs: 170_000,
    });
  } catch (error) {
    log(`상세 분석 오류 (${article.title.substring(0, 30)}...): ${getErrorMessage(error)}`, "error");
    if (error instanceof z.ZodError) {
      log(`Zod 검증 실패 상세: ${JSON.stringify(error.issues)}`, "error");
    }
    return null;
  }
}

async function analyzeArticlesInParallel(
  articles: QualityFilteredArticle[]
): Promise<AnalyzedNewsArticle[]> {
  log(`Stage 3: ${articles.length}개 기사 상세 분석 시작 (${config.models.generate}, 병렬)...`);

  const PER_ARTICLE_TIMEOUT = 180_000; // 3분
  const settled = await Promise.allSettled(
    articles.map(async (article) => ({
      article,
      analysis: await withTimeout(
        analyzeArticleWithAI(article),
        PER_ARTICLE_TIMEOUT,
        `기사 분석 타임아웃: ${article.title.substring(0, 30)}`
      ),
    }))
  );

  // 분석 성공한 기사만 저장 대상 (타임아웃/실패 시 스킵)
  const analyzedArticles: AnalyzedNewsArticle[] = [];
  let failCount = 0;

  for (const result of settled) {
    if (result.status === "rejected") {
      failCount++;
      log(`기사 분석 실패 (스킵): ${result.reason}`, "warn");
      continue;
    }
    const { article, analysis } = result.value;
    if (!analysis) {
      failCount++;
      continue;
    }
    analyzedArticles.push({
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
    });
  }

  log(`Stage 3 완료: ${analyzedArticles.length}/${articles.length}개 상세 분석 성공${failCount > 0 ? ` (${failCount}개 실패/타임아웃)` : ""}`);

  return analyzedArticles;
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
    const existingLinks = await getExistingLinks(articles.map((a) => a.link));

    if (existingLinks.size === 0) {
      log(`중복 없음: 모든 기사가 신규`);
      return articles;
    }

    const newArticles = articles.filter((a) => !existingLinks.has(a.link));
    log(`Stage 0 완료: ${existingLinks.size}개 중복 제외, ${newArticles.length}개 신규 기사`);
    return newArticles;
  } catch (error) {
    log(`중복 필터링 DB 조회 실패, 모든 기사 진행: ${getErrorMessage(error)}`, "warn");
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
    const stage3Rate =
      qualityFiltered.length > 0 ? analyzedArticles.length / qualityFiltered.length : 1;

    const metrics = {
      total_articles: articles.length,
      unique_articles: uniqueArticles.length,
      stage0_duplicate_rate: ((articles.length - uniqueArticles.length) / articles.length).toFixed(2),
      stage1_pass_rate: (titleFiltered.length / uniqueArticles.length).toFixed(2),
      stage2_pass_rate: titleFiltered.length > 0 ? (qualityFiltered.length / titleFiltered.length).toFixed(2) : "0.00",
      stage3_success_rate: stage3Rate.toFixed(2),
      final_with_images: withImages.length,
      final_with_analysis: analyzedArticles.length,
      models: { judge: config.typesafe.model, generate: config.models.generate },
      timing_ms: {
        stage0_dedup: stage0Time,
        stage1_title: stage1Time,
        stage2_quality: stage2Time,
        stage3_analysis: stage3Time,
        total: Date.now() - startTime,
      },
    };
    log(`📊 분석 메트릭: ${JSON.stringify(metrics)}`);

    if (stage3Rate < MIN_STAGE3_SUCCESS_RATE) {
      const error = `상세 분석 성공률 ${(stage3Rate * 100).toFixed(0)}% (${analyzedArticles.length}/${qualityFiltered.length}) — 기준 ${MIN_STAGE3_SUCCESS_RATE * 100}% 미만`;
      log(error, "error");
      // 성공한 기사는 저장할 수 있게 넘기되, 실패로 표시해 크론이 비정상 종료되게 한다
      return { success: false, articles: analyzedArticles, error };
    }

    log(
      `총 ${analyzedArticles.length}/${articles.length}개 뉴스 분석 완료 (이미지: ${withImages.length}개)`
    );
    return { success: true, articles: analyzedArticles };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    log(`뉴스 분석 중 오류: ${errorMessage}`, "error");
    return { success: false, articles: [], error: errorMessage };
  }
}
