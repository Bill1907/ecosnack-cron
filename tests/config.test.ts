import { describe, test, expect } from "bun:test";

describe("config", () => {
  test("모델 기본값과 필수 키 항목이 있다", async () => {
    const { config } = await import("@/config/index.ts");
    expect(typeof config.database.url).toBe("string");
    expect(typeof config.openai.apiKey).toBe("string");
    expect(typeof config.typesafe.apiKey).toBe("string");
    expect(config.models.generate.length).toBeGreaterThan(0);
    expect(config.models.fallbackJudge.length).toBeGreaterThan(0);
  });

  test("Jev 모델은 별칭이 아니라 버전으로 고정된다", async () => {
    const { config } = await import("@/config/index.ts");
    if (!process.env.TYPESAFE_MODEL) {
      expect(config.typesafe.model).toMatch(/^jev-\d+\.\d+/);
    }
  });

  test("validateConfig 가 export 된다", async () => {
    const { validateConfig } = await import("@/config/index.ts");
    expect(typeof validateConfig).toBe("function");
  });
});
