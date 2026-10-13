import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import { analyzeNews } from "@/services/news-analyzer.ts";
import * as database from "@/services/database.ts";
import * as openaiClient from "@/services/openai-client.ts";
import * as scoring from "@/services/article-scoring.ts";
import * as promptBuilder from "@/services/prompt-builder.ts";
import type { RawNewsArticle } from "@/types/index.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const realSetTimeout = globalThis.setTimeout;
// 재시도 백오프(2초·4초)만 건너뛴다. 타임아웃 가드(170초 이상)는 그대로 둔다.
const skipBackoff = () => {
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...args: unknown[]) =>
    realSetTimeout(fn, ms !== undefined && ms <= 5000 ? 0 : ms, ...args)) as unknown as typeof setTimeout;
};

const reply = (body: unknown) => ({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(body) } }],
  usage: { completion_tokens: 1 },
});

describe("createStructured validate 훅", () => {
  const schema = z.object({ text: z.string() });
  const req = { schema, name: "t", system: "s", user: "u", maxOutputTokens: 10 };
  let createSpy: Any;
  let logSpy: Any;

  beforeEach(() => {
    skipBackoff();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    createSpy = spyOn(openaiClient.getOpenAIClient().chat.completions, "create");
  });
  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
    createSpy.mockRestore();
    logSpy.mockRestore();
  });

  const queue = (bodies: unknown[]) => {
    let n = 0;
    createSpy.mockImplementation((async () => reply(bodies[Math.min(n++, bodies.length - 1)])) as Any);
  };

  test("사유를 돌려주면 `언어 오염: <사유>` 로 재시도하고, 정상 응답이 나오면 그것을 돌려준다", async () => {
    queue([{ text: "bad" }, { text: "good" }]);
    const seen: string[] = [];
    const out = await openaiClient.createStructured({
      ...req,
      validate: (o) => {
        seen.push(o.text);
        return o.text === "bad" ? "text 'x'" : null;
      },
    });
    expect(out).toEqual({ text: "good" });
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(["bad", "good"]);
  });

  test("끝까지 위반이면 `언어 오염: <사유>` 로 throw (총 3회 호출)", async () => {
    queue([{ text: "bad" }]);
    const p = openaiClient.createStructured({ ...req, validate: () => "text 'x' (foreign-script)" });
    await expect(p).rejects.toThrow("언어 오염: text 'x' (foreign-script)");
    expect(createSpy).toHaveBeenCalledTimes(3);
  });

  test("validate 가 없으면 이전과 같다 (한 번 호출, 그대로 반환)", async () => {
    queue([{ text: "주의深이" }]);
    const out = await openaiClient.createStructured(req);
    expect(out).toEqual({ text: "주의深이" });
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  test("validate 는 스키마 파싱이 성공한 뒤에만 불린다", async () => {
    queue([{ wrong: 1 }, { text: "ok" }]);
    let calls = 0;
    const out = await openaiClient.createStructured({
      ...req,
      validate: () => {
        calls++;
        return null;
      },
    });
    expect(out).toEqual({ text: "ok" });
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(calls).toBe(1);
  });

  test("비재시도 HTTP 오류(400)는 validate 와 무관하게 한 번만 호출", async () => {
    createSpy.mockImplementation((async () => {
      throw Object.assign(new Error("400 bad request"), { status: 400 });
    }) as Any);
    await expect(openaiClient.createStructured({ ...req, validate: () => null })).rejects.toThrow("400");
    expect(createSpy).toHaveBeenCalledTimes(1);
  });
});

// 길이 하한(스키마)을 넘기는 정상 문장
const fill = (min: number) => "정상 문장이에요. ".repeat(Math.ceil(min / 9)).trim();

const analysis = (mainPoint = fill(200), keywords = ["금리", "환율", "증시"]) => ({
  headline_summary: fill(150),
  so_what: { main_point: mainPoint, market_signal: fill(120), time_horizon: "short" },
  impact_analysis: {
    investors: { summary: fill(150), action_items: ["분산 투자"], sectors_affected: ["반도체"] },
    workers: { summary: fill(150), industries_affected: ["제조업"], job_outlook: fill(80) },
    consumers: { summary: fill(150), price_impact: fill(80), spending_advice: fill(80) },
  },
  related_context: { background: fill(150), related_events: ["금리 결정"], what_to_watch: fill(100) },
  keywords,
  category: "markets",
  sentiment: { overall: "neutral", confidence: 0.7 },
  importance_score: 7,
});

const article = (title: string, description?: string): RawNewsArticle => ({
  title,
  link: "https://example.com/a",
  description,
  pubDate: new Date("2026-10-12"),
  source: "CNBC",
  region: "US",
});

