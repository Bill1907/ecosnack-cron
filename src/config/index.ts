import "dotenv/config";

export const config = {
  database: {
    url: process.env.DATABASE_URL ?? "",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    titleFilterLimit: 30, // Stage 1: 250 -> 30
    qualityFilterLimit: 20, // Stage 2: 30 -> 20
  },
  models: {
    // 글을 쓰는 역할: 기사 상세 분석, 데일리 리포트
    generate: process.env.OPENAI_MODEL ?? "gpt-6-luna",
    // Jev 확신도가 낮을 때, 또는 Jev 장애 시 대신 판정하는 모델
    fallbackJudge: process.env.OPENAI_FALLBACK_JUDGE_MODEL ?? "gpt-5.6-luna",
  },
  typesafe: {
    apiKey: process.env.TYPESAFE_API_KEY ?? "",
    // 별칭(jev-latest)은 버전이 바뀌며 판정이 달라질 수 있어 버전 고정
    model: process.env.TYPESAFE_MODEL ?? "jev-1.13.0",
  },
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
  if (!config.typesafe.apiKey) {
    throw new Error("TYPESAFE_API_KEY 환경 변수가 설정되지 않았습니다.");
  }
}
