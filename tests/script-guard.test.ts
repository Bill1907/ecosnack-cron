import { describe, test, expect } from "bun:test";
import {
  findForeignScript,
  findForeignScriptDeep,
  describeScriptIssues,
  HAN_ABBREVIATION_ALLOWLIST,
} from "@/utils/script-guard.ts";
import fixture from "./fixtures/script-contamination.json";

const runs = (text: string, source?: string) => findForeignScript(text, source).map((i) => i.run);

describe("findForeignScript — 라벨 코퍼스 (정답 = 사람이 붙인 detector_expected)", () => {
  test("픽스처 구성 (원본 라벨과 같은 개수)", () => {
    expect(fixture.labels).toHaveLength(124);
    expect(fixture.labels.filter((l) => l.detector_expected)).toHaveLength(47);
    expect(fixture.labels.filter((l) => l.inSource)).toHaveLength(40);
  });

  for (const l of fixture.labels) {
    test(`${l.sid} ${JSON.stringify(l.run)} → ${l.detector_expected ? "검출" : "통과"}`, () => {
      const issues = findForeignScript(l.text, l.inSource ? l.run : undefined);
      const foreign = issues.filter((i) => i.reason === "foreign-script");
      if (l.detector_expected) {
        expect(foreign.length).toBeGreaterThan(0);
      } else {
        expect(issues).toEqual([]);
      }
    });
  }

  test("오염 라벨은 라벨된 구간(run)을 포함하는 덩어리로 잡힌다", () => {
    const missing: string[] = [];
    for (const l of fixture.labels.filter((x) => x.detector_expected)) {
      const hit = findForeignScript(l.text).some((i) => i.reason === "foreign-script" && i.run.includes(l.run));
      if (!hit) missing.push(`${l.sid}:${l.run}`);
    }
    expect(missing).toEqual([]);
  });
});

describe("findForeignScript — 문자 규칙", () => {
  test("빈 문자열·한글·영어 문장은 정상", () => {
    expect(findForeignScript("")).toEqual([]);
    expect(findForeignScript("금리 인하 기대가 커졌어요.")).toEqual([]);
    expect(findForeignScript("The Fed held rates steady on Wednesday, citing sticky inflation.")).toEqual([]);
  });

  test("그리스 문자·숫자·문장부호는 정상", () => {
    expect(findForeignScript("베타(β)와 알파(α) 계수는 0.85, 1.2%였어요 — “확인”‘필요’…")).toEqual([]);
  });

  test("ℓ ㎞ → ① 같은 공통 기호는 정상", () => {
    for (const s of ["휘발유 1,900원/ℓ", "시속 80㎞", "금리 → 상승", "① 항목", "㎡ 당 3.3㎍ ℃ ₩ € ™ ※ ▲"]) {
      expect(findForeignScript(s)).toEqual([]);
    }
  });

  test("결합 악센트가 붙은 라틴 문자는 정상 (Café)", () => {
    expect(findForeignScript("Café 와 Zürich")).toEqual([]);
  });

  test("아랍 문자만 있어도 오염", () => {
    expect(findForeignScript("중요해요. ليغ")).toEqual([{ run: "ليغ", index: 6, reason: "foreign-script" }]);
  });

  test("칸나다 문자와 모음 기호는 한 덩어리로 잡힌다", () => {
    const issues = findForeignScript("확산돼요.ಗೆ 입니다");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.run).toBe("ಗೆ");
    expect(issues[0]?.run.length).toBe(2);
  });

  test("아랍 모음 부호처럼 Script=Inherited 인 결합 표시도 외국 문자 덩어리에 붙는다", () => {
    expect(runs("인사 مَرْحَبًا 끝")).toEqual(["مَرْحَبًا"]);
  });

  test("가나만 있어도 오염", () => {
    expect(runs("오늘은 これは 중요")).toEqual(["これは"]);
    expect(runs("ゴルフ")).toEqual(["ゴルフ"]);
  });

  test("키릴 문자만 있어도 오염", () => {
    expect(runs("끝 문장 нек 수정")).toEqual(["нек"]);
  });

  test("태국·데바나가리·히브리 문자도 오염", () => {
    expect(runs("สวัสดี")).toEqual(["สวัสดี"]);
    expect(runs("नमस्ते")).toEqual(["नमस्ते"]);
    expect(runs("שלום")).toEqual(["שלום"]);
  });

  test("가나·아랍 등은 입력 원문에 있어도 오염", () => {
    expect(runs("これは", "これは 원문 제목")).toEqual(["これは"]);
    expect(runs("ليغ", "ليغ")).toEqual(["ليغ"]);
  });

  test("깨진 토큰이 섞인 리포트 문장 (실제 10/12 사례)", () => {
    expect(runs("확산되는지가 중요해요.ليಗೆ盈彩票?")).toEqual(["ليಗೆ盈彩票"]);
  });

  test("가나와 한자가 붙어 있으면 한 덩어리", () => {
    expect(runs("これは日本語使用 금지")).toEqual(["これは日本語使用"]);
    expect(runs("早め의 가계비")).toEqual(["早め"]);
  });

  test("index 는 text 안의 시작 위치", () => {
    expect(findForeignScript("주의深이")).toEqual([{ run: "深", index: 2, reason: "foreign-script" }]);
  });

  test("여러 구간은 index 순으로", () => {
    const issues = findForeignScript("次の 관심 발표日程은");
    expect(issues.map((i) => [i.run, i.index])).toEqual([
      ["次の", 0],
      ["日程", 8],
    ]);
  });
});