describe("analyzeNews — 외국 문자 오염 재생성", () => {
  let createSpy: Any;
  let logSpy: Any;
  let originalFetch: typeof fetch;
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    skipBackoff();
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("<html></html>", { status: 200 })) as unknown as typeof fetch;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    spies.push(spyOn(database, "getExistingLinks").mockImplementation(async () => new Set<string>()));
    spies.push(
      spyOn(promptBuilder, "buildAnalysisPrompt").mockImplementation(
        async () => ({ system: "s", user: "u" }) as Awaited<ReturnType<typeof promptBuilder.buildAnalysisPrompt>>
      )
    );
    spies.push(spyOn(scoring, "scoreQuality").mockImplementation(async (items) => items.map(() => 70)));
    createSpy = spyOn(openaiClient.getOpenAIClient().chat.completions, "create");
    spies.push(createSpy);
  });
  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.fetch = originalFetch;
    logSpy.mockRestore();
    while (spies.length) spies.pop()!.mockRestore();
  });

  const queue = (bodies: unknown[]) => {
    let n = 0;
    createSpy.mockImplementation((async () => reply(bodies[Math.min(n++, bodies.length - 1)])) as Any);
  };
  const logs = () => logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");

  test("1회차 오염(주의深이), 2회차 정상 → 호출 2회, 정상 결과가 저장 대상이 된다", async () => {
    queue([analysis(`${fill(200)} 주의深이 확인해요.`), analysis()]);

    const result = await analyzeNews([article("Fed holds rates", "The Fed held rates steady.")]);

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]?.soWhat?.main_point).not.toContain("深");
    expect(result.articles[0]?.soWhat?.main_point).toBe(fill(200));
    expect(logs()).toContain("언어 오염");
  });

  test("keywords 같은 배열 값의 오염도 잡는다 (path 가 로그에 남는다)", async () => {
    queue([analysis(fill(200), ["금리", "次の", "증시"]), analysis()]);

    const result = await analyzeNews([article("Fed holds rates")]);

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(result.articles[0]?.keywords).toEqual(["금리", "환율", "증시"]);
    expect(logs()).toContain('keywords[1] "次の"');
  });

  test("3회 모두 오염이면 그 기사는 null(스킵) — 결과 0개, Stage 3 실패, 로그에 `언어 오염`", async () => {
    queue([analysis(`${fill(200)} 주의深이 확인해요.`)]);

    const result = await analyzeNews([article("Fed holds rates")]);

    expect(createSpy).toHaveBeenCalledTimes(3);
    expect(result.articles).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("성공률");
    expect(logs()).toContain("언어 오염");
    expect(logs()).toContain('so_what.main_point "深"');
  });

  test("입력 제목·설명에 있는 한자는 통과 (재시도 없음)", async () => {
    queue([analysis(`${fill(200)} 美 10년물 금리와 삼성電子 실적을 같이 봐요.`)]);

    const result = await analyzeNews([article("美 10년물 금리 급등", "삼성電子 실적 발표")]);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.articles[0]?.soWhat?.main_point).toContain("美 10년물");
    expect(logs()).not.toContain("언어 오염");
  });

  test("입력에 없는 한자는 신문 약어가 아니면 오염 (美 는 통과, 企業 은 재시도)", async () => {
    queue([analysis(`${fill(200)} 企業 내부는 美 증시를 봐요.`), analysis()]);

    const result = await analyzeNews([article("Fed holds rates")]);

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(result.articles).toHaveLength(1);
    expect(logs()).toContain('"企業"');
  });

  test("일부 기사만 끝까지 오염이면 그 기사만 빠지고 나머지는 저장 대상", async () => {
    createSpy.mockImplementation((async (params: Any) => {
      const user = JSON.stringify(params.messages);
      void user;
      return reply(analysis());
    }) as Any);
    // buildAnalysisPrompt 는 목이라 기사 구분이 안 되므로, 호출 순서로 구분한다 (기사 3개 병렬 → 호출 순서 불안정)
    // 대신 제목별로 user 프롬프트를 다르게 만들어 응답을 고른다.
    spies.pop()!.mockRestore(); // createSpy
    spies.push(
      spyOn(promptBuilder, "buildAnalysisPrompt").mockImplementation(
        async (a: Any) => ({ system: "s", user: a.title }) as Awaited<ReturnType<typeof promptBuilder.buildAnalysisPrompt>>
      )
    );
    createSpy = spyOn(openaiClient.getOpenAIClient().chat.completions, "create").mockImplementation((async (params: Any) => {
      const title = params.messages[1].content as string;
      return reply(title.includes("BAD") ? analysis(`${fill(200)} 주의深이`) : analysis());
    }) as Any);
    spies.push(createSpy);

    const result = await analyzeNews([
      { ...article("ok one"), link: "https://example.com/1" },
      { ...article("BAD one"), link: "https://example.com/2" },
      { ...article("ok two"), link: "https://example.com/3" },
    ]);

    expect(result.articles.map((a) => a.title).sort()).toEqual(["ok one", "ok two"]);
    expect(result.success).toBe(true); // 2/3 ≥ 50%
  });
});
