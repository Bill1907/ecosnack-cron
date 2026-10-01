import type { QualityCriterionKey, QualityEvaluation } from "@/schemas/quality-evaluation.ts";
import type { DailyReportData } from "@/types/daily-report.ts";
import { log } from "@/utils/index.ts";
import { askJev, normalizedScore, type ScoreQuestion } from "@/services/jev-client.ts";

// ============================================
// 리포트 품질 평가 — Jev Score 6개를 한 요청으로
// 기준마다 따로 묻고(한 질문에 판단 하나), 종합 점수는 코드에서 평균
// ============================================

const CRITERIA: Record<QualityCriterionKey, { question: string; levels: string[] }> = {
  specificity: {
    question: "How specific is `report`? Does it use concrete numbers, names and cases instead of abstract statements?",
    levels: [
      "Vague: mostly abstract statements with almost no numbers or concrete cases",
      "Some specifics: a few numbers or named examples",
      "Specific: most points backed by concrete numbers, names or cases",
    ],
  },
  evidenceBased: {
    question: "Are the claims in `report` grounded in the news it summarizes, rather than speculation or assumptions?",
    levels: [
      "Mostly speculation or assumptions",
      "Mixed: some claims grounded, some speculative",
      "Grounded: claims clearly follow from reported news",
    ],
  },
  logicalConsistency: {
    question: "Is the reasoning in `report` logically consistent, with conclusions that follow from the stated facts?",
    levels: [
      "Contradictory or conclusions do not follow",
      "Mostly coherent with some gaps",
      "Coherent: conclusions clearly follow from the facts",
    ],
  },
  friendlyTone: {
    question: "Is `report` easy for a non-expert Korean reader to understand, with jargon explained in a friendly tone?",
    levels: [
      "Hard: dense jargon with no explanation",
      "Mixed: some explanations, some unexplained jargon",
      "Friendly: plain explanations and a conversational tone",
    ],
  },
  practicality: {
    question: "Does `report` give investors, workers and consumers concrete, actionable takeaways?",
    levels: [
      "No actionable takeaways",
      "Generic advice",
      "Concrete, actionable takeaways for each audience",
    ],
  },
  completeness: {
    question: "Are all sections of `report` covered with enough depth, without missing obvious important points?",
    levels: [
      "Thin or missing sections",
      "Adequate but shallow in places",
      "Every section covered in depth",
    ],
  },
};

const MAX_FIELD = 1200;
const clip = (s: string, n = MAX_FIELD) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 판정에 필요한 본문만 남긴 state (상태가 길수록 Jev 정확도가 떨어진다) */
function reportState(report: DailyReportData) {
  return {
    headline: report.executiveSummary.headline,
    overview: clip(report.executiveSummary.overview),
    highlights: report.executiveSummary.highlights.map((h) => `${h.title}: ${clip(h.description, 300)}`),
    market: {
      summary: clip(report.marketOverview.summary),
      sections: report.marketOverview.sections.map((s) => `${s.title}: ${clip(s.content, 400)}`),
      outlook: clip(report.marketOverview.outlook, 500),
    },
    insights: report.keyInsights.map((k) => ({
      title: k.title,
      summary: clip(k.summary, 400),
      analysis: clip(k.analysis, 600),
      investors: clip(k.implications.investors, 300),
      workers: clip(k.implications.workers, 300),
      consumers: clip(k.implications.consumers, 300),
      actionItems: k.actionItems,
    })),
  };
}

export async function evaluateReportQuality(report: DailyReportData): Promise<QualityEvaluation> {
  log("품질 평가 시작 (Jev)...");

  const keys = Object.keys(CRITERIA) as QualityCriterionKey[];
  const questions: Record<string, ScoreQuestion> = Object.fromEntries(
    keys.map((k) => [k, { type: "score", instructions: CRITERIA[k].question, criteria: CRITERIA[k].levels }])
  );

  const res = await askJev({ report: reportState(report) }, questions, { timeoutMs: 30_000 });

  const criteria = Object.fromEntries(
    keys.map((k) => {
      const a = res.answers[k];
      // 타입이 다르면 throw — NaN 점수를 저장하지 않는다
      const norm = normalizedScore(a, CRITERIA[k].levels.length);
      const confidence = a?.type === "score" ? a.confidence : 0;
      return [k, { score: Math.round(norm * 100) / 10, confidence }];
    })
  ) as QualityEvaluation["criteria"];

  const avg = keys.reduce((s, k) => s + criteria[k].score, 0) / keys.length;
  const evaluation: QualityEvaluation = {
    criteria,
    overallScore: Math.round(avg * 100) / 10,
    judge: res.model,
  };

  log(`품질 평가 완료: 종합 ${evaluation.overallScore}/100 (${res.model})`);
  return evaluation;
}

/** 품질 60% + 근거 40%. 근거 점수가 없으면 품질 점수만 쓴다. */
export function calculateFinalQualityScore(
  qualityEvaluation: QualityEvaluation,
  evidenceScore: number | null
): number {
  const ai = qualityEvaluation.overallScore;
  const final = evidenceScore === null ? ai : ai * 0.6 + evidenceScore * 0.4;
  return Math.round(final * 10) / 10;
}