describe("findForeignScript — 한자 덩어리", () => {
  test("입력 원문에 같은 덩어리가 있으면 정상", () => {
    expect(findForeignScript("美 10년물 금리가 올랐어요", "美 10년물 국채")).toEqual([]);
    expect(findForeignScript("삼성電子 실적 발표", "삼성電子 영업이익")).toEqual([]);
  });

  test("입력 원문에 없으면 오염", () => {
    expect(runs("주의深이", "미국 10년물 국채")).toEqual(["深"]);
    expect(runs("주의深이")).toEqual(["深"]);
  });

  test("한글 바로 뒤 괄호 안에 단독으로 있으면 정상", () => {
    expect(findForeignScript("다산다사(多産多死) 구조")).toEqual([]);
    expect(findForeignScript("일대일로(一带一路) 정책")).toEqual([]);
    expect(findForeignScript("조선(造船) 업황")).toEqual([]);
  });

  test("괄호 병기라도 한글 바로 뒤가 아니거나 덩어리 외 글자가 있으면 오염", () => {
    expect(runs("(多産多死) 구조")).toEqual(["多産多死"]);
    expect(runs("A(多産多死)")).toEqual(["多産多死"]);
    expect(runs("다산 (多産多死)")).toEqual(["多産多死"]);
    expect(runs("구글(大테크) 실적")).toEqual(["大"]);
    expect(runs("대출(受 가계)")).toEqual(["受"]);
  });

  test("괄호 병기는 음이 맞는지 보지 않는다 (알려진 한계: S0057·S0707)", () => {
    expect(findForeignScript("미국의 대(對韓) 관세")).toEqual([]);
    expect(findForeignScript("쌍위(二重)의 흐름")).toEqual([]);
  });

  test("신문 약어 허용 목록의 글자로만 이뤄진 덩어리는 정상", () => {
    expect(findForeignScript("美 증시, 中 수출, 韓 금리, 日 엔화, 전월比 하락, 메모리株 급등, 중동發 악재")).toEqual([]);
    expect(findForeignScript("美中 갈등과 美日韓 공조")).toEqual([]);
  });

  test("허용 목록 밖의 글자가 하나라도 있으면 오염", () => {
    expect(runs("美國 정부")).toEqual(["美國"]);
    expect(runs("企業 내부")).toEqual(["企業"]);
    expect(runs("수혜 기업을同")).toEqual(["同"]);
    expect(runs("사이에서揺")).toEqual(["揺"]);
  });

  test("한 글자라는 이유로 통과시키지 않는다 (受·揺·同·大)", () => {
    for (const c of ["受", "揺", "同", "大"]) expect(runs(`가${c}나`)).toEqual([c]);
  });

  test("허용 목록은 중복 없이 한자만", () => {
    expect([...HAN_ABBREVIATION_ALLOWLIST]).toHaveLength(new Set(HAN_ABBREVIATION_ALLOWLIST).size);
    expect(/^\p{Script=Han}+$/u.test(HAN_ABBREVIATION_ALLOWLIST)).toBe(true);
    for (const c of "美中韓日北英獨佛伊露印高低乙甲對銀株弗車發比金李文尹公證稅新舊前後反親非兆億") {
      expect(HAN_ABBREVIATION_ALLOWLIST).toContain(c);
    }
  });
});

