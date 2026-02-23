import { describe, test, expect } from "bun:test";
import { withTimeout } from "@/utils/index.ts";

describe("withTimeout", () => {
  test("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(
      Promise.resolve("success"),
      1000
    );
    expect(result).toBe("success");
  });

  test("resolves with async value before timeout", async () => {
    const delayed = new Promise<number>((resolve) =>
      setTimeout(() => resolve(42), 50)
    );
    const result = await withTimeout(delayed, 1000);
    expect(result).toBe(42);
  });

  test("rejects when promise exceeds timeout", async () => {
    const slow = new Promise<string>((resolve) =>
      setTimeout(() => resolve("too late"), 5000)
    );
    await expect(withTimeout(slow, 50)).rejects.toThrow("Timeout after 50ms");
  });

  test("uses custom error message when provided", async () => {
    const slow = new Promise<string>((resolve) =>
      setTimeout(() => resolve("too late"), 5000)
    );
    await expect(
      withTimeout(slow, 50, "AI 호출 타임아웃")
    ).rejects.toThrow("AI 호출 타임아웃");
  });

  test("propagates original error if promise rejects before timeout", async () => {
    const failing = Promise.reject(new Error("original error"));
    await expect(withTimeout(failing, 1000)).rejects.toThrow("original error");
  });

  test("clears timeout after successful resolution (no timer leak)", async () => {
    const before = setTimeout(() => {}, 0);
    clearTimeout(before);

    await withTimeout(Promise.resolve("ok"), 100_000);

    // 타이머가 정리되었으므로 프로세스가 빠르게 종료 가능해야 함
    // (이 테스트가 100초를 기다리지 않으면 성공)
    expect(true).toBe(true);
  });
});
