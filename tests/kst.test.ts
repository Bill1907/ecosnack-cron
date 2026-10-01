import { describe, test, expect } from "bun:test";
import {
  kstDateString,
  kstDayRange,
  previousKstDate,
  addDays,
  toDbDate,
  fromDbDate,
  dateRange,
  isKstDateString,
} from "@/utils/kst.ts";
import { parseReportArgs } from "@/generate-report.ts";

// 이 파일은 TZ=UTC, TZ=Asia/Seoul 두 번 돌려 결과가 같아야 한다 (bun run test:tz)
describe(`kst (TZ=${process.env.TZ ?? "unset"})`, () => {
  test("kstDateString: UTC 15:00 은 KST 다음날 00:00", () => {
    expect(kstDateString(new Date("2026-09-30T14:59:59.999Z"))).toBe("2026-09-30");
    expect(kstDateString(new Date("2026-09-30T15:00:00.000Z"))).toBe("2026-10-01");
  });

  test("kstDayRange: KST 00:00 ~ 다음날 00:00 (UTC 전날 15:00 ~ 당일 15:00)", () => {
    const { start, end } = kstDayRange("2026-09-30");
    expect(start.toISOString()).toBe("2026-09-29T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-30T15:00:00.000Z");
  });

  test("previousKstDate: 크론 실행 시각(KST 07:00 = UTC 22:00 전날) 기준 어제", () => {
    // 2026-10-01 07:02 KST
    expect(previousKstDate(new Date("2026-09-30T22:02:00Z"))).toBe("2026-09-30");
    // 2026-10-01 00:30 KST — KST 로는 이미 10/1 이므로 어제는 9/30
    expect(previousKstDate(new Date("2026-09-30T15:30:00Z"))).toBe("2026-09-30");
    // 2026-09-30 23:59 KST
    expect(previousKstDate(new Date("2026-09-30T14:59:00Z"))).toBe("2026-09-29");
  });

  test("월말·연말·윤년 경계", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(previousKstDate(new Date("2026-12-31T22:00:00Z"))).toBe("2026-12-31");
  });

  test("toDbDate / fromDbDate 는 왕복이 같다 (Postgres date 는 UTC 자정)", () => {
    const d = toDbDate("2026-09-30");
    expect(d.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(fromDbDate(d)).toBe("2026-09-30");
  });

  test("dateRange 는 양끝 포함", () => {
    expect(dateRange("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(() => dateRange("2026-10-02", "2026-10-01")).toThrow();
  });

  test("잘못된 날짜는 거부", () => {
    expect(isKstDateString("2026-02-30")).toBe(false);
    expect(isKstDateString("2026-9-30")).toBe(false);
    expect(() => kstDayRange("2026-13-01")).toThrow();
  });
});

describe("parseReportArgs", () => {
  test("인자가 없으면 dates 는 undefined (= KST 어제)", () => {
    expect(parseReportArgs([]).dates).toBeUndefined();
  });
  test("--date", () => {
    expect(parseReportArgs(["--date", "2026-09-26"]).dates).toEqual(["2026-09-26"]);
  });
  test("--from/--to + 플래그", () => {
    const a = parseReportArgs(["--from", "2026-08-01", "--to", "2026-08-03", "--skip-personalized", "--dry-run"]);
    expect(a.dates).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(a.skipPersonalized).toBe(true);
    expect(a.dryRun).toBe(true);
  });
  test("잘못된 조합은 거부", () => {
    expect(() => parseReportArgs(["--date", "2026-9-1"])).toThrow();
    expect(() => parseReportArgs(["--from", "2026-08-01"])).toThrow();
    expect(() => parseReportArgs(["--date", "2026-08-01", "--from", "2026-08-01", "--to", "2026-08-02"])).toThrow();
  });
});
