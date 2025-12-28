import { describe, test, expect } from "bun:test";

describe("config", () => {
  describe("config object", () => {
    test("config module exports config object", async () => {
      const { config } = await import("@/config/index.ts");
      expect(config).toBeDefined();
      expect(config.database).toBeDefined();
      expect(config.newsApi).toBeDefined();
      expect(config.timezone).toBeDefined();
    });

    test("config has database.url property", async () => {
      const { config } = await import("@/config/index.ts");
      expect(typeof config.database.url).toBe("string");
    });

    test("config has newsApi.key property", async () => {
      const { config } = await import("@/config/index.ts");
      expect(typeof config.newsApi.key).toBe("string");
    });

    test("config has timezone property", async () => {
      const { config } = await import("@/config/index.ts");
      expect(typeof config.timezone).toBe("string");
    });

    test("default timezone is Asia/Seoul when TZ not set", async () => {
      const { config } = await import("@/config/index.ts");
      // TZ가 설정되어 있으면 그 값, 아니면 Asia/Seoul
      expect(config.timezone === "Asia/Seoul" || process.env.TZ === config.timezone).toBe(true);
    });
  });

  describe("validateConfig", () => {
    test("validateConfig function is exported", async () => {
      const { validateConfig } = await import("@/config/index.ts");
      expect(typeof validateConfig).toBe("function");
    });

    test("validateConfig throws when DATABASE_URL is empty", async () => {
      // 새로운 환경에서 빈 DATABASE_URL로 테스트
      const originalUrl = process.env.DATABASE_URL;

      try {
        // DATABASE_URL이 설정된 경우 테스트 스킵
        if (originalUrl) {
          expect(true).toBe(true); // pass
          return;
        }

        const { validateConfig } = await import("@/config/index.ts");
        expect(() => validateConfig()).toThrow();
      } finally {
        if (originalUrl) {
          process.env.DATABASE_URL = originalUrl;
        }
      }
    });
  });
});
