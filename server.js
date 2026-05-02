const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ============ Routes ============

// GET / — guide page
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Chat System</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1a1a2e;
      color: #eee;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; color: #e94560; }
    .subtitle { color: #888; margin-bottom: 2rem; }
    .cards {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    .card {
      background: #16213e;
      border: 1px solid #0f3460;
      border-radius: 12px;
      padding: 1.5rem 2rem;
      text-decoration: none;
      color: #eee;
      transition: transform 0.2s, border-color 0.2s;
      min-width: 160px;
    }
    .card:hover {
      transform: translateY(-4px);
      border-color: #e94560;
    }
    .card .emoji { font-size: 2rem; display: block; margin-bottom: 0.5rem; }
    .card .name { font-weight: bold; font-size: 1.1rem; }
    .card .role { font-size: 0.8rem; color: #888; margin-top: 0.25rem; }
    .status { margin-top: 2rem; font-size: 0.85rem; color: #555; }
    .status span { color: #4ecca3; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Agent Chat System</h1>
    <p class="subtitle">실시간 에이전트 채팅 시스템</p>
    <div class="cards">
      <a href="/a" class="card">
        <span class="emoji">🧠</span>
        <span class="name">Agent A</span>
        <span class="role">대가리</span>
      </a>
      <a href="/b" class="card">
        <span class="emoji">🎨</span>
        <span class="name">Agent B</span>
        <span class="role">미코</span>
      </a>
    </div>
    <div class="status">서버 상태: <span>● 실행 중</span> (Port ${PORT})</div>
  </div>
</body>
</html>`);
});

// GET /a — Agent A page (대가리)
app.get('/a', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'agentA.html'));
});

// GET /b — Agent B page (미코)
app.get('/b', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'agentB.html'));
});

// ============ Socket.IO ============

io.on('connection', (socket) => {
  // Determine which agent connected based on handshake query
  const agent = socket.handshake.query.agent || 'unknown';
  const counterpart = agent === 'A' ? 'B' : 'A';
  
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] 🟢 Agent ${agent} connected (${socket.id})`);

  // Notify counterpart about connection
  if (agent === 'A') {
    io.emit('message_to_b', {
      text: 'Agent A(대가리)가 접속했습니다.',
      timestamp,
      sender: 'system'
    });
  } else if (agent === 'B') {
    io.emit('message_to_a', {
      text: 'Agent B(미코)가 접속했습니다.',
      timestamp,
      sender: 'system'
    });
  }

  // message_from_a → broadcast to B
  socket.on('message_from_a', (data) => {
    const msg = {
      text: data.text,
      timestamp: data.timestamp || new Date().toISOString(),
      sender: 'A'
    };
    console.log(`[${msg.timestamp}] A → B: ${msg.text}`);
    io.emit('message_to_b', msg);
  });

  // message_from_b → broadcast to A
  socket.on('message_from_b', (data) => {
    const msg = {
      text: data.text,
      timestamp: data.timestamp || new Date().toISOString(),
      sender: 'B'
    };
    console.log(`[${msg.timestamp}] B → A: ${msg.text}`);
    io.emit('message_to_a', msg);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] 🔴 Agent ${agent} disconnected (${socket.id})`);

    const disconnectMsg = agent === 'A'
      ? 'Agent A(대가리)의 연결이 끊어졌습니다.'
      : 'Agent B(미코)의 연결이 끊어졌습니다.';

    if (agent === 'A') {
      io.emit('message_to_b', { text: disconnectMsg, timestamp: ts, sender: 'system' });
    } else if (agent === 'B') {
      io.emit('message_to_a', { text: disconnectMsg, timestamp: ts, sender: 'system' });
    }
  });
});

// ============ Start ============

server.listen(PORT, () => {
  console.log(`🚀 Agent Chat Server running on http://localhost:${PORT}`);
  console.log(`   Agent A: http://localhost:${PORT}/a`);
  console.log(`   Agent B: http://localhost:${PORT}/b`);
});
