import { runCollectNews } from "@/jobs/collect-news.ts";
import { runReportJob } from "@/jobs/report.ts";

/**
 * Cloudflare Workers 진입점. Cron Trigger 하나가 작업 하나에 대응한다.
 * 크론 식은 UTC 기준 — wrangler.jsonc 의 triggers.crons 와 반드시 같아야 한다.
 */
export const CRONS = {
  /** KST 03/09/15/21시 — 뉴스 수집·분석 */
  collect: "0 0,6,12,18 * * *",
  /** KST 07시 — 전날(KST) 데일리 리포트 */
  report: "0 22 * * *",
} as const;

export type JobName = keyof typeof CRONS;

export function jobForCron(cron: string): JobName | undefined {
  return (Object.keys(CRONS) as JobName[]).find((name) => CRONS[name] === cron);
}

// @cloudflare/workers-types 를 들이면 @types/bun 과 전역 타입이 겹쳐서, 쓰는 필드만 선언한다
interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
}

export async function runScheduled(controller: ScheduledController): Promise<void> {
  const job = jobForCron(controller.cron);
  if (!job) throw new Error(`등록되지 않은 크론: ${controller.cron}`);
  // 로컬 검증용 (.dev.vars). 운영 시크릿에는 넣지 않는다
  const dryRun = process.env.DRY_RUN === "true";

  if (job === "collect") {
    const result = await runCollectNews({ dryRun });
    // throw 해야 대시보드에서 실패한 실행으로 보인다 (Render 의 exit 1 과 같은 역할)
    if (!result.ok) throw new Error(`뉴스 수집 실패: ${result.error ?? "원인 불명"}`);
    return;
  }

  const result = await runReportJob({ now: new Date(controller.scheduledTime), dryRun });
  if (!result.ok) throw new Error(`리포트 작업 실패: ${JSON.stringify(result.dates)}`);
}

export default {
  async scheduled(controller: ScheduledController): Promise<void> {
    await runScheduled(controller);
  },
  // 공개 HTTP 로는 아무것도 실행하지 않는다. 수동 실행·백필은 로컬 CLI(bun run report ...)로
  async fetch(): Promise<Response> {
    return new Response("Not Found", { status: 404 });
  },
};
