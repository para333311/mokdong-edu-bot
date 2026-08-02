/**
 * 목동 교육·입시 텔레그램 봇
 *
 * 대상: 초5 + 중2(2030 대입, 고교학점제·내신5등급제 첫 세대) 두 아들
 * 목적: 교육 정책 / 입시 / 특목·자사고 / 목동 학원가 트렌드를
 *       하루 2회 정제된 브리핑으로 텔레그램 채널(가족 공유)에 전송
 *
 * - 매일 오전·오후 6시 브리핑 (21:00/09:00 UTC = 06:00/18:00 KST)
 * - 일요일 저녁 주간 체크리스트 (cron 11:00 UTC 일 = 20:00 KST)
 * - 7일 중복 방지 (D1)
 * - 채널에 봇을 관리자로 추가하고 아무 글이나 올리면 자동 등록
 */

const DEDUP_DAYS = 7;
const MAX_PER_SECTION = 3;

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

// ---------------------------------------------------------------------------
// 소스 정의
// ---------------------------------------------------------------------------

/** 구글뉴스 RSS 검색 쿼리 (섹션별) */
/** 지방 지역명 (설명회 등 서울·수도권 외 기사 제외용) */
const NON_SEOUL = [
  "춘천", "강원", "부산", "대구", "광주", "대전", "울산", "세종",
  "제주", "전북", "전남", "경북", "경남", "충북", "충남", "강릉",
  "원주", "청주", "천안", "전주", "포항", "창원", "진주", "순천",
  "여수", "목포", "군산", "익산", "경주", "구미", "김해", "양산",
  "안동", "상주", "문경", "제천", "충주", "당진", "서산", "아산",
  "논산", "계룡", "공주", "보령", "하동", "사천", "통영", "거제",
  "밀양", "인천 연수", "연수구", "양평", "가평", "연천", "포천", "여주", "이천", "안성",
  // 지방 광역시 구 이름 (서울에는 없는 구)
  "남구", "북구", "동구", "서구", "수성구", "달서구", "해운대", "사하구", "금정구",
];

const NEWS_SECTIONS = [
  {
    key: "policy",
    label: "🏛 교육 정책·대입 제도",
    query:
      '"고교학점제" OR "2028 대입" OR "내신 5등급" OR "수능 개편" OR "2028학년도 수능"',
    bing: ["고교학점제", "2028 대입", "내신 5등급"],
    exclude: NON_SEOUL, // 지방 교육청 행사성 기사 제외
  },
  {
    key: "highschool",
    label: "🏫 고입·특목·자사고",
    query: '"자사고" OR "특목고" OR "외고" OR "과학고" OR "고입"',
    bing: ["자사고", "특목고", "외고", "과학고 입시", "고입"],
    bingMust: ["자사고", "특목고", "외고", "과학고", "고입", "영재고", "국제고"],
    exclude: NON_SEOUL, // 지방 학교 소식 제외
  },
  {
    key: "mokdong",
    label: "📍 목동·양천 교육",
    query: "목동 (학원 OR 입시 OR 학군 OR 교육입시)",
    window: "14d", // 목동 기사는 드물어서 기간을 넓게
    bing: ["양천구 교육", "목동 학원", "목동 입시", "목동 학군"],
    bingMust: ["목동", "양천"],
    exclude: ["분양", "재건축", "아파트", "오피스텔", "부동산", "청약", "매매", "재건", "단지", "시공", "수주", "주민자치", "취업교육", "어르신", "일자리"],
  },
  {
    key: "seminar",
    label: "🎤 설명회·입시 행사",
    query: '"입시 설명회" OR "입학 설명회" OR "학부모 설명회"',
    bing: ["입시 설명회", "입학 설명회"],
    bingMust: ["설명회"],
    // 지방 설명회 + 아이들과 무관한 로스쿨·대학원·유학 설명회 제외
    exclude: [...NON_SEOUL, "로스쿨", "대학원", "편입", "유학", "뉴욕주립"],
  },
];

/** 유튜브 교육 채널 (RSS) */
const YT_CHANNELS = [
  { id: "UCy1x3GhPFHtno57QTFmZPhQ", name: "교육대기자TV" },
  { id: "UCPvwqht-XvcbbaUavs53ejg", name: "입시덕후" },
  { id: "UC4NoD4RTKUlt7op2CXpYTsw", name: "입시탐탐" },
];

