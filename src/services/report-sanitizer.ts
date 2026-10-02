import type { DailyReportAIResponse } from "@/schemas/daily-report.ts";
import { sanitizeMetaComments, stripArticleRefs } from "@/utils/index.ts";

// ============================================
// 리포트 본문 정리
// - 글자 수 같은 메타 코멘트 제거
// - 본문에 새는 기사 ID 인용 제거 (ID 는 지정 JSON 필드에만)
// ============================================

const clean = (text: string) => stripArticleRefs(sanitizeMetaComments(text));

export function sanitizeReportText(response: DailyReportAIResponse): DailyReportAIResponse {
  return {
    ...response,
    title: clean(response.title),
    topKeywords: response.topKeywords.map(clean),
    executiveSummary: {
      ...response.executiveSummary,
      headline: clean(response.executiveSummary.headline),
      overview: clean(response.executiveSummary.overview),
      highlights: response.executiveSummary.highlights.map((h) => ({
        ...h,
        title: clean(h.title),
        description: clean(h.description),
      })),
      sentiment: {
        ...response.executiveSummary.sentiment,
        description: clean(response.executiveSummary.sentiment.description),
      },
    },
    marketOverview: {
      ...response.marketOverview,
      summary: clean(response.marketOverview.summary),
      sections: response.marketOverview.sections.map((s) => ({
        ...s,
        title: clean(s.title),
        content: clean(s.content),
        keyData: s.keyData.map(clean),
      })),
      outlook: clean(response.marketOverview.outlook),
      watchList: response.marketOverview.watchList.map(clean),
    },
    keyInsights: response.keyInsights.map((insight) => ({
      ...insight,
      title: clean(insight.title),
      summary: clean(insight.summary),
      analysis: clean(insight.analysis),
      implications: {
        investors: clean(insight.implications.investors),
        workers: clean(insight.implications.workers),
        consumers: clean(insight.implications.consumers),
      },
      actionItems: insight.actionItems.map(clean),
      evidence: insight.evidence.map((e) => ({ ...e, text: clean(e.text) })),
    })),
  };
}
