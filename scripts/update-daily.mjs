import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TIME_ZONE = "Asia/Seoul";
const MODEL = process.env.GITHUB_MODEL || "openai/gpt-4.1-mini";
const TOKEN = process.env.GITHUB_TOKEN;
const API_VERSION = "2026-03-10";

if (!TOKEN) {
  throw new Error("GITHUB_TOKEN is required.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(800 * (attempt + 1));
  }
  throw lastError;
}

async function settledFlat(promises) {
  const results = await Promise.allSettled(promises);
  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

const now = new Date();
const briefingDate = process.env.TARGET_DATE
  ? new Date(`${process.env.TARGET_DATE}T09:00:00+09:00`)
  : now;
const dateParts = Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  })
    .formatToParts(briefingDate)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]),
);
const date = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
const displayDate = `${dateParts.year}. ${dateParts.month}. ${dateParts.day}`;
const updatedAt = now.toISOString();
const updatedAtText = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(now);
const weekdays = {
  Monday: "월요일",
  Tuesday: "화요일",
  Wednesday: "수요일",
  Thursday: "목요일",
  Friday: "금요일",
  Saturday: "토요일",
  Sunday: "일요일",
};
const day = weekdays[dateParts.weekday];

function kstDateString(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

const preferredDateValue = new Date(`${date}T00:00:00+09:00`);
preferredDateValue.setDate(preferredDateValue.getDate() - 1);
const preferredArticleDate = kstDateString(preferredDateValue);
const ARTICLE_LIMIT = 6;
const LOOKBACK_DAYS = 3;

const queries = [
  "어덜트 캐주얼 패션 브랜드 유통",
  "국내 패션 업계 브랜드 유통",
  "한국 패션 플랫폼 투자 실적",
  "K패션 디자이너 협업 팝업",
  "무신사 패션 신세계 현대백화점",
];

const priorityKeywords = [
  "독립문",
  "PAT",
  "피에이티",
  "어덜트",
  "어덜트 캐주얼",
  "adult",
  "4050",
  "5060",
  "중장년",
  "여성복",
  "남성복",
  "캐주얼",
];

const similarBrandKeywords = [
  "인디안",
  "브렌우드",
  "웰메이드",
  "올포유",
  "크로커다일레이디",
  "샤트렌",
  "올리비아로렌",
  "마담포라",
  "닥스",
  "헤지스",
  "빈폴",
];

const marketTrendKeywords = [
  "상권",
  "백화점",
  "아울렛",
  "로드숍",
  "가두점",
  "매장",
  "유통망",
  "소비",
  "객단가",
  "패션 동향",
  "트렌드",
  "중장년 시장",
];

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value = "") {
  return decodeXml(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanArticleTitle(value = "") {
  return stripTags(value)
    .replace(/\[[^\]]*(기자|뉴스|신문)[^\]]*\]\s*/g, "")
    .replace(/\s*[-|]\s*(어패럴뉴스|한국섬유신문|패션비즈|패션인사이트|이투데이|매일경제|한국경제|서울경제|헤럴드경제|뉴스1|뉴스|신문)\s*$/i, "")
    .replace(/\s*[-|]\s*[a-z0-9.-]+\.(com|co\.kr|kr|net|org)\s*$/i, "")
    .replace(/\s*[-|]\s*[^-|]{1,20}(뉴스|신문|경제|일보|투데이|저널)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSummaryText(value = "") {
  return stripTags(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\[[^\]]*(기자|뉴스|신문)[^\]]*\]\s*/g, "")
    .replace(/\s*[-|]\s*(어패럴뉴스|한국섬유신문|패션비즈|패션인사이트|이투데이|매일경제|한국경제|서울경제|헤럴드경제|뉴스1|뉴스|신문)\s*$/i, "")
    .replace(/\s*[-|]\s*[a-z0-9.-]+\.(com|co\.kr|kr|net|org)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceParts(value = "") {
  const cleaned = cleanSummaryText(value);
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=[.!?。！？다])\s+/)
    .map((item) => item.replace(/^[·•\-\s]+/, "").trim())
    .filter((item) => item.length >= 8)
    .slice(0, 6);
}

function fallbackSummaryBullets(item) {
  const parts = sentenceParts(item.description || item.summary || item.title);
  const bullets = parts.slice(0, 3);
  while (bullets.length < 3) {
    if (bullets.length === 0) bullets.push(`${cleanArticleTitle(item.title)} 관련 소식이 업계 주요 이슈로 확인됐습니다.`);
    else if (bullets.length === 1) bullets.push("브랜드 운영과 유통 전략 관점에서 추가 확인할 만한 내용입니다.");
    else bullets.push("세부 수치와 맥락은 원문 기사 확인이 필요합니다.");
  }
  return bullets.map((bullet) => cleanSummaryText(bullet)).slice(0, 3);
}

