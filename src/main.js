import { io } from 'socket.io-client';
import { initGame } from './game.js';

let socket = null;
let currentLobby = null;
let myId = null;
let isSoloMode = false;

// DOM Elements
const authView = document.getElementById('auth-view');
const lobbyView = document.getElementById('lobby-view');
const hudOverlay = document.getElementById('hud-overlay');

const usernameInput = document.getElementById('username-input');

// Main Menu Action Buttons
const soloBtn = document.getElementById('solo-btn');
const joinPublicBtn = document.getElementById('join-public-btn');
const createPublicBtn = document.getElementById('create-public-btn');
const createPrivateBtn = document.getElementById('create-private-btn');
const joinPrivateBtn = document.getElementById('join-private-btn');
const privateRoomInput = document.getElementById('private-room-input');
const soloLoadingOverlay = document.getElementById('solo-loading-overlay');

const roomDisplay = document.getElementById('lobby-room-display');
const lobbyTypeLabel = document.getElementById('lobby-type-label');
const playersList = document.getElementById('players-list');
const hostSettingsPanel = document.getElementById('host-settings-panel');
const botToggle = document.getElementById('bot-toggle');
const roleModeSelect = document.getElementById('role-mode-select');

// Lobby Subclass & Team Elements
const chooseHumanBtn = document.getElementById('choose-human');
const chooseGhostBtn = document.getElementById('choose-ghost');
const subclassSelect = document.getElementById('subclass-select');
const classDesc = document.getElementById('class-desc');

const chatBox = document.getElementById('chat-box');
const chatInput = document.getElementById('chat-input');
const readyStartBtn = document.getElementById('ready-start-btn');

// Metrics
const humanCountDisplay = document.getElementById('human-count-display');
const minGhostsDisplay = document.getElementById('min-ghosts-display');
const botCountDisplay = document.getElementById('bot-count-display');
const totalGhostsDisplay = document.getElementById('total-ghosts-display');

// Quit buttons
const quitLobbyBtn = document.getElementById('quit-lobby-btn');
const quitGameBtn = document.getElementById('quit-game-btn');

// Class Data definitions
const classesData = {
  Human: {
    Locksmith: { desc: "Perk: Rapid decryption. Interactive speed boosts when bypassing terminal ciphers and puzzle hubs." },
    Trapper: { desc: "Perk: Defensive coordinator. Deploys salt barriers and electric shock mines to massive slow ghosts." },
    Scout: { desc: "Perk: Equipped with motion-tracking radar tablet displaying real-time entity paths in a short range." },
    Medic: { desc: "Perk: Health specialist. Can revive captured teammates locked in environmental traps and give speed buffs." },
    "Flashlight Expert": { desc: "Perk: High-intensity wide-angle UV blast capable of blinding or exposing invisible Mimics/Ghosts." },
    Quartermaster: { desc: "Perk (Deep Pockets): Inventory expanded to 8 slots. Ability: Deploys equipment cache for team." }
  },
  Ghost: {
    Stalker: { desc: "Perk (Tank Tracker): Slow but durable. Can track blood trails left by injured humans or sprinting players." },
    Mimic: { desc: "Perk (Deceiver): Infiltration master. Can clone a human teammate's appearance and username to strike." },
    Juggernaut: { desc: "Perk: Heavy audio hunter. Gains extreme speed bursts when tracking sprinting or talking survivors." },
    Phantom: { desc: "Perk: Fast-striking jumping ghost. High mobility leap to cut off corridors and escape lines." },
    Poltergeist: { desc: "Perk: Saboteur. Can trigger remote puzzle regress or drop circuit breakers to plunge areas in total darkness." },
    Banshee: { desc: "Perk: Auditory distortion tracker. Projects static screaming to scramble nearby human sensors." }
  }
};

let currentSelectedTeam = 'Human';

// Pre-fill username with random name
usernameInput.value = `Operative_${Math.floor(100 + Math.random() * 900)}`;

function populateSubclasses(team) {
  subclassSelect.innerHTML = '';
  const subclasses = Object.keys(classesData[team]);
  subclasses.forEach(cls => {
    const opt = document.createElement('option');
    opt.value = cls;
    opt.textContent = cls;
    subclassSelect.appendChild(opt);
  });
  updateSubclassDesc();
}

