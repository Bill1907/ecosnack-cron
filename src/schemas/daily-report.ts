import { z } from "zod";

// ============================================
// 데일리 리포트 Zod 스키마
// ============================================

// 관련 기사 스키마
export const RelatedArticleSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  url: z.string().url(),
  importance: z.number().int().min(1).max(10),
});

// 근거 아이템 스키마
export const EvidenceItemSchema = z.object({
  text: z.string().min(10).describe("근거 설명"),
  articleId: z.number().int().positive().nullable().describe("관련 기사 ID (없으면 null)"),
  articleUrl: z.string().url().nullable().describe("기사 URL (없으면 null)"),
  source: z.string().nullable().describe("외부 출처 (없으면 null)"),
});

// ============================================
// 1. Executive Summary 스키마
// ============================================

export const HighlightSchema = z.object({
  title: z.string().min(5).describe("하이라이트 제목"),
  description: z.string().min(100).describe("하이라이트 설명 (100자 이상, 친근한 톤)"),
  relatedArticleId: z.number().int().positive().describe("관련 기사 ID"),
});

export const ExecutiveSummarySentimentSchema = z.object({
  overall: z.enum(["positive", "negative", "neutral", "mixed"]),
  description: z.string().min(80).describe("시장 분위기 설명 (80자 이상)"),
});

export const ExecutiveSummarySchema = z.object({
  headline: z.string().min(10).max(60).describe("한줄 헤드라인 (50자 이내)"),
  overview: z.string().min(600).describe("종합 요약 (600자 이상). 오늘 경제 뉴스의 핵심을 친근하게 설명"),
  highlights: z.array(HighlightSchema).min(3).max(5).describe("오늘의 하이라이트 3-5개"),
  sentiment: ExecutiveSummarySentimentSchema,
});

// ============================================
// 2. Market Overview 스키마
// ============================================

export const MarketSectionSchema = z.object({
  title: z.string().min(2).describe("섹션 제목 (예: 국내 증시, 글로벌 금융)"),
  content: z.string().min(300).describe("상세 분석 (300자 이상)"),
  keyData: z.array(z.string()).min(1).describe("핵심 수치/데이터"),
  relatedArticleIds: z.array(z.number().int().positive()).describe("관련 기사 ID 목록"),
});

export const MarketOverviewSchema = z.object({
  summary: z.string().min(400).describe("시장 전반 요약 (400자 이상)"),
  sections: z.array(MarketSectionSchema).min(2).max(5).describe("분야별 상세 분석 (2-5개)"),
  outlook: z.string().min(200).describe("향후 전망 (200자 이상)"),
  watchList: z.array(z.string()).min(2).describe("주목할 이벤트/지표"),
});

// ============================================
// 3. Key Insights 스키마
// ============================================

export const ImplicationsSchema = z.object({
  investors: z.string().min(100).describe("투자자 영향 (100자 이상)"),
  workers: z.string().min(100).describe("직장인 영향 (100자 이상)"),
  consumers: z.string().min(100).describe("소비자 영향 (100자 이상)"),
});

export const KeyInsightEvidenceSchema = z.object({
  text: z.string().min(10).describe("근거 설명"),
  articleId: z.number().int().positive().nullable().describe("관련 기사 ID (없으면 null)"),
  source: z.string().nullable().describe("외부 출처 (없으면 null)"),
});

export const KeyInsightSchema = z.object({
  title: z.string().min(5).describe("인사이트 제목"),
  summary: z.string().min(150).describe("요약 (150자 이상)"),
  analysis: z.string().min(400).describe("심층 분석 (400자 이상)"),
  implications: ImplicationsSchema,
  evidence: z.array(KeyInsightEvidenceSchema).min(2).describe("근거 (2개 이상)"),
  relatedArticleIds: z.array(z.number().int().positive()).describe("관련 기사 ID 목록"),
  actionItems: z.array(z.string()).min(1).max(3).describe("실행 가능한 조언 1-3개"),
  impact: z.enum(["high", "medium", "low"]).describe("영향도"),
  timeHorizon: z.enum(["short", "medium", "long"]).describe("영향 기간"),
});

// ============================================
// 감성 분석 스키마
// ============================================

export const ReportSentimentAnalysisSchema = z.object({
  overall: z.enum(["positive", "negative", "neutral", "mixed"]),
  positiveCount: z.number().int().min(0),
  negativeCount: z.number().int().min(0),
  neutralCount: z.number().int().min(0),
});

// ============================================
// AI 응답용 전체 스키마
// ============================================

export const DailyReportAIResponseSchema = z.object({
  title: z.string().min(10).describe("리포트 제목 (예: 2024년 1월 21일 경제 브리핑)"),
  executiveSummary: ExecutiveSummarySchema,
  marketOverview: MarketOverviewSchema,
  keyInsights: z.array(KeyInsightSchema).min(2).max(5).describe("핵심 인사이트 2-5개"),
  topKeywords: z.array(z.string()).min(3).max(10).describe("핵심 키워드 3-10개"),
});

// ============================================
// 타입 추출
// ============================================

export type RelatedArticleInput = z.infer<typeof RelatedArticleSchema>;
export type EvidenceItemInput = z.infer<typeof EvidenceItemSchema>;
export type HighlightInput = z.infer<typeof HighlightSchema>;
export type ExecutiveSummaryInput = z.infer<typeof ExecutiveSummarySchema>;
export type MarketSectionInput = z.infer<typeof MarketSectionSchema>;
export type MarketOverviewInput = z.infer<typeof MarketOverviewSchema>;
export type ImplicationsInput = z.infer<typeof ImplicationsSchema>;
export type KeyInsightInput = z.infer<typeof KeyInsightSchema>;
export type ReportSentimentAnalysisInput = z.infer<typeof ReportSentimentAnalysisSchema>;
export type DailyReportAIResponse = z.infer<typeof DailyReportAIResponseSchema>;
