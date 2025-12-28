import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test";
import { fetchAllNews, getNewsSources } from "@/services/news-fetcher.ts";

// Bun fetch mock 타입 호환성 해결
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetch = (impl: () => Promise<any>): typeof fetch =>
  mock(impl) as unknown as typeof fetch;

// 샘플 RSS 피드
const sampleRss2Feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Test Article 1</title>
      <link>https://example.com/article1</link>
      <description>This is a test article description.</description>
      <pubDate>Thu, 26 Dec 2024 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Test Article 2</title>
      <link>https://example.com/article2</link>
      <description><![CDATA[<p>HTML content</p> with tags]]></description>
      <pubDate>Thu, 26 Dec 2024 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const sampleAtomFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom Article</title>
    <link href="https://example.com/atom1" type="text/html"/>
    <summary>Atom article summary</summary>
    <published>2024-12-26T08:00:00Z</published>
  </entry>
</feed>`;

describe("news-fetcher", () => {
  describe("getNewsSources", () => {
    test("returns an array of RSS sources", () => {
      const sources = getNewsSources();
      expect(Array.isArray(sources)).toBe(true);
      expect(sources.length).toBeGreaterThan(0);
    });

    test("each source has required properties", () => {
      const sources = getNewsSources();
      for (const source of sources) {
        expect(source).toHaveProperty("url");
        expect(source).toHaveProperty("source");
        expect(source).toHaveProperty("region");
        expect(typeof source.url).toBe("string");
        expect(typeof source.source).toBe("string");
        expect(typeof source.region).toBe("string");
      }
    });

    test("includes expected sources", () => {
      const sources = getNewsSources();
      const sourceNames = sources.map((s) => s.source);

      expect(sourceNames).toContain("CNBC Business");
      expect(sourceNames).toContain("CNBC Economy");
      expect(sourceNames).toContain("Yahoo Finance");
      expect(sourceNames).toContain("매일경제 경제");
      expect(sourceNames).toContain("매일경제 증권");
      expect(sourceNames).toContain("한경 경제");
    });

    test("has correct regions", () => {
      const sources = getNewsSources();
      const usCount = sources.filter((s) => s.region === "US").length;
      const krCount = sources.filter((s) => s.region === "KR").length;

      expect(usCount).toBe(3);
      expect(krCount).toBe(3);
    });
  });

  describe("fetchAllNews", () => {
    let originalFetch: typeof globalThis.fetch;
    let consoleSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      consoleSpy.mockRestore();
    });

    test("returns success with articles when fetch succeeds", async () => {
      globalThis.fetch = mockFetch(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(sampleRss2Feed),
        } as Response)
      );

      const result = await fetchAllNews();

      expect(result.success).toBe(true);
      expect(Array.isArray(result.articles)).toBe(true);
      expect(result.articles.length).toBeGreaterThan(0);
    });

    test("returns empty articles when all fetches fail", async () => {
      globalThis.fetch = mockFetch(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        } as Response)
      );

      const result = await fetchAllNews();

      expect(result.success).toBe(true);
      expect(result.articles).toEqual([]);
    });

    test("handles network errors gracefully", async () => {
      globalThis.fetch = mockFetch(() => Promise.reject(new Error("Network error")));

      const result = await fetchAllNews();

      expect(result.success).toBe(true);
      expect(result.articles).toEqual([]);
    });

    test("parses RSS 2.0 feed correctly", async () => {
      globalThis.fetch = mockFetch(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(sampleRss2Feed),
        } as Response)
      );

      const result = await fetchAllNews();
      const article = result.articles[0];

      expect(article).toBeDefined();
      if (article) {
        expect(article.title).toBe("Test Article 1");
        expect(article.link).toBe("https://example.com/article1");
        expect(article.description).toBe("This is a test article description.");
        expect(article.pubDate).toBeInstanceOf(Date);
      }
    });

    test("strips HTML tags from description", async () => {
      globalThis.fetch = mockFetch(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(sampleRss2Feed),
        } as Response)
      );

      const result = await fetchAllNews();
      const articleWithHtml = result.articles.find((a) =>
        a.description?.includes("with tags")
      );

      if (articleWithHtml) {
        expect(articleWithHtml.description).not.toContain("<p>");
        expect(articleWithHtml.description).not.toContain("</p>");
      }
    });

    test("includes source and region in articles", async () => {
      globalThis.fetch = mockFetch(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(sampleRss2Feed),
        } as Response)
      );

      const result = await fetchAllNews();

      for (const article of result.articles) {
        expect(article.source).toBeDefined();
        expect(article.region).toBeDefined();
      }
    });
  });

  describe("RSS parsing edge cases", () => {
    let originalFetch: typeof globalThis.fetch;
    let consoleSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      consoleSpy.mockRestore();
    });

    test("handles Atom feed format", async () => {
      globalThis.fetch = mockFetch(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(sampleAtomFeed),
        } as Response)
      );

      const result = await fetchAllNews();

      // Atom 피드가 파싱되면 기사가 있어야 함
      // 없어도 에러 없이 처리되어야 함
      expect(result.success).toBe(true);
    });

    test("handles empty feed", async () => {
      const emptyFeed = `<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <title>Empty Feed</title>
          </channel>
        </rss>`;

      globalThis.fetch = mockFetch(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(emptyFeed),
        } as Response)
      );

      const result = await fetchAllNews();

      expect(result.success).toBe(true);
      expect(result.articles.length).toBe(0);
    });

    test("handles malformed XML gracefully", async () => {
      globalThis.fetch = mockFetch(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve("not valid xml"),
        } as Response)
      );

      const result = await fetchAllNews();

      expect(result.success).toBe(true);
      expect(result.articles).toEqual([]);
    });

    test("handles missing required fields", async () => {
      const feedWithMissingFields = `<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <item>
              <description>No title or link</description>
            </item>
          </channel>
        </rss>`;

      globalThis.fetch = mockFetch(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(feedWithMissingFields),
        } as Response)
      );

      const result = await fetchAllNews();

      expect(result.success).toBe(true);
      // 필수 필드가 없으면 기사가 추가되지 않아야 함
      expect(result.articles.length).toBe(0);
    });

    test("handles invalid date formats", async () => {
      const feedWithInvalidDate = `<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Article with bad date</title>
              <link>https://example.com/bad-date</link>
              <pubDate>not a valid date</pubDate>
            </item>
          </channel>
        </rss>`;

      globalThis.fetch = mockFetch(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(feedWithInvalidDate),
        } as Response)
      );

      const result = await fetchAllNews();

      expect(result.success).toBe(true);
      const article = result.articles[0];
      if (article) {
        // 잘못된 날짜는 undefined여야 함
        expect(article.pubDate).toBeUndefined();
      }
    });
  });
});
