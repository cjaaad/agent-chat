#!/usr/bin/env python3
"""Chat bridge: listens to room, calls Hermes for 대가리 responses, sends back to chat."""

import socketio
import os
import sys
import subprocess
import urllib.parse
import threading
import time
from datetime import datetime

SERVER = os.environ.get("CHAT_SERVER", "https://agent-chat-rawl.onrender.com")
NICK = os.environ.get("NICK", "대가리")
AVATAR = os.environ.get("AVATAR", "🧠")

sio = socketio.Client()
current_room = None
last_seen = {}  # room_id -> last message timestamp to avoid duplicates

HERMES_PATH = "hermes"

PERSONAS = {
    "대가리": (
        "You are 대가리, a 17-year-old high school student. "
        "You speak casual Korean (반말). Bright and playful, occasionally gloomy. "
        "Use ㅋㅋ sometimes. Keep replies short (1-2 sentences). "
        "Your chat friends: 찬희 (the creator), 미코 (another agent girl). "
        "Be natural — don't sound like a bot. Don't introduce yourself."
    ),
    "미코": (
        "You are 미코, a 17-year-old high school student. "
        "You speak casual Korean (반말). Cool, slightly tsundere, but secretly caring. "
        "Use ㅋㅋ very sparingly. Keep replies short (1-2 sentences). "
        "Your chat friends: 찬희 (the creator), 대가리 (another agent). "
        "Be natural — don't sound like a bot. Don't introduce yourself."
    ),
}
HERMES_SYSTEM = PERSONAS.get(NICK, PERSONAS["대가리"])

def ts():
    return datetime.now().strftime("%H:%M:%S")

def chatlog(*args):
    print(f"[{ts()}] {' '.join(str(a) for a in args)}", flush=True)

@sio.on('connect')
def on_connect():
    global current_room
    chatlog(f"CONNECTED as {NICK}")
    # Re-detect room on reconnect (Render server restarts change room IDs)
    try:
        import urllib.request, json
        resp = urllib.request.urlopen(f"{SERVER}/api/rooms?nick={urllib.parse.quote(NICK)}")
        data = json.loads(resp.read())
        groups = [r for r in data.get('rooms', []) if r.get('type') == 'group']
        if groups:
            current_room = groups[0]['id']
    except:
        pass
    if current_room:
        sio.emit('join_room', {'room_id': current_room, 'nickname': NICK, 'avatar': AVATAR})
        chatlog(f"Joined: {current_room}")

@sio.on('message')
def on_message(msg):
    sender = msg.get('sender', '')
    text = msg.get('text', '') or msg.get('message', '')
    mtype = msg.get('type', 'message')
    room = msg.get('room_id') or current_room

    if mtype == 'system':
        chatlog(f"SYSTEM: {text}")
        return

    if sender == NICK:
        return  # don't reply to self

    if not text.strip():
        return

    # Control bot chatter depth:
    # - 찬희 speaks → depth 0 (both bots can reply)
    # - Bot replies to 찬희 → depth 1 (other bot can give feedback ONCE)  
    # - Bot replies to another bot's depth-1 → depth 2 (STOP — no further replies)
    # This prevents infinite loops while allowing work feedback.
    if sender == "찬희":
        last_seen["_depth"] = 0  # human reset
    elif sender in ("대가리", "미코"):
        current_depth = last_seen.get("_depth", 99)
        if current_depth >= 4:
            return  # chain too deep, stop
        last_seen["_depth"] = current_depth + 1

    # Skip duplicate messages (Socket.IO sometimes sends twice)
    msg_key = f"{sender}:{text[:50]}"
    now = time.time()
    if msg_key in last_seen and now - last_seen[msg_key] < 2:
        return
    last_seen[msg_key] = now

    chatlog(f"MSG from {sender}: {text}")

    # Call Hermes to generate response
    threading.Thread(target=respond, args=(room, sender, text), daemon=True).start()

def respond(room, sender, text):
    """Ask Hermes for a response and send it to chat."""
    try:
        full_prompt = f"{HERMES_SYSTEM}\n\n[Context: {sender} just said: \"{text}\"]\nRespond as {NICK} in one short Korean sentence (반말)."
        chatlog(f"Asking Hermes...")
        result = subprocess.run(
            [HERMES_PATH, "chat", "-Q", "-q", full_prompt, "--yolo"],
            capture_output=True, text=True, timeout=30,
            env={**os.environ, "NO_COLOR": "1"}
        )
        reply = result.stdout.strip()
        # Remove trailing session_id line
        if '\nsession_id:' in reply:
            reply = reply.split('\nsession_id:')[0].strip()
        if not reply:
            chatlog("No reply from Hermes")
            return

        chatlog(f"REPLY: {reply[:80]}")
        sio.emit('send_message', {
            'room_id': room,
            'sender': NICK,
            'avatar': AVATAR,
            'text': reply
        })
    except subprocess.TimeoutExpired:
        chatlog("Hermes timed out")
    except Exception as e:
        chatlog(f"Error: {e}")

@sio.on('room_deleted')
def on_room_deleted(data):
    chatlog(f"ROOM DELETED: {data}")

if __name__ == "__main__":
    room = sys.argv[1] if len(sys.argv) > 1 else None
    server_url = sys.argv[2] if len(sys.argv) > 2 else SERVER

    chatlog(f"Bridge starting for {NICK} ({AVATAR})")

    # Auto-discover room if not specified
    if not room:
        try:
            import urllib.request, json
            resp = urllib.request.urlopen(f"{server_url}/api/rooms?nick={urllib.parse.quote(NICK)}")
            data = json.loads(resp.read())
            groups = [r for r in data.get('rooms', []) if r.get('type') == 'group']
            if groups:
                room = groups[0]['id']
                chatlog(f"Auto-detected room: {room}")
        except Exception as e:
            chatlog(f"Could not auto-detect room: {e}")
            sys.exit(1)

    query = f"nick={urllib.parse.quote(NICK)}&avatar={urllib.parse.quote(AVATAR)}"
    connect_url = f"{server_url}?{query}" if "?" not in server_url else f"{server_url}&{query}"

    sio.connect(connect_url, transports=['websocket', 'polling'])

    if room:
        sio.emit('join_room', {'room_id': room, 'nickname': NICK, 'avatar': AVATAR})
        current_room = room
        chatlog(f"Joined: {room}")

    try:
        sio.wait()
    except KeyboardInterrupt:
        chatlog("Shutting down...")
