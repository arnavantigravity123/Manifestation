import { io } from 'socket.io-client';
import { initGame, setMobileMode } from './game.js';
import { Purchases } from '@revenuecat/purchases-capacitor';

// Initialize RevenueCat
Purchases.configure({ apiKey: "test_cMsleegvwoeSHogVfNJSxcSJCqj" });
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
const vipStoreBtn = document.getElementById('vip-store-btn');
const vipPaywallModal = document.getElementById('vip-paywall-modal');
const buyVipBtn = document.getElementById('buy-vip-btn');
const closeVipBtn = document.getElementById('close-vip-btn');
const roomDisplay = document.getElementById('lobby-room-display');
const lobbyTypeLabel = document.getElementById('lobby-type-label');
const playersList = document.getElementById('players-list');
const hostSettingsPanel = document.getElementById('host-settings-panel');
const botToggle = document.getElementById('bot-toggle');
const roleModeSelect = document.getElementById('role-mode-select');
const lobbyDifficultySelect = document.getElementById('lobby-difficulty-select');
const soloDifficultySelect = document.getElementById('solo-difficulty-select');
const soloClassSelect = document.getElementById('solo-class-select');

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

// Class Data definitions (Accurate in-game loadouts & active abilities)
const classesData = {
  Human: {
    Locksmith: { desc: "Loadout: EMF Radar, Thermal Camera, Breaker Remote, Battery Pack. Ability: Deploys Breaker Remote to instantly freeze all ghosts for 10s. Passive Thermal X-Ray vision when held." },
    Trapper: { desc: "Loadout: Salt Cannister, Chalk / UV Spray, Battery Pack, Adrenaline Shot. Ability: Deploys salt barriers slowing passing ghosts by 80%, sprays chalk maze markers, and triggers 10s adrenaline speed bursts." },
    Scout: { desc: "Loadout: EMF Radar, Sanity Pills, Battery Pack, Adrenaline Shot. Ability: 50m long-range EMF ghost proximity tracking, sanity restoration, and rapid 10s sprint bursts for fast map exploration." },
    Medic: { desc: "Loadout: Defibrillator (Multiplayer) / EMF Radar (Solo), Sanity Pills, Med Kit, Battery Pack. Ability: Discharges Defibrillator to instantly revive captured teammates, restores HP with Med Kits, and stabilizes sanity." },
    "Flashlight Expert": { desc: "Loadout: EMF Radar, Thermal Camera, 2x Battery Packs. Ability: Dual battery packs for maximum high-beam flashlight uptime combined with passive Thermal Camera wall-piercing X-Ray vision." },
    Quartermaster: { desc: "Loadout (Deep Pockets): 12 Inventory Slots. Starts packed with Salt Cannister, Chalk Spray, Adrenaline, Med Kit, Sanity Pills, EMF Radar, and 2x Batteries." }
  },
  Ghost: {
    Stalker: { desc: "Loadout: Ghost Claws, Scent Tracker. Ability: Casts Scent Tracker to project a tracking tether to the nearest survivor (tether duration: 3.5s - 10s, CD: 28s - 10s based on difficulty)." },
    Mimic: { desc: "Loadout: Ghost Claws, Infiltration Clone. Ability: Activates Infiltration Clone to disguise yourself as a human survivor (duration: 8s - 25s, CD: 40s - 16s based on difficulty)." },
    Juggernaut: { desc: "Loadout: Ghost Claws, Audio Amplifiers. Perk: Heavy audio tracking. Ability: Engages Rage surge (duration: 7s - 18s, speed: 5.5 - 10.5 m/s, CD: 60s - 24s based on difficulty)." },
    Phantom: { desc: "Loadout: Ghost Claws, Vapor Leap. Ability: Casts Vapor Leap to instantly phase-teleport forward (distance: 8m - 22m, CD: 22s - 7s based on difficulty)." },
    Poltergeist: { desc: "Loadout: Ghost Claws, Breaker Siphon. Ability: Deploys Breaker Siphon to overload and disable human flashlights (radius: 18m - 45m, duration: 6s - 18s, CD: 42s - 14s based on difficulty)." },
    Banshee: { desc: "Loadout: Ghost Claws, Sound Scrambler. Ability: Unleashes an auditory shockwave blinding and scrambling human sensors (radius: 18m - 45m, duration: 5s - 16s, CD: 50s - 20s based on difficulty)." }
  }
};

let currentSelectedTeam = localStorage.getItem('manifestation_team') || 'Human';

