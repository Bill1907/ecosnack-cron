/**
 * Few-shot 예시 - AI 분석 품질 향상을 위한 고품질 예시
 *
 * 카테고리별로 좋은 분석 예시를 제공하여 AI가 형식과 깊이를 학습하도록 함
 */

import type { NewsAnalysisResult } from "@/schemas/news-analysis.ts";

// ============================================
// 예시 타입 정의
// ============================================

export interface AnalysisExample {
  category: string;
  input: {
    title: string;
    description: string;
    source: string;
    region: "US" | "KR";
  };
  output: NewsAnalysisResult;
  reasoning: string; // 왜 이렇게 분석했는지 설명
}

// ============================================
// 정책/금리 관련 예시 (Policy)
// ============================================

export const POLICY_EXAMPLE: AnalysisExample = {
  category: "policy",
  input: {
    title: "Fed Raises Interest Rates by 0.25%, Signals More Hikes Ahead",
    description:
      "The Federal Reserve raised its benchmark interest rate by 25 basis points to a range of 5.25%-5.5%, the highest level in 22 years. Chair Powell indicated that further rate increases may be necessary to bring inflation down to the 2% target.",
    source: "CNBC",
    region: "US",
  },
  output: {
    headline_summary:
      "미 연준이 기준금리를 0.25%p 인상하여 22년래 최고 수준인 5.25~5.5%로 올리고, 추가 인상 가능성을 시사했다.",
    so_what: {
      main_point:
        "미국 중앙은행의 금리 결정은 전 세계 금융시장의 기준점 역할을 한다. 이번 인상으로 달러 강세가 지속되고, 신흥국 자본 유출 압력이 커질 수 있다. 또한 미국 내 모기지, 자동차 대출 등 소비자 금융 비용이 상승하여 경기 둔화 가능성이 높아진다.",
      market_signal:
        "부정적 - 높은 금리는 기업 이익과 주식 밸류에이션에 부담. 특히 성장주와 기술주에 불리. 다만 은행주는 순이자마진 개선으로 수혜 가능.",
      time_horizon: "medium",
    },
    impact_analysis: {
      investors: {
        summary:
          "주식시장 변동성 확대 예상. 채권 금리 상승으로 안전자산 매력도 증가. 달러 강세로 해외 투자 시 환차손 주의 필요.",
        action_items: [
          "포트폴리오 내 성장주 비중 점검",
          "단기 채권 ETF 비중 확대 고려",
          "달러 익스포저 조정 검토",
        ],
        sectors_affected: [
          "은행 (수혜)",
          "부동산 (피해)",
          "기술주 (피해)",
          "유틸리티 (피해)",
        ],
      },
      workers: {
        summary:
          "고금리 환경이 지속되면 기업들의 채용 축소와 비용 절감 압력이 높아질 수 있다. 특히 금리에 민감한 부동산, 건설업 일자리 영향 우려.",
        industries_affected: [
          "부동산/건설",
          "스타트업/벤처",
          "소매유통",
          "제조업",
        ],
        job_outlook:
          "단기적으로 채용 시장 위축 가능. 다만 AI, 헬스케어 등 필수 분야는 견조한 수요 유지 전망.",
      },
      consumers: {
        summary:
          "모기지, 자동차 대출, 신용카드 이자 비용 상승으로 가계 부담 증가. 저축 금리도 올라 예금 매력은 증가.",
        price_impact:
          "대출 이자 부담 증가, 주택 구매력 하락. 반면 예금 이자 수입 증가.",
        spending_advice:
          "대출이 있다면 고정금리 전환 검토. 큰 지출은 현금 비중 늘려 대응. 고금리 예금 상품 활용.",
      },
    },
    related_context: {
      background:
        "연준은 2022년 3월부터 공격적인 금리 인상 사이클을 시작했다. 인플레이션이 9%까지 치솟았던 것에 대응하기 위한 조치였으며, 이번이 11번째 인상이다.",
      related_events: [
        "2023년 3월 SVB 은행 파산 - 금리 인상의 부작용 사례",
        "유럽중앙은행(ECB)도 금리 인상 지속 중",
        "일본은행은 여전히 초저금리 정책 유지",
      ],
      what_to_watch:
        "9월 FOMC 회의에서 추가 인상 여부 결정 예정. 8월 고용지표와 CPI가 핵심 변수. 인플레이션 둔화 속도에 따라 연내 동결 가능성도 존재.",
    },
    keywords: ["연준", "금리인상", "인플레이션", "파월", "FOMC", "달러"],
    category: "policy",
    sentiment: {
      overall: "negative",
      confidence: 0.85,
    },
    importance_score: 9,
  },
  reasoning:
    "미국 중앙은행의 금리 결정은 전 세계 금융시장에 직접적인 영향을 미치는 시스템적 이벤트이다. 모든 자산군(주식, 채권, 부동산, 환율)에 영향을 주고, 투자자/직장인/소비자 모두에게 실질적 영향이 있어 9점 부여.",
};

