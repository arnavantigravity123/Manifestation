import * as THREE from 'three';

let scene, camera, renderer;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let prevTime = performance.now();
const defaultMobileDetect = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia("(max-width: 768px)").matches;
export let isMobileDevice = defaultMobileDetect;
if (isMobileDevice) {
  document.body.classList.add('is-mobile');
}

export function setMobileMode(mode) {
  if (mode === 'touch') {
    isMobileDevice = true;
  } else if (mode === 'keyboard') {
    isMobileDevice = false;
  } else {
    isMobileDevice = defaultMobileDetect;
  }
  
  if (isMobileDevice) {
    document.body.classList.add('is-mobile');
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    const resumeTarget = document.getElementById('resume-click-target');
    if (resumeTarget) resumeTarget.textContent = 'TAP TO ENTER LABYRINTH';
    const subtext = document.querySelector('#pointer-lock-overlay p');
    if (subtext) subtext.textContent = '(Drag Screen to Look | Joystick to Move | Tap UI to Act)';
  } else {
    document.body.classList.remove('is-mobile');
    const resumeTarget = document.getElementById('resume-click-target');
    if (resumeTarget) resumeTarget.textContent = 'CLICK TO RESUME LABYRINTH';
    const subtext = document.querySelector('#pointer-lock-overlay p');
    if (subtext) subtext.textContent = '(Press ESC to Pause | WASD to Move | Mouse to Look)';
  }
}

// Game Data
let socketClient = null;
let myId = null;
let currentLobby = null;
let currentHP = 100;
let currentSanity = 100;
let inventory = [];
let activeSlot = 0;
let players3D = {}; // id -> mesh
let ghosts3D = [];  // bot meshes
let walls = [];
let itemsInMaze = [];
let keysInMaze = [];
let saltTraps = [];
let circuitBreakers = [];
let fixedBreakersCount = 0;
const totalBreakersRequired = 3;

// Sprint / Stamina
let isSprinting = false;
let stamina = 100; // 0-100
const STAMINA_DRAIN_RATE = 20;  // per second while sprinting
const STAMINA_REGEN_RATE  = 12; // per second while not sprinting
const SPRINT_MIN_STAMINA  = 5;  // can't start sprint below this

// Player Config
let myTeam = 'Human';
let myClass = 'Locksmith';
let isPanicked = false;
let isCaptured = false;
let panicTimer = 0;
let speedBoostTimer = 0;
let latestSoundBeacon = null;
let flashLight = null;
let ambientLight = null;
let flashlightBattery = 100;

// Puzzle configuration
let gateCoordinates = { x: 0, z: -35 };
let gateMeshRef = null;  // Global ref so we can toggle visibility
let gateSolved = false;
let codeEntered = "";
let functionalKeysRevealed = [];
let foundKeysList = [];
let carriedKeys = [];      // Keys currently carried (max 3)
const MAX_CARRIED_KEYS = 3;
let codeClueNotes = []; // Clue objects in the maze

// Audio variables for EMF & static
let audioCtx = null;
let emfOscillator = null;
let micStream = null;
let audioAnalyser = null;
let audioDataArray = null;

let seededRandom = Math.random;

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function initGame(socket, socketId, matchConfig) {
  socketClient = socket;
  myId = socketId;
  currentLobby = matchConfig;

  // Initialize seededRandom using server-provided mazeGeometrySeed
  const seed = (matchConfig.puzzleState && matchConfig.puzzleState.mazeGeometrySeed) || 0.12345;
  const seedInt = Math.floor(seed * 2147483647);
  seededRandom = mulberry32(seedInt);

  // Reset core game state variables for clean start/re-entry
  currentHP = 100;
  currentSanity = 100;
  isPanicked = false;
  isCaptured = false;
  panicTimer = 0;
  speedBoostTimer = 0;
  latestSoundBeacon = null;
  gateSolved = false;
  codeEntered = "";
  functionalKeysRevealed = [];
  foundKeysList = [];
  carriedKeys = [];
  codeClueNotes = [];
  inventory = [];
  activeSlot = 0;

  // Reset HUD visuals
  flashlightBattery = 100;
  const hpVal = document.getElementById('hp-value');
  const hpBar = document.getElementById('hp-bar');
  const sanityVal = document.getElementById('sanity-value');
  const sanityBar = document.getElementById('sanity-bar');
  const flBar = document.getElementById('flashlight-bar');
  const flVal = document.getElementById('flashlight-value');
  if (hpVal) hpVal.textContent = "100 HP";
  if (hpBar) hpBar.style.width = "100%";
  if (sanityVal) sanityVal.textContent = "100%";
  if (sanityBar) sanityBar.style.width = "100%";
  if (flBar) flBar.style.width = "100%";
  if (flVal) flVal.textContent = "100%";

  const capturedOverlay = document.getElementById('captured-overlay');
  if (capturedOverlay) capturedOverlay.style.display = 'none';

  const hudOverlay = document.getElementById('hud-overlay');
  if (hudOverlay) hudOverlay.style.display = 'flex';

  const me = matchConfig.players[myId];
  myTeam = me.team;
  myClass = me.characterClass;

  // Show/Hide flashlight gauge row based on team
  const flRow = document.getElementById('flashlight-gauge-row');
  if (flRow) {
    flRow.style.display = myTeam === 'Ghost' ? 'none' : 'block';
  }
  // Hide stamina for ghosts (they don't sprint)
  const stRow = document.getElementById('stamina-gauge-row');
  if (stRow) {
    stRow.style.display = myTeam === 'Ghost' ? 'none' : 'block';
  }

  // Setup HUD inventory based on subclass data
  setupInventory();

  // Hide cursor and handle pointer lock overlay
  const container = document.getElementById('canvas-container');
  const ptrOverlay = document.getElementById('pointer-lock-overlay');
  ptrOverlay.style.display = 'flex';
  
  if (isMobileDevice) {
    const resumeTarget = document.getElementById('resume-click-target');
    if (resumeTarget) resumeTarget.textContent = 'TAP TO ENTER LABYRINTH';
    const subtext = document.querySelector('#pointer-lock-overlay p');
    if (subtext) subtext.textContent = '(Drag Screen to Look | Joystick to Move | Tap UI to Act)';
  }

  container.addEventListener('click', () => {
    if (isMobileDevice) {
      window.mobileGameActive = true;
      ptrOverlay.style.display = 'none';
    } else {
      container.requestPointerLock();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  });
  document.getElementById('resume-click-target').addEventListener('click', () => {
    if (isMobileDevice) {
      window.mobileGameActive = true;
      ptrOverlay.style.display = 'none';
    } else {
      container.requestPointerLock();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  });

  document.addEventListener('pointerlockchange', () => {
    if (isMobileDevice) return;
    if (document.pointerLockElement === container) {
      ptrOverlay.style.display = 'none';
    } else {
      ptrOverlay.style.display = 'flex';
    }
  });

  // Display Role Splash
  const roleSplash = document.getElementById('role-splash-screen');
  document.getElementById('splash-role-title').textContent = `${myTeam.toUpperCase()}: ${myClass.toUpperCase()}`;
  document.getElementById('splash-role-desc').textContent = "Survive the labyrinth. Find the twin keys. Enter the Master Gate code.";
  roleSplash.style.display = 'flex';
  window.gameReady = false;
  setTimeout(() => { 
    roleSplash.style.display = 'none'; 
    window.gameReady = true;
  }, 4500);

  // Setup ThreeJS scene
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(myTeam === 'Human' ? 0x030712 : 0x1e1b4b, 0.05);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.rotation.order = 'YXZ'; // Fixes the weird rolling/tilted camera issues!
  camera.position.set(0, 1.6, 0); // Eye-level

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Setup Audio Context for procedural EMF sound
  setupProceduralAudio();

  // Lightings
  ambientLight = new THREE.AmbientLight(0x222233, 1.5); // Slightly dark, not pitch black
  scene.add(ambientLight);

  if (myTeam === 'Human') {
    // Add player flashlight
    flashLight = new THREE.SpotLight(0xffffff, 80, 45, Math.PI / 3, 0.5, 1.5);
    flashLight.position.set(0, 0, 0);
    flashLight.castShadow = true;
    camera.add(flashLight);
    camera.add(flashLight.target);
    flashLight.target.position.set(0, 0, -1);
    scene.add(camera);
  } else {
    // Ghost gets dynamic spooky pointlight aura around them
    const ghostAura = new THREE.PointLight(0xa855f7, 100, 15);
    camera.add(ghostAura);
    scene.add(camera);
  }

  // Store the cipher code digits (revealed one at a time by clue notes in the maze)
  window.cipherCodeDigits = matchConfig.puzzleState.codeDigits || [null, null, null, null];

  // Know which 2 keys are functional from the start (players must find them via trial/error or clues)
  if (matchConfig.puzzleState.realKeySymbols && matchConfig.puzzleState.realKeySymbols.length > 0) {
    functionalKeysRevealed = matchConfig.puzzleState.realKeySymbols;
  }

  // Create Labyrinth
  generateMaze(matchConfig.puzzleState.keysCount);

  // Keyboard controls
  setupControls();

  // Socket listener in-game
  setupSocketListeners();
  
  // Setup Microphone for audio mechanics
  setupMicrophone();

  // Setup keypad button listeners now that the game DOM is visible
  setupKeypadListeners();

  // Window Resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Start loop
  animate();
}

// 3 extra "empty" carry slots all human classes get by default
const EXTRA_CARRY_SLOTS = ['', '', ''];

function setupInventory() {
  const humanClasses = {
    // Base 4 class items + 3 universal carry slots
    Locksmith:          ["EMF Radar", "Thermal Camera", "Breaker Remote", "Battery Pack",    ...EXTRA_CARRY_SLOTS],
    Trapper:            ["Salt Cannister", "Chalk / UV Spray", "Battery Pack", "Adrenaline Shot", ...EXTRA_CARRY_SLOTS],
    Scout:              ["EMF Radar", "Sanity Pills", "Battery Pack", "Adrenaline Shot",     ...EXTRA_CARRY_SLOTS],
    Medic:              ["EMF Radar", "Sanity Pills", "Adrenaline Shot", "Battery Pack",    ...EXTRA_CARRY_SLOTS],
    "Flashlight Expert":["EMF Radar", "Thermal Camera", "Battery Pack", "Battery Pack",     ...EXTRA_CARRY_SLOTS],
    // Quartermaster: 8 class items + 5 carry slots (biggest pack)
    Quartermaster: ["EMF Radar", "Salt Cannister", "Chalk / UV Spray", "Adrenaline Shot", "Sanity Pills", "Battery Pack", "Battery Pack", "Battery Pack", '', '', '', '', '']
  };

  const ghostClasses = {
    Stalker:     ["Ghost Claws", "Scent Tracker"],
    Mimic:       ["Ghost Claws", "Infiltration Clone"],
    Juggernaut:  ["Ghost Claws", "Audio Amplifiers"],
    Phantom:     ["Ghost Claws", "Vapor Leap"],
    Poltergeist: ["Ghost Claws", "Breaker Siphon"],
    Banshee:     ["Ghost Claws", "Sound Scrambler"]
  };

  inventory = myTeam === 'Human' ? (humanClasses[myClass] || []) : (ghostClasses[myClass] || []);
  renderHUDInventory();
  
  // Set Class Display
  const clsBadge = document.getElementById('hud-subclass-badge');
  if (clsBadge) {
    clsBadge.textContent = `CLASS: ${myClass.toUpperCase()} (${myTeam.toUpperCase()})`;
    clsBadge.style.color = myTeam === 'Ghost' ? 'var(--ghost-accent)' : 'var(--human-accent)';
  }
}

function renderHUDInventory() {
  const invGrid = document.getElementById('hud-inventory');
  if (!invGrid) return;
  invGrid.innerHTML = '';

  // --- Class ability items ---
  inventory.forEach((item, index) => {
    const slot = document.createElement('div');
    slot.className = index === activeSlot ? 'inventory-slot active' : 'inventory-slot';
    slot.style.pointerEvents = 'auto';
    slot.addEventListener('click', (e) => {
      e.stopPropagation();
      activeSlot = index;
      renderHUDInventory();
    });
    
    const idxSpan = document.createElement('span');
    idxSpan.className = 'inventory-slot-index';
    idxSpan.textContent = index + 1;
    slot.appendChild(idxSpan);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = getIconOrShortName(item);
    nameSpan.style.fontSize = '0.7rem';
    nameSpan.style.textAlign = 'center';
    nameSpan.style.color = index === activeSlot ? 'white' : 'var(--text-muted)';
    slot.appendChild(nameSpan);

    invGrid.appendChild(slot);
  });

  // --- Carried Keys pocket (only for Humans) ---
  if (myTeam === 'Human') {
    renderCarriedKeysHUD();
  }
}

function renderCarriedKeysHUD() {
  let keysPanel = document.getElementById('hud-carried-keys');
  if (!keysPanel) return;
  keysPanel.innerHTML = '';

  const keyColors = {
    'Amber Orb':     '#f59e0b',
    'Sapphire Shard':'#60a5fa',
    'Violet Prism':  '#a78bfa',
    'Emerald Gem':   '#34d399',
  };
  const keyIcons = {
    'Amber Orb':     '🔶',
    'Sapphire Shard':'🔷',
    'Violet Prism':  '💜',
    'Emerald Gem':   '💚',
  };

  // Show 3 slots always (empty ones greyed out)
  for (let i = 0; i < MAX_CARRIED_KEYS; i++) {
    const slot = document.createElement('div');
    slot.className = 'key-slot';

    if (i < carriedKeys.length) {
      const k = carriedKeys[i];
      const isReal = functionalKeysRevealed.includes(k.symbol);
      const color = keyColors[k.typeName] || '#ffffff';
      slot.style.borderColor = color;
      slot.style.background = `${color}18`;
      slot.style.boxShadow = isReal ? `0 0 8px ${color}` : 'none';

      const icon = document.createElement('div');
      icon.textContent = keyIcons[k.typeName] || '🗝️';
      icon.style.fontSize = '1rem';
      slot.appendChild(icon);

      const label = document.createElement('div');
      label.textContent = k.typeName.split(' ')[0]; // "Amber", "Sapphire", etc.
      label.style.fontSize = '0.55rem';
      label.style.color = color;
      label.style.textAlign = 'center';
      label.style.lineHeight = '1.1';
      slot.appendChild(label);

      if (isReal) {
        const star = document.createElement('div');
        star.textContent = '★';
        star.style.fontSize = '0.5rem';
        star.style.color = '#fbbf24';
        star.title = 'Functional key!';
        slot.appendChild(star);
      }
    } else {
      // Empty slot
      slot.style.borderColor = 'rgba(255,255,255,0.1)';
      slot.style.background = 'rgba(255,255,255,0.02)';
      const empty = document.createElement('div');
      empty.textContent = i < MAX_CARRIED_KEYS ? '—' : '';
      empty.style.fontSize = '1.2rem';
      empty.style.color = 'rgba(255,255,255,0.15)';
      slot.appendChild(empty);
    }

    keysPanel.appendChild(slot);
  }

  // Update keys-hud-info count
  const keyHud = document.getElementById('keys-hud-info');
  if (keyHud) {
    const realCarried = carriedKeys.filter(k => functionalKeysRevealed.includes(k.symbol)).length;
    keyHud.textContent = `KEYS: ${carriedKeys.length}/${MAX_CARRIED_KEYS} carried  •  ${realCarried}/2 functional`;
  }
}

function getIconOrShortName(itemName) {
  switch (itemName) {
    case "EMF Radar": return "EMF";
    case "Thermal Camera": return "THERM";
    case "Breaker Remote": return "REMOTE";
    case "Battery Pack": return "BATT";
    case "Salt Cannister": return "SALT";
    case "Chalk / UV Spray": return "SPRAY";
    case "Adrenaline Shot": return "ADRN";
    case "Sanity Pills": return "PILLS";
    case "Ghost Claws": return "CLAW";
    case "Scent Tracker": return "SCENT";
    case "Infiltration Clone": return "CLONE";
    case "Audio Amplifiers": return "AUDIO";
    case "Vapor Leap": return "LEAP";
    case "Breaker Siphon": return "SIPHON";
    case "Sound Scrambler": return "SCRAM";
    default: return itemName;
  }
}

// Procedural audio context to emulate active sensors/static
function setupProceduralAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
  } catch (e) {
    console.warn("Web Audio API not supported on this browser.");
  }
}