// Pre-fill username from localStorage or random fallback
const savedUsername = localStorage.getItem('manifestation_username');
if (savedUsername && savedUsername.trim() !== '') {
  usernameInput.value = savedUsername.trim();
} else {
  const defaultName = `Operative_${Math.floor(100 + Math.random() * 900)}`;
  usernameInput.value = defaultName;
  localStorage.setItem('manifestation_username', defaultName);
}

usernameInput.addEventListener('input', () => {
  const val = usernameInput.value.trim();
  if (val) {
    localStorage.setItem('manifestation_username', val);
  }
});

function populateSubclasses(team, savedClass = null) {
  subclassSelect.innerHTML = '';
  const subclasses = Object.keys(classesData[team]);
  subclasses.forEach(cls => {
    const opt = document.createElement('option');
    opt.value = cls;
    opt.textContent = cls;
    subclassSelect.appendChild(opt);
  });
  
  const targetClass = savedClass || localStorage.getItem('manifestation_class');
  if (targetClass && subclasses.includes(targetClass)) {
    subclassSelect.value = targetClass;
  }
  updateSubclassDesc();
}

function updateSubclassDesc() {
  const clsName = subclassSelect.value;
  if (classesData[currentSelectedTeam] && classesData[currentSelectedTeam][clsName]) {
    classDesc.textContent = classesData[currentSelectedTeam][clsName].desc;
  }
}

// Initial Fill with restored team & class
if (currentSelectedTeam === 'Ghost') {
  chooseGhostBtn.classList.add('active');
  chooseHumanBtn.classList.remove('active');
  populateSubclasses('Ghost');
} else {
  currentSelectedTeam = 'Human';
  chooseHumanBtn.classList.add('active');
  chooseGhostBtn.classList.remove('active');
  populateSubclasses('Human');
}

subclassSelect.addEventListener('change', () => {
  localStorage.setItem('manifestation_class', subclassSelect.value);
  updateSubclassDesc();
  updatePlayerSettings();
});

chooseHumanBtn.addEventListener('click', () => {
  currentSelectedTeam = 'Human';
  localStorage.setItem('manifestation_team', 'Human');
  chooseHumanBtn.classList.add('active');
  chooseGhostBtn.classList.remove('active');
  populateSubclasses('Human');
  localStorage.setItem('manifestation_class', subclassSelect.value);
  updatePlayerSettings();
});

chooseGhostBtn.addEventListener('click', () => {
  currentSelectedTeam = 'Ghost';
  localStorage.setItem('manifestation_team', 'Ghost');
  chooseGhostBtn.classList.add('active');
  chooseHumanBtn.classList.remove('active');
  populateSubclasses('Ghost');
  localStorage.setItem('manifestation_class', subclassSelect.value);
  updatePlayerSettings();
});

// VIP Paywall Logic
vipStoreBtn.addEventListener('click', () => {
  vipPaywallModal.style.display = 'block';
});

closeVipBtn.addEventListener('click', () => {
  vipPaywallModal.style.display = 'none';
});

buyVipBtn.addEventListener('click', async () => {
  buyVipBtn.textContent = 'Processing...';
  buyVipBtn.disabled = true;
  
  try {
    const offerings = await Purchases.getOfferings();
    if (offerings.current && offerings.current.availablePackages.length !== 0) {
      const { customerInfo } = await Purchases.purchasePackage({ aPackage: offerings.current.availablePackages[0] });
      
      if (customerInfo.entitlements.active['vip_access']) {
        alert("VIP Access Granted! Ads removed and credits added.");
        vipPaywallModal.style.display = 'none';
        vipStoreBtn.style.display = 'none'; // Hide the store button since they are VIP
        playerCredits += 500;
        localStorage.setItem('manifestation_credits', playerCredits);
        playerCreditsDisplay.textContent = playerCredits;
      }
    } else {
      throw new Error("No offerings configured");
    }
  } catch (error) {
    if (error && error.userCancelled) {
      // User manually cancelled the native payment sheet, do nothing
    } else {
      // Fallback for hackathon testing (Web / No Google Play products configured)
      alert("Test Mode: RevenueCat not fully configured yet. Granting VIP for Hackathon Demo!");
      vipPaywallModal.style.display = 'none';
      vipStoreBtn.style.display = 'none';
      playerCredits += 500;
      localStorage.setItem('manifestation_credits', playerCredits);
      playerCreditsDisplay.textContent = playerCredits;
    }
  } finally {
    buyVipBtn.textContent = 'Unlock VIP - $4.99';
    buyVipBtn.disabled = false;
  }
});

