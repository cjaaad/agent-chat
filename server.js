
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

// ─── 데이터 저장소 ───
const rooms = {};
const friends = {}; // { nickname: { display_name, avatar, status, friends: Set } }
const messages = {}; // { room_id: [{ sender, text, time, avatar, type }] }

// ─── 친구 관리 ───
function ensureFriend(nick, displayName, avatar) {
  if (!friends[nick]) {
    friends[nick] = {
      display_name: displayName || nick,
      avatar: avatar || '😶',
      status: 'offline',
      friends: new Set()
    };
  }
  return friends[nick];
}

function addFriendPair(nick1, nick2) {
  const f1 = ensureFriend(nick1);
  const f2 = ensureFriend(nick2);
  f1.friends.add(nick2);
  f2.friends.add(nick1);
  io.emit('friend_update', { nick1, nick2 });
}

// ─── 방 관리 ───
function createRoomId() {
  return 'room_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function createDM(user1, user2) {
  // 중복 방지
  for (const [id, r] of Object.entries(rooms)) {
    if (r.type === 'dm' && Array.isArray(r.participants) && r.participants.length === 2) {
      const sorted = [...r.participants].sort();
      if (sorted[0] === [user1, user2].sort()[0] && sorted[1] === [user1, user2].sort()[1]) {
        return { room_id: id, exists: true };
      }
    }
  }
  const id = 'dm_' + [user1, user2].sort().join('_');
  rooms[id] = {
    id,
    type: 'dm',
    participants: [user1, user2],
    name: null,
    created: new Date().toISOString()
  };
  messages[id] = [];
  addFriendPair(user1, user2);
  io.emit('room_update', {});
  return { room_id: id, exists: false };
}

function createGroup(participants, name) {
  const id = createRoomId();
  rooms[id] = {
    id,
    type: 'group',
    participants: [...new Set(participants)],
    name: name || null,
    created: new Date().toISOString()
  };
  messages[id] = [];
  // 모든 참가자 간 친구 추가
  const unique = [...new Set(participants)];
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      addFriendPair(unique[i], unique[j]);
    }
  }
  io.emit('room_update', {});
  return { room_id: id };
}

// ─── REST API ───

// 채팅방 목록 (닉네임 기반 필터링)
app.get('/api/rooms', (req, res) => {
  const nick = req.query.nick;
  let result;
  if (nick) {
    result = Object.values(rooms).filter(r =>
      Array.isArray(r.participants) && r.participants.includes(nick)
    );
  } else {
    result = Object.values(rooms);
  }
  res.json({ rooms: result });
});

// DM 생성
app.post('/api/rooms/dm', (req, res) => {
  const { user1, user2 } = req.body;
  if (!user1 || !user2) {
    return res.status(400).json({ error: 'user1 and user2 required' });
  }
  const result = createDM(user1, user2);
  res.json(result);
});

// DM 찾아서 입장 (없으면 404)
app.post('/api/rooms/dm/join', (req, res) => {
  const { user1, user2 } = req.body;
  if (!user1 || !user2) {
    return res.status(400).json({ error: 'user1 and user2 required' });
  }
  const sorted = [user1, user2].sort();
  for (const [id, r] of Object.entries(rooms)) {
    if (r.type === 'dm' && Array.isArray(r.participants) && r.participants.length === 2) {
      const psorted = [...r.participants].sort();
      if (psorted[0] === sorted[0] && psorted[1] === sorted[1]) {
        return res.json({ room_id: id });
      }
    }
  }
  res.status(404).json({ error: 'DM not found' });
});

// 그룹 생성
app.post('/api/rooms/group', (req, res) => {
  const { participants, name } = req.body;
  if (!participants || participants.length < 2) {
    return res.status(400).json({ error: 'need at least 2 participants' });
  }
  const result = createGroup(participants, name);
  res.json(result);
});

// 채팅방 나가기
app.post('/api/rooms/:id/leave', (req, res) => {
  const { id } = req.params;
  const { nickname } = req.body;
  if (!rooms[id]) return res.status(404).json({ error: 'room not found' });
  if (!nickname) return res.status(400).json({ error: 'nickname required' });

  const room = rooms[id];
  if (Array.isArray(room.participants)) {
    room.participants = room.participants.filter(p => p !== nickname);
  }

  // 빈 방이면 삭제
  if (!room.participants || room.participants.length === 0) {
    delete rooms[id];
    delete messages[id];
    io.emit('room_deleted', { room_id: id });
  }

  io.to(id).emit('message', {
    type: 'system',
    text: `${nickname}님이 나갔습니다.`,
    time: new Date().toISOString()
  });
  io.emit('room_update', {});

  res.json({ ok: true });
});