describe("findForeignScript — 지시문 누출", () => {
  const leakRuns = (text: string) =>
    findForeignScript(text)
      .filter((i) => i.reason === "prompt-leak")
      .map((i) => i.run);

  test("한글만으로 된 누출 문장도 prompt-leak 로 잡는다", () => {
    expect(leakRuns("일본어 사용 금지 유의하세요.")).toEqual(["일본어 사용 금지"]);
    expect(leakRuns("가계 예산을 재점검하세요. 100자 내외 설명입니다.")).toEqual(["100자 내외"]);
    expect(leakRuns("(끝 문장 수정 불필요)")).toEqual(["수정 불필요"]);
    expect(leakRuns("금지어 주의하세요")).toEqual(["금지어"]);
    expect(leakRuns("본문은 전부 한국어로 작성했습니다")).toEqual(["전부 한국어"]);
  });

  test("index 는 일치 시작 위치", () => {
    expect(findForeignScript("가나다 150자 이상")).toEqual([{ run: "150자 이상", index: 4, reason: "prompt-leak" }]);
  });

  test("정상 문장은 통과 (내부 규정·수출 금지·규칙)", () => {
    for (const s of [
      "금융당국이 내부 규정을 재점검하기로 했어요.",
      "중국이 헬륨의 수출을 금지했어요.",
      "4% 인출 규칙에 따라 매달 560달러를 쓸 수 있어요.",
      "일본 정부는 엔화 약세를 용인하지 않겠다고 했어요.",
      "한국어 음성 데이터를 확보할 계획이에요.",
      "최근 10년간 상승 확률은 40%예요. 2026년 9월 23일 발행.",
    ]) {
      expect(findForeignScript(s)).toEqual([]);
    }
  });
});

describe("프롬프트 누출 코퍼스 (prompt-leak-cases.json)", () => {
  test("픽스처 구성", () => {
    expect(fixture.promptLeak.filter((c) => c.expected)).toHaveLength(67);
    expect(fixture.promptLeak.filter((c) => !c.expected)).toHaveLength(70);
  });

  test("expected=true 67개는 전부 prompt-leak 로 검출", () => {
    const missed = fixture.promptLeak
      .filter((c) => c.expected)
      .filter((c) => !findForeignScript(c.text).some((i) => i.reason === "prompt-leak"))
      .map((c) => `${c.id}: ${c.text.slice(0, 40)}`);
    expect(missed).toEqual([]);
  });

  test("expected=false 70개는 0건", () => {
    const flagged = fixture.promptLeak
      .filter((c) => !c.expected)
      .map((c) => ({ id: c.id, issues: findForeignScript(c.text) }))
      .filter((r) => r.issues.length > 0);
    expect(flagged).toEqual([]);
  });
});

describe("findForeignScriptDeep", () => {
  test("객체·배열을 재귀로 돌며 path 를 a.b[0].c 형식으로 돌려준다", () => {
    const value = {
      title: "정상",
      so_what: { main_point: "주의深이", tips: ["정상", "これは"] },
      keywords: ["금리", "株"],
      list: [{ a: { b: "ليغ" } }],
      n: 3,
      ok: true,
      nothing: null,
    };
    const issues = findForeignScriptDeep(value);
    expect(issues.map((i) => [i.path, i.run])).toEqual([
      ["so_what.main_point", "深"],
      ["so_what.tips[1]", "これは"],
      ["list[0].a.b", "ليغ"],
    ]);
  });

  test("source 를 모든 문자열에 적용", () => {
    const value = { a: "美 10년물", b: ["中 수출", "企業 내부"] };
    expect(findForeignScriptDeep(value, "企業 내부 美 10년물").map((i) => i.path)).toEqual([]);
    expect(findForeignScriptDeep(value, "").map((i) => [i.path, i.run])).toEqual([["b[1]", "企業"]]);
  });

  test("루트가 문자열·배열이어도 동작", () => {
    expect(findForeignScriptDeep("주의深이")[0]).toEqual({ run: "深", index: 2, reason: "foreign-script", path: "" });
    expect(findForeignScriptDeep(["ok", "これ"]).map((i) => i.path)).toEqual(["[1]"]);
  });

  test("지시문 누출도 path 와 함께 보고", () => {
    const issues = findForeignScriptDeep({ summary: { text: "100자 내외 설명입니다." } });
    expect(issues).toEqual([{ run: "100자 내외", index: 0, reason: "prompt-leak", path: "summary.text" }]);
  });

  test("정상 값·비문자열은 빈 배열", () => {
    expect(findForeignScriptDeep({ a: "정상", b: [1, 2, null, undefined], c: { d: false } })).toEqual([]);
    expect(findForeignScriptDeep(null)).toEqual([]);
    expect(findForeignScriptDeep(undefined)).toEqual([]);
  });
});

