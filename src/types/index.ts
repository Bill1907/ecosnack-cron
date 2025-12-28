import type {
  SoWhat,
  ImpactAnalysis,
  RelatedContext,
  Sentiment,
  Category,
} from "@/schemas/news-analysis.ts";

// 뉴스 기사 원본 데이터 (수집 단계)
export interface RawNewsArticle {
  title: string;
  link: string;
  description?: string;
  pubDate?: Date;
  source?: string;
  region?: string;
  imageUrl?: string;
}

// Stage 1: 제목 기반 필터링 결과
export interface TitleFilteredArticle extends RawNewsArticle {
  titleScore: number;
  filterReason: string;
}

// Stage 2: 품질 필터링 결과
export interface QualityFilteredArticle extends TitleFilteredArticle {
  qualityScore: number;
  hasValidImage: boolean;
}

// 분석된 뉴스 데이터 (AI 분석 후)
export interface AnalyzedNewsArticle extends RawNewsArticle {
  headlineSummary?: string;
  soWhat?: SoWhat;
  impactAnalysis?: ImpactAnalysis;
  relatedContext?: RelatedContext;
  keywords?: string[];
  category?: Category;
  sentiment?: Sentiment;
  importanceScore?: number;
}

// DB에 저장된 뉴스 데이터 (articles 테이블 스키마)
export interface NewsRecord {
  id: number;
  title: string;
  link: string;
  description?: string | null;
  pubDate?: Date | null;
  source?: string | null;
  region?: string | null;
  imageUrl?: string | null;
  headlineSummary?: string | null;
  soWhat?: SoWhat | null;
  impactAnalysis?: ImpactAnalysis | null;
  relatedContext?: RelatedContext | null;
  keywords?: string[] | null;
  category?: Category | null;
  sentiment?: Sentiment | null;
  importanceScore?: number | null;
  createdAt: Date;
}

// 뉴스 수집 결과
export interface FetchResult {
  success: boolean;
  articles: RawNewsArticle[];
  error?: string;
}

// 분석 결과
export interface AnalysisResult {
  success: boolean;
  articles: AnalyzedNewsArticle[];
  error?: string;
}

// OpenAI 응답 타입 (필터링용)
export interface TitleFilterResponse {
  articles: Array<{
    index: number;
    score: number;
    reason: string;
  }>;
}

export interface QualityFilterResponse {
  articles: Array<{
    index: number;
    score: number;
    reason: string;
  }>;
}

// Re-export schema types
export type { SoWhat, ImpactAnalysis, RelatedContext, Sentiment, Category };