function articleKey(value = "") {
  return cleanArticleTitle(value)
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function topicKey(value = "") {
  const title = cleanArticleTitle(value).toLowerCase();
  const compact = title.replace(/[^\p{L}\p{N}]+/gu, "");
  const namedTopics = [
    "앙드레김",
    "키르시",
    "비바테크놀로지",
    "하이라이트브랜즈",
    "경기패션창작스튜디오",
    "8division",
  ];
  const named = namedTopics.find((topic) => compact.includes(topic.toLowerCase()));
  if (named) return `topic:${named.toLowerCase()}`;

  const stopwords = new Set([
    "패션",
    "국내",
    "업계",
    "브랜드",
    "글로벌",
    "전략",
    "강화",
    "확대",
    "가속",
    "주목",
    "진출",
    "유통",
    "시장",
    "ai",
    "k",
  ]);
  const tokens = title
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 2 && !stopwords.has(token));
  return tokens.slice(0, 4).sort().join("|");
}

function articleDateString(value = "") {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? kstDateString(new Date(timestamp)) : "";
}

function titleScore(value = "") {
  const title = cleanArticleTitle(value);
  if (!title) return 0;
  let score = Math.min(title.length, 90);
  if (title.length < 8) score -= 35;
  if (/^\S{1,5}\s*(위한|증가|강화|확대|부상)\s*$/i.test(title)) score -= 30;
  if (/[.?!…]$/.test(title)) score += 4;
  return score;
}

function bestTitle(...values) {
  return values
    .map(cleanArticleTitle)
    .filter(Boolean)
    .sort((a, b) => titleScore(b) - titleScore(a))[0] || "";
}

function getTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]).trim() : "";
}

function getAttribute(block, attribute) {
  const match = block.match(new RegExp(`${attribute}=["']([^"']+)["']`, "i"));
  return match ? decodeXml(match[1]).trim() : "";
}

function absolutizeUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return "";
  }
}

function isExternalImage(url = "") {
  return /^https?:\/\//i.test(url);
}

function isUsableArticleImage(url = "") {
  if (!isExternalImage(url)) return false;
  try {
    const parsed = new URL(url);
    if (/googleusercontent\.com$/i.test(parsed.hostname)) return false;
    if (/news\.google\.com$/i.test(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function imageKey(url = "") {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
  } catch {
    return String(url || "").trim().toLowerCase();
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchFeed(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    `${query} when:7d`,
  )}&hl=ko&gl=KR&ceid=KR:ko`;
  const response = await fetchWithRetry(url, {
    headers: { "User-Agent": "FashionDailyArchive/1.0" },
  });
  if (!response.ok) throw new Error(`RSS request failed: ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const block = match[1];
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const mediaMatch = block.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*(?:url|href)=["']([^"']+)["'][^>]*>/i);
    const descriptionImageMatch = getTag(block, "description").match(/<img\b[^>]*src=["']([^"']+)["']/i);
    return {
      title: stripTags(getTag(block, "title")),
      url: stripTags(getTag(block, "link")),
      publishedAt: getTag(block, "pubDate"),
      source: sourceMatch ? stripTags(sourceMatch[1]) : "",
      description: stripTags(getTag(block, "description")),
      imageUrl: mediaMatch ? decodeXml(mediaMatch[1]) : descriptionImageMatch ? decodeXml(descriptionImageMatch[1]) : "",
    };
  });
}

async function fetchPageImage(url) {
  try {
    const response = await fetchWithRetry(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; FashionDailyArchive/1.0; +https://github.com/pse7077/fashion-daily-archive)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return "";
    const html = await response.text();
    const patterns = [
      /<meta\b[^>]*(?:property|name)=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::secure_url)?["'][^>]*>/i,
      /<meta\b[^>]*(?:property|name)=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']twitter:image(?::src)?["'][^>]*>/i,
      /<meta\b[^>]*itemprop=["']image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<link\b[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["'][^>]*>/i,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      const image = match ? absolutizeUrl(decodeXml(match[1]), response.url) : "";
      if (isUsableArticleImage(image)) return image;
    }
    return "";
  } catch {
    return "";
  }
}

async function fetchHtml(url) {
  const response = await fetchWithRetry(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; FashionDailyArchive/1.0; +https://github.com/pse7077/fashion-daily-archive)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`HTML request failed: ${response.status} ${url}`);
  return {
    html: await response.text(),
    url: response.url,
  };
}

function extractLinks(html, baseUrl, patterns) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeXml(match[1]);
    const text = stripTags(match[2]);
    try {
      const url = new URL(href, baseUrl).toString();
      if (patterns.some((pattern) => pattern.test(url))) {
        links.push({ url, text });
      }
    } catch {
      // Ignore invalid links.
    }
  }
  const seenUrls = new Set();
  return links.filter((link) => {
    if (seenUrls.has(link.url)) return false;
    seenUrls.add(link.url);
    return true;
  });
}

