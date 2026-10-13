/**
 * 저장된 생성 텍스트의 오염(외국 문자, 프롬프트 지시문 누출)을 치환표대로 고친다.
 *
 *   bun scripts/repair-script-contamination.ts            # dry-run: 바꿀 곳과 전후 문장만 출력
 *   bun scripts/repair-script-contamination.ts --apply    # DB 에 쓴다
 *
 * 치환표: docs/text-quality-fix/labels/labels.json (label=contaminated, fix 있음)
 *        docs/text-quality-fix/labels/meta-labels.json (old → new)
 * 규칙
 * - path 가 가리키는 문자열 안에서 old 가 정확히 한 번 나와야 바꾼다. labels.json 의 old 는 공백을 접은 문맥에서
 *   만든 것이라, 그대로 없으면 공백만 유연하게(\s+) 한 번 더 찾는다. 그래도 0번이거나 2번 이상이면 건너뛰고 보고한다.
 * - 문서(기사 1건 / 리포트 1개) 단위로 한 번에 쓴다. 건너뛴 치환이 하나라도 있으면 --apply 는 exit 1.
 * - 쓰기 전 원본은 ~/development/ecosnack-backups/ 에 따로 백업해 둔다(이 스크립트는 백업하지 않는다).
 */
import { existsSync, readFileSync } from "node:fs";
import { initDatabase, closeDatabase, getPrisma } from "@/services/database.ts";
import { toDbDate } from "@/utils/kst.ts";

type Kind = "article" | "report";
interface Fix { ref: string; kind: Kind; id: string; path: string; old: string; new: string }

const LABELS = "docs/text-quality-fix/labels/labels.json";
const META = "docs/text-quality-fix/labels/meta-labels.json";
const apply = process.argv.includes("--apply");

const ARTICLE_COLS = { headline_summary: "text", so_what: "jsonb", impact_analysis: "jsonb", related_context: "jsonb", keywords: "text[]" } as const;
const REPORT_COLS = { title: "text", top_keywords: "text[]", executive_summary: "jsonb", market_overview: "jsonb", key_insights: "jsonb", sentiment_analysis: "jsonb" } as const;
type ColType = "text" | "jsonb" | "text[]";

/** 지시문 누출(meta) 중 이 확신도만 적용한다. low 는 독자용 완성 문장일 수 있어 건드리지 않는다 */
const META_CONFIDENCE = new Set(["high", "medium"]);
/** 적용하는 meta 치환이 감싸는 라벨 치환(sid). meta 를 먼저 적용하므로 이 라벨은 이미 처리된 것으로 본다 */
const covered = new Set<string>();

function loadFixes(): Fix[] {
  const fixes: Fix[] = [];
  // meta 를 먼저: 일부 meta 구간은 라벨 치환 구간을 포함하는 상위 집합이다
  for (const x of existsSync(META) ? JSON.parse(readFileSync(META, "utf8")) : []) {
    if (!META_CONFIDENCE.has(x.confidence)) continue;
    fixes.push({ ref: x.mid, kind: x.kind, id: String(x.id), path: x.path, old: x.old, new: x.new });
    for (const sid of String(x.conflicts_with_label_sid ?? "").split(",").map((s: string) => s.trim()).filter(Boolean)) covered.add(sid);
  }
  for (const x of JSON.parse(readFileSync(LABELS, "utf8"))) {
    if (x.label === "contaminated" && x.fix) fixes.push({ ref: x.sid, kind: x.kind, id: String(x.id), path: x.path, old: x.fix.old, new: x.fix.new });
  }
  return fixes;
}

/** "key_insights[2].analysis" → ["key_insights", 2, "analysis"] */
function parsePath(path: string): (string | number)[] {
  return [...path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((m) => (m[2] !== undefined ? Number(m[2]) : m[1]!));
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** old 를 text 안에서 정확히 한 번 찾는다. 공백 차이만 허용하는 두 번째 시도 포함 */
function locate(text: string, old: string): { start: number; end: number } | string {
  const exact = text.split(old).length - 1;
  if (exact === 1) { const i = text.indexOf(old); return { start: i, end: i + old.length }; }
  if (exact > 1) return `여러 번 나옴(${exact})`;
  const re = new RegExp(old.trim().split(/\s+/).map(escapeRe).join("\\s+"), "g");
  const ms = [...text.matchAll(re)];
  if (ms.length === 1) return { start: ms[0]!.index!, end: ms[0]!.index! + ms[0]![0].length };
  return ms.length === 0 ? "못 찾음" : `여러 번 나옴(${ms.length})`;
}

/** 바꾼 자리(이음매)만 정리한다: 이중 공백, 문장부호 앞 공백, 끝 공백. 문자열의 다른 부분은 건드리지 않는다 */
function splice(text: string, start: number, end: number, repl: string): string {
  let left = text.slice(0, start);
  let right = repl + text.slice(end);
  if (/[ \t]$/.test(left) && /^[ \t]/.test(right)) right = right.replace(/^[ \t]+/, "");
  if (/[ \t]$/.test(left) && /^[.,]/.test(right)) left = left.replace(/[ \t]+$/, "");
  if (right.trim() === "") left = left.replace(/[ \t]+$/, "");
  if (left.trim() === "") right = right.replace(/^[ \t]+/, "");
  return left + right;
}

/**
 * 규칙 치환: 마침표 자리에 나온 중국어·일본어 문장부호. 「좋겠어요。」 }}}},」처럼 문자열 끝의 。 뒤에 붙은
 * JSON 찌꺼기(」 ] } , 공백)도 함께 지운다. 운영 데이터 34곳(기사 22, 리포트 12)에서 확인한 형태만 다룬다.
 */
const RULE_SQL = "[。、\u3000]";
function ruleFix(text: string): string {
  return text
    .replace(/。[」\]}\s,]*$/u, ".")
    .replace(/。/gu, ".")
    .replace(/、/gu, ", ")
    .replace(/\u3000/gu, " ");
}