/** 베리타스알파 기사 필터 키워드 */
const VERITAS_KEYWORDS = [
  "고입", "특목", "자사고", "외고", "과학고", "영재", "국제고",
  "고교학점제", "내신", "수능", "대입", "2028", "중학", "설명회",
  "목동",
];
/** 대학 홍보성 기사 제외 (베리타스는 대학 보도자료가 많음) */
const VERITAS_EXCLUDE = ["대학원", "교수", "협약", "취업", "산학", "전문대"];

// ---------------------------------------------------------------------------
// 수집기
// ---------------------------------------------------------------------------

function decodeEnt(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}

/** RSS <item>에서 {title, link} 추출 */
function parseRss(xml, max = 15) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const t = block.match(/<title>([\s\S]*?)<\/title>/);
    const l = block.match(/<link>([\s\S]*?)<\/link>/);
    if (t) items.push({ title: decodeEnt(t[1]), link: l ? decodeEnt(l[1]) : "" });
    if (items.length >= max) break;
  }
  return items;
}

async function fetchGoogleNews(query, window = "2d") {
  const url =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query + ` when:${window}`) +
    "&hl=ko&gl=KR&ceid=KR:ko";
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseRss(await r.text());
}

/** Bing 뉴스 리다이렉트 링크에서 원본 기사 URL 추출 */
function cleanBingLink(link) {
  const m = link.match(/[?&]url=([^&]+)/);
  if (!m) return link;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return link;
  }
}

/**
 * 구글뉴스가 CF Workers IP를 차단(503)할 때 쓰는 백업: Bing 뉴스 RSS
 * 키워드별로 따자온표 검색 후 병합 (Bing은 OR 복합쿼리 정확도가 낮음)
 */
async function fetchBingNews(sec) {
  // Bing 기간 필터: 7=24시간, 8=1주, 9=1개월
  const interval = parseInt(sec.window || "2") >= 8 ? "9" : "8";
  const merged = [];
  const seen = new Set();
  for (const kw of sec.bing || []) {
    try {
      // 단일 단어는 따옴표(정확도↑), 복합 키워드는 그대로(결과수↑)
      const q = kw.includes(" ") ? kw : `"${kw}"`;
      const url =
        "https://www.bing.com/news/search?q=" +
        encodeURIComponent(q) +
        `&format=RSS&mkt=ko-KR&qft=interval%3d%22${interval}%22`;
      const r = await fetch(url, { headers: UA });
      if (!r.ok) continue;
      for (const it of parseRss(await r.text(), 10)) {
        const k = it.title.replace(/\s+/g, "").slice(0, 60);
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push({ ...it, link: cleanBingLink(it.link) });
      }
    } catch {}
  }
  if (!merged.length) throw new Error("bing 0건");
  // 섭션별 필수 키워드 필터 (Bing은 관련 없는 기사가 섞임)
  if (sec.bingMust)
    return merged.filter((it) => sec.bingMust.some((k) => it.title.includes(k)));
  return merged;
}

/** 구글뉴스 → 실패 시 Bing 뉴스 순서로 시도 */
async function fetchNews(sec) {
  try {
    return await fetchGoogleNews(sec.query, sec.window);
  } catch {
    return await fetchBingNews(sec);
  }
}