function playEMFSound(frequency) {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  // Beep sound
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800 + frequency * 400, audioCtx.currentTime); // Pitch gets higher as they get closer
  
  // Crank the volume all the way up so it's clearly audible
  gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
  
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  
  osc.start();
  osc.stop(audioCtx.currentTime + 0.3);
}

async function setupMicrophone() {
  if (myTeam !== 'Human') return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const source = audioCtx.createMediaStreamSource(micStream);
    audioAnalyser = audioCtx.createAnalyser();
    audioAnalyser.fftSize = 256;
    source.connect(audioAnalyser);
    audioDataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
  } catch (err) {
    console.warn("Microphone access denied. Voice mechanics disabled.");
  }
}

// Generate Maze Geometry
let slidingWallSegments = [];
let openCorridors = []; // World positions of open corridor cells for ghost spawning
let mazeLayout = [];    // Grid layout for pathfinding (0=open, 1=wall, 2=sliding)
let mazeBlockSize = 4.5;
let mazeSizeGlobal = 35;

// Pathfinding helpers
function worldToGrid(wx, wz) {
  const col = Math.round((wx - mazeBlockSize/2) / mazeBlockSize + mazeSizeGlobal / 2);
  const row = Math.round((wz - mazeBlockSize/2) / mazeBlockSize + mazeSizeGlobal / 2);
  return { col: Math.max(0, Math.min(mazeSizeGlobal-1, col)), row: Math.max(0, Math.min(mazeSizeGlobal-1, row)) };
}

function gridToWorld(col, row) {
  const x = (col - mazeSizeGlobal / 2) * mazeBlockSize + mazeBlockSize/2;
  const z = (row - mazeSizeGlobal / 2) * mazeBlockSize + mazeBlockSize/2;
  return { x, z };
}

function bfsPath(startCol, startRow, endCol, endRow) {
  if (startCol === endCol && startRow === endRow) return [];
  
  const visited = Array(mazeSizeGlobal).fill(0).map(() => Array(mazeSizeGlobal).fill(false));
  const parent = Array(mazeSizeGlobal).fill(0).map(() => Array(mazeSizeGlobal).fill(null));
  const queue = [{ col: startCol, row: startRow }];
  visited[startRow][startCol] = true;
  
  const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
  
  while (queue.length > 0) {
    const curr = queue.shift();
    
    if (curr.col === endCol && curr.row === endRow) {
      // Reconstruct path
      const path = [];
      let c = curr;
      while (c) {
        path.unshift(gridToWorld(c.col, c.row));
        c = parent[c.row][c.col];
      }
      return path;
    }
    
    for (const [dc, dr] of dirs) {
      const nc = curr.col + dc, nr = curr.row + dr;
      if (nc >= 0 && nc < mazeSizeGlobal && nr >= 0 && nr < mazeSizeGlobal 
          && !visited[nr][nc] && mazeLayout[nr][nc] === 0) {
        visited[nr][nc] = true;
        parent[nr][nc] = curr;
        queue.push({ col: nc, row: nr });
      }
    }
  }
  
  return []; // No path found
}
function generateMaze(keysCount = 8) {
  // Clear any existing walls
  walls.forEach(w => scene.remove(w));
  walls = [];
  slidingWallSegments = [];

  // Ground plane
  const floorGeo = new THREE.PlaneGeometry(300, 300);
  const floorMat = new THREE.MeshStandardMaterial({ 
    color: 0x111827, 
    roughness: 0.8,
    metalness: 0.1
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Ceiling
  const ceilGeo = new THREE.PlaneGeometry(300, 300);
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x070b14, roughness: 0.9 });
  const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 3.5;
  scene.add(ceiling);

  // Grid layout for corridors (Massive Procedural Generation)
  const blockSize = 4.5;
  const mazeSize = 35; // 35x35 blocks = massive
  const layout = Array(mazeSize).fill(0).map(() => Array(mazeSize).fill(1));
  
  function carve(x, z) {
    layout[z][x] = 0;
    const dirs = [[0,-2], [0,2], [-2,0], [2,0]];
    dirs.sort(() => seededRandom() - 0.5);
    for (let [dx, dz] of dirs) {
      const nx = x + dx, nz = z + dz;
      if (nx > 0 && nx < mazeSize-1 && nz > 0 && nz < mazeSize-1 && layout[nz][nx] === 1) {
        layout[z + dz/2][x + dx/2] = 0;
        carve(nx, nz);
      }
    }
  }
  
  // Start carving from center
  const centerCoord = Math.floor(mazeSize/2) | 1;
  carve(centerCoord, centerCoord);
  layout[Math.floor(mazeSize/2)][Math.floor(mazeSize/2)] = 0; // Ensure true center spawn is safe

  // Scatter sliding doors (type 2)
  for(let i=0; i < 40; i++) {
    const rx = 1 + Math.floor(seededRandom() * (mazeSize-2));
    const rz = 1 + Math.floor(seededRandom() * (mazeSize-2));
    if (layout[rz][rx] === 1) layout[rz][rx] = 2; 
  }

  // Store layout globally for ghost pathfinding
  mazeLayout = layout.map(row => row.map(cell => cell === 0 ? 0 : 1)); // 0=open, 1=wall (treat sliding doors as walls for pathfinding)

  function createWallTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 4;
    for(let i=0; i<=512; i+=64) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
    }
    for(let i=0; i<150; i++) {
      ctx.fillStyle = seededRandom() > 0.7 ? '#450a0a' : '#020617';
      ctx.beginPath();
      ctx.arc(seededRandom()*512, seededRandom()*512, seededRandom()*15, 0, Math.PI*2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
  }
  
  const generatedTex = createWallTexture();

  const wallMat = new THREE.MeshStandardMaterial({ 
    map: generatedTex,
    color: 0x64748b, 
    roughness: 0.8,
    bumpScale: 0.2
  });
  
  const slidingWallMat = new THREE.MeshStandardMaterial({
    map: generatedTex,
    color: 0xd97706, // Neon orange warning stripe pattern
    roughness: 0.4,
  });

  const wallGeo = new THREE.BoxGeometry(blockSize, 4.5, blockSize);

  openCorridors = []; // Reset for new maze
  for (let r = 0; r < layout.length; r++) {
    for (let c = 0; c < layout[r].length; c++) {
      const type = layout[r][c];
      const xPos = (c - layout[r].length / 2) * blockSize + blockSize/2;
      const zPos = (r - layout.length / 2) * blockSize + blockSize/2;

      if (type === 1 || type === 2) {
        const wallMesh = new THREE.Mesh(wallGeo, type === 2 ? slidingWallMat : wallMat);
        wallMesh.position.set(xPos, 4.5 / 2, zPos);
        wallMesh.castShadow = true;
        wallMesh.receiveShadow = true;
        scene.add(wallMesh);
        walls.push(wallMesh);

        if (type === 2) {
          wallMesh.userData = { isSliding: true, col: c, row: r };
          // Keep track of sliding corridors for realignments
          slidingWallSegments.push(wallMesh);
        }
      } else {
        // type === 0 means open corridor — record world position for ghost spawning
        openCorridors.push({ x: xPos, z: zPos });
      }
    }
  }

  // Draw the Master Gate — visible from the start, but locked
  gateCoordinates = { x: 0, z: - (mazeSize/2 * blockSize) + 4 };
  const gateGeo = new THREE.BoxGeometry(10, 4, 1);
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9, roughness: 0.1 }); // Dark metal locked state
  const gateMesh = new THREE.Mesh(gateGeo, gateMat);
  gateMesh.position.set(gateCoordinates.x, 2, gateCoordinates.z);
  gateMeshRef = gateMesh;
  scene.add(gateMesh);
  walls.push(gateMesh);

  // Add a physical keypad to the door
  const padGeo = new THREE.BoxGeometry(0.8, 1.2, 0.2);
  const padMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });
  const padMesh = new THREE.Mesh(padGeo, padMat);
  padMesh.position.set(2, 0, 0.6); // Offset relative to door
  gateMesh.add(padMesh);

  // Add 2 physical keyholes to the door
  const holeGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.2, 16);
  holeGeo.rotateX(Math.PI / 2);
  const holeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
  const hole1 = new THREE.Mesh(holeGeo, holeMat);
  hole1.position.set(-2, 0.5, 0.5);
  gateMesh.add(hole1);
  const hole2 = new THREE.Mesh(holeGeo, holeMat);
  hole2.position.set(-2, -0.5, 0.5);
  gateMesh.add(hole2);

  // Spawn key collectibles in chests/lockers represented by boxes
  generateCollectibles(keysCount);
  generateCircuitBreakers();
  generateConsumableItems();
}

