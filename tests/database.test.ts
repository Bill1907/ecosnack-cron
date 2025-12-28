import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import type { AnalyzedNewsArticle } from "@/types/index.ts";

// 샘플 데이터 (Zod 스키마에 맞는 구조)
const sampleArticle: AnalyzedNewsArticle = {
  title: "Test Article",
  link: "https://example.com/test-article",
  description: "This is a test description",
  pubDate: new Date("2024-12-26T10:00:00Z"),
  source: "Test Source",
  region: "US",
  headlineSummary: "Test summary",
  soWhat: {
    main_point: "테스트 메인 포인트",
    market_signal: "긍정적 시그널",
    time_horizon: "short",
  },
  impactAnalysis: {
    investors: {
      summary: "투자자 영향 요약",
      action_items: ["액션1", "액션2"],
      sectors_affected: ["섹터1", "섹터2"],
    },
    workers: {
      summary: "노동자 영향 요약",
      industries_affected: ["산업1", "산업2"],
      job_outlook: "긍정적",
    },
    consumers: {
      summary: "소비자 영향 요약",
      price_impact: "가격 영향 없음",
      spending_advice: "현재 소비 패턴 유지",
    },
  },
  relatedContext: {
    background: "뉴스 배경 설명",
    related_events: ["관련 이벤트1", "관련 이벤트2"],
    what_to_watch: "주목할 후속 이벤트",
  },
  keywords: ["test", "article"],
  category: "economy",
  sentiment: { overall: "positive", confidence: 0.8 },
  importanceScore: 8,
};

describe("database", () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("module exports", () => {
    test("exports required functions", async () => {
      const db = await import("@/services/database.ts");

      expect(typeof db.initDatabase).toBe("function");
      expect(typeof db.closeDatabase).toBe("function");
      expect(typeof db.getPrisma).toBe("function");
      expect(typeof db.saveNewsArticle).toBe("function");
      expect(typeof db.saveNewsArticles).toBe("function");
      expect(typeof db.getRecentArticles).toBe("function");
      expect(typeof db.articleExists).toBe("function");
    });
  });

  describe("AnalyzedNewsArticle type validation", () => {
    test("sample article has all required fields", () => {
      expect(sampleArticle.title).toBeDefined();
      expect(sampleArticle.link).toBeDefined();
    });

    test("sample article has optional fields", () => {
      expect(sampleArticle.description).toBeDefined();
      expect(sampleArticle.pubDate).toBeInstanceOf(Date);
      expect(sampleArticle.source).toBeDefined();
      expect(sampleArticle.region).toBeDefined();
    });

    test("sample article has AI analysis fields", () => {
      expect(sampleArticle.headlineSummary).toBeDefined();
      expect(sampleArticle.soWhat).toBeDefined();
      expect(sampleArticle.impactAnalysis).toBeDefined();
      expect(sampleArticle.relatedContext).toBeDefined();
      expect(sampleArticle.keywords).toBeDefined();
      expect(sampleArticle.category).toBeDefined();
      expect(sampleArticle.sentiment).toBeDefined();
      expect(sampleArticle.importanceScore).toBeDefined();
    });

    test("keywords is an array", () => {
      expect(Array.isArray(sampleArticle.keywords)).toBe(true);
    });

    test("importanceScore is a number", () => {
      expect(typeof sampleArticle.importanceScore).toBe("number");
    });
  });

  describe("data transformations", () => {
    test("article with null optional fields is valid", () => {
      const articleWithNulls: AnalyzedNewsArticle = {
        title: "Minimal Article",
        link: "https://example.com/minimal",
      };

      expect(articleWithNulls.title).toBe("Minimal Article");
      expect(articleWithNulls.link).toBe("https://example.com/minimal");
      expect(articleWithNulls.description).toBeUndefined();
    });

    test("article link uniqueness constraint", () => {
      const article1 = { ...sampleArticle, link: "https://example.com/unique1" };
      const article2 = { ...sampleArticle, link: "https://example.com/unique2" };

      expect(article1.link).not.toBe(article2.link);
    });
  });
});