// 전체 친구 목록
app.get('/api/friends/all', (req, res) => {
  const allFriends = new Set();
  for (const [nick, data] of Object.entries(friends)) {
    if (data.friends) {
      data.friends.forEach(f => allFriends.add(f));
    }
  }
  res.json({ friends: [...allFriends] });
});

// 특정 친구 정보
app.get('/api/friends/:nick', (req, res) => {
  const { nick } = req.params;
  const f = friends[nick];
  if (f) {
    res.json({
      display_name: f.display_name,
      avatar: f.avatar,
      status: f.status
    });
  } else {
    res.json({});
  }
});

// ─── Socket.IO ───
io.on('connection', (socket) => {
  const nick = socket.handshake.query.nick || '익명';
  const avatar = socket.handshake.query.avatar || '😶';

  ensureFriend(nick, nick, avatar);
  friends[nick].status = 'online';

  socket.on('join_room', (data) => {
    const roomId = data.room_id;
    const participant = data.nickname || nick;
    const av = data.avatar || avatar;

    if (!rooms[roomId]) {
      socket.emit('error', { message: 'Room not found: ' + roomId });
      return;
    }

    // 참가자 추가
    if (rooms[roomId].participants && !rooms[roomId].participants.includes(participant)) {
      rooms[roomId].participants.push(participant);
    }

    socket.join(roomId);
    socket.currentRoom = roomId;
    socket.nickname = participant;

    // 과거 메시지 전송
    if (messages[roomId] && messages[roomId].length > 0) {
      const recent = messages[roomId].slice(-100);
      recent.forEach(msg => socket.emit('message', msg));
    }

    // 입장 알림
    io.to(roomId).emit('message', {
      type: 'system',
      text: `${participant}님이 입장했습니다.`,
      time: new Date().toISOString()
    });

    io.emit('room_update', {});
  });

  socket.on('send_message', (data) => {
    const roomId = data.room_id;
    const msg = {
      sender: data.sender || nick,
      text: data.text || data.message || '',
      avatar: data.avatar || avatar,
      time: new Date().toISOString(),
      type: 'message'
    };

    if (!rooms[roomId]) return;
    if (!messages[roomId]) messages[roomId] = [];

    // 마지막 메시지 저장
    rooms[roomId].last_message = msg.text;
    rooms[roomId].last_time = msg.time;
    messages[roomId].push(msg);

    // 100개 초과 시 오래된 것 삭제
    if (messages[roomId].length > 200) {
      messages[roomId] = messages[roomId].slice(-100);
    }

    io.to(roomId).emit('message', msg);
  });

  socket.on('leave_room', (data) => {
    const roomId = data.room_id;
    const participant = data.nickname || nick;

    if (rooms[roomId]) {
      rooms[roomId].participants = rooms[roomId].participants.filter(p => p !== participant);

      io.to(roomId).emit('message', {
        type: 'system',
        text: `${participant}님이 나갔습니다.`,
        time: new Date().toISOString()
      });

      if (rooms[roomId].participants.length === 0) {
        delete rooms[roomId];
        delete messages[roomId];
        io.emit('room_deleted', { room_id: roomId });
      }
    }

    socket.leave(roomId);
    io.emit('room_update', {});
  });

  socket.on('disconnect', () => {
    if (friends[nick]) {
      friends[nick].status = 'offline';
    }
    io.emit('friend_update', { nick, status: 'offline' });
  });
});

const PORT = process.env.PORT || 3456;
server.listen(PORT, () => {
  console.log(`ChaTalk server running on port ${PORT}`);

  // 빌트인 참가자 등록
  ensureFriend('대가리', '대가리', '🧠');
  ensureFriend('미코', '미코', '🎨');
  ensureFriend('찬희', '찬희', '✨');

  // 서로 친구 맺기
  addFriendPair('대가리', '찬희');
  addFriendPair('미코', '찬희');
  addFriendPair('대가리', '미코');

  // 기본 그룹방 생성
  if (!Object.values(rooms).some(r => r.name === '전체 채팅방')) {
    createGroup(['대가리', '찬희', '미코'], '전체 채팅방');
    console.log('Default group created');
  }
});
