import { validateConfig, config } from "@/config/index.ts";
import { initDatabase, closeDatabase } from "@/services/database.ts";
import { generateDailyReport } from "@/services/daily-report.ts";
import { generateAllPersonalizedReports } from "@/services/personalized-report.ts";
import { log, getErrorMessage } from "@/utils/index.ts";
import { previousKstDate } from "@/utils/kst.ts";

export interface ReportJobOptions {
  /** 기준일 목록 "YYYY-MM-DD". 비우면 실행 시각 기준 KST 어제 */
  dates?: string[];
  /** 일반 리포트만 만들고 개인화는 건너뛴다 (백필용) */
  skipPersonalized?: boolean;
  /** 개인화만 만든다 */
  personalizedOnly?: boolean;
  dryRun?: boolean;
  /** dry-run 리포트 본문을 저장할 디렉터리 (검수용) */
  outDir?: string;
  /** 실행 시각 (테스트·Workers scheduledTime 주입용) */
  now?: Date;
}

export interface ReportJobResult {
  ok: boolean;
  dates: { date: string; daily?: boolean; dailyError?: string; personalized?: string }[];
}

/**
 * 데일리 리포트(+개인화) 생성. 프로세스를 종료하지 않고 결과만 돌려준다.
 * 일반 리포트가 하나라도 실패하면 ok=false. 개인화 실패는 로그만 남긴다.
 */
export async function runReportJob(options: ReportJobOptions = {}): Promise<ReportJobResult> {
  const startTime = Date.now();
  const dates = options.dates?.length ? options.dates : [previousKstDate(options.now)];
  const result: ReportJobResult = { ok: true, dates: [] };

  log(`=== 리포트 작업 시작: ${dates.length === 1 ? dates[0] : `${dates[0]} ~ ${dates.at(-1)} (${dates.length}일)`}${options.dryRun ? " (dry-run)" : ""} ===`);

  try {
    validateConfig();
    initDatabase();

    for (const date of dates) {
      const entry: ReportJobResult["dates"][number] = { date };
      result.dates.push(entry);

      if (!options.personalizedOnly) {
        const daily = await generateDailyReport(date, {
          skipQualityEvaluation: config.report.skipQualityEval,
          skipEvidenceRelevanceCheck: config.report.skipEvidenceCheck,
          dryRun: options.dryRun,
        });
        entry.daily = daily.success;
        if (options.outDir && daily.data) {
          const path = `${options.outDir}/daily-report-${date}.json`;
          await Bun.write(path, JSON.stringify(daily.data, null, 2));
          log(`dry-run 리포트 본문 저장: ${path}`);
        }
        if (daily.success) {
          log(`일반 리포트 완료 ${date} (ID: ${daily.reportId ?? "dry-run"}, 기사 ${daily.articleCount}개, 품질 ${daily.qualityScore ?? "없음"})`);
        } else {
          entry.dailyError = daily.error;
          result.ok = false;
          log(`일반 리포트 실패 ${date}: ${daily.error}`, "error");
        }
      }

      if (!options.skipPersonalized) {
        const p = await generateAllPersonalizedReports(date, { dryRun: options.dryRun });
        entry.personalized = `${p.success}/${p.total}`;
        if (p.total === 0) {
          log("개인화 대상 사용자가 없습니다 (북마크 3개 이상 필요)", "warn");
        }
        for (const f of p.results.filter((r) => !r.success)) {
          log(`  개인화 실패 - ${f.userId}: ${f.error}`, "warn");
        }
      }
    }
  } catch (error) {
    result.ok = false;
    log(`리포트 작업 실패: ${getErrorMessage(error)}`, "error");
  } finally {
    await closeDatabase();
  }

  log(`=== 리포트 작업 ${result.ok ? "완료" : "실패"} (${((Date.now() - startTime) / 1000).toFixed(1)}초) ${JSON.stringify(result.dates)} ===`);
  return result;
}