async function fetchVeritas() {
  const r = await fetch("http://www.veritas-a.com/rss/allArticle.xml", {
    headers: UA,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const items = parseRss(await r.text(), 30);
  return items.filter(
    (it) =>
      VERITAS_KEYWORDS.some((kw) => it.title.includes(kw)) &&
      !VERITAS_EXCLUDE.some((kw) => it.title.includes(kw))
  );
}

async function fetchYouTube(channel) {
  const r = await fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`,
    { headers: UA }
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text();
  const items = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = m[1];
    const t = block.match(/<title>([\s\S]*?)<\/title>/);
    const l = block.match(/<link rel="alternate" href="([^"]+)"/);
    if (t)
      items.push({
        title: `[${channel.name}] ${decodeEnt(t[1])}`,
        link: l ? l[1] : "",
      });
    if (items.length >= 5) break;
  }
  return items.filter((it) => !it.title.includes("#Shorts"));
}

/** 모든 소스 수집 → { sectionKey: {label, items} } */
export async function collect() {
  const out = {};
  const status = {};

  await Promise.all([
    ...NEWS_SECTIONS.map(async (sec) => {
      try {
        let items = await fetchNews(sec);
        if (sec.exclude)
          items = items.filter(
            (it) => !sec.exclude.some((x) => it.title.includes(x))
          );
        out[sec.key] = { label: sec.label, items };
        status[sec.label] = `✅ ${out[sec.key].items.length}건`;
      } catch (e) {
        status[sec.label] = `❌ ${e.message}`.slice(0, 50);
      }
    }),
    (async () => {
      try {
        const items = await fetchVeritas();
        out.veritas = { label: "📰 베리타스알파(입시전문지)", items };
        status["베리타스알파"] = `✅ ${items.length}건`;
      } catch (e) {
        status["베리타스알파"] = `❌ ${e.message}`.slice(0, 50);
      }
    })(),
    (async () => {
      const items = [];
      for (const ch of YT_CHANNELS) {
        try {
          items.push(...(await fetchYouTube(ch)));
        } catch {}
      }
      out.youtube = { label: "📺 교육 유튜브 새 영상", items };
      status["유튜브"] = `✅ ${items.length}건`;
    })(),
  ]);

  return { sections: out, status };
}

// ---------------------------------------------------------------------------
// D1 상태 (중복 방지 + 채팅 등록)
// ---------------------------------------------------------------------------

export async function ensureSchema(db) {
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS seen (k TEXT PRIMARY KEY, ts INTEGER)"
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS chats (chat_id TEXT PRIMARY KEY, kind TEXT)"
    ),
  ]);
}

function normTitle(t) {
  return t.replace(/\s+/g, "").toLowerCase().slice(0, 80);
}

/** 7일 내 이미 보낸 항목 제외 (D1 쿼리 수 최소화 — 서브리퀘스트 한도 대응) */
async function filterNewItems(db, sections) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - DEDUP_DAYS * 86400;
  await db.prepare("DELETE FROM seen WHERE ts < ?").bind(cutoff).run();

  // 1) 모든 후보 키 수집
  const allKeys = [];
  for (const sec of Object.values(sections))
    for (const it of sec.items) {
      const k = normTitle(it.title);
      if (k) allKeys.push(k);
    }
  if (!allKeys.length) return {};

  // 2) 한 번의 SELECT로 이미 본 키 조회 (100개씩 청크)
  const seen = new Set();
  for (let i = 0; i < allKeys.length; i += 100) {
    const chunk = allKeys.slice(i, i + 100);
    const ph = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT k FROM seen WHERE k IN (${ph})`)
      .bind(...chunk)
      .all();
    for (const r of results) seen.add(r.k);
  }

  // 3) 새 항목 선별 + 배치 INSERT
  const fresh = {};
  const inserts = [];
  const picked = new Set();
  for (const [key, sec] of Object.entries(sections)) {
    const list = [];
    for (const it of sec.items) {
      const k = normTitle(it.title);
      if (!k || seen.has(k) || picked.has(k)) continue;
      picked.add(k);
      list.push(it);
      inserts.push(db.prepare("INSERT OR IGNORE INTO seen (k, ts) VALUES (?, ?)").bind(k, now));
      if (list.length >= MAX_PER_SECTION) break;
    }
    if (list.length) fresh[key] = { label: sec.label, items: list };
  }
  if (inserts.length) await db.batch(inserts);
  return fresh;
}

// ---------------------------------------------------------------------------
// 메시지 포맷
// ---------------------------------------------------------------------------

