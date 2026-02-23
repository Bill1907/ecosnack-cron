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

// 한국 시간으로 현재 시각 반환
export function getKSTDate(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })
  );
}

// 날짜를 ISO 문자열로 변환 (한국 시간 기준)
export function toKSTISOString(date: Date): string {
  const kstOffset = 9 * 60; // UTC+9
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const kstDate = new Date(utc + kstOffset * 60000);
  return kstDate.toISOString();
}

// 로그 출력 (타임스탬프 포함)
export function log(message: string, level: "info" | "error" | "warn" = "info"): void {
  const timestamp = getKSTDate().toISOString();
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
}

// 지수 백오프를 적용한 재시도 유틸리티
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { retries = 3, delay = 1000, maxDelay = 5000, onRetry } = options;

  let lastError: Error = new Error("Retry failed");

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === retries) break;

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
