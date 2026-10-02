import { describe, expect, test } from "bun:test";
import { CRONS, jobForCron, runScheduled } from "@/worker.ts";

describe("worker 크론 라우팅", () => {
  test("wrangler.jsonc 의 크론과 CRONS 가 같다", async () => {
    const text = await Bun.file(new URL("../wrangler.jsonc", import.meta.url)).text();
    const crons = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")).triggers.crons as string[];
    expect([...crons].sort()).toEqual(Object.values(CRONS).sort());
  });

  test("크론 식 → 작업", () => {
    expect(jobForCron("0 0,6,12,18 * * *")).toBe("collect");
    expect(jobForCron("0 22 * * *")).toBe("report");
    expect(jobForCron("* * * * *")).toBeUndefined();
  });

  test("등록되지 않은 크론은 아무 작업도 하지 않고 실패한다", async () => {
    await expect(runScheduled({ cron: "* * * * *", scheduledTime: Date.now() })).rejects.toThrow("등록되지 않은 크론");
  });
});