// Skins Store and Ads Logic
const openSkinsBtn = document.getElementById('open-skins-btn');
const skinsStoreModal = document.getElementById('skins-store-modal');
const closeSkinsBtn = document.getElementById('close-skins-btn');
const watchAdBtn = document.getElementById('watch-ad-btn');
const playerCreditsDisplay = document.getElementById('player-credits-display');
const buySkinBtns = document.querySelectorAll('.buy-skin-btn');

let playerCredits = parseInt(localStorage.getItem('manifestation_credits') || '0');
playerCreditsDisplay.textContent = playerCredits;

openSkinsBtn.addEventListener('click', () => {
  skinsStoreModal.style.display = 'block';
});

closeSkinsBtn.addEventListener('click', () => {
  skinsStoreModal.style.display = 'none';
});

watchAdBtn.addEventListener('click', () => {
  watchAdBtn.textContent = 'Loading Ad...';
  watchAdBtn.disabled = true;
  
  // Mock Ad Network delay
  setTimeout(() => {
    alert("Watching Ad... (This is a mock rewarded video ad)");
    playerCredits += 50;
    localStorage.setItem('manifestation_credits', playerCredits);
    playerCreditsDisplay.textContent = playerCredits;
    watchAdBtn.textContent = '📺 Watch Ad (+50 💰)';
    watchAdBtn.disabled = false;
  }, 1500);
});

function updateSkinButtons() {
  const equipped = localStorage.getItem('manifestation_equipped_skin');
  buySkinBtns.forEach(btn => {
    const skinId = btn.getAttribute('data-skin-id');
    const price = btn.getAttribute('data-price');
    
    if (skinId === equipped || (skinId === 'skin_default' && !equipped)) {
      btn.textContent = 'EQUIPPED';
      btn.style.background = '#059669';
    } else if (localStorage.getItem(`unlocked_${skinId}`) || price === '0') {
      btn.textContent = 'EQUIP';
      btn.style.background = '#3b82f6';
    } else {
      btn.textContent = `BUY - ${price} 💰`;
      btn.style.background = '';
    }
  });
}

// Call on startup
updateSkinButtons();

buySkinBtns.forEach(btn => {
  btn.addEventListener('click', (e) => {
    const price = parseInt(e.target.getAttribute('data-price'));
    const skinId = e.target.getAttribute('data-skin-id');
    
    if (localStorage.getItem(`unlocked_${skinId}`) || price === 0) {
      // Already owned, just equip
      localStorage.setItem('manifestation_equipped_skin', skinId);
      updateSkinButtons();
      return;
    }
    
    if (playerCredits >= price) {
      playerCredits -= price;
      localStorage.setItem('manifestation_credits', playerCredits);
      localStorage.setItem(`unlocked_${skinId}`, 'true');
      localStorage.setItem('manifestation_equipped_skin', skinId);
      playerCreditsDisplay.textContent = playerCredits;
      updateSkinButtons();
      alert("Skin successfully purchased and equipped!");
    } else {
      alert(`Not enough credits! You need ${price} 💰. Watch ads or buy VIP.`);
    }
  });
});