describe("describeScriptIssues", () => {
  test("문제가 없으면 null", () => {
    expect(describeScriptIssues([])).toBeNull();
  });

  test("path 와 run, reason 을 사유 문자열에 담는다", () => {
    const issues = findForeignScriptDeep({ so_what: { main_point: "주의深이" }, k: ["100자 내외"] });
    const msg = describeScriptIssues(issues)!;
    expect(msg).toContain("so_what.main_point");
    expect(msg).toContain("深");
    expect(msg).toContain("foreign-script");
    expect(msg).toContain("k[0]");
    expect(msg).toContain("prompt-leak");
  });

  test("많으면 앞 5건만 적고 나머지는 개수로", () => {
    const issues = findForeignScriptDeep({ a: Array.from({ length: 8 }, () => "これ") });
    const msg = describeScriptIssues(issues)!;
    expect(msg).toContain("a[4]");
    expect(msg).not.toContain("a[5]");
    expect(msg).toContain("외 3건");
  });
});

describe("findForeignScript — 리뷰 반영 (V1 T1-T3)", () => {
  test("지시문 누출 문구라도 입력 원문에 있으면 기사 내용이라 통과", () => {
    expect(findForeignScript("금융위가 가상자산 광고 규칙 준수 여부를 점검해요.", "금융위, 가상자산 광고 규칙 준수 점검")).toEqual([]);
    expect(findForeignScript("공공 사이트 비밀번호가 12자 이상으로 바뀌어요.", "공공 사이트 비밀번호 12자 이상 의무화")).toEqual([]);
  });

  test("원문에 없으면 여전히 누출", () => {
    expect(runs("금융위가 광고를 점검해요. 규칙 준수했습니다.", "금융위, 가상자산 광고 점검")).toEqual(["규칙 준수"]);
  });

  test("한국어에 쓰지 않는 중국어·일본어 문장부호는 단독으로도 오염 (운영 데이터 「좋겠어요。」)", () => {
    expect(runs("좋겠어요。")).toEqual(["。"]);
    expect(runs("늘었ー다")).toEqual(["ー"]);
    expect(runs("금리、환율")).toEqual(["、"]);
    expect(runs("확보하세요.\u3000다음")).toEqual(["\u3000"]);
    expect(runs("수익률이 \uFFFD\uFFFD")).toEqual(["\uFFFD\uFFFD"]);
  });

  test("한국어에서도 쓰는 낫표와 가운뎃점은 정상", () => {
    expect(findForeignScript("「이 인사이트는」 『경제』 금·은")).toEqual([]);
  });
});

describe("findForeignScript — 운영 복구 뒤 추가한 지시문·구조 누출", () => {
  test("지시문 변형", () => {
    expect(findForeignScript("소비 계획은 신중히 세우세요. 일본어 및 금지 문구 주의하세요.").map((i) => i.reason)).toContain("prompt-leak");
    expect(findForeignScript("본 템플릿에 따라 정리했습니다.").map((i) => i.reason)).toContain("prompt-leak");
  });

  test("출력 구조(JSON 필드) 누출", () => {
    for (const t of [
      "아래 섹션별로 정리합니다.\n\nsections: [\n {\"title\": \"국내\"",
      "점검해야 합니다.\n\nrelatedArticleIds: [19927,19930]",
      "뒷받침합니다.\n\nevidence: [\n {\"text\":\"코스피\"",
      "논의 가속화\n\nkey data: [\"기준금리 인상\"]",
      "제안합니다.\n\n임팩트: high\n기간: short",
      "섹션들: [ {",
    ]) expect(findForeignScript(t).map((i) => i.reason)).toContain("prompt-leak");
  });

  test("필드 이름 뒤에 괄호가 없는 평범한 문장, 원문에 있는 문구는 통과", () => {
    expect(findForeignScript("근거(evidence)는 기사 세 건입니다. 임팩트: 중간 정도예요.")).toEqual([]);
    expect(findForeignScript("JSON schema 표준이 개정됐어요.", "W3C, JSON schema 표준 개정")).toEqual([]);
  });
});
