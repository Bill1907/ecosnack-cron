import OpenAI from "openai";
import { config } from "@/config/index.ts";

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.openai.apiKey,
      timeout: 120000, // 120초 타임아웃 (데일리 리포트 생성용)
      maxRetries: 0, // withRetry에서 관리
    });
  }
  return client;
}