// 4 distinct key type definitions: shape + color + name
const KEY_TYPES = [
  { geo: () => new THREE.SphereGeometry(0.32, 10, 10),   color: 0xf59e0b, emissive: 0xf59e0b, label: 'Amber Orb'   },
  { geo: () => new THREE.OctahedronGeometry(0.38),        color: 0x60a5fa, emissive: 0x3b82f6, label: 'Sapphire Shard' },
  { geo: () => new THREE.TetrahedronGeometry(0.4),        color: 0xa78bfa, emissive: 0x7c3aed, label: 'Violet Prism' },
  { geo: () => new THREE.DodecahedronGeometry(0.3),       color: 0x34d399, emissive: 0x10b981, label: 'Emerald Gem'  },
];

function generateCollectibles(keysCount) {
  // Clear any existing keys
  keysInMaze.forEach(k => scene.remove(k.mesh));
  keysInMaze = [];

  // Also clear old code clue notes
  codeClueNotes.forEach(n => scene.remove(n.mesh));
  codeClueNotes = [];

  const symbols = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];

  for (let i = 0; i < keysCount; i++) {
    const typeIdx = i % KEY_TYPES.length;
    const kt = KEY_TYPES[typeIdx];
    const mat = new THREE.MeshStandardMaterial({ color: kt.color, emissive: kt.emissive, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3 });
    const mesh = new THREE.Mesh(kt.geo(), mat);

    let x = 0, z = 0;
    if (openCorridors.length > 0) {
      const randIdx = Math.floor(seededRandom() * openCorridors.length);
      x = openCorridors[randIdx].x;
      z = openCorridors[randIdx].z;
    } else {
      const angle = (i / keysCount) * Math.PI * 2;
      x = Math.cos(angle) * (15 + seededRandom() * 20);
      z = Math.sin(angle) * (15 + seededRandom() * 20);
    }
    mesh.position.set(x, 0.45, z);
    // Store key type label in userData for HUD hints
    mesh.userData.keyTypeLabel = kt.label;
    scene.add(mesh);

    keysInMaze.push({ mesh, symbol: symbols[i % 10], index: i, typeName: kt.label });
  }

  // Spawn code clue notes — small glowing plates hinting at the cipher code digits
  generateCodeClues();
}

function generateCodeClues() {
  // Scatter 4 glowing clue slabs around the maze, each hinting at one digit of the code
  const noteGeo = new THREE.BoxGeometry(0.6, 0.8, 0.08);
  const noteMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xfde047, emissiveIntensity: 0.9, roughness: 0.5 });

  for (let i = 0; i < 4; i++) {
    const noteMesh = new THREE.Mesh(noteGeo, noteMat.clone());
    let x = 0, z = 0;
    if (openCorridors.length > 4) {
      const randIdx = Math.floor(seededRandom() * openCorridors.length);
      x = openCorridors[randIdx].x;
      z = openCorridors[randIdx].z;
    } else {
      x = (seededRandom() - 0.5) * 60;
      z = (seededRandom() - 0.5) * 60;
    }
    noteMesh.position.set(x, 1.0, z);
    noteMesh.rotation.y = seededRandom() * Math.PI;
    scene.add(noteMesh);
    codeClueNotes.push({ mesh: noteMesh, digitIndex: i, collected: false });
  }
}

function generateCircuitBreakers() {
  circuitBreakers.forEach(b => scene.remove(b.mesh));
  circuitBreakers = [];
  fixedBreakersCount = 0;

  const breakerGeo = new THREE.BoxGeometry(1.2, 2.0, 1.2);
  
  for (let i = 0; i < totalBreakersRequired; i++) {
    const breakerMat = new THREE.MeshStandardMaterial({ color: 0xff0000, metalness: 0.8, roughness: 0.2 });
    const mesh = new THREE.Mesh(breakerGeo, breakerMat);
    
    let x = 0; let z = 0;
    if (openCorridors.length > 0) {
      const randIdx = Math.floor(seededRandom() * openCorridors.length);
      x = openCorridors[randIdx].x;
      z = openCorridors[randIdx].z;
    } else {
      x = (seededRandom() - 0.5) * 40;
      z = (seededRandom() - 0.5) * 40;
    }
    
    mesh.position.set(x, 1.0, z);
    scene.add(mesh);
    
    circuitBreakers.push({
      mesh: mesh,
      isFixed: false
    });
  }
}

function generateConsumableItems() {
  itemsInMaze.forEach(item => scene.remove(item.mesh));
  itemsInMaze = [];

  const itemTypes = [
    { name: 'Battery Pack', color: 0x22c55e },
    { name: 'EMF Radar', color: 0x3b82f6 },
    { name: 'Thermal Camera', color: 0xf97316 },
    { name: 'Sanity Pills', color: 0xec4899 }
  ];

  const itemGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.6, 8);

  // Spawn 10 random items
  for (let i = 0; i < 10; i++) {
    const type = itemTypes[Math.floor(seededRandom() * itemTypes.length)];
    const itemMat = new THREE.MeshStandardMaterial({ color: type.color, emissive: type.color, emissiveIntensity: 0.2 });
    const mesh = new THREE.Mesh(itemGeo, itemMat);

    let x = 0, z = 0;
    if (openCorridors.length > 0) {
      const randIdx = Math.floor(seededRandom() * openCorridors.length);
      x = openCorridors[randIdx].x;
      z = openCorridors[randIdx].z;
    } else {
      x = (seededRandom() - 0.5) * 40;
      z = (seededRandom() - 0.5) * 40;
    }

    mesh.position.set(x, 0.3, z);
    scene.add(mesh);

    itemsInMaze.push({
      mesh: mesh,
      name: type.name
    });
  }
}

// Corridor shifting alignment
function realignMazeCorridors(realignmentState) {
  const solvedCount = realignmentState.puzzleRoomsSolved;
  
  // Display shifting alert
  triggerNotification(`maze realignment triggered! walls shifting...`);

  // Move sliding wall pieces either up into the ceiling or sliding sideways
  slidingWallSegments.forEach((segment, idx) => {
    // Odd/Even shift patterns
    const targetY = (solvedCount % 2 === 0) ? (idx % 2 === 0 ? 3.5 / 2 : -3) : (idx % 2 === 0 ? -3 : 3.5 / 2);
    
    // Update mazeLayout immediately for pathfinding path recalculation
    if (segment.userData && segment.userData.col !== undefined) {
      const { col, row } = segment.userData;
      mazeLayout[row][col] = (targetY < 0) ? 0 : 1;
    }

    // Smooth sliding animation
    let currentY = segment.position.y;
    const anim = () => {
      if (Math.abs(segment.position.y - targetY) > 0.05) {
        segment.position.y += (targetY - segment.position.y) * 0.1;
        requestAnimationFrame(anim);
      } else {
        segment.position.y = targetY;
      }
    };
    anim();
  });
}

function setupControls() {
  const container = document.getElementById('canvas-container');
  const onKeyDown = (event) => {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        moveForward = true;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        moveLeft = true;
        break;
      case 'ArrowDown':
      case 'KeyS':
        moveBackward = true;
        break;
      case 'ArrowRight':
      case 'KeyD':
        moveRight = true;
        break;
      case 'KeyE':
        // Interact key
        checkInteractions();
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        if (myTeam === 'Human' && stamina > SPRINT_MIN_STAMINA) isSprinting = true;
        break;
      case 'KeyQ':
        dropKey();
        break;
      case 'Space':
        // Risk/Reward Ability: Panic Hide
        triggerPanicHide();
        break;
      case 'KeyG':
        dropActiveItem();
        break;
      case 'BracketLeft':
        activeSlot = (activeSlot - 1 + inventory.length) % inventory.length;
        renderHUDInventory();
        break;
      case 'BracketRight':
        activeSlot = (activeSlot + 1) % inventory.length;
        renderHUDInventory();
        break;
      case 'Digit1': if (inventory.length > 0) { activeSlot = 0; renderHUDInventory(); } break;
      case 'Digit2': if (inventory.length > 1) { activeSlot = 1; renderHUDInventory(); } break;
      case 'Digit3': if (inventory.length > 2) { activeSlot = 2; renderHUDInventory(); } break;
      case 'Digit4': if (inventory.length > 3) { activeSlot = 3; renderHUDInventory(); } break;
      case 'Digit5': if (inventory.length > 4) { activeSlot = 4; renderHUDInventory(); } break;
      case 'Digit6': if (inventory.length > 5) { activeSlot = 5; renderHUDInventory(); } break;
      case 'Digit7': if (inventory.length > 6) { activeSlot = 6; renderHUDInventory(); } break;
      case 'Digit8': if (inventory.length > 7) { activeSlot = 7; renderHUDInventory(); } break;
      case 'Digit9': if (inventory.length > 8) { activeSlot = 8; renderHUDInventory(); } break;
      case 'Digit0': if (inventory.length > 9) { activeSlot = 9; renderHUDInventory(); } break;
      case 'Minus':  if (inventory.length > 10) { activeSlot = 10; renderHUDInventory(); } break;
      case 'Equal':  if (inventory.length > 11) { activeSlot = 11; renderHUDInventory(); } break;
    }
  };

  const onKeyUp = (event) => {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        moveForward = false;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        moveLeft = false;
        break;
      case 'ArrowDown':
      case 'KeyS':
        moveBackward = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        moveRight = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        isSprinting = false;
        break;
    }
  };

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  
  document.addEventListener('mousedown', (e) => {
    if (isMobileDevice) return;
    if (document.pointerLockElement !== document.getElementById('canvas-container') || isCaptured) return;
    if (e.button === 0) { // Left click
      useActiveItem();
    }
  });

  // Mouse camera rotation controller
  document.addEventListener('mousemove', (e) => {
    if (isMobileDevice) return;
    if (document.pointerLockElement === document.getElementById('canvas-container')) {
      camera.rotation.y -= e.movementX * 0.002;
      camera.rotation.x -= e.movementY * 0.002;
      camera.rotation.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camera.rotation.x));
    }
  });

  // Mobile Touch Controls
  {
    let lookTouchId = null;
    let lastLookX = 0;
    let lastLookY = 0;

    // Listen on document to bypass pointer-events touch bugs in mobile viewports
    document.addEventListener('touchstart', (e) => {
      if (!isMobileDevice) return;
      if (isCaptured || !window.gameReady) return;
      
      // Ignore touch starts on joystick or action buttons
      if (e.target.closest('#mobile-joystick') || e.target.closest('#mobile-actions') || e.target.closest('#btn-mobile-pause')) {
        return;
      }

      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.clientX < window.innerWidth * 0.45 && t.clientY > window.innerHeight * 0.45) {
          continue;
        }
        if (lookTouchId === null) {
          lookTouchId = t.identifier;
          lastLookX = t.clientX;
          lastLookY = t.clientY;
          break;
        }
      }
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      if (!isMobileDevice) return;
      if (isCaptured || !window.gameReady) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === lookTouchId) {
          const dx = t.clientX - lastLookX;
          const dy = t.clientY - lastLookY;

          camera.rotation.y -= dx * 0.004;
          camera.rotation.x -= dy * 0.004;
          camera.rotation.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camera.rotation.x));

          lastLookX = t.clientX;
          lastLookY = t.clientY;
          e.preventDefault();
          break;
        }
      }
    }, { passive: false });

    const clearLookTouch = (e) => {
      if (!isMobileDevice) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === lookTouchId) {
          lookTouchId = null;
          break;
        }
      }
    };
    document.addEventListener('touchend', clearLookTouch);
    document.addEventListener('touchcancel', clearLookTouch);

    // Joystick logic
    const joystickBase = document.getElementById('joystick-base');
    const joystickKnob = document.getElementById('joystick-knob');
    let joystickTouchId = null;
    let joystickStart = { x: 0, y: 0 };
    const maxJoystickDistance = 35;

    joystickBase.addEventListener('touchstart', (e) => {
      if (!isMobileDevice) return;
      if (joystickTouchId !== null) return;
      const touch = e.targetTouches[0];
      joystickTouchId = touch.identifier;
      const rect = joystickBase.getBoundingClientRect();
      joystickStart.x = rect.left + rect.width / 2;
      joystickStart.y = rect.top + rect.height / 2;
      updateJoystick(touch.clientX, touch.clientY);
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (!isMobileDevice) return;
      if (joystickTouchId === null) return;
      for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i];
        if (touch.identifier === joystickTouchId) {
          updateJoystick(touch.clientX, touch.clientY);
          e.preventDefault();
        }
      }
    }, { passive: false });

    const resetJoystick = () => {
      joystickTouchId = null;
      joystickKnob.style.transform = 'translate(0px, 0px)';
      moveForward = false;
      moveBackward = false;
      moveLeft = false;
      moveRight = false;
    };

    window.addEventListener('touchend', (e) => {
      if (!isMobileDevice) return;
      if (joystickTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === joystickTouchId) {
          resetJoystick();
        }
      }
    });

    window.addEventListener('touchcancel', (e) => {
      if (!isMobileDevice) return;
      if (joystickTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === joystickTouchId) {
          resetJoystick();
        }
      }
    });

    function updateJoystick(clientX, clientY) {
      let dx = clientX - joystickStart.x;
      let dy = clientY - joystickStart.y;
      const dist = Math.sqrt(dx*dx + dy*dy);

      if (dist > maxJoystickDistance) {
        dx = (dx / dist) * maxJoystickDistance;
        dy = (dy / dist) * maxJoystickDistance;
      }

      joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;

      const joyX = dx / maxJoystickDistance;
      const joyY = dy / maxJoystickDistance;

      moveForward = joyY < -0.2;
      moveBackward = joyY > 0.2;
      moveLeft = joyX < -0.2;
      moveRight = joyX > 0.2;
    }

    // Action button bindings using touchstart & click for instant response
    const useBtn = document.getElementById('btn-mobile-use');
    const interactBtn = document.getElementById('btn-mobile-interact');
    const specialBtn = document.getElementById('btn-mobile-special');
    const pauseBtn = document.getElementById('btn-mobile-pause');
    const ptrOverlay = document.getElementById('pointer-lock-overlay');

    const handleUse = (e) => {
      if (!isMobileDevice) return;
      e.preventDefault();
      e.stopPropagation();
      if (!isCaptured && window.gameReady) useActiveItem();
    };
    useBtn.addEventListener('touchstart', handleUse, { passive: false });
    useBtn.addEventListener('click', handleUse);

    const handleInteract = (e) => {
      if (!isMobileDevice) return;
      e.preventDefault();
      e.stopPropagation();
      if (!isCaptured && window.gameReady) checkInteractions();
    };
    interactBtn.addEventListener('touchstart', handleInteract, { passive: false });
    interactBtn.addEventListener('click', handleInteract);

    const handleSpecial = (e) => {
      if (!isMobileDevice) return;
      e.preventDefault();
      e.stopPropagation();
      if (!isCaptured && window.gameReady) triggerPanicHide();
    };
    specialBtn.addEventListener('touchstart', handleSpecial, { passive: false });
    specialBtn.addEventListener('click', handleSpecial);

    const dropBtn = document.getElementById('btn-mobile-drop');
    if (dropBtn) {
      const handleDrop = (e) => {
        if (!isMobileDevice) return;
        e.preventDefault();
        e.stopPropagation();
        if (!isCaptured && window.gameReady) dropKey();
      };
      dropBtn.addEventListener('touchstart', handleDrop, { passive: false });
      dropBtn.addEventListener('click', handleDrop);
    }

    const dropItemBtn = document.getElementById('btn-mobile-drop-item');
    if (dropItemBtn) {
      const handleDropItem = (e) => {
        if (!isMobileDevice) return;
        e.preventDefault();
        e.stopPropagation();
        if (!isCaptured && window.gameReady) dropActiveItem();
      };
      dropItemBtn.addEventListener('touchstart', handleDropItem, { passive: false });
      dropItemBtn.addEventListener('click', handleDropItem);
    }

    const handlePause = (e) => {
      if (!isMobileDevice) return;
      e.preventDefault();
      e.stopPropagation();
      window.mobileGameActive = false;
      ptrOverlay.style.display = 'flex';
    };
    pauseBtn.addEventListener('touchstart', handlePause, { passive: false });
    pauseBtn.addEventListener('click', handlePause);

    // Mouse scroll wheel for cycling active slot
    document.addEventListener('wheel', (e) => {
      if (isCaptured || !window.gameReady) return;
      if (e.deltaY > 0) {
        activeSlot = (activeSlot + 1) % inventory.length;
        renderHUDInventory();
      } else if (e.deltaY < 0) {
        activeSlot = (activeSlot - 1 + inventory.length) % inventory.length;
        renderHUDInventory();
      }
    });
  }
}

