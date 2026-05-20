import * as THREE from 'three';

let scene, camera, renderer;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let prevTime = performance.now();
const isMobileDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia("(max-width: 768px)").matches;
if (isMobileDevice) {
  document.body.classList.add('is-mobile');
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
let flashLight = null;
let flashlightBattery = 100;

// Puzzle configuration
let gateCoordinates = { x: 0, z: -35 };
let gateSolved = false;
let codeEntered = "";
let functionalKeysRevealed = [];
let foundKeysList = [];

// Audio variables for EMF & static
let audioCtx = null;
let emfOscillator = null;
let micStream = null;
let audioAnalyser = null;
let audioDataArray = null;

let speedBoostTimer = 0;
let latestSoundBeacon = null;

export function initGame(socket, socketId, matchConfig) {
  socketClient = socket;
  myId = socketId;
  currentLobby = matchConfig;

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
  const ambient = new THREE.AmbientLight(0x222233, 1.5); // Slightly dark, not pitch black
  scene.add(ambient);

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

  // Create Labyrinth
  generateMaze(matchConfig.puzzleState.keysCount);

  // Keyboard controls
  setupControls();

  // Socket listener in-game
  setupSocketListeners();
  
  // Setup Microphone for audio mechanics
  setupMicrophone();

  // Window Resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Start loop
  animate();
}

function setupInventory() {
  const humanClasses = {
    Locksmith: ["EMF Radar", "Thermal Camera", "Breaker Remote", "Battery Pack"],
    Trapper: ["Salt Cannister", "Chalk / UV Spray", "Battery Pack", "Adrenaline Shot"],
    Scout: ["EMF Radar", "Sanity Pills", "Battery Pack", "Adrenaline Shot"],
    Medic: ["EMF Radar", "Sanity Pills", "Adrenaline Shot", "Battery Pack"],
    "Flashlight Expert": ["EMF Radar", "Thermal Camera", "Battery Pack", "Battery Pack"],
    Quartermaster: ["EMF Radar", "Salt Cannister", "Chalk / UV Spray", "Adrenaline Shot", "Sanity Pills", "Battery Pack", "Battery Pack", "Battery Pack"]
  };

  const ghostClasses = {
    Stalker: ["Ghost Claws", "Scent Tracker"],
    Mimic: ["Ghost Claws", "Infiltration Clone"],
    Juggernaut: ["Ghost Claws", "Audio Amplifiers"],
    Phantom: ["Ghost Claws", "Vapor Leap"],
    Poltergeist: ["Ghost Claws", "Breaker Siphon"],
    Banshee: ["Ghost Claws", "Sound Scrambler"]
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
    dirs.sort(() => Math.random() - 0.5);
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
    const rx = 1 + Math.floor(Math.random() * (mazeSize-2));
    const rz = 1 + Math.floor(Math.random() * (mazeSize-2));
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
      ctx.fillStyle = Math.random() > 0.7 ? '#450a0a' : '#020617';
      ctx.beginPath();
      ctx.arc(Math.random()*512, Math.random()*512, Math.random()*15, 0, Math.PI*2);
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

  // Draw the Master Gate
  gateCoordinates = { x: 0, z: - (mazeSize/2 * blockSize) + 4 };
  const gateGeo = new THREE.BoxGeometry(10, 4, 1);
  const gateMat = new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.8, roughness: 0.2 });
  const gateMesh = new THREE.Mesh(gateGeo, gateMat);
  gateMesh.position.set(gateCoordinates.x, 2, gateCoordinates.z);
  scene.add(gateMesh);
  walls.push(gateMesh);

  // Spawn key collectibles in chests/lockers represented by boxes
  generateCollectibles(keysCount);
  generateCircuitBreakers();
}

