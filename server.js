const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ============ User Profiles ============

const users = {};
const friends = {}; // { userId: [friendId, ...] }

function ensureUser(userId) {
  if (!users[userId]) {
    const colors = {
      '대가리': ['#6C5CE7', '#A29BFE'],
      '미코': ['#E94560', '#FF6B81'],
      '찬희': ['#0A84FF', '#5EBCFF'],
    };
    const [c1, c2] = colors[userId] || ['#636E72', '#B2BEC3'];
    users[userId] = {
      userId,
      avatarColor1: c1,
      avatarColor2: c2,
      avatarEmoji: userId === '대가리' ? '🧠' : userId === '미코' ? '🎨' : '👤'
    };
    friends[userId] = friends[userId] || [];
  }
  return users[userId];
}

function getFriendList(userId) {
  ensureUser(userId);
  return (friends[userId] || []).map(fid => {
    const u = ensureUser(fid);
    return {
      userId: fid,
      avatarUrl: `/api/avatar/${encodeURIComponent(fid)}.svg`,
      emoji: u.avatarEmoji
    };
  });
}

// GET /api/profile/:userId
app.get('/api/profile/:userId', (req, res) => {
  res.json({ ok: true, user: ensureUser(req.params.userId) });
});

// GET /api/avatar/:userId.svg
app.get('/api/avatar/:userId.svg', (req, res) => {
  const user = ensureUser(req.params.userId);
  const initial = req.params.userId[0];
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" style="stop-color:${user.avatarColor1}"/>
    <stop offset="100%" style="stop-color:${user.avatarColor2}"/>
  </linearGradient></defs>
  <rect width="100" height="100" rx="24" fill="url(#g)"/>
  <text x="50" y="68" font-family="-apple-system,SF Pro Display,sans-serif" font-size="44" font-weight="700" fill="white" text-anchor="middle">${initial}</text>
</svg>`);
});

// ============ Friends API ============

// POST /api/friends/add
app.post('/api/friends/add', (req, res) => {
  const { userId, friendId } = req.body;
  if (!userId || !friendId || userId === friendId) {
    return res.json({ ok: false, error: 'Invalid' });
  }
  ensureUser(userId);
  ensureUser(friendId);
  if (!friends[userId]) friends[userId] = [];
  if (!friends[friendId]) friends[friendId] = [];
  if (!friends[userId].includes(friendId)) {
    friends[userId].push(friendId);
    friends[friendId].push(userId);
    // 상호 친구: emit friend lists
    io.emit('friends_updated', { userId: friendId, friends: getFriendList(friendId) });
  }
  io.emit('friends_updated', { userId, friends: getFriendList(userId) });
  res.json({ ok: true, friends: getFriendList(userId) });
});

// DELETE /api/friends/remove
app.delete('/api/friends/remove', (req, res) => {
  const { userId, friendId } = req.body;
  if (!userId || !friendId) return res.json({ ok: false, error: 'Invalid' });
  friends[userId] = (friends[userId] || []).filter(f => f !== friendId);
  friends[friendId] = (friends[friendId] || []).filter(f => f !== userId);
  io.emit('friends_updated', { userId, friends: getFriendList(userId) });
  io.emit('friends_updated', { userId: friendId, friends: getFriendList(friendId) });
  res.json({ ok: true, friends: getFriendList(userId) });
});

// GET /api/friends?userId=
app.get('/api/friends', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.json({ ok: false, error: 'userId required' });
  res.json({ ok: true, friends: getFriendList(userId) });
});

// ============ In-Memory Data Store ============

const rooms = {};

function getDMroomId(user1, user2) {
  const sorted = [user1, user2].sort();
  return `dm_${sorted[0].replace(/\s/g, '_')}_${sorted[1].replace(/\s/g, '_')}`;
}

function addMessage(roomId, userId, text, msgType = 'user') {
  if (!rooms[roomId]) return null;
  const msg = { userId, text, timestamp: new Date().toISOString(), type: msgType };
  rooms[roomId].messages.push(msg);
  if (rooms[roomId].messages.length > 500) rooms[roomId].messages = rooms[roomId].messages.slice(-500);
  return msg;
}

// ============ Routes ============

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/rooms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'rooms.html')));
app.get('/chat/:roomId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));

// ============ REST API ============

app.get('/api/rooms', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.json({ ok: false, error: 'userId required' });
  const userRooms = buildRoomList(userId);
  res.json({ ok: true, rooms: userRooms });
});

app.post('/api/rooms/dm', (req, res) => {
  const { userId, targetUserId } = req.body;
  if (!userId || !targetUserId || userId === targetUserId) return res.json({ ok: false, error: 'Invalid' });
  const roomId = getDMroomId(userId, targetUserId);
  if (!rooms[roomId]) {
    rooms[roomId] = { type: 'dm', name: `${userId} ↔ ${targetUserId}`, participants: [userId, targetUserId], messages: [] };
    addMessage(roomId, 'system', `${userId}님과 ${targetUserId}님의 대화가 시작되었습니다.`, 'system');
    // DM 생성 시 자동 친구 추가
    ensureUser(userId); ensureUser(targetUserId);
    if (!friends[userId]) friends[userId] = [];
    if (!friends[targetUserId]) friends[targetUserId] = [];
    if (!friends[userId].includes(targetUserId)) {
      friends[userId].push(targetUserId);
      friends[targetUserId].push(userId);
    }
  }
  notifyRoomList([userId, targetUserId]);
  notifyFriends([userId, targetUserId]);
  res.json({ ok: true, roomId });
});

app.post('/api/rooms/group', (req, res) => {
  const { roomName, participants } = req.body;
  if (!roomName || !participants || participants.length < 2) return res.json({ ok: false, error: 'Invalid' });
  const roomId = `group_${roomName.replace(/\s/g, '_')}`;
  if (rooms[roomId]) return res.json({ ok: false, error: 'Room exists' });
  rooms[roomId] = { type: 'group', name: roomName, participants: [...participants], messages: [] };
  addMessage(roomId, 'system', `"${roomName}" 그룹이 생성되었습니다.`, 'system');
  // 그룹 생성 시 모든 참가자끼리 친구 추가
  participants.forEach(p => ensureUser(p));
  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const a = participants[i], b = participants[j];
      if (!friends[a]) friends[a] = [];
      if (!friends[b]) friends[b] = [];
      if (!friends[a].includes(b)) { friends[a].push(b); friends[b].push(a); }
    }
  }
  notifyRoomList(participants);
  notifyFriends(participants);
  res.json({ ok: true, roomId });
});

app.post('/api/rooms/leave', (req, res) => {
  const { roomId, userId } = req.body;
  if (!roomId || !userId || !rooms[roomId]) return res.json({ ok: false, error: 'Invalid' });
  const room = rooms[roomId];
  room.participants = room.participants.filter(p => p !== userId);
  addMessage(roomId, 'system', `${userId}님이 나갔습니다.`, 'system');
  io.to(roomId).emit('chat_message', { userId: 'system', text: `${userId}님이 나갔습니다.`, timestamp: new Date().toISOString(), type: 'system' });
  if (room.participants.length === 0) {
    delete rooms[roomId];
  }
  notifyRoomList([...room.participants, userId]);
  res.json({ ok: true });
});

// ============ Socket.IO ============

let roomListTimers = {};
let friendListTimers = {};

function notifyRoomList(userIds) {
  userIds.forEach(uid => {
    clearTimeout(roomListTimers[uid]);
    roomListTimers[uid] = setTimeout(() => {
      io.emit('rooms_updated', { userId: uid, rooms: buildRoomList(uid) });
    }, 200);
  });
}

function notifyFriends(userIds) {
  userIds.forEach(uid => {
    clearTimeout(friendListTimers[uid]);
    friendListTimers[uid] = setTimeout(() => {
      io.emit('friends_updated', { userId: uid, friends: getFriendList(uid) });
    }, 200);
  });
}

function buildRoomList(userId) {
  const list = [];
  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.participants.includes(userId)) {
      const lastMsg = room.messages.length > 0 ? room.messages[room.messages.length - 1] : null;
      list.push({
        roomId, type: room.type, name: room.name,
        participants: room.participants.map(p => {
          const up = ensureUser(p);
          return { userId: p, avatarUrl: `/api/avatar/${encodeURIComponent(p)}.svg`, emoji: up.avatarEmoji };
        }),
        lastMessage: lastMsg ? lastMsg.text.slice(0, 50) : null,
        lastTime: lastMsg ? lastMsg.timestamp : null, unread: 0
      });
    }
  }
  list.sort((a, b) => (b.lastTime || '').localeCompare(a.lastTime || ''));
  return list;
}

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on('join_room', ({ roomId, userId }) => {
    if (!roomId || !userId || !rooms[roomId]) return;
    if (!rooms[roomId].participants.includes(userId)) {
      rooms[roomId].participants.push(userId);
    }
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userId = userId;
    console.log(`[join] ${userId} → ${roomId}`);
    socket.emit('message_history', rooms[roomId].messages.slice(-100));
    const joinMsg = addMessage(roomId, 'system', `${userId}님이 입장했습니다.`, 'system');
    socket.to(roomId).emit('chat_message', joinMsg);
    notifyRoomList([userId]);
  });

  socket.on('send_message', ({ roomId, userId, text }) => {
    if (!roomId || !userId || !text || !rooms[roomId]) return;
    const msg = addMessage(roomId, userId, text, 'user');
    console.log(`[msg] ${userId} @ ${roomId}: ${text.slice(0, 30)}`);
    io.to(roomId).emit('chat_message', msg);
    notifyRoomList(rooms[roomId].participants);
  });

  socket.on('leave_room', ({ roomId, userId }) => {
    if (!roomId || !userId || !rooms[roomId]) return;
    const room = rooms[roomId];
    room.participants = room.participants.filter(p => p !== userId);
    socket.leave(roomId);
    addMessage(roomId, 'system', `${userId}님이 나갔습니다.`, 'system');
    io.to(roomId).emit('chat_message', { userId: 'system', text: `${userId}님이 나갔습니다.`, timestamp: new Date().toISOString(), type: 'system' });
    console.log(`[leave] ${userId} X ${roomId}`);
    if (room.participants.length === 0) delete rooms[roomId];
    notifyRoomList([...room.participants, userId]);
  });

  socket.on('create_dm', ({ userId, targetUserId }) => {
    if (!userId || !targetUserId || userId === targetUserId) return;
    const roomId = getDMroomId(userId, targetUserId);
    if (!rooms[roomId]) {
      rooms[roomId] = { type: 'dm', name: `${userId} ↔ ${targetUserId}`, participants: [userId, targetUserId], messages: [] };
      addMessage(roomId, 'system', `${userId}님과 ${targetUserId}님의 대화가 시작되었습니다.`, 'system');
    }
    socket.emit('dm_created', { roomId, targetUserId });
    notifyRoomList([userId, targetUserId]);
  });

  socket.on('create_group', ({ roomName, participants }) => {
    if (!roomName || !participants || participants.length < 2) return;
    const roomId = `group_${roomName.replace(/\s/g, '_')}`;
    if (rooms[roomId]) return;
    rooms[roomId] = { type: 'group', name: roomName, participants: [...participants], messages: [] };
    addMessage(roomId, 'system', `"${roomName}" 그룹이 생성되었습니다.`, 'system');
    socket.emit('group_created', { roomId, roomName });
    notifyRoomList(participants);
  });

  socket.on('get_rooms', ({ userId }) => {
    socket.emit('rooms_updated', { userId, rooms: buildRoomList(userId) });
  });

  socket.on('get_friends', ({ userId }) => {
    socket.emit('friends_updated', { userId, friends: getFriendList(userId) });
  });

  socket.on('add_friend', ({ userId, friendId }) => {
    if (!userId || !friendId || userId === friendId) return;
    ensureUser(userId); ensureUser(friendId);
    if (!friends[userId]) friends[userId] = [];
    if (!friends[friendId]) friends[friendId] = [];
    if (!friends[userId].includes(friendId)) {
      friends[userId].push(friendId);
      friends[friendId].push(userId);
    }
    notifyFriends([userId, friendId]);
  });

  socket.on('remove_friend', ({ userId, friendId }) => {
    if (!userId || !friendId) return;
    friends[userId] = (friends[userId] || []).filter(f => f !== friendId);
    friends[friendId] = (friends[friendId] || []).filter(f => f !== userId);
    notifyFriends([userId, friendId]);
  });

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
  });
});

// ============ Start ============

server.listen(PORT, () => {
  console.log(`🚀 Kakao-style Chat Server on :${PORT}`);
});
