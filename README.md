# 목동 교육·입시 텔레그램 봇

`@mokdong_edu_bot`용 독립 Cloudflare Worker입니다. 교육 정책, 고입·특목·자사고, 목동·양천 교육, 설명회, 입시 전문지와 교육 유튜브 소식을 정리해 보냅니다.

실시간 검색어 봇은 [`telegram-trend-bot`](https://github.com/para333311/telegram-trend-bot)에서 별도로 관리합니다.

## 기능

- 매일 06:00·18:00 KST 교육·입시 브리핑
- 일요일 20:00 KST 주간 체크리스트
- 7일 중복 방지(D1) — 새 소식이 없으면 "새 소식 없음" 알림을 보내 실행 여부를 알 수 있음
- 개인 채팅 및 텔레그램 채널 등록
- 명령어: `/start`, `/brief`, `/status`, `/stop`
- 관리 경로: `/setup`, `/debug`

## 구성

```text
src/index.js       Worker 진입점·웹훅·cron
src/bot.js         수집·필터·메시지·D1 로직
wrangler.jsonc     Worker·cron·D1 설정
```

## 배포 설정

1. Cloudflare에서 `mokdong-edu-bot-db` D1 데이터베이스를 생성합니다.
2. `wrangler.jsonc`의 `database_id` 자리표시자를 실제 D1 ID로 교체합니다.
3. 다음 명령으로 Worker와 텔레그램 토큰을 설정합니다.

```bash
npm install
npx wrangler deploy
printf '%s' '교육봇_토큰' | npx wrangler secret put TELEGRAM_BOT_TOKEN
```

최초 배포 후 Worker 주소의 `/setup`에 한 번 접속해 웹훅을 등록합니다.

기존 통합 Worker에서 이 봇을 운영했다면, 새 `/setup` 호출이 기존 웹훅을 새 Worker로 교체합니다. 기존 D1의 구독 채팅은 자동 이전되지 않으므로 개인 채팅에서 `/start`를 다시 보내고, 채널에도 글을 하나 올려 다시 등록해야 합니다.

## 로컬 확인

```bash
npm test
npx wrangler dev
```

## 보안

봇 토큰과 Cloudflare 인증값은 저장소에 커밋하지 않습니다. 토큰이 노출되면 BotFather에서 즉시 재발급하세요.
