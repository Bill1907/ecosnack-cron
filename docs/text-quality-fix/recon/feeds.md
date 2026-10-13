# Yahoo Finance 대체용 미국 경제 RSS 후보 조사

- 측정 시각: 2026-10-13 04:30~04:45 UTC (KST 13:30). 미국 기준 월요일 밤~화요일 새벽이고, 10/12(월)은 Columbus Day였다. 그래서 미국 매체의 "최신 항목 경과 시간"은 평일 낮보다 길게 나온다.
- 측정 위치: 로컬 macOS(가정용 회선). **Cloudflare Workers의 데이터센터 IP에서는 측정하지 않았다**(아래 '데이터센터 IP 위험' 참고).
- 죽은 피드(기존 Yahoo): `https://finance.yahoo.com/news/rssindex` → **HTTP 404** (HTML 404 페이지). 다시 확인함.

## 측정 방법

스크립트: `~/.hermes/profiles/product-engineer/cache/scratch/tq/r2/probe.mjs` (스크래치, 커밋 대상 아님)

- 피드 요청은 앱과 같게 했다(`src/services/news-fetcher.ts`). Node 26 `fetch`, `User-Agent: Mozilla/5.0 (compatible; EcoSnackBot/1.0)`, `Accept: application/rss+xml, application/xml, text/xml, */*`, 타임아웃 15초.
- 파싱은 저장소의 `fast-xml-parser`로, 앱과 같은 설정(`ignoreAttributes:false, attributeNamePrefix:"@_"`)을 썼다. `rss.channel.item` 또는 `feed.entry`를 읽는다.
- 필드 수: 항목마다 title/link/description(또는 summary)/pubDate(또는 published)가 있는지 셌다. media:content·enclosure 유무도 함께 셌다.
- og:image: 앞쪽 3개 항목(주요 후보는 8개)의 기사 URL을 앱과 같은 UA로 받았다(`Accept: text/html,application/xhtml+xml`, 10초). 그리고 저장소의 `cheerio`로 앱과 같은 셀렉터(`og:image` → `twitter:image` → `og:image:url`)를 적용했다. HTTP 200이고 이미지 URL이 나올 때만 hit로 셌다.
- 유료벽: 기사 HTML의 JSON-LD `isAccessibleForFree` 값과 응답 상태(401 등)로 판단했다.
- 실행 명령:
  `node probe.mjs '<후보 JSON 배열>' nopages`(피드만), `node probe.mjs '<…>' pages 3`, `node probe.mjs '<…>' pages 8`
- 차단 여부는 `curl -A 'Mozilla/5.0 (compatible; EcoSnackBot/1.0)'`와 크롬 UA로 다시 확인했다.
- CNBC와 겹치는 정도는 두 가지로 봤다.
  - 링크 완전 일치 수
  - 제목 토큰 Jaccard ≥ 0.25: 기존 CNBC Business+Economy 60개 제목 중 하나와 비슷하면 '겹침'으로 셌다.

## 후보 표

열 설명
- 경과(h): 최신 항목 pubDate가 측정 시각보다 몇 시간 전인지
- 24h: 최근 24시간 안의 항목 수
- 필드: title/link/desc/pubDate 순서로 채워진 항목 수 ÷ 전체 항목 수

