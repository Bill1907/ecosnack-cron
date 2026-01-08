import { z } from "zod";

// ============================================
// 뉴스 분석 결과 Zod 스키마
// ============================================

// So What 분석
export const SoWhatSchema = z.object({
  main_point: z
    .string()
    .min(200)
    .describe("이 뉴스가 중요한 이유 (5-7문장, 친근한 톤). 반드시 1개 이상의 실생활 비유/예시 포함. 독자가 '그래서 나한테 뭔 영향이지?'에 답하는 내용"),
  market_signal: z
    .string()
    .min(120)
    .describe("시장에 주는 시그널 (긍정/부정/중립 + 쉬운 설명). 구체적 근거와 영향 경로를 친근하게 설명"),
  time_horizon: z
    .enum(["short", "medium", "long"])
    .describe("단기(1주)/중기(1-3개월)/장기(1년+) 영향 구분"),
});

// 투자자 영향 분석
export const InvestorImpactSchema = z.object({
  summary: z
    .string()
    .min(150)
    .describe("투자자에게 미치는 영향 요약 (4-5문장, 친근한 톤). 실생활 비유 1개 이상, 구체적 수치/기간 포함 권장"),
  action_items: z.array(z.string()).describe("구체적 대응 방안 (친근한 제안 형태: ~해보세요, ~고려해보시는 건 어떨까요)"),
  sectors_affected: z.array(z.string()).describe("영향받는 섹터/종목 (수혜/타격 구분, 각각 이유 간략 설명)"),
});

// 직장인/노동자 영향 분석
export const WorkerImpactSchema = z.object({
  summary: z
    .string()
    .min(150)
    .describe("직장인/노동자에게 미치는 영향 (4-5문장, 공감하는 톤). 실제 직장인 관점의 예시 포함"),
  industries_affected: z.array(z.string()).describe("영향받는 산업군 (긍정/부정 구분, 각각 구체적 영향 설명)"),
  job_outlook: z
    .string()
    .min(80)
    .describe("고용 전망 변화 (희망적 부분도 언급, 구체적 기간/조언 포함)"),
});

// 소비자 영향 분석
export const ConsumerImpactSchema = z.object({
  summary: z
    .string()
    .min(150)
    .describe("소비자에게 미치는 영향 (4-5문장). 장보기, 외식, 쇼핑 등 일상 상황 예시 1개 이상 포함"),
  price_impact: z
    .string()
    .min(80)
    .describe("물가/생활비 영향 (구체적 품목/상황 예시 포함, 예: 마트 장보기, 휘발유값 등)"),
  spending_advice: z
    .string()
    .min(80)
    .describe("소비 관련 조언 (구체적이고 실행 가능한 제안 2개 이상: ~해보세요, ~추천드려요)"),
});

// 전체 영향 분석
export const ImpactAnalysisSchema = z.object({
  investors: InvestorImpactSchema,
  workers: WorkerImpactSchema,
  consumers: ConsumerImpactSchema,
});

// 관련 컨텍스트
export const RelatedContextSchema = z.object({
  background: z
    .string()
    .min(150)
    .describe("이 뉴스의 배경/맥락 설명 (4-5문장). 역사적 맥락이나 트렌드를 비유로 쉽게 설명"),
  related_events: z.array(z.string()).describe("연관된 최근 이슈들 (각 이슈가 왜 관련있는지 간략 설명)"),
  what_to_watch: z
    .string()
    .min(100)
    .describe("앞으로 주목할 후속 이벤트 (구체적 시점/날짜 명시, 뉴스 챙겨보시라는 조언 포함)"),
});

// 감성 분석
export const SentimentSchema = z.object({
  overall: z
    .enum(["positive", "negative", "neutral", "mixed"])
    .describe("전반적 감성"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("신뢰도 (0.0-1.0)"),
});

// 카테고리
export const CategorySchema = z
  .enum(["economy", "finance", "business", "markets", "policy", "trade"])
  .describe("뉴스 카테고리");

// ============================================
// 전체 분석 결과 스키마
// ============================================

export const NewsAnalysisResultSchema = z.object({
  headline_summary: z
    .string()
    .min(150)
    .describe("4-5문장으로 핵심 요약 (친근한 톤). 무엇이 일어났는지 + 왜 중요한지 + 예상 영향을 독자에게 말 걸듯이 작성"),
  so_what: SoWhatSchema,
  impact_analysis: ImpactAnalysisSchema,
  related_context: RelatedContextSchema,
  keywords: z
    .array(z.string())
    .min(3)
    .max(7)
    .describe("핵심 키워드 3-7개"),
  category: CategorySchema,
  sentiment: SentimentSchema,
  importance_score: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("중요도 점수 (1-10)"),
});;

// ============================================
// 필터링 응답 스키마
// ============================================

// 제목 필터링 응답
export const TitleFilterItemSchema = z.object({
  index: z.number().int().min(0),
  score: z.number().min(0).max(100),
  reason: z.string(),
});

export const TitleFilterResponseSchema = z.object({
  articles: z.array(TitleFilterItemSchema),
});

// 품질 필터링 응답
export const QualityFilterItemSchema = z.object({
  index: z.number().int().min(0),
  score: z.number().min(0).max(100),
  reason: z.string().optional(),
});

export const QualityFilterResponseSchema = z.object({
  articles: z.array(QualityFilterItemSchema),
});

// 타입 추출
export type TitleFilterItem = z.infer<typeof TitleFilterItemSchema>;
export type TitleFilterResponse = z.infer<typeof TitleFilterResponseSchema>;
export type QualityFilterItem = z.infer<typeof QualityFilterItemSchema>;
export type QualityFilterResponse = z.infer<typeof QualityFilterResponseSchema>;
export type SoWhat = z.infer<typeof SoWhatSchema>;
export type InvestorImpact = z.infer<typeof InvestorImpactSchema>;
export type WorkerImpact = z.infer<typeof WorkerImpactSchema>;
export type ConsumerImpact = z.infer<typeof ConsumerImpactSchema>;
export type ImpactAnalysis = z.infer<typeof ImpactAnalysisSchema>;
export type RelatedContext = z.infer<typeof RelatedContextSchema>;
export type Sentiment = z.infer<typeof SentimentSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type NewsAnalysisResult = z.infer<typeof NewsAnalysisResultSchema>;
