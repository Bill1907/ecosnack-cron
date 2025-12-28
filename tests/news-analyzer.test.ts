import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test";
import { analyzeNews } from "@/services/news-analyzer.ts";
import type { RawNewsArticle } from "@/types/index.ts";

// Bun fetch mock 타입 호환성 해결
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetch = (impl: () => Promise<any>): typeof fetch =>
  mock(impl) as unknown as typeof fetch;

// ============================================
// Mock Data
// ============================================

const createMockArticles = (count: number): RawNewsArticle[] => {
  return Array.from({ length: count }, (_, i) => ({
    title: `Test Article ${i + 1}: Economic News About Market ${i + 1}`,
    link: `https://example.com/article-${i + 1}`,
    description: `This is a detailed description for article ${i + 1} about economic developments.`,
    pubDate: new Date("2024-12-26"),
    source: i % 2 === 0 ? "CNBC" : "매일경제",
    region: i % 2 === 0 ? "US" : "KR",
  }));
};

const sampleHtmlWithOgImage = `
<!DOCTYPE html>
<html>
<head>
  <meta property="og:image" content="https://cdn.example.com/image.jpg" />
  <meta property="og:title" content="Test Article" />
</head>
<body>
  <article>
    <img src="/article-image.jpg" alt="Article Image" />
  </article>
</body>
</html>
`;

const sampleHtmlWithTwitterImage = `
<!DOCTYPE html>
<html>
<head>
  <meta name="twitter:image" content="https://twitter.example.com/image.png" />
</head>
<body></body>
</html>
`;

const sampleHtmlWithArticleImage = `
<!DOCTYPE html>
<html>
<head></head>
<body>
  <article>
    <img src="https://example.com/article-img.jpg" />
  </article>
</body>
</html>
`;

const sampleHtmlWithRelativeImage = `
<!DOCTYPE html>
<html>
<head>
  <meta property="og:image" content="/images/relative.jpg" />
</head>
<body></body>
</html>
`;

const sampleHtmlWithProtocolRelativeImage = `
<!DOCTYPE html>
<html>
<head>
  <meta property="og:image" content="//cdn.example.com/protocol-relative.jpg" />
</head>
<body></body>
</html>
`;

const sampleHtmlNoImage = `
<!DOCTYPE html>
<html>
<head>
  <title>No Image Article</title>
</head>
<body>
  <p>Article content without any images</p>
</body>
</html>
`;

// ============================================
// Mock OpenAI Response
// ============================================

const createMockTitleFilterResponse = (articles: { index: number }[]) => ({
  articles: articles.map((a, i) => ({
    index: a.index,
    score: 90 - i * 2, // 점수 순차 감소
    reason: `Good economic news article ${a.index}`,
  })),
});

const createMockQualityFilterResponse = (articles: { index: number }[]) => ({
  articles: articles.map((a, i) => ({
    index: a.index,
    score: 85 - i * 3,
    reason: `Quality content from trusted source ${a.index}`,
  })),
});

// ============================================
// Tests
// ============================================

