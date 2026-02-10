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
  shouldRetry?: (error: Error) => boolean; // false 반환 시 즉시 실패
}

// 재시도 불가능한 에러인지 판별 (OpenAI 429 할당량 초과, 401 인증 실패 등)
function isNonRetryableError(error: Error): boolean {
  const message = error.message;
  // OpenAI 429 할당량 초과 (rate limit과 구분)
  if (message.includes("exceeded your current quota")) return true;
  if (message.includes("insufficient_quota")) return true;
  // 인증 실패
  if (message.includes("401") && message.includes("Incorrect API key")) return true;
  // 잘못된 요청 (재시도해도 동일)
  if (message.startsWith("400")) return true;
  return false;
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

      // 재시도 불가능한 에러는 즉시 실패
      if (isNonRetryableError(lastError)) {
        log(`재시도 불가능한 에러 - 즉시 실패: ${lastError.message}`, "error");
        throw lastError;
      }

      if (shouldRetry && !shouldRetry(lastError)) {
        log(`shouldRetry가 false 반환 - 즉시 실패: ${lastError.message}`, "error");
        throw lastError;
      }

      if (attempt === retries) break;

      const backoffDelay = Math.min(delay * Math.pow(2, attempt), maxDelay);
      onRetry?.(lastError, attempt + 1);
      log(`재시도 ${attempt + 1}/${retries} - ${backoffDelay}ms 후 재시도...`, "warn");
      await new Promise((r) => setTimeout(r, backoffDelay));
    }
  }

  throw lastError;
}
