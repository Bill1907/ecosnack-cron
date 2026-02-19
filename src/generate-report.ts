import { validateConfig, config } from "@/config/index.ts";
import { initDatabase, closeDatabase } from "@/services/database.ts";
import { generateDailyReport } from "@/services/daily-report.ts";
import { generateAllPersonalizedReports } from "@/services/personalized-report.ts";
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

    // 3. 일반 데일리 리포트 생성
    const result = await generateDailyReport(undefined, {
      skipQualityEvaluation: config.report.skipQualityEval,
      skipEvidenceRelevanceCheck: config.report.skipEvidenceCheck,
    });

    if (result.success) {
      log(`일반 리포트 생성 완료 (ID: ${result.reportId}, 기사 수: ${result.articleCount})`);
    } else {
      log(`일반 리포트 생성 실패: ${result.error}`, "error");
    }

    // 4. 개인화 데일리 리포트 생성
    log("--- 개인화 리포트 생성 시작 ---");
    const personalizedResult = await generateAllPersonalizedReports();

    if (personalizedResult.total === 0) {
      log("개인화 대상 사용자가 없습니다 (북마크 3개 이상 필요)", "warn");
    } else {
      log(`개인화 리포트 생성 결과: ${personalizedResult.success}/${personalizedResult.total}명 성공`);

      const failed = personalizedResult.results.filter((r) => !r.success);
      if (failed.length > 0) {
        log(`실패 목록:`, "warn");
        for (const f of failed) {
          log(`  - ${f.userId}: ${f.error}`, "warn");
        }
      }
    }

    // 일반 리포트가 실패했으면 에러 종료
    if (!result.success) {
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
