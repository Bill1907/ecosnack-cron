/**
 * 생성 텍스트 검사기: 외국 문자 혼입과 프롬프트 지시문 누출을 찾는다.
 * 한글·라틴·그리스·공통/상속 문자(숫자, 문장부호, ℓ ㎞ → ① 같은 기호) 밖의 문자는 오염이다.
 * 한자는 입력 원문에 있거나, 한글 바로 뒤 괄호 병기이거나, 신문 약어일 때만 정상이다.
 */

export type ScriptIssueReason = "foreign-script" | "prompt-leak";

export interface ScriptIssue {
  run: string;
  /** text 안의 시작 위치 (UTF-16 코드 유닛) */
  index: number;
  reason: ScriptIssueReason;
}

// 한국 신문 제목의 한 글자 약어 (美中韓日 …). 이 글자로만 이뤄진 한자 덩어리는 허용한다.
export const HAN_ABBREVIATION_ALLOWLIST = [
  "美中韓日北英獨佛伊露印",
  "高低",
  "乙甲",
  "對",
  "銀株弗車發比金",
  "李文尹",
  "公證稅",
  "新舊",
  "前後",
  "反親",
  "非",
  "兆億",
].join("");

const ALLOWED_HAN = new Set(HAN_ABBREVIATION_ALLOWLIST);

// Script=Common 이지만 한국어 문장에 쓰이지 않는 중국어·일본어 문장부호·기호. 운영 데이터에서 「좋겠어요。」 }}}},」처럼
// 마침표 대신 나온 「。」가 기사 34곳에 있었다. 「」『』 는 한국어에서도 쓰므로 넣지 않는다.
export const CJK_ONLY_PUNCTUATION = "。、ー〆ｰﾞﾟ\u3000\uFFFD";

const OK = String.raw`\p{Script=Hangul}\p{Script=Latin}\p{Script=Greek}\p{Script=Common}\p{Script=Inherited}`;
// 정상 문자가 아닌 글자 + 거기 붙은 결합 표시(\p{M}). 라틴 글자에 붙은 악센트는 덩어리가 되지 않는다.
const FOREIGN_CHAR = String.raw`[^${OK}]|[${CJK_ONLY_PUNCTUATION}]`;
const FOREIGN_CHUNK = new RegExp(String.raw`(?:${FOREIGN_CHAR})(?:${FOREIGN_CHAR}|\p{M})*`, "gu");
const HAN_ONLY = /^\p{Script=Han}+$/u;
const HANGUL = /\p{Script=Hangul}/u;

// 프롬프트 지시문이 본문에 새어 나온 문구 (운영 리포트 실제 사례로 보정: prompt-leak-cases.json)
const PROMPT_LEAK_PATTERNS = [
  /일본어.{0,8}(?:사용|표현|표기|혼용).{0,8}(?:금지|불가|마세요)/g,
  /금지어/g,
  /금지(?:된)? 표현/g,
  /수정 불필요/g,
  /규칙 준수/g,
  /(?:전부|모두|반드시) 한국어/g,
  /\d+\s*자\s*(?:이상|이내|이하|내외|분량)/g,
  // 운영 데이터 복구 뒤 재스캔에서 추가로 찾은 형태: 지시문 변형과 출력 구조(JSON 필드) 누출
  /일본어.{0,10}(?:금지|주의)/g,
  /금지 문구/g,
  /\b(?:sections|implications|relatedArticleIds|key\s?data|actionItems|evidence)\\?"?\s*:\s*[[{]/gi,
  /JSON schema|본 템플릿|내부 목차/gi,
  /(?:임팩트|기간|타임호라이즌):\s*(?:high|medium|low|short|long)/gi,
  /섹션들\s*:\s*\[/g,
  // 출력 스키마의 필드 이름은 한국어 본문에 나올 일이 없다 (「(relatedArticleIds 참조)」「watchList로 제시합니다」)
  /\b(?:relatedArticleIds|keyData|actionItems|timeHorizon|articleId|watchList)\b/g,
  /\bsections(?=[을를은는이가에의])/g,
];

function isAllowedHan(chunk: string, index: number, text: string, source: string): boolean {
  if (source.includes(chunk)) return true;
  // 한글 바로 뒤 괄호 안에 그 덩어리만 있는 병기: 다산다사(多産多死). 음 일치는 보지 않는다.
  if (
    text[index - 1] === "(" &&
    text[index + chunk.length] === ")" &&
    HANGUL.test(text[index - 2] ?? "")
  ) {
    return true;
  }
  return [...chunk].every((c) => ALLOWED_HAN.has(c));
}

/** 오염 구간 목록. 빈 배열이면 정상. source 는 입력 원문(기사 제목·설명)으로 한자 판정에만 쓴다. */
export function findForeignScript(text: string, source = ""): ScriptIssue[] {
  const issues: ScriptIssue[] = [];

  for (const m of text.matchAll(FOREIGN_CHUNK)) {
    const run = m[0];
    const index = m.index;
    if (HAN_ONLY.test(run) && isAllowedHan(run, index, text, source)) continue;
    issues.push({ run, index, reason: "foreign-script" });
  }

  for (const pattern of PROMPT_LEAK_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      // 입력 원문에 같은 문구가 있으면 기사 내용이다 (예: "광고 규칙 준수 점검", "비밀번호 12자 이상")
      if (source.includes(m[0])) continue;
      // 패턴끼리 겹치면 (예: "일본어 사용 금지") 먼저 잡은 것만 남긴다
      const end = m.index + m[0].length;
      if (issues.some((i) => i.reason === "prompt-leak" && i.index < end && m.index < i.index + i.run.length)) continue;
      issues.push({ run: m[0], index: m.index, reason: "prompt-leak" });
    }
  }

  return issues.sort((a, b) => a.index - b.index);
}

/** 객체·배열을 재귀로 돌며 모든 문자열 값을 검사한다. path 는 `a.b[0].c` 형식. */
export function findForeignScriptDeep(
  value: unknown,
  source?: string
): Array<ScriptIssue & { path: string }> {
  const found: Array<ScriptIssue & { path: string }> = [];

  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string") {
      for (const issue of findForeignScript(v, source)) found.push({ ...issue, path });
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [key, item] of Object.entries(v)) walk(item, path ? `${path}.${key}` : key);
    }
  };

  walk(value, "");
  return found;
}

const MAX_DESCRIBED = 5;
const MAX_RUN_LENGTH = 30;

/** 재생성 사유(로그용) 문자열. 문제가 없으면 null. */
export function describeScriptIssues(issues: Array<ScriptIssue & { path?: string }>): string | null {
  if (issues.length === 0) return null;
  const shown = issues.slice(0, MAX_DESCRIBED).map((i) => {
    const run = i.run.length > MAX_RUN_LENGTH ? `${i.run.slice(0, MAX_RUN_LENGTH)}…` : i.run;
    return `${i.path || "(root)"} "${run}" (${i.reason})`;
  });
  const rest = issues.length - shown.length;
  return shown.join(", ") + (rest > 0 ? ` 외 ${rest}건` : "");
}
