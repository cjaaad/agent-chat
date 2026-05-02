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

// ============ In-Memory Data Store ============

const rooms = {};

function ensureRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = { messages: [], participants: [], type: 'group', name: roomId };
  }
  return rooms[roomId];
}

function getDMroomId(user1, user2) {
  const sorted = [user1, user2].sort();
  return `dm_${sorted[0].replace(/\s/g, '_')}_${sorted[1].replace(/\s/g, '_')}`;
}

function addMessage(roomId, userId, text, msgType = 'user') {
  const room = ensureRoom(roomId);
  const msg = {
    userId,
    text,
    timestamp: new Date().toISOString(),
    type: msgType
  };
  room.messages.push(msg);
  // Keep last 500 messages
  if (room.messages.length > 500) room.messages = room.messages.slice(-500);
  return msg;
}

// ============ Routes ============

// GET / → login page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// GET /rooms → chat room list
app.get('/rooms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'rooms.html'));
});

// GET /chat/:roomId → chat room
app.get('/chat/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// ============ REST API ============

// GET /api/rooms?userId=xxx
app.get('/api/rooms', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.json({ ok: false, error: 'userId required' });

  const userRooms = [];
  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.participants.includes(userId)) {
      const lastMsg = room.messages.length > 0 ? room.messages[room.messages.length - 1] : null;
      userRooms.push({
        roomId,
        type: room.type,
        name: room.name,
        participants: room.participants,
        lastMessage: lastMsg ? lastMsg.text.slice(0, 50) : null,
        lastTime: lastMsg ? lastMsg.timestamp : null,
        unread: 0 // optional, can implement later
      });
    }
  }
  // Sort: most recent message first
  userRooms.sort((a, b) => {
    if (!a.lastTime) return 1;
    if (!b.lastTime) return -1;
    return new Date(b.lastTime) - new Date(a.lastTime);
  });
  res.json({ ok: true, rooms: userRooms });
});

// POST /api/rooms/dm → create DM
app.post('/api/rooms/dm', (req, res) => {
  const { userId, targetUserId } = req.body;
  if (!userId || !targetUserId) return res.json({ ok: false, error: 'userId and targetUserId required' });
  if (userId === targetUserId) return res.json({ ok: false, error: 'Cannot DM yourself' });

  const roomId = getDMroomId(userId, targetUserId);
  if (!rooms[roomId]) {
    rooms[roomId] = {
      type: 'dm',
      name: `${userId} ↔ ${targetUserId}`,
      participants: [userId, targetUserId],
      messages: []
    };
    addMessage(roomId, 'system', `${userId}님과 ${targetUserId}님의 대화가 시작되었습니다.`, 'system');
  }
  res.json({ ok: true, roomId });
});

// POST /api/rooms/group → create group
app.post('/api/rooms/group', (req, res) => {
  const { roomName, participants } = req.body;
  if (!roomName || !participants || !Array.isArray(participants) || participants.length < 2) {
    return res.json({ ok: false, error: 'roomName and participants array (min 2) required' });
  }

  const roomId = `group_${roomName.replace(/\s/g, '_')}`;
  if (rooms[roomId]) return res.json({ ok: false, error: 'Room already exists' });

  rooms[roomId] = {
    type: 'group',
    name: roomName,
    participants: [...participants],
    messages: []
  };
  addMessage(roomId, 'system', `"${roomName}" 그룹이 생성되었습니다.`, 'system');
  res.json({ ok: true, roomId });
});

// ============ Socket.IO ============

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // Join a chat room
  socket.on('join_room', ({ roomId, userId }) => {
    if (!roomId || !userId) return;

    const room = ensureRoom(roomId);

    // Add user to participants if not already
    if (!room.participants.includes(userId)) {
      room.participants.push(userId);
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userId = userId;

    console.log(`[join] ${userId} → ${roomId}`);

    // Send message history (last 100)
    const history = room.messages.slice(-100);
    socket.emit('message_history', history);

    // Notify others in the room
    const joinMsg = addMessage(roomId, 'system', `${userId}님이 입장했습니다.`, 'system');
    socket.to(roomId).emit('chat_message', joinMsg);

    // Notify all about room list update
    broadcastRoomList(userId);
  });

  // Send message to a room
  socket.on('send_message', ({ roomId, userId, text }) => {
    if (!roomId || !userId || !text) return;

    const msg = addMessage(roomId, userId, text, 'user');
    console.log(`[msg] ${userId} @ ${roomId}: ${text.slice(0, 30)}`);

    // Broadcast to everyone in the room (including sender)
    io.to(roomId).emit('chat_message', msg);

    // Notify room list updates for participants
    broadcastRoomList(userId);
  });

  // Create DM
  socket.on('create_dm', ({ userId, targetUserId }) => {
    if (!userId || !targetUserId || userId === targetUserId) return;

    const roomId = getDMroomId(userId, targetUserId);
    if (!rooms[roomId]) {
      rooms[roomId] = {
        type: 'dm',
        name: `${userId} ↔ ${targetUserId}`,
        participants: [userId, targetUserId],
        messages: []
      };
      addMessage(roomId, 'system', `${userId}님과 ${targetUserId}님의 대화가 시작되었습니다.`, 'system');
    }

    console.log(`[dm create] ${userId} + ${targetUserId} → ${roomId}`);
    socket.emit('dm_created', { roomId, targetUserId });

    // Notify both participants
    broadcastRoomList(userId);
    broadcastRoomList(targetUserId);
  });

  // Create group
  socket.on('create_group', ({ roomName, participants }) => {
    if (!roomName || !participants || participants.length < 2) return;

    const roomId = `group_${roomName.replace(/\s/g, '_')}`;
    if (!rooms[roomId]) {
      rooms[roomId] = {
        type: 'group',
        name: roomName,
        participants: [...participants],
        messages: []
      };
      addMessage(roomId, 'system', `"${roomName}" 그룹이 생성되었습니다.`, 'system');
    }

    console.log(`[group create] ${roomName} → ${roomId}, participants: ${participants.join(', ')}`);
    socket.emit('group_created', { roomId, roomName });

    // Notify all participants
    participants.forEach(p => broadcastRoomList(p));
  });

  // Get room list for user
  socket.on('get_rooms', ({ userId }) => {
    broadcastRoomList(userId);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const { roomId, userId } = socket.data;
    if (roomId && userId) {
      const leaveMsg = addMessage(roomId, 'system', `${userId}님이 퇴장했습니다.`, 'system');
      socket.to(roomId).emit('chat_message', leaveMsg);
      console.log(`[leave] ${userId} X ${roomId}`);
    }
    console.log(`[disconnect] ${socket.id}`);
  });
});

// Helper: send updated room list to a user
function broadcastRoomList(userId) {
  const userRooms = [];
  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.participants.includes(userId)) {
      const lastMsg = room.messages.length > 0 ? room.messages[room.messages.length - 1] : null;
      userRooms.push({
        roomId,
        type: room.type,
        name: room.name,
        participants: room.participants,
        lastMessage: lastMsg ? lastMsg.text.slice(0, 50) : null,
        lastTime: lastMsg ? lastMsg.timestamp : null,
        unread: 0
      });
    }
  }
  io.emit('rooms_updated', userRooms);
}

// ============ Start ============

server.listen(PORT, () => {
  console.log(`🚀 Kakao-style Chat Server running on http://localhost:${PORT}`);
  console.log(`   Login:  http://localhost:${PORT}/`);
  console.log(`   Rooms:  http://localhost:${PORT}/rooms`);
  console.log(`   Chat:   http://localhost:${PORT}/chat/:roomId`);
});
