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
  onRetry?: (error: Error, attempt: number) => void;
}

// 지수 백오프를 적용한 재시도 유틸리티
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { retries = 3, delay = 1000, onRetry } = options;

  let lastError: Error = new Error("Retry failed");

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === retries) break;

      const backoffDelay = delay * Math.pow(2, attempt);
      onRetry?.(lastError, attempt + 1);
      log(`재시도 ${attempt + 1}/${retries} - ${backoffDelay}ms 후 재시도...`, "warn");
      await new Promise((r) => setTimeout(r, backoffDelay));
    }
  }

  throw lastError;
}
