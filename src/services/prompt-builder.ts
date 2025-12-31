/**
 * 동적 프롬프트 빌더 - AI 분석 품질 향상을 위한 프롬프트 생성
 *
 * Few-shot 예시, Rubric, Chain-of-Thought을 결합하여
 * 상황에 맞는 최적의 프롬프트를 동적으로 생성
 */

import {
  ANALYSIS_EXAMPLES,
  formatExampleForPrompt,
  type AnalysisExample,
} from "@/prompts/examples.ts";
import { IMPORTANCE_RUBRIC, SENTIMENT_RUBRIC } from "@/prompts/rubrics.ts";
import {
  ANALYSIS_STEPS,
  PRACTICAL_INSIGHT_GUIDE,
} from "@/prompts/chain-of-thought.ts";
import type { QualityFilteredArticle } from "@/types/index.ts";
import {
  getExamplesForPrompt,
  type RetrievedExample,
} from "@/services/example-retrieval.ts";
import type { NewsAnalysisResult } from "@/schemas/news-analysis.ts";
import { log } from "@/utils/index.ts";

// ============================================
// 프롬프트 결과 타입
// ============================================

export interface BuiltPrompt {
  system: string;
  user: string;
}

// ============================================
// 기본 시스템 프롬프트
// ============================================

const BASE_SYSTEM_PROMPT = `You are an expert economic analyst specializing in financial news analysis.
Your role is to provide deep, actionable insights that help investors, workers, and consumers make informed decisions.

## Core Principles
1. **Depth over breadth**: Provide thorough analysis, not surface-level summaries
2. **Actionable insights**: Every analysis should help someone make a decision
3. **Evidence-based**: Base your analysis on facts from the article, not speculation
4. **Balanced perspective**: Consider multiple stakeholders and viewpoints

## Language Rules
- 한국어 기사 → 한국어로 분석
- English article → Analyze in English
- Maintain professional, analytical tone

## Output Format
Respond in valid JSON format matching the required schema.
`;

// ============================================
// 프롬프트 빌더 함수
// ============================================

/**
 * 기사에 맞는 Few-shot 예시 선택
 */
async function selectRelevantExamples(
  article: QualityFilteredArticle
): Promise<AnalysisExample[]> {
  const region = article.region as "US" | "KR" | undefined;
  const title = article.title.toLowerCase();

  // 1. DB에서 동적 예시 먼저 검색
  try {
    const dbExamples = await getExamplesForPrompt(article, 2);

    if (dbExamples.length > 0) {
      const converted = dbExamples
        .map((ex) => convertToAnalysisExample(ex))
        .filter((ex): ex is AnalysisExample => ex !== null);

      if (converted.length > 0) {
        log(`동적 Few-shot: DB에서 ${converted.length}개 예시 사용`);
        return converted;
      }
    }
  } catch (error) {
    log(`DB 예시 검색 실패, 정적 예시로 폴백: ${error}`, "warn");
  }

  // 2. 폴백: 정적 예시 사용
  log("동적 Few-shot: 정적 예시 사용");

  // 카테고리 추론
  let inferredCategory: string | null = null;

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
    ],
    earnings: [
      "실적",
      "영업이익",
      "매출",
      "earnings",
      "revenue",
      "profit",
      "분기",
      "quarter",
    ],
    macro: [
      "gdp",
      "cpi",
      "인플레이션",
      "inflation",
      "경제성장",
      "실업률",
      "unemployment",
      "물가",
    ],
  };

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((kw) => title.includes(kw))) {
      inferredCategory = category;
      break;
    }
  }

  // 관련 예시 선택 (최대 2개)
  const selectedExamples: AnalysisExample[] = [];

  // 카테고리 매칭 예시
  if (inferredCategory) {
    const categoryExample = ANALYSIS_EXAMPLES.find(
      (ex) => ex.category === inferredCategory
    );
    if (categoryExample) {
      selectedExamples.push(categoryExample);
    }
  }

  // 지역 매칭 예시 (다른 카테고리에서)
  if (region) {
    const regionExample = ANALYSIS_EXAMPLES.find(
      (ex) =>
        ex.input.region === region &&
        !selectedExamples.some((sel) => sel.category === ex.category)
    );
    if (regionExample) {
      selectedExamples.push(regionExample);
    }
  }

  // 예시가 없으면 기본 예시 1개 추가
  if (selectedExamples.length === 0 && ANALYSIS_EXAMPLES[0]) {
    selectedExamples.push(ANALYSIS_EXAMPLES[0]);
  }

  return selectedExamples;
}


