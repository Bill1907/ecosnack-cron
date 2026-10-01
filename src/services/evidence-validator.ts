import {
  EvidenceVerdictSchema,
  type EvidenceStatus,
  type EvidenceValidation,
  type EvidenceValidationItem,
} from "@/schemas/quality-evaluation.ts";
import type { DailyReportData, EvidenceItem } from "@/types/daily-report.ts";
import type { NewsRecord } from "@/types/index.ts";
import { config } from "@/config/index.ts";
import { log, getErrorMessage } from "@/utils/index.ts";
import { askJev, type ChoiceQuestion } from "@/services/jev-client.ts";
import { createStructured } from "@/services/openai-client.ts";

// Jev 확신도가 이 값 미만이면 LLM 에 다시 묻는다.
// 실측(57건): 확신도 ≥0.8 → 커버리지 91%, 정확도 100%
export const JEV_CONFIDENCE_GATE = 0.8;

const VERDICT_CRITERIA = {
  supports: "The article directly states, or clearly implies, what the claim says, including its numbers and direction.",
  contradicts: "The article covers the same topic but states a number, direction or fact that is incompatible with the claim.",
  unrelated: "The article does not address what the claim is about.",
} as const;
type Verdict = keyof typeof VERDICT_CRITERIA;

const VERDICT_QUESTION: ChoiceQuestion = {
  type: "choice",
  instructions: "Both texts are Korean. How does `article` relate to `claim`?",
  criteria: VERDICT_CRITERIA,
};

export interface ValidateEvidenceOptions {
  /** false 면 AI 판정 없이 ID 존재 여부만 본다 (나머지는 unverified) */
  checkRelevance?: boolean;
}

interface Judged {
  verdict: Verdict;
  confidence?: number;
  judge: string;
}

function articleForJudge(article: NewsRecord) {
  return {
    title: article.title,
    summary: article.headlineSummary ?? "",
    mainPoint: article.soWhat?.main_point ?? "",
  };
}

async function judgeWithLLM(claim: string, article: NewsRecord): Promise<Judged> {
  const { verdict } = await createStructured({
    schema: EvidenceVerdictSchema,
    name: "evidence_verdict",
    model: config.models.fallbackJudge,
    reasoningEffort: "none",
    system:
      "당신은 근거 검증 전문가입니다. claim이 article에 의해 뒷받침되는지 판정하세요.\n" +
      Object.entries(VERDICT_CRITERIA).map(([k, v]) => `- ${k}: ${v}`).join("\n"),
    user: JSON.stringify({ claim, article: articleForJudge(article) }),
    maxOutputTokens: 500,
    timeoutMs: 60_000,
  });
  return { verdict, judge: config.models.fallbackJudge };
}

/** Jev 로 먼저 판정하고, 확신도가 낮거나 Jev 가 실패하면 LLM 으로 다시 판정 */
export async function judgeEvidence(claim: string, article: NewsRecord): Promise<Judged> {
  try {
    const res = await askJev(
      { claim, article: articleForJudge(article) },
      { verdict: VERDICT_QUESTION }
    );
    const answer = res.answers.verdict;
    if (answer?.type === "choice" && answer.confidence >= JEV_CONFIDENCE_GATE) {
      return { verdict: answer.choice as Verdict, confidence: answer.confidence, judge: res.model };
    }
  } catch (error) {
    log(`근거 Jev 판정 실패, LLM 으로 대체: ${getErrorMessage(error)}`, "warn");
  }
  return judgeWithLLM(claim, article);
}

function extractAllEvidences(report: DailyReportData): EvidenceItem[] {
  return report.keyInsights.flatMap((insight) => insight.evidence);
}

const REASON: Record<EvidenceStatus, string> = {
  supports: "기사가 근거를 뒷받침함",
  contradicts: "같은 주제지만 기사 내용과 수치·방향·사실이 맞지 않음",
  unrelated: "기사가 근거 내용을 다루지 않음",
  invalid_id: "리포트 기사 목록에 없는 기사 ID",
  unverified: "검증하지 못함",
};

function item(
  evidence: EvidenceItem,
  status: EvidenceStatus,
  extra: Partial<EvidenceValidationItem> = {}
): EvidenceValidationItem {
  return {
    evidenceText: evidence.text,
    articleId: evidence.articleId ?? null,
    status,
    isValid: status === "supports",
    reason: REASON[status],
    ...extra,
  };
}

// ============================================
// 메인 함수: 근거 검증 실행
// ============================================

export async function validateEvidence(
  report: DailyReportData,
  articles: NewsRecord[],
  options: ValidateEvidenceOptions = {}
): Promise<EvidenceValidation> {
  const { checkRelevance = true } = options;
  log("근거 검증 시작...");

  const evidences = extractAllEvidences(report);
  const articlesMap = new Map(articles.map((a) => [a.id, a]));

  const details = await Promise.all(
    evidences.map(async (evidence): Promise<EvidenceValidationItem> => {
      if (!evidence.articleId) {
        return item(evidence, "unverified", { reason: "기사 ID가 없는 근거" });
      }
      const article = articlesMap.get(evidence.articleId);
      if (!article) {
        log(`[무효] "${evidence.text.slice(0, 30)}..." - 존재하지 않는 기사 ID ${evidence.articleId}`, "warn");
        return item(evidence, "invalid_id");
      }
      if (!checkRelevance) {
        return item(evidence, "unverified", { reason: "AI 관련성 검증 생략 (옵션)" });
      }
      try {
        const judged = await judgeEvidence(evidence.text, article);
        if (judged.verdict !== "supports") {
          log(`[${judged.verdict}] "${evidence.text.slice(0, 30)}..." (${judged.judge})`, "warn");
        }
        return item(evidence, judged.verdict, { confidence: judged.confidence, judge: judged.judge });
      } catch (error) {
        // 판정 실패를 "유효"로 세지 않는다
        return item(evidence, "unverified", { reason: `판정 실패: ${getErrorMessage(error).slice(0, 120)}` });
      }
    })
  );

  const validCount = details.filter((d) => d.status === "supports").length;
  const unverifiedCount = details.filter((d) => d.status === "unverified").length;
  const invalidCount = details.length - validCount - unverifiedCount;
  const judgedCount = validCount + invalidCount;
  const validationRate = judgedCount > 0 ? Math.round((validCount / judgedCount) * 1000) / 10 : 0;

  const result: EvidenceValidation = {
    totalEvidences: details.length,
    validCount,
    invalidCount,
    unverifiedCount,
    validationRate,
    details,
    summary: `근거 ${details.length}개: 유효 ${validCount}, 무효 ${invalidCount}, 미검증 ${unverifiedCount} (판정된 것 중 유효 ${validationRate}%)`,
  };
  log(`근거 검증 완료: ${result.summary}`);
  return result;
}

/**
 * 검증 점수 (0-100). 내용 판정(supports/contradicts/unrelated)이 하나도 없으면 null —
 * 관련성 검증을 생략했을 때 invalid_id 하나만으로 0점이 되지 않게 한다.
 */
export function calculateEvidenceScore(validation: EvidenceValidation): number | null {
  const contentJudged = validation.details.filter((d) =>
    d.status === "supports" || d.status === "contradicts" || d.status === "unrelated"
  ).length;
  if (contentJudged === 0) return null;
  return validation.validationRate;
}
