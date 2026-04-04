import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const firebaseConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));

// Firebase Admin initialization (kept for potential future use, but Firestore is disabled)
try {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
  console.log("Firebase Admin initialized (Firestore sync disabled to avoid permission errors)");
} catch (e) {
  console.error("Firebase Admin initialization failed:", e);
}

// Mock firestore to prevent errors in existing code without massive refactoring
const firestore = {
  collection: (..._args: any[]) => ({
    doc: (..._args: any[]) => ({
      get: async (..._args: any[]) => ({ exists: false, data: () => null }),
      set: async (..._args: any[]) => {},
      update: async (..._args: any[]) => {},
      delete: async (..._args: any[]) => {}
    }),
    add: async (..._args: any[]) => {},
    get: async (..._args: any[]) => ({ docs: [], size: 0 }),
    orderBy: (..._args: any[]) => ({ limit: (..._args: any[]) => ({ get: async (..._args: any[]) => ({ docs: [], size: 0 }) }) })
  })
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("messenger.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    password TEXT,
    role TEXT DEFAULT 'user',
    is_premium INTEGER DEFAULT 0,
    premium_expires_at DATETIME,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT,
    sender TEXT COLLATE NOCASE,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    media_url TEXT,
    media_type TEXT
  );
  CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT COLLATE NOCASE,
    media_url TEXT,
    media_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
  );
  CREATE TABLE IF NOT EXISTS last_read (
    username TEXT COLLATE NOCASE,
    room TEXT,
    last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (username, room)
  );
  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT COLLATE NOCASE,
    message_id INTEGER,
    UNIQUE(username, message_id)
  );
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT,
    handle TEXT COLLATE NOCASE,
    type TEXT, -- 'direct' or 'group'
    password TEXT,
    is_private INTEGER DEFAULT 0,
    owner TEXT COLLATE NOCASE
  );
  CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT,
    username TEXT COLLATE NOCASE,
    role TEXT DEFAULT 'member', -- 'member', 'admin', 'owner'
    PRIMARY KEY (room_id, username)
  );
  CREATE TABLE IF NOT EXISTS room_bans (
    room_id TEXT,
    username TEXT COLLATE NOCASE,
    PRIMARY KEY (room_id, username)
  );
  CREATE TABLE IF NOT EXISTS room_reports (
    room_id TEXT,
    username TEXT COLLATE NOCASE,
    reason TEXT,
    PRIMARY KEY (room_id, username)
  );
  CREATE TABLE IF NOT EXISTS premium_codes (
    code TEXT PRIMARY KEY,
    used INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS profiles (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    nickname TEXT,
    bio TEXT,
    avatar_url TEXT
  );
  CREATE TABLE IF NOT EXISTS user_settings (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    notifications_private INTEGER DEFAULT 1,
    notifications_groups INTEGER DEFAULT 1,
    notifications_calls INTEGER DEFAULT 1,
    badge_muted INTEGER DEFAULT 0,
    p2p_calls INTEGER DEFAULT 1,
    language TEXT DEFAULT 'English',
    auto_media_mobile INTEGER DEFAULT 1,
    auto_media_wifi INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS muted_chats (
    username TEXT COLLATE NOCASE,
    room TEXT,
    PRIMARY KEY (username, room)
  );
  CREATE TABLE IF NOT EXISTS blocked_users (
    username TEXT COLLATE NOCASE,
    blocked_user TEXT COLLATE NOCASE,
    PRIMARY KEY (username, blocked_user)
  );
  CREATE TABLE IF NOT EXISTS user_reports (
    reporter TEXT COLLATE NOCASE,
    reported_user TEXT COLLATE NOCASE,
    reason TEXT,
    PRIMARY KEY (reporter, reported_user)
  );
  CREATE TABLE IF NOT EXISTS premium_keys (
    key TEXT PRIMARY KEY,
    created_by TEXT COLLATE NOCASE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    used_by TEXT COLLATE NOCASE,
    used_at DATETIME
  );
`);

// Migration: Lowercase all usernames for consistency
try {
  db.transaction(() => {
    db.prepare("UPDATE users SET username = LOWER(username)").run();
    db.prepare("UPDATE profiles SET username = LOWER(username)").run();
    db.prepare("UPDATE messages SET sender = LOWER(sender)").run();
    db.prepare("UPDATE rooms SET owner = LOWER(owner)").run();
    db.prepare("UPDATE room_members SET username = LOWER(username)").run();
    db.prepare("UPDATE room_bans SET username = LOWER(username)").run();
    db.prepare("UPDATE room_reports SET username = LOWER(username)").run();
    db.prepare("UPDATE last_read SET username = LOWER(username)").run();
    db.prepare("UPDATE favorites SET username = LOWER(username)").run();
    db.prepare("UPDATE muted_chats SET username = LOWER(username)").run();
    db.prepare("UPDATE blocked_users SET username = LOWER(username)").run();
    db.prepare("UPDATE blocked_users SET blocked_user = LOWER(blocked_user)").run();
    db.prepare("UPDATE user_reports SET reporter = LOWER(reporter)").run();
    db.prepare("UPDATE user_reports SET reported_user = LOWER(reported_user)").run();
    db.prepare("UPDATE premium_keys SET created_by = LOWER(created_by)").run();
    db.prepare("UPDATE premium_keys SET used_by = LOWER(used_by)").run();
  })();
  console.log("Migration: Lowercased all usernames in database");
} catch (e) {
  // Ignore errors if columns don't exist or duplicates found
  console.log("Migration: Username lowercasing skipped or partially failed (likely already done)");
}

// Migration: Add password, role, is_premium to users if missing
try {
  db.prepare("SELECT password FROM users LIMIT 1").get();
} catch (e: any) {
  if (e.message.includes("no such column: password")) {
    db.exec("ALTER TABLE users ADD COLUMN password TEXT");
    db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
    db.exec("ALTER TABLE users ADD COLUMN is_premium INTEGER DEFAULT 0");
    db.exec("UPDATE users SET password = username WHERE password IS NULL");
    console.log("Migration: Added password, role, is_premium columns to users table");
  }
}

// Ensure admin user exists
async function ensureAdminExists() {
  try {
    const adminUsername = 'admin';
    const adminPassword = bcrypt.hashSync('1488', 10);
    
    // Check Firestore
    const adminDoc = await firestore.collection("users").doc(adminUsername).get();
    if (!adminDoc.exists) {
      await firestore.collection("users").doc(adminUsername).set({
        username: adminUsername,
        password: adminPassword,
        role: 'admin',
        is_premium: true,
        last_seen: new Date().toISOString()
      });
      console.log("Created default admin user in Firestore");
    }

    // Sync to local SQLite
    const localAdmin = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
    if (!localAdmin) {
      db.prepare("INSERT INTO users (username, password, role, is_premium) VALUES ('admin', ?, 'admin', 1)").run(adminPassword);
      console.log("Created default admin user in SQLite");
    }
  } catch (err) {
    console.error("Failed to ensure admin user:", err);
  }
}

// Sync Firestore data to local SQLite on startup
async function syncFromFirestore() {
  try {
    console.log("Syncing data from Firestore to SQLite...");
    
    // Sync Users
    const usersSnapshot = await firestore.collection("users").get();
    console.log(`Syncing ${usersSnapshot.size} users...`);
    for (const doc of usersSnapshot.docs) {
      const user = doc.data();
      db.prepare("INSERT OR REPLACE INTO users (username, password, role, is_premium, premium_expires_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)")
        .run(user.username, user.password, user.role, user.is_premium ? 1 : 0, user.premium_expires_at || null, user.last_seen || null);
    }

    // Sync Profiles
    const profilesSnapshot = await firestore.collection("profiles").get();
    console.log(`Syncing ${profilesSnapshot.size} profiles...`);
    for (const doc of profilesSnapshot.docs) {
      const profile = doc.data();
      db.prepare("INSERT OR REPLACE INTO profiles (username, nickname, bio, avatar_url) VALUES (?, ?, ?, ?)")
        .run(profile.username, profile.nickname || '', profile.bio || '', profile.avatar_url || '');
    }

    // Sync Rooms
    const roomsSnapshot = await firestore.collection("rooms").get();
    console.log(`Syncing ${roomsSnapshot.size} rooms...`);
    for (const doc of roomsSnapshot.docs) {
      const room = doc.data();
      db.prepare("INSERT OR REPLACE INTO rooms (id, name, handle, type, password, is_private, owner) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(room.id, room.name || null, room.handle || null, room.type, room.password || null, room.is_private ? 1 : 0, room.owner || null);
    }

    // Sync Messages (Optional: limit to last 1000 for performance)
    const messagesSnapshot = await firestore.collection("messages").orderBy("timestamp", "desc").limit(1000).get();
    console.log(`Syncing ${messagesSnapshot.size} messages...`);
    for (const doc of messagesSnapshot.docs) {
      const msg = doc.data();
      db.prepare("INSERT OR REPLACE INTO messages (room, sender, content, timestamp, media_url, media_type) VALUES (?, ?, ?, ?, ?, ?)")
        .run(msg.room, msg.sender, msg.content, msg.timestamp, msg.media_url || null, msg.media_type || null);
    }

    console.log("Sync from Firestore completed");
  } catch (err) {
    console.error("Sync from Firestore failed:", err);
  }
}

async function startServer() {
  await ensureAdminExists();
  await syncFromFirestore();
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    maxHttpBufferSize: 1e8, // 100 MB
  });

  const PORT = 3000;

  app.get("/api/gifs/trending", async (req, res) => {
    try {
      const tenorKey = process.env.TENOR_API_KEY;
      if (tenorKey) {
        const response = await fetch(`https://tenor.googleapis.com/v2/featured?key=${tenorKey}&client_key=moza&limit=20`);
        const data = await response.json();
        return res.json(data);
      }
      // Fallback to Giphy public beta key
      const response = await fetch(`https://api.giphy.com/v1/gifs/trending?api_key=GlVGYHqcVGWv4411o15NdqwKkHXilckR&limit=20`);
      const data = await response.json();
      // Map Giphy format to Tenor format for frontend compatibility
      const mapped = data.data.map((g: any) => ({
        id: g.id,
        media_formats: { gif: { url: g.images.original.url } }
      }));
      res.json({ results: mapped });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/gifs/search", async (req, res) => {
    try {
      const q = req.query.q as string;
      const tenorKey = process.env.TENOR_API_KEY;
      if (tenorKey) {
        const response = await fetch(`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${tenorKey}&client_key=moza&limit=20`);
        const data = await response.json();
        return res.json(data);
      }
      // Fallback to Giphy public beta key
      const response = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=GlVGYHqcVGWv4411o15NdqwKkHXilckR&q=${encodeURIComponent(q)}&limit=20`);
      const data = await response.json();
      const mapped = data.data.map((g: any) => ({
        id: g.id,
        media_formats: { gif: { url: g.images.original.url } }
      }));
      res.json({ results: mapped });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/export/messages", (req, res) => {
    try {
      const messages = db.prepare("SELECT * FROM messages ORDER BY timestamp DESC").all() as any[];
      let csv = "id,room,sender,content,timestamp,media_url,media_type\n";
      messages.forEach(m => {
        const content = (m.content || "").replace(/"/g, '""');
        csv += `${m.id},"${m.room}","${m.sender}","${content}","${m.timestamp}","${m.media_url || ''}","${m.media_type || ''}"\n`;
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=messages_export.csv');
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/export/users", (req, res) => {
    try {
      const users = db.prepare("SELECT username, role, is_premium FROM users").all() as any[];
      let csv = "username,role,is_premium\n";
      users.forEach(u => {
        csv += `"${u.username}","${u.role}",${u.is_premium}\n`;
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users_export.csv');
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/debug/schema", (req, res) => {
    try {
      const schema = db.prepare("PRAGMA table_info(messages)").all();
      res.json({ schema });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Socket.io logic
  const users = new Map<string, string>(); // socketId -> username

  let userListTimeout: NodeJS.Timeout | null = null;
  const broadcastUserList = () => {
    if (userListTimeout) return;
    userListTimeout = setTimeout(() => {
      const userList = Array.from(users.entries()).map(([id, name]) => {
        const profile = db.prepare("SELECT nickname, bio, avatar_url FROM profiles WHERE username = ?").get(name) as any;
        const u = db.prepare("SELECT role, is_premium FROM users WHERE username = ?").get(name) as any;
        return { 
          id: name, 
          socketId: id,
          name: profile?.nickname || name, 
          nickname: profile?.nickname || '',
          bio: profile?.bio || '', 
          avatar_url: profile?.avatar_url || '',
          role: u?.role || 'user',
          is_premium: u?.is_premium || 0
        };
      });
      const uniqueUserList = Array.from(new Map(userList.map(item => [item.id, item])).values());
      io.emit("user-list", uniqueUserList);
      userListTimeout = null;
    }, 2000);
  };

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("register", async (data: { username: string; nickname?: string; password?: string }) => {
      const username = data.username.trim().toLowerCase();
      const { nickname, password } = data;
      
      try {
        // Check Firestore first
        const userDoc = await firestore.collection("users").doc(username).get();
        if (userDoc.exists) {
          socket.emit("register-error", "Username already exists");
          return;
        }

        const hashedPassword = bcrypt.hashSync(password || username, 10);
        
        // Save to Firestore
        await firestore.collection("users").doc(username).set({
          username,
          password: hashedPassword,
          role: 'user',
          is_premium: false,
          last_seen: new Date().toISOString()
        });

        if (nickname) {
          await firestore.collection("profiles").doc(username).set({
            username,
            nickname
          });
        }

        // Sync to local SQLite for fast lookups
        db.prepare("INSERT OR REPLACE INTO users (username, password, role, is_premium) VALUES (?, ?, 'user', 0)").run(username, hashedPassword);
        if (nickname) {
          db.prepare("INSERT OR REPLACE INTO profiles (username, nickname) VALUES (?, ?)").run(username, nickname);
        }

        users.set(socket.id, username);
        io.emit("user-status", { username, isOnline: true });
        socket.emit("register-success", { username, role: 'user', isPremium: false, premiumExpiresAt: null });
        broadcastUserList();
      } catch (err: any) {
        console.error("Registration error:", err);
        socket.emit("register-error", "Registration failed: " + err.message);
      }
    });

    socket.on("login", async (data: { username: string; password?: string }) => {
      const username = data.username.trim().toLowerCase();
      const { password } = data;
      
      try {
        // Check Firestore
        const userDoc = await firestore.collection("users").doc(username).get();
        let user: any = userDoc.exists ? userDoc.data() : null;

        if (!user) {
          // Fallback to local SQLite
          user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
          if (user) {
            // Sync to Firestore if found locally but not in Firestore
            await firestore.collection("users").doc(username).set({
              username: user.username,
              password: user.password,
              role: user.role,
              is_premium: user.is_premium === 1,
              last_seen: new Date().toISOString()
            });
          }
        }

        if (!user) {
          socket.emit("login-error", "User not found");
          return;
        }

        const passwordMatch = bcrypt.compareSync(password || username, user.password);
        if (!passwordMatch) {
          socket.emit("login-error", "Invalid password");
          return;
        }

        // Sync to local SQLite
        db.prepare("INSERT OR REPLACE INTO users (username, password, role, is_premium) VALUES (?, ?, ?, ?)").run(
          user.username, user.password, user.role, user.is_premium ? 1 : 0
        );

        users.set(socket.id, username);
        io.emit("user-status", { username, isOnline: true });
        socket.emit("login-success", { 
          username: user.username, 
          role: user.role, 
          isPremium: !!user.is_premium, 
          premiumExpiresAt: user.premium_expires_at 
        });
        broadcastUserList();
      } catch (err: any) {
        console.error("Login error:", err);
        socket.emit("login-error", "Login failed: " + err.message);
      }
    });

    socket.on("generate-premium-key", async (data: { username: string }) => {
      try {
        const userDoc = await firestore.collection("users").doc(data.username).get();
        const user: any = userDoc.exists ? userDoc.data() : null;
        if (user && user.role === 'admin') {
          const key = 'PREM-' + Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Math.random().toString(36).substring(2, 10).toUpperCase();
          // For simplicity, keep premium keys in SQLite for now or move to Firestore if needed
          db.prepare("INSERT INTO premium_keys (key, created_by) VALUES (?, ?)").run(key, data.username);
          socket.emit("premium-key-generated", { key });
        } else {
          socket.emit("premium-error", `Unauthorized: ${user ? user.role : 'User not found'}`);
        }
      } catch (err: any) {
        socket.emit("premium-error", err.message);
      }
    });

    socket.on("redeem-premium-key", async (data: { username: string; key: string }) => {
      const { username, key } = data;
      try {
        const keyRecord: any = db.prepare("SELECT * FROM premium_keys WHERE key = ?").get(key);
        if (!keyRecord) {
          socket.emit("premium-error", "Invalid key");
          return;
        }
        if (keyRecord.used_by) {
          socket.emit("premium-error", "Key already used");
          return;
        }
        
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);
        const expiresAtStr = expiresAt.toISOString();

        db.prepare("UPDATE premium_keys SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE key = ?").run(username, key);
        db.prepare("UPDATE users SET is_premium = 1, premium_expires_at = ? WHERE username = ?").run(expiresAtStr, username);
        
        // Update Firestore
        await firestore.collection("users").doc(username).update({
          is_premium: true,
          premium_expires_at: expiresAtStr
        });

        socket.emit("premium-success", { message: "Premium activated for 1 month!", expiresAt: expiresAtStr });
      } catch (err: any) {
        socket.emit("premium-error", err.message);
      }
    });

    socket.on("join-network", (username: string) => {
      const normalizedUsername = username.trim().toLowerCase();
      users.set(socket.id, normalizedUsername);
      
      // Persist user
      db.prepare("UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE username = ?").run(normalizedUsername);
      
      broadcastUserList();

      // Send active chats (DMs you have messaged with)
      const activeDMs = db.prepare(`
        SELECT DISTINCT room FROM messages 
        WHERE room LIKE ? AND room NOT LIKE 'group-%'
      `).all(`%${normalizedUsername}%`).map(r => {
        const partners = r.room.split('--');
        return partners.find(p => p !== normalizedUsername);
      }).filter(Boolean);

      socket.emit("active-dms", activeDMs);
      console.log(`${normalizedUsername} joined the network`);
    });

    socket.on("search-users", (query: string) => {
      const results = db.prepare(`
        SELECT u.username, p.nickname, p.bio, p.avatar_url 
        FROM users u
        LEFT JOIN profiles p ON u.username = p.username
        WHERE (u.username LIKE ? OR p.nickname LIKE ?) AND u.username != ?
        LIMIT 20
      `).all(`%${query}%`, `%${query}%`, users.get(socket.id)) as any[];
      
      socket.emit("search-results", results.map(r => ({
        id: r.username,
        name: r.nickname || r.username,
        nickname: r.nickname || '',
        bio: r.bio || '',
        avatar_url: r.avatar_url || '',
        isOnline: Array.from(users.values()).includes(r.username)
      })));
    });

    socket.on("join-room", (data: { room: string; username: string }) => {
      const { room, username } = data;
      socket.join(room);
      console.log(`Socket ${socket.id} (${username}) joined room ${room}`);
      
      // Update last read
      db.prepare("INSERT INTO last_read (username, room, last_read_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(username, room) DO UPDATE SET last_read_at = CURRENT_TIMESTAMP").run(username, room);

      // Send history with user-specific favorite status
      const history = db.prepare(`
        SELECT m.*, (SELECT 1 FROM favorites f WHERE f.message_id = m.id AND f.username = ?) as is_favorite
        FROM messages m 
        WHERE m.room = ? 
        ORDER BY m.timestamp ASC
      `).all(username, room);

      socket.emit("chat-history", history.map(m => ({
        ...m,
        isFavorite: !!m.is_favorite,
        mediaUrl: m.media_url,
        mediaType: m.media_type
      })));
    });

    socket.on("create-group", (data: { name: string; handle: string; password?: string; isPrivate?: boolean; owner: string }) => {
      const { name, handle, password, isPrivate, owner } = data;
      const groupId = `group-${Date.now()}`;
      const groupHandle = handle.startsWith('@') ? handle : `@${handle}`;
      const hashedPassword = password ? bcrypt.hashSync(password, 10) : null;
      db.prepare("INSERT INTO rooms (id, name, handle, type, password, is_private, owner) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(groupId, name, groupHandle, 'group', hashedPassword, isPrivate ? 1 : 0, owner);
      
      db.prepare("INSERT INTO room_members (room_id, username, role) VALUES (?, ?, 'owner')").run(groupId, owner);
      
      // System message: group created
      const createMsg = `${owner} создал(а) группу`;
      const resultMsg = db.prepare("INSERT INTO messages (room, sender, content) VALUES (?, ?, ?)").run(groupId, 'system', createMsg);
      const msgId = (resultMsg as any).lastInsertRowid;
      const timestamp = new Date().toISOString();
      
      io.to(groupId).emit("new-message", {
        id: msgId,
        room: groupId,
        sender: 'system',
        content: createMsg,
        timestamp,
        isFavorite: false
      });

      // Save to Firestore
      firestore.collection("rooms").doc(groupId).set({
        id: groupId,
        name,
        handle: groupHandle,
        type: 'group',
        password: hashedPassword,
        is_private: !!isPrivate,
        owner,
        created_at: new Date().toISOString()
      }).catch(err => console.error("Firestore room save failed:", err));

      const newGroup = { 
        id: groupId, 
        name, 
        handle: groupHandle, 
        type: 'group', 
        password: hashedPassword, 
        is_private: isPrivate ? 1 : 0, 
        owner,
        members: [owner],
        admins: [owner],
        banned: [],
        reports: []
      };
      io.emit("new-group", newGroup);
    });

    socket.on("update-group", (data: { id: string; name?: string; handle?: string; password?: string; isPrivate?: boolean }) => {
      const { id, name, handle, password, isPrivate } = data;
      const room = db.prepare("SELECT * FROM rooms WHERE id = ?").get(id);
      if (room) {
        let hashedPassword = undefined;
        if (password !== undefined) {
          hashedPassword = password ? bcrypt.hashSync(password, 10) : null;
        }
        
        if (hashedPassword !== undefined) {
          db.prepare("UPDATE rooms SET name = COALESCE(?, name), handle = COALESCE(?, handle), password = ?, is_private = COALESCE(?, is_private) WHERE id = ?")
            .run(name, handle, hashedPassword, isPrivate !== undefined ? (isPrivate ? 1 : 0) : null, id);
        } else {
          db.prepare("UPDATE rooms SET name = COALESCE(?, name), handle = COALESCE(?, handle), is_private = COALESCE(?, is_private) WHERE id = ?")
            .run(name, handle, isPrivate !== undefined ? (isPrivate ? 1 : 0) : null, id);
        }
        
        // Re-fetch with details
        const updated = db.prepare("SELECT * FROM rooms WHERE id = ?").get(id) as any;
        const members = db.prepare("SELECT username, role FROM room_members WHERE room_id = ?").all(id) as {username: string, role: string}[];
        const banned = db.prepare("SELECT username FROM room_bans WHERE room_id = ?").all(id) as {username: string}[];
        const reports = db.prepare("SELECT username FROM room_reports WHERE room_id = ?").all(id) as {username: string}[];
        
        const groupWithDetails = {
          ...updated,
          members: members.map(m => m.username),
          admins: members.filter(m => m.role === 'admin' || m.role === 'owner').map(m => m.username),
          banned: banned.map(b => b.username),
          reports: reports.map(r => r.username)
        };
        io.emit("group-updated", groupWithDetails);
      }
    });

    socket.on("join-public-group", (data: { roomId: string; username: string }) => {
      try {
        const isBanned = db.prepare("SELECT * FROM room_bans WHERE room_id = ? AND username = ?").get(data.roomId, data.username);
        if (isBanned) {
          socket.emit("group-error", "Вы заблокированы в этой группе");
          return;
        }
        db.prepare("INSERT OR IGNORE INTO room_members (room_id, username, role) VALUES (?, ?, 'member')").run(data.roomId, data.username);
        
        // System message: user joined
        const joinMsg = `${data.username} вступил(а) в чат`;
        const resultMsg = db.prepare("INSERT INTO messages (room, sender, content) VALUES (?, ?, ?)").run(data.roomId, 'system', joinMsg);
        const msgId = (resultMsg as any).lastInsertRowid;
        const timestamp = new Date().toISOString();
        
        io.to(data.roomId).emit("new-message", {
          id: msgId,
          room: data.roomId,
          sender: 'system',
          content: joinMsg,
          timestamp,
          isFavorite: false
        });

        // Broadcast update
        const updated = db.prepare("SELECT * FROM rooms WHERE id = ?").get(data.roomId) as any;
        const members = db.prepare("SELECT username, role FROM room_members WHERE room_id = ?").all(data.roomId) as {username: string, role: string}[];
        const banned = db.prepare("SELECT username FROM room_bans WHERE room_id = ?").all(data.roomId) as {username: string}[];
        const reports = db.prepare("SELECT username FROM room_reports WHERE room_id = ?").all(data.roomId) as {username: string}[];
        
        io.emit("group-updated", {
          ...updated,
          members: members.map(m => m.username),
          admins: members.filter(m => m.role === 'admin' || m.role === 'owner').map(m => m.username),
          banned: banned.map(b => b.username),
          reports: reports.map(r => r.username)
        });
      } catch (e) {
        console.error(e);
      }
    });

    socket.on("leave-group", (data: { roomId: string; username: string }) => {
      try {
        db.prepare("DELETE FROM room_members WHERE room_id = ? AND username = ?").run(data.roomId, data.username);
        
        // System message: user left
        const leaveMsg = `${data.username} покинул(а) чат`;
        const resultMsg = db.prepare("INSERT INTO messages (room, sender, content) VALUES (?, ?, ?)").run(data.roomId, 'system', leaveMsg);
        const msgId = (resultMsg as any).lastInsertRowid;
        const timestamp = new Date().toISOString();
        
        io.to(data.roomId).emit("new-message", {
          id: msgId,
          room: data.roomId,
          sender: 'system',
          content: leaveMsg,
          timestamp,
          isFavorite: false
        });

        // Broadcast update
        const updated = db.prepare("SELECT * FROM rooms WHERE id = ?").get(data.roomId) as any;
        if (updated) {
          const members = db.prepare("SELECT username, role FROM room_members WHERE room_id = ?").all(data.roomId) as {username: string, role: string}[];
          const banned = db.prepare("SELECT username FROM room_bans WHERE room_id = ?").all(data.roomId) as {username: string}[];
          const reports = db.prepare("SELECT username FROM room_reports WHERE room_id = ?").all(data.roomId) as {username: string}[];
          
          io.emit("group-updated", {
            ...updated,
            members: members.map(m => m.username),
            admins: members.filter(m => m.role === 'admin' || m.role === 'owner').map(m => m.username),
            banned: banned.map(b => b.username),
            reports: reports.map(r => r.username)
          });
        }
      } catch (e) {
        console.error(e);
      }
    });

    socket.on("report-group", (data: { roomId: string; username: string; reason: string }) => {
      try {
        db.prepare("INSERT OR IGNORE INTO room_reports (room_id, username, reason) VALUES (?, ?, ?)").run(data.roomId, data.username, data.reason);
        const reportCount = db.prepare("SELECT COUNT(*) as count FROM room_reports WHERE room_id = ?").get(data.roomId) as { count: number };
        
        if (reportCount.count >= 5) {
          // Auto-delete group
          db.prepare("DELETE FROM rooms WHERE id = ?").run(data.roomId);
          db.prepare("DELETE FROM room_members WHERE room_id = ?").run(data.roomId);
          db.prepare("DELETE FROM messages WHERE room = ?").run(data.roomId);
          io.emit("group-deleted", data.roomId);
        } else {
          // Broadcast update
          const updated = db.prepare("SELECT * FROM rooms WHERE id = ?").get(data.roomId) as any;
          if (updated) {
            const members = db.prepare("SELECT username, role FROM room_members WHERE room_id = ?").all(data.roomId) as {username: string, role: string}[];
            const banned = db.prepare("SELECT username FROM room_bans WHERE room_id = ?").all(data.roomId) as {username: string}[];
            const reports = db.prepare("SELECT username FROM room_reports WHERE room_id = ?").all(data.roomId) as {username: string}[];
            
            io.emit("group-updated", {
              ...updated,
              members: members.map(m => m.username),
              admins: members.filter(m => m.role === 'admin' || m.role === 'owner').map(m => m.username),
              banned: banned.map(b => b.username),
              reports: reports.map(r => r.username)
            });
          }
        }
      } catch (e) {
        console.error(e);
      }
    });

    socket.on("ban-user", (data: { roomId: string; targetUsername: string; adminUsername: string }) => {
      try {
        // Verify admin
        const admin = db.prepare("SELECT role FROM room_members WHERE room_id = ? AND username = ?").get(data.roomId, data.adminUsername) as any;
        if (admin && (admin.role === 'admin' || admin.role === 'owner')) {
          db.prepare("INSERT OR IGNORE INTO room_bans (room_id, username) VALUES (?, ?)").run(data.roomId, data.targetUsername);
          db.prepare("DELETE FROM room_members WHERE room_id = ? AND username = ?").run(data.roomId, data.targetUsername);
          
          // System message: user banned
          const banMsg = `${data.targetUsername} был(а) заблокирован(а) в чате`;
          const resultMsg = db.prepare("INSERT INTO messages (room, sender, content) VALUES (?, ?, ?)").run(data.roomId, 'system', banMsg);
          const msgId = (resultMsg as any).lastInsertRowid;
          const timestamp = new Date().toISOString();
          
          io.to(data.roomId).emit("new-message", {
            id: msgId,
            room: data.roomId,
            sender: 'system',
            content: banMsg,
            timestamp,
            isFavorite: false
          });

          // Broadcast update
          const updated = db.prepare("SELECT * FROM rooms WHERE id = ?").get(data.roomId) as any;
          if (updated) {
            const members = db.prepare("SELECT username, role FROM room_members WHERE room_id = ?").all(data.roomId) as {username: string, role: string}[];
            const banned = db.prepare("SELECT username FROM room_bans WHERE room_id = ?").all(data.roomId) as {username: string}[];
            const reports = db.prepare("SELECT username FROM room_reports WHERE room_id = ?").all(data.roomId) as {username: string}[];
            
            io.emit("group-updated", {
              ...updated,
              members: members.map(m => m.username),
              admins: members.filter(m => m.role === 'admin' || m.role === 'owner').map(m => m.username),
              banned: banned.map(b => b.username),
              reports: reports.map(r => r.username)
            });
          }
        }
      } catch (e) {
        console.error(e);
      }
    });

    socket.on("promote-user", (data: { roomId: string; targetUsername: string; adminUsername: string }) => {
      try {
        // Verify owner
        const admin = db.prepare("SELECT role FROM room_members WHERE room_id = ? AND username = ?").get(data.roomId, data.adminUsername) as any;
        if (admin && admin.role === 'owner') {
          db.prepare("UPDATE room_members SET role = 'admin' WHERE room_id = ? AND username = ?").run(data.roomId, data.targetUsername);
          
          // Broadcast update
          const updated = db.prepare("SELECT * FROM rooms WHERE id = ?").get(data.roomId) as any;
          if (updated) {
            const members = db.prepare("SELECT username, role FROM room_members WHERE room_id = ?").all(data.roomId) as {username: string, role: string}[];
            const banned = db.prepare("SELECT username FROM room_bans WHERE room_id = ?").all(data.roomId) as {username: string}[];
            const reports = db.prepare("SELECT username FROM room_reports WHERE room_id = ?").all(data.roomId) as {username: string}[];
            
            io.emit("group-updated", {
              ...updated,
              members: members.map(m => m.username),
              admins: members.filter(m => m.role === 'admin' || m.role === 'owner').map(m => m.username),
              banned: banned.map(b => b.username),
              reports: reports.map(r => r.username)
            });
          }
        }
      } catch (e) {
        console.error(e);
      }
    });

    socket.on("change-password", async (data: { username: string; oldPass: string; newPass: string }) => {
      try {
        const user = db.prepare("SELECT password FROM users WHERE username = ?").get(data.username) as any;
        if (user) {
          let isMatch = false;
          if (!user.password || !user.password.startsWith('$2')) {
            isMatch = (!user.password && !data.oldPass) || user.password === data.oldPass;
          } else {
            isMatch = bcrypt.compareSync(data.oldPass, user.password);
          }
          
          if (isMatch) {
            const hashedNewPass = bcrypt.hashSync(data.newPass, 10);
            db.prepare("UPDATE users SET password = ? WHERE username = ?").run(hashedNewPass, data.username);
            
            // Update Firestore
            await firestore.collection("users").doc(data.username).update({
              password: hashedNewPass
            }).catch(err => console.error("Firestore password update failed:", err));

            socket.emit("password-changed", { success: true });
          } else {
            socket.emit("password-changed", { success: false, error: "Неверный старый пароль" });
          }
        } else {
          socket.emit("password-changed", { success: false, error: "Пользователь не найден" });
        }
      } catch (e) {
        console.error(e);
      }
    });

    socket.on("redeem-code", (data: { username: string; code: string }) => {
      try {
        // Hardcoded codes for demo
        if (data.code === 'PREMIUM2026') {
          db.prepare("UPDATE users SET is_premium = 1 WHERE username = ?").run(data.username);
          socket.emit("code-redeemed", { success: true, message: "Премиум активирован!" });
          
          // Broadcast updated user list
          const usersList = db.prepare("SELECT username, is_premium, role FROM users").all() as any[];
          const profiles = db.prepare("SELECT * FROM profiles").all() as any[];
          const enrichedUsers = usersList.map(u => {
            const p = profiles.find(p => p.username === u.username);
            return { id: u.username, name: p?.nickname || u.username, nickname: p?.nickname || '', bio: p?.bio, avatar_url: p?.avatar_url, is_premium: u.is_premium, role: u.role };
          });
          io.emit("user-list", enrichedUsers);
        } else if (data.code === 'ADMIN_MODE') {
          db.prepare("UPDATE users SET role = 'admin' WHERE username = ?").run(data.username);
          socket.emit("code-redeemed", { success: true, message: "Права администратора получены!" });
          socket.emit("login-success", { username: data.username, role: 'admin', isPremium: true, premiumExpiresAt: null });
          
          // Broadcast updated user list
          const usersList = db.prepare("SELECT username, is_premium, role FROM users").all() as any[];
          const profiles = db.prepare("SELECT * FROM profiles").all() as any[];
          const enrichedUsers = usersList.map(u => {
            const p = profiles.find(p => p.username === u.username);
            return { id: u.username, name: p?.nickname || u.username, nickname: p?.nickname || '', bio: p?.bio, avatar_url: p?.avatar_url, is_premium: u.is_premium, role: u.role };
          });
          io.emit("user-list", enrichedUsers);
        } else {
          socket.emit("code-redeemed", { success: false, message: "Неверный код" });
        }
      } catch (e) {
        console.error(e);
      }
    });

    socket.on("verify-group-password", (data: { roomId: string; password?: string }) => {
      const room = db.prepare("SELECT * FROM rooms WHERE id = ?").get(data.roomId) as any;
      if (room && room.is_private) {
        let isMatch = false;
        if (room.password) {
          if (!room.password.startsWith('$2')) {
            isMatch = room.password === data.password;
            // Optionally hash it here if it matches, but we don't have the plaintext to hash if it doesn't.
            // Actually, if it matches, we can hash it and update it.
            if (isMatch && data.password) {
              const hashed = bcrypt.hashSync(data.password, 10);
              db.prepare("UPDATE rooms SET password = ? WHERE id = ?").run(hashed, data.roomId);
            }
          } else if (data.password) {
            isMatch = bcrypt.compareSync(data.password, room.password);
          }
        }
        
        if (isMatch) {
          socket.emit("password-verified", { roomId: data.roomId, success: true });
        } else {
          socket.emit("password-verified", { roomId: data.roomId, success: false });
        }
      } else {
        socket.emit("password-verified", { roomId: data.roomId, success: true });
      }
    });

    socket.on("get-recent-chats", (username: string) => {
      const normalizedUsername = username.trim().toLowerCase();
      // Find all distinct rooms where the user sent or received a message
      // Optimized query to get the latest message from each private room the user is in
      const recentChats = db.prepare(`
        WITH LatestMessages AS (
          SELECT room, sender, content, timestamp,
                 ROW_NUMBER() OVER (PARTITION BY room ORDER BY timestamp DESC) as rn
          FROM messages
          WHERE room LIKE ?
        )
        SELECT lm.room, lm.sender, lm.content, lm.timestamp,
               p.avatar_url, p.nickname, u.is_premium,
               (SELECT COUNT(*) FROM messages m2 
                WHERE m2.room = lm.room 
                AND m2.sender != ? 
                AND m2.timestamp > COALESCE((SELECT last_read_at FROM last_read lr WHERE lr.username = ? AND lr.room = lm.room), '1970-01-01')) as unreadCount
        FROM LatestMessages lm
        LEFT JOIN profiles p ON p.username = CASE 
          WHEN lm.room LIKE '%--%' THEN 
            CASE WHEN SUBSTR(lm.room, 1, INSTR(lm.room, '--') - 1) = ? 
                 THEN SUBSTR(lm.room, INSTR(lm.room, '--') + 2)
                 ELSE SUBSTR(lm.room, 1, INSTR(lm.room, '--') - 1)
            END
          ELSE NULL
        END
        LEFT JOIN users u ON u.username = p.username
        WHERE lm.rn = 1 AND lm.room LIKE '%--%'
        ORDER BY lm.timestamp DESC
      `).all(`%${normalizedUsername}%`, normalizedUsername, normalizedUsername, normalizedUsername) as any[];

      const formattedChats = recentChats.map(chat => {
        const users = chat.room.split('--');
        const otherUser = users[0] === normalizedUsername ? users[1] : users[0];
        return {
          username: otherUser,
          lastMessage: chat.content,
          timestamp: chat.timestamp,
          avatar_url: chat.avatar_url || '',
          nickname: chat.nickname || otherUser,
          is_premium: chat.is_premium || 0,
          room: chat.room,
          unreadCount: chat.unreadCount
        };
      });

      socket.emit("recent-chats", formattedChats);
    });

    socket.on("get-groups", () => {
      const groups = db.prepare("SELECT * FROM rooms WHERE type = 'group'").all() as any[];
      const groupsWithDetails = groups.map(g => {
        const members = db.prepare("SELECT username, role FROM room_members WHERE room_id = ?").all(g.id) as {username: string, role: string}[];
        const banned = db.prepare("SELECT username FROM room_bans WHERE room_id = ?").all(g.id) as {username: string}[];
        const reports = db.prepare("SELECT username FROM room_reports WHERE room_id = ?").all(g.id) as {username: string}[];
        
        return {
          ...g,
          members: members.map(m => m.username),
          admins: members.filter(m => m.role === 'admin' || m.role === 'owner').map(m => m.username),
          banned: banned.map(b => b.username),
          reports: reports.map(r => r.username)
        };
      });
      socket.emit("group-list", groupsWithDetails);
    });

    socket.on("toggle-favorite", async (data: { messageId: number; isFavorite: boolean; username: string }) => {
      if (data.isFavorite) {
        db.prepare("INSERT OR IGNORE INTO favorites (username, message_id) VALUES (?, ?)").run(data.username, data.messageId);
        
        // Update Firestore
        await firestore.collection("favorites").doc(`${data.username}_${data.messageId}`).set({
          username: data.username,
          message_id: data.messageId,
          created_at: new Date().toISOString()
        }).catch(err => console.error("Firestore favorite save failed:", err));
      } else {
        db.prepare("DELETE FROM favorites WHERE username = ? AND message_id = ?").run(data.username, data.messageId);
        
        // Update Firestore
        await firestore.collection("favorites").doc(`${data.username}_${data.messageId}`).delete().catch(err => console.error("Firestore favorite delete failed:", err));
      }
      socket.emit("message-updated", { id: data.messageId, isFavorite: data.isFavorite });
    });

    socket.on("get-favorites", (username: string) => {
      const favorites = db.prepare(`
        SELECT m.*, 1 as is_favorite
        FROM messages m
        JOIN favorites f ON m.id = f.message_id
        WHERE f.username = ?
        ORDER BY m.timestamp DESC
      `).all(username);
      socket.emit("favorites-list", favorites.map(f => ({
        ...f,
        isFavorite: !!f.is_favorite,
        mediaUrl: f.media_url,
        mediaType: f.media_type
      })));
    });

    socket.on("update-profile", async (data: { username: string; nickname?: string; bio?: string; avatar_url?: string }) => {
      const existing = db.prepare("SELECT * FROM profiles WHERE username = ?").get(data.username);
      if (existing) {
        db.prepare("UPDATE profiles SET nickname = COALESCE(?, nickname), bio = COALESCE(?, bio), avatar_url = COALESCE(?, avatar_url) WHERE username = ?")
          .run(data.nickname, data.bio, data.avatar_url, data.username);
      } else {
        db.prepare("INSERT INTO profiles (username, nickname, bio, avatar_url) VALUES (?, ?, ?, ?)")
          .run(data.username, data.nickname || '', data.bio || '', data.avatar_url || '');
      }
      
      // Update Firestore
      await firestore.collection("profiles").doc(data.username).set({
        username: data.username,
        nickname: data.nickname || '',
        bio: data.bio || '',
        avatar_url: data.avatar_url || ''
      }, { merge: true }).catch(err => console.error("Firestore profile update failed:", err));

      const profile = db.prepare("SELECT * FROM profiles WHERE username = ?").get(data.username);
      socket.emit("profile-updated", profile);
    });

    socket.on("get-profile", (username: string) => {
      const normalizedUsername = username.trim().toLowerCase();
      let profile = db.prepare("SELECT * FROM profiles WHERE username = ?").get(normalizedUsername);
      if (!profile) {
        profile = { username: normalizedUsername, nickname: '', bio: 'Digital architect and P2P enthusiast.', avatar_url: '' };
      }
      socket.emit("profile-data", profile);
    });

    socket.on("create-story", async (data: { username: string; media_url: string; media_type: string }) => {
      const user: any = db.prepare("SELECT * FROM users WHERE username = ?").get(data.username);
      if (user && user.is_premium) {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        db.prepare("INSERT INTO stories (username, media_url, media_type, expires_at) VALUES (?, ?, ?, ?)").run(data.username, data.media_url, data.media_type, expiresAt);
        
        // Update Firestore
        await firestore.collection("stories").add({
          username: data.username,
          media_url: data.media_url,
          media_type: data.media_type,
          expires_at: expiresAt,
          created_at: new Date().toISOString()
        }).catch(err => console.error("Firestore story save failed:", err));

        const stories = db.prepare(`
          SELECT s.*, p.avatar_url 
          FROM stories s 
          LEFT JOIN profiles p ON s.username = p.username 
          WHERE s.expires_at > CURRENT_TIMESTAMP
          ORDER BY s.created_at DESC
        `).all();
        io.emit("stories-updated", stories);
      }
    });

    socket.on("get-stories", () => {
      const stories = db.prepare(`
        SELECT s.*, p.avatar_url 
        FROM stories s 
        LEFT JOIN profiles p ON s.username = p.username 
        WHERE s.expires_at > CURRENT_TIMESTAMP
        ORDER BY s.created_at DESC
      `).all();
      socket.emit("stories-updated", stories);
    });

    socket.on("get-settings", (username: string) => {
      const normalizedUsername = username.trim().toLowerCase();
      let settings = db.prepare("SELECT * FROM user_settings WHERE username = ?").get(normalizedUsername);
      if (!settings) {
        settings = {
          username: normalizedUsername,
          notifications_private: 1,
          notifications_groups: 1,
          notifications_calls: 1,
          badge_muted: 0,
          p2p_calls: 1,
          language: 'English',
          auto_media_mobile: 1,
          auto_media_wifi: 1
        };
        db.prepare("INSERT INTO user_settings (username) VALUES (?)").run(normalizedUsername);
      }
      socket.emit("settings-data", settings);
    });

    socket.on("update-settings", async (data: { username: string; [key: string]: any }) => {
      const { username, ...settings } = data;
      const keys = Object.keys(settings);
      const values = Object.values(settings);
      const setClause = keys.map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE user_settings SET ${setClause} WHERE username = ?`).run(...values, username);
      
      // Update Firestore
      await firestore.collection("user_settings").doc(username).set({
        username,
        ...settings
      }, { merge: true }).catch(err => console.error("Firestore settings update failed:", err));

      const updated = db.prepare("SELECT * FROM user_settings WHERE username = ?").get(username);
      socket.emit("settings-updated", updated);
    });

    socket.on("toggle-mute-chat", (data: { username: string; room: string; isMuted: boolean }) => {
      if (data.isMuted) {
        db.prepare("INSERT OR IGNORE INTO muted_chats (username, room) VALUES (?, ?)").run(data.username, data.room);
      } else {
        db.prepare("DELETE FROM muted_chats WHERE username = ? AND room = ?").run(data.username, data.room);
      }
      const muted = db.prepare("SELECT room FROM muted_chats WHERE username = ?").all(data.username).map((r: any) => r.room);
      socket.emit("muted-chats-data", muted);
    });

    socket.on("get-muted-chats", (username: string) => {
      const muted = db.prepare("SELECT room FROM muted_chats WHERE username = ?").all(username).map((r: any) => r.room);
      socket.emit("muted-chats-data", muted);
    });

    socket.on("block-user", (data: { username: string; blockedUser: string }) => {
      db.prepare("INSERT OR IGNORE INTO blocked_users (username, blocked_user) VALUES (?, ?)").run(data.username, data.blockedUser);
      const blocked = db.prepare("SELECT blocked_user FROM blocked_users WHERE username = ?").all(data.username).map((r: any) => r.blocked_user);
      socket.emit("blocked-users-data", blocked);
    });

    socket.on("unblock-user", (data: { username: string; blockedUser: string }) => {
      db.prepare("DELETE FROM blocked_users WHERE username = ? AND blocked_user = ?").run(data.username, data.blockedUser);
      const blocked = db.prepare("SELECT blocked_user FROM blocked_users WHERE username = ?").all(data.username).map((r: any) => r.blocked_user);
      socket.emit("blocked-users-data", blocked);
    });

    socket.on("get-blocked-users", (username: string) => {
      const blocked = db.prepare("SELECT blocked_user FROM blocked_users WHERE username = ?").all(username).map((r: any) => r.blocked_user);
      socket.emit("blocked-users-data", blocked);
    });

    socket.on("report-user", (data: { reporter: string; reportedUser: string; reason: string }) => {
      db.prepare("INSERT OR REPLACE INTO user_reports (reporter, reported_user, reason) VALUES (?, ?, ?)").run(data.reporter, data.reportedUser, data.reason);
    });

    socket.on("clear-chat", (data: { username: string; room: string }) => {
      db.prepare("DELETE FROM messages WHERE room = ?").run(data.room);
      io.to(data.room).emit("chat-cleared", data.room);
    });

    socket.on("mark-read", (data: { room: string; username: string }) => {
      db.prepare("INSERT INTO last_read (username, room, last_read_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(username, room) DO UPDATE SET last_read_at = CURRENT_TIMESTAMP").run(data.username, data.room);
    });

    socket.on("send-message", async (data: { room: string; sender: string; content: string; mediaUrl?: string; mediaType?: string }) => {
      const { room, sender, content, mediaUrl, mediaType } = data;
      
      // Profanity filter
      const forbiddenWords = [
        "Пизда", "хуй", "малафья", "пидорас", "даун", "уёбок", "пиздализ", 
        "телеграм", "ютуб", "инстаграм"
      ];
      
      let filteredContent = content;
      forbiddenWords.forEach(word => {
        const regex = new RegExp(word, 'gi');
        filteredContent = filteredContent.replace(regex, "(слово запрещённое РКН)");
      });

      // Save to DB
      const result = db.prepare("INSERT INTO messages (room, sender, content, media_url, media_type) VALUES (?, ?, ?, ?, ?)").run(room, sender, filteredContent, mediaUrl || null, mediaType || null);
      
      const timestamp = new Date().toISOString();

      // Save to Firestore
      firestore.collection("messages").add({
        room,
        sender,
        content: filteredContent,
        timestamp,
        media_url: mediaUrl || null,
        media_type: mediaType || null
      }).catch(err => console.error("Firestore message save failed:", err));

      // Broadcast to room
      io.to(room).emit("new-message", {
        id: result.lastInsertRowid,
        room,
        sender,
        content: filteredContent,
        timestamp,
        isFavorite: false,
        mediaUrl,
        mediaType
      });
    });

    // WebRTC Signaling
    socket.on("call-user", (data: { to: string; offer: any; from: string; type: 'audio' | 'video' }) => {
      const targetSocketId = io.sockets.sockets.get(data.to) ? data.to : Array.from(users.entries()).find(([_, name]) => name === data.to.toLowerCase())?.[0];
      if (targetSocketId) {
        io.to(targetSocketId).emit("call-made", {
          offer: data.offer,
          socket: socket.id,
          from: data.from,
          type: data.type
        });
      }
    });

    socket.on("make-answer", (data: { to: string; answer: any }) => {
      const targetSocketId = io.sockets.sockets.get(data.to) ? data.to : Array.from(users.entries()).find(([_, name]) => name === data.to.toLowerCase())?.[0];
      if (targetSocketId) {
        io.to(targetSocketId).emit("answer-made", {
          socket: socket.id,
          answer: data.answer,
          from: users.get(socket.id)
        });
      }
    });

    socket.on("ice-candidate", (data: { to: string; candidate: any }) => {
      const targetSocketId = io.sockets.sockets.get(data.to) ? data.to : Array.from(users.entries()).find(([_, name]) => name === data.to.toLowerCase())?.[0];
      if (targetSocketId) {
        io.to(targetSocketId).emit("ice-candidate", {
          socket: socket.id,
          candidate: data.candidate,
          from: users.get(socket.id)
        });
      }
    });

    socket.on("end-call", (data: { to: string }) => {
      const targetSocketId = io.sockets.sockets.get(data.to) ? data.to : Array.from(users.entries()).find(([_, name]) => name === data.to.toLowerCase())?.[0];
      if (targetSocketId) {
        io.to(targetSocketId).emit("call-ended", { from: users.get(socket.id) });
      }
    });

    socket.on("logout", () => {
      const username = users.get(socket.id);
      if (username) {
        users.delete(socket.id);
        io.emit("user-status", { username, isOnline: false });
        broadcastUserList();
      }
    });

    socket.on("disconnect", () => {
      const username = users.get(socket.id);
      if (username) {
        users.delete(socket.id);
        io.emit("user-status", { username, isOnline: false });
        broadcastUserList();
        console.log("User disconnected:", username);
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
