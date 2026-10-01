import { describe, test, expect } from "bun:test";
import { stripArticleRefs } from "@/utils/index.ts";

describe("stripArticleRefs", () => {
  test("운영 리포트에서 실제로 나온 〔근거: …〕 인용을 지운다", () => {
    const input =
      "이는 정보 분석이며 개인별 투자 권유가 아닙니다.〔근거: 25568, 25565, 25583〕〔근거: 25591〕";
    expect(stripArticleRefs(input)).toBe("이는 정보 분석이며 개인별 투자 권유가 아닙니다.");
  });

  test("여러 괄호 형태", () => {
    expect(stripArticleRefs("금리가 올랐어요 [근거: 12]")).toBe("금리가 올랐어요");
    expect(stripArticleRefs("금리가 올랐어요 (기사 7324)")).toBe("금리가 올랐어요");
    expect(stripArticleRefs("금리가 올랐어요 (articleId: 15).")).toBe("금리가 올랐어요.");
    expect(stripArticleRefs("id=123 기사에서 보듯")).toBe("기사에서 보듯");
  });

  test("연도 인용은 남긴다", () => {
    expect(stripArticleRefs("GDP(참고: 2023, 2024) 비교")).toBe("GDP(참고: 2023, 2024) 비교");
    expect(stripArticleRefs("(출처: 2024)")).toBe("(출처: 2024)");
  });

  test("닫는 괄호 없는 긴 숫자열에서도 빠르다 (백트래킹 없음)", () => {
    const evil = "(근거 " + "1 ".repeat(40) + "끝";
    const t = performance.now();
    stripArticleRefs(evil.repeat(20));
    stripArticleRefs("(근거" + " ".repeat(20_000) + "x");
    expect(performance.now() - t).toBeLessThan(50);
  });

  test("일반 괄호와 숫자는 건드리지 않는다", () => {
    const keep = "코스피는 2,850(+1.2%)으로 마감했고, 기준금리(연 3.5%)는 동결됐어요.";
    expect(stripArticleRefs(keep)).toBe(keep);
    expect(stripArticleRefs("근거: 금리 인상 기대")).toBe("근거: 금리 인상 기대");
  });
});