function metaContent(html, names) {
  for (const name of names) {
    const patterns = [
      new RegExp(`<meta\\b[^>]*(?:property|name|itemprop)=["']${name}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${name}["'][^>]*>`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeXml(match[1]).trim();
    }
  }
  return "";
}

function pageTitle(html) {
  return bestTitle(
    stripTags((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || ""),
    metaContent(html, ["og:title", "twitter:title"]) ||
    stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")
  );
}

function pageDescription(html) {
  return metaContent(html, ["description", "og:description", "twitter:description"]);
}

function pagePublishedAt(html) {
  return metaContent(html, [
    "article:published_time",
    "article:modified_time",
    "date",
    "pubdate",
    "publishdate",
  ]);
}

function pageImage(html, baseUrl) {
  const image = metaContent(html, [
    "og:image:secure_url",
    "og:image",
    "twitter:image",
    "twitter:image:src",
    "image",
  ]);
  const absolute = image ? absolutizeUrl(image, baseUrl) : "";
  return isUsableArticleImage(absolute) ? absolute : "";
}

async function fetchArticleDetails(link, source) {
  try {
    const { html, url } = await fetchHtml(link.url);
    return {
      title: bestTitle(pageTitle(html), link.text),
      url,
      publishedAt: pagePublishedAt(html),
      source,
      description: pageDescription(html),
      imageUrl: pageImage(html, url),
      sourceType: "direct",
    };
  } catch {
    return null;
  }
}

async function fetchDirectSource({ homeUrl, source, patterns, limit = 12 }) {
  try {
    const { html } = await fetchHtml(homeUrl);
    const links = extractLinks(html, homeUrl, patterns).slice(0, limit);
    const articles = await Promise.all(links.map((link) => fetchArticleDetails(link, source)));
    return articles.filter(Boolean);
  } catch {
    return [];
  }
}

const directSources = [
  {
    homeUrl: "https://www.apparelnews.co.kr/",
    source: "어패럴뉴스",
    patterns: [/apparelnews\.co\.kr\/news\/news_view/i],
    limit: 16,
  },
  {
    homeUrl: "https://www.ktnews.com/",
    source: "한국섬유신문",
    patterns: [/ktnews\.com\/news\/articleView\.html/i],
    limit: 16,
  },
];

const directItems = await settledFlat(directSources.map(fetchDirectSource));
const googleItems = (await settledFlat(queries.map(fetchFeed))).map((item) => ({
  ...item,
  sourceType: "google-news",
}));

const issuesPath = path.join(ROOT, "data", "issues.js");
const issuesSource = await fs.readFile(issuesPath, "utf8");
const arrayMatch = issuesSource.match(/window\.FASHION_DAILY_ISSUES\s*=\s*(\[[\s\S]*\]);?\s*$/);
if (!arrayMatch) throw new Error("Could not parse data/issues.js");
const issues = Function(`"use strict"; return (${arrayMatch[1]});`)();

async function collectPreviousArticles() {
  const previousUrls = new Set();
  const previousKeys = new Set();
  const previousTopicKeys = new Set();
  const previousImages = new Set();
  for (const issue of issues.filter((item) => item.date !== date)) {
    if (issue.title) previousKeys.add(articleKey(issue.title));
    if (issue.title) previousTopicKeys.add(topicKey(issue.title));
    for (const headline of issue.headlines || []) {
      previousKeys.add(articleKey(headline));
      previousTopicKeys.add(topicKey(headline));
    }
    if (issue.image) previousImages.add(imageKey(issue.image));
    if (!issue.url) continue;
    try {
      const html = await fs.readFile(path.join(ROOT, issue.url), "utf8");
      for (const match of html.matchAll(/<h2>([\s\S]*?)<\/h2>/gi)) {
        previousKeys.add(articleKey(match[1]));
        previousTopicKeys.add(topicKey(match[1]));
      }
      for (const match of html.matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>/gi)) {
        previousUrls.add(match[1]);
      }
      for (const match of html.matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi)) {
        previousImages.add(imageKey(match[1]));
      }
    } catch {
      // Older archive pages may not exist locally during setup.
    }
  }
  previousKeys.delete("");
  previousTopicKeys.delete("");
  previousImages.delete("");
  return { previousUrls, previousKeys, previousTopicKeys, previousImages };
}

const { previousUrls, previousKeys, previousTopicKeys, previousImages } = await collectPreviousArticles();
const rawItems = [...directItems, ...googleItems];
const cutoff = briefingDate.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
const upperCutoff = briefingDate.getTime() + 24 * 60 * 60 * 1000;
const seen = new Set();