// Socket Initialization Wrapper
function initializeSocketConnection() {
  if (socket) return socket;
  // Use production Render URL for socket connections from mobile
  const socketUrl = 'https://manifestation-e53w.onrender.com/';
  socket = io(socketUrl);

  socket.on('connect', () => {
    myId = socket.id;
  });

  socket.on('joined_room_success', ({ roomId, isPublic }) => {
    if (isSoloMode) {
      const selectedDiff = (soloDifficultySelect && soloDifficultySelect.value) || 'medium';
      const soloHumanClasses = ['Locksmith', 'Trapper', 'Scout', 'Medic', 'Flashlight Expert', 'Quartermaster'];
      const chosenSoloSetting = (soloClassSelect && soloClassSelect.value) || localStorage.getItem('manifestation_solo_class') || 'Random';
      
      let chosenClass = chosenSoloSetting;
      if (!chosenClass || chosenClass === 'Random' || !soloHumanClasses.includes(chosenClass)) {
        chosenClass = soloHumanClasses[Math.floor(Math.random() * soloHumanClasses.length)];
      }

      socket.emit('update_settings', { botsEnabled: true, difficulty: selectedDiff });
      socket.emit('update_player', { team: 'Human', characterClass: chosenClass });
      setTimeout(() => {
        socket.emit('start_match');
        soloLoadingOverlay.style.display = 'none';
      }, 200);
      return;
    }

    // Save to sessionStorage for auto-rejoin upon match end
    sessionStorage.setItem('rejoinLobbyId', roomId);
    sessionStorage.setItem('rejoinUsername', getUsername());
    sessionStorage.setItem('rejoinIsPublic', isPublic ? 'true' : 'false');
    sessionStorage.setItem('rejoinIsSolo', isSoloMode ? 'true' : 'false');

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

function getSkinId() {
  return localStorage.getItem('manifestation_equipped_skin') || null;
}

soloBtn.addEventListener('click', () => {
  isSoloMode = true;
  soloLoadingOverlay.style.display = 'block';
  const s = initializeSocketConnection();
  
  const roomId = Math.floor(100000 + Math.random() * 900000).toString();
  s.emit('join_room', { roomId, username: getUsername(), skinId: getSkinId(), isPublic: false });
});

createPublicBtn.addEventListener('click', () => {
  const s = initializeSocketConnection();
  const roomId = Math.floor(100000 + Math.random() * 900000).toString();
  s.emit('join_room', { roomId, username: getUsername(), skinId: getSkinId(), isPublic: true });
});

joinPublicBtn.addEventListener('click', () => {
  const s = initializeSocketConnection();
  s.emit('join_public_matchmaking', { username: getUsername(), skinId: getSkinId() });
});

createPrivateBtn.addEventListener('click', () => {
  const s = initializeSocketConnection();
  const roomId = Math.floor(100000 + Math.random() * 900000).toString();
  s.emit('join_room', { roomId, username: getUsername(), skinId: getSkinId(), isPublic: false });
});

joinPrivateBtn.addEventListener('click', () => {
  const roomId = privateRoomInput.value.trim();
  if (!roomId) {
    alert("Please enter a room code first.");
    return;
  }
  const s = initializeSocketConnection();
  s.emit('join_room', { roomId: roomId.toLowerCase(), username: getUsername(), skinId: getSkinId(), isPublic: false });
});

// ====== Quit Handlers ======
function quitToMenu() {
  sessionStorage.removeItem('rejoinLobbyId');
  sessionStorage.removeItem('rejoinUsername');
  sessionStorage.removeItem('rejoinIsPublic');
  sessionStorage.removeItem('rejoinIsSolo');
  // Reload window completely resets socket connection and game state. Best for browser games.
  window.location.reload();
}

quitLobbyBtn.addEventListener('click', quitToMenu);
quitGameBtn.addEventListener('click', quitToMenu);

// ====== Lobby Interactions ======

function updatePlayerSettings() {
  if (!socket || !currentLobby) return;
  const roleMode = currentLobby.settings?.roleSelectionMode;
  if (roleMode === 'random' || roleMode === 'hidden') return;
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
    readyStartBtn.textContent = "Start Breach Sequence";
    readyStartBtn.disabled = !currentLobby.canStart;
    if (lobbyDifficultySelect && currentLobby.settings?.difficulty) {
      lobbyDifficultySelect.value = currentLobby.settings.difficulty;
      lobbyDifficultySelect.disabled = false;
    }
  } else {
    hostSettingsPanel.style.display = 'none';
    readyStartBtn.textContent = myPlayer.isReady ? "Ready (Waiting)" : "Ready Up";
    if (lobbyDifficultySelect && currentLobby.settings?.difficulty) {
      lobbyDifficultySelect.value = currentLobby.settings.difficulty;
      lobbyDifficultySelect.disabled = true;
    }
  }

  const players = Object.values(currentLobby.players);
  const humanCount = players.filter(p => p.team === 'Human').length;
  humanCountDisplay.textContent = humanCount;
  minGhostsDisplay.textContent = currentLobby.settings.minGhostsRequired;
  botCountDisplay.textContent = currentLobby.settings.botGhostsCount;
  totalGhostsDisplay.textContent = currentLobby.settings.ghostsCount;

  // Update Dynamic Ghost Formula Engine Display & Active Pill
  const currentDiff = currentLobby.settings?.difficulty || 'medium';
  const formulaDisplay = document.getElementById('lobby-formula-display');
  if (formulaDisplay) {
    if (currentDiff === 'easy') formulaDisplay.textContent = 'Formula: max(2, Humans × 1)';
    else if (currentDiff === 'hard') formulaDisplay.textContent = 'Formula: max(6, Humans × 3)';
    else if (currentDiff === 'impossible') formulaDisplay.textContent = 'Formula: max(8, Humans × 4)';
    else formulaDisplay.textContent = 'Formula: max(3, Humans × 2)';
  }

  ['easy', 'medium', 'hard', 'impossible'].forEach(d => {
    const pill = document.getElementById(`formula-pill-${d}`);
    if (pill) {
      if (d === currentDiff) {
        pill.style.transform = 'scale(1.05)';
        pill.style.boxShadow = '0 0 10px rgba(56, 189, 248, 0.4)';
        pill.style.borderColor = '#38bdf8';
        pill.style.filter = 'brightness(1.2)';
      } else {
        pill.style.transform = 'none';
        pill.style.boxShadow = 'none';
        pill.style.borderColor = '';
        pill.style.filter = 'none';
      }
    }
  });

  // Lock subclass customization if host has set random/hidden roles
  const customizerBox = document.querySelector('.customizer-box');
  const roleMode = currentLobby.settings.roleSelectionMode;
  if (roleMode === 'random' || roleMode === 'hidden') {
    chooseHumanBtn.disabled = true;
    chooseGhostBtn.disabled = true;
    subclassSelect.disabled = true;
    customizerBox.classList.add('disabled-locked');
    if (roleMode === 'random') {
      classDesc.textContent = "LOBBY SECURED: Teams and classes will be completely randomized at breach start.";
    } else {
      classDesc.textContent = "LOBBY SECURED: Teams and classes will be assigned secretly at breach start.";
    }
  } else {
    chooseHumanBtn.disabled = false;
    chooseGhostBtn.disabled = false;
    subclassSelect.disabled = false;
    customizerBox.classList.remove('disabled-locked');
    updateSubclassDesc();
  }

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
    const classSpan = document.createElement('span');
    classSpan.style.fontSize = '0.9rem';
    classSpan.style.color = 'var(--text-muted)';

    if (roleMode === 'random') {
      teamB.className = 'badge team-random';
      teamB.textContent = 'Random';
      classSpan.textContent = 'Random Class';
    } else if (roleMode === 'hidden') {
      teamB.className = 'badge team-hidden';
      teamB.textContent = 'Hidden';
      classSpan.textContent = 'Hidden Class';
    } else {
      teamB.className = p.team === 'Ghost' ? 'badge team-ghost' : 'badge team-human';
      teamB.textContent = p.team;
      classSpan.textContent = p.characterClass;
    }
    row.appendChild(teamB);
    row.appendChild(classSpan);

    const readyB = document.createElement('span');
    readyB.className = p.isReady ? 'badge ready' : 'badge not-ready';
    readyB.textContent = p.isReady ? 'Ready' : 'Pending';
    row.appendChild(readyB);

    playersList.appendChild(row);
  });
}

