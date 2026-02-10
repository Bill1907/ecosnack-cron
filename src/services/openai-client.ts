import OpenAI from "openai";
import { config } from "@/config/index.ts";

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.openai.apiKey,
      timeout: 90000, // 90초 타임아웃 (개별 API 호출)
      maxRetries: 0, // withRetry에서 관리
    });
  }
  return client;
}
