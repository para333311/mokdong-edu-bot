import {
  collect,
  dailyBrief,
  handleUpdate,
  weeklyBrief,
} from "./bot.js";

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function registerWebhook(origin, token) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `${origin}/webhook/${token}`,
        allowed_updates: ["message", "channel_post"],
      }),
    }
  );
  return response.json();
}

export default {
  async scheduled(event, env) {
    if (event.cron === "0 21 * * *" || event.cron === "0 9 * * *") {
      await dailyBrief(env, env.DB);
      return;
    }
    if (event.cron === "0 11 * * sun") {
      await weeklyBrief(env, env.DB);
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (
      request.method === "POST" &&
      url.pathname === `/webhook/${env.TELEGRAM_BOT_TOKEN}`
    ) {
      const update = await request.json();
      ctx.waitUntil(handleUpdate(env, env.DB, update));
      return textResponse("ok");
    }

    if (url.pathname === "/setup") {
      if (!env.TELEGRAM_BOT_TOKEN) {
        return textResponse("TELEGRAM_BOT_TOKEN secret 미설정", 500);
      }
      const result = await registerWebhook(url.origin, env.TELEGRAM_BOT_TOKEN);
      return textResponse(
        result.ok
          ? "교육봇 웹훅 등록 완료. 텔레그램에서 /start를 보내세요."
          : `웹훅 등록 실패: ${JSON.stringify(result)}`,
        result.ok ? 200 : 502
      );
    }

    if (url.pathname === "/debug") {
      const { sections, status } = await collect();
      const sample = Object.fromEntries(
        Object.entries(sections).map(([key, section]) => [
          key,
          { label: section.label, items: section.items.slice(0, 2) },
        ])
      );
      return new Response(JSON.stringify({ status, sample }, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    return textResponse(
      "목동 교육·입시 텔레그램 봇이 실행 중입니다.\n봇 연결: /setup"
    );
  },
};
