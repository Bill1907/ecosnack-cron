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
import { IMPORTANCE_RUBRIC, SENTIMENT_RUBRIC, CATEGORY_RUBRIC, TIME_HORIZON_RUBRIC } from "@/prompts/rubrics.ts";
import {
  ANALYSIS_STEPS,
  PRACTICAL_INSIGHT_GUIDE,
  TONE_GUIDELINES,
  getCoTTemplate,
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

// ============================================
// 핵심 규칙 (MUST) - 반드시 준수
// ============================================

const CORE_INSTRUCTIONS = `
## 🚨 핵심 규칙 (MUST - 반드시 준수)

1. **친근한 톤 사용**: ~예요, ~입니다 형태의 존댓말 (딱딱한 ~이다, ~함 금지)
2. **비유/예시 필수**: 전체 분석에서 최소 3개 이상의 실생활 비유/예시 포함
   - "마치 ~처럼", "예를 들어", "쉽게 말해" 표현 적극 활용
3. **길이 가이드라인 준수**: 
   - headline_summary: 150자 이상, 4-5문장
   - main_point: 200자 이상, 5-7문장, 비유 1개 필수
   - 각 impact summary: 150자 이상, 실생활 예시 포함
4. **구체성**: 수치, 기간, 날짜를 가능한 명시 (예: "3개월", "5%", "다음 달")
5. **JSON 형식 출력**: 요청된 스키마에 맞게 출력
6. **언어 규칙**:
   - 한국어 기사 → 한국어 분석
   - English article → English analysis
`;

// ============================================
// 권장 사항 (SHOULD) - 가능한 준수
// ============================================

const GUIDELINES = `
## 💡 권장 사항 (SHOULD - 가능한 준수)

### 독자와의 소통
- 독자에게 말 걸기: "여러분", "~하시는 분들"
- 공감 표현: "걱정되시죠?", "좋은 소식이에요"
- 실용적 조언: "~해보시는 건 어떨까요?"

### 전문용어 처리
- 괄호 안에 쉬운 설명 추가
- 예: "FOMC(연방공개시장위원회, 미국 금리를 결정하는 회의)"

### 구체성
- 수치/기간 명시: "앞으로 3개월 정도"
- 영향 경로 설명: "금리 인상 → 대출 이자 상승 → 소비 위축"
- 대상별 맞춤 조언 제공
`;

// ============================================
// 기본 시스템 프롬프트 (통합)
// ============================================

const BASE_SYSTEM_PROMPT = `당신은 친근한 경제 분석가입니다.
경제 뉴스를 이해하기 쉽게 설명하는 역할을 합니다.
마치 경제에 밝은 친한 선배가 커피 마시며 설명해주는 느낌으로요.

${CORE_INSTRUCTIONS}

${GUIDELINES}

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
    markets: [
      "코스피",
      "코스닥",
      "S&P",
      "나스닥",
      "주가",
      "상승",
      "하락",
      "지수",
      "nasdaq",
      "dow",
      "rally",
      "증시",
      "주식시장",
    ],
    trade: [
      "수출",
      "수입",
      "무역",
      "관세",
      "tariff",
      "supply chain",
      "공급망",
      "FTA",
      "통상",
      "교역",
    ],
    finance: [
      "대출",
      "예금",
      "은행",
      "보험",
      "카드",
      "금융",
      "banking",
      "loan",
      "저축",
      "핀테크",
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
 * 기사 복잡도 추정 (CoT 템플릿 선택용)
 */
function estimateArticleComplexity(
  article: QualityFilteredArticle
): "high" | "medium" | "low" {
  const descLength = article.description?.length ?? 0;
  const titleLength = article.title.length;
  
  // 수치/퍼센트/금액 포함 여부
  const hasNumbers = /\d+%|\$\d+|₩\d+|억원|조원/.test(
    `${article.title} ${article.description ?? ""}`
  );
  
  // 복잡한 키워드 (정책, 거시경제 등)
  const complexKeywords = /금리|GDP|인플레이션|FOMC|연준|한은|물가|정책/.test(
    `${article.title} ${article.description ?? ""}`
  );

  // 높은 복잡도: 긴 설명 + 수치 + 복잡 키워드
  if (descLength > 400 && hasNumbers && complexKeywords) {
    return "high";
  }
  
  // 중간 복잡도: 어느 정도 길이가 있고 수치 있음
  if (descLength > 150 || (titleLength > 30 && hasNumbers)) {
    return "medium";
  }
  
  return "low";
}

/**
 * 전체 시스템 프롬프트 생성
 */
function buildSystemPrompt(
  examples: AnalysisExample[],
  article?: QualityFilteredArticle
): string {
  // 기사 복잡도에 따른 CoT 템플릿 선택
  const complexity = article ? estimateArticleComplexity(article) : "medium";
  const cotTemplate = getCoTTemplate(complexity);

  const parts = [
    BASE_SYSTEM_PROMPT,
    "",
    "---",
    "",
    TONE_GUIDELINES,
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
    CATEGORY_RUBRIC,
    "",
    "---",
    "",
    TIME_HORIZON_RUBRIC,
    "",
    "---",
    "",
    cotTemplate,  // 동적 CoT 템플릿 적용
    "",
    "---",
    "",
    PRACTICAL_INSIGHT_GUIDE,
  ];

  // Few-shot 예시 추가
  if (examples.length > 0) {
    parts.push("", "---", "", "## 참고 예시", "");
    parts.push("다음은 친근하고 상세한 분석의 예시입니다. 톤, 길이, 비유 사용법을 참고하세요.", "");

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

  // 프롬프트 생성 (기사 복잡도에 따른 동적 CoT 템플릿 적용)
  const system = buildSystemPrompt(examples, article);
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