function kstDate() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${days[d.getUTCDay()]})`;
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function trimTitle(title) {
  let t = title.replace(/\s+-\s+[^-]+$/, "").trim(); // 말미 언론사명 제거
  if (t.length > 60) t = t.slice(0, 58) + "…";
  return t;
}

const NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

/** 섭션 하나 = 카드 하나 (HTML) — 항목 사이 빈 줄로 가독성 확보 */
export function formatSection(sec) {
  const lines = [`<b>${escHtml(sec.label)}</b>`];
  sec.items.forEach((it, i) => {
    const t = trimTitle(it.title);
    lines.push(
      "",
      it.link
        ? `${NUM_EMOJI[i] || "▪️"} <a href="${escHtml(it.link)}">${escHtml(t)}</a>`
        : `${NUM_EMOJI[i] || "▪️"} ${escHtml(t)}`
    );
  });
  return lines.join("\n");
}

/** 기사 페이지에서 대표 이미지(og:image) 추출 */
async function fetchOgImage(url) {
  try {
    if (!url || url.includes("news.google.com")) return null; // 구글 리다이렉트는 이미지 추출 불가
    const r = await fetch(url, { headers: UA, redirect: "follow" });
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 150000);
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (!m) return null;
    const img = decodeEnt(m[1]);
    return img.startsWith("http") ? img : null;
  } catch {
    return null;
  }
}

/** 섭션별 카드 목록 생성: [{label, html, photo}] (photo는 대표 이미지 URL 또는 null) */
export async function buildBriefCards(fresh) {
  const order = ["policy", "highschool", "mokdong", "seminar", "veritas", "youtube"];
  const cards = [];
  for (const key of order) {
    const sec = fresh[key];
    if (!sec || !sec.items.length) continue;
    let photo = null;
    if (key === "youtube") {
      // 유튜브는 썸네일 URL을 바로 만들 수 있음
      const vm = sec.items[0]?.link?.match(/[?&]v=([\w-]{11})/);
      if (vm) photo = `https://i.ytimg.com/vi/${vm[1]}/hqdefault.jpg`;
    } else {
      // 앞의 두 기사에서만 이미지 시도 (서브리퀘스트 절약)
      for (const it of sec.items.slice(0, 2)) {
        photo = await fetchOgImage(it.link);
        if (photo) break;
      }
    }
    cards.push({ label: sec.label, html: formatSection(sec), photo, firstLink: sec.items[0]?.link || "" });
  }
  return cards;
}

export function formatWeekly() {
  return [
    `📅 주간 교육 체크리스트 — ${kstDate()}`,
    "",
    "이번 주 직접 확인하면 좋은 것들:",
    "",
    "☑️ 엠스쿨(목동 학부모 카페) 주간 인기글 훑어보기",
    "   cafe.naver.com/m2school",
    "☑️ 양천맘 카페 학원/학교 게시판 확인",
    "☑️ 종로학원 설명회 일정 확인",
    "   b.jongro.co.kr/bbs/mlist.asp",
    "☑️ 메가스터디/대성 온라인 설명회 신규 오픈 확인",
    "☑️ 대형학원(시대인재·강남대성 등) 설명회 게시판 모니터링",
    "",
    "👦 중2(첫째): 고입 방향 자료 축적 — 특목·자사 vs 일반고",
    "   (내신 5등급제에서 유불리가 과거와 다름, 설명회에서 꼭 질문)",
    "👦 초5(둘째): 중등 대비 로드맵 — 수학 선행 속도·영어 완성 시기",
    "",
    "🎤 참석할 만한 오프라인 설명회 발견하면 캘린더에 바로 등록!",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 텔레그램
// ---------------------------------------------------------------------------

async function tg(env, method, body) {
  const r = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return r.json();
}

export async function sendTelegram(env, chatId, text, html = false) {
  // 라인 단위로 쪼개서 4096자 제한 준수 (HTML 태그가 중간에 잘리지 않도록)
  const chunks = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > 4000) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? cur + "\n" + line : line;
    }
  }
  if (cur) chunks.push(cur);
  for (const chunk of chunks) {
    const body = {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    };
    if (html) body.parse_mode = "HTML";
    const res = await tg(env, "sendMessage", body);
    // HTML 파싱 오류 시 일반 텍스트로 재시도
    if (html && !res.ok) {
      delete body.parse_mode;
      body.text = chunk.replace(/<[^>]+>/g, "");
      await tg(env, "sendMessage", body);
    }
  }
}

async function broadcast(env, db, text, html = false) {
  const chats = (await db.prepare("SELECT chat_id FROM chats").all()).results;
  for (const c of chats) await sendTelegram(env, c.chat_id, text, html);
  return chats.length;
}

/** 카드 하나 전송: 이미지 있으면 사진+카드, 없으면 링크 미리보기 카드 */
async function sendCard(env, chatId, card) {
  if (card.photo) {
    const res = await tg(env, "sendPhoto", {
      chat_id: chatId,
      photo: card.photo,
      caption: card.html,
      parse_mode: "HTML",
    });
    if (res.ok) return;
    // 이미지 전송 실패 시 텍스트 카드로 폴백
  }
  const body = {
    chat_id: chatId,
    text: card.html,
    parse_mode: "HTML",
  };
  if (card.firstLink) {
    body.link_preview_options = {
      url: card.firstLink,
      prefer_large_media: true,
      show_above_text: true,
    };
  } else {
    body.disable_web_page_preview = true;
  }
  const res = await tg(env, "sendMessage", body);
  if (!res.ok) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: card.html.replace(/<[^>]+>/g, ""),
      disable_web_page_preview: true,
    });
  }
}

