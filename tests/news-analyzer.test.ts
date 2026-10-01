import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test";
import { analyzeNews, MIN_STAGE3_SUCCESS_RATE } from "@/services/news-analyzer.ts";
import * as database from "@/services/database.ts";
import * as openaiClient from "@/services/openai-client.ts";
import * as scoring from "@/services/article-scoring.ts";
import * as promptBuilder from "@/services/prompt-builder.ts";
import type { RawNewsArticle } from "@/types/index.ts";
import type { NewsAnalysisResult } from "@/schemas/news-analysis.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetch = (impl: (url: string) => Promise<any>): typeof fetch =>
  mock((input: string | URL | Request) => impl(String(input))) as unknown as typeof fetch;

const createMockArticles = (count: number): RawNewsArticle[] =>
  Array.from({ length: count }, (_, i) => ({
    title: `Test Article ${i + 1}: Economic News About Market ${i + 1}`,
    link: `https://example.com/article-${i + 1}`,
    description: `This is a detailed description for article ${i + 1} about economic developments.`,
    pubDate: new Date("2024-12-26"),
    source: i % 2 === 0 ? "CNBC" : "매일경제",
    region: i % 2 === 0 ? "US" : "KR",
  }));

const html = (head: string, body = "") => `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;
const OG = html('<meta property="og:image" content="https://cdn.example.com/image.jpg" />');
const TWITTER = html('<meta name="twitter:image" content="https://twitter.example.com/image.png" />');
const ARTICLE_IMG = html("", '<article><img src="https://example.com/article-img.jpg" /></article>');
const RELATIVE = html('<meta property="og:image" content="/images/relative.jpg" />');
const PROTOCOL_RELATIVE = html('<meta property="og:image" content="//cdn.example.com/protocol-relative.jpg" />');
const NO_IMAGE = html("<title>No Image</title>", "<p>text</p>");

const fakeAnalysis = (n = 7): NewsAnalysisResult => ({
  headline_summary: "요약 ".repeat(40),
  so_what: { main_point: "핵심 ".repeat(80), market_signal: "신호 ".repeat(50), time_horizon: "short" },
  impact_analysis: {
    investors: { summary: "투자 ".repeat(60), action_items: ["a"], sectors_affected: ["s"] },
    workers: { summary: "직장 ".repeat(60), industries_affected: ["i"], job_outlook: "고용 ".repeat(30) },
    consumers: { summary: "소비 ".repeat(60), price_impact: "물가 ".repeat(30), spending_advice: "조언 ".repeat(30) },
  },
  related_context: { background: "배경 ".repeat(60), related_events: ["e"], what_to_watch: "주목 ".repeat(40) },
  keywords: ["금리", "환율", "증시"],
  category: "markets",
  sentiment: { overall: "neutral", confidence: 0.7 },
  importance_score: n,
});

describe("news-analyzer", () => {
  let originalFetch: typeof globalThis.fetch;
  const spies: { mockRestore: () => void }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createStructuredSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let headlineSpy: any;

  beforeEach(() => {
    spies.push(spyOn(console, "log").mockImplementation(() => {}));
    originalFetch = globalThis.fetch;
    spies.push(spyOn(database, "getExistingLinks").mockImplementation(async () => new Set<string>()));
    spies.push(
      spyOn(promptBuilder, "buildAnalysisPrompt").mockImplementation(
        async () => ({ system: "s", user: "u" }) as Awaited<ReturnType<typeof promptBuilder.buildAnalysisPrompt>>
      )
    );
    headlineSpy = spyOn(scoring, "scoreHeadlines").mockImplementation(async (items) => items.map((_, i) => 100 - i));
    spies.push(headlineSpy);
    spies.push(spyOn(scoring, "scoreQuality").mockImplementation(async (items) => items.map(() => 70)));
    createStructuredSpy = spyOn(openaiClient, "createStructured").mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async () => fakeAnalysis()) as any
    );
    spies.push(createStructuredSpy);
    globalThis.fetch = mockFetch(() => Promise.resolve(new Response(OG, { status: 200 })));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    while (spies.length) spies.pop()!.mockRestore();
  });

  describe("기본 동작", () => {
    test("빈 배열 입력시 빈 결과 반환", async () => {
      expect(await analyzeNews([])).toEqual({ success: true, articles: [] });
    });

    test("원본 기사 속성 보존 + 분석 필드 채움", async () => {
      const [a] = createMockArticles(1);
      const result = await analyzeNews([a!]);
      const analyzed = result.articles[0];
      expect(result.success).toBe(true);
      expect(analyzed?.title).toBe(a!.title);
      expect(analyzed?.link).toBe(a!.link);
      expect(analyzed?.description).toBe(a!.description);
      expect(analyzed?.source).toBe(a!.source);
      expect(analyzed?.region).toBe(a!.region);
      expect(analyzed?.importanceScore).toBe(7);
      expect(analyzed?.keywords).toEqual(["금리", "환율", "증시"]);
      expect(analyzed?.category).toBe("markets");
    });

    test("이미 DB에 있는 기사는 분석하지 않는다", async () => {
      spies.push(spyOn(database, "getExistingLinks").mockImplementation(async (links: string[]) => new Set(links)));
      const result = await analyzeNews(createMockArticles(3));
      expect(result).toEqual({ success: true, articles: [] });
      expect(createStructuredSpy).not.toHaveBeenCalled();
    });
  });

  describe("Stage 1/2 필터링", () => {
    test("30개 이하면 제목 점수를 매기지 않는다", async () => {
      const result = await analyzeNews(createMockArticles(25));
      expect(headlineSpy).not.toHaveBeenCalled();
      expect(result.articles.length).toBe(20);
    });

    test("50개 → 30개(제목) → 20개(품질)", async () => {
      const result = await analyzeNews(createMockArticles(50));
      expect(headlineSpy).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.articles.length).toBe(20);
    });

    test("제목 점수 상위 기사가 남는다", async () => {
      headlineSpy.mockImplementation(async (items: unknown[]) => items.map((_, i) => i)); // 뒤쪽일수록 높게
      const result = await analyzeNews(createMockArticles(40));
      const ids = result.articles.map((a) => Number(a.link.split("-").pop()));
      expect(Math.min(...ids)).toBeGreaterThan(10);
    });

    test("이미지 있는 기사를 우선 선택", async () => {
      globalThis.fetch = mockFetch((url) => {
        const n = Number(url.split("-").pop());
        return Promise.resolve(new Response(n % 2 === 0 ? OG : NO_IMAGE, { status: 200 }));
      });
      const result = await analyzeNews(createMockArticles(25));
      expect(result.articles.filter((a) => a.imageUrl).length).toBe(12); // 짝수 12개 전부
      expect(result.articles.length).toBe(20);
    });

    test("점수 서비스가 실패하면 분석 실패로 끝난다 (조용히 50점 주지 않음)", async () => {
      headlineSpy.mockImplementation(async () => {
        throw new Error("Jev, LLM 모두 실패");
      });
      const result = await analyzeNews(createMockArticles(40));
      expect(result.success).toBe(false);
      expect(result.error).toContain("모두 실패");
      expect(createStructuredSpy).not.toHaveBeenCalled();
    });
  });

  describe("이미지 추출", () => {
    const cases: [string, string, string | undefined][] = [
      ["og:image", OG, "https://cdn.example.com/image.jpg"],
      ["twitter:image", TWITTER, "https://twitter.example.com/image.png"],
      ["article img", ARTICLE_IMG, "https://example.com/article-img.jpg"],
      ["상대 경로", RELATIVE, "https://example.com/images/relative.jpg"],
      ["프로토콜 상대 경로", PROTOCOL_RELATIVE, "https://cdn.example.com/protocol-relative.jpg"],
      ["이미지 없음", NO_IMAGE, undefined],
    ];
    for (const [name, page, expected] of cases) {
      test(name, async () => {
        globalThis.fetch = mockFetch(() => Promise.resolve(new Response(page, { status: 200 })));
        const result = await analyzeNews([{ title: name, link: "https://example.com/x" }]);
        expect(result.articles[0]?.imageUrl).toBe(expected);
      });
    }

    test("네트워크 오류여도 분석은 계속", async () => {
      globalThis.fetch = mockFetch(() => Promise.reject(new Error("Network error")));
      const result = await analyzeNews([{ title: "t", link: "https://example.com/n" }]);
      expect(result.success).toBe(true);
      expect(result.articles[0]?.imageUrl).toBeUndefined();
    });
  });

  describe("Stage 3 성공률 가드", () => {
    test(`성공률이 ${MIN_STAGE3_SUCCESS_RATE * 100}% 미만이면 success=false, 성공분은 반환`, async () => {
      let n = 0;
      createStructuredSpy.mockImplementation(async () => {
        n++;
        if (n % 4 !== 0) throw new Error("400 Unsupported parameter: 'max_tokens'");
        return fakeAnalysis();
      });
      const result = await analyzeNews(createMockArticles(20));
      expect(result.success).toBe(false);
      expect(result.articles.length).toBe(5);
      expect(result.error).toContain("성공률");
    });

    test("전부 실패하면 0개 + success=false (예전: 0개 + success=true)", async () => {
      createStructuredSpy.mockImplementation(async () => {
        throw new Error("400");
      });
      const result = await analyzeNews(createMockArticles(5));
      expect(result.success).toBe(false);
      expect(result.articles).toEqual([]);
    });

    test("일부 실패는 허용", async () => {
      let n = 0;
      createStructuredSpy.mockImplementation(async () => {
        if (++n === 1) throw new Error("timeout");
        return fakeAnalysis();
      });
      const result = await analyzeNews(createMockArticles(10));
      expect(result.success).toBe(true);
      expect(result.articles.length).toBe(9);
    });
  });
});
