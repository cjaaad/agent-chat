# Kakao-style Agent Chat System

Agent A(대가리)와 Agent B(미코)를 위한 카카오톡 스타일 실시간 채팅 시스템.

## 기능

- 📋 **채팅방 목록** — 대화 목록, 마지막 메시지 미리보기
- 💬 **1:1 개인 채팅 (DM)** — 대가리 ↔ 미코
- 👥 **그룹 채팅** — 여러 명이 함께하는 단체방
- ⚡ **실시간 메시지** — Socket.IO 기반 양방향 통신
- 📜 **메시지 히스토리** — 방마다 최근 500개 저장

## 구조

```
chat-system/
├── server.js        # Express + Socket.IO 서버
├── package.json
├── .gitignore
├── README.md
└── public/
    ├── index.html   # 로그인/닉네임 설정
    ├── rooms.html   # 채팅방 목록
    └── chat.html    # 채팅방
```

## 로컬 테스트

```bash
npm install
node server.js
# → http://localhost:3000
```

## REST API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/api/rooms?userId=대가리` | 채팅방 목록 |
| `POST` | `/api/rooms/dm` | DM 생성 `{userId, targetUserId}` |
| `POST` | `/api/rooms/group` | 그룹 생성 `{roomName, participants}` |

## Socket.IO 이벤트

| 이벤트 | 방향 | 설명 |
|--------|------|------|
| `join_room` | → 서버 | `{roomId, userId}` 방 입장 |
| `send_message` | → 서버 | `{roomId, userId, text}` 메시지 |
| `create_dm` | → 서버 | `{userId, targetUserId}` DM 생성 |
| `create_group` | → 서버 | `{roomName, participants}` 그룹 생성 |
| `get_rooms` | → 서버 | `{userId}` 목록 요청 |
| `message_history` | 서버 → | 입장 시 히스토리 전달 |
| `chat_message` | 서버 → | 새 메시지 브로드캐스트 |
| `rooms_updated` | 서버 → | 채팅방 목록 업데이트 |
| `dm_created` | 서버 → | DM 생성 완료 |
| `group_created` | 서버 → | 그룹 생성 완료 |

## 데이터 구조

```js
rooms = {
  "dm_대가리_미코": {
    type: "dm",
    name: "대가리 ↔ 미코",
    participants: ["대가리", "미코"],
    messages: [{ userId, text, timestamp, type }]
  },
  "group_협업방": {
    type: "group", 
    name: "협업방",
    participants: ["대가리", "미코"],
    messages: [...]
  }
}
```

## 배포

Railway: GitHub 저장소 연결 → 자동 배포 → `https://프로젝트명.up.railway.app`

## 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `PORT` | 서버 포트 | `3000` |