// Host configs & persistence
const savedBotsEnabled = localStorage.getItem('manifestation_bots_enabled');
if (savedBotsEnabled !== null) {
  botToggle.checked = savedBotsEnabled === 'true';
}
const savedRoleMode = localStorage.getItem('manifestation_role_mode');
if (savedRoleMode) {
  roleModeSelect.value = savedRoleMode;
}
const savedDifficulty = localStorage.getItem('manifestation_difficulty') || 'medium';
if (soloDifficultySelect) soloDifficultySelect.value = savedDifficulty;
if (lobbyDifficultySelect) lobbyDifficultySelect.value = savedDifficulty;

const savedSoloClass = localStorage.getItem('manifestation_solo_class') || 'Random';
if (soloClassSelect) soloClassSelect.value = savedSoloClass;

soloClassSelect?.addEventListener('change', () => {
  localStorage.setItem('manifestation_solo_class', soloClassSelect.value);
});

soloDifficultySelect?.addEventListener('change', () => {
  const diff = soloDifficultySelect.value;
  localStorage.setItem('manifestation_difficulty', diff);
  window.gameDifficulty = diff;
  if (typeof window.getMazeSizeForDifficulty === 'function') {
    window.mazeSizeGlobal = window.getMazeSizeForDifficulty(diff);
  }
  if (lobbyDifficultySelect) lobbyDifficultySelect.value = diff;
});

