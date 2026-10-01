import { runCollectNews } from "@/jobs/collect-news.ts";

// bun run cron [--dry-run]
const dryRun = process.argv.includes("--dry-run");
const result = await runCollectNews({ dryRun });
process.exit(result.ok ? 0 : 1);
