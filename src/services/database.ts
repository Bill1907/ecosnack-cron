import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { config } from "@/config/index.ts";
import type {
  AnalyzedNewsArticle,
  NewsRecord,
  SoWhat,
  ImpactAnalysis,
  RelatedContext,
  Sentiment,
  Category,
} from "@/types/index.ts";
import { log, getErrorMessage } from "@/utils/index.ts";

let prisma: PrismaClient | null = null;

// Prisma 클라이언트 초기화
export function initDatabase(): PrismaClient {
  if (!prisma) {
    // Prisma 7: PrismaNeon에 직접 connectionString 전달
    const adapter = new PrismaNeon({ connectionString: config.database.url });
    prisma = new PrismaClient({ adapter });
    log("데이터베이스 연결 초기화 완료");
  }
  return prisma;
}

// DB 연결 종료
export async function closeDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    log("데이터베이스 연결 종료");
  }
}

// Prisma 클라이언트 가져오기
export function getPrisma(): PrismaClient {
  if (!prisma) {
    return initDatabase();
  }
  return prisma;
}

// JSON 필드를 Prisma에 맞게 변환 (undefined → DbNull, 값이 있으면 그대로)
function toJsonValue(
  value: unknown
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) {
    return Prisma.DbNull; // SQL NULL 저장 (JsonNull은 JSON의 null 값)
  }
  return value as Prisma.InputJsonValue;
}

// importanceScore를 1-10 범위로 정규화
function normalizeImportanceScore(score: number | undefined): number | null {
  if (score === undefined || score === null) {
    return null;
  }
  // 이미 1-10 범위면 그대로, 아니면 100점 만점을 10점 만점으로 변환
  if (score >= 1 && score <= 10) {
    return Math.round(score);
  }
  // 0-100 범위를 1-10으로 변환
  return Math.max(1, Math.min(10, Math.round(score / 10)));
}

// 뉴스 기사 저장
export async function saveNewsArticle(
  article: AnalyzedNewsArticle
): Promise<NewsRecord | null> {
  const db = getPrisma();

  try {
    // 1. 기존 기사 존재 여부 확인
    const existing = await db.article.findUnique({
      where: { link: article.link },
    });

    // 2. 중복이면 null 반환 (카운트 미포함)
    if (existing) {
      log(`뉴스 중복 건너뜀: ${article.title}`, "warn");
      return null;
    }

    // 3. 신규 기사만 저장
    const result = await db.article.create({
      data: {
        title: article.title,
        link: article.link,
        description: article.description ?? null,
        pubDate: article.pubDate ?? null,
        source: article.source ?? null,
        region: article.region ?? null,
        imageUrl: article.imageUrl ?? null,
        headlineSummary: article.headlineSummary ?? null,
        soWhat: toJsonValue(article.soWhat),
        impactAnalysis: toJsonValue(article.impactAnalysis),
        relatedContext: toJsonValue(article.relatedContext),
        keywords: article.keywords ?? [],
        category: article.category ?? null,
        sentiment: toJsonValue(article.sentiment),
        importanceScore: normalizeImportanceScore(article.importanceScore),
      },
    });

    log(`뉴스 저장 완료: ${article.title}`);

    return {
      id: result.id,
      title: result.title,
      link: result.link,
      description: result.description,
      pubDate: result.pubDate,
      source: result.source,
      region: result.region,
      imageUrl: result.imageUrl,
      headlineSummary: result.headlineSummary,
      soWhat: result.soWhat as SoWhat | null,
      impactAnalysis: result.impactAnalysis as ImpactAnalysis | null,
      relatedContext: result.relatedContext as RelatedContext | null,
      keywords: result.keywords,
      category: result.category as Category | null,
      sentiment: result.sentiment as Sentiment | null,
      importanceScore: result.importanceScore,
      createdAt: result.createdAt,
    };
  } catch (error) {
    // Race condition 처리 (동시 실행 시 Unique constraint)
    if (getErrorMessage(error).includes("Unique constraint")) {
      log(`뉴스 중복 건너뜀 (race): ${article.title}`, "warn");
      return null;
    }

    log(`뉴스 저장 실패: ${getErrorMessage(error)}`, "error");
    throw error;
  }
}

// 여러 뉴스 기사 일괄 저장
export async function saveNewsArticles(
  articles: AnalyzedNewsArticle[]
): Promise<number> {
  let savedCount = 0;

  for (const article of articles) {
    const result = await saveNewsArticle(article);
    if (result) {
      savedCount++;
    }
  }

  const duplicateCount = articles.length - savedCount;
  log(`총 ${savedCount}/${articles.length}개 뉴스 저장 완료 (${duplicateCount}개 중복 건너뜀)`);
  return savedCount;
}

// 최근 뉴스 조회
export async function getRecentArticles(limit = 10): Promise<NewsRecord[]> {
  const db = getPrisma();

  const articles = await db.article.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return articles.map((a) => ({
    id: a.id,
    title: a.title,
    link: a.link,
    description: a.description,
    pubDate: a.pubDate,
    source: a.source,
    region: a.region,
    imageUrl: a.imageUrl,
    headlineSummary: a.headlineSummary,
    soWhat: a.soWhat as SoWhat | null,
    impactAnalysis: a.impactAnalysis as ImpactAnalysis | null,
    relatedContext: a.relatedContext as RelatedContext | null,
    keywords: a.keywords,
    category: a.category as Category | null,
    sentiment: a.sentiment as Sentiment | null,
    importanceScore: a.importanceScore,
    createdAt: a.createdAt,
  }));
}

// 링크로 기사 존재 여부 확인
export async function articleExists(link: string): Promise<boolean> {
  const db = getPrisma();

  const count = await db.article.count({
    where: { link },
  });

  return count > 0;
}

/**
 * 여러 링크에 대해 일괄 존재 여부 확인
 * @param links - 확인할 링크 배열
 * @returns 이미 존재하는 링크의 Set
 */
export async function getExistingLinks(links: string[]): Promise<Set<string>> {
  if (links.length === 0) {
    return new Set();
  }

  const db = getPrisma();

  const existingArticles = await db.article.findMany({
    where: {
      link: { in: links },
    },
    select: { link: true },
  });

  return new Set(existingArticles.map((a) => a.link));
}