function walkStrings(v: unknown, fn: (s: string, path: string) => string, path = ""): unknown {
  if (typeof v === "string") return fn(v, path);
  if (Array.isArray(v)) return v.map((x, i) => walkStrings(x, fn, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walkStrings(x, fn, path ? `${path}.${k}` : k)]));
  return v;
}

async function main() {
  initDatabase();
  const db = getPrisma();
  const fixes = loadFixes();
  const byDoc = new Map<string, Fix[]>();
  for (const f of fixes) byDoc.set(`${f.kind}:${f.id}`, [...(byDoc.get(`${f.kind}:${f.id}`) ?? []), f]);
  // 규칙 치환 대상 문서도 함께 돈다
  const ruleDocs: { k: string }[] = await db.$queryRawUnsafe(`
    select 'article:' || id k from articles where (coalesce(headline_summary,'') || coalesce(so_what::text,'') || coalesce(impact_analysis::text,'') || coalesce(related_context::text,'') || array_to_string(keywords, ' ')) ~ '${RULE_SQL}'
    union all
    select 'report:' || report_date::text from daily_reports where (title || array_to_string(top_keywords, ' ') || executive_summary::text || market_overview::text || key_insights::text || sentiment_analysis::text) ~ '${RULE_SQL}'`);
  for (const { k } of ruleDocs) if (!byDoc.has(k)) byDoc.set(k, []);

  let changed = 0, skipped = 0, docs = 0;
  try {
    for (const [key, list] of byDoc) {
      const [kind, id] = key.split(":") as [Kind, string];
      const cols = kind === "article" ? ARTICLE_COLS : REPORT_COLS;
      const table = kind === "article" ? "articles" : "daily_reports";
      const where = kind === "article" ? "id = $1::int" : "report_date = $1::date";
      const whereVal = kind === "article" ? Number(id) : toDbDate(id).toISOString().slice(0, 10);
      const rows: Record<string, unknown>[] = await db.$queryRawUnsafe(`select ${Object.keys(cols).join(", ")} from ${table} where ${where}`, whereVal);
      if (rows.length !== 1) { console.log(`✗ ${key}: 행 ${rows.length}개`); skipped += list.length; continue; }
      const row = structuredClone(rows[0]!);
      const touched = new Set<string>();

      for (const f of list) {
        const [col, ...rest] = parsePath(f.path) as [string, ...(string | number)[]];
        if (!(col in cols)) { console.log(`✗ ${f.ref} ${key} ${f.path}: 모르는 컬럼`); skipped++; continue; }
        // 부모까지 내려간 뒤 마지막 키의 문자열을 바꾼다
        let parent: Record<string | number, unknown> = row;
        let last: string | number = col;
        for (const k of rest) { parent = parent[last] as Record<string | number, unknown>; last = k; }
        const text = parent?.[last];
        if (typeof text !== "string") { console.log(`✗ ${f.ref} ${key} ${f.path}: 문자열 아님`); skipped++; continue; }
        const at = locate(text, f.old);
        if (typeof at === "string") {
          if (covered.has(f.ref) && at === "못 찾음") { console.log(`= ${f.ref} ${key} ${f.path}: 앞선 meta 치환에 포함됨`); continue; }
          console.log(`✗ ${f.ref} ${key} ${f.path}: ${at} — ${JSON.stringify(f.old.slice(0, 60))}`); skipped++; continue;
        }
        const next = splice(text, at.start, at.end, f.new);
        console.log(`• ${f.ref} ${key} ${f.path}\n    전: ${JSON.stringify(text.slice(Math.max(0, at.start - 30), at.end + 30))}\n    후: ${JSON.stringify(next.slice(Math.max(0, at.start - 30), at.start + f.new.length + 30))}`);
        parent[last] = next;
        touched.add(col);
        changed++;
      }

      for (const col of Object.keys(cols)) {
        const before = row[col];
        const after = walkStrings(before, (s, path) => {
          const next = ruleFix(s);
          if (next !== s) { console.log(`• 규칙 ${key} ${col}${path ? (path.startsWith("[") ? path : "." + path) : ""}\n    전: ${JSON.stringify(s.slice(-60))}\n    후: ${JSON.stringify(next.slice(-60))}`); changed++; }
          return next;
        });
        if (JSON.stringify(after) !== JSON.stringify(before)) { row[col] = after; touched.add(col); }
      }

      if (touched.size === 0) continue;
      docs++;
      if (apply) {
        const sets = [...touched].map((c, i) => `${c} = $${i + 2}::${(cols as Record<string, ColType>)[c] === "jsonb" ? "jsonb" : (cols as Record<string, ColType>)[c]}`);
        const vals = [...touched].map((c) => ((cols as Record<string, ColType>)[c] === "jsonb" ? JSON.stringify(row[c]) : row[c]));
        const n = await db.$executeRawUnsafe(`update ${table} set ${sets.join(", ")} where ${where}`, whereVal, ...vals);
        if (n !== 1) throw new Error(`${key}: update 행 수 ${n}`);
      }
    }
  } finally {
    await closeDatabase();
  }
  console.log(`\n${apply ? "적용" : "dry-run"}: 치환 ${changed}건 / 문서 ${docs}개, 건너뜀 ${skipped}건`);
  if (apply && skipped > 0) process.exit(1);
}

await main();