function generateCollectibles(keysCount) {
  // Clear any existing keys
  keysInMaze.forEach(k => scene.remove(k));
  keysInMaze = [];

  const keyGeo = new THREE.SphereGeometry(0.3, 8, 8);
  const keyMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.5 });

  for (let i = 0; i < keysCount; i++) {
    // Pick a random open corridor spot for the key
    let x = 0;
    let z = 0;
    if (openCorridors.length > 0) {
      const randIdx = Math.floor(Math.random() * openCorridors.length);
      x = openCorridors[randIdx].x;
      z = openCorridors[randIdx].z;
    } else {
      // Fallback if openCorridors is empty for some reason
      const angle = (i / keysCount) * Math.PI * 2;
      const radius = 15 + Math.random() * 20;
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
    }

    const key = new THREE.Mesh(keyGeo, keyMat);
    key.position.set(x, 0.4, z);
    scene.add(key);

    keysInMaze.push({
      mesh: key,
      symbol: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'][i % 10],
      index: i
    });
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
      const randIdx = Math.floor(Math.random() * openCorridors.length);
      x = openCorridors[randIdx].x;
      z = openCorridors[randIdx].z;
    } else {
      x = (Math.random() - 0.5) * 40;
      z = (Math.random() - 0.5) * 40;
    }
    
    mesh.position.set(x, 1.0, z);
    scene.add(mesh);
    
    circuitBreakers.push({
      mesh: mesh,
      isFixed: false
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
      case 'Space':
        // Risk/Reward Ability: Panic Hide
        triggerPanicHide();
        break;
      case 'Digit1': activeSlot = 0; renderHUDInventory(); break;
      case 'Digit2': activeSlot = 1; renderHUDInventory(); break;
      case 'Digit3': activeSlot = 2; renderHUDInventory(); break;
      case 'Digit4': activeSlot = 3; renderHUDInventory(); break;
      case 'Digit5': if (inventory.length > 4) { activeSlot = 4; renderHUDInventory(); } break;
      case 'Digit6': if (inventory.length > 5) { activeSlot = 5; renderHUDInventory(); } break;
      case 'Digit7': if (inventory.length > 6) { activeSlot = 6; renderHUDInventory(); } break;
      case 'Digit8': if (inventory.length > 7) { activeSlot = 7; renderHUDInventory(); } break;
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
  if (isMobileDevice) {
    let lookTouchId = null;
    let lastLookX = 0;
    let lastLookY = 0;

    // Listen on document to bypass pointer-events touch bugs in mobile viewports
    document.addEventListener('touchstart', (e) => {
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
      if (joystickTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === joystickTouchId) {
          resetJoystick();
        }
      }
    });

    window.addEventListener('touchcancel', (e) => {
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
      e.preventDefault();
      e.stopPropagation();
      if (!isCaptured && window.gameReady) useActiveItem();
    };
    useBtn.addEventListener('touchstart', handleUse, { passive: false });
    useBtn.addEventListener('click', handleUse);

    const handleInteract = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isCaptured && window.gameReady) checkInteractions();
    };
    interactBtn.addEventListener('touchstart', handleInteract, { passive: false });
    interactBtn.addEventListener('click', handleInteract);

    const handleSpecial = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isCaptured && window.gameReady) triggerPanicHide();
    };
    specialBtn.addEventListener('touchstart', handleSpecial, { passive: false });
    specialBtn.addEventListener('click', handleSpecial);

    const handlePause = (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.mobileGameActive = false;
      ptrOverlay.style.display = 'flex';
    };
    pauseBtn.addEventListener('touchstart', handlePause, { passive: false });
    pauseBtn.addEventListener('click', handlePause);
  }
}