function updateSubclassDesc() {
  const clsName = subclassSelect.value;
  if (classesData[currentSelectedTeam][clsName]) {
    classDesc.textContent = classesData[currentSelectedTeam][clsName].desc;
  }
}

// Initial Fill
populateSubclasses('Human');

subclassSelect.addEventListener('change', () => {
  updateSubclassDesc();
  updatePlayerSettings();
});

chooseHumanBtn.addEventListener('click', () => {
  currentSelectedTeam = 'Human';
  chooseHumanBtn.classList.add('active');
  chooseGhostBtn.classList.remove('active');
  populateSubclasses('Human');
  updatePlayerSettings();
});

chooseGhostBtn.addEventListener('click', () => {
  currentSelectedTeam = 'Ghost';
  chooseGhostBtn.classList.add('active');
  chooseHumanBtn.classList.remove('active');
  populateSubclasses('Ghost');
  updatePlayerSettings();
});

// Socket Initialization Wrapper
function initializeSocketConnection() {
  if (socket) return socket;
  const socketUrl = window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin;
  socket = io(socketUrl);

  socket.on('connect', () => {
    myId = socket.id;
  });

  socket.on('joined_room_success', ({ roomId, isPublic }) => {
    if (isSoloMode) return;
    authView.style.display = 'none';
    lobbyView.style.display = 'grid';
    roomDisplay.textContent = roomId.toUpperCase();
    lobbyTypeLabel.textContent = isPublic ? "Public Matchmaking Lobby" : "Private Lobby";
  });

  socket.on('lobby_update', (lobby) => {
    currentLobby = lobby;
    renderLobby();
  });

  socket.on('host_changed', ({ hostId }) => {
    logSystemMessage(`Host authority transferred to ${currentLobby.players[hostId]?.username}`);
  });

  socket.on('match_started', (matchConfig) => {
    logSystemMessage("Breach sequence authorized. Entering Labyrinth...");
    authView.style.display = 'none';
    lobbyView.style.display = 'none';
    hudOverlay.style.display = 'flex';
    initGame(socket, myId, matchConfig);
  });

  socket.on('chat_broadcast', ({ username, msg, team }) => {
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg';
    const nameSpan = document.createElement('span');
    nameSpan.className = team === 'Ghost' ? 'chat-username ghost-user' : 'chat-username';
    nameSpan.textContent = `${username}: `;
    msgEl.appendChild(nameSpan);
    msgEl.appendChild(document.createTextNode(msg));
    
    chatBox.appendChild(msgEl);
    chatBox.scrollTop = chatBox.scrollHeight;
  });

  socket.on('matchmaking_status', ({ msg }) => {
    console.log("Matchmaking:", msg);
  });

  socket.on('error_message', ({ msg }) => {
    alert(msg);
  });

  return socket;
}

// ====== Main Menu Actions ======

function getUsername() {
  return usernameInput.value.trim() || `Operative_${Math.floor(100 + Math.random() * 900)}`;
}

soloBtn.addEventListener('click', () => {
  isSoloMode = true;
  soloLoadingOverlay.style.display = 'block';
  const s = initializeSocketConnection();
  
  // Need to wait slightly if socket isn't connected yet, but socket.io buffers emit.
  const roomId = `solo-${Math.floor(1000 + Math.random() * 9000)}`;
  
  s.emit('join_room', { roomId, username: getUsername(), isPublic: false });
  
  // Auto-start solo flow
  setTimeout(() => {
    s.emit('update_settings', { botsEnabled: true });
    setTimeout(() => {
      s.emit('start_match');
      soloLoadingOverlay.style.display = 'none';
    }, 400);
  }, 400);
});

createPublicBtn.addEventListener('click', () => {
  const s = initializeSocketConnection();
  const roomId = `pub-${Math.floor(10000 + Math.random() * 90000)}`;
  s.emit('join_room', { roomId, username: getUsername(), isPublic: true });
});

joinPublicBtn.addEventListener('click', () => {
  const s = initializeSocketConnection();
  s.emit('join_public_matchmaking', { username: getUsername() });
});

createPrivateBtn.addEventListener('click', () => {
  const s = initializeSocketConnection();
  const roomId = `prv-${Math.floor(10000 + Math.random() * 90000)}`;
  s.emit('join_room', { roomId, username: getUsername(), isPublic: false });
});

