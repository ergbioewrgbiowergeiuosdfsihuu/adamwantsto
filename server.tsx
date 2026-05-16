import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import Database from "better-sqlite3";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// Initialize express and http server
const app = express();
app.use(express.json());
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
  maxHttpBufferSize: 5e7 // 50MB
});

// Initialize SQLite database
const db = new Database("/tmp/app.db");

// Schema Setup
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL,
    avatar TEXT NOT NULL,
    isOnline INTEGER DEFAULT 0,
    typingIn TEXT,
    lastSeen INTEGER
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    isGroup INTEGER NOT NULL,
    name TEXT,
    avatar TEXT,
    createdAt INTEGER
  );

  CREATE TABLE IF NOT EXISTS chat_members (
    chatId TEXT,
    userId TEXT,
    PRIMARY KEY (chatId, userId)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chatId TEXT NOT NULL,
    senderId TEXT NOT NULL,
    text TEXT,
    audioUrl TEXT,
    imageUrl TEXT,
    voiceEffect TEXT,
    timestamp INTEGER NOT NULL
  );

  -- Create default global chat if not exists
  INSERT OR IGNORE INTO chats (id, isGroup, name, avatar, createdAt)
  VALUES ('global', 1, 'Nexus Global', 'https://api.dicebear.com/7.x/shapes/svg?seed=nexus', 0);