// Dynamically render on-screen keys/breaker/item interaction prompts in HUD
function updateInteractionPrompt() {
  const promptEl = document.getElementById('interaction-prompt');
  if (!promptEl) return;

  if (myTeam !== 'Human' || isCaptured || !window.gameReady) {
    promptEl.style.display = 'none';
    return;
  }

  let minDistance = Infinity;
  let promptText = "";

  // 1. Check Master Gate
  const distToGate = camera.position.distanceTo(new THREE.Vector3(gateCoordinates.x, camera.position.y, gateCoordinates.z));
  if (distToGate < 6.0) {
    if (distToGate < minDistance) {
      minDistance = distToGate;
      if (!gateSolved) {
        promptText = isMobileDevice ? "Tap INTERACT to Open Keypad" : "Press <kbd>E</kbd> to Open Keypad";
      } else {
        const carriedSymbols = carriedKeys.map(k => k.symbol);
        const hasFirstKey = carriedSymbols.includes(functionalKeysRevealed[0]);
        const hasSecondKey = carriedSymbols.includes(functionalKeysRevealed[1]);
        const breakersFixed = fixedBreakersCount >= totalBreakersRequired;
        if (hasFirstKey && hasSecondKey && breakersFixed) {
          promptText = isMobileDevice ? "Tap INTERACT to Escape Labyrinth!" : "Press <kbd>E</kbd> to Escape Labyrinth!";
        } else {
          promptText = `Master Gate: Need 2 Keys & 3 Breakers (${fixedBreakersCount}/${totalBreakersRequired})`;
        }
      }
    }
  }

  // 2. Check Keys in Maze
  for (let i = 0; i < keysInMaze.length; i++) {
    const key = keysInMaze[i];
    const distToKey = camera.position.distanceTo(key.mesh.position);
    if (distToKey < 5.0) {
      if (distToKey < minDistance) {
        minDistance = distToKey;
        if (carriedKeys.length < MAX_CARRIED_KEYS) {
          promptText = isMobileDevice ? `Tap INTERACT to collect ${key.typeName}` : `Press <kbd>E</kbd> to collect ${key.typeName}`;
        } else {
          promptText = isMobileDevice ? `Hands Full! Tap DROP KEY to replace` : `Hands Full! Press <kbd>Q</kbd> to drop a key first`;
        }
      }
    }
  }

  // 3. Check Circuit Breakers
  for (let i = 0; i < circuitBreakers.length; i++) {
    const breaker = circuitBreakers[i];
    if (breaker.isFixed) continue;
    const distToBreaker = camera.position.distanceTo(breaker.mesh.position);
    if (distToBreaker < 4.5) {
      if (distToBreaker < minDistance) {
        minDistance = distToBreaker;
        promptText = isMobileDevice ? "Tap INTERACT to repair breaker" : "Press <kbd>E</kbd> to repair breaker";
      }
    }
  }

  // 4. Check Code Clue Notes
  for (let i = 0; i < codeClueNotes.length; i++) {
    const note = codeClueNotes[i];
    if (note.collected) continue;
    const distToNote = camera.position.distanceTo(note.mesh.position);
    if (distToNote < 4.5) {
      if (distToNote < minDistance) {
        minDistance = distToNote;
        promptText = isMobileDevice ? "Tap INTERACT to collect clue" : "Press <kbd>E</kbd> to collect clue";
      }
    }
  }

  // 5. Check Pick-up Items
  for (let i = 0; i < itemsInMaze.length; i++) {
    const item = itemsInMaze[i];
    const distToItem = camera.position.distanceTo(item.mesh.position);
    if (distToItem < 4.5) {
      if (distToItem < minDistance) {
        minDistance = distToItem;
        if (inventory.length < 8) {
          promptText = isMobileDevice ? `Tap INTERACT to pick up ${item.name}` : `Press <kbd>E</kbd> to pick up ${item.name}`;
        } else {
          promptText = `Inventory Full! Cannot pick up ${item.name}`;
        }
      }
    }
  }

  if (promptText) {
    promptEl.innerHTML = promptText;
    promptEl.style.display = 'block';
  } else {
    promptEl.style.display = 'none';
  }
}

function checkInteractions() {
  // 1. Check proximity to Keypad Terminal (Master Gate)
  const distToGate = camera.position.distanceTo(new THREE.Vector3(gateCoordinates.x, camera.position.y, gateCoordinates.z));
  if (distToGate < 6) {
    if (!gateSolved) {
      openKeypadModal();
    } else {
      const carriedSymbols = carriedKeys.map(k => k.symbol);
      const hasFirstKey = carriedSymbols.includes(functionalKeysRevealed[0]);
      const hasSecondKey = carriedSymbols.includes(functionalKeysRevealed[1]);
      const breakersFixed = fixedBreakersCount >= totalBreakersRequired;
      
      if (!hasFirstKey || !hasSecondKey) {
        const realCarried = carriedKeys.filter(k => functionalKeysRevealed.includes(k.symbol)).length;
        triggerNotification(`need both functional keys! (${realCarried}/2 in hand)`);
      } else if (!breakersFixed) {
        triggerNotification(`master gate needs power! fix circuit breakers (${fixedBreakersCount}/${totalBreakersRequired})`);
      } else {
        triggerNotification("master gate breached! escape successful!");
      }
    }
    return;
  }

  // 2. Check proximity to Collectible Keys
  for (let i = 0; i < keysInMaze.length; i++) {
    const key = keysInMaze[i];
    const distToKey = camera.position.distanceTo(key.mesh.position);
    if (distToKey < 5.0) {
      // Enforce carry limit
      if (carriedKeys.length >= MAX_CARRIED_KEYS) {
        triggerNotification(`Hands full! Max ${MAX_CARRIED_KEYS} keys — drop one first.`);
        break;
      }
      // Picked up!
      scene.remove(key.mesh);
      carriedKeys.push({ symbol: key.symbol, typeName: key.typeName });
      foundKeysList.push(key.symbol);

      const isReal = functionalKeysRevealed.includes(key.symbol);
      triggerNotification(`Picked up [${key.typeName}]${isReal ? ' ★ FUNCTIONAL KEY!' : ''} (${carriedKeys.length}/${MAX_CARRIED_KEYS})`);

      // Refresh the carried-keys HUD
      renderCarriedKeysHUD();

      // Check if we retrieved the exact matching real keys
      checkWinCondition();

      // Emit event (triggers maze realignment)
      socketClient.emit('solve_puzzle_room');
      keysInMaze.splice(i, 1);
      break;
    }
  }

  // 3. Check proximity to Circuit Breakers
  for (let i = 0; i < circuitBreakers.length; i++) {
    const breaker = circuitBreakers[i];
    if (breaker.isFixed) continue;
    
    const distToBreaker = camera.position.distanceTo(breaker.mesh.position);
    if (distToBreaker < 4.5) {
      breaker.isFixed = true;
      breaker.mesh.material.color.setHex(0x10b981); // Turn green
      fixedBreakersCount++;
      
      // Increase global ambient light slightly with each fixed breaker
      if (ambientLight) {
        ambientLight.intensity = 1.5 + (fixedBreakersCount * 1.5);
      }

      triggerNotification(`circuit breaker repaired! (${fixedBreakersCount}/${totalBreakersRequired})`);
      
      checkWinCondition();
      break;
    }
  }

  // 4. Check proximity to Code Clue Notes (yellow glowing slabs)
  for (let i = 0; i < codeClueNotes.length; i++) {
    const note = codeClueNotes[i];
    if (note.collected) continue;
    const distToNote = camera.position.distanceTo(note.mesh.position);
    if (distToNote < 4.5) {
      note.collected = true;
      note.mesh.material.emissiveIntensity = 0.1; // dim it so it looks consumed

      const digitNames = ['1ST', '2ND', '3RD', '4TH'];
      const digits = window.cipherCodeDigits || [null, null, null, null];
      const revealedDigit = digits[note.digitIndex];

      triggerNotification(`cipher clue found! ${digitNames[note.digitIndex]} digit of gate code: [ ${revealedDigit} ]`);

      // Update the cipher HUD to show collected digits so far (unknown ones shown as _)
      const cipherHUD = document.getElementById('hud-cipher-info');
      if (cipherHUD) {
        const display = digits.map((d, idx) => {
          const collected = codeClueNotes.find(n => n.digitIndex === idx && n.collected);
          return collected ? d : '_';
        }).join(' ');
        cipherHUD.textContent = `CODE: ${display}`;
      }

      // Also live-update the keypad screen if it's currently open
      if (keypadUI && keypadUI.style.display !== 'none') {
        keypadScreen.textContent = getKeypadDisplayString();
      }
      break;
    }
  }

  // 5. Check proximity to Pick-up Items (find empty slot & check unique items)
  for (let i = 0; i < itemsInMaze.length; i++) {
    const item = itemsInMaze[i];
    const dist = camera.position.distanceTo(item.mesh.position);
    if (dist < 4.5) {
      // UNIQUE EQUIPMENT CHECK: Prevent carrying duplicates of passive/reusable items
      const uniqueEquipment = ["EMF Radar", "Thermal Camera", "Breaker Remote"];
      if (uniqueEquipment.includes(item.name) && inventory.includes(item.name)) {
        triggerNotification(`You already have a ${item.name}!`);
        break;
      }

      // Look for the first empty slot to place the item
      const emptyIndex = inventory.indexOf('');
      if (emptyIndex !== -1) {
        inventory[emptyIndex] = item.name;
        scene.remove(item.mesh);
        itemsInMaze.splice(i, 1);
        triggerNotification(`Picked up ${item.name}`);
        renderHUDInventory();
      } else {
        triggerNotification("Inventory full! Drop an item first.");
      }
      break;
    }
  }
}