/**
 * DB에서 가져온 예시를 AnalysisExample 포맷으로 변환
 */
function convertToAnalysisExample(
  example: RetrievedExample
): AnalysisExample | null {
  // 필수 필드 검증
  if (
    !example.headlineSummary ||
    !example.soWhat ||
    !example.impactAnalysis ||
    !example.relatedContext
  ) {
    return null;
  }

  try {
    return {
      category: example.category ?? "general",
      input: {
        title: example.title,
        description: example.description ?? "",
        source: example.source ?? "Unknown",
        region: (example.region as "US" | "KR") ?? "US",
      },
      output: {
        headline_summary: example.headlineSummary,
        so_what: example.soWhat as NewsAnalysisResult["so_what"],
        impact_analysis: example.impactAnalysis as NewsAnalysisResult["impact_analysis"],
        related_context: example.relatedContext as NewsAnalysisResult["related_context"],
        keywords: example.keywords,
        category: (example.category ?? "economy") as NewsAnalysisResult["category"],
        sentiment: (example.sentiment ?? { overall: "neutral", confidence: 0.5 }) as NewsAnalysisResult["sentiment"],
        importance_score: example.importanceScore ?? 5,
      },
      reasoning: `품질 평가 ${example.qualityRating ?? "미평가"}/5 - DB에서 검색된 고품질 분석 예시`,
    };
  } catch {
    return null;
  }
}

/**
 * 기사 정보 포맷팅
 */
function formatArticleInfo(article: QualityFilteredArticle): string {
  const parts = [
    `## 분석 대상 기사`,
    ``,
    `**제목:** ${article.title}`,
    `**출처:** ${article.source ?? "Unknown"}`,
    `**지역:** ${article.region ?? "Unknown"}`,
    `**발행일:** ${article.pubDate?.toISOString() ?? "Unknown"}`,
    ``,
    `**내용:**`,
    article.description ?? "(상세 내용 없음)",
  ];

  return parts.join("\n");
}

/**
 * 전체 시스템 프롬프트 생성
 */
function buildSystemPrompt(examples: AnalysisExample[]): string {
  const parts = [
    BASE_SYSTEM_PROMPT,
    "",
    "---",
    "",
    IMPORTANCE_RUBRIC,
    "",
    "---",
    "",
    SENTIMENT_RUBRIC,
    "",
    "---",
    "",
    ANALYSIS_STEPS,
    "",
    "---",
    "",
    PRACTICAL_INSIGHT_GUIDE,
  ];

  // Few-shot 예시 추가
  if (examples.length > 0) {
    parts.push("", "---", "", "## 참고 예시", "");
    parts.push("다음은 좋은 분석의 예시입니다. 형식과 깊이를 참고하세요.", "");

    for (const example of examples) {
      parts.push(formatExampleForPrompt(example));
    }
  }

  return parts.join("\n");
}

/**
 * 사용자 프롬프트 생성
 */
