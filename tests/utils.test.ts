import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { getKSTDate, toKSTISOString, log, getErrorMessage } from "@/utils/index.ts";

describe("utils", () => {
  describe("getKSTDate", () => {
    test("returns a valid Date object", () => {
      const result = getKSTDate();
      expect(result).toBeInstanceOf(Date);
    });

    test("returns a date that is not NaN", () => {
      const result = getKSTDate();
      expect(isNaN(result.getTime())).toBe(false);
    });
  });

  describe("toKSTISOString", () => {
    test("returns a valid ISO string", () => {
      const date = new Date("2024-01-15T10:30:00Z");
      const result = toKSTISOString(date);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test("returns an ISO string for any valid date", () => {
      const date = new Date();
      const result = toKSTISOString(date);
      expect(typeof result).toBe("string");
      expect(result.endsWith("Z")).toBe(true);
    });
  });

  describe("log", () => {
    let consoleSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    test("logs info messages with [INFO] prefix", () => {
      log("test message", "info");
      expect(consoleSpy).toHaveBeenCalled();
      const call = consoleSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain("[INFO]");
      expect(call).toContain("test message");
    });

    test("logs error messages with [ERROR] prefix", () => {
      log("error message", "error");
      expect(consoleSpy).toHaveBeenCalled();
      const call = consoleSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain("[ERROR]");
      expect(call).toContain("error message");
    });

    test("logs warn messages with [WARN] prefix", () => {
      log("warn message", "warn");
      expect(consoleSpy).toHaveBeenCalled();
      const call = consoleSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain("[WARN]");
      expect(call).toContain("warn message");
    });

    test("defaults to info level", () => {
      log("default message");
      expect(consoleSpy).toHaveBeenCalled();
      const call = consoleSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain("[INFO]");
    });

    test("includes timestamp in log output", () => {
      log("timestamped message");
      const call = consoleSpy.mock.calls[0]?.[0] as string;
      // ISO timestamp pattern
      expect(call).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("getErrorMessage", () => {
    test("extracts message from Error object", () => {
      const error = new Error("test error");
      const result = getErrorMessage(error);
      expect(result).toBe("test error");
    });

    test("converts string to string", () => {
      const result = getErrorMessage("string error");
      expect(result).toBe("string error");
    });

    test("converts number to string", () => {
      const result = getErrorMessage(404);
      expect(result).toBe("404");
    });

    test("converts object to string", () => {
      const result = getErrorMessage({ code: "ERR_001" });
      expect(result).toBe("[object Object]");
    });

    test("handles null", () => {
      const result = getErrorMessage(null);
      expect(result).toBe("null");
    });

    test("handles undefined", () => {
      const result = getErrorMessage(undefined);
      expect(result).toBe("undefined");
    });
  });
});