| # | 후보 | URL | HTTP | 형식·항목 | 경과(h) | 24h | 필드 t/l/d/p | og:image hit | 유료벽 | 비고 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **CBS MoneyWatch** | https://www.cbsnews.com/latest/rss/moneywatch | 200 | RSS2·30 | 8.0 | 6 | 30/30/30/30 (+`<image>` 60x60) | **3/3, 8/8** | 없음 (`isAccessibleForFree:true`) | 30개가 14일에 걸쳐 있음. 8개 중 2개는 `/video/` 링크(og:image 있음) |
| 2 | **Fox Business Economy** | https://moxie.foxbusiness.com/google-publisher/economy.xml | 200 | RSS2·25 | 7.6 | 4 | 25/25/25/25 (+media 25) | **3/3, 8/8** | 없음(표식 없음) | 리콜 공지 같은 잡음이 섞임. moxie 서브도메인 robots.txt가 `Disallow: /` |
| 3 | Fox Business Latest | https://moxie.foxbusiness.com/google-publisher/latest.xml | 200 | RSS2·25 | 2.5 | 11 | 25/25/25/25 | 3/3, 8/8 | 없음 | 스포츠·라이프스타일이 섞임 |
| 4 | Fox Business Markets | https://moxie.foxbusiness.com/google-publisher/markets.xml | 200 | RSS2·25 | 155.8 | 0 | 25/25/25/25 | 미측정 | – | 6일 넘게 갱신 없음 |
| 5 | ABC News Money | https://abcnews.go.com/abcnews/moneyheadlines (→ abcnews.com) | 200 | RSS2·25 | 0.4 | 2 | 25/25/25/25 | 3/3, 8/8 | 없음 | 대부분 AP `wireStory`(AP 전재) |
| 6 | Yahoo 종목 헤드라인(^GSPC) | https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US | 200 | RSS2·18 | 3.0 | 18 | 18/18/18/18 | 2/3, 6/8 | – | 링크 18개 중 trefis.com 12, finance.yahoo.com 3, stocktwits.com 2(403 Cloudflare "Just a moment..."), 247wallst 1. 집계형이고 품질이 낮음 |
| 6b | Yahoo 헤드라인(^GSPC,^DJI,^IXIC) | https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC,%5EDJI,%5EIXIC&region=US&lang=en-US | 200 | RSS2·20 | 0.7 | 20 | 20/20/20/20 | 6/8 | – | 위와 같은 구성(trefis 12) |
| 7 | Yahoo 다른 경로 | `finance.yahoo.com/rss/topstories`, `finance.yahoo.com/rss/`, `news.yahoo.com/rss/finance` | 404 | – | – | – | – | – | – | **없음** |
| 8 | MarketWatch Top Stories | https://feeds.content.dowjones.io/public/rss/mw_topstories (`feeds.marketwatch.com/marketwatch/topstories/`도 여기로 리다이렉트) | 200 | RSS2·10 | 2.5 | 10 | 10/10/10/10 | **0/3 (401, 775B 차단 페이지)** | 일부 | 기사 페이지가 봇 UA를 차단함 |
| 9 | MarketWatch Real-time / MarketPulse | …/mw_realtimeheadlines, …/mw_marketpulse | 200 | 10 / 30 | 11733 / 11200 | 0 | desc 0 | 미측정 | – | 1년 넘게 갱신 없음(사실상 죽음) |
| 10 | WSJ Markets | https://feeds.content.dowjones.io/public/rss/RSSMarketsMain | 200 | RSS2·61 | 1.4 | 25 | 61/61/61/61 | **0/3 (401)** | 있음(WSJ) | |
| 11 | WSJ US Business | https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness | 200 | RSS2·85 | 1.5 | 30 | 85/85/83/85 | 0/3 (401) | 있음 | |
| 12 | WSJ Economy | https://feeds.content.dowjones.io/public/rss/socialeconomyfeed | 200 | RSS2·36 | 2.0 | 2 | 36/36/36/36 | 미측정(같은 wsj.com) | 있음 | |
| 13 | NYT Business | https://rss.nytimes.com/services/xml/rss/nyt/Business.xml | 200 | RSS2·50 | 0.0 | 9 | 50/50/50/50 | **0/3 (403, 771B)** | 미터제 | |
| 14 | NYT Economy | https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml | 200 | RSS2·20 | 1.5 | 2 | 20/20/19/20 | 0/3 (403) | 미터제 | |
| 15 | NPR Economy | https://feeds.npr.org/1017/rss.xml | 200 | RSS2·10 | 6.8 | 2 | 10/10/10/10 | **0/8 (봇 UA에서 HTTP/2 스트림 리셋)** | 없음 | 크롬 UA는 200. 봇 UA로는 curl이 `000`. NPR Business(`/1006/rss.xml`)도 10개, 7.0h |
| 16 | Business Insider (all) | https://feeds.businessinsider.com/custom/all | 200 | **Atom**·20 | 0.3 | 20 | 20/20/20(summary)/20(published) | 3/3 | 있음(`isAccessibleForFree:false`) | **`summary`가 `{#text,@_type}` 객체로 파싱돼, 현재 `parseRssItem`의 `description.replace`에서 예외 → 20개 전부 버려짐** |
| 17 | BI Markets news | https://markets.businessinsider.com/rss/news | 200 | RSS2·10 | 14.0 | 10 | 10/10/10/10 | 3/3 | – | 대부분 GlobeNewswire 보도자료. description이 HTML |
| 18 | Fortune | https://fortune.com/feed/ (→ `/feed/fortune-feeds/?id=3230629`) | 200 | RSS2·10 | 2.4 | 9 | 10/10/10/10 | 3/3 | **있음**(`isAccessibleForFree:false`) | 섹션 피드 `fortune.com/section/finance/feed/`는 **없음**(404) |
| 19 | Investing.com Economy / Stock Market | https://www.investing.com/rss/news_14.rss, …/news_25.rss | 200 | RSS2·10 | 9.4 | 10 | 10/10/**0**/10 | **0/3 (403, 본문 3바이트)** | – | description 없음 |
| 20 | Seeking Alpha Market Currents / All | https://seekingalpha.com/market_currents.xml, …/feed.xml | 200 | 7 / 30 | 0.3 | 7 / 30 | desc **0** | 3/3 | 확인 못함 | description 없음 |
| 21 | CNBC Top News | https://www.cnbc.com/id/100003114/device/rss/rss.html | 200 | RSS2·30 | 0.7 | 30 | 30/30/30/30 | 3/3 | – | **기존 CNBC 2개와 링크 7/30 일치** |
| 22 | CNBC Finance | https://www.cnbc.com/id/10000664/device/rss/rss.html | 200 | RSS2·30 | 1.5 | 4 | 30/30/30/30 | 3/3 | – | 기존과 1/30 겹침 |
| 23 | CNBC Investing | https://www.cnbc.com/id/15839069/device/rss/rss.html | 200 | RSS2·29 | 9.8 | 3 | 29/29/29/29 | 3/3 | 확인 못함(Pro 기사 섞일 수 있음) | 기존과 0/29 겹침. 옵션·종목 위주 |
| 24 | CNBC Market Insider | https://www.cnbc.com/id/20409666/device/rss/rss.html | 200 | RSS2·3 | 10.2 | 1 | 3/3/3/3 | 미측정 | – | 항목 3개뿐 |
| 25 | Guardian Economics / US business | https://www.theguardian.com/business/economics/rss, https://www.theguardian.com/us/business/rss | 200 | 20 / 19 | 1.3 / 14.2 | 7 / 1 | 전부 있음 | 3/3 (Economics) | 없음(`true`) | 영국·글로벌 관점(호주 기사도 섞임) |
| 26 | TheStreet | https://www.thestreet.com/.rss/full/ (리다이렉트) | 200 | RSS2·50 | 0.3 | 50 | 전부 | **0/3 (403 챌린지)** | – | 쇼핑 딜 기사가 섞임 |
| 27 | Benzinga | https://www.benzinga.com/feed | 200 | RSS2·10 | 14.3 | 10 | 전부 | **0/3 (403 Cloudflare "Attention Required")** | – | 코인 가격 예측 위주 |
| 28 | Kiplinger | https://www.kiplinger.com/feeds/all (→ feeds.xml) | 200 | RSS2·50 | 8.3 | 4 | 전부 | 3/3 | – | 개인 재무 위주 |
| 29 | BBC Business | https://feeds.bbci.co.uk/news/business/rss.xml | 200 | RSS2·40 | 1.3 | 18 | 전부 | 미측정 | – | 영국 매체(US 아님) |
| 30 | Federal Reserve 보도자료 | https://www.federalreserve.gov/feeds/press_all.xml | 200 | RSS2·20 | 86.5 | 0 | 전부 | 미측정 | 없음 | 1차 자료라 기사형이 아님 |
| 31 | CNN Money latest | http://rss.cnn.com/rss/money_latest.rss | 200 | RSS2·1 | 69656 | 0 | – | – | – | **죽음**(항목 1개, 약 8년 전) |
| 32 | Axios Markets | https://api.axios.com/feed/markets | 404 | – | – | – | – | – | – | **없음** |
| 33 | Nasdaq Markets | https://www.nasdaq.com/feed/rssoutbound?category=Markets | 오류 | – | – | – | – | – | – | 봇 UA에서 `ERR_HTTP2_STREAM_ERROR`(curl `000`) |

