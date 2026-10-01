import { describe, test, expect, spyOn } from "bun:test";
import { Prisma } from "@prisma/client";
import * as database from "@/services/database.ts";
import { saveDailyReport } from "@/services/daily-report.ts";
import { toDbDate } from "@/utils/kst.ts";
import type { DailyReportData } from "@/types/daily-report.ts";

describe("saveDailyReport", () => {
  test("평가가 없으면 update 에서 품질 컬럼을 NULL 로 덮는다 (이전 실행 점수가 남지 않게)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let args: any;
    const spy = spyOn(database, "getPrisma").mockImplementation(
      () =>
        ({
          dailyReport: {
            upsert: async (a: unknown) => {
              args = a;
              return { id: 1, reportDate: toDbDate("2026-09-30"), articleCount: 3 };
            },
          },
        }) as never
    );
    await saveDailyReport({
      reportDate: toDbDate("2026-09-30"),
      title: "t",
      executiveSummary: {},
      marketOverview: {},
      keyInsights: [],
      topKeywords: [],
      sentimentAnalysis: {},
      articleCount: 3,
      articleIds: [1, 2, 3],
    } as unknown as DailyReportData);
    spy.mockRestore();

    expect(args.where.reportDate.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(args.update.qualityScore).toBeNull();
    expect(args.update.qualityEvaluation).toBe(Prisma.DbNull);
    expect(args.update.evidenceValidation).toBe(Prisma.DbNull);
  });
});
