import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import dns from 'dns';
import mongoose from 'mongoose';
import 'dotenv/config';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());

// Serve static files from the Vite build directory when available
app.use(express.static(join(__dirname, 'dist')));

// Privacy Policy endpoints for Google Play & App Store Compliance
app.get(['/privacy', '/privacy-policy', '/privacy.html'], (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'privacy.html'));
});

// Account Deletion page for Google Play compliance
app.get(['/delete-account', '/delete-account.html', '/account-deletion'], (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'delete-account.html'));
});

// REST API for direct account deletion from web page
app.post('/api/delete-account', express.json(), async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, msg: 'Call-sign and password are required.' });
  }
  const cleanUsername = username.trim();
  const lookupKey = cleanUsername.toLowerCase();
  const user = await findUser(lookupKey);
  if (!user) {
    return res.status(404).json({ success: false, msg: 'Call-sign not found.' });
  }
  const inputHash = hashPassword(password, user.salt);
  if (inputHash !== user.passwordHash) {
    return res.status(401).json({ success: false, msg: 'Invalid password. Account deletion aborted.' });
  }

  // 1. Delete from MongoDB
  if (mongoose.connection.readyState === 1) {
    try {
      await UserModel.deleteOne({ lookupKey }).exec();
      console.log(`[AUTH] Web API deleted user from MongoDB: ${lookupKey}`);
    } catch (e) {
      console.warn("MongoDB delete error:", e.message);
    }
  }

  // 2. Delete from local JSON fallback
  const local = loadUsersLocal();
  if (local[lookupKey]) {
    delete local[lookupKey];
    saveUsersLocal(local);
  }

  return res.json({ success: true, msg: `Account "${cleanUsername}" and all associated data permanently deleted.` });
});

app.get('/api/db-status', async (req, res) => {
  const mongoStatus = mongoose.connection.readyState;
  const statusNames = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const localUsers = loadUsersLocal();
  let mongoUsers = [];
  let mongoError = null;

  if (mongoStatus === 1) {
    try {
      mongoUsers = await UserModel.find({}, { passwordHash: 0, salt: 0 }).lean().exec();
    } catch (e) {
      mongoError = e.message;
    }
  }

  res.json({
    timestamp: new Date().toISOString(),
    mongo: {
      status: statusNames[mongoStatus] || mongoStatus,
      readyState: mongoStatus,
      error: mongoError || lastMongoError,
      usersCount: mongoUsers.length,
      users: mongoUsers
    },
    local: {
      usersCount: Object.keys(localUsers).length,
      users: Object.values(localUsers).map(u => ({
        username: u.username,
        lookupKey: u.lookupKey,
        isVip: u.isVip,
        credits: u.credits,
        equippedSkin: u.equippedSkin,
        createdAt: u.createdAt
      }))
    }
  });
});

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ==========================================
// Cloud MongoDB Atlas & Local JSON Hybrid Database
// ==========================================
const DATA_DIR = join(__dirname, 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json');

if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error("Error creating data directory:", e);
  }
}

// Persistent Session Store (Survives Server Restarts)
function loadSessionsLocal() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      return new Map(Object.entries(data));
    }
  } catch (e) {
    console.error("Error loading sessions database:", e);
  }
  return new Map();
}

function saveSessionsLocal(sessionsMap) {
  try {
    const obj = Object.fromEntries(sessionsMap);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.error("Error saving sessions database:", e);
  }
}

const activeSessions = loadSessionsLocal();

// Mongoose User Schema with bufferCommands: false to prevent buffering hangs
const userSchema = new mongoose.Schema({
  lookupKey: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true },
  passwordHash: { type: String, required: true },
  salt: { type: String, required: true },
  isVip: { type: Boolean, default: false },
  credits: { type: Number, default: 100 },
  completedModes: { type: mongoose.Schema.Types.Mixed, default: {} },
  unlockedSkins: { type: [String], default: ['skin_default'] },
  equippedSkin: { type: String, default: 'skin_default' },
  preferredClass: { type: String, default: 'Random' },
  stats: {
    matchesPlayed: { type: Number, default: 0 },
    escapes: { type: Number, default: 0 },
    captures: { type: Number, default: 0 }
  },
  createdAt: { type: Date, default: Date.now }
}, { bufferCommands: false });

const UserModel = mongoose.models.User || mongoose.model('User', userSchema);

const DEFAULT_MONGODB_URI = 'mongodb+srv://arnavantigravity_db_user:Gcnemt5r4WAahQkb@manifestation.bwyipxp.mongodb.net/manifestation?retryWrites=true&w=majority&appName=Manifestation';

let isMongoConnected = false;
let isConnecting = false;
let lastMongoError = null;

async function tryMongoConnect() {
  if (isMongoConnected || isConnecting) return;
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  } catch (e) {}

  let uri = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;
  // If Render env has the deleted s7eou cluster, automatically override to active bwyipxp cluster!
  if (!uri || uri.includes('s7eou.mongodb.net')) {
    console.log("⚡ [MongoDB Atlas] Overriding stale s7eou cluster to active bwyipxp cluster!");
    uri = DEFAULT_MONGODB_URI;
  }
  try {
    isConnecting = true;
    await mongoose.connect(uri, { 
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });
    isMongoConnected = true;
    isConnecting = false;
    lastMongoError = null;
    console.log("🚀 [MongoDB Atlas] Connected successfully to cloud database!");
  } catch (err) {
    lastMongoError = err.message;
    isMongoConnected = false;
    isConnecting = false;
    console.warn("⚠️ [MongoDB Atlas] Cloud database connection attempt:", err.message);
  }
}

mongoose.connection.on('connected', () => {
  isMongoConnected = true;
  console.log("🚀 [MongoDB Atlas] Connection established.");
});

