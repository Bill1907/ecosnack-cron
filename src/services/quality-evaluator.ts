import { zodResponseFormat } from "openai/helpers/zod";
import {
  QualityEvaluationAIResponseSchema,
  type QualityEvaluation,
} from "@/schemas/quality-evaluation.ts";
import type { DailyReportData } from "@/types/daily-report.ts";
import { log, withRetry } from "@/utils/index.ts";
import { getOpenAIClient } from "@/services/openai-client.ts";

// ============================================
// 시스템 프롬프트
// ============================================

const QUALITY_EVALUATION_PROMPT = `당신은 경제 콘텐츠 품질 평가 전문가입니다.
제공된 데일리 리포트를 6가지 기준으로 객관적으로 평가해주세요.

## 평가 기준 (각 0-10점)

1. **구체성 (Specificity)**
   - 추상적 표현 대신 구체적 수치, 사례, 데이터 포함 여부
   - "주가가 올랐다" vs "코스피가 2,850선을 돌파하며 1.5% 상승"

2. **근거 기반 (Evidence-Based)**
   - 모든 주장과 분석이 제공된 기사 데이터에 기반하는지
   - 추측이나 가정 없이 사실에 근거한 분석인지

3. **논리적 일관성 (Logical Consistency)**
   - 분석의 흐름이 논리적이고 일관된지
   - 결론이 근거와 연결되는지

4. **친근한 톤 (Friendly Tone)**
   - 경제 비전문가도 이해하기 쉬운 설명인지
   - 전문 용어에 적절한 설명이 있는지
   - 독자에게 말 걸듯 친근하게 작성되었는지

5. **실용성 (Practicality)**
   - 투자자/직장인/소비자에게 실행 가능한 조언 제공 여부
   - 구체적인 행동 지침이 있는지

6. **완결성 (Completeness)**
   - 모든 섹션이 충분한 깊이로 작성되었는지
   - 누락된 중요 정보가 없는지

## 평가 방법
- 각 기준별 0-10점 부여
- 종합 점수 = 각 기준 평균 × 10 (0-100)
- 객관적이고 건설적인 피드백 제공`;

// ============================================
// 리포트를 평가용 텍스트로 변환
// ============================================

function formatReportForEvaluation(report: DailyReportData): string {
  const parts: string[] = [];

  // Executive Summary
  parts.push("## Executive Summary");
  parts.push(`헤드라인: ${report.executiveSummary.headline}`);
  parts.push(`요약: ${report.executiveSummary.overview}`);
  parts.push(`하이라이트: ${report.executiveSummary.highlights.length}개`);
  for (const h of report.executiveSummary.highlights) {
    parts.push(`- ${h.title}: ${h.description}`);
  }

  // Market Overview
  parts.push("\n## Market Overview");
  parts.push(`요약: ${report.marketOverview.summary}`);
  parts.push(`섹션 수: ${report.marketOverview.sections.length}개`);
  for (const s of report.marketOverview.sections) {
    parts.push(`- ${s.title}: ${s.content.slice(0, 200)}...`);
  }
  parts.push(`전망: ${report.marketOverview.outlook}`);

  // Key Insights
  parts.push("\n## Key Insights");
  for (const insight of report.keyInsights) {
    parts.push(`\n### ${insight.title}`);
    parts.push(`요약: ${insight.summary}`);
    parts.push(`분석: ${insight.analysis.slice(0, 300)}...`);
    parts.push(`투자자 영향: ${insight.implications.investors}`);
    parts.push(`직장인 영향: ${insight.implications.workers}`);
    parts.push(`소비자 영향: ${insight.implications.consumers}`);
    parts.push(`근거: ${insight.evidence.length}개`);
    parts.push(`실행 조언: ${insight.actionItems.join(", ")}`);
  }

  // 메타 정보
  parts.push(`\n## 메타 정보`);
  parts.push(`분석 기사 수: ${report.articleCount}개`);
  parts.push(`키워드: ${report.topKeywords.join(", ")}`);

  return parts.join("\n");
}

// ============================================
// 메인 함수: AI 품질 평가 실행
// ============================================

export async function evaluateReportQuality(
  report: DailyReportData
): Promise<QualityEvaluation> {
  const client = getOpenAIClient();

  log("품질 평가 시작...");

  const reportText = formatReportForEvaluation(report);

  const userPrompt = `다음 데일리 리포트의 품질을 평가해주세요.

${reportText}

---

위 리포트를 6가지 기준(구체성, 근거 기반, 논리적 일관성, 친근한 톤, 실용성, 완결성)으로 평가하고,
잘된 점과 개선이 필요한 점을 구체적으로 제시해주세요.`;

  const response = await withRetry(
    () =>
      client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: QUALITY_EVALUATION_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: zodResponseFormat(QualityEvaluationAIResponseSchema, "quality_evaluation"),
        temperature: 0.3,
        max_tokens: 3000,
      }),
    { retries: 2, delay: 1000 }
  );

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI");
  }

  const evaluation = QualityEvaluationAIResponseSchema.parse(JSON.parse(content));

  log(`품질 평가 완료: 종합 점수 ${evaluation.overallScore}/100`);

  return evaluation;
}

// ============================================
// 종합 품질 점수 계산
// ============================================

export function calculateFinalQualityScore(
  qualityEvaluation: QualityEvaluation,
  evidenceScore: number
): number {
  // 품질 평가 60% + 근거 검증 40%
  const aiScore = qualityEvaluation.overallScore;
  const finalScore = aiScore * 0.6 + evidenceScore * 0.4;

  return Math.round(finalScore * 10) / 10;
}
