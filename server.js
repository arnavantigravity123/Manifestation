import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());

// Serve static files from the Vite build directory when available
app.use(express.static(join(__dirname, 'dist')));

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Lobby/Game State
// roomId -> roomState
const lobbies = {};

function calculateRequiredGhosts(humanCount, botsEnabled) {
  if (humanCount === 0) return 0;
  if (humanCount === 1 && botsEnabled) {
    return 3; // Single-player baseline: Minimum of 3 AI Ghosts in Solo Mode
  }
  return Math.min(50, humanCount * 2); // Core scaling formula: Humans * 2, capped at 50
}

function updateLobbyState(roomId) {
  const lobby = lobbies[roomId];
  if (!lobby) return;

  const playersList = Object.values(lobby.players);
  const humans = playersList.filter(p => p.team === 'Human');
  const humanCount = humans.length;
  
  const actualHumanGhostPlayers = playersList.filter(p => p.team === 'Ghost').length;

  // Calculate quota requirements
  const minRequiredGhosts = calculateRequiredGhosts(humanCount, lobby.settings.botsEnabled);
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
  const isQuotaFulfilled = activeGhostsCount >= minRequiredGhosts && humanCount > 0;
  lobby.canStart = isQuotaFulfilled;

  // Broadcast updated lobby
  io.to(roomId).emit('lobby_update', lobby);
}

function checkMatchEndCondition(roomId) {
  const lobby = lobbies[roomId];
  if (!lobby || !lobby.gameStarted) return;

  const playersList = Object.values(lobby.players);
  const humans = playersList.filter(p => p.team === 'Human');
  const humanCount = humans.length;
  
  if (humanCount > 0) {
    const activeHumans = humans.filter(p => !p.isCaptured);
    if (activeHumans.length === 0) {
      // All humans captured! Ghosts win!
      endMatch(roomId, 'Ghost');
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
    isCaptured: !!p.isCaptured
  }));

  // Reset captured state on players
  Object.values(lobby.players).forEach(p => {
    p.isCaptured = false;
  });

  io.to(roomId).emit('match_ended', { winner, summary });
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('join_public_matchmaking', ({ username }) => {
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
      targetRoomId = `public-${Math.floor(10000 + Math.random() * 90000)}`;
      socket.emit('matchmaking_status', { msg: 'Created new public lobby.' });
    } else {
      socket.emit('matchmaking_status', { msg: 'Found public lobby. Joining...' });
    }

    // Call join room with public flag
    joinRoomHandler(socket, { roomId: targetRoomId, username, isPublic: true });
  });

  socket.on('join_room', (data) => {
    joinRoomHandler(socket, data);
  });

  function joinRoomHandler(socket, { roomId, username, isPublic = false }) {
    socket.join(roomId);
    
    if (!lobbies[roomId]) {
      lobbies[roomId] = {
        id: roomId,
        isPublic: isPublic,
        players: {},
        settings: {
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
      socket.emit('error_message', { msg: "Cannot join, game has already started." });
      socket.leave(roomId);
      return;
    }

    const lobby = lobbies[roomId];
    const isHost = Object.keys(lobby.players).length === 0;

    lobby.players[socket.id] = {
      id: socket.id,
      username: username || `Survivor #${Math.floor(1000 + Math.random() * 9000)}`,
      team: 'Human', // Default team
      characterClass: 'Locksmith', // Default subclass
      isHost,
      isReady: isHost, // Host is ready by default
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

    updateLobbyState(roomId);
  });

  socket.on('update_settings', (settings) => {
    const { roomId } = socket;
    if (!roomId || !lobbies[roomId]) return;

    const player = lobbies[roomId].players[socket.id];
    if (!player || !player.isHost) return;

    if (settings.botsEnabled !== undefined) lobbies[roomId].settings.botsEnabled = settings.botsEnabled;
    if (settings.roleSelectionMode !== undefined) lobbies[roomId].settings.roleSelectionMode = settings.roleSelectionMode;

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
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const keysCount = Math.floor(6 + Math.random() * 5);
    const realKeyIndexes = [];
    while (realKeyIndexes.length < 2) {
      const idx = Math.floor(Math.random() * keysCount);
      if (!realKeyIndexes.includes(idx)) {
        realKeyIndexes.push(idx);
      }
    }

    const keySymbols = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];
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

    lobby.puzzleState = {
      cipherCode: code,
      cipherSolved: false,
      incorrectCodePenaltyActive: false,
      securityLockoutActive: false,
      keys,
      realKeySymbols: realKeyIndexes.map(idx => keySymbols[idx]),
      puzzleRoomsSolved: 0,
      mazeGeometrySeed: Math.random(),
    };

    io.to(roomId).emit('match_started', {
      players: lobby.players,
      settings: lobby.settings,
      puzzleState: {
        keysCount: keys.length,
        cipherSolved: false,
        realKeySymbols: mode === 'hidden' ? [] : undefined,
      }
    });

    console.log(`Match started for Room ${roomId}.`);
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

  socket.on('solve_puzzle_room', () => {
    const { roomId } = socket;
    console.log(`[Lobby ${roomId}] Key retrieved! Triggering corridor realignment...`);
    const lobby = lobbies[roomId];
    if (!lobby || !lobby.puzzleState) return;

    lobby.puzzleState.puzzleRoomsSolved++;
    io.to(roomId).emit('corridor_realignment', {
      puzzleRoomsSolved: lobby.puzzleState.puzzleRoomsSolved,
      newSeed: Math.random()
    });
  });

  socket.on('player_movement', (moveData) => {
    socket.to(socket.roomId).emit('player_moved', { id: socket.id, ...moveData });
  });

  socket.on('panic_hide', () => {
    console.log(`[Lobby ${socket.roomId}] Player ${socket.id} engaged Panic Hide.`);
    socket.to(socket.roomId).emit('player_panicked', { id: socket.id });
  });

  socket.on('capture_human', ({ targetId }) => {
    console.log(`[Lobby ${socket.roomId}] Player ${targetId} captured.`);
    const lobby = lobbies[socket.roomId];
    if (lobby && lobby.players[targetId]) {
      lobby.players[targetId].isCaptured = true;
    }
    socket.to(socket.roomId).emit('human_captured', { targetId, capturerId: socket.id });
    checkMatchEndCondition(socket.roomId);
  });

  socket.on('human_escaped', () => {
    const { roomId } = socket;
    if (roomId && lobbies[roomId]) {
      endMatch(roomId, 'Human');
    }
  });

  socket.on('mimic_clone', () => {
    console.log(`[Lobby ${socket.roomId}] Player ${socket.id} (Mimic) engaged Clone.`);
    socket.to(socket.roomId).emit('ghost_mimic_clone', { id: socket.id });
  });

  socket.on('breaker_siphon', () => {
    console.log(`[Lobby ${socket.roomId}] Player ${socket.id} (Poltergeist) used Breaker Siphon.`);
    socket.to(socket.roomId).emit('ghost_breaker_siphon', { id: socket.id });
  });

  socket.on('breaker_remote', () => {
    console.log(`[Lobby ${socket.roomId}] Player ${socket.id} used Breaker Remote.`);
    socket.to(socket.roomId).emit('breaker_remote_triggered');
  });

  socket.on('sound_scramble', () => {
    console.log(`[Lobby ${socket.roomId}] Player ${socket.id} (Banshee) used Sound Scramble.`);
    socket.to(socket.roomId).emit('ghost_sound_scramble', { id: socket.id });
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
