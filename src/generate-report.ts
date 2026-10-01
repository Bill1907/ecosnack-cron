import { runReportJob } from "@/jobs/report.ts";
import { dateRange, isKstDateString } from "@/utils/kst.ts";

/**
 * bun run report                         KST 어제 리포트 (일반 + 개인화)
 * bun run report --date 2026-09-26       특정 날짜
 * bun run report --from 2026-08-01 --to 2026-08-19 [--skip-personalized]
 * bun run report:personal [--date ...]   개인화만
 * 공통: --dry-run (저장 안 함), --out <dir> (dry-run 리포트 본문 JSON 저장)
 */
export function parseReportArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} 다음에 값이 필요합니다`);
    return value;
  };
  const date = get("--date");
  const from = get("--from");
  const to = get("--to");

  for (const [flag, v] of [["--date", date], ["--from", from], ["--to", to]] as const) {
    if (v !== undefined && !isKstDateString(v)) throw new Error(`${flag} 값이 YYYY-MM-DD 가 아닙니다: ${v}`);
  }
  if (date && (from || to)) throw new Error("--date 와 --from/--to 는 함께 쓸 수 없습니다");
  if ((from && !to) || (!from && to)) throw new Error("--from 과 --to 는 함께 지정해야 합니다");

  return {
    dates: date ? [date] : from && to ? dateRange(from, to) : undefined,
    dryRun: argv.includes("--dry-run"),
    skipPersonalized: argv.includes("--skip-personalized"),
    personalizedOnly: argv.includes("--personalized-only"),
    outDir: get("--out"),
  };
}

if (import.meta.main) {
  const result = await runReportJob(parseReportArgs(process.argv.slice(2)));
  process.exit(result.ok ? 0 : 1);
}