lobbyDifficultySelect?.addEventListener('change', () => {
  const diff = lobbyDifficultySelect.value;
  localStorage.setItem('manifestation_difficulty', diff);
  window.gameDifficulty = diff;
  if (typeof window.getMazeSizeForDifficulty === 'function') {
    window.mazeSizeGlobal = window.getMazeSizeForDifficulty(diff);
  }
  if (soloDifficultySelect) soloDifficultySelect.value = diff;
  if (currentLobby && currentLobby.players[myId]?.isHost) {
    socket.emit('update_settings', { difficulty: diff });
  }
});

botToggle.addEventListener('change', () => {
  localStorage.setItem('manifestation_bots_enabled', botToggle.checked ? 'true' : 'false');
  if (currentLobby && currentLobby.players[myId]?.isHost) {
    socket.emit('update_settings', { botsEnabled: botToggle.checked });
  }
});

roleModeSelect.addEventListener('change', () => {
  localStorage.setItem('manifestation_role_mode', roleModeSelect.value);
  if (currentLobby && currentLobby.players[myId]?.isHost) {
    socket.emit('update_settings', { roleSelectionMode: roleModeSelect.value });
  }
});

readyStartBtn.addEventListener('click', () => {
  if (!currentLobby || !socket) return;
  
  // Robust player lookup by myId or by username
  let myPlayer = currentLobby.players[myId];
  if (!myPlayer) {
    const uname = getUsername();
    myPlayer = Object.values(currentLobby.players).find(p => p.username === uname);
    if (myPlayer) myId = myPlayer.id;
  }
  if (!myPlayer) return;

  if (myPlayer.isHost) {
    socket.emit('start_match');
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

window.addEventListener('DOMContentLoaded', () => {
  const rejoinId = sessionStorage.getItem('rejoinLobbyId');
  const rejoinUser = sessionStorage.getItem('rejoinUsername');
  const rejoinPublicStr = sessionStorage.getItem('rejoinIsPublic');
  const rejoinSoloStr = sessionStorage.getItem('rejoinIsSolo');

  if (rejoinId && rejoinUser) {
    const startScreen = document.getElementById('start-screen');
    if (startScreen) startScreen.style.display = 'none';

    sessionStorage.removeItem('rejoinLobbyId');
    sessionStorage.removeItem('rejoinUsername');
    sessionStorage.removeItem('rejoinIsPublic');
    sessionStorage.removeItem('rejoinIsSolo');

    usernameInput.value = rejoinUser;
    isSoloMode = rejoinSoloStr === 'true';

    if (isSoloMode) {
      isSoloMode = false;
      return;
    }

    const s = initializeSocketConnection();
    s.emit('join_room', {
      roomId: rejoinId,
      username: rejoinUser,
      skinId: getSkinId(),
      isPublic: rejoinPublicStr === 'true'
    });
  }

  // Settings UI Integration
  const settingsModal = document.getElementById('settings-modal');
  const controlSelect = document.getElementById('control-scheme-select');
  const sensitivitySlider = document.getElementById('sensitivity-slider');
  const sensitivityValue = document.getElementById('sensitivity-value');
  
  const savedControlMode = localStorage.getItem('control_mode') || 'auto';
  controlSelect.value = savedControlMode;
  setMobileMode(savedControlMode);
  
  const savedSensitivity = localStorage.getItem('look_sensitivity') || '1.0';
  if (sensitivitySlider) sensitivitySlider.value = savedSensitivity;
  if (sensitivityValue) sensitivityValue.textContent = savedSensitivity;
  window.lookSensitivity = parseFloat(savedSensitivity);
  
  if (sensitivitySlider) {
    sensitivitySlider.addEventListener('input', (e) => {
      sensitivityValue.textContent = e.target.value;
    });
  }

  const showSettings = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    settingsModal.style.display = 'flex';
  };

  const hideSettings = () => {
    settingsModal.style.display = 'none';
    const selectedMode = controlSelect.value;
    localStorage.setItem('control_mode', selectedMode);
    setMobileMode(selectedMode);
    
    if (sensitivitySlider) {
      localStorage.setItem('look_sensitivity', sensitivitySlider.value);
      window.lookSensitivity = parseFloat(sensitivitySlider.value);
    }
  };

  document.getElementById('auth-settings-btn').addEventListener('click', showSettings);
  document.getElementById('lobby-settings-btn').addEventListener('click', showSettings);
  document.getElementById('pause-settings-btn').addEventListener('click', showSettings);
  document.getElementById('close-settings-btn').addEventListener('click', hideSettings);
});
