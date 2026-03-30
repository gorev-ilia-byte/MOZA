import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("messenger.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT,
    role TEXT DEFAULT 'user',
    is_premium INTEGER DEFAULT 0,
    premium_expires_at DATETIME,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT,
    sender TEXT,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    media_url TEXT,
    media_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
  );
  CREATE TABLE IF NOT EXISTS last_read (
    username TEXT,
    room TEXT,
    last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (username, room)
  );
  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    message_id INTEGER,
    UNIQUE(username, message_id)
  );
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT,
    handle TEXT,
    type TEXT, -- 'direct' or 'group'
    password TEXT,
    is_private INTEGER DEFAULT 0,
    owner TEXT
  );
  CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT,
    username TEXT,
    role TEXT DEFAULT 'member', -- 'member', 'admin', 'owner'
    PRIMARY KEY (room_id, username)
  );
  CREATE TABLE IF NOT EXISTS room_bans (
    room_id TEXT,
    username TEXT,
    PRIMARY KEY (room_id, username)
  );
  CREATE TABLE IF NOT EXISTS room_reports (
    room_id TEXT,
    username TEXT,
    reason TEXT,
    PRIMARY KEY (room_id, username)
  );
  CREATE TABLE IF NOT EXISTS premium_codes (
    code TEXT PRIMARY KEY,
    used INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS profiles (
    username TEXT PRIMARY KEY,
    nickname TEXT,
    bio TEXT,
    avatar_url TEXT
  );
  CREATE TABLE IF NOT EXISTS user_settings (
    username TEXT PRIMARY KEY,
    notifications_private INTEGER DEFAULT 1,
    notifications_groups INTEGER DEFAULT 1,
    notifications_calls INTEGER DEFAULT 1,
    badge_muted INTEGER DEFAULT 0,
    p2p_calls INTEGER DEFAULT 1,
    language TEXT DEFAULT 'English',
    auto_media_mobile INTEGER DEFAULT 1,
    auto_media_wifi INTEGER DEFAULT 1
  );
`);

// Migration: Add password, is_private, owner to rooms
try {
  db.prepare("SELECT password FROM rooms LIMIT 1").get();
} catch (e) {
  if (e.message.includes("no such column: password")) {
    db.exec("ALTER TABLE rooms ADD COLUMN password TEXT");
    db.exec("ALTER TABLE rooms ADD COLUMN is_private INTEGER DEFAULT 0");
    db.exec("ALTER TABLE rooms ADD COLUMN owner TEXT");
    console.log("Migration: Added password, is_private, owner columns to rooms table");
  }
}

// Migration: Add auto_media columns if they don't exist
try {
  db.prepare("SELECT auto_media_mobile FROM user_settings LIMIT 1").get();
} catch (e: any) {
  if (e.message.includes("no such column: auto_media_mobile")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN auto_media_mobile INTEGER DEFAULT 1");
    db.exec("ALTER TABLE user_settings ADD COLUMN auto_media_wifi INTEGER DEFAULT 1");
    console.log("Migration: Added auto_media columns to user_settings table");
  }
}

// Migration: Add media_url and media_type to messages
try {
  db.prepare("SELECT media_url FROM messages LIMIT 1").get();
} catch (e: any) {
  try {
    db.exec("ALTER TABLE messages ADD COLUMN media_url TEXT");
    db.exec("ALTER TABLE messages ADD COLUMN media_type TEXT");
    console.log("Migration: Added media_url and media_type columns to messages table");
  } catch (err) {
    console.error("Migration failed:", err);
  }
}

// Migration: Add password, role, is_premium to users
try {
  db.prepare("SELECT password FROM users LIMIT 1").get();
} catch (e: any) {
  try {
    db.exec("ALTER TABLE users ADD COLUMN password TEXT");
    db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
    db.exec("ALTER TABLE users ADD COLUMN is_premium INTEGER DEFAULT 0");
    db.exec("UPDATE users SET password = username WHERE password IS NULL");
    console.log("Migration: Added password, role, is_premium columns to users table");
  } catch (err) {
    console.error("Migration failed:", err);
  }
}

// Ensure admin user exists
try {
  const adminUser = db.prepare("SELECT * FROM users WHERE username = 'admin'").get() as any;
  const adminPassword = bcrypt.hashSync('1488', 10);
  if (!adminUser) {
    db.prepare("INSERT INTO users (username, password, role, is_premium) VALUES ('admin', ?, 'admin', 1)").run(adminPassword);
    console.log("Created default admin user");
  } else {
    // Check if the password is not hashed yet (length of bcrypt hash is 60)
    if (adminUser.password === '1488' || adminUser.password.length !== 60) {
      db.prepare("UPDATE users SET password = ?, role = 'admin' WHERE username = 'admin'").run(adminPassword);
    } else {
      db.prepare("UPDATE users SET role = 'admin' WHERE username = 'admin'").run();
    }
  }
} catch (err) {
  console.error("Failed to ensure admin user:", err);
}

// Migration: Add premium_expires_at to users
try {
  db.prepare("SELECT premium_expires_at FROM users LIMIT 1").get();
} catch (e: any) {
  try {
    db.exec("ALTER TABLE users ADD COLUMN premium_expires_at DATETIME");
    console.log("Migration: Added premium_expires_at column to users table");
  } catch (err) {
    console.error("Migration failed:", err);
  }
}

// Migration: Add nickname to profiles
try {
  db.prepare("SELECT nickname FROM profiles LIMIT 1").get();
} catch (e: any) {
  try {
    db.exec("ALTER TABLE profiles ADD COLUMN nickname TEXT");
    console.log("Migration: Added nickname column to profiles table");
  } catch (err) {
    console.error("Migration failed:", err);
  }
}

// Migration: Populate room_members for existing groups
try {
  const groups = db.prepare("SELECT id, owner FROM rooms WHERE type = 'group'").all() as { id: string, owner: string }[];
  const stmt = db.prepare("INSERT OR IGNORE INTO room_members (room_id, username, role) VALUES (?, ?, 'owner')");
  db.transaction(() => {
    for (const group of groups) {
      if (group.owner) {
        stmt.run(group.id, group.owner);
      }
    }
  })();
  console.log("Migration: Populated room_members for existing groups");
} catch (e) {
  console.error("Migration failed for room_members:", e);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS muted_chats (
    username TEXT,
    room TEXT,
    PRIMARY KEY (username, room)
  );
  CREATE TABLE IF NOT EXISTS blocked_users (
    username TEXT,
    blocked_user TEXT,
    PRIMARY KEY (username, blocked_user)
  );
  CREATE TABLE IF NOT EXISTS user_reports (
    reporter TEXT,
    reported_user TEXT,
    reason TEXT,
    PRIMARY KEY (reporter, reported_user)
  );
  CREATE TABLE IF NOT EXISTS premium_keys (
    key TEXT PRIMARY KEY,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    used_by TEXT,
    used_at DATETIME
  );
`);

