# ecosnack-cron

경제 뉴스 수집·분석 크론과 데일리 리포트 생성. 자세한 구조와 명령은 `CLAUDE.md`.

```bash
bun install
cp .env.example .env   # DATABASE_URL, OPENAI_API_KEY, TYPESAFE_API_KEY
bun run cron --dry-run
bun run report --date 2026-09-30 --dry-run
```