function buildUserPrompt(article: QualityFilteredArticle): string {
  const parts = [
    formatArticleInfo(article),
    "",
    "---",
    "",
    "## 분석 요청",
    "",
    "위 기사를 분석하여 다음 정보를 포함한 JSON을 작성하세요:",
    "",
    "1. **headline_summary**: 2-3문장으로 핵심 요약 (무엇이 일어났는지, 왜 중요한지, 예상 영향 포함)",
    "2. **so_what**: 왜 중요한지, 시장 시그널, 영향 기간",
    "3. **impact_analysis**: 투자자/직장인/소비자 각각에 미치는 영향",
    "4. **related_context**: 배경, 연관 이슈, 향후 주목점",
    "5. **keywords**: 핵심 키워드 3-7개",
    "6. **category**: economy|finance|business|markets|policy|trade",
    "7. **sentiment**: overall(positive/negative/neutral/mixed) + confidence(0.0-1.0)",
    "8. **importance_score**: 1-10 정수 (Rubric 참조)",
    "",
    "**중요:** 분석 단계(Chain-of-Thought)를 내부적으로 따른 후 최종 결과만 JSON으로 출력하세요.",
  ];

  return parts.join("\n");
}

// ============================================
// 메인 Export
// ============================================

/**
 * 기사에 맞는 최적의 프롬프트 생성
 *
 * @param article - 분석할 기사
 * @returns 시스템 프롬프트와 사용자 프롬프트
 */
export async function buildAnalysisPrompt(
  article: QualityFilteredArticle
): Promise<BuiltPrompt> {
  // 관련 예시 선택 (DB 우선, 정적 예시 폴백)
  const examples = await selectRelevantExamples(article);

  // 프롬프트 생성
  const system = buildSystemPrompt(examples);
  const user = buildUserPrompt(article);

  return { system, user };
}

/**
 * 프롬프트 토큰 수 추정 (대략적)
 * GPT-4 기준 약 4글자 = 1토큰
 */

// ============================================
// 토큰 추정 (tiktoken 대체)
// ============================================

// GPT 토큰화 근사치: 한글은 글자당 약 1.5-2토큰, 영어는 4자당 약 1토큰
// 특수문자/숫자는 보통 1-2토큰
function estimateTokenCount(text: string): number {
  let tokenCount = 0;

  // 한글 문자 수 (각 글자가 대략 1.5-2 토큰)
  const koreanChars = (text.match(/[\uAC00-\uD7A3]/g) || []).length;
  tokenCount += koreanChars * 1.7; // 한글 평균 1.7 토큰/글자

  // 영어 알파벳 (약 4글자당 1토큰)
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  tokenCount += englishChars / 3.5; // 영어 평균 3.5자당 1토큰 (GPT 기준)

  // 숫자 (약 2-3자당 1토큰)
  const digits = (text.match(/[0-9]/g) || []).length;
  tokenCount += digits / 2.5;

  // 특수문자 및 공백 (각각 대략 1토큰 또는 그 이하)
  const specialChars = (text.match(/[^\uAC00-\uD7A3a-zA-Z0-9]/g) || []).length;
  tokenCount += specialChars * 0.5; // 특수문자는 종종 병합됨

  // 안전 마진 추가 (5% 여유)
  return Math.ceil(tokenCount * 1.05);
}

/**
 * 토큰 예산 검증
 * @param prompt 빌드된 프롬프트
 * @param maxTokens 최대 허용 토큰
 * @returns 예산 초과 여부와 추정 토큰 수
 */
export function checkTokenBudget(
  prompt: BuiltPrompt,
  maxTokens: number = 8000
): { withinBudget: boolean; estimatedTokens: number; remaining: number } {
  const estimatedTokens = estimateTokenCount(prompt.system + prompt.user);
  const remaining = maxTokens - estimatedTokens;

  if (remaining < 0) {
    log(
      `⚠️ 토큰 예산 초과: ${estimatedTokens}/${maxTokens} (${Math.abs(remaining)} 초과)`,
      "warn"
    );
  }

  return {
    withinBudget: remaining >= 0,
    estimatedTokens,
    remaining,
  };
}

export function estimateTokens(prompt: BuiltPrompt): number {
  const text = prompt.system + prompt.user;
  return estimateTokenCount(text);
}
