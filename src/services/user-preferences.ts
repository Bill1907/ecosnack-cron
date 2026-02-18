import { Prisma } from "@prisma/client";
import { getPrisma } from "@/services/database.ts";
import type {
  CategoryWeight,
  UserPreferences,
  PreferenceUpdateResult,
  EligibleUser,
} from "@/types/user-preferences.ts";
import { log } from "@/utils/index.ts";

// 최소 북마크 수 (개인화 리포트 대상)
const MIN_BOOKMARK_COUNT = 3;

// ============================================
// 대상 사용자 조회
// ============================================

/**
 * 개인화 리포트 대상 사용자 조회 (북마크 >= 3개)
 */
export async function getEligibleUsers(): Promise<EligibleUser[]> {
  const db = getPrisma();

  // 북마크 3개 이상인 사용자 조회
  const usersWithBookmarks = await db.user.findMany({
    where: {
      bookmarks: {
        some: {},
      },
    },
    include: {
      _count: {
        select: { bookmarks: true },
      },
      preference: true,
    },
  });

  // 북마크 3개 이상만 필터링
  const eligibleUsers = usersWithBookmarks
    .filter((u) => u._count.bookmarks >= MIN_BOOKMARK_COUNT)
    .map((u) => ({
      userId: u.clerkId,
      email: u.email,
      name: u.name,
      bookmarkCount: u._count.bookmarks,
      preferences: u.preference
        ? {
            userId: u.preference.userId,
            topCategories: u.preference.topCategories as unknown as CategoryWeight[],
            topKeywords: u.preference.topKeywords,
            preferredSources: u.preference.preferredSources,
            sentimentBias: u.preference.sentimentBias as UserPreferences["sentimentBias"],
            bookmarkCount: u.preference.bookmarkCount,
            lastBookmarkId: u.preference.lastBookmarkId,
            analyzedAt: u.preference.analyzedAt,
          }
        : null,
    }));

  log(`개인화 대상 사용자: ${eligibleUsers.length}명 (북마크 ${MIN_BOOKMARK_COUNT}개 이상)`);
  return eligibleUsers;
}

// ============================================
// 선호도 계산 (AI 없이 통계 기반)
// ============================================

interface BookmarkedArticle {
  id: number;
  category: string | null;
  keywords: string[];
  source: string | null;
  sentiment: { overall: string } | null;
}

/**
 * 북마크된 기사들로부터 선호도 계산
 */
function calculatePreferences(articles: BookmarkedArticle[]): Omit<
  UserPreferences,
  "userId" | "bookmarkCount" | "lastBookmarkId" | "analyzedAt"