mongoose.connection.on('disconnected', () => {
  isMongoConnected = false;
  console.warn("⚠️ [MongoDB Atlas] Disconnected, attempting reconnect in 3s...");
  setTimeout(tryMongoConnect, 3000);
});

// Auto-connect to cloud MongoDB Atlas on server launch
tryMongoConnect();

// Local JSON fallback helpers
function loadUsersLocal() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error("Error loading users database:", e);
  }
  return {};
}

function saveUsersLocal(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (e) {
    console.error("Error saving users database:", e);
  }
}

async function findUser(lookupKey) {
  // If MongoDB is actively connecting, await up to 3.5s for readyState to become 1
  if (mongoose.connection.readyState === 2) {
    let waits = 0;
    while (mongoose.connection.readyState === 2 && waits < 35) {
      await new Promise(r => setTimeout(r, 100));
      waits++;
    }
  }

  if (mongoose.connection.readyState === 1) {
    try {
      const doc = await UserModel.findOne({ lookupKey }).exec();
      if (doc) return doc.toObject();
    } catch (e) {
      console.warn("MongoDB lookup error, falling back to local:", e.message);
    }
  } else {
    tryMongoConnect();
  }
  const local = loadUsersLocal();
  const user = local[lookupKey] || null;
  // If found in local cache and MongoDB is online, automatically migrate to cloud
  if (user && mongoose.connection.readyState === 1) {
    try {
      const doc = new UserModel(user);
      await doc.save();
    } catch (e) {}
  }
  return user;
}

async function createUser(userData) {
  if (mongoose.connection.readyState === 1) {
    try {
      const doc = new UserModel(userData);
      await doc.save();
    } catch (e) {
      console.warn("MongoDB create error, saving locally:", e.message);
    }
  } else {
    tryMongoConnect();
  }
  const local = loadUsersLocal();
  local[userData.lookupKey] = userData;
  saveUsersLocal(local);
  return userData;
}