/** 브리핑 전체(헤더 + 섭션 카드들)를 한 채팅에 전송 */
async function sendBriefTo(env, chatId, cards) {
  await sendTelegram(
    env,
    chatId,
    `🎓 <b>목동 교육·입시 브리핑</b> — ${kstDate()}`,
    true
  );
  for (const card of cards) await sendCard(env, chatId, card);
}

// ---------------------------------------------------------------------------
// 진입점: cron / 웹훅
// ---------------------------------------------------------------------------

/** 매일 오전·오후 브리핑 */
export async function dailyBrief(env, db) {
  await ensureSchema(db);
  const { sections } = await collect();
  const fresh = await filterNewItems(db, sections);
  const cards = await buildBriefCards(fresh);
  if (!cards.length) return;
  const chats = (await db.prepare("SELECT chat_id FROM chats").all()).results;
  for (const c of chats) await sendBriefTo(env, c.chat_id, cards);
}

/** 일요일 저녁 주간 체크리스트 */
export async function weeklyBrief(env, db) {
  await ensureSchema(db);
  await broadcast(env, db, formatWeekly());
}

/** 텔레그램 웹훅 업데이트 처리 */
export async function handleUpdate(env, db, update) {
  await ensureSchema(db);

  // 개인 메시지와 채널 게시물 모두 같은 명령 처리 경로를 사용한다.
  const isChannel = Boolean(update.channel_post);
  const msg = update.channel_post || update.message;
  const text = msg?.text;
  const chatId = msg?.chat?.id;
  if (!chatId) return;

  // 채널에 글이 올라오면 채널 자동 등록 (봇이 관리자일 때 수신됨)
  if (isChannel) {
    const { meta } = await db
      .prepare("INSERT OR IGNORE INTO chats (chat_id, kind) VALUES (?, 'channel')")
      .bind(String(chatId))
      .run();
    if (meta.changes > 0) {
      await sendTelegram(
        env,
        chatId,
        "✅ 이 채널이 등록되었습니다!\n매일 오전 6시와 오후 6시 교육·입시 브리핑이 여기로 옵니다.\n(일요일 저녁엔 주간 체크리스트)"
      );
    }
  }

  // 일반 채널 게시물은 등록만 하고, 명령 게시물은 아래에서 계속 처리한다.
  if (!text || (isChannel && !text.startsWith("/"))) return;

  if (text.startsWith("/start")) {
    if (!isChannel) {
      await db
        .prepare("INSERT OR IGNORE INTO chats (chat_id, kind) VALUES (?, 'private')")
        .bind(String(chatId))
        .run();
    }
    await sendTelegram(
      env,
      chatId,
      "🎓 목동 교육·입시 트렌드 봇 등록 완료!\n\n" +
        "매일 오전 6시·오후 6시 — 정책·고입·목동·설명회·유튜브 브리핑\n" +
        "일요일 저녁 8시 — 주간 체크리스트\n\n" +
        "명령어:\n/brief 지금 바로 브리핑\n/status 수집 상태\n/stop 알림 중지\n\n" +
        "👨‍👩‍👦 가족 공유: 텔레그램 채널을 만들고 이 봇을 관리자로 추가한 뒤\n" +
        "채널에 아무 글이나 하나 올리면 자동 등록됩니다."
    );
  } else if (text.startsWith("/stop")) {
    await db.prepare("DELETE FROM chats WHERE chat_id = ?").bind(String(chatId)).run();
    await sendTelegram(env, chatId, "🛑 알림 중지. 다시 받으려면 /start");
  } else if (text.startsWith("/brief")) {
    const { sections } = await collect();
    const fresh = await filterNewItems(db, sections);
    const cards = await buildBriefCards(fresh);
    if (cards.length) await sendBriefTo(env, chatId, cards);
    else await sendTelegram(env, chatId, "😴 지난 브리핑 이후 새 소식이 없습니다.");
  } else if (text.startsWith("/status")) {
    const { status } = await collect();
    const lines = ["🔧 수집 소스 상태"];
    for (const [k, v] of Object.entries(status)) lines.push(`${k}: ${v}`);
    await sendTelegram(env, chatId, lines.join("\n"));
  } else {
    await sendTelegram(env, chatId, "명령어: /start /brief /status /stop");
  }
}