function checkInteractions() {
  // 1. Check proximity to Keypad Terminal (Master Gate)
  const distToGate = camera.position.distanceTo(new THREE.Vector3(gateCoordinates.x, camera.position.y, gateCoordinates.z));
  if (distToGate < 6) {
    if (!gateSolved) {
      openKeypadModal();
    } else {
      const hasFirstKey = foundKeysList.includes(functionalKeysRevealed[0]);
      const hasSecondKey = foundKeysList.includes(functionalKeysRevealed[1]);
      const breakersFixed = fixedBreakersCount >= totalBreakersRequired;
      
      if (!hasFirstKey || !hasSecondKey) {
        triggerNotification(`need twin keys to open gate! (${foundKeysList.length}/2 found)`);
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
      // Picked up!
      scene.remove(key.mesh);
      foundKeysList.push(key.symbol);
      triggerNotification(`Retrieved key [${key.symbol}]`);
      
      const keyHud = document.getElementById('keys-hud-info');
      if (keyHud) {
        keyHud.textContent = `KEYS: ${foundKeysList.length} / 2 RETRIEVED`;
      }

      // Check if we retrieved the exact matching real keys
      checkWinCondition();

      // Emit event
      socketClient.emit('solve_puzzle_room'); // Triggers alignment shift too
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
      triggerNotification(`circuit breaker repaired! (${fixedBreakersCount}/${totalBreakersRequired})`);
      
      checkWinCondition();
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

// Keypad dialog helpers
const keypadUI = document.getElementById('keypad-modal-ui');
const keypadScreen = document.getElementById('keypad-screen-display');
const keypadBtns = document.querySelectorAll('.keypad-grid .keypad-btn');
const keypadClearBtn = document.getElementById('keypad-clear');
const keypadSubmitBtn = document.getElementById('keypad-submit');
const keypadCloseBtn = document.getElementById('keypad-close');

function openKeypadModal() {
  if (gateSolved) {
    triggerNotification("Master Gate protocol already bypassed.");
    return;
  }
  
  keypadUI.style.display = 'flex';
  document.exitPointerLock();
  codeEntered = "";
  keypadScreen.textContent = "----";
}

keypadCloseBtn.addEventListener('click', () => {
  keypadUI.style.display = 'none';
});

keypadClearBtn.addEventListener('click', () => {
  codeEntered = "";
  keypadScreen.textContent = "----";
});

keypadBtns.forEach(btn => {
  btn.addEventListener('click', (e) => {
    const val = e.target.textContent;
    if (val === 'CLR' || val === 'ENT') return;
    if (codeEntered.length < 4) {
      codeEntered += val;
      keypadScreen.textContent = codeEntered.padEnd(4, '-');
    }
  });
});

keypadSubmitBtn.addEventListener('click', () => {
  if (codeEntered.length === 4) {
    socketClient.emit('try_cipher', codeEntered);
    keypadUI.style.display = 'none';
  } else {
    alert("Must enter a 4-digit code combination.");
  }
});

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

  // Drains battery if flashlight has intensity > 0
  if (flashLight.intensity > 0) {
    // 1% per second = 100 seconds total battery life
    flashlightBattery = Math.max(0, flashlightBattery - delta * 1.0);
    
    // Update battery bar UI
    const flBar = document.getElementById('flashlight-bar');
    const flVal = document.getElementById('flashlight-value');
    if (flBar) flBar.style.width = `${flashlightBattery}%`;
    if (flVal) flVal.textContent = `${Math.ceil(flashlightBattery)}%`;

    const baseIntensity = inventory.includes('Battery Pack') ? 200 : 80;

    // If battery is empty, turn off the light
    if (flashlightBattery <= 0) {
      flashLight.intensity = 0;
      triggerNotification("Flashlight battery dead!");
    } else if (flashlightBattery < 20) {
      // Flicker the flashlight when low battery (< 20%)
      if (Math.random() < 0.15) {
        flashLight.intensity = 0; // Temporary flicker off
      } else {
        flashLight.intensity = baseIntensity * 0.3; // Low light level
      }
    } else {
      // Normal intensity
      flashLight.intensity = baseIntensity;
    }
  }
}

function checkWinCondition() {
  if (!gateSolved) return;
  
  // Humans win if they retrieve the 2 functional keys, fix circuit breakers, and reach the Gate
  const hasFirstKey = foundKeysList.includes(functionalKeysRevealed[0]);
  const hasSecondKey = foundKeysList.includes(functionalKeysRevealed[1]);
  const breakersFixed = fixedBreakersCount >= totalBreakersRequired;

  if (hasFirstKey && hasSecondKey && breakersFixed) {
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
    if (candidates.length > 0) spawnPos = candidates[Math.floor(Math.random() * candidates.length)];
    ghostGroup.position.set(spawnPos.x, 0, spawnPos.z);

    scene.add(ghostGroup);
    // Assign a randomized ghost class to vary AI behavior
    const AI_GHOST_TYPES = ['Stalker', 'Mimic', 'Juggernaut', 'Phantom', 'Poltergeist', 'Banshee'];
    ghostGroup.userData.ghostClass = AI_GHOST_TYPES[Math.floor(Math.random() * AI_GHOST_TYPES.length)];
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
    // Human walk: 68 | Juggernaut ghost: 76 (only ghost faster than human)
    // All other ghosts: 55 (slower than human walk)
    let baseGhostSpeed = 55.0;
    if (myTeam === 'Ghost' && myClass === 'Juggernaut') baseGhostSpeed = 76.0;
    let speed = myTeam === 'Ghost' ? baseGhostSpeed : 68.0;

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
      // Juggernaut is the only ghost type faster than humans; others are slower
      let moveSpeed = (ghost.userData.ghostClass === 'Juggernaut') ? 9.5 : 5.5;
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
            do {
              rx = Math.floor(Math.random() * mazeSizeGlobal);
              rz = Math.floor(Math.random() * mazeSizeGlobal);
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

    // Check key win triggers
    checkWinCondition();
  }

  // Handle ghost initial spawning — only after splash screen and pointer lock / active game
  const readyToSpawn = isMobileDevice ? (window.gameReady && window.mobileGameActive) : (window.gameReady && document.pointerLockElement === document.getElementById('canvas-container'));
  if (ghosts3D.length === 0 && currentLobby && currentLobby.settings.ghostsCount > 0 && readyToSpawn) {
    spawnGhostAIs(currentLobby.settings.ghostsCount);
  }

  renderer.render(scene, camera);
}
