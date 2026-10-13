import { describe, test, expect, spyOn, mock, beforeEach, afterEach } from "bun:test";
import { generateDailyReport } from "@/services/daily-report.ts";
import * as database from "@/services/database.ts";
import * as openaiClient from "@/services/openai-client.ts";
import { toDbDate } from "@/utils/kst.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const DATE = "2026-10-12";

const realSetTimeout = globalThis.setTimeout;
// 재시도 백오프(2초·4초)만 건너뛴다. 타임아웃 가드(420초)는 그대로 둔다.
const skipBackoff = () => {
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...args: unknown[]) =>
    realSetTimeout(fn, ms !== undefined && ms <= 5000 ? 0 : ms, ...args)) as unknown as typeof setTimeout;
};

const reply = (body: unknown) => ({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(body) } }],
  usage: { completion_tokens: 1 },
});

// 스키마 길이 하한을 넘기는 정상 문장
const fill = (min: number) => "정상 문장이에요. ".repeat(Math.ceil(min / 9)).trim();

const aiReport = (overview = fill(650)) => ({
  title: "코스피 5000 간다? 전문가들 의견 갈려",
  executiveSummary: {
    headline: "내 월급으로 집 살 수 있을까?",
    overview,
    highlights: [1, 2, 3].map((id) => ({
      title: `하이라이트 ${id}`,
      description: fill(110),
      relatedArticleId: id,
    })),
    sentiment: { overall: "mixed", description: fill(90) },
  },
  marketOverview: {
    summary: fill(450),
    sections: [1, 2].map((id) => ({
      title: `섹션 ${id}`,
      content: fill(320),
      keyData: ["10년물 4.5%"],
      relatedArticleIds: [id],
    })),
    outlook: fill(220),
    watchList: ["FOMC", "CPI"],
  },
  keyInsights: [1, 2].map((id) => ({
    title: `인사이트 ${id}`,
    summary: fill(160),
    analysis: fill(420),
    implications: { investors: fill(110), workers: fill(110), consumers: fill(110) },
    evidence: [
      { text: "근거 설명입니다 하나", articleId: id, source: null },
      { text: "근거 설명입니다 둘", articleId: null, source: "연준" },
    ],
    relatedArticleIds: [id],
    actionItems: ["분산 투자"],
    impact: "high",
    timeHorizon: "short",
  })),
  topKeywords: ["금리", "환율", "증시"],
});

const row = (id: number, title: string, description: string | null = null) => ({
  id,
  title,
  link: `https://example.com/${id}`,
  description,
  pubDate: new Date("2026-10-12T01:00:00Z"),
  source: "CNBC",
  region: "US",
  imageUrl: null,
  headlineSummary: null as string | null,
  soWhat: null,
  impactAnalysis: null,
  relatedContext: null,
  keywords: [],
  category: null,
  sentiment: null,
  importanceScore: 7,
  createdAt: new Date("2026-10-12T02:00:00Z"),
});

describe("generateDailyReport — 외국 문자 오염 재생성", () => {
  let createSpy: Any;
  let logSpy: Any;
  let upsert: Any;
  let prismaSpy: Any;
  let rows: ReturnType<typeof row>[];

  beforeEach(() => {
    skipBackoff();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    rows = [row(1, "Fed holds rates"), row(2, "Oil prices fall"), row(3, "Tech stocks rally")];
    upsert = mock(async () => ({ id: 1, reportDate: toDbDate(DATE), articleCount: 3 }));
    prismaSpy = spyOn(database, "getPrisma").mockImplementation(
      () => ({ article: { findMany: async () => rows }, dailyReport: { upsert } }) as never
    );
    createSpy = spyOn(openaiClient.getOpenAIClient().chat.completions, "create");
  });
  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
    createSpy.mockRestore();
    prismaSpy.mockRestore();
    logSpy.mockRestore();
  });

  const queue = (bodies: unknown[]) => {
    let n = 0;
    createSpy.mockImplementation((async () => reply(bodies[Math.min(n++, bodies.length - 1)])) as Any);
  };
  const logs = () => logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
  const run = () => generateDailyReport(DATE, { skipQualityEvaluation: true });

  test("1회차 오염(중요해요.ليಗೆ盈彩票?), 2회차 정상 → 호출 2회, 성공, 정상 본문만 저장", async () => {
    queue([aiReport(`${fill(650)} 중요해요.ليಗೆ盈彩票?`), aiReport()]);

    const result = await run();

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    const saved = JSON.stringify(upsert.mock.calls[0]![0]);
    expect(saved).not.toContain("盈彩票");
    expect(saved).not.toContain("ليಗೆ");
    expect(logs()).toContain("언어 오염");
    expect(logs()).toContain("executiveSummary.overview");
  });

  test("keyInsights 안쪽 배열 값의 오염도 잡는다 (path 가 로그에 남는다)", async () => {
    const bad = aiReport();
    bad.keyInsights[1]!.actionItems = ["分散投資"];
    queue([bad, aiReport()]);

    const result = await run();

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(logs()).toContain('keyInsights[1].actionItems[0] "分散投資"');
  });

  test("3회 모두 오염이면 리포트 생성은 실패하고 저장은 한 번도 불리지 않는다", async () => {
    queue([aiReport(`${fill(650)} 중요해요.ليಗೆ盈彩票?`)]);

    const result = await run();

    expect(createSpy).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(false);
    expect(result.error).toContain("언어 오염");
    expect(upsert).toHaveBeenCalledTimes(0);
  });

  test("입력 기사 제목·설명에 있는 한자는 통과 (재시도 없음)", async () => {
    rows = [row(1, "美 10년물 금리 급등", "삼성電子 실적 발표"), row(2, "Oil prices fall"), row(3, "Tech stocks rally")];
    queue([aiReport(`${fill(650)} 美 10년물 금리와 삼성電子 실적을 같이 봐요.`)]);

    const result = await run();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(logs()).not.toContain("언어 오염");
  });

  test("입력에 없는 한자는 신문 약어가 아니면 오염 (美 는 통과, 電子 는 재시도)", async () => {
    queue([aiReport(`${fill(650)} 美 증시와 삼성電子 실적을 같이 봐요.`), aiReport()]);

    const result = await run();

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(logs()).toContain('"電子"');
  });

  test("입력 기사 분석문(요약)에 있는 한자도 통과 — 모델에 준 입력 전체가 원문이다", async () => {
    rows = [
      { ...row(1, "코스닥 정책 화두"), headlineSummary: "코스닥 시장에서 다산다사 多産多死 정책이 화두예요." },
      row(2, "Oil prices fall"),
      row(3, "Tech stocks rally"),
    ];
    queue([aiReport(`${fill(650)} 多産多死 정책이 코스닥에 미칠 영향을 봐요.`)]);

    const result = await run();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(logs()).not.toContain("언어 오염");
  });

  test("검사는 sanitizeReportText 전의 원 응답에 한다 (정리되기 전의 지시문 누출도 재생성)", async () => {
    // sanitizeMetaComments 가 지워 주는 문구("600자 이상으로 작성")라도 원 응답에 있으면 재생성
    queue([aiReport(`${fill(650)} 600자 이상으로 작성했어요.`), aiReport()]);

    const result = await run();

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(logs()).toContain("prompt-leak");
  });
});
