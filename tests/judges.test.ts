import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test";
import { askJev, normalizedScore, JevError, JEV_ENDPOINT } from "@/services/jev-client.ts";
import { buildStructuredParams } from "@/services/openai-client.ts";
import * as jev from "@/services/jev-client.ts";
import * as openaiClient from "@/services/openai-client.ts";
import { scoreHeadlines } from "@/services/article-scoring.ts";
import { judgeEvidence, validateEvidence, calculateEvidenceScore } from "@/services/evidence-validator.ts";
import { evaluateReportQuality, calculateFinalQualityScore } from "@/services/quality-evaluator.ts";
import { z } from "zod";
import type { NewsRecord } from "@/types/index.ts";
import type { DailyReportData } from "@/types/daily-report.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const article = (id: number): NewsRecord => ({
  id,
  title: `기사 ${id}`,
  link: `https://example.com/${id}`,
  headlineSummary: "요약",
  createdAt: new Date(),
});

const reportWithEvidence = (evidence: { text: string; articleId?: number }[]): DailyReportData =>
  ({
    reportDate: new Date("2026-09-30T00:00:00Z"),
    title: "t",
    executiveSummary: { headline: "h", overview: "o", highlights: [], sentiment: { overall: "neutral", description: "d" } },
    marketOverview: { summary: "s", sections: [], outlook: "o", watchList: [] },
    keyInsights: [
      {
        title: "i", summary: "s", analysis: "a",
        implications: { investors: "i", workers: "w", consumers: "c" },
        evidence, relatedArticles: [], actionItems: ["x"], impact: "high", timeHorizon: "short",
      },
    ],
    topKeywords: [],
    sentimentAnalysis: { overall: "neutral", positiveCount: 0, negativeCount: 0, neutralCount: 0 },
    articleCount: 3,
    articleIds: [1, 2, 3],
  }) as DailyReportData;

describe("buildStructuredParams (gpt-5 이후 모델 호환)", () => {
  test("max_tokens / temperature 를 보내지 않고 max_completion_tokens 만 쓴다", () => {
    const p = buildStructuredParams({
      schema: z.object({ a: z.string() }),
      name: "t",
      system: "s",
      user: "u",
      maxOutputTokens: 1234,
    }) as Record<string, unknown>;
    expect(p.max_completion_tokens).toBe(1234);
    expect("max_tokens" in p).toBe(false);
    expect("temperature" in p).toBe(false);
    expect("reasoning_effort" in p).toBe(false);
  });

  test("reasoningEffort 는 지정했을 때만", () => {
    const p = buildStructuredParams({
      schema: z.object({}), name: "t", system: "s", user: "u", maxOutputTokens: 1, reasoningEffort: "none",
    }) as Record<string, unknown>;
    expect(p.reasoning_effort).toBe("none");
  });
});

describe("createStructured 재시도", () => {
  test.skipIf(!process.env.OPENAI_API_KEY)("finish_reason=length 는 재시도해서 성공한다", async () => {
    const client = openaiClient.getOpenAIClient();
    let calls = 0;
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const spy = spyOn(client.chat.completions, "create").mockImplementation((async () => {
      calls++;
      return calls === 1
        ? { choices: [{ finish_reason: "length", message: { content: '{"a":' } }], usage: { completion_tokens: 32000 } }
        : { choices: [{ finish_reason: "stop", message: { content: '{"a":"ok"}' } }], usage: { completion_tokens: 5 } };
    }) as Any);
    const out = await openaiClient.createStructured({
      schema: z.object({ a: z.string() }), name: "t", system: "s", user: "u", maxOutputTokens: 10,
    });
    spy.mockRestore();
    logSpy.mockRestore();
    expect(out).toEqual({ a: "ok" });
    expect(calls).toBe(2);
  }, 10_000);
});

describe("jev-client", () => {
  let originalFetch: typeof fetch;
  let logSpy: Any;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    logSpy.mockRestore();
  });

  const ok = (answers: Record<string, unknown>) =>
    new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });

  test("요청 본문: 고정 모델 + state + questions", async () => {
    let body: Any;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      expect(url).toBe(JEV_ENDPOINT);
      body = JSON.parse(String(init.body));
      return ok({ q: { type: "noul", noul: 0.9 } });
    }) as Any;
    const res = await askJev({ x: 1 }, { q: { type: "noul", instructions: "?" } });
    expect(body.model).toMatch(/^jev-\d/);
    expect(body.state).toEqual({ x: 1 });
    expect(res.answers.q).toEqual({ type: "noul", noul: 0.9 });
  });

  test("429/529 는 재시도, 4xx 는 즉시 실패", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return calls < 3 ? new Response("busy", { status: calls === 1 ? 429 : 529 }) : ok({ q: { type: "noul", noul: 1 } });
    }) as Any;
    await askJev("s", { q: { type: "noul", instructions: "?" } }, { baseDelayMs: 1 });
    expect(calls).toBe(3);

    calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return new Response("bad", { status: 422 });
    }) as Any;
    await expect(askJev("s", { q: { type: "noul", instructions: "?" } }, { baseDelayMs: 1 })).rejects.toBeInstanceOf(JevError);
    expect(calls).toBe(1);
  });

  test("답이 빠진 응답은 실패", async () => {
    globalThis.fetch = mock(async () => ok({})) as Any;
    await expect(askJev("s", { q: { type: "noul", instructions: "?" } }, { baseDelayMs: 1 })).rejects.toThrow("누락");
  });

  test("normalizedScore", () => {
    expect(normalizedScore({ type: "score", score: 1.5, confidence: 1, probabilities: {}, legend: {} }, 4)).toBe(0.5);
  });
});

