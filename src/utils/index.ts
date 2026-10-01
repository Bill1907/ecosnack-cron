// 메타 코멘트 제거 (프롬프트 누수 방지)
export function sanitizeMetaComments(text: string): string {
  const patterns = [
    /\d+자\s*(이상|이내|이하|내외)[\w]*으로\s*(작성|기술|서술)[\w]*/g,
    /\d+자\s*(이상|이내|이하|내외)입니다\.?/g,
    /글자\s*수[를은는이]\s*[^\s.]+/g,
    /분량[을를]\s*(맞추|충족|채우|맞췄|채웠)[^\s.]*/g,
  ];

  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, "");
  }
  return result.replace(/\n{3,}/g, "\n\n").replace(/ {2,}/g, " ").trim();
}

// 본문에 새는 기사 ID 인용 제거: "〔근거: 25568, 25565〕", "[근거: 123]", "(기사 7324)", "id=12" 등
// 기사 ID 는 evidence.articleId 같은 지정 필드에만 있어야 한다
// 숫자 목록은 겹치지 않는 형태로 써서 닫는 괄호가 없을 때의 과도한 백트래킹을 막는다.
// "참고/출처" 는 연도 인용("(참고: 2023, 2024)")과 겹쳐서 넣지 않는다.
const ID_LIST = String.raw`#?\d+(?:\s*[,，、]\s*#?\d+)*`;
const ARTICLE_REF_PATTERNS = [
  // 앞쪽 공백은 패턴에 넣지 않는다 (긴 공백열에서 시작점마다 재스캔 → O(n²)). 남는 공백은 아래에서 정리
  new RegExp(String.raw`[〔\[(（【]\s*(?:근거|기사)\s*(?:(?:ID|id)\s*)?(?:[:：]\s*)?${ID_LIST}\s*[〕\])）】]`, "g"),
  new RegExp(String.raw`[〔\[(（【]\s*(?:articleId|id)\s*[:=]\s*${ID_LIST}\s*[〕\])）】]`, "g"),
  /\bid=\d+/g,
];

export function stripArticleRefs(text: string): string {
  let result = text;
  for (const pattern of ARTICLE_REF_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.replace(/ {2,}/g, " ").replace(/ +([.,!?。])/g, "$1").trim();
}

// pubDate 기반 최신성 점수 계산 (0-20점)
export function calculateRecencyScore(pubDate?: Date | null): number {
  if (!pubDate) return 0;

  const diffHours = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60);

  if (diffHours < 0) return 10; // 미래 날짜 (파싱 오류)
  if (diffHours <= 1) return 20;
  if (diffHours <= 6) return 15;
  if (diffHours <= 12) return 10;
  if (diffHours <= 24) return 5;
  return 0;
}

// 로그 출력 (UTC ISO 타임스탬프)
export function log(message: string, level: "info" | "error" | "warn" = "info"): void {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: "[INFO]",
    error: "[ERROR]",
    warn: "[WARN]",
  }[level];

  console.log(`${timestamp} ${prefix} ${message}`);
}

// 에러 메시지 추출
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// 재시도 옵션 타입
export interface RetryOptions {
  retries?: number;
  delay?: number;
  maxDelay?: number; // 백오프 상한
  onRetry?: (error: Error, attempt: number) => void;
  /** false 를 돌려주면 즉시 실패 (예: 잘못된 파라미터 400) */
  shouldRetry?: (error: Error) => boolean;
}

/** HTTP 4xx 중 다시 보내도 같은 결과인 오류 (408/409/429 제외) */
export function isNonRetryableHttpError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
}

// 지수 백오프를 적용한 재시도 유틸리티
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { retries = 3, delay = 1000, maxDelay = 5000, onRetry, shouldRetry } = options;

  let lastError: Error = new Error("Retry failed");

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === retries) break;
      if (shouldRetry && !shouldRetry(lastError)) break;

      const backoffDelay = Math.min(delay * Math.pow(2, attempt), maxDelay);
      onRetry?.(lastError, attempt + 1);
      log(`재시도 ${attempt + 1}/${retries} - ${backoffDelay}ms 후 재시도...`, "warn");
      await new Promise((r) => setTimeout(r, backoffDelay));
    }
  }

  throw lastError;
}

// 프로미스 타임아웃 래퍼
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message?: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(message ?? `Timeout after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
