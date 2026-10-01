import { z } from "zod";
import { askJev, normalizedScore, type ScoreQuestion } from "@/services/jev-client.ts";
import { createStructured } from "@/services/openai-client.ts";
import { config } from "@/config/index.ts";
import { log, getErrorMessage } from "@/utils/index.ts";

// ============================================
// 기사 점수 매기기 (Stage 1 제목, Stage 2 품질)
// 1차: Jev Score (여러 기사를 한 요청에 묶어 병렬)
// 2차: Jev 장애 시 fallbackJudge LLM
// 둘 다 실패하면 throw — "전부 50점" 같은 조용한 폴백은 두지 않는다
// ============================================

export interface ScoreItem {
  title: string;
  source?: string;
  description?: string;
}

interface ScoringSpec {
  name: string;
  /** Jev Score 단계 (낮은 것부터) */
  levels: string[];
  /** state 안의 항목 키를 받아 질문 문장을 만든다 */
  instruction: (key: string) => string;
  /** state 에 넣을 항목 표현 */
  toState: (item: ScoreItem) => unknown;
  /** 한 요청에 묶을 항목 수. 상태가 길수록 정확도가 떨어지므로 작게 */
  groupSize: number;
  /** LLM 폴백용 시스템 프롬프트 */
  fallbackSystem: string;
}

const HEADLINE_SPEC: ScoringSpec = {
  name: "headline",
  levels: [
    "Trivia, lifestyle, clickbait, or opinion with no market relevance",
    "Minor company or local business news",
    "Notable company, sector, or policy news with some market relevance",
    "Major market-moving news: central banks, macro data, big earnings, M&A, trade policy",
  ],
  instruction: (key) =>
    `How newsworthy is \`items.${key}\` for an economy and markets news digest?`,
  toState: (item) => `${item.title} (${item.source ?? "Unknown"})`,
  groupSize: 25,
  fallbackSystem:
    "You are an expert financial news editor. Score each headline 0-100 for economic/financial newsworthiness and likely market impact. Deprioritize clickbait, opinion, and trivia. Return JSON with a score for EVERY index.",
};

const QUALITY_SPEC: ScoringSpec = {
  name: "quality",
  levels: [
    "Thin: little substance, promotional, clickbait, or only a brief mention",
    "Basic: reports a single fact with little context",
    "Solid: clear reporting with some data or context",
    "In-depth: substantive and data-driven, explains causes and impact for a general reader",
  ],
  instruction: (key) =>
    `How substantive and useful is the article \`items.${key}\` for a general reader who wants to understand the economy? Judge from its title and description.`,
  toState: (item) => ({
    title: item.title,
    source: item.source ?? "Unknown",
    description: item.description?.slice(0, 300) || "(no description)",
  }),
  groupSize: 10,
  fallbackSystem:
    "You are a senior news curator. Score each article 0-100 for content depth and usefulness to a general reader, judging from its title and description. Return JSON with a score for EVERY index.",
};

const ScoreListSchema = z.object({
  articles: z.array(z.object({ index: z.number().int(), score: z.number() })),
});

async function scoreGroupWithJev(spec: ScoringSpec, group: ScoreItem[]): Promise<number[]> {
  const state = { items: Object.fromEntries(group.map((item, i) => [`a${i}`, spec.toState(item)])) };
  const questions: Record<string, ScoreQuestion> = Object.fromEntries(
    group.map((_, i) => [
      `q${i}`,
      { type: "score", instructions: spec.instruction(`a${i}`), criteria: spec.levels },
    ])
  );
  const res = await askJev(state, questions);
  return group.map((_, i) => Math.round(normalizedScore(res.answers[`q${i}`], spec.levels.length) * 100));
}

async function scoreWithLLM(spec: ScoringSpec, items: ScoreItem[]): Promise<number[]> {
  const lines = items.map((item, i) => `[${i}] ${JSON.stringify(spec.toState(item))}`);
  const parsed = await createStructured({
    schema: ScoreListSchema,
    name: `${spec.name}_scores`,
    model: config.models.fallbackJudge,
    reasoningEffort: "none",
    system: spec.fallbackSystem,
    user: lines.join("\n"),
    maxOutputTokens: 8000,
    timeoutMs: 120_000,
  });
  const byIndex = new Map(parsed.articles.map((a) => [a.index, a.score]));
  const missing = items.findIndex((_, i) => !byIndex.has(i));
  if (missing >= 0) throw new Error(`${spec.name} LLM 점수 누락 (index ${missing})`);
  return items.map((_, i) => Math.max(0, Math.min(100, byIndex.get(i)!)));
}

async function scoreItems(spec: ScoringSpec, items: ScoreItem[]): Promise<number[]> {
  if (items.length === 0) return [];
  const groups: ScoreItem[][] = [];
  for (let i = 0; i < items.length; i += spec.groupSize) groups.push(items.slice(i, i + spec.groupSize));

  try {
    const scored = await Promise.all(groups.map((g) => scoreGroupWithJev(spec, g)));
    return scored.flat();
  } catch (error) {
    log(`${spec.name} Jev 점수 실패, ${config.models.fallbackJudge} 로 대체: ${getErrorMessage(error)}`, "warn");
  }
  // LLM 폴백: 50개씩 순차
  const out: number[] = [];
  for (let i = 0; i < items.length; i += 50) {
    out.push(...(await scoreWithLLM(spec, items.slice(i, i + 50))));
  }
  return out;
}

/** 제목 뉴스 가치 점수 (0-100) */
export function scoreHeadlines(items: ScoreItem[]): Promise<number[]> {
  return scoreItems(HEADLINE_SPEC, items);
}

/** 제목+설명 기반 품질 점수 (0-100) */
export function scoreQuality(items: ScoreItem[]): Promise<number[]> {
  return scoreItems(QUALITY_SPEC, items);
}
