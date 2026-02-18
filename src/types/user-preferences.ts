// ============================================
// 사용자 선호도 타입 정의
// ============================================

// 카테고리 가중치
export interface CategoryWeight {
  category: string;
  weight: number; // 0-1 사이 비율
  count: number;  // 해당 카테고리 북마크 수
}

// 사용자 선호도
export interface UserPreferences {
  userId: string;
  topCategories: CategoryWeight[];
  topKeywords: string[];
  preferredSources: string[];
  sentimentBias: "positive" | "negative" | "neutral" | "mixed" | null;
  bookmarkCount: number;
  lastBookmarkId: number | null;
  analyzedAt: Date | null;
}

// 선호도 업데이트 결과
export interface PreferenceUpdateResult {
  userId: string;
  updated: boolean;
  newBookmarkCount: number;
  previousBookmarkCount: number;
}

// 개인화 리포트 대상 사용자
export interface EligibleUser {
  userId: string;
  email: string | null;
  name: string | null;
  bookmarkCount: number;
  preferences: UserPreferences | null;
}

// 개인화 기사 점수
export interface ScoredArticle {
  articleId: number;
  score: number;
  matchedCategories: string[];
  matchedKeywords: string[];
}
