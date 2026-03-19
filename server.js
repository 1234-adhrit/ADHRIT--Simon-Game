const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const INDEX_PATH = path.join(__dirname, "index.html");

const server = http.createServer((req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  const url = req.url.split("?")[0];
  if (url === "/" || url === "/index.html") {
    fs.readFile(INDEX_PATH, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end("Server error");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();
const roomClients = new Map();

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(roomId, payload) {
  const clients = roomClients.get(roomId);
  if (!clients) return;
  const message = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function sanitizeName(name) {
  return String(name || "").trim().slice(0, 16);
}

function sanitizeChat(text) {
  return String(text || "").trim().slice(0, 120);
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createRoomCode() {
  let code = randomCode();
  while (rooms.has(code)) {
    code = randomCode();
  }
  return code;
}

function ensureScoreboard(room, playerId, name) {
  if (!room.scoreboard[playerId]) {
    room.scoreboard[playerId] = { id: playerId, name, best: 0 };
  } else {
    room.scoreboard[playerId].name = name;
  }
}

function activeCount(room) {
  return room.players.filter((player) => player.status === "active").length;
}

function getActiveIndex(room) {
  if (!room.players.length) return -1;
  const idx = Math.min(room.turnIndex || 0, room.players.length - 1);
  if (room.players[idx] && room.players[idx].status === "active") return idx;
  return room.players.findIndex((player) => player.status === "active");
}

function setNextTurn(room) {
  const active = activeCount(room);
  if (active <= 1) {
    room.stage = "over";
    room.replayIndex = 0;
    return;
  }

  const currentIndex = getActiveIndex(room);
  const startIndex = currentIndex >= 0 ? currentIndex : 0;
  let nextIndex = startIndex;

  for (let i = 1; i <= room.players.length; i += 1) {
    const probe = (startIndex + i) % room.players.length;
    if (room.players[probe].status === "active") {
      nextIndex = probe;
      break;
    }
  }

  room.turnIndex = nextIndex;
  room.stage = "replay";
  room.replayIndex = 0;
  room.turnCounter += 1;
}

function broadcastState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.updatedAt = Date.now();
  broadcast(roomId, { type: "state", room });
}

function addClientToRoom(ws, roomId) {
  if (!roomClients.has(roomId)) {
    roomClients.set(roomId, new Set());
  }
  roomClients.get(roomId).add(ws);
  ws.roomId = roomId;
}

function removeClientFromRoom(ws) {
  const roomId = ws.roomId;
  if (!roomId) return;
  const clients = roomClients.get(roomId);
  if (clients) {
    clients.delete(ws);
    if (clients.size === 0) {
      roomClients.delete(roomId);
    }
  }
  ws.roomId = null;
}

function removeSpectator(room, playerId) {
  if (!room || !room.spectators) return;
  room.spectators = room.spectators.filter((spectator) => spectator.id !== playerId);
}

function handleLeave(ws) {
  const roomId = ws.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  removeClientFromRoom(ws);
  if (!room) return;

  if (ws.role === "spectator") {
    removeSpectator(room, ws.playerId);
  }

  if (ws.role === "player") {
    const player = room.players.find((p) => p.id === ws.playerId);
    if (player && player.status !== "left") {
      const activeIdx = getActiveIndex(room);
      const wasActive = activeIdx >= 0 && room.players[activeIdx].id === player.id;
      player.status = "left";

      if (room.hostId === player.id) {
        const nextHost = room.players.find((p) => p.status === "active");
        if (nextHost) room.hostId = nextHost.id;
      }

      if (wasActive && room.stage !== "over") {
        setNextTurn(room);
      }
    }
  }

  ws.role = null;
  ws.playerId = null;
  ws.name = null;

  broadcastState(roomId);

  const noPlayers = activeCount(room) === 0;
  const noSpectators = !room.spectators || room.spectators.length === 0;
  const clients = roomClients.get(roomId);
  if (noPlayers && noSpectators && (!clients || clients.size === 0)) {
    rooms.delete(roomId);
    roomClients.delete(roomId);
  }
}

wss.on("connection", (ws) => {
  ws.roomId = null;
  ws.playerId = null;
  ws.role = null;
  ws.name = null;

  ws.on("message", (data) => {
    let message = null;
    try {
      message = JSON.parse(data);
    } catch (err) {
      return;
    }

    if (message.type === "create") {
      const name = sanitizeName(message.name);
      if (!name) {
        send(ws, { type: "error", message: "Name is required." });
        return;
      }

      if (ws.roomId) {
        handleLeave(ws);
      }

      const playerId = String(message.playerId || `p-${Math.random().toString(36).slice(2, 8)}`);
      ws.playerId = playerId;
      ws.role = "player";
      ws.name = name;

      const roomId = createRoomCode();
      const room = {
        id: roomId,
        hostId: playerId,
        players: [{ id: playerId, name, status: "active" }],
        spectators: [],
        scoreboard: {},
        chat: [],
        sequence: [],
        stage: "add",
        turnIndex: 0,
        replayIndex: 0,
        turnCounter: 0,
        updatedAt: Date.now(),
      };

      ensureScoreboard(room, playerId, name);

      rooms.set(roomId, room);
      addClientToRoom(ws, roomId);
      broadcastState(roomId);
      return;
    }

    if (message.type === "join") {
      const name = sanitizeName(message.name);
      const roomId = String(message.code || "").trim().toUpperCase();
      const spectator = Boolean(message.spectator);
      if (!name) {
        send(ws, { type: "error", message: "Name is required." });
        return;
      }
      if (!roomId) {
        send(ws, { type: "error", message: "Room code is required." });
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        send(ws, { type: "error", message: "Room not found." });
        return;
      }

      if (ws.roomId && ws.roomId !== roomId) {
        handleLeave(ws);
      }

      const playerId = String(message.playerId || `p-${Math.random().toString(36).slice(2, 8)}`);
      ws.playerId = playerId;
      ws.name = name;
      addClientToRoom(ws, roomId);

      if (spectator) {
        ws.role = "spectator";
        removeSpectator(room, playerId);
        const existingPlayer = room.players.find((player) => player.id === playerId);
        if (existingPlayer && existingPlayer.status !== "left") {
          const activeIdx = getActiveIndex(room);
          const wasActive = activeIdx >= 0 && room.players[activeIdx].id === playerId;
          existingPlayer.status = "left";
          if (room.hostId === playerId) {
            const nextHost = room.players.find((player) => player.status === "active");
            if (nextHost) room.hostId = nextHost.id;
          }
          if (wasActive && room.stage !== "over") {
            setNextTurn(room);
          }
        }
        room.spectators.push({ id: playerId, name });
      } else {
        ws.role = "player";
        removeSpectator(room, playerId);
        const existing = room.players.find((player) => player.id === playerId);
        if (existing) {
          existing.name = name;
          if (existing.status === "left") {
            existing.status = "active";
          }
        } else {
          room.players.push({ id: playerId, name, status: "active" });
        }
        ensureScoreboard(room, playerId, name);
      }

      if (getActiveIndex(room) === -1 && activeCount(room) > 0) {
        room.turnIndex = room.players.findIndex((player) => player.status === "active");
      }

      broadcastState(roomId);
      return;
    }

    if (message.type === "leave") {
      handleLeave(ws);
      return;
    }

    if (message.type === "reset") {
      if (!ws.roomId) return;
      const room = rooms.get(ws.roomId);
      if (!room) return;
      if (room.hostId !== ws.playerId) {
        send(ws, { type: "error", message: "Only the host can reset." });
        return;
      }

      room.sequence = [];
      room.stage = "add";
      room.replayIndex = 0;
      room.turnCounter = 0;
      room.players.forEach((player) => {
        if (player.status !== "left") {
          player.status = "active";
        }
      });

      const activeIdx = getActiveIndex(room);
      if (activeIdx >= 0) {
        room.turnIndex = activeIdx;
      }

      broadcastState(room.id);
      return;
    }

    if (message.type === "chat") {
      if (!ws.roomId) return;
      const room = rooms.get(ws.roomId);
      if (!room) return;
      const text = sanitizeChat(message.text);
      if (!text) return;
      const name = ws.name || "Player";
      room.chat.push({
        id: ws.playerId || "unknown",
        name,
        text,
        time: Date.now(),
      });
      if (room.chat.length > 50) {
        room.chat.shift();
      }
      broadcastState(room.id);
      return;
    }

    if (message.type === "input") {
      if (!ws.roomId) return;
      const room = rooms.get(ws.roomId);
      if (!room || room.stage === "over") return;

      const activeIdx = getActiveIndex(room);
      if (activeIdx === -1) return;
      const activePlayer = room.players[activeIdx];
      if (activePlayer.id !== ws.playerId || activePlayer.status !== "active") return;

      const color = String(message.color || "");

      if (room.stage === "replay") {
        const expected = room.sequence[room.replayIndex];
        if (color !== expected) {
          activePlayer.status = "out";
          setNextTurn(room);
        } else {
          room.replayIndex += 1;
          if (room.replayIndex >= room.sequence.length) {
            ensureScoreboard(room, activePlayer.id, activePlayer.name);
            const entry = room.scoreboard[activePlayer.id];
            entry.best = Math.max(entry.best || 0, room.sequence.length);
            room.stage = "add";
            room.replayIndex = 0;
          }
        }
      } else if (room.stage === "add") {
        room.sequence.push(color);
        setNextTurn(room);
      }

      broadcastState(room.id);
    }
  });

  ws.on("close", () => {
    handleLeave(ws);
  });
});

server.listen(PORT, () => {
  console.log(`Simon Arena server running on port ${PORT}`);
});
