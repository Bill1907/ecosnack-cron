import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { config } from "@/config/index.ts";
import { withRetry, withTimeout } from "@/utils/index.ts";

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.openai.apiKey,
      timeout: 300_000, // 리포트 생성은 1분 이상 걸린다
      maxRetries: 0, // withRetry에서 관리
    });
  }
  return client;
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

export interface StructuredRequest<S extends z.ZodType> {
  schema: S;
  name: string;
  system: string;
  user: string;
  /** 출력(추론 포함) 토큰 상한 */
  maxOutputTokens: number;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
  retries?: number;
}

/**
 * OpenAI chat 요청 본문을 만든다.
 * gpt-5 이후 모델은 `max_tokens`, `temperature≠1` 을 400으로 거부하므로
 * `max_completion_tokens` 만 쓰고 temperature 는 보내지 않는다.
 */
export function buildStructuredParams<S extends z.ZodType>(req: StructuredRequest<S>) {
  return {
    model: req.model ?? config.models.generate,
    messages: [
      { role: "system" as const, content: req.system },
      { role: "user" as const, content: req.user },
    ],
    response_format: zodResponseFormat(req.schema, req.name),
    max_completion_tokens: req.maxOutputTokens,
    ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
  };
}

/** 구조화 출력 요청 + Zod 검증. 빈 응답·잘림·검증 실패도 재시도한다. 끝까지 실패하면 throw. */
export async function createStructured<S extends z.ZodType>(
  req: StructuredRequest<S>
): Promise<z.infer<S>> {
  const params = buildStructuredParams(req);
  const timeoutMs = req.timeoutMs ?? 300_000;

  return withTimeout(
    withRetry(
      async () => {
        const response = await getOpenAIClient().chat.completions.create(params);
        const choice = response.choices[0];
        const content = choice?.message?.content;
        if (!content || choice?.finish_reason === "length") {
          // 간헐적으로 생성이 늘어져 상한에 걸린다 — 같은 요청을 다시 보내면 대개 정상 완료
          throw new Error(
            `${req.name}: ${content ? "응답 잘림" : "빈 응답"} (finish_reason=${choice?.finish_reason ?? "unknown"}, output_tokens=${response.usage?.completion_tokens ?? "?"})`
          );
        }
        return req.schema.parse(JSON.parse(content));
      },
      { retries: req.retries ?? 2, delay: 2000 }
    ),
    timeoutMs,
    `${req.name} 타임아웃 (${Math.round(timeoutMs / 1000)}초)`
  );
}