async function updateUser(lookupKey, updates) {
  if (mongoose.connection.readyState === 1) {
    try {
      await UserModel.updateOne({ lookupKey }, { $set: updates }).exec();
    } catch (e) {
      console.warn("MongoDB update error, updating locally:", e.message);
    }
  } else {
    tryMongoConnect();
  }
  const local = loadUsersLocal();
  if (local[lookupKey]) {
    Object.assign(local[lookupKey], updates);
    saveUsersLocal(local);
    return local[lookupKey];
  }
  return null;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

function sanitizeUser(u) {
  return {
    username: u.username,
    isVip: !!u.isVip,
    credits: u.credits !== undefined ? u.credits : 100,
    completedModes: u.completedModes || {},
    unlockedSkins: Array.isArray(u.unlockedSkins) ? u.unlockedSkins : ['skin_default'],
    equippedSkin: u.equippedSkin || 'skin_default',
    preferredClass: u.preferredClass || 'Random',
    stats: u.stats || { matchesPlayed: 0, escapes: 0, captures: 0 },
    createdAt: u.createdAt
  };
}


// Lobby/Game State
// roomId -> roomState
const lobbies = {};

function calculateMazeSize(difficulty = 'medium') {
  if (difficulty === 'easy') return 21;
  if (difficulty === 'hard') return 41;
  if (difficulty === 'impossible') return 51;
  return 31; // medium
}

function calculateRequiredGhosts(humanCount, botsEnabled, difficulty = 'medium') {
  if (humanCount === 0) return 0;
  
  if (difficulty === 'easy') {
    // Formula: max(2, Humans × 1)
    return Math.min(50, Math.max(2, Math.ceil(humanCount * 1.0)));
  } else if (difficulty === 'hard') {
    // Formula: max(6, Humans × 3)
    return Math.min(50, Math.max(6, Math.ceil(humanCount * 3.0)));
  } else if (difficulty === 'impossible') {
    // Formula: max(8, Humans × 4)
    return Math.min(50, Math.max(8, Math.ceil(humanCount * 4.0)));
  } else {
    // Medium (default): Formula: max(3, Humans × 2)
    return Math.min(50, Math.max(3, humanCount * 2));
  }
}

function updateLobbyState(roomId) {
  const lobby = lobbies[roomId];
  if (!lobby) return;

  const playersList = Object.values(lobby.players);
  const humans = playersList.filter(p => p.team === 'Human');
  const humanCount = humans.length;
  
  const actualHumanGhostPlayers = playersList.filter(p => p.team === 'Ghost').length;

  // Calculate quota requirements
  const minRequiredGhosts = calculateRequiredGhosts(humanCount, lobby.settings.botsEnabled, lobby.settings.difficulty);
  lobby.settings.minGhostsRequired = minRequiredGhosts;

  let activeGhostsCount = actualHumanGhostPlayers;
  let botGhostsCount = 0;

  if (lobby.settings.botsEnabled) {
    // Fill the remainder of the minimum required ghosts with AI bots
    if (activeGhostsCount < minRequiredGhosts) {
      botGhostsCount = minRequiredGhosts - activeGhostsCount;
      activeGhostsCount = minRequiredGhosts;
    }
  }

  // Enforce max cap of 50 ghosts
  if (activeGhostsCount > 50) {
    activeGhostsCount = 50;
    if (lobby.settings.botsEnabled) {
      botGhostsCount = Math.max(0, 50 - actualHumanGhostPlayers);
    }
  }

  lobby.settings.ghostsCount = activeGhostsCount;
  lobby.settings.botGhostsCount = botGhostsCount;

  // Check start validation
  const mode = lobby.settings.roleSelectionMode;
  const isRandomOrHidden = (mode === 'random' || mode === 'hidden');
  const isQuotaFulfilled = isRandomOrHidden 
    ? (playersList.length > 0)
    : (activeGhostsCount >= minRequiredGhosts && (humanCount > 0 || actualHumanGhostPlayers > 0 || lobby.settings.botsEnabled));
  
  lobby.canStart = Boolean(isQuotaFulfilled && playersList.length > 0);

  // Broadcast updated lobby
  io.to(roomId).emit('lobby_update', lobby);
}

function checkMatchEndCondition(roomId) {
  const lobby = lobbies[roomId];
  if (!lobby || !lobby.gameStarted) return;

  const playersList = Object.values(lobby.players);
  const humans = playersList.filter(p => p.team === 'Human');
  const humanCount = humans.length;

  // Check victory / end conditions based on active, escaped, and captured humans
  if (humanCount > 0) {
    const activeHumans = humans.filter(p => !p.isCaptured && !p.hasEscaped);
    const escapedHumans = humans.filter(p => p.hasEscaped);
    if (activeHumans.length === 0) {
      if (escapedHumans.length > 0) {
        // At least one human escaped before all remaining were captured
        endMatch(roomId, 'Human');
      } else {
        // All humans were captured! Ghosts win!
        endMatch(roomId, 'Ghost');
      }
    }
  }
}

function endMatch(roomId, winner) {
  const lobby = lobbies[roomId];
  if (!lobby || !lobby.gameStarted) return;

  lobby.gameStarted = false;

  const summary = Object.values(lobby.players).map(p => ({
    username: p.username,
    team: p.team,
    isCaptured: !!p.isCaptured,
    hasEscaped: !!p.hasEscaped
  }));

  // Reset captured & escaped state on players
  Object.values(lobby.players).forEach(p => {
    p.isCaptured = false;
    p.hasEscaped = false;
  });

  io.to(roomId).emit('match_ended', { winner, summary });
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // ==========================================
  // Authentication & Persistent User Handlers
  // ==========================================
  socket.on('auth_register', async ({ username, password, bonusCredits }, callback) => {
    if (!username || !password || username.trim().length < 3 || password.length < 4) {
      return callback && callback({ success: false, msg: 'Call-sign must be at least 3 chars & password at least 4 chars.' });
    }
    const cleanUsername = username.trim();
    const lookupKey = cleanUsername.toLowerCase();
    const existing = await findUser(lookupKey);

    if (existing) {
      return callback && callback({ success: false, msg: 'Call-sign is already registered. Please login.' });
    }

    const bonus = Math.max(0, parseInt(bonusCredits) || 0);
    const initialCredits = 100 + bonus;

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const newUser = {
      lookupKey,
      username: cleanUsername,
      passwordHash,
      salt,
      isVip: false,
      credits: initialCredits, // 100 welcome bonus + level completion reward
      completedModes: {},
      unlockedSkins: ['skin_default'],
      equippedSkin: 'skin_default',
      preferredClass: 'Random',
      stats: { matchesPlayed: 0, escapes: 0, captures: 0 },
      createdAt: new Date().toISOString()
    };

    await createUser(newUser);

    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, lookupKey);
    saveSessionsLocal(activeSessions);

    console.log(`[AUTH] New Operative registered (Saved to Database): ${cleanUsername} with ${initialCredits} credits`);
    return callback && callback({ success: true, token, user: sanitizeUser(newUser) });
  });

  socket.on('auth_login', async ({ username, password }, callback) => {
    if (!username || !password) {
      return callback && callback({ success: false, msg: 'Please provide both username and password.' });
    }
    const cleanUsername = username.trim();
    const lookupKey = cleanUsername.toLowerCase();
    const user = await findUser(lookupKey);

    if (!user) {
      return callback && callback({ success: false, msg: 'Call-sign not found. Please register first.' });
    }

    const testHash = hashPassword(password, user.salt);
    if (testHash !== user.passwordHash) {
      return callback && callback({ success: false, msg: 'Invalid password for this call-sign.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, lookupKey);
    saveSessionsLocal(activeSessions);

    console.log(`[AUTH] Operative logged in: ${user.username}`);
    return callback && callback({ success: true, token, user: sanitizeUser(user) });
  });

  socket.on('auth_token_login', async ({ token }, callback) => {
    if (!token || !activeSessions.has(token)) {
      return callback && callback({ success: false, msg: 'Session expired or invalid.' });
    }
    const lookupKey = activeSessions.get(token);
    const user = await findUser(lookupKey);
    if (!user) {
      activeSessions.delete(token);
      saveSessionsLocal(activeSessions);
      return callback && callback({ success: false, msg: 'User profile not found.' });
    }
    return callback && callback({ success: true, token, user: sanitizeUser(user) });
  });

  socket.on('auth_logout', ({ token }, callback) => {
    if (token) {
      activeSessions.delete(token);
      saveSessionsLocal(activeSessions);
    }
    return callback && callback({ success: true });
  });

  socket.on('account_update_vip', async ({ token, isVip }, callback) => {
    if (!token || !activeSessions.has(token)) {
      return callback && callback({ success: false, msg: 'Unauthorized.' });
    }
    const lookupKey = activeSessions.get(token);
    const user = await findUser(lookupKey);
    if (user) {
      const updates = { isVip: !!isVip };
      if (isVip) {
        updates.credits = (user.credits || 0) + 500;
      }
      const updated = await updateUser(lookupKey, updates);
      return callback && callback({ success: true, user: sanitizeUser(updated || user) });
    }
  });

  socket.on('account_update_credits', async ({ token, credits }, callback) => {
    if (!token || !activeSessions.has(token)) return;
    const lookupKey = activeSessions.get(token);
    const newAmount = Math.max(0, parseInt(credits) || 0);
    await updateUser(lookupKey, { credits: newAmount });
    return callback && callback({ success: true, credits: newAmount });
  });

  socket.on('account_update_completed_modes', async ({ token, mode }, callback) => {
    if (!token || !activeSessions.has(token) || !mode) return;
    const lookupKey = activeSessions.get(token);
    const user = await findUser(lookupKey);
    if (user) {
      const completedModes = user.completedModes || {};
      completedModes[mode] = true;
      const updated = await updateUser(lookupKey, { completedModes });
      if (callback) callback({ success: true, completedModes: (updated && updated.completedModes) || completedModes });
    }
  });

  socket.on('account_update_skin', async ({ token, unlockedSkins, equippedSkin }, callback) => {
    if (!token || !activeSessions.has(token)) return;
    const lookupKey = activeSessions.get(token);
    const updates = {};
    if (Array.isArray(unlockedSkins)) updates.unlockedSkins = unlockedSkins;
    if (equippedSkin) updates.equippedSkin = equippedSkin;
    const updated = await updateUser(lookupKey, updates);
    return callback && callback({ success: true, user: sanitizeUser(updated) });
  });

  socket.on('account_update_username', async ({ token, newUsername }, callback) => {
    if (!token || !activeSessions.has(token)) {
      return callback && callback({ success: false, msg: 'Unauthorized.' });
    }
    if (!newUsername || newUsername.trim().length < 2) {
      return callback && callback({ success: false, msg: 'Call-sign must be at least 2 characters.' });
    }
    const cleanUsername = newUsername.trim();
    const newLookupKey = cleanUsername.toLowerCase();
    const oldLookupKey = activeSessions.get(token);

    if (newLookupKey !== oldLookupKey) {
      const existing = await findUser(newLookupKey);
      if (existing) {
        return callback && callback({ success: false, msg: 'Call-sign is already registered by another operative.' });
      }
    }

    const user = await findUser(oldLookupKey);
    if (!user) {
      return callback && callback({ success: false, msg: 'User profile not found.' });
    }

    // Update in MongoDB
    if (mongoose.connection.readyState === 1) {
      try {
        await UserModel.updateOne({ lookupKey: oldLookupKey }, { $set: { username: cleanUsername, lookupKey: newLookupKey } }).exec();
      } catch (e) {
        console.warn("MongoDB callsign update error:", e.message);
      }
    }

    // Update in local JSON database
    const local = loadUsersLocal();
    if (local[oldLookupKey]) {
      const existingData = local[oldLookupKey];
      delete local[oldLookupKey];
      existingData.username = cleanUsername;
      existingData.lookupKey = newLookupKey;
      local[newLookupKey] = existingData;
      saveUsersLocal(local);
    }

    activeSessions.set(token, newLookupKey);
    saveSessionsLocal(activeSessions);

    user.username = cleanUsername;
    user.lookupKey = newLookupKey;
    console.log(`[AUTH] Operative call-sign updated: ${cleanUsername}`);
    return callback && callback({ success: true, user: sanitizeUser(user) });
  });

  socket.on('auth_delete_account', async ({ token }, callback) => {
    if (!token || !activeSessions.has(token)) {
      return callback && callback({ success: false, msg: 'Unauthorized or expired session.' });
    }
    const lookupKey = activeSessions.get(token);
    const user = await findUser(lookupKey);
    if (!user) {
      return callback && callback({ success: false, msg: 'Account profile not found.' });
    }

    // 1. Delete from MongoDB
    if (mongoose.connection.readyState === 1) {
      try {
        await UserModel.deleteOne({ lookupKey }).exec();
        console.log(`[AUTH] Socket deleted user from MongoDB: ${lookupKey}`);
      } catch (e) {
        console.warn("MongoDB delete error:", e.message);
      }
    }

    // 2. Delete from local JSON fallback
    const local = loadUsersLocal();
    if (local[lookupKey]) {
      delete local[lookupKey];
      saveUsersLocal(local);
    }

    // 3. Purge session
    activeSessions.delete(token);
    saveSessionsLocal(activeSessions);

    console.log(`[AUTH] Account permanently deleted: ${lookupKey}`);
    return callback && callback({ success: true, msg: 'Account and associated data permanently deleted.' });
  });

  socket.on('join_public_matchmaking', ({ username, skinId, isVip }) => {
    // Find an open public lobby
    let targetRoomId = null;
    for (const [id, lobby] of Object.entries(lobbies)) {
      if (lobby.isPublic && !lobby.gameStarted && Object.keys(lobby.players).length < 20) {
        targetRoomId = id;
        break;
      }
    }
    
    // If none found, create a new one
    if (!targetRoomId) {
      targetRoomId = Math.floor(100000 + Math.random() * 900000).toString();
      socket.emit('matchmaking_status', { msg: 'Created new public lobby.' });
    } else {
      socket.emit('matchmaking_status', { msg: 'Found public lobby. Joining...' });
    }

    // Call join room with public flag
    joinRoomHandler(socket, { roomId: targetRoomId, username, skinId, isPublic: true, isVip });
  });

  socket.on('join_room', (data) => {
    joinRoomHandler(socket, data);
  });

  function joinRoomHandler(socket, { roomId, username, skinId = null, isPublic = false, isVip = false, difficulty = 'easy' }) {
    if (socket.roomId && socket.roomId !== roomId && lobbies[socket.roomId]) {
      delete lobbies[socket.roomId].players[socket.id];
      socket.leave(socket.roomId);
      updateLobbyState(socket.roomId);
    }

    socket.join(roomId);
    
    if (!lobbies[roomId]) {
      const validDiffs = ['easy', 'medium', 'hard', 'impossible'];
      const chosenDiff = (difficulty && validDiffs.includes(difficulty)) ? difficulty : 'easy';
      lobbies[roomId] = {
        id: roomId,
        isPublic: isPublic,
        players: {},
        settings: {
          difficulty: chosenDiff,
          botsEnabled: true,
          roleSelectionMode: 'manual', // 'manual', 'random', 'hidden'
          minGhostsRequired: 3,
          ghostsCount: 3,
          botGhostsCount: 3,
        },
        gameStarted: false,
        canStart: false,
        puzzleState: null,
      };
    } else if (lobbies[roomId].gameStarted) {
      // Allow rejoining players to wait in the lobby while the game is still active
      const lobby = lobbies[roomId];
      const isHost = Object.keys(lobby.players).length === 0;

      lobby.players[socket.id] = {
        id: socket.id,
        username: username || `Survivor #${Math.floor(1000 + Math.random() * 9000)}`,
        skinId: skinId,
        team: 'Human',
        characterClass: 'Locksmith',
        isHost: isHost,
        isReady: false,
        isVip: Boolean(isVip),
        isCaptured: true // Start captured so they don't prevent the match from ending
      };

      socket.emit('joined_room_success', { roomId, isPublic: lobby.isPublic });
      io.to(roomId).emit('lobby_update', lobby);
      return;
    }

    const lobby = lobbies[roomId];
    
    // De-duplicate: Clean up any old ghost/stale connection for this same username in the room
    const cleanUsername = username || `Survivor #${Math.floor(1000 + Math.random() * 9000)}`;
    const existingEntry = Object.entries(lobby.players).find(([sId, p]) => p.username === cleanUsername && sId !== socket.id);
    
    let isHost = Object.keys(lobby.players).length === 0;
    let isReady = isHost;
    let team = 'Human';
    let characterClass = 'Locksmith';
    let isVipPlayer = Boolean(isVip);

    if (existingEntry) {
      const [oldId, oldPlayer] = existingEntry;
      isHost = oldPlayer.isHost;
      isReady = oldPlayer.isReady || isHost;
      team = oldPlayer.team || 'Human';
      characterClass = oldPlayer.characterClass || 'Locksmith';
      isVipPlayer = oldPlayer.isVip !== undefined ? oldPlayer.isVip : Boolean(isVip);
      delete lobby.players[oldId];
    }

    lobby.players[socket.id] = {
      id: socket.id,
      username: cleanUsername,
      skinId: skinId,
      team,
      characterClass,
      isHost,
      isReady,
      isVip: isVipPlayer,
    };

    socket.roomId = roomId;
    updateLobbyState(roomId);
    socket.emit('joined_room_success', { roomId, isPublic: lobby.isPublic });
  }

  socket.on('update_player', (updates) => {
    const { roomId } = socket;
    if (!roomId || !lobbies[roomId]) return;

    const lobby = lobbies[roomId];
    const player = lobby.players[socket.id];
    if (!player) return;

    if (lobby.settings.roleSelectionMode === 'manual') {
      if (updates.team !== undefined) player.team = updates.team;
      if (updates.characterClass !== undefined) player.characterClass = updates.characterClass;
    }
    if (updates.isReady !== undefined) player.isReady = updates.isReady;
    if (updates.isVip !== undefined) player.isVip = updates.isVip;
    if (updates.skinId !== undefined) player.skinId = updates.skinId;

    updateLobbyState(roomId);
  });

  socket.on('update_settings', (settings) => {
    const { roomId } = socket;
    if (!roomId || !lobbies[roomId]) return;

    const player = lobbies[roomId].players[socket.id];
    if (!player || !player.isHost) return;

    if (settings.difficulty !== undefined) lobbies[roomId].settings.difficulty = settings.difficulty;
    if (settings.botsEnabled !== undefined) lobbies[roomId].settings.botsEnabled = settings.botsEnabled;
    if (settings.roleSelectionMode !== undefined) lobbies[roomId].settings.roleSelectionMode = settings.roleSelectionMode;
    if (settings.isTutorial !== undefined) lobbies[roomId].settings.isTutorial = settings.isTutorial;
    if (settings.totalBreakers !== undefined) lobbies[roomId].settings.totalBreakers = settings.totalBreakers;
    if (settings.ghostsCount !== undefined) lobbies[roomId].settings.ghostsCount = settings.ghostsCount;
    if (settings.botGhostsCount !== undefined) lobbies[roomId].settings.botGhostsCount = settings.botGhostsCount;

    updateLobbyState(roomId);
  });

  socket.on('start_match', () => {
    const { roomId } = socket;
    if (!roomId || !lobbies[roomId]) return;

    const player = lobbies[roomId].players[socket.id];
    if (!player || !player.isHost || !lobbies[roomId].canStart) return;

    const lobby = lobbies[roomId];
    lobby.gameStarted = true;

    const playersList = Object.values(lobby.players);
    playersList.forEach(p => {
      p.isCaptured = false;
      p.hasEscaped = false;
    });

    const mode = lobby.settings.roleSelectionMode;

    const humanClasses = ['Locksmith', 'Trapper', 'Scout', 'Medic', 'Flashlight Expert', 'Quartermaster'];
    const ghostClasses = ['Stalker', 'Mimic', 'Juggernaut', 'Phantom', 'Poltergeist', 'Banshee'];

    if (mode === 'random' || mode === 'hidden') {
      playersList.forEach(p => {
        p.team = Math.random() > 0.7 ? 'Ghost' : 'Human';
        if (p.team === 'Human') {
          p.characterClass = humanClasses[Math.floor(Math.random() * humanClasses.length)];
        } else {
          p.characterClass = ghostClasses[Math.floor(Math.random() * ghostClasses.length)];
        }
      });

      // Ensure there is at least one Human player in the match to prevent 0 humans lobbies
      const humanCountAfterRandom = playersList.filter(p => p.team === 'Human').length;
      if (humanCountAfterRandom === 0 && playersList.length > 0) {
        const luckyPlayer = playersList[Math.floor(Math.random() * playersList.length)];
        luckyPlayer.team = 'Human';
        luckyPlayer.characterClass = humanClasses[Math.floor(Math.random() * humanClasses.length)];
      }
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const keysCount = 4; // Always exactly 4 keys, 2 real
    const realKeyIndexes = [];
    while (realKeyIndexes.length < 2) {
      const idx = Math.floor(Math.random() * keysCount);
      if (!realKeyIndexes.includes(idx)) {
        realKeyIndexes.push(idx);
      }
    }

    const keySymbols = ['Amber Key', 'Sapphire Key', 'Violet Key', 'Emerald Key', 'Ruby Key', 'Topaz Key', 'Opal Key', 'Quartz Key', 'Onyx Key', 'Pearl Key'];
    const keys = [];
    for (let i = 0; i < keysCount; i++) {
      keys.push({
        id: `key_${i}`,
        symbol: keySymbols[i],
        isReal: realKeyIndexes.includes(i),
        isFound: false,
        carriedBy: null,
      });
    }

    const diff = lobby.settings.difficulty || 'medium';
    let totalBreakers = 3;
    if (lobby.settings.isTutorial || lobby.settings.totalBreakers === 1) totalBreakers = 1;
    else if (diff === 'easy') totalBreakers = 2;
    else if (diff === 'hard') totalBreakers = 4;
    else if (diff === 'impossible') totalBreakers = 6;
    if (lobby.settings.isTutorial) {
      lobby.settings.ghostsCount = 0;
      lobby.settings.botGhostsCount = 0;
    } else {
      const playersList = Object.values(lobby.players);
      const humanCount = playersList.filter(p => p.team === 'Human').length;
      const ghostCount = playersList.filter(p => p.team === 'Ghost').length;
      const requiredGhosts = calculateRequiredGhosts(humanCount, lobby.settings.botsEnabled, diff);
      lobby.settings.minGhostsRequired = requiredGhosts;
      let activeGhosts = ghostCount;
      let botGhosts = 0;
      if (lobby.settings.botsEnabled) {
        if (activeGhosts < requiredGhosts) {
          botGhosts = requiredGhosts - activeGhosts;
          activeGhosts = requiredGhosts;
        }
      }
      lobby.settings.ghostsCount = activeGhosts;
      lobby.settings.botGhostsCount = botGhosts;
    }
    const mazeSize = calculateMazeSize(diff);

    lobby.puzzleState = {
      cipherCode: code,
      cipherSolved: false,
      incorrectCodePenaltyActive: false,
      securityLockoutActive: false,
      keys,
      realKeySymbols: realKeyIndexes.map(idx => keySymbols[idx]),
      puzzleRoomsSolved: 0,
      mazeGeometrySeed: Math.random(),
      difficulty: diff,
      totalBreakers: totalBreakers,
      mazeSize: mazeSize,
    };

    io.to(roomId).emit('match_started', {
      id: roomId,
      isMultiplayer: true,
      players: lobby.players,
      settings: lobby.settings,
      puzzleState: {
        keysCount: keys.length,
        cipherSolved: false,
        // Always send which 2 symbols are the real functional keys
        realKeySymbols: lobby.puzzleState.realKeySymbols,
        // Each index is one digit of the 4-digit code, revealed by clue notes in the maze
        codeDigits: code.split('').map(Number),
        mazeGeometrySeed: lobby.puzzleState.mazeGeometrySeed,
        difficulty: diff,
        totalBreakers: totalBreakers,
        mazeSize: mazeSize,
      }
    });

    console.log(`Match started for Room ${roomId} on difficulty: ${diff} (Map Size: ${mazeSize}x${mazeSize}, ${totalBreakers} breakers, ${lobby.settings.ghostsCount} ghosts).`);
  });

  socket.on('try_cipher', (inputCode) => {
    const { roomId } = socket;
    console.log(`[Lobby ${roomId}] Player tried keypad code: ${inputCode}`);
    const lobby = lobbies[roomId];
    if (!lobby || !lobby.puzzleState || lobby.puzzleState.securityLockoutActive) return;

    const pState = lobby.puzzleState;
    if (inputCode === pState.cipherCode) {
      pState.cipherSolved = true;
      io.to(roomId).emit('cipher_solved', {
        realKeySymbols: pState.realKeySymbols
      });
    } else {
      pState.incorrectCodePenaltyActive = true;
      pState.securityLockoutActive = true;

      io.to(roomId).emit('cipher_failed_penalty', { cooldownSeconds: 30, revealSeconds: 10 });

      setTimeout(() => {
        if (lobbies[roomId] && lobbies[roomId].puzzleState) {
          lobbies[roomId].puzzleState.securityLockoutActive = false;
          io.to(roomId).emit('security_cooldown_ended');
        }
      }, 30000);

      setTimeout(() => {
        if (lobbies[roomId] && lobbies[roomId].puzzleState) {
          lobbies[roomId].puzzleState.incorrectCodePenaltyActive = false;
          io.to(roomId).emit('reveal_ended');
        }
      }, 10000);
    }
  });

  socket.on('solve_puzzle_room', (data) => {
    const { roomId } = socket;
    const lobby = lobbies[roomId];
    if (!lobby || !lobby.puzzleState) return;

    if (!lobby.puzzleState.discoveredKeyIds) {
      lobby.puzzleState.discoveredKeyIds = new Set();
    }
    const keyId = data && data.keyId;
    if (keyId) {
      if (lobby.puzzleState.discoveredKeyIds.has(keyId)) {
        console.log(`[Lobby ${roomId}] Key ${keyId} was already discovered previously! Ignoring realignment.`);
        return;
      }
      lobby.puzzleState.discoveredKeyIds.add(keyId);
    }

    lobby.puzzleState.puzzleRoomsSolved++;
    console.log(`[Lobby ${roomId}] NEW key retrieved (${keyId || 'untracked'})! Total new keys: ${lobby.puzzleState.puzzleRoomsSolved}. Triggering corridor realignment...`);
    io.to(roomId).emit('corridor_realignment', {
      puzzleRoomsSolved: lobby.puzzleState.puzzleRoomsSolved,
      newSeed: Math.random()
    });
  });

  socket.on('clue_collected', ({ digitIndex }) => {
    const { roomId } = socket;
    socket.to(roomId).emit('clue_collected_sync', { digitIndex });
  });

  socket.on('key_picked_up', ({ keyId }) => {
    const { roomId } = socket;
    socket.to(roomId).emit('key_picked_up_sync', { keyId });
  });

  socket.on('player_movement', (moveData) => {
    const lobby = lobbies[socket.roomId];
    if (lobby && lobby.players[socket.id]) {
      lobby.players[socket.id].lastPosition = moveData.position;
    }
    socket.to(socket.roomId).emit('player_moved', { id: socket.id, ...moveData });
  });

  socket.on('inventory_update', ({ inventory, carriedKeys }) => {
    const lobby = lobbies[socket.roomId];
    if (lobby && lobby.players[socket.id]) {
      lobby.players[socket.id].inventory = inventory;
      lobby.players[socket.id].carriedKeys = carriedKeys;
    }
  });

  socket.on('panic_hide', () => {
    console.log(`[Lobby ${socket.roomId}] Player ${socket.id} activated Invisibility.`);
    socket.to(socket.roomId).emit('player_panicked', { id: socket.id, isPanicked: true });
  });

  socket.on('invisibility_ended', () => {
    socket.to(socket.roomId).emit('player_panicked', { id: socket.id, isPanicked: false });
  });

  socket.on('damage_human', (payload) => {
    const { targetId, amount } = payload || {};
    const { roomId } = socket;
    if (!roomId) return;
    io.to(roomId).emit('human_damaged', {
      targetId,
      amount: amount || 35,
      attackerId: socket.id
    });
  });

  socket.on('capture_human', (payload) => {
    const { targetId, position, rotation, username, characterClass, skinId } = payload || {};
    console.log(`[Lobby ${socket.roomId}] Player ${targetId} captured.`);
    const lobby = lobbies[socket.roomId];
    if (lobby && lobby.players[targetId]) {
      lobby.players[targetId].isCaptured = true;
    }
    socket.to(socket.roomId).emit('human_captured', { 
      targetId, 
      capturerId: socket.id,
      position,
      rotation,
      username: username || (lobby && lobby.players[targetId]?.username) || 'Operative',
      characterClass: characterClass || (lobby && lobby.players[targetId]?.characterClass) || 'Survivor',
      skinId: skinId || (lobby && lobby.players[targetId]?.skinId)
    });
    checkMatchEndCondition(socket.roomId);
  });

  socket.on('key_dropped', (data) => {
    socket.to(socket.roomId).emit('key_dropped_sync', data);
  });

  socket.on('insert_gate_key', ({ symbol }) => {
    const { roomId } = socket;
    const lobby = lobbies[roomId];
    if (!lobby || !lobby.puzzleState) return;
    if (!lobby.puzzleState.insertedKeys) lobby.puzzleState.insertedKeys = [];
    if (!lobby.puzzleState.insertedKeys.includes(symbol)) {
      lobby.puzzleState.insertedKeys.push(symbol);
    }
    const installerName = (lobby.players[socket.id] && lobby.players[socket.id].username) || 'Operative';
    console.log(`[Lobby ${roomId}] Key [${symbol}] inserted into Master Gate by ${installerName}. Total: ${lobby.puzzleState.insertedKeys.length}/2`);
    io.to(roomId).emit('gate_key_inserted_sync', {
      symbol,
      insertedKeys: lobby.puzzleState.insertedKeys,
      installerName
    });
  });

  socket.on('revive_player', ({ targetId, position }) => {
    const { roomId } = socket;
    const lobby = lobbies[roomId];
    if (!lobby) return;
    if (lobby.players[targetId]) {
      lobby.players[targetId].isCaptured = false;
      if (position) {
        lobby.players[targetId].x = position.x;
        lobby.players[targetId].y = position.y;
        lobby.players[targetId].z = position.z;
      }
    }
    const medicName = (lobby.players[socket.id] && lobby.players[socket.id].username) || 'Medic';
    const revivedName = (lobby.players[targetId] && lobby.players[targetId].username) || 'Survivor';
    console.log(`[Lobby ${roomId}] Medic ${medicName} revived fallen player ${revivedName}.`);
    io.to(roomId).emit('player_revived_sync', {
      targetId,
      medicName,
      revivedName,
      position
    });
    io.to(roomId).emit('chat_message', { msg: `[SYSTEM]: Medic ${medicName} revived Operative ${revivedName}!` });
  });

  socket.on('human_escaped', () => {
    const { roomId } = socket;
    const lobby = lobbies[roomId];
    if (!lobby || !lobby.gameStarted) return;

    const player = lobby.players[socket.id];
    if (!player || player.team !== 'Human' || player.hasEscaped) return;

    player.hasEscaped = true;
    const username = player.username || 'Operative';

    const humans = Object.values(lobby.players).filter(p => p.team === 'Human');
    const activeRemaining = humans.filter(p => !p.isCaptured && !p.hasEscaped);
    const escapedHumans = humans.filter(p => p.hasEscaped);

    console.log(`[Lobby ${roomId}] Operative ${username} escaped through the Vault! (${escapedHumans.length}/${humans.length} escaped, ${activeRemaining.length} remaining in maze)`);

    if (activeRemaining.length > 0) {
      io.to(roomId).emit('player_escaped_sync', {
        id: socket.id,
        username,
        remainingCount: activeRemaining.length,
        totalHumans: humans.length,
        escapedCount: escapedHumans.length
      });
      io.to(roomId).emit('chat_message', {
        msg: `[SYSTEM]: Operative ${username} escaped through the Vault! ${activeRemaining.length} survivor(s) remaining!`
      });
    } else {
      // All remaining humans have now escaped! Full victory!
      io.to(roomId).emit('chat_message', {
        msg: `[SYSTEM]: All surviving operatives have escaped through the Master Gate!`
      });
      endMatch(roomId, 'Human');
    }
  });

  socket.on('mimic_clone', () => {
    console.log(`[Lobby ${socket.roomId}] Player ${socket.id} (Mimic) engaged Clone.`);
    socket.to(socket.roomId).emit('ghost_mimic_clone', { id: socket.id });
  });

  socket.on('breaker_siphon', (data) => {
    console.log(`[Lobby ${socket.roomId}] Player ${socket.id} (Poltergeist) used Breaker Siphon.`);
    socket.to(socket.roomId).emit('ghost_breaker_siphon', { id: socket.id, position: data ? data.position : null });
  });

  socket.on('breaker_remote', () => {
    console.log(`[Lobby ${socket.roomId}] Player ${socket.id} used Breaker Remote.`);
    socket.to(socket.roomId).emit('breaker_remote_triggered');
  });

  socket.on('breaker_fixed', ({ breakerId }) => {
    socket.to(socket.roomId).emit('breaker_fixed_sync', { breakerId });
  });

  socket.on('sound_scramble', (data) => {
    console.log(`[Lobby ${socket.roomId}] Player ${socket.id} (Banshee) used Sound Scramble.`);
    socket.to(socket.roomId).emit('ghost_sound_scramble', { id: socket.id, position: data ? data.position : null });
  });

  socket.on('item_dropped', (data) => {
    console.log(`[Lobby ${socket.roomId}] Player ${socket.id} dropped item ${data.name}.`);
    socket.to(socket.roomId).emit('item_dropped_sync', data);
  });

  socket.on('item_picked_up', (data) => {
    socket.to(socket.roomId).emit('item_picked_up_sync', data);
  });

  socket.on('chalk_spray', ({ position }) => {
    console.log(`[Lobby ${socket.roomId}] Player ${socket.id} used Chalk Spray at [${position.x.toFixed(1)}, ${position.z.toFixed(1)}].`);
    socket.to(socket.roomId).emit('human_chalk_spray', { id: socket.id, position });
  });

  socket.on('sound_produced', ({ volume, position }) => {
    console.log(`[Lobby ${socket.roomId}] Microphone Audio detected (Volume: ${volume.toFixed(2)}) - Ghosts alerted to [X:${position.x.toFixed(1)}, Z:${position.z.toFixed(1)}]`);
    socket.to(socket.roomId).emit('sound_beacon', { producerId: socket.id, volume, position });
  });

  socket.on('chat_message', ({ msg }) => {
    const { roomId } = socket;
    console.log(`[Lobby ${roomId}] Chat: ${msg}`);
    if (!roomId || !lobbies[roomId]) return;
    const player = lobbies[roomId].players[socket.id];
    if (!player) return;
    io.to(roomId).emit('chat_broadcast', {
      username: player.username,
      msg,
      team: player.team
    });
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    const { roomId } = socket;
    if (roomId && lobbies[roomId]) {
      const lobby = lobbies[roomId];
      const leftPlayer = lobby.players[socket.id];
      delete lobby.players[socket.id];

      // Drop player's items and keys if game is active
      if (lobby.gameStarted && leftPlayer && leftPlayer.lastPosition && leftPlayer.team === 'Human') {
        const dropList = [];
        if (leftPlayer.inventory) {
          leftPlayer.inventory.forEach(itemName => {
            if (itemName && itemName !== '') dropList.push({ type: 'item', name: itemName });
          });
        }
        if (leftPlayer.carriedKeys) {
          leftPlayer.carriedKeys.forEach(key => {
            dropList.push({ type: 'key', key: key });
          });
        }

        const totalD = dropList.length;
        dropList.forEach((drop, idx) => {
          const angle = totalD > 1 ? (idx / totalD) * Math.PI * 2 : 0;
          const radius = totalD > 1 ? 0.9 : 0;
          const pos = {
            x: (leftPlayer.lastPosition.x || 0) + Math.cos(angle) * radius,
            y: 0.35,
            z: (leftPlayer.lastPosition.z || 0) + Math.sin(angle) * radius
          };

          if (drop.type === 'item') {
            io.to(roomId).emit('item_dropped_sync', {
              id: 'item_' + Math.random().toString(36).substr(2, 9),
              name: drop.name,
              position: pos
            });
          } else {
            io.to(roomId).emit('key_dropped_sync', {
              typeName: drop.key.typeName,
              symbol: drop.key.symbol,
              position: pos
            });
          }
        });
      }

      const remainingPlayers = Object.keys(lobby.players);

      if (remainingPlayers.length === 0) {
        delete lobbies[roomId];
        console.log(`Room ${roomId} deleted (empty)`);
      } else {
        if (leftPlayer && leftPlayer.isHost) {
          const newHostId = remainingPlayers[0];
          lobby.players[newHostId].isHost = true;
          lobby.players[newHostId].isReady = true;
          io.to(roomId).emit('host_changed', { hostId: newHostId });
        }
        updateLobbyState(roomId);
        if (lobby.gameStarted) {
          checkMatchEndCondition(roomId);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Multiplayer Game Server running on port ${PORT}`);
});
