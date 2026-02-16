import { validateConfig } from "@/config/index.ts";
import { initDatabase, closeDatabase } from "@/services/database.ts";
import { generateAllPersonalizedReports } from "@/services/personalized-report.ts";
import { log, getKSTDate, getErrorMessage } from "@/utils/index.ts";

async function main(): Promise<void> {
  const startTime = Date.now();
  log("=== 개인화 데일리 리포트 생성 시작 ===");
  log(`실행 시각 (KST): ${getKSTDate().toLocaleString("ko-KR")}`);

  try {
    // 1. 환경 설정 검증
    validateConfig();
    log("환경 설정 검증 완료");

    // 2. 데이터베이스 초기화
    initDatabase();

    // 3. 개인화 리포트 생성
    const result = await generateAllPersonalizedReports();

    if (result.total === 0) {
      log("개인화 대상 사용자가 없습니다 (북마크 3개 이상 필요)", "warn");
    } else {
      log(`개인화 리포트 생성 결과: ${result.success}/${result.total}명 성공`);

      // 실패한 사용자 로그
      const failed = result.results.filter((r) => !r.success);
      if (failed.length > 0) {
        log(`실패 목록:`, "warn");
        for (const f of failed) {
          log(`  - ${f.userId}: ${f.error}`, "warn");
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`=== 개인화 데일리 리포트 생성 완료 (${duration}초) ===`);
  } catch (error) {
    log(`개인화 리포트 생성 실패: ${getErrorMessage(error)}`, "error");
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

main();