// ============================================
// 기업 실적 관련 예시 (Earnings)
// ============================================

export const EARNINGS_EXAMPLE: AnalysisExample = {
  category: "earnings",
  input: {
    title: "삼성전자, 2분기 영업이익 96% 급감…반도체 업황 악화",
    description:
      "삼성전자가 2분기 영업이익 6,700억원을 기록하며 전년 동기 대비 96% 급감했다. 메모리 반도체 가격 하락과 재고 조정이 주요 원인으로, 회사는 하반기 점진적 회복을 전망했다.",
    source: "매일경제",
    region: "KR",
  },
  output: {
    headline_summary:
      "삼성전자 2분기 영업이익이 전년 대비 96% 급감한 6,700억원을 기록, 메모리 반도체 업황 악화가 주원인이다.",
    so_what: {
      main_point:
        "삼성전자는 한국 증시 시가총액의 약 20%를 차지하는 대장주로, 실적 악화는 코스피 전반과 관련 밸류체인에 영향을 미친다. 다만 실적 바닥 통과 기대감이 있어 주가는 이미 선반영된 측면이 있다.",
      market_signal:
        "혼재 - 실적은 부정적이나 업황 바닥 신호로 해석 가능. 하반기 AI 관련 수요 회복 기대.",
      time_horizon: "medium",
    },
    impact_analysis: {
      investors: {
        summary:
          "반도체 섹터 투자자들은 업황 사이클 저점 매수 기회 여부 판단 필요. 삼성전자 실적은 SK하이닉스, 반도체 장비주 등에도 영향.",
        action_items: [
          "반도체 사이클 바닥 여부 모니터링",
          "분할 매수 전략 검토",
          "AI 반도체 수혜 종목 점검",
        ],
        sectors_affected: [
          "반도체 (삼성전자, SK하이닉스)",
          "반도체 장비 (삼성전기, 한미반도체)",
          "디스플레이",
        ],
      },
      workers: {
        summary:
          "삼성전자 협력사 및 반도체 업계 전반적으로 비용 절감 압력 존재. 다만 대규모 구조조정보다는 투자 축소/연기 형태로 나타날 가능성.",
        industries_affected: [
          "반도체 제조",
          "반도체 장비",
          "소재/부품",
          "IT 서비스",
        ],
        job_outlook:
          "신규 채용 보수적, 기존 인력 유지 기조. HBM 등 차세대 기술 인력은 여전히 수요 높음.",
      },
      consumers: {
        summary:
          "메모리 가격 하락으로 PC, 스마트폰 가격 안정화 기대. 반면 삼성전자 주주라면 배당 축소 가능성 인지 필요.",
        price_impact:
          "전자제품 가격에는 긍정적 영향 가능. 메모리 가격 하락이 완제품 가격 인하로 이어질 수 있음.",
        spending_advice:
          "PC나 스마트폰 구매를 계획 중이라면 급할 필요 없음. 가격 안정세 지속 전망.",
      },
    },
    related_context: {
      background:
        "2022년 하반기부터 시작된 메모리 반도체 다운사이클은 수요 위축과 재고 누적으로 가격이 50% 이상 하락했다. 2023년 상반기가 업황 저점으로 예상되어 왔다.",
      related_events: [
        "SK하이닉스도 대규모 적자 기록",
        "마이크론 실적도 부진, 감산 발표",
        "엔비디아 AI GPU 수요 폭발로 HBM 수요 급증",
      ],
      what_to_watch:
        "3분기 실적에서 회복 조짐 확인 여부가 관건. AI 서버용 HBM 매출 성장률과 메모리 가격 반등 시점 주목.",
    },
    keywords: [
      "삼성전자",
      "반도체",
      "영업이익",
      "메모리",
      "실적",
      "HBM",
      "AI",
    ],
    category: "business",
    sentiment: {
      overall: "mixed",
      confidence: 0.75,
    },
    importance_score: 8,
  },
  reasoning:
    "삼성전자는 한국 최대 기업이자 글로벌 반도체 시장의 핵심 플레이어. 실적 급감은 한국 증시와 반도체 밸류체인 전반에 영향을 미치지만, 시장이 이미 예상한 부분이 있어 8점.",
};

// ============================================
// 거시경제 지표 예시 (Macro)
// ============================================