function useActiveItem() {
  const item = inventory[activeSlot];
  if (!item) return;

  if (myTeam === 'Ghost' && window.ghostsFrozen) {
    triggerNotification("You are frozen by a Breaker Remote!");
    return;
  }

  if (item === "Sanity Pills") {
    currentSanity = 100;
    triggerNotification("sanity restored.");
    removeItem(activeSlot);
  } else if (item === "Adrenaline Shot") {
    speedBoostTimer = 10;
    triggerNotification("adrenaline engaged! speed increased.");
    removeItem(activeSlot);
  } else if (item === "Salt Cannister") {
    deploySaltTrap();
    removeItem(activeSlot);
  } else if (item === "EMF Radar") {
    triggerNotification("EMF radar is passively active when held.");
  } else if (item === "Battery Pack") {
    flashlightBattery = 100;
    if (flashLight) flashLight.intensity = 200;
    triggerNotification("flashlight battery recharged.");
    removeItem(activeSlot);
  } else if (item === "Breaker Remote") {
    freezeGhosts();
    socketClient.emit('breaker_remote');
    removeItem(activeSlot);
  } else if (item === "Thermal Camera") {
    triggerNotification("thermal camera is passively active when held.");
  } else if (item === "Ghost Claws") {
    if (myTeam !== 'Ghost') return;
    let closestId = null;
    let closestDist = 4.0;
    Object.keys(players3D).forEach(id => {
      const dist = camera.position.distanceTo(players3D[id].position);
      const isHuman = players3D[id].material.color.getHex() === 0x3b82f6;
      if (isHuman && dist < closestDist) {
        closestDist = dist;
        closestId = id;
      }
    });
    if (closestId) {
      socketClient.emit('capture_human', { targetId: closestId });
      triggerNotification("Captured a survivor!");
    } else {
      triggerNotification("No survivor in range.");
    }
  } else if (item === "Scent Tracker") {
    triggerNotification("Scent tracking active.");
    let closestDist = 9999;
    let closestPos = null;
    Object.keys(players3D).forEach(id => {
      const dist = camera.position.distanceTo(players3D[id].position);
      const isHuman = players3D[id].material.color.getHex() === 0x3b82f6;
      if (isHuman && dist < closestDist) {
        closestDist = dist;
        closestPos = players3D[id].position;
      }
    });
    if (closestPos) {
      const material = new THREE.LineBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.8 });
      const points = [new THREE.Vector3(camera.position.x, 0.1, camera.position.z), new THREE.Vector3(closestPos.x, 0.1, closestPos.z)];
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
      scene.add(line);
      setTimeout(() => scene.remove(line), 5000);
    }
    removeItem(activeSlot);
  } else if (item === "Infiltration Clone") {
    triggerNotification("Mimic clone active! You appear human.");
    socketClient.emit('mimic_clone');
    removeItem(activeSlot);
  } else if (item === "Audio Amplifiers") {
    triggerNotification("Audio Amplifiers engaged! Extreme speed.");
    speedBoostTimer = 10;
    removeItem(activeSlot);
  } else if (item === "Vapor Leap") {
    triggerNotification("Vapor Leap!");
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    camera.position.addScaledVector(forward, 12);
    removeItem(activeSlot);
  } else if (item === "Breaker Siphon") {
    triggerNotification("Breaker Siphon deployed!");
    socketClient.emit('breaker_siphon');
    removeItem(activeSlot);
  } else if (item === "Sound Scrambler") {
    triggerNotification("Scrambler unleashed!");
    socketClient.emit('sound_scramble');
    removeItem(activeSlot);
  } else if (item === "Chalk / UV Spray") {
    deployChalkDecal(camera.position);
    socketClient.emit('chalk_spray', { position: { x: camera.position.x, z: camera.position.z } });
    removeItem(activeSlot);
  } else {
    triggerNotification(`${item} cannot be deployed yet.`);
  }
}

function deployChalkDecal(pos) {
  const geo = new THREE.PlaneGeometry(1.5, 1.5);
  const mat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(pos.x, 0.02, pos.z);
  scene.add(mesh);
}

function removeItem(index) {
  inventory.splice(index, 1);
  renderHUDInventory();
  if (activeSlot >= inventory.length) activeSlot = Math.max(0, inventory.length - 1);
}

function deploySaltTrap() {
  const saltGeo = new THREE.CylinderGeometry(2.0, 2.0, 0.05, 16);
  const saltMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const salt = new THREE.Mesh(saltGeo, saltMat);
  salt.position.set(camera.position.x, 0.05, camera.position.z);
  salt.userData = { triggered: false };
  scene.add(salt);
  saltTraps.push(salt);
  triggerNotification("salt barrier deployed.");
}

// Keypad dialog helpers — queried lazily to avoid null refs at module load time
let keypadUI, keypadScreen, keypadBtns, keypadClearBtn, keypadSubmitBtn, keypadCloseBtn;

// Show the exit gate with an animation effect (now unlocks the already visible door)
function showExitGate() {
  if (!gateMeshRef) return;
  // Flash the gate into unlocked state with a green emissive glow
  gateMeshRef.material.color.setHex(0x10b981);
  gateMeshRef.material.emissive = new THREE.Color(0x10b981);
  gateMeshRef.material.emissiveIntensity = 1.0;
  setTimeout(() => {
    if (gateMeshRef) {
      gateMeshRef.material.emissiveIntensity = 0.3;
    }
  }, 1500);
  triggerNotification("⚠️ EXIT GATE UNLOCKED — Race to the Gate!");
}

// Keypad display — always show exactly what the player has typed, no auto-fill
function getKeypadDisplayString() {
  let display = '';
  for (let i = 0; i < 4; i++) {
    display += (i < codeEntered.length ? codeEntered[i] : '_');
    if (i < 3) display += ' ';
  }
  return display;
}

function openKeypadModal() {
  if (gateSolved) {
    triggerNotification("Master Gate protocol already bypassed.");
    return;
  }
  if (!keypadUI) return;
  keypadUI.style.display = 'flex';
  document.exitPointerLock();
  codeEntered = "";
  keypadScreen.textContent = getKeypadDisplayString();
}

function setupKeypadListeners() {
  keypadUI        = document.getElementById('keypad-modal-ui');
  keypadScreen    = document.getElementById('keypad-screen-display');
  keypadBtns      = document.querySelectorAll('.keypad-grid .keypad-btn');
  keypadClearBtn  = document.getElementById('keypad-clear');
  keypadSubmitBtn = document.getElementById('keypad-submit');
  keypadCloseBtn  = document.getElementById('keypad-close');

  if (!keypadUI) return; // guard: element not in DOM yet

  const closeKeypad = () => {
    keypadUI.style.display = 'none';
    codeEntered = '';
  };

  keypadCloseBtn.addEventListener('click', closeKeypad);

  // ESC key closes the keypad
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && keypadUI && keypadUI.style.display !== 'none') {
      closeKeypad();
    }
  });

  keypadClearBtn.addEventListener('click', () => {
    codeEntered = "";
    keypadScreen.textContent = getKeypadDisplayString();
  });

  keypadBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const val = e.target.textContent;
      if (val === 'CLR' || val === 'ENT') return;
      // Let players type all 4 digits freely — no auto-fill from clue notes
      if (codeEntered.length < 4) {
        codeEntered += val;
        keypadScreen.textContent = getKeypadDisplayString();
      }
    });
  });

  keypadSubmitBtn.addEventListener('click', () => {
    if (codeEntered.length < 4) {
      triggerNotification("Enter all 4 digits first.");
      return;
    }
    socketClient.emit('try_cipher', codeEntered);
    closeKeypad();
  });
}

// Drop the active item in inventory
function dropActiveItem() {
  const item = inventory[activeSlot];
  if (!item || item === "") {
    triggerNotification("No item in active slot to drop.");
    return;
  }
  
  if (myTeam === 'Ghost') {
    triggerNotification("Ghosts cannot drop items.");
    return;
  }

  // Remove from inventory
  inventory[activeSlot] = "";
  renderHUDInventory();

  // Calculate spawn position in front of player
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const spawnPos = new THREE.Vector3()
    .copy(camera.position)
    .addScaledVector(dir, 1.8);
  spawnPos.y = 0.3; // Floor height

  // Emit event to network so teammates see it
  socketClient.emit('item_dropped', {
    name: item,
    position: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z }
  });

  // Spawn it locally
  spawnDroppedItemLocal(item, spawnPos);
  triggerNotification(`Dropped ${item}`);
}

function spawnDroppedItemLocal(name, pos) {
  let color = 0xffffff;
  if (name === 'Battery Pack') color = 0x22c55e;
  else if (name === 'EMF Radar') color = 0x3b82f6;
  else if (name === 'Thermal Camera') color = 0xf97316;
  else if (name === 'Sanity Pills') color = 0xec4899;
  else if (name === 'Breaker Remote') color = 0xa855f7;
  else if (name === 'Adrenaline Shot') color = 0xe11d48;
  else if (name === 'Salt Cannister') color = 0xf8fafc;
  else if (name === 'Chalk / UV Spray') color = 0xfef08a;

  const itemGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.6, 8);
  const itemMat = new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.2 });
  const mesh = new THREE.Mesh(itemGeo, itemMat);
  mesh.position.copy(pos);
  scene.add(mesh);

  itemsInMaze.push({
    mesh: mesh,
    name: name
  });
}

// Drop the most recently collected key
function dropKey() {
  if (carriedKeys.length === 0) {
    triggerNotification("No keys to drop.");
    return;
  }

  const poppedKey = carriedKeys.pop();
  
  // Remove from foundKeysList so it doesn't count towards the win condition anymore
  const symbolIndex = foundKeysList.indexOf(poppedKey.symbol);
  if (symbolIndex > -1) {
    foundKeysList.splice(symbolIndex, 1);
  }

  // Re-instantiate the 3D mesh
  const kt = KEY_TYPES.find(k => k.label === poppedKey.typeName) || KEY_TYPES[0];
  const mat = new THREE.MeshStandardMaterial({ 
    color: kt.color, 
    emissive: kt.emissive, 
    emissiveIntensity: 0.8,
    metalness: 0.8,
    roughness: 0.2
  });
  const mesh = new THREE.Mesh(kt.geo(), mat);
  
  // Drop it slightly in front of the player
  const dropPos = new THREE.Vector3(0, 0, -2).applyQuaternion(camera.quaternion).add(camera.position);
  mesh.position.set(dropPos.x, 1.0, dropPos.z);
  scene.add(mesh);

  keysInMaze.push({
    mesh: mesh,
    symbol: poppedKey.symbol,
    typeName: poppedKey.typeName
  });

  renderCarriedKeysHUD();
  checkWinCondition();
  triggerNotification(`Dropped [${poppedKey.typeName}]`);
}

