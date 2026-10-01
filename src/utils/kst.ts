// ============================================
// KST 날짜 계산 — 실행 환경의 TZ 와 무관한 순수 함수
// (Render 는 TZ=Asia/Seoul, Workers 는 항상 UTC)
// ============================================

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" 형식이고 실제 존재하는 날짜인지 */
export function isKstDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function assertDate(value: string): void {
  if (!isKstDateString(value)) {
    throw new Error(`잘못된 날짜 형식: "${value}" (YYYY-MM-DD 필요)`);
  }
}

/** 시각(instant)이 속한 KST 날짜 */
export function kstDateString(instant: Date = new Date()): string {
  return new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** KST 하루 범위 [start, end) 를 UTC 시각으로 */
export function kstDayRange(date: string): { start: Date; end: Date } {
  assertDate(date);
  const start = new Date(Date.parse(`${date}T00:00:00Z`) - KST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** 날짜 문자열에 일 수를 더한다 */
export function addDays(date: string, days: number): string {
  assertDate(date);
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 실행 시각 기준 KST 어제 — 데일리 리포트 기준일 */
export function previousKstDate(now: Date = new Date()): string {
  return addDays(kstDateString(now), -1);
}

/** Postgres `date` 컬럼 저장/조회용 값 (UTC 자정) */
export function toDbDate(date: string): Date {
  assertDate(date);
  return new Date(`${date}T00:00:00Z`);
}

/** Postgres `date` 컬럼 값을 "YYYY-MM-DD" 로 */
export function fromDbDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** from~to (양끝 포함) 날짜 목록 */
export function dateRange(from: string, to: string): string[] {
  assertDate(from);
  assertDate(to);
  if (from > to) throw new Error(`시작일(${from})이 종료일(${to})보다 늦습니다`);
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
