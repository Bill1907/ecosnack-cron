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

// 뉴스 기사 저장
export async function saveNewsArticle(article: AnalyzedNewsArticle): Promise<NewsRecord | null> {
  const db = getPrisma();

  try {
    const result = await db.article.upsert({
      where: { link: article.link },
      update: {}, // 중복 시 업데이트 안 함
      create: {
        title: article.title,
        link: article.link,
        description: article.description ?? null,
        pubDate: article.pubDate ?? null,
        source: article.source ?? null,
        region: article.region ?? null,
        imageUrl: article.imageUrl ?? null,
        headlineSummary: article.headlineSummary ?? null,
        soWhat: (article.soWhat as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        impactAnalysis: (article.impactAnalysis as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        relatedContext: (article.relatedContext as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        keywords: article.keywords ?? [],
        category: article.category ?? null,
        sentiment: (article.sentiment as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        importanceScore: article.importanceScore ?? null,
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
    // 중복 link로 인한 에러는 무시
    if (getErrorMessage(error).includes("Unique constraint")) {
      log(`뉴스 중복 건너뜀: ${article.title}`, "warn");
      return null;
    }

    log(`뉴스 저장 실패: ${getErrorMessage(error)}`, "error");
    throw error;
  }
}

// 여러 뉴스 기사 일괄 저장
export async function saveNewsArticles(articles: AnalyzedNewsArticle[]): Promise<number> {
  let savedCount = 0;

  for (const article of articles) {
    const result = await saveNewsArticle(article);
    if (result) {
      savedCount++;
    }
  }

  log(`총 ${savedCount}/${articles.length}개 뉴스 저장 완료`);
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
