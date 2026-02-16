import { z } from "zod";
import {
  ExecutiveSummarySchema,
  MarketOverviewSchema,
  KeyInsightSchema,
} from "@/schemas/daily-report.ts";

// ============================================
// 개인화 데일리 리포트 Zod 스키마
// ============================================

// 개인화 컨텍스트 (AI 프롬프트에 전달)
export const PersonalizationContextSchema = z.object({
  userId: z.string(),
  preferredCategories: z.array(z.string()),
  preferredKeywords: z.array(z.string()),
  sentimentBias: z.enum(["positive", "negative", "neutral", "mixed"]).nullable(),
});

// AI 응답용 개인화 리포트 스키마 (기존과 동일 구조)
export const PersonalizedReportAIResponseSchema = z.object({
  title: z.string().min(10).describe("사용자 맞춤형 리포트 제목"),
  executiveSummary: ExecutiveSummarySchema,
  marketOverview: MarketOverviewSchema,
  keyInsights: z.array(KeyInsightSchema).min(2).max(5),
  topKeywords: z.array(z.string()).min(3).max(10),
});

// ============================================
// 타입 추출
// ============================================

export type PersonalizationContext = z.infer<typeof PersonalizationContextSchema>;
export type PersonalizedReportAIResponse = z.infer<typeof PersonalizedReportAIResponseSchema>;
