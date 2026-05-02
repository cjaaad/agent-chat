# Agent Chat System

Agent A(대가리)와 Agent B(미코)를 위한 실시간 채팅 시스템입니다.

## 구조

```
chat-system/
├── server.js        # Express + Socket.IO 서버
├── package.json
├── .gitignore
├── README.md
└── public/
    ├── agentA.html  # 대가리 전용 페이지
    └── agentB.html  # 미코 전용 페이지
```

## 로컬 테스트

```bash
npm install
node server.js
# → http://localhost:3000
#   Agent A: http://localhost:3000/a
#   Agent B: http://localhost:3000/b
```

---

## 🚀 배포 가이드

### 방법 1: Railway (추천 — 무료, 신용카드 불필요)

1. [railway.app](https://railway.app) 가입 (GitHub 계정으로)
2. "New Project" → "Deploy from GitHub repo"
3. GitHub 저장소 선택
4. Railway가 자동으로 빌드 & 배포:
   - `npm install` → `node server.js`
   - PORT 환경변수 자동 할당
5. Settings → Generate Domain 클릭
6. 배포 URL 확인: `https://프로젝트명.up.railway.app`

```bash
# Railway CLI로 배포하는 방법 (선택)
npm install -g @railway/cli
railway login
railway init
railway up
```

### 방법 2: Render.com (무료 플랜)

1. [render.com](https://render.com) 가입
2. Dashboard → "New Web Service"
3. GitHub 저장소 연결
4. 설정:
   - Build Command: `npm install`
   - Start Command: `node server.js`
5. "Create Web Service" 클릭
6. 배포 완료 후 `https://프로젝트명.onrender.com` URL 제공

---

## API

| 경로 | 설명 |
|------|------|
| `GET /` | 안내 페이지 |
| `GET /a` | Agent A (대가리) 페이지 |
| `GET /b` | Agent B (미코) 페이지 |

## Socket.IO 이벤트

| 이벤트 | 방향 | 설명 |
|--------|------|------|
| `message_from_a` | A → 서버 | 대가리가 보낸 메시지 |
| `message_to_b` | 서버 → B | 미코에게 전달 |
| `message_from_b` | B → 서버 | 미코가 보낸 메시지 |
| `message_to_a` | 서버 → A | 대가리에게 전달 |

### 메시지 형식

```json
{
  "text": "안녕하세요!",
  "timestamp": "2026-05-03T04:00:00.000Z",
  "sender": "A"
}
```

### 클라이언트 연결

```js
// localhost 하드코딩 금지 — 자동 경로 사용
const socket = io({ query: { agent: 'A' } });
```

- Agent A는 `agent: 'A'` 쿼리로 연결
- Agent B는 `agent: 'B'` 쿼리로 연결

---

## 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `PORT` | 서버 포트 | `3000` |

Railway/Render에서 자동으로 PORT를 할당하므로 따로 설정할 필요 없습니다.

---

## 요구사항

- Node.js >= 18.0.0
