import "dotenv/config";

export const config = {
  database: {
    url: process.env.DATABASE_URL ?? "",
  },
  newsApi: {
    key: process.env.NEWS_API_KEY ?? "",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    titleFilterLimit: 30, // Stage 1: 250 -> 30
    qualityFilterLimit: 20, // Stage 2: 30 -> 20
  },
  timezone: process.env.TZ ?? "Asia/Seoul",
  report: {
    skipQualityEval: process.env.SKIP_QUALITY_EVAL === "true",
    skipEvidenceCheck: process.env.SKIP_EVIDENCE_CHECK === "true",
  },
} as const;

// 필수 환경 변수 검증
export function validateConfig(): void {
  if (!config.database.url) {
    throw new Error("DATABASE_URL 환경 변수가 설정되지 않았습니다.");
  }
  if (!config.openai.apiKey) {
    throw new Error("OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.");
  }
}