// Trigger risk/reward: Panic Hide
function triggerPanicHide() {
  if (isPanicked || currentHP <= 5 || myTeam !== 'Human') return;

  isPanicked = true;
  panicTimer = 20; // 20 seconds duration

  // Deduct 5 HP
  currentHP = Math.max(0, currentHP - 5);
  document.getElementById('hp-value').textContent = `${Math.ceil(currentHP)} HP`;
  document.getElementById('hp-bar').style.width = `${currentHP}%`;

  // Make invisible (Panic Hide)
  if (flashLight) flashLight.intensity = 30; // Dim, but not pitch black
  camera.fog = new THREE.FogExp2(0x7c3aed, 0.03); // Lighter purple haze so you can still see walls

  triggerNotification("Panic Hide active: Invisibility engaged (20s)");

  // Emit event to network
  socketClient.emit('panic_hide');
}

// Procedural EMF Loop pings
let emfPingTimer = 0;
function processEMFSensors(delta) {
  if (myTeam !== 'Human' || inventory[activeSlot] !== 'EMF Radar') return;

  // Track closest ghost
  let closestDist = 9999;
  ghosts3D.forEach(g => {
    const dist = camera.position.distanceTo(g.position);
    if (dist < closestDist) closestDist = dist;
  });

  // Check closest human players if playing as ghost, but here we check distance to enemy
  if (closestDist < 50) { // Increased from 25 to 50 so EMF detects ghosts earlier
    // Proximity scaling sound pings frequency
    emfPingTimer += delta;
    
    // Scale ping frequency (close = fast pings, far = slow pings)
    const pingDelay = Math.max(0.1, (closestDist / 50) * 1.5);
    
    if (emfPingTimer >= pingDelay) {
      const normalizedProximity = Math.max(0, 1 - (closestDist / 50)); // 0.0 to 1.0
      playEMFSound(normalizedProximity);
      emfPingTimer = 0;
    }

    // Dynamic HUD blip sweep frequency matching proximity
    const blip = document.getElementById('radar-blip-element');
    if (blip) {
      blip.style.opacity = '1';
      // Scale position randomly close to center relative to proximity
      const angle = Math.random() * Math.PI * 2;
      const offset = (closestDist / 25) * 50; // Max 50px offset
      blip.style.left = `calc(50% + ${Math.cos(angle) * offset}px)`;
      blip.style.top = `calc(50% + ${Math.sin(angle) * offset}px)`;
    }
  }
}

// Proximity micro-vibrations and sanity regression
function processSanity(delta) {
  if (myTeam !== 'Human') return;

  // If near any active ghost, sanity decays!
  let nearGhost = false;
  ghosts3D.forEach(g => {
    if (camera.position.distanceTo(g.position) < 8) nearGhost = true;
  });

  if (nearGhost) {
    currentSanity = Math.max(0, currentSanity - delta * 4); // Fast decay
  } else {
    currentSanity = Math.max(0, currentSanity - delta * 0.2); // Idle slow decay in labyrinth
  }

  // Update HUD
  document.getElementById('sanity-value').textContent = `${Math.floor(currentSanity)}%`;
  document.getElementById('sanity-bar').style.width = `${currentSanity}%`;

  if (currentSanity < 30) {
    // Hallucinations overlay
    document.body.style.filter = `hue-rotate(${Math.sin(performance.now() * 0.01) * 30}deg) contrast(1.2)`;
  } else {
    document.body.style.filter = 'none';
  }
}

function processFlashlightBattery(delta) {
  if (myTeam !== 'Human') return;
  if (!flashLight) return;

  const baseIntensity = inventory.includes('Battery Pack') ? 200 : 80;

  // Drain if battery still has charge (tracked by battery level, not intensity,
  // so a flicker can't permanently kill the light)
  if (flashlightBattery > 0) {
    // ~0.5% per second = 200 second total battery life from 100% to 0%
    flashlightBattery = Math.max(0, flashlightBattery - delta * 0.5);

    // Update battery bar UI
    const flBar = document.getElementById('flashlight-bar');
    const flVal = document.getElementById('flashlight-value');
    if (flBar) flBar.style.width = `${flashlightBattery}%`;
    if (flVal) flVal.textContent = `${Math.ceil(flashlightBattery)}%`;

    if (flashlightBattery <= 0) {
      // Fully dead
      flashLight.intensity = 0;
      triggerNotification("Flashlight battery dead! Find a Battery Pack.");
    } else if (flashlightBattery < 15) {
      // Critical flicker warning (15% → 0%)
      flashLight.intensity = Math.random() < 0.18 ? 0 : baseIntensity * 0.2;
    } else {
      // Normal full intensity
      flashLight.intensity = baseIntensity;
    }
  } else {
    // Dead — keep off, UI stays at 0%
    flashLight.intensity = 0;
    const flBar = document.getElementById('flashlight-bar');
    const flVal = document.getElementById('flashlight-value');
    if (flBar) flBar.style.width = `0%`;
    if (flVal) flVal.textContent = `0%`;
  }
}

function checkWinCondition() {
  const carriedSymbols = carriedKeys.map(k => k.symbol);
  const hasFirstKey = functionalKeysRevealed.length > 0 && carriedSymbols.includes(functionalKeysRevealed[0]);
  const hasSecondKey = functionalKeysRevealed.length > 1 && carriedSymbols.includes(functionalKeysRevealed[1]);
  const breakersFixed = fixedBreakersCount >= totalBreakersRequired;

  // Change gate material when ALL conditions are satisfied for the first time
  if (gateSolved && hasFirstKey && hasSecondKey && breakersFixed) {
    if (gateMeshRef && gateMeshRef.material.emissiveIntensity === 0) {
      showExitGate();
    }

    const distToGate = camera.position.distanceTo(new THREE.Vector3(gateCoordinates.x, camera.position.y, gateCoordinates.z));
    if (distToGate < 6) {
      triggerNotification("master gate breached! escape successful!");
      socketClient.emit('chat_message', { msg: "=== VICTORY: HUMANS HAVE ESCAPED THE LABYRINTH ===" });
      socketClient.emit('human_escaped');
    }
  }
}

// Setup network synchronization
function setupSocketListeners() {
  socketClient.on('player_moved', ({ id, position, rotation, team, characterClass }) => {
    if (!players3D[id]) {
      // Spawn new network player representer (simple capsules)
      const isGhost = team === 'Ghost';
      const capGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.8, 12);
      const capMat = new THREE.MeshStandardMaterial({ 
        color: isGhost ? 0xa855f7 : 0x3b82f6, 
        roughness: 0.2,
        metalness: 0.5
      });
      const capMesh = new THREE.Mesh(capGeo, capMat);
      capMesh.position.set(position.x, 0.9, position.z);
      scene.add(capMesh);
      players3D[id] = capMesh;
    } else {
      // Update pos
      players3D[id].position.set(position.x, 0.9, position.z);
      players3D[id].rotation.y = rotation.y;
    }
  });

  // Cipher successfully solved!
  socketClient.on('cipher_solved', ({ realKeySymbols }) => {
    gateSolved = true;
    functionalKeysRevealed = realKeySymbols;

    triggerNotification(`cipher solved! twin keys revealed: [${realKeySymbols.join(', ')}]`);
    
    const lockLabel = document.getElementById('terminal-lock-label');
    lockLabel.textContent = "Twin Keys Required";
    lockLabel.style.color = "var(--secondary-accent)";
    lockLabel.style.textShadow = "0 0 10px rgba(245, 158, 11, 0.6)";

    const cipherHUD = document.getElementById('hud-cipher-info');
    cipherHUD.textContent = `Keys: ${realKeySymbols.join(' & ')}`;
  });

  // Keypad failure penalty trigger
  socketClient.on('cipher_failed_penalty', ({ cooldownSeconds, revealSeconds }) => {
    triggerAlarmFlashing();
    triggerNotification(`terminal lockout active (${cooldownSeconds}s) | outlines exposed (${revealSeconds}s)`);
  });

  socketClient.on('corridor_realignment', (realignmentState) => {
    realignMazeCorridors(realignmentState);
  });
  
  socketClient.on('sound_beacon', ({ producerId, volume, position }) => {
    latestSoundBeacon = { position, volume, time: performance.now() };

    // If current player is a Ghost, check if they hear this sound
    if (myTeam === 'Ghost') {
      const myPos = new THREE.Vector3(camera.position.x, 0, camera.position.z);
      const soundPos = new THREE.Vector3(position.x, 0, position.z);
      const dist = myPos.distanceTo(soundPos);

      let hearingRadius = 0;
      let soundType = "";
      if (volume <= 1.0) {
        hearingRadius = 10 * 4.5;
        soundType = "Footsteps";
      } else if (volume <= 35) {
        hearingRadius = 20 * 4.5;
        soundType = "Whisper";
      } else {
        hearingRadius = 50 * 4.5;
        soundType = "Scream";
      }

      if (dist <= hearingRadius) {
        triggerSoundPing(position, soundType);
      }
    }
  });

  socketClient.on('human_captured', ({ targetId }) => {
    if (targetId === myId) {
      isCaptured = true;
      document.exitPointerLock();
      window.mobileGameActive = false;
      document.getElementById('hud-overlay').style.display = 'none';
      document.getElementById('captured-overlay').style.display = 'flex';
      socketClient.emit('chat_message', { msg: `[SYSTEM]: Operative ${myId} (${myClass}) was captured by a Ghost.` });
    } else if (players3D[targetId]) {
      scene.remove(players3D[targetId]);
      delete players3D[targetId];
    }
  });

  socketClient.on('ghost_mimic_clone', ({ id }) => {
    if (players3D[id]) {
      // Disguise the ghost as a human for 15 seconds
      const originalMat = players3D[id].material;
      players3D[id].material = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.2, metalness: 0.5 });
      setTimeout(() => {
        if (players3D[id]) players3D[id].material = originalMat;
      }, 15000);
    }
  });

  socketClient.on('ghost_breaker_siphon', () => {
    if (myTeam === 'Human') {
      if (flashLight) flashLight.intensity = 0;
      triggerNotification("Breaker Siphon! Flashlights disabled (15s)");
      setTimeout(() => {
        if (flashlightBattery > 0 && flashLight) {
          if (inventory.includes('Battery Pack')) flashLight.intensity = 200;
          else flashLight.intensity = 80;
        }
      }, 15000);
    }
  });

  socketClient.on('ghost_sound_scramble', () => {
    if (myTeam === 'Human') {
      triggerNotification("Signal scrambled! Sensors offline (10s)");
      document.body.style.filter = "invert(1) hue-rotate(180deg)";
      setTimeout(() => {
        document.body.style.filter = "none";
      }, 10000);
    }
  });

  socketClient.on('human_chalk_spray', ({ id, position }) => {
    deployChalkDecal(position);
  });

  socketClient.on('breaker_remote_triggered', () => {
    freezeGhosts();
  });

  socketClient.on('match_ended', ({ winner, summary }) => {
    // Exit pointer lock
    document.exitPointerLock();
    window.mobileGameActive = false;

    // Show the End Game Overlay
    const overlay = document.getElementById('end-game-overlay');
    const title = document.getElementById('end-game-title');
    const details = document.getElementById('end-game-details');

    if (overlay && title && details) {
      overlay.style.display = 'flex';
      
      if (winner === 'Human') {
        title.textContent = "VICTORY";
        title.style.color = "#10b981";
        title.style.textShadow = "0 0 20px rgba(16, 185, 129, 0.6)";
        details.innerHTML = `<div style="font-weight:bold; color: #10b981; margin-bottom: 1rem; font-size: 1.3rem;">SURVIVORS ESCAPED!</div>`;
      } else {
        title.textContent = "DEFEAT";
        title.style.color = "#ef4444";
        title.style.textShadow = "0 0 20px rgba(239, 68, 68, 0.6)";
        details.innerHTML = `<div style="font-weight:bold; color: #ef4444; margin-bottom: 1rem; font-size: 1.3rem;">ALL SURVIVORS ELIMINATED!</div>`;
      }

      // Add detailed player status list
      let summaryHTML = `<div style="text-align: left; font-size: 0.95rem; line-height: 1.6; max-height: 200px; overflow-y: auto; padding-right: 10px;">`;
      summary.forEach(p => {
        const teamColor = p.team === 'Ghost' ? '#a855f7' : '#3b82f6';
        const statusText = p.team === 'Ghost' ? 'Spectral Threat' : (p.isCaptured ? 'Captured' : 'Escaped');
        const statusColor = p.team === 'Ghost' ? '#a855f7' : (p.isCaptured ? '#ef4444' : '#10b981');
        summaryHTML += `<div style="display:flex; justify-content:space-between; margin-bottom:0.4rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom:0.2rem;">
          <span style="font-weight: bold; color: ${teamColor};">${p.username}</span> 
          <span style="font-weight: bold; color: ${statusColor};">${statusText.toUpperCase()}</span>
        </div>`;
      });
      summaryHTML += `</div>`;
      details.innerHTML += summaryHTML;
    }

    const endLobbyBtn = document.getElementById('end-game-lobby-btn');
    if (endLobbyBtn) {
      endLobbyBtn.onclick = () => {
        if (currentLobby && currentLobby.id && !currentLobby.id.startsWith('solo-')) {
          sessionStorage.setItem('rejoinLobbyId', currentLobby.id);
          sessionStorage.setItem('rejoinUsername', currentLobby.players[myId]?.username || `Operative_${Math.floor(100 + Math.random() * 900)}`);
          sessionStorage.setItem('rejoinIsPublic', currentLobby.isPublic ? 'true' : 'false');
          sessionStorage.setItem('rejoinIsSolo', 'false');
        } else {
          sessionStorage.removeItem('rejoinLobbyId');
          sessionStorage.removeItem('rejoinUsername');
          sessionStorage.removeItem('rejoinIsPublic');
          sessionStorage.removeItem('rejoinIsSolo');
        }
        window.location.reload();
      };
    }
  });

  // Sync dropped items dynamically across all teammates in the lobby
  socketClient.on('item_dropped_sync', ({ name, position }) => {
    const pos = new THREE.Vector3(position.x, position.y, position.z);
    spawnDroppedItemLocal(name, pos);
  });
}