export const MACRO_EXAMPLE: AnalysisExample = {
  category: "macro",
  input: {
    title: "US Inflation Falls to 3% in June, Lowest in Over Two Years",
    description:
      "Consumer prices rose 3% in June from a year ago, down from 4% in May and well below the 9.1% peak in June 2022. Core inflation, which excludes food and energy, came in at 4.8%, also lower than expected.",
    source: "Yahoo Finance",
    region: "US",
  },
  output: {
    headline_summary:
      "미국 6월 소비자물가지수(CPI)가 전년 대비 3% 상승에 그쳐 2년여 만에 최저치를 기록, 인플레이션 둔화 신호가 강해졌다.",
    so_what: {
      main_point:
        "인플레이션 둔화는 연준의 금리 인상 사이클 종료 가능성을 높인다. 이는 주식시장에 긍정적이며, 특히 금리에 민감한 성장주와 부동산에 호재다. 다만 근원 인플레이션이 여전히 목표치(2%)를 상회해 조기 금리 인하 기대는 시기상조.",
      market_signal:
        "긍정적 - 인플레이션 피크아웃 확인. 금리 인상 사이클 종료 기대감 상승. 위험자산 선호도 증가.",
      time_horizon: "short",
    },
    impact_analysis: {
      investors: {
        summary:
          "금리 인상 우려 완화로 주식시장 긍정적. 성장주, 기술주 반등 가능. 채권 가격 상승(금리 하락) 기대.",
        action_items: [
          "성장주 비중 점진적 확대 검토",
          "장기 채권 투자 타이밍 고려",
          "인플레이션 헤지 자산 비중 조정",
        ],
        sectors_affected: [
          "기술주 (수혜)",
          "성장주 (수혜)",
          "부동산 (수혜)",
          "원자재 (중립)",
        ],
      },
      workers: {
        summary:
          "인플레이션 둔화는 실질임금 개선을 의미. 물가 상승 압력 완화로 생활비 부담 경감 기대.",
        industries_affected: [
          "전 산업 긍정적",
          "특히 소매, 외식 등 소비재 섹터",
        ],
        job_outlook:
          "경기 연착륙 시나리오 강화로 고용시장 안정 기대. 다만 금리 수준은 여전히 높아 채용 회복은 점진적.",
      },
      consumers: {
        summary:
          "물가 상승세 둔화로 가계 구매력 회복 기대. 특히 식품, 에너지 가격 안정이 체감 물가 개선에 기여.",
        price_impact:
          "전반적 물가 상승 압력 완화. 다만 주거비, 서비스 물가는 여전히 높은 수준 유지.",
        spending_advice:
          "급한 큰 지출이 아니라면 금리 인하 전까지 대기 전략 유효. 예금 이자는 당분간 높은 수준 유지.",
      },
    },
    related_context: {
      background:
        "2021-2022년 코로나 이후 공급망 병목과 과잉 유동성으로 미국 인플레이션이 40년래 최고치까지 치솟았다. 연준의 공격적 금리 인상으로 물가가 안정세를 찾아가는 중.",
      related_events: [
        "에너지 가격 하락 (유가 $70대 안정)",
        "공급망 정상화로 상품 물가 하락",
        "노동시장 과열 완화 조짐",
      ],
      what_to_watch:
        "7월 FOMC에서 0.25%p 추가 인상 예상되나 이후 동결 가능성. 하반기 CPI 추이와 고용지표가 통화정책 방향 결정.",
    },
    keywords: ["인플레이션", "CPI", "물가", "연준", "금리", "경기연착륙"],
    category: "economy",
    sentiment: {
      overall: "positive",
      confidence: 0.8,
    },
    importance_score: 9,
  },
  reasoning:
    "미국 CPI는 연준 통화정책의 핵심 지표이자 글로벌 금융시장의 방향을 결정하는 거시지표. 인플레이션 둔화 확인은 금리 정책 전환점을 시사하여 전 자산군에 영향. 9점.",
};

// ============================================
// 모든 예시 모음
// ============================================

export const ANALYSIS_EXAMPLES: AnalysisExample[] = [
  POLICY_EXAMPLE,
  EARNINGS_EXAMPLE,
  MACRO_EXAMPLE,
];

/**
 * 카테고리에 맞는 예시 반환
 */
export function getExampleByCategory(
  category: string
): AnalysisExample | undefined {
  return ANALYSIS_EXAMPLES.find((ex) => ex.category === category);
}

/**
 * 지역에 맞는 예시 반환
 */
export function getExamplesByRegion(region: "US" | "KR"): AnalysisExample[] {
  return ANALYSIS_EXAMPLES.filter((ex) => ex.input.region === region);
}

/**
 * 프롬프트용 예시 포맷팅
 */
export function formatExampleForPrompt(example: AnalysisExample): string {
  return `
### 예시: ${example.input.title}

**입력 정보:**
- 제목: ${example.input.title}
- 설명: ${example.input.description}
- 출처: ${example.input.source}

**분석 결과:**
\`\`\`json
${JSON.stringify(example.output, null, 2)}
\`\`\`

**분석 근거:** ${example.reasoning}
`;
}
