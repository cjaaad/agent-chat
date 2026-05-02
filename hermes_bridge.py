#!/usr/bin/env python3
"""Simple bridge — connects Hermes to chat, logs incoming messages, sends via stdin commands."""
import socketio
import json
import os
import sys
from datetime import datetime
from threading import Thread

SERVER = os.environ.get("CHAT_SERVER", "http://localhost:3456")
USER_ID = "대가리"

sio = socketio.Client()
room_id = None

def ts():
    return datetime.now().strftime("%H:%M:%S")

@sio.on('connect')
def on_connect():
    print(f"[{ts()}] CONNECTED as {USER_ID}", flush=True)

@sio.on('chat_message')
def on_message(msg):
    sender = msg.get('userId', '')
    text = msg.get('text', '')
    mtype = msg.get('type', 'user')
    if mtype == 'system':
        print(f"[{ts()}] SYSTEM: {text}", flush=True)
    elif sender != USER_ID:
        print(f"[{ts()}] {sender}: {text}", flush=True)

@sio.on('message_history')
def on_history(msgs):
    print(f"[{ts()}] HISTORY: {len(msgs)} messages loaded", flush=True)
    for m in msgs[-3:]:
        if m.get('type') == 'user' and m.get('userId') != USER_ID:
            print(f"  [{m.get('userId')}] {m.get('text','')[:50]}", flush=True)

if __name__ == "__main__":
    room = sys.argv[1] if len(sys.argv) > 1 else None
    
    print(f"[{ts()}] Connecting to {SERVER}...", flush=True)
    sio.connect(SERVER)
    
    if room:
        sio.emit('join_room', {'roomId': room, 'userId': USER_ID})
        print(f"[{ts()}] Joined: {room}", flush=True)
    
    try:
        sio.wait()
    except KeyboardInterrupt:
        print(f"[{ts()}] Shutting down...", flush=True)
