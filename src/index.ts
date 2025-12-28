import { config, validateConfig } from "@/config/index.ts";
import { initDatabase, closeDatabase, saveNewsArticles } from "@/services/database.ts";
import { fetchAllNews } from "@/services/news-fetcher.ts";
import { analyzeNews } from "@/services/news-analyzer.ts";
import { log, getKSTDate, getErrorMessage } from "@/utils/index.ts";

async function main(): Promise<void> {
  const startTime = Date.now();
  log("=== EcoSnack 크론 작업 시작 ===");
  log(`실행 시각 (KST): ${getKSTDate().toLocaleString("ko-KR")}`);

  try {
    // 1. 환경 설정 검증
    validateConfig();
    log("환경 설정 검증 완료");

    // 2. 데이터베이스 초기화
    initDatabase();

    // 3. 뉴스 수집
    const fetchResult = await fetchAllNews();
    if (!fetchResult.success) {
      throw new Error(`뉴스 수집 실패: ${fetchResult.error}`);
    }

    if (fetchResult.articles.length === 0) {
      log("수집된 뉴스가 없습니다.");
    } else {
      // 4. 뉴스 분석
      const analysisResult = await analyzeNews(fetchResult.articles);
      if (!analysisResult.success) {
        throw new Error(`뉴스 분석 실패: ${analysisResult.error}`);
      }

      // 5. 데이터베이스 저장
      const savedCount = await saveNewsArticles(analysisResult.articles);
      log(`저장 완료: ${savedCount}개 뉴스`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`=== 크론 작업 완료 (${duration}초) ===`);
  } catch (error) {
    log(`크론 작업 실패: ${getErrorMessage(error)}`, "error");
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

// 메인 실행
main();