function triggerSoundPing(position, soundType) {
  // Text notification for Ghost player
  triggerNotification(`ALERT: ${soundType.toUpperCase()} DETECTED nearby!`);

  // Create flat ring geometry on floor
  const geom = new THREE.RingGeometry(0.1, 1.5, 32);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff3333,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
    depthWrite: false
  });
  const pingMesh = new THREE.Mesh(geom, mat);
  pingMesh.position.set(position.x, 0.1, position.z);
  scene.add(pingMesh);

  const startTime = performance.now();
  const duration = 2000; // 2 seconds

  function animatePing() {
    const elapsed = performance.now() - startTime;
    const progress = elapsed / duration;

    if (progress >= 1.0) {
      scene.remove(pingMesh);
      geom.dispose();
      mat.dispose();
    } else {
      const scale = 1.0 + progress * 8.0;
      pingMesh.scale.set(scale, 1, scale);
      pingMesh.material.opacity = 0.8 * (1.0 - progress);
      requestAnimationFrame(animatePing);
    }
  }
  animatePing();
}

function freezeGhosts() {
  window.ghostsFrozen = true;
  ghosts3D.forEach(g => {
    g.children.forEach(c => { if (c.isPointLight) c.intensity = 0; });
  });
  triggerNotification("breaker remote used. ghosts frozen (10s).");
  setTimeout(() => {
    window.ghostsFrozen = false;
    ghosts3D.forEach(g => {
      g.children.forEach(c => { if (c.isPointLight) c.intensity = 80; });
    });
    triggerNotification("ghosts reactivated!");
  }, 10000);
}

function triggerAlarmFlashing() {
  const flash = document.getElementById('alarm-flash');
  flash.style.display = 'block';
  
  setTimeout(() => {
    flash.style.display = 'none';
  }, 10000); // Pulse alarm for 10 seconds
}

function triggerNotification(text) {
  const box = document.getElementById('game-notification');
  box.textContent = text.toUpperCase();
  box.style.display = 'block';
  
  setTimeout(() => {
    box.style.display = 'none';
  }, 4000);
}

function spawnGhostAIs(count) {
  ghosts3D.forEach(g => scene.remove(g));
  ghosts3D = [];

  const bodyGeo = new THREE.ConeGeometry(0.7, 2.5, 16);
  const bodyMat = new THREE.MeshStandardMaterial({ 
    color: 0xccccff, emissive: 0x7c3aed, emissiveIntensity: 0.8, 
    roughness: 0.2, side: THREE.DoubleSide 
  });
  const headGeo = new THREE.SphereGeometry(0.5, 16, 16);
  const eyeGeo = new THREE.SphereGeometry(0.12, 8, 8);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide });

  for (let i = 0; i < count; i++) {
    const ghostGroup = new THREE.Group();
    
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.25;
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.y = 2.5;
    
    const eye1 = new THREE.Mesh(eyeGeo, eyeMat);
    eye1.position.set(-0.2, 2.6, 0.4);
    const eye2 = new THREE.Mesh(eyeGeo, eyeMat);
    eye2.position.set(0.2, 2.6, 0.4);
    
    const aura = new THREE.PointLight(0xa855f7, 80, 15);
    aura.position.y = 1.5;

    ghostGroup.add(body, head, eye1, eye2, aura);
    
    // Thermal materials for X-Ray
    const thermalMat = new THREE.MeshBasicMaterial({ 
      color: 0xffffff, fog: false, depthTest: false, side: THREE.DoubleSide 
    });
    ghostGroup.children.forEach(c => {
      if (c.isMesh) {
        c.userData.normalMat = c.material;
        c.userData.thermalMat = thermalMat;
      }
    });

    // Spawn in random open corridor cells away from the player
    let spawnPos = { x: 10, z: 10 };
    const candidates = openCorridors.filter(c => {
      const dx = c.x - camera.position.x;
      const dz = c.z - camera.position.z;
      const d = Math.sqrt(dx*dx + dz*dz);
      return d > 15 && d < 50;
    });
    if (candidates.length > 0) spawnPos = candidates[Math.floor(seededRandom() * candidates.length)];
    ghostGroup.position.set(spawnPos.x, 0, spawnPos.z);

    scene.add(ghostGroup);
    // Assign a randomized ghost class to vary AI behavior
    const AI_GHOST_TYPES = ['Stalker', 'Mimic', 'Juggernaut', 'Phantom', 'Poltergeist', 'Banshee'];
    ghostGroup.userData.ghostClass = AI_GHOST_TYPES[Math.floor(seededRandom() * AI_GHOST_TYPES.length)];
    ghosts3D.push(ghostGroup);
  }
}

