import { config } from "@/config/index.ts";
import { log } from "@/utils/index.ts";

// ============================================
// TypeSafe System One (Jev) 클라이언트
// https://docs.typesafe.ai/api
// SDK 대신 fetch 를 쓴다: 의존성 없이 Bun / Workers 양쪽에서 동작
// ============================================

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export type JevText = string | Record<string, unknown> | unknown[];

export interface NoulQuestion {
  type: "noul";
  instructions: JevText;
  criteria?: { true?: JevText; false?: JevText };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: JevText;
  criteria: Record<string, JevText | null>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: JevText;
  criteria: JevText[]; // 2~10 단계, 낮은 것부터
}

export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export interface ScoreAnswer {
  type: "score";
  score: number; // 0 ~ (단계 수 - 1)
  confidence: number;
  probabilities: Record<string, number>;
  legend: Record<string, string>;
}
export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "JevError";
  }
}

export interface JevCallOptions {
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** state 하나에 질문 여러 개를 한 번에 묻는다. */
export async function askJev(
  state: JevText,
  questions: Record<string, JevQuestion>,
  options: JevCallOptions = {}
): Promise<JevResponse> {
  const { timeoutMs = 15_000, retries = 3, baseDelayMs = 1000 } = options;
  const body = JSON.stringify({ model: config.typesafe.model, state, questions });

  let lastError: JevError = new JevError("Jev 호출 실패");
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(JEV_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.typesafe.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) {
        const data = (await res.json()) as JevResponse;
        const missing = Object.keys(questions).filter((k) => !data.answers?.[k]);
        if (missing.length > 0) {
          throw new JevError(`Jev 응답에 답 누락: ${missing.slice(0, 3).join(", ")}`);
        }
        return data;
      }

      const text = (await res.text()).slice(0, 300);
      lastError = new JevError(`Jev HTTP ${res.status}: ${text}`, res.status);
      if (!RETRYABLE.has(res.status)) throw lastError;

      const retryAfter = Number(res.headers.get("retry-after"));
      if (attempt < retries) {
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : baseDelayMs * 2 ** attempt;
        log(`Jev ${res.status} - ${wait}ms 후 재시도 (${attempt + 1}/${retries})`, "warn");
        await sleep(wait);
      }
    } catch (error) {
      if (error instanceof JevError && error.status && !RETRYABLE.has(error.status)) {
        throw error;
      }
      if (error instanceof JevError && !error.status) throw error; // 응답 형식 오류
      lastError =
        error instanceof JevError
          ? error
          : new JevError(`Jev 네트워크 오류: ${error instanceof Error ? error.message : String(error)}`);
      if (attempt < retries) {
        const wait = baseDelayMs * 2 ** attempt;
        log(`${lastError.message} - ${wait}ms 후 재시도 (${attempt + 1}/${retries})`, "warn");
        await sleep(wait);
      }
    }
  }
  throw lastError;
}

/** Score 답을 0~1 로 정규화 */
export function normalizedScore(answer: JevAnswer | undefined, levels: number): number {
  if (!answer || answer.type !== "score") {
    throw new JevError("Score 답이 아님");
  }
  return answer.score / (levels - 1);
}