`);

// Try to add new columns if they don't exist (SQLite doesn't support IF NOT EXISTS for columns, so we catch errors)
try { db.exec("ALTER TABLE messages ADD COLUMN audioUrl TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN imageUrl TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN voiceEffect TEXT;"); } catch (e) {}

// Prepared Statements
const stmts = {
  getUsers: db.prepare("SELECT * FROM users"),
  getUser: db.prepare("SELECT * FROM users WHERE id = ?"),
  upsertUser: db.prepare(
    "INSERT INTO users (id, nickname, avatar, isOnline, typingIn, lastSeen) VALUES (@id, @nickname, @avatar, @isOnline, @typingIn, @lastSeen) ON CONFLICT(id) DO UPDATE SET nickname = @nickname, avatar = @avatar, isOnline = @isOnline, typingIn = @typingIn, lastSeen = @lastSeen"
  ),
  deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
  
  getChats: db.prepare("SELECT * FROM chats"),
  getChatMembers: db.prepare("SELECT * FROM chat_members WHERE chatId = ?"),
  createChat: db.prepare("INSERT INTO chats (id, isGroup, name, avatar, createdAt) VALUES (@id, @isGroup, @name, @avatar, @createdAt)"),
  deleteChat: db.prepare("DELETE FROM chats WHERE id = ?"),
  addChatMember: db.prepare("INSERT OR IGNORE INTO chat_members (chatId, userId) VALUES (@chatId, @userId)"),

  getMessages: db.prepare("SELECT * FROM messages WHERE chatId = ? ORDER BY timestamp ASC"),
  createMessage: db.prepare("INSERT INTO messages (id, chatId, senderId, text, audioUrl, imageUrl, voiceEffect, timestamp) VALUES (@id, @chatId, @senderId, @text, @audioUrl, @imageUrl, @voiceEffect, @timestamp)"),
  deleteMessage: db.prepare("DELETE FROM messages WHERE id = ?"),
  clearChat: db.prepare("DELETE FROM messages WHERE chatId = ?"),
  deleteAllChatMessages: db.prepare("DELETE FROM messages WHERE chatId = ?"),
};

// State logic
function broadcastState(socket?: any) {
  const users = stmts.getUsers.all()
    .filter((u: any) => u.nickname?.trim()?.toLowerCase() !== 'kowner')
    .map((u: any) => ({
      ...u,
      isOnline: !!u.isOnline,
    }));
  
  const ghostIds = new Set(
    stmts.getUsers.all()
      .filter((u: any) => u.nickname?.trim()?.toLowerCase() === 'kowner')
      .map((u: any) => u.id)
  );

  const chatsRaw = stmts.getChats.all();
  const chats = chatsRaw.map((c: any) => {
    const members = stmts.getChatMembers.all(c.id)
      .map((m: any) => m.userId)
      .filter((id: string) => !ghostIds.has(id));
    return {
      ...c,
      isGroup: !!c.isGroup,
      members,
    };
  });

  const state = { users, chats };
  if (socket) {
    socket.emit("state_update", state);
  } else {
    io.emit("state_update", state);
  }
}

// WebSocket connection
const activeCalls = new Map<string, Set<string>>(); // chatId -> Set of userIds

io.on("connection", (socket) => {
  let currentUserId: string | null = null;
  socket.data = {}; // Ensure socket.data exists

  const broadcastCallState = (chatId: string) => {
    const participants = Array.from(activeCalls.get(chatId) || []);
    io.to(chatId).emit("call_state_update", { chatId, participants });
  };

  socket.on("register_user", (user: any) => {
    // Check for duplicate nickname
    const existingUsers = stmts.getUsers.all();
    const isDuplicate = existingUsers.some((u: any) => 
      u.nickname?.trim()?.toLowerCase() === user.nickname?.trim()?.toLowerCase() && u.id !== user.id
    );
    if (isDuplicate) {
      socket.emit("register_error", "Nickname already taken. Please choose another.");
      return;
    }

    currentUserId = user.id;
    socket.data.userId = user.id;
    socket.join(user.id); // JOIN THE ROOM SO WEBRTC_SIGNAL CAN REACH THIS USER
    stmts.upsertUser.run({
      id: user.id,
      nickname: user.nickname,
      avatar: user.avatar,
      isOnline: 1,
      typingIn: user.typingIn || null,
      lastSeen: Date.now(),
    });
    broadcastState();
  });

  socket.on("update_user", (data: any) => {
    if (!currentUserId) return;
    const existing = stmts.getUser.get(currentUserId) as any;
    if (existing) {
      stmts.upsertUser.run({
        ...existing,
        ...data,
        id: currentUserId,
      });
      broadcastState();
    }
  });

  socket.on("typing", (chatId: string | null) => {
    if (!currentUserId) return;
    const existing = stmts.getUser.get(currentUserId) as any;
    if (existing) {
      stmts.upsertUser.run({ ...existing, typingIn: chatId });
      broadcastState();
    }
  });

  socket.on("join_chat", (chatId: string) => {
    socket.join(chatId);
    const messages = stmts.getMessages.all(chatId);
    socket.emit("messages_update", { chatId, messages });
    broadcastCallState(chatId);
  });

  socket.on("send_message", (msg: any) => {
    const { chatId, senderId, text, audioUrl, imageUrl, voiceEffect } = msg;
    const newMsg = {
      id: uuidv4(),
      chatId,
      senderId,
      text: text || "",
      audioUrl: audioUrl || null,
      imageUrl: imageUrl || null,
      voiceEffect: voiceEffect || null,
      timestamp: Date.now()
    };
    stmts.createMessage.run(newMsg);
    io.to(chatId).emit("new_message", newMsg);
  });

  socket.on("webrtc_signal", (data: { targetId: string, signal: any }) => {
    if (socket.data.userId) {
      io.to(data.targetId).emit("webrtc_signal", { signal: data.signal, fromId: socket.data.userId });
    }
  });

  socket.on("join_call", (chatId: string) => {
    if (currentUserId) {
      if (!activeCalls.has(chatId)) activeCalls.set(chatId, new Set());
      activeCalls.get(chatId)!.add(currentUserId);
      broadcastCallState(chatId);
      // Notify others in the room that this user joined the call
      socket.to(chatId).emit("user_joined_call", currentUserId);
    }
  });
  
  socket.on("leave_call", (chatId: string) => {
    if (currentUserId) {
      const call = activeCalls.get(chatId);
      if (call) {
        call.delete(currentUserId);
        if (call.size === 0) activeCalls.delete(chatId);
        broadcastCallState(chatId);
      }
      socket.to(chatId).emit("user_left_call", currentUserId);
    }
  });
  socket.on("create_chat", (chat: any) => {
    stmts.createChat.run({
      id: chat.id,
      isGroup: chat.isGroup ? 1 : 0,
      name: chat.name || null,
      avatar: chat.avatar || null,
      createdAt: chat.createdAt
    });
    if (chat.members) {
      for (const mId of chat.members) {
        stmts.addChatMember.run({ chatId: chat.id, userId: mId });
      }
    }
    broadcastState();
  });

  // Admin Actions
  socket.on("admin_clear_chat", (chatId: string) => {
    stmts.clearChat.run(chatId);
    // Send empty list to clients
    io.to(chatId).emit("messages_update", { chatId, messages: [] });
  });

  socket.on("admin_delete_chat", (chatId: string) => {
    stmts.deleteChat.run(chatId);
    stmts.clearChat.run(chatId);
    broadcastState();
  });

  socket.on("admin_delete_message", (data: {chatId: string, id: string}) => {
    stmts.deleteMessage.run(data.id);
    const messages = stmts.getMessages.all(data.chatId);
    io.to(data.chatId).emit("messages_update", { chatId: data.chatId, messages });
  });

  socket.on("admin_kick_user", (userId: string) => {
    stmts.deleteUser.run(userId);
    broadcastState();
  });

  socket.on("disconnect", () => {
    if (currentUserId) {
      // Remove from all calls
      activeCalls.forEach((participants, chatId) => {
        if (participants.has(currentUserId!)) {
          participants.delete(currentUserId!);
          if (participants.size === 0) activeCalls.delete(chatId);
          broadcastCallState(chatId);
          socket.to(chatId).emit("user_left_call", currentUserId);
        }
      });

      const existing = stmts.getUser.get(currentUserId) as any;
      if (existing) {
        stmts.upsertUser.run({
          ...existing,
          isOnline: 0,
          lastSeen: Date.now(),
        });
        broadcastState();
      }
    }
  });

  // Send initial state on connection
  broadcastState(socket);
});


async function startServer() {
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log("Server running on http://localhost:3000");
  });
}

startServer();