// 3D Game Loop rendering
let networkTimer = 0;
function animate() {
  requestAnimationFrame(animate);

  const time = performance.now();
  const delta = (time - prevTime) / 1000;
  prevTime = time;

  const isActive = isMobileDevice ? (window.mobileGameActive && !isCaptured) : (document.pointerLockElement === document.getElementById('canvas-container') && !isCaptured);
  if (isActive) {
    // 1. Process movement physics with friction
    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;

    direction.z = Number(moveForward) - Number(moveBackward);
    direction.x = Number(moveRight) - Number(moveLeft);
    direction.normalize(); // Ensure consistent speed

    // Speed details
    // Human WALK: 90  (~9 u/s after friction) — faster than almost every ghost
    // Juggernaut ghost player: 95 (~9.5 u/s) — the ONE ghost that can outwalk a human
    // All other ghost players: 55 (~5.5 u/s) — clearly slower than a walking human
    let baseGhostSpeed = 55.0;
    if (myTeam === 'Ghost' && myClass === 'Juggernaut') baseGhostSpeed = 95.0;
    let speed = myTeam === 'Ghost' ? baseGhostSpeed : 90.0;

    // --- Sprint logic (humans only) ---
    if (myTeam === 'Human') {
      const moving = moveForward || moveBackward || moveLeft || moveRight;
      if (isSprinting && moving && stamina > 0) {
        speed *= 1.55; // sprint multiplier
        stamina = Math.max(0, stamina - STAMINA_DRAIN_RATE * delta);
        if (stamina <= 0) isSprinting = false;
      } else {
        isSprinting = false;
        stamina = Math.min(100, stamina + STAMINA_REGEN_RATE * delta);
        // Prevent starting sprint if stamina too low
        if (stamina <= SPRINT_MIN_STAMINA) isSprinting = false;
      }
      // Update stamina bar
      const stBar = document.getElementById('stamina-bar');
      const stVal = document.getElementById('stamina-value');
      if (stBar) stBar.style.width = `${stamina}%`;
      if (stVal) stVal.textContent = `${Math.ceil(stamina)}%`;
    }

    if (speedBoostTimer > 0) {
      speedBoostTimer -= delta;
      speed *= 1.5;
    }

    // Salt trap slow down and Flashlight Blinding for human Ghost players
    if (myTeam === 'Ghost') {
      let nearSalt = false;
      for (let i = saltTraps.length - 1; i >= 0; i--) {
        const trap = saltTraps[i];
        const dist = camera.position.distanceTo(trap.position);
        if (dist < 2.5) {
          nearSalt = true;
          if (!trap.userData || !trap.userData.triggered) {
            trap.userData = trap.userData || {};
            trap.userData.triggered = true;
            triggerNotification("Stepped in salt! You are slowed!");
            setTimeout(() => {
              scene.remove(trap);
              const idx = saltTraps.indexOf(trap);
              if (idx > -1) saltTraps.splice(idx, 1);
            }, 3000);
          }
        }
      }
      if (nearSalt) {
        speed *= 0.2; // 80% slow down, matching AI slow down ratio
      }

      // Check if blinded by any human player's flashlight cone
      let blindedByHuman = false;
      Object.keys(players3D).forEach(id => {
        const pMesh = players3D[id];
        const isHuman = pMesh.material.color.getHex() === 0x3b82f6;
        if (isHuman) {
          const dist = camera.position.distanceTo(pMesh.position);
          if (dist < 15) {
            // Reconstruct human forward vector based on network rotation
            const humanForward = new THREE.Vector3(-Math.sin(pMesh.rotation.y), 0, -Math.cos(pMesh.rotation.y)).normalize();
            const dirToGhost = new THREE.Vector3().subVectors(camera.position, pMesh.position).normalize();
            const dot = humanForward.dot(dirToGhost);
            if (dot > 0.88) { // 25 degree cone
              blindedByHuman = true;
            }
          }
        }
      });

      if (blindedByHuman) {
        speed *= 0.5; // 50% slow down when blinded by flashlight
        if (Math.random() < 0.01) { // Throttle warning notification
          triggerNotification("BLINDED BY FLASHLIGHT! Speed reduced.");
        }
      }

      // Breaker Remote freeze for human Ghost players
      if (window.ghostsFrozen) {
        speed = 0;
        velocity.set(0, 0, 0);
      }
    }

    if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
    if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;

    camera.translateX(-velocity.x * delta);
    camera.translateZ(velocity.z * delta);
    camera.position.y = 1.6; // Lock height

    // Simple wall collision checking (2D check)
    walls.forEach(wall => {
      if (wall.position.y < 0) return; // Skip walls shifted below floor level (open sliding gates)
      const dx = camera.position.x - wall.position.x;
      const dz = camera.position.z - wall.position.z;
      const dist2D = Math.sqrt(dx*dx + dz*dz);
      if (dist2D < 2.8) { // Increased to 2.8 to prevent near-clipping the camera through walls
        const pushForce = (2.8 - dist2D) * 1.0; 
        const pushDir = new THREE.Vector2(dx, dz).normalize();
        camera.position.x += pushDir.x * pushForce;
        camera.position.z += pushDir.y * pushForce;
      }
    });

    // 2. Active sensors & sanity ticks
    processEMFSensors(delta);
    processSanity(delta);
    processFlashlightBattery(delta);

    // 3. Process panic timer cooldown & Thermal Camera overrides
    if (isPanicked) {
      panicTimer -= delta;
      if (panicTimer <= 0) {
        isPanicked = false;
        if (inventory[activeSlot] !== "Thermal Camera") {
          camera.fog = new THREE.FogExp2(myTeam === 'Human' ? 0x030712 : 0x1e1b4b, 0.05);
        }
        if (flashLight) flashLight.intensity = 200;
        triggerNotification("invisibility ended. sensors active.");
      }
    } 
    
    // Process Thermal Camera regardless of panic
    if (myTeam === 'Human') {
      // Thermal Camera passive effect
      if (inventory[activeSlot] === "Thermal Camera") {
        scene.fog = new THREE.FogExp2(0x330000, 0.02); // Red thermal vision

        // Make ghosts bright and glowing
        ghosts3D.forEach(g => {
          g.children.forEach(c => {
            if (c.isMesh && c.material !== c.userData.thermalMat) {
              c.material = c.userData.thermalMat;
              c.renderOrder = 999;
            }
          });
        });
      } else {
        scene.fog = new THREE.FogExp2(0x030712, 0.05); // Normal dark

        // Disable X-Ray vision
        ghosts3D.forEach(g => {
          g.children.forEach(c => {
            if (c.isMesh && c.material !== c.userData.normalMat) {
              c.material = c.userData.normalMat;
              c.renderOrder = 0;
            }
          });
        });
      }
    }

    // 4. Update AI Bots pathing behaviors toward nearest human
    ghosts3D.forEach((ghost, idx) => {
      // Breaker Remote freezes all ghost movement
      if (window.ghostsFrozen) return;

      // Damage check uses actual distance to PLAYER
      const distToPlayer = ghost.position.distanceTo(new THREE.Vector3(camera.position.x, ghost.position.y, camera.position.z));

      if (distToPlayer < 1.5 && myTeam === 'Human' && !isPanicked) {
        currentHP = Math.max(0, currentHP - delta * 45);
        document.getElementById('hp-value').textContent = `${Math.ceil(currentHP)} HP`;
        document.getElementById('hp-bar').style.width = `${currentHP}%`;
        
        if (currentHP <= 0 && !isCaptured) {
          isCaptured = true;
          document.exitPointerLock();
          window.mobileGameActive = false;
          document.getElementById('hud-overlay').style.display = 'none';
          document.getElementById('captured-overlay').style.display = 'flex';
          socketClient.emit('chat_message', { msg: `[SYSTEM]: Operative ${myId} (${myClass}) has been captured by the void.` });
          socketClient.emit('capture_human', { targetId: myId });
        }
      }

      // Check salt traps (triggering & consumption)
      // Juggernaut (10 u/s) is the ONLY AI ghost faster than a walking human (~9 u/s).
      // All other AI ghosts (4 u/s) are clearly slower — humans can walk away from them.
      let moveSpeed = (ghost.userData.ghostClass === 'Juggernaut') ? 10.0 : 4.0;
      for (let i = saltTraps.length - 1; i >= 0; i--) {
        const trap = saltTraps[i];
        if (ghost.position.distanceTo(trap.position) < 2.5) {
          moveSpeed = 1.0;
          if (!trap.userData || !trap.userData.triggered) {
            trap.userData = trap.userData || {};
            trap.userData.triggered = true;
            if (myTeam === 'Human') {
              triggerNotification("Salt barrier disturbed by a ghost!");
            }
            setTimeout(() => {
              scene.remove(trap);
              const idx = saltTraps.indexOf(trap);
              if (idx > -1) saltTraps.splice(idx, 1);
            }, 3000);
          }
        }
      }

      // Check if blinded by player's flashlight
      let isBlinded = false;
      if (myTeam === 'Human' && flashLight && flashLight.intensity > 50) {
        const dist = camera.position.distanceTo(ghost.position);
        if (dist < 15) {
          const dirToGhost = new THREE.Vector3().subVectors(ghost.position, camera.position).normalize();
          const forward = new THREE.Vector3();
          camera.getWorldDirection(forward);
          const dot = forward.dot(dirToGhost);
          if (dot > 0.88) { // 25 degree cone
            isBlinded = true;
          }
        }
      }

      if (isBlinded) {
        moveSpeed *= 0.5; // 50% slow down when blinded by flashlight
      }

      // AI State Machine Initialization
      if (!ghost.userData.aiState) {
        ghost.userData.aiState = 'WANDER';
        ghost.userData.targetGrid = null;
        ghost.userData.loseSightTimer = 0;
        ghost.userData.lastSoundTime = 0;
      }

      // Check Line of Sight (LOS)
      let canSeePlayer = false;
      if (distToPlayer < 13.5 && myTeam === 'Human' && !isPanicked) { // 3 blocks max sight range
        const directionToPlayer = new THREE.Vector3().subVectors(camera.position, ghost.position).normalize();
        const raycaster = new THREE.Raycaster(ghost.position, directionToPlayer, 0, 15);
        const intersects = raycaster.intersectObjects(walls);
        if (intersects.length === 0 || intersects[0].distance > distToPlayer) {
          canSeePlayer = true;
        }
      }

      // State Transitions
      if (canSeePlayer) {
        ghost.userData.aiState = 'CHASE';
        ghost.userData.loseSightTimer = 0;
      } else if (ghost.userData.aiState === 'CHASE') {
        ghost.userData.loseSightTimer += delta;
        if (ghost.userData.loseSightTimer > 3.0) {
          ghost.userData.aiState = 'WANDER'; // Lost player
          ghost.userData.targetGrid = null;
        }
      }

      // Check Sound Beacons
      if (latestSoundBeacon && latestSoundBeacon.time > ghost.userData.lastSoundTime && ghost.userData.aiState !== 'CHASE') {
        const distToSound = ghost.position.distanceTo(new THREE.Vector3(latestSoundBeacon.position.x, ghost.position.y, latestSoundBeacon.position.z));
        let hearingRadius = 0;
        if (latestSoundBeacon.volume <= 1.0) hearingRadius = 10 * mazeBlockSize; // Footsteps
        else if (latestSoundBeacon.volume <= 35) hearingRadius = 20 * mazeBlockSize; // Whisper
        else hearingRadius = 50 * mazeBlockSize; // Scream

        if (distToSound <= hearingRadius) {
          ghost.userData.aiState = 'INVESTIGATE';
          ghost.userData.targetGrid = worldToGrid(latestSoundBeacon.position.x, latestSoundBeacon.position.z);
          ghost.userData.pathTime = 0; // Force immediate repath
        }
        ghost.userData.lastSoundTime = latestSoundBeacon.time;
      }

      // BFS Pathfinding — recalculate path every 2 seconds or when target changes
      if (!ghost.userData.path || !ghost.userData.pathTime || time - ghost.userData.pathTime > 2000) {
        ghost.userData.pathTime = time;
        const ghostGrid = worldToGrid(ghost.position.x, ghost.position.z);
        
        let destGrid;
        if (ghost.userData.aiState === 'CHASE') {
          destGrid = worldToGrid(camera.position.x, camera.position.z);
          ghost.userData.targetGrid = destGrid;
        } else if (ghost.userData.aiState === 'INVESTIGATE') {
          destGrid = ghost.userData.targetGrid;
          if (!destGrid) destGrid = ghostGrid;
          if (ghostGrid.col === destGrid.col && ghostGrid.row === destGrid.row) {
             ghost.userData.aiState = 'WANDER';
             ghost.userData.targetGrid = null;
          }
        } 

        if (ghost.userData.aiState === 'WANDER') {
          if (!ghost.userData.targetGrid || (ghostGrid.col === ghost.userData.targetGrid.col && ghostGrid.row === ghost.userData.targetGrid.row)) {
            let rx, rz, attempts = 0;
            ghost.userData.wanderCount = (ghost.userData.wanderCount || 0) + 1;
            const baseSeed = (currentLobby && currentLobby.puzzleState && currentLobby.puzzleState.mazeGeometrySeed) || 0.12345;
            const seedInt = Math.floor(baseSeed * 2147483647);
            const tempRand = mulberry32(seedInt + idx * 1000 + ghost.userData.wanderCount * 17);
            do {
              rx = Math.floor(tempRand() * mazeSizeGlobal);
              rz = Math.floor(tempRand() * mazeSizeGlobal);
              attempts++;
            } while (mazeLayout[rz] && mazeLayout[rz][rx] !== 0 && attempts < 50);
            ghost.userData.targetGrid = { col: rx, row: rz };
          }
          destGrid = ghost.userData.targetGrid;
        }
        
        if (destGrid) {
          ghost.userData.path = bfsPath(ghostGrid.col, ghostGrid.row, destGrid.col, destGrid.row);
          ghost.userData.pathIdx = 1; // Skip first waypoint
        }
      }

      // Follow the path waypoints
      const path = ghost.userData.path;
      const pathIdx = ghost.userData.pathIdx || 1;

      if (path && path.length > 0 && pathIdx < path.length) {
        const waypoint = path[pathIdx];
        const dx = waypoint.x - ghost.position.x;
        const dz = waypoint.z - ghost.position.z;
        const distToWaypoint = Math.sqrt(dx*dx + dz*dz);

        if (distToWaypoint < 1.5) {
          ghost.userData.pathIdx = pathIdx + 1; // Advance waypoint
        } else if (distToPlayer > 0.5 || ghost.userData.aiState !== 'CHASE') {
          // Move toward current waypoint
          const dir = new THREE.Vector3(dx, 0, dz).normalize();
          ghost.position.addScaledVector(dir, delta * moveSpeed);
        }
      } else if (ghost.userData.aiState === 'CHASE' && distToPlayer > 0.5) {
        // Fallback: Chase direct line of sight
        const dir = new THREE.Vector3(camera.position.x - ghost.position.x, 0, camera.position.z - ghost.position.z).normalize();
        ghost.position.addScaledVector(dir, delta * moveSpeed);
      }
      
      // Face the player if chasing, otherwise face movement direction
      if (ghost.userData.aiState === 'CHASE') {
        ghost.lookAt(camera.position.x, ghost.position.y, camera.position.z);
      } else if (path && path.length > 0 && pathIdx < path.length) {
        ghost.lookAt(path[pathIdx].x, ghost.position.y, path[pathIdx].z);
      }

      // Wall collision — push ghost out if clipping
      walls.forEach(wall => {
        if (wall.position.y < 0) return; // Skip walls shifted below floor level (open sliding gates)
        const dx = ghost.position.x - wall.position.x;
        const dz = ghost.position.z - wall.position.z;
        const dist2D = Math.sqrt(dx*dx + dz*dz);
        if (dist2D < 2.5) {
          const pushForce = (2.5 - dist2D);
          const pushDir = new THREE.Vector2(dx, dz).normalize();
          ghost.position.x += pushDir.x * pushForce;
          ghost.position.z += pushDir.y * pushForce;
        }
      });
    });



    // 5. Emit movement states
    networkTimer += delta;
    if (networkTimer >= 0.05) { // 20Hz update
      socketClient.emit('player_movement', {
        position: { x: camera.position.x, z: camera.position.z },
        rotation: { y: camera.rotation.y },
        team: myTeam,
        characterClass: myClass
      });

      // Emit walking sound frequency (only for Humans)
      if (myTeam === 'Human' && (Math.abs(velocity.x) > 1 || Math.abs(velocity.z) > 1)) {
        socketClient.emit('sound_produced', {
          volume: 0.5,
          position: { x: camera.position.x, z: camera.position.z }
        });
        latestSoundBeacon = { position: { x: camera.position.x, z: camera.position.z }, volume: 0.5, time: performance.now() };
      }
      networkTimer = 0;
    }

    // Process Microphone volume (only for Humans)
    if (myTeam === 'Human' && audioAnalyser && !isCaptured) {
      audioAnalyser.getByteFrequencyData(audioDataArray);
      let sum = 0;
      for(let i=0; i<audioDataArray.length; i++) sum += audioDataArray[i];
      const avgVolume = sum / audioDataArray.length;
      
      if (avgVolume > 20) { // Threshold for talking/yelling
        socketClient.emit('sound_produced', {
          volume: avgVolume,
          position: { x: camera.position.x, z: camera.position.z }
        });
        // Immediately alert local ghost AI
        latestSoundBeacon = { position: { x: camera.position.x, z: camera.position.z }, volume: avgVolume, time: performance.now() };
      }
    }

    // Update on-screen interaction cues
    updateInteractionPrompt();

    // Check key win triggers
    checkWinCondition();
  } else {
    const promptEl = document.getElementById('interaction-prompt');
    if (promptEl) promptEl.style.display = 'none';
  }

  // Handle ghost initial spawning — only after splash screen and pointer lock / active game
  const readyToSpawn = isMobileDevice ? (window.gameReady && window.mobileGameActive) : (window.gameReady && document.pointerLockElement === document.getElementById('canvas-container'));
  if (ghosts3D.length === 0 && currentLobby && currentLobby.settings.ghostsCount > 0 && readyToSpawn) {
    spawnGhostAIs(currentLobby.settings.ghostsCount);
  }

  renderer.render(scene, camera);
}