describe("article-scoring", () => {
  const spies: Any[] = [];
  beforeEach(() => spies.push(spyOn(console, "log").mockImplementation(() => {})));
  afterEach(() => {
    while (spies.length) spies.pop().mockRestore();
  });

  test("Jev Score → 0-100, 25개씩 나눠 요청", async () => {
    const askSpy = spyOn(jev, "askJev").mockImplementation((async (_s: Any, qs: Record<string, unknown>) => ({
      model: "jev-1.13.0",
      answers: Object.fromEntries(Object.keys(qs).map((k) => [k, { type: "score", score: 3, confidence: 1, probabilities: {}, legend: {} }])),
      usage: { input_tokens: 1, output_tokens: 0 },
    })) as Any);
    spies.push(askSpy);
    const scores = await scoreHeadlines(Array.from({ length: 60 }, (_, i) => ({ title: `t${i}` })));
    expect(scores).toHaveLength(60);
    expect(scores.every((s) => s === 100)).toBe(true);
    expect(askSpy).toHaveBeenCalledTimes(3);
  });

  test("Jev 실패 시 LLM 폴백, 둘 다 실패면 throw", async () => {
    spies.push(spyOn(jev, "askJev").mockImplementation((async () => { throw new JevError("down", 503); }) as Any));
    const llm = spyOn(openaiClient, "createStructured").mockImplementation((async () => ({
      articles: [{ index: 0, score: 80 }, { index: 1, score: 20 }],
    })) as Any);
    spies.push(llm);
    expect(await scoreHeadlines([{ title: "a" }, { title: "b" }])).toEqual([80, 20]);

    llm.mockImplementation((async () => { throw new Error("llm down"); }) as Any);
    await expect(scoreHeadlines([{ title: "a" }])).rejects.toThrow("llm down");
  });
});

describe("evidence-validator", () => {
  const spies: Any[] = [];
  beforeEach(() => spies.push(spyOn(console, "log").mockImplementation(() => {})));
  afterEach(() => {
    while (spies.length) spies.pop().mockRestore();
  });

  const jevVerdict = (choice: string, confidence: number) =>
    (async () => ({ model: "jev-1.13.0", answers: { verdict: { type: "choice", choice, confidence, probabilities: {} } }, usage: { input_tokens: 1, output_tokens: 0 } })) as Any;

  test("Jev 확신도가 높으면 그대로, 낮으면 LLM 재판정", async () => {
    const askSpy = spyOn(jev, "askJev").mockImplementation(jevVerdict("supports", 0.95));
    const llm = spyOn(openaiClient, "createStructured").mockImplementation((async () => ({ verdict: "contradicts" })) as Any);
    spies.push(askSpy, llm);

    expect(await judgeEvidence("c", article(1))).toMatchObject({ verdict: "supports", judge: "jev-1.13.0" });
    expect(llm).not.toHaveBeenCalled();

    askSpy.mockImplementation(jevVerdict("supports", 0.5));
    const low = await judgeEvidence("c", article(1));
    expect(low.verdict).toBe("contradicts");
    expect(low.judge).not.toContain("jev");
  });

  test("판정 실패는 '유효'가 아니라 unverified, 점수에서 제외", async () => {
    spies.push(spyOn(jev, "askJev").mockImplementation((async () => { throw new JevError("down", 503); }) as Any));
    spies.push(spyOn(openaiClient, "createStructured").mockImplementation((async () => { throw new Error("llm down"); }) as Any));

    const v = await validateEvidence(
      reportWithEvidence([{ text: "a", articleId: 1 }, { text: "b", articleId: 99 }, { text: "c" }]),
      [article(1), article(2)]
    );
    expect(v.details.map((d) => d.status)).toEqual(["unverified", "invalid_id", "unverified"]);
    expect(v.validCount).toBe(0);
    expect(v.invalidCount).toBe(1);
    expect(v.unverifiedCount).toBe(2);
    expect(v.validationRate).toBe(0);
    expect(calculateEvidenceScore(v)).toBe(0);
  });

  test("판정된 근거가 없으면 점수는 null", async () => {
    const v = await validateEvidence(reportWithEvidence([{ text: "a" }]), [article(1)]);
    expect(calculateEvidenceScore(v)).toBeNull();
  });
});

describe("quality-evaluator", () => {
  test("Jev Score 6개 → 기준별 0-10, 종합은 코드 평균", async () => {
    const levels = 3;
    const askSpy = spyOn(jev, "askJev").mockImplementation((async (_s: Any, qs: Record<string, unknown>) => ({
      model: "jev-1.13.0",
      answers: Object.fromEntries(Object.keys(qs).map((k, i) => [k, { type: "score", score: i % 2 === 0 ? 2 : 1, confidence: 0.9, probabilities: {}, legend: {} }])),
      usage: { input_tokens: 1, output_tokens: 0 },
    })) as Any);
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const q = await evaluateReportQuality(reportWithEvidence([]));
    askSpy.mockRestore();
    logSpy.mockRestore();

    expect(Object.keys(q.criteria)).toHaveLength(6);
    expect(q.criteria.specificity.score).toBe((2 / (levels - 1)) * 10);
    expect(q.criteria.evidenceBased.score).toBe(5);
    expect(q.overallScore).toBe(75);
    expect(q.judge).toBe("jev-1.13.0");
  });

  test("calculateFinalQualityScore: 근거 점수 없으면 품질만", () => {
    const q = { overallScore: 80 } as Any;
    expect(calculateFinalQualityScore(q, null)).toBe(80);
    expect(calculateFinalQualityScore(q, 50)).toBe(68);
  });
});