joinPrivateBtn.addEventListener('click', () => {
  const roomId = privateRoomInput.value.trim();
  if (!roomId) {
    alert("Please enter a room code first.");
    return;
  }
  const s = initializeSocketConnection();
  s.emit('join_room', { roomId: roomId.toLowerCase(), username: getUsername(), isPublic: false });
});

// ====== Quit Handlers ======
function quitToMenu() {
  // Reload window completely resets socket connection and game state. Best for browser games.
  window.location.reload();
}

quitLobbyBtn.addEventListener('click', quitToMenu);
quitGameBtn.addEventListener('click', quitToMenu);

// ====== Lobby Interactions ======

function updatePlayerSettings() {
  if (!socket) return;
  socket.emit('update_player', {
    team: currentSelectedTeam,
    characterClass: subclassSelect.value
  });
}

function renderLobby() {
  if (!currentLobby) return;
  
  const myPlayer = currentLobby.players[myId];
  if (!myPlayer) return;

  if (myPlayer.isHost) {
    hostSettingsPanel.style.display = 'grid';
    readyStartBtn.textContent = currentLobby.canStart ? "Start Breach" : "Awaiting Quota";
  } else {
    hostSettingsPanel.style.display = 'none';
    readyStartBtn.textContent = myPlayer.isReady ? "Ready (Waiting)" : "Ready Up";
  }

  const players = Object.values(currentLobby.players);
  const humanCount = players.filter(p => p.team === 'Human').length;
  humanCountDisplay.textContent = humanCount;
  minGhostsDisplay.textContent = currentLobby.settings.minGhostsRequired;
  botCountDisplay.textContent = currentLobby.settings.botGhostsCount;
  totalGhostsDisplay.textContent = currentLobby.settings.ghostsCount;

  playersList.innerHTML = '';
  players.forEach(p => {
    const row = document.createElement('div');
    row.className = p.id === myId ? 'player-row is-me' : 'player-row';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'player-name-wrapper';
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.username;
    nameSpan.style.fontWeight = 'bold';
    nameWrap.appendChild(nameSpan);

    if (p.isHost) {
      const hostB = document.createElement('span');
      hostB.className = 'badge host';
      hostB.textContent = 'Host';
      nameWrap.appendChild(hostB);
    }
    row.appendChild(nameWrap);

    const teamB = document.createElement('span');
    teamB.className = p.team === 'Ghost' ? 'badge team-ghost' : 'badge team-human';
    teamB.textContent = p.team;
    row.appendChild(teamB);

    const classSpan = document.createElement('span');
    classSpan.textContent = p.characterClass;
    classSpan.style.fontSize = '0.9rem';
    classSpan.style.color = 'var(--text-muted)';
    row.appendChild(classSpan);

    const readyB = document.createElement('span');
    readyB.className = p.isReady ? 'badge ready' : 'badge not-ready';
    readyB.textContent = p.isReady ? 'Ready' : 'Pending';
    row.appendChild(readyB);

    playersList.appendChild(row);
  });
}

// Host configs
botToggle.addEventListener('change', () => {
  if (currentLobby && currentLobby.players[myId]?.isHost) {
    socket.emit('update_settings', { botsEnabled: botToggle.checked });
  }
});

roleModeSelect.addEventListener('change', () => {
  if (currentLobby && currentLobby.players[myId]?.isHost) {
    socket.emit('update_settings', { roleSelectionMode: roleModeSelect.value });
  }
});

readyStartBtn.addEventListener('click', () => {
  if (!currentLobby || !socket) return;
  const myPlayer = currentLobby.players[myId];
  if (!myPlayer) return;

  if (myPlayer.isHost) {
    if (currentLobby.canStart) {
      socket.emit('start_match');
    } else {
      alert("Cannot start: Ghost quota is not fulfilled! Put bots ON or assign players to Ghost team.");
    }
  } else {
    socket.emit('update_player', {
      isReady: !myPlayer.isReady
    });
  }
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const msg = chatInput.value.trim();
    if (msg && socket) {
      socket.emit('chat_message', { msg });
      chatInput.value = '';
    }
  }
});

function logSystemMessage(text) {
  const sysEl = document.createElement('div');
  sysEl.className = 'chat-msg chat-system';
  sysEl.textContent = `[SYSTEM]: ${text}`;
  chatBox.appendChild(sysEl);
  chatBox.scrollTop = chatBox.scrollHeight;
}
