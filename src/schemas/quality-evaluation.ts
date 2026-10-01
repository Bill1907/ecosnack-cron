import { z } from "zod";

// ============================================
// 품질 평가 (Jev Score, 기준별 0-10)
// ============================================

export const QualityCriterionSchema = z.object({
  score: z.number().min(0).max(10).describe("점수 (0-10)"),
  confidence: z.number().min(0).max(1).describe("판정 확신도 (Jev)"),
});

export const QualityEvaluationSchema = z.object({
  criteria: z.object({
    specificity: QualityCriterionSchema,
    evidenceBased: QualityCriterionSchema,
    logicalConsistency: QualityCriterionSchema,
    friendlyTone: QualityCriterionSchema,
    practicality: QualityCriterionSchema,
    completeness: QualityCriterionSchema,
  }),
  overallScore: z.number().min(0).max(100).describe("기준 평균 × 10 (코드 계산)"),
  judge: z.string().describe("판정한 모델 버전"),
});

export type QualityCriterion = z.infer<typeof QualityCriterionSchema>;
export type QualityEvaluation = z.infer<typeof QualityEvaluationSchema>;
export type QualityCriterionKey = keyof QualityEvaluation["criteria"];

// ============================================
// 근거 검증 결과
// ============================================

export const EVIDENCE_STATUSES = [
  "supports", // 기사가 근거를 뒷받침
  "contradicts", // 같은 주제지만 수치/방향/사실이 맞지 않음
  "unrelated", // 기사가 근거 내용을 다루지 않음
  "invalid_id", // 리포트 기사 목록에 없는 ID
  "unverified", // 기사 ID 없음 또는 판정 실패 — 점수 계산에서 제외
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EvidenceValidationItemSchema = z.object({
  evidenceText: z.string(),
  articleId: z.number().nullable(),
  status: z.enum(EVIDENCE_STATUSES),
  isValid: z.boolean(), // status === "supports"
  reason: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  judge: z.string().optional(),
});

export const EvidenceValidationSchema = z.object({
  totalEvidences: z.number(),
  validCount: z.number(),
  invalidCount: z.number(),
  unverifiedCount: z.number(),
  validationRate: z.number().min(0).max(100), // valid / (valid + invalid)
  details: z.array(EvidenceValidationItemSchema),
  summary: z.string(),
});

export type EvidenceValidationItem = z.infer<typeof EvidenceValidationItemSchema>;
export type EvidenceValidation = z.infer<typeof EvidenceValidationSchema>;

// ============================================
// LLM 재판정 응답 (Jev 확신도가 낮을 때)
// ============================================

export const EvidenceVerdictSchema = z.object({
  verdict: z.enum(["supports", "contradicts", "unrelated"]),
});
export type EvidenceVerdict = z.infer<typeof EvidenceVerdictSchema>;
