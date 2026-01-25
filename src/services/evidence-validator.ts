import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { config } from "@/config/index.ts";
import {
  EvidenceValidationSchema,
  EvidenceRelevanceAIResponseSchema,
  type EvidenceValidation,
  type EvidenceValidationItem,
} from "@/schemas/quality-evaluation.ts";
import type { DailyReportData, EvidenceItem } from "@/types/daily-report.ts";
import type { NewsRecord } from "@/types/index.ts";
import { log, withRetry } from "@/utils/index.ts";

// ============================================
// OpenAI 클라이언트
// ============================================

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openaiClient;
}

// ============================================
// 근거 검증 인터페이스
// ============================================

export interface ValidateEvidenceOptions {
  checkRelevance?: boolean; // AI 관련성 검증 (추가 비용 발생)
  relevanceThreshold?: number; // 관련성 임계값 (0-10, 기본 5)
}

// ============================================
// 리포트에서 모든 Evidence 추출
// ============================================

function extractAllEvidences(report: DailyReportData): EvidenceItem[] {
  const evidences: EvidenceItem[] = [];

  for (const insight of report.keyInsights) {
    evidences.push(...insight.evidence);
  }

  return evidences;
}

// ============================================
// 기사 ID 존재 여부 검증 (로컬, 비용 없음)
// ============================================

function validateArticleIdExists(
  articleId: number | undefined,
  articleIds: Set<number>
): { isValid: boolean; reason: string } {
  if (!articleId) {
    return { isValid: true, reason: "기사 ID가 없는 외부 출처 근거" };
  }

  if (articleIds.has(articleId)) {
    return { isValid: true, reason: "유효한 기사 ID" };
  }

  return { isValid: false, reason: `존재하지 않는 기사 ID: ${articleId}` };
}

// ============================================
// Evidence 텍스트와 기사 내용 관련성 검증 (AI 기반)
// ============================================

async function checkEvidenceRelevance(
  evidenceText: string,
  article: NewsRecord
): Promise<{ relevanceScore: number; reasoning: string }> {
  const client = getOpenAIClient();

  const prompt = `## 근거 검증 요청

### Evidence 텍스트
"${evidenceText}"

### 참조 기사 정보
- 제목: ${article.title}
- 요약: ${article.headlineSummary ?? "없음"}
- 핵심 포인트: ${article.soWhat?.main_point ?? "없음"}

### 평가 기준
- 10점: Evidence가 기사 내용과 직접적으로 일치
- 7-9점: 기사 내용에서 합리적으로 추론 가능
- 4-6점: 기사와 관련은 있으나 직접적 근거는 약함
- 1-3점: 기사 내용과 거의 무관
- 0점: 전혀 관련 없음

Evidence가 해당 기사의 내용에 기반한 것인지 평가해주세요.`;

  const response = await withRetry(
    () =>
      client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "당신은 근거 검증 전문가입니다. 객관적으로 평가해주세요." },
          { role: "user", content: prompt },
        ],
        response_format: zodResponseFormat(EvidenceRelevanceAIResponseSchema, "relevance_check"),
        temperature: 0.3,
        max_tokens: 500,
      }),
    { retries: 2, delay: 1000 }
  );

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI");
  }

  return EvidenceRelevanceAIResponseSchema.parse(JSON.parse(content));
}

// ============================================
// 메인 함수: 근거 검증 실행
// ============================================

export async function validateEvidence(
  report: DailyReportData,
  articles: NewsRecord[],
  options: ValidateEvidenceOptions = {}
): Promise<EvidenceValidation> {
  const { checkRelevance = true, relevanceThreshold = 5 } = options;

  log("근거 검증 시작...");

  const evidences = extractAllEvidences(report);
  const articleIds = new Set(articles.map((a) => a.id));
  const articlesMap = new Map(articles.map((a) => [a.id, a]));

  const validationResults: EvidenceValidationItem[] = [];
  let validCount = 0;
  let invalidCount = 0;

  for (const evidence of evidences) {
    // 1단계: 기사 ID 존재 여부 검증 (로컬)
    const idValidation = validateArticleIdExists(evidence.articleId, articleIds);

    if (!idValidation.isValid) {
      invalidCount++;
      validationResults.push({
        evidenceText: evidence.text,
        articleId: evidence.articleId ?? null,
        isValid: false,
        reason: idValidation.reason,
      });
      log(`[무효] "${evidence.text.slice(0, 30)}..." - ${idValidation.reason}`, "warn");
      continue;
    }

    // 2단계: 관련성 검증 (AI 기반, 선택적)
    if (checkRelevance && evidence.articleId) {
      const article = articlesMap.get(evidence.articleId);
      if (article) {
        try {
          const relevance = await checkEvidenceRelevance(evidence.text, article);

          if (relevance.relevanceScore >= relevanceThreshold) {
            validCount++;
            validationResults.push({
              evidenceText: evidence.text,
              articleId: evidence.articleId,
              isValid: true,
              reason: relevance.reasoning,
              relevanceScore: relevance.relevanceScore,
            });
          } else {
            invalidCount++;
            validationResults.push({
              evidenceText: evidence.text,
              articleId: evidence.articleId,
              isValid: false,
              reason: `관련성 점수 미달 (${relevance.relevanceScore}/10): ${relevance.reasoning}`,
              relevanceScore: relevance.relevanceScore,
            });
            log(`[낮은 관련성] "${evidence.text.slice(0, 30)}..." - 점수: ${relevance.relevanceScore}`, "warn");
          }
        } catch (error) {
          // AI 검증 실패 시 로컬 검증만 적용
          validCount++;
          validationResults.push({
            evidenceText: evidence.text,
            articleId: evidence.articleId,
            isValid: true,
            reason: "AI 관련성 검증 실패, 기사 ID 유효성만 확인됨",
          });
        }
      }
    } else {
      // 관련성 검증 스킵
      validCount++;
      validationResults.push({
        evidenceText: evidence.text,
        articleId: evidence.articleId ?? null,
        isValid: true,
        reason: idValidation.reason,
      });
    }
  }

  const totalEvidences = evidences.length;
  const validationRate = totalEvidences > 0 ? (validCount / totalEvidences) * 100 : 100;

  const result: EvidenceValidation = {
    totalEvidences,
    validCount,
    invalidCount,
    validationRate: Math.round(validationRate * 10) / 10,
    details: validationResults,
    summary: `총 ${totalEvidences}개 근거 중 ${validCount}개 유효 (${validationRate.toFixed(1)}%)`,
  };

  log(`근거 검증 완료: ${result.summary}`);

  return result;
}

// ============================================
// 검증 점수 계산 (0-100)
// ============================================

export function calculateEvidenceScore(validation: EvidenceValidation): number {
  if (validation.totalEvidences === 0) return 100;

  // 기본 점수: 검증 통과율
  let score = validation.validationRate;

  // 관련성 점수 보너스 (있는 경우)
  const relevanceScores = validation.details
    .filter((d) => d.relevanceScore !== undefined)
    .map((d) => d.relevanceScore!);

  if (relevanceScores.length > 0) {
    const avgRelevance = relevanceScores.reduce((a, b) => a + b, 0) / relevanceScores.length;
    // 관련성 점수를 10% 가중치로 반영
    score = score * 0.9 + avgRelevance * 10 * 0.1;
  }

  return Math.round(score * 10) / 10;
}