function priorityScore(item) {
  const text = `${item.title || ""} ${item.description || ""}`.toLowerCase();
  let score = item.sourceType === "direct" ? 20 : 0;
  if (item.imageUrl) score += 80;
  const itemDate = articleDateString(item.publishedAt);
  if (itemDate === preferredArticleDate) score += 90;
  else if (itemDate === date) score += 35;
  else if (itemDate) score -= 15;
  for (const keyword of priorityKeywords) {
    if (text.includes(keyword.toLowerCase())) {
      score += keyword.includes("어덜트") ? 60 : 18;
    }
  }
  for (const keyword of similarBrandKeywords) {
    if (text.includes(keyword.toLowerCase())) score += 45;
  }
  for (const keyword of marketTrendKeywords) {
    if (text.includes(keyword.toLowerCase())) score += 35;
  }
  return score;
}

const candidates = rawItems
  .filter((item) => item.title && item.url)
  .map((item) => ({ ...item, title: cleanArticleTitle(item.title) }))
  .filter((item) => !previousUrls.has(item.url) && !previousKeys.has(articleKey(item.title)) && !previousTopicKeys.has(topicKey(item.title)))
  .filter((item) => {
    const key = articleKey(item.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .filter((item) => {
    const timestamp = Date.parse(item.publishedAt);
    return !Number.isFinite(timestamp) || (timestamp >= cutoff && timestamp < upperCutoff);
  })
  .sort((a, b) => priorityScore(b) - priorityScore(a))
  .slice(0, 24);

if (candidates.length < ARTICLE_LIMIT) {
  throw new Error(`Not enough recent articles found: ${candidates.length}`);
}

const articleContext = candidates
  .map(
    (item, index) =>
      `[${index + 1}] 제목: ${item.title}\n출처: ${item.source}\n수집방식: ${item.sourceType || "unknown"}\n대표이미지: ${
        item.imageUrl ? "있음" : "없음"
      }\n발행: ${item.publishedAt}\n요약후보: ${cleanSummaryText(item.description).slice(0, 360)}\n링크: ${item.url}`,
  )
  .join("\n\n");

const prompt = `
오늘 날짜는 ${date}, 한국 시간 기준이다.
아래는 최근 2일 이내 국내 패션 산업 관련 뉴스 후보이다.

${articleContext}

후보 중 중요하고 서로 중복되지 않는 기사 6개를 골라 한국어 아침 브리핑 데이터를 작성하라.
가능하면 수집방식이 direct인 패션 전문 매체 기사를 우선 선택하라.
특히 대표이미지가 있는 direct 기사는 같은 중요도라면 Google News 후보보다 우선하라.
Google News 후보는 direct 후보만으로 중요한 이슈가 부족할 때 보조로만 사용하라.
이 브리핑은 독립문이라는 패션회사와 PAT 브랜드 관점에서 본다.
PAT와 유사한 어덜트 캐주얼, 중장년, 남성복·여성복, 상권, 유통망, 패션 동향 기사는 우선순위를 높게 판단하라.
기사에 없는 사실이나 숫자를 만들지 마라. 제목과 출처 정보만으로 확신할 수 없는 내용은 단정하지 마라.
각 기사에는 본문을 길게 붙이지 말고, 핵심 내용만 3개의 짧은 bullet로 요약하라.
summaryBullets는 각 항목 35자 이상 90자 이하의 한국어 문장으로 작성하라.
HTML 엔티티, &nbsp;, 언론사명 꼬리, 기자명, 출처명은 summaryBullets에 넣지 마라.
반드시 입력 목록의 링크를 그대로 사용하라.

JSON 객체만 출력하라. 마크다운 코드 블록은 쓰지 마라.
형식:
{
  "leadHeadline": "전체 흐름을 설명하는 짧고 강한 헤드라인",
  "leadSummary": "오늘 업계 흐름 2문장",
  "watchPoint": "오늘의 관전 포인트 2문장",
  "tags": ["태그1", "태그2", "태그3", "태그4"],
  "articles": [
    {
      "title": "기사 제목을 간결하게 다듬은 제목",
      "summary": "기사 전체를 한 문장으로 압축한 요약",
      "summaryBullets": ["중요 내용 1", "중요 내용 2", "중요 내용 3"],
      "impact": "업계에 미칠 가능성 또는 의미 1문장. 분석임이 드러나게 표현",
      "source": "입력에 적힌 출처",
      "publishedAt": "YYYY-MM-DD",
      "url": "입력 링크 그대로",
      "category": "브랜드|유통|플랫폼|투자|테크|정책|트렌드 중 하나"
    }
  ]
}
`.trim();

function normalizeArticleDate(value) {
  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(timestamp));
  }
  return date;
}

function inferCategory(item) {
  const text = `${item.title || ""} ${item.description || ""}`.toLowerCase();
  if (/(어덜트|4050|5060|중장년|여성복|남성복|캐주얼)/i.test(text)) return "어덜트";
  if (/(백화점|아울렛|매장|상권|팝업|유통|플랫폼|무신사|판매)/i.test(text)) return "유통";
  if (/(투자|실적|매출|영업이익|인수|상장)/i.test(text)) return "투자";
  if (/(ai|인공지능|테크|기술|ip|데이터)/i.test(text)) return "테크";
  if (/(관세|규제|정부|정책|공급망)/i.test(text)) return "정책";
  return item.sourceType === "direct" ? "브랜드" : "트렌드";
}

function fallbackImpact(item) {
  const text = `${item.title || ""} ${item.description || ""}`.toLowerCase();
  if (/(어덜트|4050|5060|중장년|여성복|남성복|캐주얼)/i.test(text)) {
    return "어덜트 캐주얼 고객층의 취향 변화와 상품 기획 방향을 점검할 수 있는 소식입니다.";
  }
  if (/(백화점|아울렛|매장|상권|팝업|유통|플랫폼|판매)/i.test(text)) {
    return "오프라인 거점과 판매 채널 전략을 다시 살펴볼 만한 유통 관련 흐름입니다.";
  }
  if (/(투자|실적|매출|영업이익|인수|상장)/i.test(text)) {
    return "브랜드의 성장성, 수익성, 투자 우선순위를 판단할 때 참고할 만한 재무·사업 신호입니다.";
  }
  if (/(ai|인공지능|테크|기술|ip|데이터)/i.test(text)) {
    return "패션 비즈니스에서 기술 활용과 콘텐츠 자산화가 어떻게 경쟁력으로 이어지는지 보여주는 사례입니다.";
  }
  if (/(관세|규제|정부|정책|공급망)/i.test(text)) {
    return "원가, 생산, 수입 구조에 영향을 줄 수 있어 공급망 리스크 관점에서 확인이 필요한 이슈입니다.";
  }
  return "브랜드 운영과 상품·유통 전략을 점검할 때 참고할 만한 업계 흐름입니다.";
}

function fallbackBriefing() {
  const picked = candidates
    .filter((item) => item.sourceType === "direct")
    .concat(candidates.filter((item) => item.sourceType !== "direct"))
    .sort((a, b) => priorityScore(b) - priorityScore(a))
    .slice(0, ARTICLE_LIMIT);

  return {
    leadHeadline: "국내 패션 업계 주요 뉴스 업데이트",
    leadSummary:
      "패션 전문 매체와 주요 뉴스 후보를 바탕으로 오늘 확인할 만한 업계 소식을 모았습니다.",
    watchPoint:
      "오늘 브리핑은 국내 패션 전문 매체에서 확인한 주요 기사 흐름을 중심으로 구성했습니다. 세부 내용은 원문 기사에서 함께 확인해 주세요.",
    tags: ["패션업계", "브랜드", "유통", "트렌드"],
    articles: picked.map((item) => ({
      title: cleanArticleTitle(item.title),
      summary: fallbackSummaryBullets(item)[0],
      summaryBullets: fallbackSummaryBullets(item),
      impact: fallbackImpact(item),
      source: item.source || "출처 확인 필요",
      publishedAt: normalizeArticleDate(item.publishedAt),
      url: item.url,
      category: inferCategory(item),
    })),
  };
}

let briefing;
try {
const modelResponse = await fetchWithRetry("https://models.github.ai/inference/chat/completions", {
  method: "POST",
  headers: {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": API_VERSION,
  },
  body: JSON.stringify({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "당신은 국내 패션 비즈니스 전문 에디터다. 제공된 뉴스 후보만 사용하며 사실과 분석을 엄격히 구분한다.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 3000,
  }),
}, 5);

if (!modelResponse.ok) {
  throw new Error(`GitHub Models request failed: ${modelResponse.status} ${await modelResponse.text()}`);
}

const modelJson = await modelResponse.json();
const generated = JSON.parse(modelJson.choices?.[0]?.message?.content || "{}");
if (!Array.isArray(generated.articles) || generated.articles.length < 3) {
  throw new Error("Model response did not contain enough articles.");
}
briefing = generated;
} catch (error) {
  console.warn(`AI briefing generation failed; using fallback briefing. ${error.message}`);
  briefing = fallbackBriefing();
}

function sameArticle(candidate, article) {
  const candidateTitle = cleanArticleTitle(candidate.title || "");
  const articleTitle = cleanArticleTitle(article.title || "");
  return (
    candidate.url === article.url ||
    candidateTitle === articleTitle ||
    (candidateTitle && articleTitle && candidateTitle.includes(articleTitle)) ||
    (candidateTitle && articleTitle && articleTitle.includes(candidateTitle))
  );
}

function toBriefingArticle(item) {
  const summaryBullets = fallbackSummaryBullets(item);
  return {
    title: cleanArticleTitle(item.title),
    summary: summaryBullets[0],
    summaryBullets,
    impact: fallbackImpact(item),
    source: item.source || "출처 확인 필요",
    publishedAt: normalizeArticleDate(item.publishedAt),
    url: item.url,
    category: inferCategory(item),
  };
}

function isAdultItem(item) {
  return /(어덜트|adult|4050|5060|중장년)/i.test(`${item.title || ""} ${item.description || ""}`);
}

function normalizeBriefingArticles(articles) {
  const normalized = articles.map((article) => {
    const candidate = candidates.find((item) => sameArticle(item, article));
    const base = candidate || article;
    const cleanTitle = bestTitle(article.title, candidate?.title);
    const genericImpact =
      !article.impact ||
      article.impact.length < 18 ||
      /관련 브랜드와 유통 전략|확인할 수 있는 소식/.test(article.impact);

    return {
      ...article,
      title: cleanTitle || cleanArticleTitle(article.title),
      summary: cleanSummaryText(article.summary || candidate?.description || cleanTitle),
      summaryBullets: Array.isArray(article.summaryBullets) && article.summaryBullets.length >= 3
        ? article.summaryBullets.map(cleanSummaryText).filter(Boolean).slice(0, 3)
        : fallbackSummaryBullets({ ...base, summary: article.summary }),
      impact: genericImpact ? fallbackImpact(base) : article.impact,
      category: article.category || inferCategory(base),
      source: article.source || candidate?.source || "출처 확인 필요",
      publishedAt: article.publishedAt || normalizeArticleDate(candidate?.publishedAt),
      url: article.url || candidate?.url,
    };
  });

  const adultCandidate = candidates.find(isAdultItem);
  const alreadyIncluded = adultCandidate && normalized.some((article) => sameArticle(adultCandidate, article));
  if (adultCandidate && !alreadyIncluded) {
    normalized.unshift(toBriefingArticle(adultCandidate));
  }

  const selected = [];
  const selectedUrls = new Set();
  const selectedKeys = new Set();
  const selectedTopicKeys = new Set();

  function addArticle(article) {
    const key = articleKey(article.title);
    const topic = topicKey(article.title);
    if (!article.title || !article.url || !key) return;
    if (selectedUrls.has(article.url) || selectedKeys.has(key)) return;
    if (topic && selectedTopicKeys.has(topic)) return;
    selected.push(article);
    selectedUrls.add(article.url);
    selectedKeys.add(key);
    if (topic) selectedTopicKeys.add(topic);
  }

  normalized.forEach(addArticle);
  candidates
    .sort((a, b) => priorityScore(b) - priorityScore(a))
    .forEach((item) => {
      if (selected.length < ARTICLE_LIMIT) addArticle(toBriefingArticle(item));
    });

  return selected.slice(0, ARTICLE_LIMIT);
}

async function chooseArticleImage(article, usedImages) {
  const accept = (image) => {
    if (!isUsableArticleImage(image)) return "";
    const key = imageKey(image);
    if (!key || previousImages.has(key) || usedImages.has(key)) return "";
    usedImages.add(key);
    return image;
  };
  const candidate = candidates.find((item) => sameArticle(item, article));
  const candidateImage = accept(candidate?.imageUrl);
  if (candidateImage) return candidateImage;

  const pageImage = await fetchPageImage(article.url);
  const fetchedImage = accept(pageImage);
  if (fetchedImage) return fetchedImage;

  return "";
}

function imageForIssue(image) {
  return image;
}

async function fetchWeeklySignals() {
  const signals = {
    updatedAt,
    weather: "서울 주간 날씨 정보를 확인하지 못했습니다.",
    exchange: "USD/KRW 환율 정보를 확인하지 못했습니다.",
    forecast: [],
  };

  try {
    const weatherUrl =
      "https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=7&timezone=Asia%2FSeoul";
    const response = await fetchWithRetry(weatherUrl, {}, 2);
    if (response.ok) {
      const json = await response.json();
      const times = json.daily?.time || [];
      const codes = json.daily?.weather_code || [];
      const max = json.daily?.temperature_2m_max || [];
      const min = json.daily?.temperature_2m_min || [];
      const rain = json.daily?.precipitation_probability_max || [];
      if (max.length && min.length) {
        const avgMax = Math.round(max.reduce((sum, value) => sum + value, 0) / max.length);
        const avgMin = Math.round(min.reduce((sum, value) => sum + value, 0) / min.length);
        const maxRain = Math.max(...rain.filter((value) => Number.isFinite(value)), 0);
        signals.weather = `서울 ${avgMin}~${avgMax}℃ 흐름, 주간 최대 강수확률 ${maxRain}%`;
        const dayFormatter = new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          weekday: "short",
        });
        const iconFor = (code, rainChance) => {
          if ([61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return "🌧️";
          if ([51, 53, 55, 56, 57].includes(code) || rainChance >= 35) return "🌦️";
          if ([45, 48, 71, 73, 75, 77, 85, 86].includes(code)) return "☁️";
          if ([1, 2].includes(code)) return "🌤️";
          if (code === 3) return "☁️";
          return "☀️";
        };
        signals.forecast = times.slice(0, 7).map((time, index) => ({
          date: time,
          day: dayFormatter.format(new Date(`${time}T09:00:00+09:00`)),
          icon: iconFor(codes[index], rain[index] || 0),
          max: Math.round(max[index]),
          min: Math.round(min[index]),
          rain: Number.isFinite(rain[index]) ? rain[index] : 0,
        }));
      }
    }
  } catch {
    // Keep fallback text.
  }

  try {
    const previous = new Date(`${date}T00:00:00+09:00`);
    previous.setDate(previous.getDate() - 7);
    const previousDate = kstDateString(previous);
    const [latestResponse, previousResponse] = await Promise.all([
      fetchWithRetry("https://api.frankfurter.app/latest?from=USD&to=KRW", {}, 2),
      fetchWithRetry(`https://api.frankfurter.app/${previousDate}?from=USD&to=KRW`, {}, 2),
    ]);
    if (latestResponse.ok && previousResponse.ok) {
      const latest = await latestResponse.json();
      const before = await previousResponse.json();
      const latestRate = latest.rates?.KRW;
      const beforeRate = before.rates?.KRW;
      if (Number.isFinite(latestRate) && Number.isFinite(beforeRate)) {
        const diff = latestRate - beforeRate;
        const direction = diff > 0 ? "상승" : diff < 0 ? "하락" : "보합";
        signals.exchange = `USD/KRW ${Math.round(latestRate).toLocaleString("ko-KR")}원, 1주 전 대비 ${Math.abs(diff).toFixed(1)}원 ${direction}`;
      }
    }
  } catch {
    // Keep fallback text.
  }

  return signals;
}

const weeklySignals = await fetchWeeklySignals();

briefing.articles = normalizeBriefingArticles(briefing.articles || []);

const usedImages = new Set();
const enrichedDraft = [];
for (const article of briefing.articles.slice(0, ARTICLE_LIMIT)) {
  enrichedDraft.push({
    ...article,
    image: await chooseArticleImage(article, usedImages),
  });
}

const enrichedArticles = enrichedDraft.sort((a, b) => {
  const imageDelta = Number(isUsableArticleImage(b.image)) - Number(isUsableArticleImage(a.image));
  if (imageDelta) return imageDelta;
  const candidateA = candidates.find((item) => sameArticle(item, a)) || a;
  const candidateB = candidates.find((item) => sameArticle(item, b)) || b;
  return priorityScore(candidateB) - priorityScore(candidateA);
});

const issueCoverImage = enrichedArticles.find((article) => isUsableArticleImage(article.image))?.image || "";
const issueHeadlines = enrichedArticles
  .map((article) => cleanArticleTitle(article.title))
  .filter(Boolean)
  .slice(0, ARTICLE_LIMIT);

const articleCards = enrichedArticles
  .map((article) => {
    const summaryBullets = (Array.isArray(article.summaryBullets) && article.summaryBullets.length
      ? article.summaryBullets
      : fallbackSummaryBullets(article)
    ).slice(0, 3);
    return `
      <article>
        <div class="meta">${escapeHtml(article.category)} · ${escapeHtml(article.publishedAt)}</div>
        ${
          article.image
            ? `<img class="article-image" src="${escapeHtml(imageForIssue(article.image))}" alt="" referrerpolicy="no-referrer" loading="lazy">`
            : ""
        }
        <h2>${escapeHtml(article.title)}</h2>
        <div class="summary-block">
          <strong>핵심 요약</strong>
          <ul>
            ${summaryBullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
          </ul>
        </div>
        <p class="impact"><strong>업계 영향</strong> ${escapeHtml(article.impact)}</p>
        <a class="article-link" href="${escapeHtml(article.url)}" target="_blank" rel="noopener">원문 기사 보기 →</a>
        <span class="source">${escapeHtml(article.source)}</span>
      </article>`;
  })
  .join("");

const issueHtml = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FASHION DAILY | ${date}</title>
  <style>
    :root{--ink:#101114;--blue:#3157ff;--muted:#737780;--line:#e5e7eb;--soft:#f3f4f6}
    *{box-sizing:border-box}body{margin:0;background:#eef0f2;color:var(--ink);font-family:Arial,"Noto Sans KR",sans-serif}
    a{color:inherit;text-decoration:none}.page{width:min(1220px,calc(100% - 36px));margin:20px auto;padding:26px 30px 40px;background:#fff;border-radius:24px}
    nav{display:flex;justify-content:space-between;align-items:center;padding-bottom:22px;border-bottom:1px solid var(--line);font-size:11px;color:var(--muted)}
    nav a{font-size:17px;font-weight:900;color:var(--ink)}nav a span{color:var(--blue)}
    .hero{position:relative;margin:22px 0;border-radius:20px;overflow:hidden;background:#101114;color:#fff}
    .hero.has-image{height:min(58vw,640px);min-height:380px}
    .hero img{width:100%;height:100%;object-fit:cover;filter:saturate(.86)}.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 38%,rgba(0,0,0,.72))}
    .hero-copy{padding:40px}.hero.has-image .hero-copy{position:absolute;z-index:1;left:34px;right:34px;bottom:32px;padding:0;color:#fff}.kicker{font-size:10px;font-weight:800;letter-spacing:.12em;color:#aebcff}
    h1{max-width:900px;margin:12px 0 14px;font-size:clamp(40px,6.6vw,78px);line-height:.98;letter-spacing:-.06em}.hero p{max-width:760px;margin:0;color:#d9dbe0;line-height:1.7}
    .ai-label{position:absolute;z-index:2;top:15px;right:15px;padding:7px 10px;border-radius:999px;background:rgba(0,0,0,.52);color:#fff;font-size:8px}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}article{display:flex;flex-direction:column;padding:21px;border:1px solid var(--line);border-radius:18px}
    .meta{color:var(--blue);font-size:9px;font-weight:800;letter-spacing:.1em}.article-image{width:100%;height:180px;margin:14px 0;border-radius:12px;object-fit:cover}
    h2{margin:0 0 12px;font-size:23px;line-height:1.28;letter-spacing:-.035em}article p{margin:0 0 13px;color:#52565f;font-size:14px;line-height:1.7}.summary-block{margin:0 0 14px}.summary-block strong{display:block;margin-bottom:8px;color:#20232a;font-size:12px}.summary-block ul{display:grid;gap:7px;margin:0;padding:0;list-style:none}.summary-block li{position:relative;padding-left:14px;color:#52565f;font-size:14px;line-height:1.55}.summary-block li:before{content:"";position:absolute;left:0;top:.65em;width:5px;height:5px;border-radius:50%;background:var(--blue)}
    .impact{margin-top:auto;padding:13px;border-radius:11px;background:var(--soft);color:#34373e}.article-link{display:flex;align-items:center;justify-content:center;margin-top:16px;min-height:46px;border-radius:999px;background:var(--blue);color:#fff;font-size:14px;font-weight:900}.source{margin-top:10px;color:var(--muted);font-size:9px}
    .watch{margin-top:16px;padding:26px;border-radius:18px;background:var(--blue);color:#fff}.watch h3{margin:0 0 8px;font-size:20px}.watch p{margin:0;line-height:1.7}
    footer{margin-top:30px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:9px}
    @media(max-width:760px){body{background:#fff}.page{width:100%;margin:0;padding:18px 15px 28px;border-radius:0}.hero.has-image{height:68vh}.hero.has-image .hero-copy{left:22px;right:22px;bottom:24px}.hero-copy{padding:28px}.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main class="page">
    <nav><a href="../index.html">DLM FASHION <span>DAILY</span></a><span>${displayDate} · ${day}</span></nav>
    <section class="hero${issueCoverImage ? " has-image" : ""}">
      ${issueCoverImage ? `<img src="${escapeHtml(imageForIssue(issueCoverImage))}" alt="" referrerpolicy="no-referrer">` : ""}
      <div class="hero-copy">
        <div class="kicker">KOREA FASHION INDUSTRY BRIEFING</div>
        <h1>${escapeHtml(briefing.leadHeadline)}</h1>
        <p>${escapeHtml(briefing.leadSummary)}</p>
      </div>
    </section>
    <section class="grid">${articleCards}</section>
    <section class="watch"><h3>오늘의 관전 포인트</h3><p>${escapeHtml(briefing.watchPoint)}</p></section>
    <footer>최근 공개된 뉴스 제목과 출처를 바탕으로 AI가 선별·요약했습니다. 중요한 의사결정 전에는 원문을 확인하세요.</footer>
  </main>
</body>
</html>`;

await fs.mkdir(path.join(ROOT, "issues"), { recursive: true });
await fs.writeFile(path.join(ROOT, "issues", `${date}.html`), issueHtml, "utf8");

const issue = {
  date,
  displayDate,
  day,
  updatedAt,
  updatedAtText,
  title: briefing.leadHeadline,
  summary: briefing.leadSummary,
  headlines: issueHeadlines,
  image: issueCoverImage,
  url: `issues/${date}.html`,
  tags: (briefing.tags || []).slice(0, 3),
};
const nextIssues = [issue, ...issues.filter((item) => item.date !== date)].sort((a, b) =>
  b.date.localeCompare(a.date),
);
await fs.writeFile(
  issuesPath,
  `window.FASHION_DAILY_ISSUES = ${JSON.stringify(nextIssues, null, 2)};\n`,
  "utf8",
);

await fs.writeFile(
  path.join(ROOT, "data", "signals.js"),
  `window.DLM_FASHION_SIGNALS = ${JSON.stringify(weeklySignals, null, 2)};\n`,
  "utf8",
);

console.log(`Updated Fashion Daily for ${date} with ${briefing.articles.length} articles.`);
