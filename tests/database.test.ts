import { describe, test, expect, spyOn, mock, beforeEach, afterEach } from "bun:test";
import * as database from "@/services/database.ts";
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

  describe("saveNewsArticlesBatch", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Any = any;
    const articles = [
      { ...sampleArticle, link: "https://example.com/b1" },
      { ...sampleArticle, link: "https://example.com/b2" },
      { ...sampleArticle, link: "https://example.com/b3" },
    ];
    let prismaSpy: { mockRestore: () => void };
    let fake: {
      article: Record<"createMany" | "findMany" | "findUnique" | "create", ReturnType<typeof mock>>;
      $transaction: ReturnType<typeof mock>;
    };

    beforeEach(() => {
      fake = {
        article: {
          createMany: mock(async () => ({ count: 3 })),
          findMany: mock(async () => []),
          findUnique: mock(async () => null),
          create: mock(async (a: Any) => ({ id: 1, ...a.data, createdAt: new Date() })),
        },
        $transaction: mock(async () => []),
      };
      prismaSpy = spyOn(database, "getPrisma").mockImplementation(() => fake as never);
    });
    afterEach(() => {
      prismaSpy.mockRestore();
    });

    test("createMany 를 skipDuplicates:true 로 한 번 부르고 $transaction 은 부르지 않는다", async () => {
      const saved = await database.saveNewsArticlesBatch(articles);

      expect(fake.article.createMany).toHaveBeenCalledTimes(1);
      const args = fake.article.createMany.mock.calls[0]![0] as Any;
      expect(args.skipDuplicates).toBe(true);
      expect(args.data.map((d: Any) => d.link)).toEqual(articles.map((a) => a.link));
      expect(args.data[0].title).toBe("Test Article");
      expect(args.data[0].importanceScore).toBe(8);
      expect(fake.$transaction).not.toHaveBeenCalled();
      expect(fake.article.findMany).not.toHaveBeenCalled(); // 저장 전 getExistingLinks 조회는 없다
      expect(saved).toBe(3);
    });

    test("신규로 저장된 수(count)를 돌려준다 — 중복은 세지 않는다", async () => {
      fake.article.createMany.mockImplementation(async () => ({ count: 1 }));

      expect(await database.saveNewsArticlesBatch(articles)).toBe(1);
    });

    test("빈 배열이면 DB 를 건드리지 않고 0", async () => {
      expect(await database.saveNewsArticlesBatch([])).toBe(0);
      expect(fake.article.createMany).not.toHaveBeenCalled();
    });

    test("createMany 가 throw 하면 개별 저장(saveNewsArticles)으로 폴백한다", async () => {
      fake.article.createMany.mockImplementation(async () => {
        throw new Error("boom");
      });

      const saved = await database.saveNewsArticlesBatch(articles);

      expect(fake.article.createMany).toHaveBeenCalledTimes(1);
      expect(fake.article.findUnique).toHaveBeenCalledTimes(3);
      expect(fake.article.create).toHaveBeenCalledTimes(3);
      expect(fake.$transaction).not.toHaveBeenCalled();
      expect(saved).toBe(3);
    });
  });
});
