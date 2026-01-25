import { z } from "zod";

// ============================================
// 품질 평가 기준 (AI Self-Evaluation)
// ============================================

export const QualityCriterionSchema = z.object({
  score: z.number().min(0).max(10).describe("점수 (0-10)"),
  feedback: z.string().min(20).describe("피드백 및 개선점"),
});

export const QualityEvaluationSchema = z.object({
  // 6가지 평가 기준
  criteria: z.object({
    specificity: QualityCriterionSchema.describe("구체성: 추상적 표현 대신 구체적 수치/사례 포함"),
    evidenceBased: QualityCriterionSchema.describe("근거 기반: 모든 주장이 기사 데이터에 기반"),
    logicalConsistency: QualityCriterionSchema.describe("논리적 일관성: 분석 흐름이 논리적이고 일관"),
    friendlyTone: QualityCriterionSchema.describe("친근한 톤: 경제 비전문가도 이해하기 쉬운 설명"),
    practicality: QualityCriterionSchema.describe("실용성: 실행 가능한 조언과 인사이트 제공"),
    completeness: QualityCriterionSchema.describe("완결성: 모든 섹션이 충분한 깊이로 작성"),
  }),
  overallScore: z.number().min(0).max(100).describe("종합 점수 (0-100)"),
  strengths: z.array(z.string()).min(1).describe("잘된 점"),
  improvements: z.array(z.string()).min(1).describe("개선이 필요한 점"),
  summary: z.string().min(50).describe("종합 평가 요약"),
});

export type QualityCriterion = z.infer<typeof QualityCriterionSchema>;
export type QualityEvaluation = z.infer<typeof QualityEvaluationSchema>;

// ============================================
// 근거 검증 결과
// ============================================

export const EvidenceValidationItemSchema = z.object({
  evidenceText: z.string(),
  articleId: z.number().nullable(),
  isValid: z.boolean(),
  reason: z.string(),
  relevanceScore: z.number().min(0).max(10).optional(),
});

export const EvidenceValidationSchema = z.object({
  totalEvidences: z.number(),
  validCount: z.number(),
  invalidCount: z.number(),
  validationRate: z.number().min(0).max(100),
  details: z.array(EvidenceValidationItemSchema),
  summary: z.string(),
});

export type EvidenceValidationItem = z.infer<typeof EvidenceValidationItemSchema>;
export type EvidenceValidation = z.infer<typeof EvidenceValidationSchema>;

// ============================================
// AI 평가 응답 스키마 (API 호출용)
// ============================================

export const QualityEvaluationAIResponseSchema = QualityEvaluationSchema;

export const EvidenceRelevanceAIResponseSchema = z.object({
  relevanceScore: z.number().min(0).max(10).describe("관련성 점수 (0-10)"),
  reasoning: z.string().describe("관련성 판단 이유"),
});

export type QualityEvaluationAIResponse = z.infer<typeof QualityEvaluationAIResponseSchema>;
export type EvidenceRelevanceAIResponse = z.infer<typeof EvidenceRelevanceAIResponseSchema>;