async function startServer() {
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
  const activeCalls = new Map<string, { participants: Set<string>, type: 'audio' | 'video' }>(); // roomId -> { participants, type }

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("register", (data: { username: string; nickname?: string; password?: string }) => {
      const { username, nickname, password } = data;
      const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
      if (existing) {
        socket.emit("register-error", "Username already exists");
        return;
      }
      const hashedPassword = bcrypt.hashSync(password || username, 10);
      db.prepare("INSERT INTO users (username, password, role, is_premium) VALUES (?, ?, 'user', 0)").run(username, hashedPassword);
      
      if (nickname) {
        db.prepare("INSERT INTO profiles (username, nickname) VALUES (?, ?)").run(username, nickname);
      }
      
      users.set(socket.id, username);
      io.emit("user-status", { username, isOnline: true });
      socket.emit("register-success", { username, role: 'user', isPremium: false, premiumExpiresAt: null });
    });

    socket.on("login", (data: { username: string; password?: string }) => {
      const { username, password } = data;
      const user: any = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
      if (!user) {
        socket.emit("login-error", "User not found");
        return;
      }
      
      const inputPassword = password || username;
      
      if (user.password === user.username && inputPassword !== user.username) {
        // First login after password migration, update their password
        const hashedPassword = bcrypt.hashSync(inputPassword, 10);
        db.prepare("UPDATE users SET password = ? WHERE username = ?").run(hashedPassword, username);
        user.password = hashedPassword;
      } else if (!user.password || !user.password.startsWith('$2')) {
        // Password is not hashed yet, check if it matches plaintext
        if (user.password && user.password !== inputPassword) {
          socket.emit("login-error", "Incorrect password");
          return;
        }
        // Hash it and save
        const hashedPassword = bcrypt.hashSync(inputPassword, 10);
        db.prepare("UPDATE users SET password = ? WHERE username = ?").run(hashedPassword, username);
        user.password = hashedPassword;
      } else {
        // Compare hashed password
        const isMatch = bcrypt.compareSync(inputPassword, user.password);
        if (!isMatch) {
          socket.emit("login-error", "Incorrect password");
          return;
        }
      }

      // Check premium expiration
      let isPremium = !!user.is_premium;
      if (isPremium && user.premium_expires_at) {
        const expiresAt = new Date(user.premium_expires_at);
        if (expiresAt < new Date()) {
          isPremium = false;
          db.prepare("UPDATE users SET is_premium = 0 WHERE username = ?").run(username);
        }
      }

      socket.emit("login-success", { username: user.username, role: user.role, isPremium, premiumExpiresAt: user.premium_expires_at });
    });

    socket.on("generate-premium-key", (data: { username: string }) => {
      const user: any = db.prepare("SELECT * FROM users WHERE username = ?").get(data.username);
      if (user && user.role === 'admin') {
        const key = 'PREM-' + Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Math.random().toString(36).substring(2, 10).toUpperCase();
        db.prepare("INSERT INTO premium_keys (key, created_by) VALUES (?, ?)").run(key, data.username);
        socket.emit("premium-key-generated", { key });
      } else {
        socket.emit("premium-error", `Unauthorized: ${user ? user.role : 'User not found'}`);
      }
    });

    socket.on("redeem-premium-key", (data: { username: string; key: string }) => {
      const { username, key } = data;
      const keyRecord: any = db.prepare("SELECT * FROM premium_keys WHERE key = ?").get(key);
      if (!keyRecord) {
        socket.emit("premium-error", "Invalid key");
        return;
      }
      if (keyRecord.used_by) {
        socket.emit("premium-error", "Key already used");
        return;
      }
      db.prepare("UPDATE premium_keys SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE key = ?").run(username, key);
      db.prepare("UPDATE users SET is_premium = 1, premium_expires_at = datetime('now', '+1 month') WHERE username = ?").run(username);
      const updatedUser: any = db.prepare("SELECT premium_expires_at FROM users WHERE username = ?").get(username);
      socket.emit("premium-success", { message: "Premium activated for 1 month!", expiresAt: updatedUser.premium_expires_at });
    });

    socket.on("join-network", (username: string) => {
      users.set(socket.id, username);
      
      // Persist user
      db.prepare("UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE username = ?").run(username);
      
      const userList = Array.from(users.entries()).map(([id, name]) => {
        const profile = db.prepare("SELECT nickname, bio, avatar_url FROM profiles WHERE username = ?").get(name) as any;
        const u = db.prepare("SELECT role, is_premium FROM users WHERE username = ?").get(name) as any;
        return { 
          id: name, 
          name: profile?.nickname || name, 
          nickname: profile?.nickname || '',
          bio: profile?.bio || '', 
          avatar_url: profile?.avatar_url || '',
          role: u?.role || 'user',
          is_premium: u?.is_premium || 0
        };
      });
      // Deduplicate userList by id
      const uniqueUserList = Array.from(new Map(userList.map(item => [item.id, item])).values());
      io.emit("user-list", uniqueUserList);

      // Send active chats (DMs you have messaged with)
      const activeDMs = db.prepare(`
        SELECT DISTINCT room FROM messages 
        WHERE room LIKE ? AND room NOT LIKE 'group-%'
      `).all(`%${username}%`).map(r => {
        const partners = r.room.split('--');
        return partners.find(p => p !== username);
      }).filter(Boolean);

      socket.emit("active-dms", activeDMs);
      console.log(`${username} joined the network`);
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

      // Send current call state if exists
      const activeCall = activeCalls.get(room);
      if (activeCall) {
        const participants = Array.from(activeCall.participants);
        if (participants.length > 0) {
          socket.emit("room-call-started", {
            roomId: room,
            participants,
            type: activeCall.type,
            startedBy: participants[0]
          });
        }
      }
    });

    socket.on("create-group", (data: { name: string; handle: string; password?: string; isPrivate?: boolean; owner: string }) => {
      const { name, handle, password, isPrivate, owner } = data;
      const groupId = `group-${Date.now()}`;
      const groupHandle = handle.startsWith('@') ? handle : `@${handle}`;
      const hashedPassword = password ? bcrypt.hashSync(password, 10) : null;
      db.prepare("INSERT INTO rooms (id, name, handle, type, password, is_private, owner) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(groupId, name, groupHandle, 'group', hashedPassword, isPrivate ? 1 : 0, owner);
      
      db.prepare("INSERT INTO room_members (room_id, username, role) VALUES (?, ?, 'owner')").run(groupId, owner);

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

    socket.on("change-password", (data: { username: string; oldPass: string; newPass: string }) => {
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

    socket.on("start-room-call", (data: { roomId: string; username: string; type: 'audio' | 'video' }) => {
      if (!activeCalls.has(data.roomId)) {
        activeCalls.set(data.roomId, { participants: new Set(), type: data.type });
      }
      activeCalls.get(data.roomId)?.participants.add(data.username);
      io.to(data.roomId).emit("room-call-started", { 
        roomId: data.roomId, 
        participants: Array.from(activeCalls.get(data.roomId)?.participants || []),
        type: data.type,
        startedBy: data.username
      });
    });

    socket.on("join-room-call", (data: { roomId: string; username: string }) => {
      const call = activeCalls.get(data.roomId);
      if (call) {
        call.participants.add(data.username);
        io.to(data.roomId).emit("room-call-updated", { 
          roomId: data.roomId, 
          participants: Array.from(call.participants) 
        });
        socket.to(data.roomId).emit("user-joined-call", {
          roomId: data.roomId,
          username: data.username,
          socketId: socket.id
        });
      }
    });

    socket.on("leave-room-call", (data: { roomId: string; username: string }) => {
      const call = activeCalls.get(data.roomId);
      if (call) {
        call.participants.delete(data.username);
        if (call.participants.size === 0) {
          activeCalls.delete(data.roomId);
          io.to(data.roomId).emit("room-call-ended", { roomId: data.roomId });
        } else {
          io.to(data.roomId).emit("room-call-updated", { 
            roomId: data.roomId, 
            participants: Array.from(call.participants) 
          });
          socket.to(data.roomId).emit("user-left-call", {
            roomId: data.roomId,
            username: data.username,
            socketId: socket.id
          });
        }
      }
    });

    socket.on("get-recent-chats", (username: string) => {
      // Find all distinct rooms where the user sent or received a message
      const recentMessages = db.prepare(`
        SELECT room, sender, content, timestamp 
        FROM messages 
        WHERE room LIKE ? OR room LIKE ? 
        ORDER BY timestamp DESC
      `).all(`%${username}%`, `%${username}%`) as any[];

      const recentChatsMap = new Map();
      recentMessages.forEach(msg => {
        // Only consider private rooms (format: user1--user2)
        if (msg.room.includes('--')) {
          const users = msg.room.split('--');
          if (users.includes(username) && users.length === 2) {
            const otherUser = users[0] === username ? users[1] : users[0];
            if (!recentChatsMap.has(otherUser)) {
              const profile = db.prepare("SELECT avatar_url FROM profiles WHERE username = ?").get(otherUser) as any;
              
              // Calculate unread count
              const lastRead = db.prepare("SELECT last_read_at FROM last_read WHERE username = ? AND room = ?").get(username, msg.room) as any;
              let unreadCount = 0;
              if (lastRead) {
                const countResult = db.prepare("SELECT COUNT(*) as count FROM messages WHERE room = ? AND timestamp > ? AND sender != ?").get(msg.room, lastRead.last_read_at, username) as any;
                unreadCount = countResult ? countResult.count : 0;
              } else {
                const countResult = db.prepare("SELECT COUNT(*) as count FROM messages WHERE room = ? AND sender != ?").get(msg.room, username) as any;
                unreadCount = countResult ? countResult.count : 0;
              }

              recentChatsMap.set(otherUser, {
                username: otherUser,
                lastMessage: msg.content,
                timestamp: msg.timestamp,
                avatar_url: profile?.avatar_url || '',
                room: msg.room,
                unreadCount: unreadCount
              });
            }
          }
        }
      });
      socket.emit("recent-chats", Array.from(recentChatsMap.values()));
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

    socket.on("toggle-favorite", (data: { messageId: number; isFavorite: boolean; username: string }) => {
      if (data.isFavorite) {
        db.prepare("INSERT OR IGNORE INTO favorites (username, message_id) VALUES (?, ?)").run(data.username, data.messageId);
      } else {
        db.prepare("DELETE FROM favorites WHERE username = ? AND message_id = ?").run(data.username, data.messageId);
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

    socket.on("update-profile", (data: { username: string; nickname?: string; bio?: string; avatar_url?: string }) => {
      const existing = db.prepare("SELECT * FROM profiles WHERE username = ?").get(data.username);
      if (existing) {
        db.prepare("UPDATE profiles SET nickname = COALESCE(?, nickname), bio = COALESCE(?, bio), avatar_url = COALESCE(?, avatar_url) WHERE username = ?")
          .run(data.nickname, data.bio, data.avatar_url, data.username);
      } else {
        db.prepare("INSERT INTO profiles (username, nickname, bio, avatar_url) VALUES (?, ?, ?, ?)")
          .run(data.username, data.nickname || '', data.bio || '', data.avatar_url || '');
      }
      const profile = db.prepare("SELECT * FROM profiles WHERE username = ?").get(data.username);
      socket.emit("profile-updated", profile);
    });

    socket.on("get-profile", (username: string) => {
      let profile = db.prepare("SELECT * FROM profiles WHERE username = ?").get(username);
      if (!profile) {
        profile = { username, nickname: '', bio: 'Digital architect and P2P enthusiast.', avatar_url: '' };
      }
      socket.emit("profile-data", profile);
    });

    socket.on("create-story", (data: { username: string; media_url: string; media_type: string }) => {
      const user: any = db.prepare("SELECT * FROM users WHERE username = ?").get(data.username);
      if (user && user.is_premium) {
        db.prepare("INSERT INTO stories (username, media_url, media_type, expires_at) VALUES (?, ?, ?, datetime('now', '+24 hours'))").run(data.username, data.media_url, data.media_type);
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
      let settings = db.prepare("SELECT * FROM user_settings WHERE username = ?").get(username);
      if (!settings) {
        settings = {
          username,
          notifications_private: 1,
          notifications_groups: 1,
          notifications_calls: 1,
          badge_muted: 0,
          p2p_calls: 1,
          language: 'English',
          auto_media_mobile: 1,
          auto_media_wifi: 1
        };
        db.prepare("INSERT INTO user_settings (username) VALUES (?)").run(username);
      }
      socket.emit("settings-data", settings);
    });

    socket.on("update-settings", (data: { username: string; [key: string]: any }) => {
      const { username, ...settings } = data;
      const keys = Object.keys(settings);
      const values = Object.values(settings);
      const setClause = keys.map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE user_settings SET ${setClause} WHERE username = ?`).run(...values, username);
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
      
      // If it's a DM, notify both users about the active chat update
      if (!room.startsWith('group-')) {
        const partners = room.split('--');
        partners.forEach(p => {
          const targetSocketId = Array.from(users.entries()).find(([_, name]) => name === p)?.[0];
          if (targetSocketId) {
            const activeDMs = db.prepare(`
              SELECT DISTINCT room FROM messages 
              WHERE room LIKE ? AND room NOT LIKE 'group-%'
            `).all(`%${p}%`).map(r => {
              const parts = r.room.split('--');
              return parts.find(part => part !== p);
            }).filter(Boolean);
            io.to(targetSocketId).emit("active-dms", activeDMs);
          }
        });
      }

      // Broadcast to room
      io.to(room).emit("new-message", {
        id: result.lastInsertRowid,
        room,
        sender,
        content: filteredContent,
        timestamp: new Date().toISOString(),
        isFavorite: false,
        mediaUrl,
        mediaType
      });

      // AI Response if mentioned or in a specific way
      if (content.startsWith("/ai ")) {
        const prompt = content.replace("/ai ", "");
        try {
          // We call Gemini from the frontend usually, but for a "bot" experience, 
          // we can have the server emit a special event or just let the frontend handle it.
          // The guidelines say: "Always call Gemini API from the frontend code of the application. NEVER call Gemini API from the backend."
          // So I will handle the AI trigger in the frontend.
        } catch (e) {
          console.error("AI Error", e);
        }
      }
    });

    // WebRTC Signaling
    socket.on("call-user", (data: { to: string; offer: any; from: string; type: 'audio' | 'video' }) => {
      const targetSocketId = Array.from(users.entries()).find(([_, name]) => name === data.to)?.[0];
      if (targetSocketId) {
        io.to(targetSocketId).emit("call-made", {
          offer: data.offer,
          socket: socket.id,
          from: data.from,
          type: data.type,
          isGroup: false
        });
      }
    });

    socket.on("call-room", (data: { room: string; offer: any; from: string; type: 'audio' | 'video' }) => {
      socket.to(data.room).emit("call-made", {
        offer: data.offer,
        socket: socket.id,
        from: data.from,
        type: data.type,
        room: data.room,
        isGroup: true
      });
    });

    socket.on("make-answer", (data: { to: string; answer: any }) => {
      io.to(data.to).emit("answer-made", {
        socket: socket.id,
        answer: data.answer
      });
    });

    socket.on("ice-candidate", (data: { to: string; candidate: any }) => {
      io.to(data.to).emit("ice-candidate", {
        socket: socket.id,
        candidate: data.candidate
      });
    });

    socket.on("disconnect", () => {
      const username = users.get(socket.id);
      users.delete(socket.id);
      const userList = Array.from(users.entries()).map(([id, name]) => {
        const profile = db.prepare("SELECT nickname, bio, avatar_url FROM profiles WHERE username = ?").get(name) as any;
        const u = db.prepare("SELECT role, is_premium FROM users WHERE username = ?").get(name) as any;
        return { 
          id: name, 
          name: profile?.nickname || name, 
          nickname: profile?.nickname || '',
          bio: profile?.bio || '', 
          avatar_url: profile?.avatar_url || '',
          role: u?.role || 'user',
          is_premium: u?.is_premium || 0
        };
      });
      // Deduplicate userList by id
      const uniqueUserList = Array.from(new Map(userList.map(item => [item.id, item])).values());
      io.emit("user-list", uniqueUserList);
      console.log("User disconnected:", username);
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
