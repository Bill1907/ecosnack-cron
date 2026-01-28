import { validateConfig } from "@/config/index.ts";
import { initDatabase, closeDatabase } from "@/services/database.ts";
import { generateDailyReport } from "@/services/daily-report.ts";
import { log, getErrorMessage } from "@/utils/index.ts";

async function main(): Promise<void> {
  const startTime = Date.now();

  // 2026년 1월 13일 ~ 1월 27일 (15일)
  const startDate = new Date("2026-01-13T00:00:00+09:00");
  const endDate = new Date("2026-01-27T00:00:00+09:00");

  log("=== 배치 데일리 리포트 생성 시작 ===");
  log(`기간: ${startDate.toISOString().split("T")[0]} ~ ${endDate.toISOString().split("T")[0]}`);

  try {
    validateConfig();
    initDatabase();

    const results: { date: string; success: boolean; error?: string }[] = [];
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split("T")[0]!;
      log(`\n--- ${dateStr} 리포트 생성 중 ---`);

      try {
        const result = await generateDailyReport(currentDate, {
          skipQualityEvaluation: false,
          skipEvidenceRelevanceCheck: true, // 비용 절감
        });

        if (result.success) {
          log(`✓ ${dateStr}: 완료 (ID: ${result.reportId ?? "N/A"}, 기사: ${result.articleCount ?? 0}개)`);
          results.push({ date: dateStr, success: true });
        } else {
          log(`✗ ${dateStr}: ${result.error ?? "알 수 없는 오류"}`, "warn");
          results.push({ date: dateStr, success: false, error: result.error ?? "알 수 없는 오류" });
        }
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        log(`✗ ${dateStr}: ${errorMsg}`, "error");
        results.push({ date: dateStr, success: false, error: errorMsg });
      }

      // 다음 날짜
      currentDate.setDate(currentDate.getDate() + 1);

      // API 레이트 리밋 방지 (2초 대기)
      if (currentDate <= endDate) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // 결과 요약
    log("\n=== 배치 생성 결과 요약 ===");
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;
    log(`성공: ${successCount}개, 실패: ${failCount}개`);

    if (failCount > 0) {
      log("\n실패 목록:");
      results
        .filter((r) => !r.success)
        .forEach((r) => log(`  - ${r.date}: ${r.error}`));
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log(`\n총 소요 시간: ${duration}분`);
  } catch (error) {
    log(`배치 실패: ${getErrorMessage(error)}`, "error");
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

main();
