// ============================================
// 데일리 리포트 타입 정의
// ============================================

import type { QualityEvaluation, EvidenceValidation } from "@/schemas/quality-evaluation.ts";

// 기사 URL 베이스
export const ARTICLE_BASE_URL = "https://heyvoan.com/article";

// 관련 기사 (링크 포함)
export interface RelatedArticle {
  id: number;
  title: string;
  url: string; // heyvoan.com/article/{id}
  importance: number; // 1-10
}

// 근거 아이템 (기사 링크 포함)
export interface EvidenceItem {
  text: string; // 근거 설명
  articleId?: number; // 관련 기사 ID (있는 경우)
  articleUrl?: string; // heyvoan.com/article/{id} 형태
  source?: string; // 외부 출처 (기사 외 데이터인 경우)
}

// ============================================
// 1. Executive Summary (오늘의 핵심 요약)
// ============================================
export interface ExecutiveSummary {
  headline: string; // 한줄 헤드라인 (50자 이내)
  overview: string; // 종합 요약 (800자 이상)

  highlights: {
    // 오늘의 하이라이트 3-5개
    title: string;
    description: string; // 150자 이상
    relatedArticle: RelatedArticle;
  }[];

  sentiment: {
    overall: "positive" | "negative" | "neutral" | "mixed";
    description: string; // 시장 분위기 설명 (100자 이상)
  };
}

// ============================================
// 2. Market Overview (시장 동향 상세 분석)
// ============================================
export interface MarketSection {
  title: string; // 예: "국내 증시", "글로벌 금융"
  content: string; // 상세 분석 (400자 이상)
  keyData: string[]; // 핵심 수치/데이터
  relatedArticles: RelatedArticle[];
}

export interface MarketOverview {
  summary: string; // 시장 전반 요약 (500자 이상)
  sections: MarketSection[]; // 분야별 상세 분석 (3-5개)
  outlook: string; // 향후 전망 (300자 이상)
  watchList: string[]; // 주목할 이벤트/지표
}

// ============================================
// 3. Key Insights (핵심 인사이트)
// ============================================
export interface KeyInsight {
  title: string; // 인사이트 제목
  summary: string; // 요약 (200자 이상)
  analysis: string; // 심층 분석 (600자 이상)

  // 누구에게 어떤 영향?
  implications: {
    investors: string; // 투자자 영향 (150자 이상)
    workers: string; // 직장인 영향 (150자 이상)
    consumers: string; // 소비자 영향 (150자 이상)
  };

  evidence: EvidenceItem[]; // 근거 + 기사 링크 (3개 이상)
  relatedArticles: RelatedArticle[];

  actionItems: string[]; // 실행 가능한 조언 2-3개
  impact: "high" | "medium" | "low";
  timeHorizon: "short" | "medium" | "long";
}

// ============================================
// 감성 분석 결과
// ============================================
export interface ReportSentimentAnalysis {
  overall: "positive" | "negative" | "neutral" | "mixed";
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
}

// ============================================
// 전체 리포트 타입
// ============================================
export interface DailyReportData {
  reportDate: Date;
  title: string;

  executiveSummary: ExecutiveSummary;
  marketOverview: MarketOverview;
  keyInsights: KeyInsight[]; // 3-5개 핵심 인사이트

  topKeywords: string[];
  sentimentAnalysis: ReportSentimentAnalysis;

  articleCount: number;
  articleIds: number[];

  // 품질 평가 (선택적)
  qualityEvaluation?: QualityEvaluation;
  evidenceValidation?: EvidenceValidation;
  qualityScore?: number;
}

// ============================================
// DB 저장용 레코드 타입
// ============================================
export interface DailyReportRecord extends DailyReportData {
  id: number;
  createdAt: Date;
}

// ============================================
// 헬퍼 함수
// ============================================
export function buildArticleUrl(articleId: number): string {
  return `${ARTICLE_BASE_URL}/${articleId}`;
}

export function buildRelatedArticle(
  id: number,
  title: string,
  importance: number = 5
): RelatedArticle {
  return {
    id,
    title,
    url: buildArticleUrl(id),
    importance,
  };
}
