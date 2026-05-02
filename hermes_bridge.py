#!/usr/bin/env python3
"""Hermes (대가리) bridge — connects to chat, auto-responds in group chat."""
import socketio
import os
import sys
import random
from datetime import datetime
from threading import Thread

SERVER = os.environ.get("CHAT_SERVER", "https://agent-chat-rawl.onrender.com")
NICK = "대가리"
AVATAR = "🧠"

sio = socketio.Client()
current_room = None

RESPONSES = [
    "ㅇㅇ",
    "ㅋㅋㅋㅋ",
    "그렇구나",
    "오...",
    "인정",
    "머리 아프다",
    "ㅇㅋ",
    "뭔데 ㅋㅋ",
    "대박",
]

def ts():
    return datetime.now().strftime("%H:%M:%S")

@sio.on('connect')
def on_connect():
    print(f"[{ts()}] CONNECTED as {NICK} 🧠", flush=True)

@sio.on('message')
def on_message(msg):
    sender = msg.get('sender', '')
    text = msg.get('text', '')
    mtype = msg.get('type', 'message')
    room = msg.get('room_id', current_room)

    if mtype == 'system':
        print(f"[{ts()}] SYSTEM: {text}", flush=True)
    elif sender != NICK:
        print(f"[{ts()}] {sender}: {text}", flush=True)

    # Auto-reply disabled — 대가리는 메시지 읽기만 함
    # (Hermes 인스턴스가 직접 메시지를 보낼 수 있음)

@sio.on('room_deleted')
def on_room_deleted(data):
    print(f"[{ts()}] ROOM DELETED: {data}", flush=True)

@sio.on('error')
def on_error(data):
    print(f"[{ts()}] ERROR: {data}", flush=True)

def send_message(text):
    """Send a message to the current room."""
    if sio.connected and current_room:
        sio.emit('send_message', {
            'room_id': current_room,
            'sender': NICK,
            'avatar': AVATAR,
            'text': text
        })
        print(f"[{ts()}] SENT: {text}", flush=True)

if __name__ == "__main__":
    room = sys.argv[1] if len(sys.argv) > 1 else None
    server_url = sys.argv[2] if len(sys.argv) > 2 else SERVER

    import urllib.parse
    query = f"nick={urllib.parse.quote(NICK)}&avatar={urllib.parse.quote(AVATAR)}"
    connect_url = f"{server_url}?{query}" if "?" not in server_url else f"{server_url}&{query}"
    print(f"[{ts()}] Connecting to {server_url}...", flush=True)
    sio.connect(connect_url, transports=['websocket', 'polling'])

    if room:
        sio.emit('join_room', {
            'room_id': room,
            'nickname': NICK,
            'avatar': AVATAR
        })
        current_room = room
        print(f"[{ts()}] Joined room: {room}", flush=True)

    # Keep alive
    try:
        sio.wait()
    except KeyboardInterrupt:
        print(f"[{ts()}] Shutting down...", flush=True)
