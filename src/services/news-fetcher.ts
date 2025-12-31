import { XMLParser } from "fast-xml-parser";
import type { RawNewsArticle, FetchResult } from "@/types/index.ts";
import { log, getErrorMessage, withRetry } from "@/utils/index.ts";

// RSS 소스 설정
interface RssSource {
  url: string;
  source: string;
  region: string;
}

const NEWS_SOURCES: RssSource[] = [
  {
    url: "https://www.cnbc.com/id/10001147/device/rss/rss.html",
    source: "CNBC Business",
    region: "US",
  },
  {
    url: "https://www.cnbc.com/id/20910258/device/rss/rss.html",
    source: "CNBC Economy",
    region: "US",
  },
  {
    url: "https://finance.yahoo.com/news/rssindex",
    source: "Yahoo Finance",
    region: "US",
  },
  {
    url: "https://www.mk.co.kr/rss/30100041/",
    source: "매일경제 경제",
    region: "KR",
  },
  {
    url: "https://www.mk.co.kr/rss/50200011/",
    source: "매일경제 증권",
    region: "KR",
  },
  {
    url: "https://www.hankyung.com/feed/economy",
    source: "한경 경제",
    region: "KR",
  },
];

// XML 파서 설정
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

// RSS 아이템을 RawNewsArticle로 변환
function parseRssItem(item: Record<string, unknown>, source: string, region: string): RawNewsArticle | null {
  try {
    const title = (item.title as string) ?? "";
    const link = (item.link as string) ?? (item.guid as string) ?? "";
    const description = (item.description as string) ?? (item.summary as string) ?? "";
    const pubDateStr = (item.pubDate as string) ?? (item.published as string) ?? "";

    if (!title || !link) {
      return null;
    }

    // HTML 태그 제거
    const cleanDescription = description.replace(/<[^>]*>/g, "").trim();

    // 날짜 파싱
    let pubDate: Date | undefined;
    if (pubDateStr) {
      const parsed = new Date(pubDateStr);
      if (!isNaN(parsed.getTime())) {
        pubDate = parsed;
      }
    }

    return {
      title: title.trim(),
      link: link.trim(),
      description: cleanDescription || undefined,
      pubDate,
      source,
      region,
    };
  } catch (error) {
    log(`RSS 아이템 파싱 실패: ${getErrorMessage(error)}`, "warn");
    return null;
  }
}

// RSS 피드 파싱
function parseRssFeed(xml: string, source: string, region: string): RawNewsArticle[] {
  try {
    const result = xmlParser.parse(xml);
    const articles: RawNewsArticle[] = [];

    // RSS 2.0 형식
    const rssItems = result?.rss?.channel?.item;
    if (rssItems) {
      const items = Array.isArray(rssItems) ? rssItems : [rssItems];
      for (const item of items) {
        const article = parseRssItem(item, source, region);
        if (article) {
          articles.push(article);
        }
      }
    }

    // Atom 형식
    const atomEntries = result?.feed?.entry;
    if (atomEntries) {
      const entries = Array.isArray(atomEntries) ? atomEntries : [atomEntries];
      for (const entry of entries) {
        // Atom 링크 처리
        let link = "";
        if (typeof entry.link === "string") {
          link = entry.link;
        } else if (entry.link?.["@_href"]) {
          link = entry.link["@_href"];
        } else if (Array.isArray(entry.link)) {
          const htmlLink = entry.link.find((l: Record<string, unknown>) => l["@_type"] === "text/html" || !l["@_type"]);
          link = htmlLink?.["@_href"] ?? "";
        }

        const article = parseRssItem(
          {
            title: entry.title,
            link,
            description: entry.summary ?? entry.content,
            pubDate: entry.published ?? entry.updated,
          },
          source,
          region
        );
        if (article) {
          articles.push(article);
        }
      }
    }

    return articles;
  } catch (error) {
    log(`RSS 파싱 실패: ${getErrorMessage(error)}`, "error");
    return [];
  }
}

// 단일 소스에서 뉴스 수집
async function fetchFromSource(rssSource: RssSource): Promise<RawNewsArticle[]> {
  const { url, source, region } = rssSource;

  try {
    const xml = await withRetry(
      async () => {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; EcoSnackBot/1.0)",
            Accept: "application/rss+xml, application/xml, text/xml, */*",
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response.text();
      },
      { retries: 3, delay: 1000 }
    );

    const articles = parseRssFeed(xml, source, region);
    log(`[${source}] ${articles.length}개 뉴스 수집`);
    return articles;
  } catch (error) {
    log(`[${source}] 수집 실패 (재시도 후): ${getErrorMessage(error)}`, "error");
    return [];
  }
}

// 모든 소스에서 뉴스 수집
export async function fetchAllNews(): Promise<FetchResult> {
  log("뉴스 수집 시작...");

  if (NEWS_SOURCES.length === 0) {
    log("설정된 뉴스 소스가 없습니다.", "warn");
    return {
      success: true,
      articles: [],
    };
  }

  try {
    const allArticles: RawNewsArticle[] = [];

    // 병렬로 모든 소스에서 수집
    const results = await Promise.allSettled(
      NEWS_SOURCES.map((source) => fetchFromSource(source))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        allArticles.push(...result.value);
      }
    }

    log(`총 ${allArticles.length}개 뉴스 수집 완료`);

    return {
      success: true,
      articles: allArticles,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    log(`뉴스 수집 중 오류: ${errorMessage}`, "error");

    return {
      success: false,
      articles: [],
      error: errorMessage,
    };
  }
}

// 특정 URL에서 단일 뉴스 수집 (테스트용)
export async function fetchNewsFromUrl(url: string): Promise<RawNewsArticle | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EcoSnackBot/1.0)",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    return {
      title: "제목 추출 필요",
      link: url,
      description: html.substring(0, 1000),
      pubDate: new Date(),
    };
  } catch (error) {
    log(`URL 뉴스 수집 실패 (${url}): ${getErrorMessage(error)}`, "error");
    return null;
  }
}

// RSS 소스 목록 반환 (테스트용)
export function getNewsSources(): RssSource[] {
  return NEWS_SOURCES;
}
