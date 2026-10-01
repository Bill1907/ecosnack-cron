import { validateConfig } from "@/config/index.ts";
import { initDatabase, closeDatabase, saveNewsArticlesBatch } from "@/services/database.ts";
import { fetchAllNews } from "@/services/news-fetcher.ts";
import { analyzeNews } from "@/services/news-analyzer.ts";
import { log, getErrorMessage } from "@/utils/index.ts";

export interface CollectNewsOptions {
  /** true 면 DB에 저장하지 않는다 (중복 조회는 한다) */
  dryRun?: boolean;
}

export interface CollectNewsResult {
  ok: boolean;
  fetched: number;
  analyzed: number;
  saved: number;
  error?: string;
}

/**
 * 뉴스 수집 → 분석 → 저장. 프로세스를 종료하지 않고 결과만 돌려준다
 * (Bun CLI 와 Workers scheduled 핸들러가 같이 쓴다).
 */
export async function runCollectNews(options: CollectNewsOptions = {}): Promise<CollectNewsResult> {
  const startTime = Date.now();
  log(`=== EcoSnack 뉴스 수집 시작${options.dryRun ? " (dry-run: 저장 안 함)" : ""} ===`);
  const result: CollectNewsResult = { ok: false, fetched: 0, analyzed: 0, saved: 0 };

  try {
    validateConfig();
    initDatabase();

    const fetchResult = await fetchAllNews();
    if (!fetchResult.success) {
      throw new Error(`뉴스 수집 실패: ${fetchResult.error}`);
    }
    result.fetched = fetchResult.articles.length;

    if (fetchResult.articles.length === 0) {
      log("수집된 뉴스가 없습니다.", "warn");
    } else {
      const analysis = await analyzeNews(fetchResult.articles);
      result.analyzed = analysis.articles.length;

      // 성공률 미달이어도 분석된 기사는 저장하고, 작업은 실패로 끝낸다
      if (analysis.articles.length > 0 && !options.dryRun) {
        result.saved = await saveNewsArticlesBatch(analysis.articles);
        log(`저장 완료: ${result.saved}개 뉴스`);
      }
      if (!analysis.success) {
        throw new Error(`뉴스 분석 실패: ${analysis.error}`);
      }
    }

    result.ok = true;
    log(`=== 뉴스 수집 완료 (${((Date.now() - startTime) / 1000).toFixed(2)}초) ===`);
  } catch (error) {
    result.error = getErrorMessage(error);
    log(`뉴스 수집 작업 실패: ${result.error}`, "error");
  } finally {
    await closeDatabase();
  }
  return result;
}