참고: 기존 피드의 같은 시각 값
- CNBC Business: 30개, 11.7h, 24h 4개, og 3/3
- CNBC Economy: 30개, 0.3h, 24h 5개, og 3/3

CNBC·Guardian·BI Markets 기사 HTML에는 `challenge-platform` 문자열(Cloudflare 스크립트)이 들어 있다. 하지만 상태가 200이고 og:image도 나왔으므로 차단으로 보지 않았다.

### CNBC와 겹치는 정도 (제목 Jaccard ≥ 0.25, 기존 CNBC 60개 기준)

| 후보 | 겹침 | 예시 |
|---|---|---|
| CBS MoneyWatch | 3/30 | Nobel 경제학상, Starbucks–Chipotle, Paramount–WBD (같은 사건, 다른 기사) |
| Fox Business Economy | 1/25 | 9월 고용 |
| Fox Business Latest | 1/25 | Starbucks–Chipotle |
| ABC News Money | 1/25 | Nobel |
| CNBC Top News | 7/30 | 링크 자체가 7개 완전 일치 |
| CNBC Finance / Investing | 1/30 / 0/29 | |
| Yahoo 헤드라인 | 0/18 | |

## 원문 응답 요약 (1·2순위)

**CBS MoneyWatch**
- 응답 헤더: `cache-control: max-age=300, public`, `via: 1.1 varnish` (Fastly/Varnish CDN)
- 채널 `<title>Moneywatch - CBSNews.com</title>`, `<ttl>5</ttl>`
- 항목 구조: `title`, `link`(https://www.cbsnews.com/news/...), `description`(평문 한 문장), `pubDate`(RFC822 `-0400`), `<image>`(60x60 썸네일), `guid isPermaLink="false"`(UUID)
- 첫 항목: "Squeezed by inflation, more Americans fall behind on their debts" — 2026-10-12T20:29Z
- 기사 페이지: 200, 600KB 안팎, `og:image` 있음, JSON-LD `isAccessibleForFree: true`
- robots.txt(`User-agent: *`)는 `/latest/rss/`와 `/news/`를 막지 않는다(`*/feed/`, `/stories` 등만 Disallow)

**Fox Business Economy**
- 응답 헤더: `x-served-by: cache-iad…, cache-icn…` (Fastly), `cache-control: must-revalidate, max-age=36`
- 항목마다 `media:content` 이미지가 있다. 기사 8/8에서 og:image(a57.foxnews.com) 추출
- `https://moxie.foxbusiness.com/robots.txt`: `User-agent: * / Disallow: /`이고, `Allow`는 `/google-publisher/politics.xml` 등 일부뿐
- 그런데 Fox Business 공식 RSS 안내 페이지(https://www.foxbusiness.com/fox-business-rss-feed)는 바로 이 `google-publisher/economy.xml`, `latest.xml`, `markets.xml` 등을 링크하고 있다

## 공개 약관·RSS 이용 조건 (확인한 것)

| 매체 | 문서 | 인용 |
|---|---|---|
| CBS News (Paramount) | https://legal.paramount.com/us/en/cbsi/terms-of-use | "You are only permitted to access and view the Content for personal, non-commercial purposes in accordance with these Terms, and may not build a business or other enterprise utilizing any of the Content, whether for profit or not." RSS 전용 조항은 https://www.cbsnews.com/rss/ 에서 **확인 못함**(피드 목록만 있음) |
| Fox Business | https://www.foxbusiness.com/terms-of-use | "Fox furnishes the Fox Services for your personal, non-commercial use and enjoyment." RSS 전용 조건은 **확인 못함** |
| NYT | https://www.nytimes.com/rss | "We allow the use of NYTimes.com RSS feeds for personal use in a news reader or as part of a non-commercial blog. … Commercial use of the Service is prohibited without prior written permission" |
| Yahoo | https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html | "If you use an RSS feed provided by us … you are only permitted to display the content that is provided in the feed, without modification, and you must provide attribution … You may not incorporate advertising into any Yahoo RSS Feed." |
| ABC News (Disney) | https://disneytermsofuse.com/english/ | "the Disney Products are for your personal, noncommercial use". RSS 안내(https://abcnews.go.com/Site/page/rss-feeds-3520115)에는 이용 조건 문구가 없음 |
| CNBC(기존), WSJ/MarketWatch, NPR, BI, Fortune, Investing, Seeking Alpha 등 | – | **확인 못함**(CNBC RSS 페이지는 SPA라 조건 문구를 못 얻음. `dowjones.com/rss-feeds/`는 404) |

정리하면, 확인한 매체는 모두 "개인·비상업적 이용"을 전제로 한다. heyvona.com은 애드센스가 붙는 상업 사이트다. 다만 이것은 기존 CNBC 피드에도 똑같이 걸리는 문제이고, 새로 고르는 피드만의 결격 사유는 아니다. 그래도 사람이 판단해야 할 사항이다.

## 추천

### 1순위: CBS MoneyWatch

- URL: `https://www.cbsnews.com/latest/rss/moneywatch`
- source 이름: `CBS MoneyWatch`
- region: `US`

```ts
{ url: "https://www.cbsnews.com/latest/rss/moneywatch", source: "CBS MoneyWatch", region: "US" }
```

이유
- 이미지: 같은 봇 UA로 기사 8개를 받아 og:image가 **8/8** 나왔다. 앱의 "이미지 있는 기사 우선" 로직에서 실제로 선택될 수 있다.
- 유료벽: 없다. JSON-LD `isAccessibleForFree:true`를 확인했다.
- 봇 차단: 기사 페이지가 봇 UA에 200으로 응답했다. 챌린지 흔적이 없고, robots.txt도 해당 경로를 막지 않는다.
- CNBC와 겹침이 적다: 제목 기준 3/30이고 링크 일치는 0이다. 시장·기업 위주인 CNBC와 달리 물가·가계부채·연료비 같은 미국 가계 경제 관점이다.
- 피드가 앱 파서와 바로 맞는다. RSS 2.0이고 title/link/description/pubDate가 모두 문자열이다. 픽스처를 저장소 `fast-xml-parser` 설정으로 파싱해 8개 모두 4개 필드가 있고 날짜 파싱이 되는 것을 확인했다.

### 2순위: Fox Business Economy

- URL: `https://moxie.foxbusiness.com/google-publisher/economy.xml`
- source 이름 제안: `Fox Business Economy`
- region: `US`

장점
- og:image 8/8, 유료벽 없음, CNBC와 겹침 1/25
- 항목마다 media:content가 있다

주의점
- moxie 서브도메인 robots.txt가 전체 `Disallow: /`이다. 공식 RSS 안내 페이지는 이 피드를 링크하고 있다.
- 리콜 공지 같은 저가치 항목이 섞인다.
- 갱신량을 더 원하면 `latest.xml`(24h 11개)도 있지만, 스포츠·라이프스타일이 섞인다.

### 탈락 사유 요약

- WSJ / MarketWatch / NYT / Investing / TheStreet / Benzinga: 기사 페이지가 봇 UA에 401/403(챌린지)으로 응답해 og:image가 0이다. 앱이 이 기사들을 거의 고르지 않는다. WSJ와 NYT는 유료벽도 있다.
- NPR: 피드는 정상이다. 하지만 봇 UA로 기사 페이지를 받으면 HTTP/2 스트림이 리셋돼 og:image가 0/8이다.
- Yahoo 종목 헤드라인 피드: 살아 있지만 링크의 2/3가 trefis.com 같은 집계형 콘텐츠다. stocktwits 링크는 Cloudflare 챌린지에 걸리고, Yahoo 약관은 RSS 내용 수정과 광고 결합을 금지한다. 같은 Yahoo의 레거시 경로라서 언제든 없어질 수 있다.
- Business Insider: Atom `summary`가 객체로 파싱돼 현재 파서에서 항목이 전부 버려진다. 유료벽도 있다.
- Fortune: 유료벽이 있다. Seeking Alpha: description이 없다.
- CNBC 다른 섹션: Top News는 기존과 7/30이 겹친다. Investing은 겹치지 않지만, CNBC 비중을 늘리는 것이라 미국 매체 다양화라는 목적과 맞지 않는다.

## 위험·한계

1. **데이터센터 IP 위험: 측정하지 못했다.** 모든 측정은 가정용 회선에서 했다.
   - CBS와 Fox는 Fastly/Varnish CDN 뒤에 있고, 봇 UA로 받았을 때 챌린지 흔적이 없었다.
   - 하지만 Workers egress IP에서도 그런지는 확인하지 않았다.
   - 배포 전에 Worker에서 1회 확인하는 것이 좋다: `wrangler dev --remote` 또는 임시 라우트로 피드 1회와 기사 1~2개를 fetch.
2. **양이 적다.** CBS MoneyWatch는 24시간에 6개뿐이고, 30개가 14일에 걸쳐 있다.
   - 6시간 주기로 돌리면 한 번에 새 항목이 1~3개 정도일 것으로 추정한다(측정값 아님).
   - Yahoo가 맡던 30% 비중을 혼자 다 채우지는 못할 수 있다. 2순위와 함께 쓰는 것을 고려할 만하다.
3. **영상·비경제 항목이 섞인다.**
   - 픽스처 8개 중 2개가 `/video/` 링크다. og:image는 있지만 본문 텍스트가 얇다.
   - "Philadelphia police … Anthropic AI" 같은 경제 외 기사도 있다.
4. **약관:** 위에서 정리한 대로, 확인한 매체 모두 개인·비상업 이용 조건이다.

## 픽스처

- `tests/fixtures/feeds/cbs-moneywatch.xml`
  - 2026-10-13 04:4x UTC에 받은 실제 응답(25,082B)에서 앞 8개 `<item>`만 남겼다. 9~30번째 item만 텍스트 단위로 잘라냈고, 선언·네임스페이스·채널 메타·공백은 원문 그대로다(7,208B).
  - 검증: 저장소 `fast-xml-parser`(앱과 같은 설정)로 파싱하면 `rss.channel.item` 8개가 나오고, 8개 모두 title·link·description·pubDate가 문자열이며 `new Date(pubDate)`가 유효하다.
  - 항목 날짜 범위: 2026-10-09T23:35Z ~ 2026-10-12T20:29Z