> {
  // 1. 카테고리 빈도 계산
  const categoryCount = new Map<string, number>();
  for (const article of articles) {
    if (article.category) {
      categoryCount.set(
        article.category,
        (categoryCount.get(article.category) ?? 0) + 1
      );
    }
  }

  const totalWithCategory = Array.from(categoryCount.values()).reduce(
    (a, b) => a + b,
    0
  );
  const topCategories: CategoryWeight[] = Array.from(categoryCount.entries())
    .map(([category, count]) => ({
      category,
      count,
      weight: totalWithCategory > 0 ? count / totalWithCategory : 0,
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  // 2. 키워드 빈도 계산
  const keywordCount = new Map<string, number>();
  for (const article of articles) {
    for (const keyword of article.keywords ?? []) {
      keywordCount.set(keyword, (keywordCount.get(keyword) ?? 0) + 1);
    }
  }

  const topKeywords = Array.from(keywordCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([keyword]) => keyword);

  // 3. 소스 빈도 계산
  const sourceCount = new Map<string, number>();
  for (const article of articles) {
    if (article.source) {
      sourceCount.set(article.source, (sourceCount.get(article.source) ?? 0) + 1);
    }
  }

  const preferredSources = Array.from(sourceCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([source]) => source);

  // 4. 감성 경향 계산
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;

  for (const article of articles) {
    const sentiment = article.sentiment?.overall;
    if (sentiment === "positive") positiveCount++;
    else if (sentiment === "negative") negativeCount++;
    else neutralCount++;
  }

  let sentimentBias: UserPreferences["sentimentBias"] = null;
  const total = positiveCount + negativeCount + neutralCount;
  if (total > 0) {
    if (positiveCount > negativeCount && positiveCount > neutralCount) {
      sentimentBias = "positive";
    } else if (negativeCount > positiveCount && negativeCount > neutralCount) {
      sentimentBias = "negative";
    } else if (positiveCount === negativeCount && positiveCount > 0) {
      sentimentBias = "mixed";
    } else {
      sentimentBias = "neutral";
    }
  }

  return {
    topCategories,
    topKeywords,
    preferredSources,
    sentimentBias,
  };
}

// ============================================
// 증분 업데이트
// ============================================

/**
 * 사용자 선호도 증분 업데이트
 * - 새 북마크가 있으면 기존 + 새 데이터 병합
 * - 없으면 스킵
 */
export async function updateUserPreference(
  userId: string
): Promise<PreferenceUpdateResult> {
  const db = getPrisma();

  // 1. 현재 선호도 조회
  const currentPref = await db.userPreference.findUnique({
    where: { userId },
  });

  const lastBookmarkId = currentPref?.lastBookmarkId ?? 0;
  const previousBookmarkCount = currentPref?.bookmarkCount ?? 0;

  // 2. 새 북마크 확인
  const newBookmarks = await db.bookmark.findMany({
    where: {
      userId,
      id: { gt: lastBookmarkId },
    },
    include: {
      article: {
        select: {
          id: true,
          category: true,
          keywords: true,
          source: true,
          sentiment: true,
        },
      },
    },
    orderBy: { id: "asc" },
  });

  // 3. 새 북마크가 없으면 스킵
  if (newBookmarks.length === 0) {
    return {
      userId,
      updated: false,
      newBookmarkCount: previousBookmarkCount,
      previousBookmarkCount,
    };
  }

  // 4. 전체 북마크 기사 조회 (선호도 재계산)
  const allBookmarks = await db.bookmark.findMany({
    where: { userId },
    include: {
      article: {
        select: {
          id: true,
          category: true,
          keywords: true,
          source: true,
          sentiment: true,
        },
      },
    },
  });

  const articles = allBookmarks.map((b) => ({
    id: b.article.id,
    category: b.article.category,
    keywords: b.article.keywords,
    source: b.article.source,
    sentiment: b.article.sentiment as { overall: string } | null,
  }));

  // 5. 선호도 계산
  const preferences = calculatePreferences(articles);
  const newMaxBookmarkId = Math.max(...allBookmarks.map((b) => b.id));

  // 6. DB 저장 (upsert)
  await db.userPreference.upsert({
    where: { userId },
    create: {
      userId,
      topCategories: preferences.topCategories as unknown as Prisma.InputJsonValue,
      topKeywords: preferences.topKeywords,
      preferredSources: preferences.preferredSources,
      sentimentBias: preferences.sentimentBias,
      bookmarkCount: allBookmarks.length,
      lastBookmarkId: newMaxBookmarkId,
      analyzedAt: new Date(),
    },
    update: {
      topCategories: preferences.topCategories as unknown as Prisma.InputJsonValue,
      topKeywords: preferences.topKeywords,
      preferredSources: preferences.preferredSources,
      sentimentBias: preferences.sentimentBias,
      bookmarkCount: allBookmarks.length,
      lastBookmarkId: newMaxBookmarkId,
      analyzedAt: new Date(),
    },
  });

  log(`사용자 ${userId} 선호도 업데이트: ${previousBookmarkCount} → ${allBookmarks.length}개`);

  return {
    userId,
    updated: true,
    newBookmarkCount: allBookmarks.length,
    previousBookmarkCount,
  };
}

/**
 * 모든 대상 사용자의 선호도 업데이트
 */
export async function updateAllUserPreferences(): Promise<PreferenceUpdateResult[]> {
  const eligibleUsers = await getEligibleUsers();
  const results: PreferenceUpdateResult[] = [];

  for (const user of eligibleUsers) {
    const result = await updateUserPreference(user.userId);
    results.push(result);
  }

  const updatedCount = results.filter((r) => r.updated).length;
  log(`선호도 업데이트 완료: ${updatedCount}/${results.length}명`);

  return results;
}

// ============================================
// 선호도 조회
// ============================================

/**
 * 사용자 선호도 조회
 */
export async function getUserPreference(
  userId: string
): Promise<UserPreferences | null> {
  const db = getPrisma();

  const pref = await db.userPreference.findUnique({
    where: { userId },
  });

  if (!pref) return null;

  return {
    userId: pref.userId,
    topCategories: pref.topCategories as unknown as CategoryWeight[],
    topKeywords: pref.topKeywords,
    preferredSources: pref.preferredSources,
    sentimentBias: pref.sentimentBias as UserPreferences["sentimentBias"],
    bookmarkCount: pref.bookmarkCount,
    lastBookmarkId: pref.lastBookmarkId,
    analyzedAt: pref.analyzedAt,
  };
}
