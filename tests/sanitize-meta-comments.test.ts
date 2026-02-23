import { describe, test, expect } from "bun:test";
import { sanitizeMetaComments } from "@/utils/index.ts";

describe("sanitizeMetaComments", () => {
  test("removes '400자 이내입니다' pattern", () => {
    const input = "시장 분석 내용입니다. 400자 이내입니다.";
    const result = sanitizeMetaComments(input);
    expect(result).not.toContain("400자 이내입니다");
    expect(result).toContain("시장 분석 내용입니다.");
  });

  test("removes '600자 이상으로 작성했습니다' pattern", () => {
    const input = "경제 뉴스 요약입니다. 600자 이상으로 작성했습니다";
    const result = sanitizeMetaComments(input);
    expect(result).not.toContain("600자 이상으로 작성했습니다");
    expect(result).toContain("경제 뉴스 요약입니다.");
  });

  test("removes '300자 이상으로 기술했습니다' pattern", () => {
    const input = "상세 분석 내용. 300자 이상으로 기술했습니다";
    const result = sanitizeMetaComments(input);
    expect(result).not.toContain("300자 이상으로 기술");
  });

  test("removes '글자수를 맞춰서' pattern", () => {
    const input = "분석 내용입니다. 글자수를 맞춰서 작성했습니다.";
    const result = sanitizeMetaComments(input);
    expect(result).not.toContain("글자수를");
  });

  test("removes '분량을 충족했습니다' pattern", () => {
    const input = "분석 내용입니다. 분량을 충족했습니다.";
    const result = sanitizeMetaComments(input);
    expect(result).not.toContain("분량을 충족");
  });

  test("removes '분량을 채웠습니다' pattern", () => {
    const input = "분석 내용입니다. 분량을 채웠습니다.";
    const result = sanitizeMetaComments(input);
    expect(result).not.toContain("분량을 채웠");
  });

  test("does not modify normal text without meta comments", () => {
    const input = "코스피가 2,850선을 돌파하며 1.5% 상승했습니다. 반도체 관련주가 강세를 보이고 있어요.";
    const result = sanitizeMetaComments(input);
    expect(result).toBe(input);
  });

  test("does not modify economic text containing numbers with '조원', '만명' etc", () => {
    const input = "삼성전자는 400조원의 투자를 발표했습니다. 100만명의 일자리가 창출될 전망입니다.";
    const result = sanitizeMetaComments(input);
    expect(result).toBe(input);
  });

  test("does not modify text with '자' in different context", () => {
    const input = "투자자들은 신중한 접근이 필요합니다. 소비자 물가가 상승했어요.";
    const result = sanitizeMetaComments(input);
    expect(result).toBe(input);
  });

  test("cleans up extra whitespace after removal", () => {
    const input = "분석 내용.  400자 이내입니다.  추가 설명.";
    const result = sanitizeMetaComments(input);
    expect(result).not.toContain("  ");
  });

  test("cleans up excessive newlines after removal", () => {
    const input = "분석 내용.\n\n\n\n추가 설명.";
    const result = sanitizeMetaComments(input);
    expect(result).toBe("분석 내용.\n\n추가 설명.");
  });

  test("handles empty string", () => {
    expect(sanitizeMetaComments("")).toBe("");
  });

  test("handles text with only meta comments", () => {
    const input = "400자 이내입니다.";
    const result = sanitizeMetaComments(input);
    expect(result).not.toContain("400자 이내");
  });

  test("removes '150자 이상입니다' pattern", () => {
    const input = "요약 내용입니다. 150자 이상입니다.";
    const result = sanitizeMetaComments(input);
    expect(result).not.toContain("150자 이상입니다");
  });

  test("removes '200자 이하입니다' pattern", () => {
    const input = "전망 내용입니다. 200자 이하입니다.";
    const result = sanitizeMetaComments(input);
    expect(result).not.toContain("200자 이하입니다");
  });

  test("removes '글자수는 충분합니다' pattern", () => {
    const input = "분석 내용입니다. 글자수는 충분합니다.";
    const result = sanitizeMetaComments(input);
    expect(result).not.toContain("글자수는");
  });
});
