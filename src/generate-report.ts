import { validateConfig, config } from "@/config/index.ts";
import { initDatabase, closeDatabase } from "@/services/database.ts";
import { generateDailyReport } from "@/services/daily-report.ts";
import { log, getKSTDate, getErrorMessage } from "@/utils/index.ts";

async function main(): Promise<void> {
  const startTime = Date.now();
  log("=== 데일리 리포트 생성 시작 ===");
  log(`실행 시각 (KST): ${getKSTDate().toLocaleString("ko-KR")}`);

  try {
    // 1. 환경 설정 검증
    validateConfig();
    log("환경 설정 검증 완료");

    // 2. 데이터베이스 초기화
    initDatabase();

    // 3. 데일리 리포트 생성 (환경 변수 기반 옵션)
    const result = await generateDailyReport(undefined, {
      skipQualityEvaluation: config.report.skipQualityEval,
      skipEvidenceRelevanceCheck: config.report.skipEvidenceCheck,
    });

    if (result.success) {
      log(`리포트 생성 완료 (ID: ${result.reportId}, 기사 수: ${result.articleCount})`);
    } else {
      log(`리포트 생성 실패: ${result.error}`, "error");
      process.exit(1);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`=== 데일리 리포트 생성 완료 (${duration}초) ===`);
  } catch (error) {
    log(`리포트 생성 실패: ${getErrorMessage(error)}`, "error");
    process.exit(1);
  } finally {
    await closeDatabase();
  }

  process.exit(0);
}

// 메인 실행
main();