describe("news-analyzer", () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    globalThis.fetch = originalFetch;
  });

  // ============================================
  // 기본 동작 테스트
  // ============================================

  describe("기본 동작", () => {
    test("빈 배열 입력시 빈 결과 반환", async () => {
      const result = await analyzeNews([]);

      expect(result.success).toBe(true);
      expect(result.articles).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    test("원본 기사 속성 보존", async () => {
      // 30개 이하면 필터링 스킵
      const articles: RawNewsArticle[] = [
        {
          title: "Original Title",
          link: "https://example.com/original",
          description: "Original Description",
          pubDate: new Date("2024-12-26"),
          source: "CNBC",
          region: "US",
        },
      ];

      // Mock fetch for image extraction
      globalThis.fetch = mockFetch(() =>
        Promise.resolve(
          new Response(sampleHtmlWithOgImage, { status: 200 })
        )
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed).toBeDefined();
      expect(analyzed?.title).toBe("Original Title");
      expect(analyzed?.link).toBe("https://example.com/original");
      expect(analyzed?.description).toBe("Original Description");
      expect(analyzed?.source).toBe("CNBC");
      expect(analyzed?.region).toBe("US");
    });
  });

  // ============================================
  // Stage 1: 제목 필터링 테스트 (30개 이하인 경우)
  // ============================================

  describe("Stage 1: 제목 필터링 (기사 수 ≤ 30)", () => {
    test("30개 이하 기사는 필터링 없이 모두 통과", async () => {
      const articles = createMockArticles(25);

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithOgImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);

      // 30개 이하면 Stage 1 스킵, Stage 2에서 20개로 필터링
      expect(result.success).toBe(true);
      expect(result.articles.length).toBeLessThanOrEqual(20);
    });

    test("정확히 20개 기사는 모두 통과 가능", async () => {
      const articles = createMockArticles(20);

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithOgImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);

      expect(result.success).toBe(true);
      expect(result.articles.length).toBe(20);
    });
  });

  // ============================================
  // 이미지 추출 테스트
  // ============================================

  describe("이미지 추출", () => {
    test("og:image 메타 태그에서 이미지 추출", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "OG Image Test",
          link: "https://example.com/og-test",
          description: "Testing og:image extraction",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithOgImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.imageUrl).toBe("https://cdn.example.com/image.jpg");
    });

    test("twitter:image 메타 태그에서 이미지 추출 (og:image 없을 때)", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "Twitter Image Test",
          link: "https://example.com/twitter-test",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithTwitterImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.imageUrl).toBe("https://twitter.example.com/image.png");
    });

    test("article 태그 내 이미지 추출 (메타 태그 없을 때)", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "Article Image Test",
          link: "https://example.com/article-img-test",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithArticleImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.imageUrl).toBe("https://example.com/article-img.jpg");
    });

    test("상대 경로 이미지 URL을 절대 경로로 변환", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "Relative Path Test",
          link: "https://example.com/relative-test",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithRelativeImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.imageUrl).toBe("https://example.com/images/relative.jpg");
    });

    test("프로토콜 상대 경로 (//) 처리", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "Protocol Relative Test",
          link: "https://example.com/protocol-test",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithProtocolRelativeImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.imageUrl).toBe("https://cdn.example.com/protocol-relative.jpg");
    });

    test("이미지 없는 페이지 처리", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "No Image Test",
          link: "https://example.com/no-image",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlNoImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.imageUrl).toBeUndefined();
    });

    test("fetch 실패시 이미지 null 반환", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "Fetch Fail Test",
          link: "https://example.com/fetch-fail",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response("", { status: 404 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.imageUrl).toBeUndefined();
    });

    test("네트워크 오류시 이미지 null 반환", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "Network Error Test",
          link: "https://example.com/network-error",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.reject(new Error("Network error"))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      // 네트워크 오류여도 분석은 계속 진행
      expect(result.success).toBe(true);
      const analyzed = result.articles[0];
      expect(analyzed?.imageUrl).toBeUndefined();
    });
  });

  // ============================================
  // 요약 생성 테스트
  // ============================================

  describe("요약 생성", () => {
    test("description이 있으면 요약 생성", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "Test Title",
          link: "https://example.com/test",
          description: "This is a test description for summarization.",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithOgImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.headlineSummary).toBeDefined();
      expect(analyzed?.headlineSummary).toContain("test description");
    });

    test("description 없으면 title 사용", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "Fallback to Title",
          link: "https://example.com/no-desc",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlNoImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.headlineSummary).toBe("Fallback to Title");
    });

    test("HTML 태그 제거", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "HTML Test",
          link: "https://example.com/html",
          description: "<p>Paragraph with <strong>bold</strong> text</p>",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlNoImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.headlineSummary).not.toContain("<p>");
      expect(analyzed?.headlineSummary).not.toContain("</p>");
      expect(analyzed?.headlineSummary).not.toContain("<strong>");
    });

    test("200자 초과시 잘림", async () => {
      const longDescription = "A".repeat(500);
      const articles: RawNewsArticle[] = [
        {
          title: "Long Article",
          link: "https://example.com/long",
          description: longDescription,
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlNoImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.headlineSummary).toBeDefined();
      expect(analyzed?.headlineSummary!.length).toBeLessThanOrEqual(203);
    });

    test("문장 경계에서 자르기", async () => {
      const description =
        "This is the first sentence. This is the second sentence that makes the text longer than 200 characters. This third sentence adds even more content.";
      const articles: RawNewsArticle[] = [
        {
          title: "Sentence Boundary",
          link: "https://example.com/sentence",
          description,
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlNoImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      // 문장 경계에서 잘렸다면 마침표로 끝남
      if (analyzed?.headlineSummary && analyzed.headlineSummary.length < 200) {
        expect(analyzed.headlineSummary.endsWith(".")).toBe(true);
      }
    });

    test("공백 정규화", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "Whitespace Test",
          link: "https://example.com/ws",
          description: "Multiple   spaces\n\nand\tnewlines",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlNoImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.headlineSummary).not.toContain("  ");
      expect(analyzed?.headlineSummary).not.toContain("\n");
      expect(analyzed?.headlineSummary).not.toContain("\t");
    });
  });

  // ============================================
  // Stage 2: 품질 필터링 테스트
  // ============================================

  describe("Stage 2: 품질 필터링", () => {
    test("이미지 있는 기사 우선 선택", async () => {
      const articles = createMockArticles(15);

      // 홀수 인덱스는 이미지 없음, 짝수는 있음
      let callCount = 0;
      globalThis.fetch = mockFetch(() => {
        const hasImage = callCount % 2 === 0;
        callCount++;
        return Promise.resolve(
          new Response(hasImage ? sampleHtmlWithOgImage : sampleHtmlNoImage, {
            status: 200,
          })
        );
      }) as typeof fetch;

      const result = await analyzeNews(articles);

      // 이미지 있는 기사가 우선 선택됨
      const withImages = result.articles.filter((a) => a.imageUrl);
      expect(withImages.length).toBeGreaterThan(0);
    });

    test("최대 20개 기사 반환", async () => {
      const articles = createMockArticles(25);

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithOgImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);

      expect(result.articles.length).toBeLessThanOrEqual(20);
    });
  });

  // ============================================
  // 분석 결과 필드 테스트
  // ============================================

  describe("분석 결과 필드", () => {
    test("importanceScore 설정", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "Score Test",
          link: "https://example.com/score",
          description: "Testing importance score",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithOgImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      // importanceScore는 qualityScore에서 설정됨
      expect(analyzed?.importanceScore).toBeDefined();
      expect(typeof analyzed?.importanceScore).toBe("number");
    });

    test("keywords 빈 배열로 초기화", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "Keywords Test",
          link: "https://example.com/keywords",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlNoImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.keywords).toEqual([]);
    });

    test("AI 분석 필드 undefined", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "AI Fields Test",
          link: "https://example.com/ai",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlNoImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.soWhat).toBeUndefined();
      expect(analyzed?.impactAnalysis).toBeUndefined();
      expect(analyzed?.relatedContext).toBeUndefined();
      expect(analyzed?.sentiment).toBeUndefined();
      expect(analyzed?.category).toBeUndefined();
    });
  });

  // ============================================
  // 에지 케이스 테스트
  // ============================================

  describe("에지 케이스", () => {
    test("빈 description 처리", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "Empty Description",
          link: "https://example.com/empty-desc",
          description: "",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlNoImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.headlineSummary).toBe("Empty Description");
    });

    test("공백만 있는 description 처리", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "Whitespace Only",
          link: "https://example.com/ws-only",
          description: "   \n\t  ",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlNoImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.headlineSummary).toBe("Whitespace Only");
    });

    test("특수 문자가 포함된 URL 처리", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "Special URL",
          link: "https://example.com/article?id=123&lang=ko",
          description: "URL with query params",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithOgImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);

      expect(result.success).toBe(true);
      expect(result.articles.length).toBe(1);
    });

    test("한글 콘텐츠 처리", async () => {
      const articles: RawNewsArticle[] = [
        {
          title: "한국 경제 뉴스 테스트",
          link: "https://example.com/korean",
          description: "이것은 한글 설명입니다. 경제 뉴스에 대한 내용을 담고 있습니다.",
          source: "매일경제",
          region: "KR",
        },
      ];

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithOgImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);
      const analyzed = result.articles[0];

      expect(analyzed?.title).toBe("한국 경제 뉴스 테스트");
      expect(analyzed?.headlineSummary).toContain("한글 설명");
    });
  });

  // ============================================
  // Stage 1: 대량 기사 필터링 테스트 (> 30개)
  // ============================================

  describe("Stage 1: 대량 기사 필터링 (기사 수 > 30)", () => {
    test("50개 기사 입력시 30개로 필터링 후 20개 최종 선택", async () => {
      const articles = createMockArticles(50);

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithOgImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);

      expect(result.success).toBe(true);
      // Stage 1: 50 → 30, Stage 2: 30 → 20
      expect(result.articles.length).toBe(20);
    }, 60000); // 60초 타임아웃 (OpenAI API 호출)

    test("100개 기사 입력시 20개 최종 선택", async () => {
      const articles = createMockArticles(100);

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithOgImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);

      expect(result.success).toBe(true);
      expect(result.articles.length).toBe(20);
    }, 120000); // 120초 타임아웃 (여러 배치 처리)

    test("필터링된 기사들이 원본 속성을 유지", async () => {
      const articles = createMockArticles(35);

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithOgImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);

      expect(result.success).toBe(true);

      // 모든 결과 기사가 필수 속성을 가짐
      for (const article of result.articles) {
        expect(article.title).toBeDefined();
        expect(article.link).toBeDefined();
        expect(article.link).toMatch(/^https:\/\/example\.com\/article-\d+$/);
      }
    }, 60000);
  });

  // ============================================
  // 성공/실패 결과 테스트
  // ============================================

  describe("성공/실패 결과", () => {
    test("정상 처리시 success: true", async () => {
      const articles = createMockArticles(5);

      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(sampleHtmlWithOgImage, { status: 200 }))
      ) as typeof fetch;

      const result = await analyzeNews(articles);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test("빈 입력시 success: true, 빈 배열", async () => {
      const result = await analyzeNews([]);

      expect(result.success).toBe(true);
      expect(result.articles).toEqual([]);
    });
  });
});
