import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

let preloadedGhostModel = null;
let preloadedHumanModel = null;
const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
gltfLoader.setDRACOLoader(dracoLoader);

gltfLoader.load('/assets/human_model.glb', (gltf) => {
  preloadedHumanModel = gltf.scene;
  preloadedHumanModel.scale.set(1.5, 1.5, 1.5);
  
  const box = new THREE.Box3().setFromObject(preloadedHumanModel);
  const center = box.getCenter(new THREE.Vector3());
  
  preloadedHumanModel.position.x = -center.x;
  preloadedHumanModel.position.z = -center.z;
  preloadedHumanModel.position.y = -box.min.y; 
  
  preloadedHumanModel.traverse((child) => {
    if (child.isMesh) {
      if (child.material) {
        child.material.transparent = true;
        child.material.opacity = 1.0;
        child.material.depthWrite = true;
      }
      child.castShadow = true;
    }
  });
});
gltfLoader.load('/assets/ghost_model.glb', (gltf) => {
  preloadedGhostModel = gltf.scene;
  // Meshy AI scale adjustments - reduced scale based on feedback
  preloadedGhostModel.scale.set(2.0, 2.0, 2.0);
  
  // Center the model's pivot point so it rotates in place instead of sweeping
  const box = new THREE.Box3().setFromObject(preloadedGhostModel);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  
  // Offset the children so the pivot is at the exact center bottom
  preloadedGhostModel.position.x = -center.x;
  preloadedGhostModel.position.z = -center.z;
  preloadedGhostModel.position.y = -box.min.y + 0.2; // Hover slightly above ground
  
  preloadedGhostModel.traverse((child) => {
    if (child.isMesh) {
      // Ensure the AI textures render brightly and correctly
      if (child.material) {
        child.material.transparent = true;
        child.material.opacity = 0.95;
      }
    }
  });

  // Retroactively replace any fallback sprites that spawned while we were loading
  const replaceSpriteWithModel = (group) => {
    const spriteChild = group.children.find(c => c.isSprite);
    if (spriteChild) {
      group.remove(spriteChild);
      
      // Wrap the centered model in an anchor group so the centering isn't lost during rotation
      const clone = SkeletonUtils.clone(preloadedGhostModel);
      const anchorGroup = new THREE.Group();
      anchorGroup.add(clone);
      
      group.add(anchorGroup);
      
      // Re-apply thermal materials
      const thermalMat = new THREE.MeshBasicMaterial({ 
        color: 0xffffff, fog: false, depthTest: false, side: THREE.DoubleSide 
      });
      group.traverse(c => {
        if (c.isMesh) {
          c.userData.normalMat = c.material;
          c.userData.thermalMat = thermalMat;
        }
      });
    }
  };

  if (typeof ghosts3D !== 'undefined') ghosts3D.forEach(replaceSpriteWithModel);
  if (typeof players3D !== 'undefined') {
    Object.values(players3D).forEach(p => {
      if (p.userData && p.userData.type === 'Ghost') replaceSpriteWithModel(p);
    });
  }

  console.log("Ghost 3D model loaded successfully!");
}, undefined, (error) => {
  console.error("Failed to load ghost model:", error);
});

let scene, camera, renderer;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let prevTime = performance.now();
const defaultMobileDetect = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
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
      if (document.pointerLockElement) document.exitPointerLock();
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
const abilityCooldowns = {};
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
let ghostPathMeshes = [];
let chalkDecals = [];

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
let spectatorSunLight = null;
let spectatorHemiLight = null;
let spectatorCamLight = null;
let flashlightBattery = 100;

// Puzzle configuration
let gateCoordinates = { x: 0, z: -35 };
let gateMeshRef = null;  // Global ref so we can toggle visibility
let padMeshRef = null;   // Global ref for the keypad
let gateSolved = false;
let hasEscaped = false;
let codeEntered = "";
let functionalKeysRevealed = [];
let foundKeysList = [];
let carriedKeys = [];      // Keys currently carried (max 3)
const MAX_CARRIED_KEYS = 3;
let insertedGateKeys = []; // Keys installed into the Master Gate
let codeClueNotes = []; // Clue objects in the maze

// Audio variables for EMF & static
let audioCtx = null;
let emfOscillator = null;
let micStream = null;
let audioAnalyser = null;
let audioDataArray = null;

// Minimap variables
let visitedCells = new Set();
let mapMarks = [];
let isMinimapExpanded = false;

let seededRandom = Math.random;
// --- Map Generator ---
function mulberry32(a) {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

// --- Player Camera Views ---
let viewModes = ['fps', 'tps_shoulder', 'tps_far', 'top_down'];
let currentViewIndex = 0;
let activeViewCamera = null;
let localPlayerVisual = null;

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
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
  currentViewIndex = 0;
  activeViewCamera = null;
  if (localPlayerVisual) {
    camera.remove(localPlayerVisual);
    localPlayerVisual = null;
  }

  // Remove any stale player meshes from scene
  if (typeof players3D !== 'undefined') {
    Object.keys(players3D).forEach(id => {
      if (players3D[id]) {
        scene.remove(players3D[id]);
        players3D[id].traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
        });
      }
    });
    players3D = {};
  }
  
  currentHP = 100;
  currentSanity = 100;
  isPanicked = false;
  isCaptured = false;
  window.isSpectating = false;
  hasEscaped = false;
  panicTimer = 0;
  speedBoostTimer = 0;
  latestSoundBeacon = null;
  gateSolved = false;
  codeEntered = "";
  functionalKeysRevealed = [];
  foundKeysList = [];
  carriedKeys = [];
  insertedGateKeys = (matchConfig.puzzleState && matchConfig.puzzleState.insertedKeys) ? [...matchConfig.puzzleState.insertedKeys] : [];
  codeClueNotes = [];
  inventory = [];
  activeSlot = 0;
  visitedCells.clear();
  mapMarks = [];
  isMinimapExpanded = false;

  const spectateBtn = document.getElementById('spectate-btn');
  if (spectateBtn) {
    spectateBtn.onclick = () => {
      document.getElementById('captured-overlay').style.display = 'none';
      window.isSpectating = true;
      camera.position.y = Math.max(camera.position.y, 6.0);
      updateEnvironmentLighting();
      if (isMobileDevice) {
        window.mobileGameActive = true;
        const mobileCtrl = document.getElementById('mobile-controls-container');
        if (mobileCtrl) mobileCtrl.style.display = 'flex';
      } else {
        (renderer && renderer.domElement || document.getElementById('canvas-container')).requestPointerLock();
      }
      triggerNotification("SPECTATOR MODE ENGAGED: Full Brightness & 0 Fog.");
    };
  }

  setupMinimap();

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

  const handleEnterGame = () => {
    if (typeof keypadUI !== 'undefined' && keypadUI && keypadUI.style.display !== 'none') return;
    if (isMinimapExpanded) return;
    window.mobileGameActive = true;
    ptrOverlay.style.display = 'none';
    if (!isMobileDevice) {
      // Lock on the canvas element (renderer.domElement) — browsers require pointer lock on canvas, not a div
      const lockTarget = (renderer && renderer.domElement) || container;
      if (lockTarget && lockTarget.requestPointerLock) {
        lockTarget.requestPointerLock();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  };

  container.addEventListener('click', handleEnterGame);
  const resumeBtn = document.getElementById('resume-click-target');
  if (resumeBtn) {
    resumeBtn.addEventListener('click', handleEnterGame);
    resumeBtn.addEventListener('touchstart', handleEnterGame, { passive: false });
  }

  document.addEventListener('pointerlockchange', () => {
    if (isMobileDevice) return;
    if (document.pointerLockElement) {
      ptrOverlay.style.display = 'none';
    } else {
      // Don't show pause overlay if the keypad modal or minimap is open
      if ((typeof keypadUI !== 'undefined' && keypadUI && keypadUI.style.display !== 'none') || isMinimapExpanded) {
        ptrOverlay.style.display = 'none';
      } else {
        ptrOverlay.style.display = 'flex';
      }
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
  scene.background = new THREE.Color(0x000000); // Pure black to eliminate any gap visibility
  scene.fog = new THREE.FogExp2(0x000000, 0.015);

  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  
  camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
  camera.rotation.order = 'YXZ'; // Fixes the weird rolling/tilted camera issues!
  camera.position.set(0, 1.6, 0); // Eye level

  // EXPOSE FOR DEBUGGING
  window.scene = scene;
  window.camera = camera;

  // 3. Renderer setup
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
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

  // Set spawn positions
  if (myTeam === 'Ghost') {
    // Pick a random open corridor far from the center (where humans spawn)
    const farCorridors = openCorridors.filter(c => Math.abs(c.x) > 20 || Math.abs(c.z) > 20);
    if (farCorridors.length > 0) {
      const spawnIdx = Math.floor(Math.random() * farCorridors.length);
      const spawnNode = farCorridors[spawnIdx];
      camera.position.set(spawnNode.x, 1.6, spawnNode.z);
    } else {
      camera.position.set(20, 1.6, 20);
    }
  } else {
    // Humans spawn grouped together at the center
    camera.position.set(0, 1.6, 0);
  }

  // Easter Egg: Ariadne's Thread to the Vault (Straight direct beacon beam to the vault for Ariadne_999)
  const myPlayer = currentLobby.players[myId];
  if (myPlayer && myPlayer.username === 'Ariadne_999') {
    const startX = camera.position.x;
    const startZ = camera.position.z;
    const targetX = gateCoordinates.x;
    const targetZ = gateCoordinates.z;
    const dx = targetX - startX;
    const dz = targetZ - startZ;
    const totalDist = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dx, dz);

    const threadGeo = new THREE.PlaneGeometry(0.5, totalDist);
    const threadMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, side: THREE.DoubleSide, transparent: true, opacity: 0.75 });
    const thread = new THREE.Mesh(threadGeo, threadMat);
    thread.rotation.x = -Math.PI / 2;
    thread.rotation.z = -angle;
    thread.position.set((startX + targetX) / 2, 0.04, (startZ + targetZ) / 2);
    scene.add(thread);

    for (let d = 0; d < totalDist; d += 8) {
      const frac = d / totalDist;
      const pLight = new THREE.PointLight(0x00ffff, 8, 6);
      pLight.position.set(startX + dx * frac, 0.4, startZ + dz * frac);
      scene.add(pLight);
    }

    // Auto-complete objectives for testing
    carriedKeys = [
      { symbol: functionalKeysRevealed[0], typeName: 'Amber Key', mesh: null },
      { symbol: functionalKeysRevealed[1], typeName: 'Sapphire Key', mesh: null }
    ];
    foundKeysList = [...functionalKeysRevealed];
    setTimeout(() => renderCarriedKeysHUD(), 100);
    
    fixedBreakersCount = totalBreakersRequired;
    circuitBreakers.forEach(b => {
      b.isFixed = true;
      b.mesh.material.color.setHex(0x10b981);
      b.mesh.material.emissive = new THREE.Color(0x10b981);
    });
    updateEnvironmentLighting();

    const codeStr = (window.cipherCodeDigits || []).join('');
    setTimeout(() => {
      triggerNotification(`ARIADNE PROTOCOL ACTIVE: All objectives complete. Vault Code: ${codeStr}`);
      
      const cipherHUD = document.getElementById('hud-cipher-info');
      if (cipherHUD) {
        cipherHUD.textContent = `CODE: ${codeStr}`;
        cipherHUD.style.color = '#3b82f6';
        cipherHUD.style.letterSpacing = '0.3em';
      }

      checkWinCondition(); // Will update gate lights
    }, 1500);
  }

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
    const container = document.getElementById('canvas-container');
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (activeViewCamera) {
      activeViewCamera.aspect = w / h;
      activeViewCamera.updateProjectionMatrix();
    }
    renderer.setSize(w, h);
  });

  // Start loop
  animate();
}

// 4 extra "empty" carry slots all human classes get by default to reach an 8-slot max
const EXTRA_CARRY_SLOTS = ['', '', '', ''];

function setupInventory() {
  const isSolo = Boolean(
    (currentLobby && currentLobby.id && currentLobby.id.startsWith('solo-')) ||
    (sessionStorage.getItem('rejoinIsSolo') === 'true') ||
    (currentLobby && currentLobby.players && Object.keys(currentLobby.players).length <= 1 && (!currentLobby.id || !currentLobby.isPublic))
  );

  const medicLoadout = isSolo
    ? ["Sanity Pills", "Med Kit", "Battery Pack", "EMF Radar", ...EXTRA_CARRY_SLOTS]
    : ["Defibrillator", "Sanity Pills", "Med Kit", "Battery Pack", ...EXTRA_CARRY_SLOTS];

  const humanClasses = {
    // Base 4 class items + 4 universal carry slots = 8 slots total
    Locksmith:          ["EMF Radar", "Thermal Camera", "Breaker Remote", "Battery Pack",    ...EXTRA_CARRY_SLOTS],
    Trapper:            ["Salt Cannister", "Chalk / UV Spray", "Battery Pack", "Adrenaline Shot", ...EXTRA_CARRY_SLOTS],
    Scout:              ["EMF Radar", "Sanity Pills", "Battery Pack", "Adrenaline Shot",     ...EXTRA_CARRY_SLOTS],
    Medic:              medicLoadout,
    "Flashlight Expert":["EMF Radar", "Thermal Camera", "Battery Pack", "Battery Pack",     ...EXTRA_CARRY_SLOTS],
    // Quartermaster: 8 class items + 4 empty carry slots (12 total slots)
    Quartermaster: ["EMF Radar", "Salt Cannister", "Chalk / UV Spray", "Adrenaline Shot", "Sanity Pills", "Med Kit", "Battery Pack", "Battery Pack", "", "", "", ""]
  };

  const ghostClasses = {
    Stalker:     ["Ghost Claws", "Scent Tracker"],
    Mimic:       ["Ghost Claws", "Infiltration Clone"],
    Juggernaut:  ["Ghost Claws", "Audio Amplifiers"],
    Phantom:     ["Ghost Claws", "Vapor Leap"],
    Poltergeist: ["Ghost Claws", "Breaker Siphon"],
    Banshee:     ["Ghost Claws", "Sound Scrambler"]
  };

  inventory = myTeam === 'Human' ? [...(humanClasses[myClass] || [])] : [...(ghostClasses[myClass] || [])];
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
  const now = Date.now();

  // --- Class ability items ---
  inventory.forEach((item, index) => {
    const slot = document.createElement('div');
    const isCd = item && abilityCooldowns[item] && abilityCooldowns[item] > now;
    slot.className = index === activeSlot ? 'inventory-slot active' : 'inventory-slot';
    if (isCd) slot.classList.add('on-cooldown');
    slot.style.pointerEvents = 'auto';
    slot.addEventListener('click', (e) => {
      e.stopPropagation();
      activeSlot = index;
      renderHUDInventory();
    });
    
    const idxSpan = document.createElement('span');
    idxSpan.className = 'inventory-slot-index';
    if (index === 9) idxSpan.textContent = '0';
    else if (index === 10) idxSpan.textContent = '-';
    else if (index === 11) idxSpan.textContent = '=';
    else idxSpan.textContent = index + 1;
    slot.appendChild(idxSpan);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = getIconOrShortName(item);
    nameSpan.style.fontSize = '0.7rem';
    nameSpan.style.textAlign = 'center';
    nameSpan.style.color = index === activeSlot ? 'white' : 'var(--text-muted)';
    slot.appendChild(nameSpan);

    // Cooldown timer overlay
    const cdOverlay = document.createElement('div');
    cdOverlay.className = 'slot-cooldown-overlay';
    cdOverlay.style.display = isCd ? 'flex' : 'none';

    const cdText = document.createElement('span');
    cdText.className = 'slot-cooldown-text';
    cdText.textContent = isCd ? `${Math.ceil((abilityCooldowns[item] - now) / 1000)}s` : '';
    cdOverlay.appendChild(cdText);
    slot.appendChild(cdOverlay);

    invGrid.appendChild(slot);
  });

  // --- Carried Keys pocket (only for Humans) ---
  if (myTeam === 'Human') {
    renderCarriedKeysHUD();
  }

  if (typeof socketClient !== 'undefined' && socketClient.emit) {
    socketClient.emit('inventory_update', { inventory, carriedKeys });
  }
}

function updateCooldownHUD() {
  const invGrid = document.getElementById('hud-inventory');
  if (!invGrid) return;
  const now = Date.now();
  const slots = invGrid.querySelectorAll('.inventory-slot');
  
  slots.forEach((slot, index) => {
    const item = inventory[index];
    const overlay = slot.querySelector('.slot-cooldown-overlay');
    const text = slot.querySelector('.slot-cooldown-text');
    if (!overlay || !text) return;

    if (item && abilityCooldowns[item] && abilityCooldowns[item] > now) {
      const remainingMs = abilityCooldowns[item] - now;
      const seconds = Math.ceil(remainingMs / 1000);
      overlay.style.display = 'flex';
      text.textContent = `${seconds}s`;
      slot.classList.add('on-cooldown');
    } else {
      if (overlay.style.display !== 'none') {
        overlay.style.display = 'none';
        slot.classList.remove('on-cooldown');
      }
    }
  });

  // Update mobile action button timer if applicable
  const useBtn = document.getElementById('btn-mobile-use');
  if (useBtn) {
    const activeItem = inventory[activeSlot];
    if (activeItem && abilityCooldowns[activeItem] && abilityCooldowns[activeItem] > now) {
      const remaining = Math.ceil((abilityCooldowns[activeItem] - now) / 1000);
      useBtn.textContent = `USE (${remaining}s)`;
      useBtn.style.opacity = '0.6';
    } else {
      useBtn.textContent = 'USE';
      useBtn.style.opacity = '1';
    }
  }
}

function renderCarriedKeysHUD() {
  let keysPanel = document.getElementById('hud-carried-keys');
  if (!keysPanel) return;
  keysPanel.innerHTML = '';

  const keyColors = {
    'Amber Key':     '#f59e0b',
    'Sapphire Key':  '#60a5fa',
    'Violet Key':    '#c084fc',
    'Emerald Key':   '#34d399',
  };
  const keyIcons = {
    'Amber Key':     '🔑',
    'Sapphire Key':  '🗝️',
    'Violet Key':    '🗝️',
    'Emerald Key':   '🔑',
  };

  // Show 3 slots always (empty ones greyed out)
  for (let i = 0; i < MAX_CARRIED_KEYS; i++) {
    const slot = document.createElement('div');
    slot.className = 'key-slot';

    if (i < carriedKeys.length) {
      const k = carriedKeys[i];
      const isReal = gateSolved && functionalKeysRevealed.includes(k.symbol);
      const typeName = k.typeName || 'Unknown Key';
      const color = keyColors[typeName] || '#ffffff';
      slot.style.borderColor = color;
      slot.style.background = `${color}18`;
      slot.style.boxShadow = isReal ? `0 0 8px ${color}` : 'none';

      const icon = document.createElement('div');
      icon.textContent = keyIcons[typeName] || '🗝️';
      icon.style.fontSize = '1rem';
      slot.appendChild(icon);

      const label = document.createElement('div');
      label.textContent = typeName.split(' ')[0]; // "Amber", "Sapphire", etc.
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
        star.title = 'Twin key verified!';
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

  if (typeof socketClient !== 'undefined' && socketClient.emit) {
    socketClient.emit('inventory_update', { inventory, carriedKeys });
  }

  // Update keys-hud-info count
  const keyHud = document.getElementById('keys-hud-info');
  if (keyHud) {
    keyHud.textContent = `GATE KEYS: ${insertedGateKeys.length}/2 INSTALLED (${carriedKeys.length}/${MAX_CARRIED_KEYS} in hand)`;
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
    case "Med Kit": return "MED";
    case "Defibrillator": return "DEFIB";
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

  window.lastEmfBeepTime = performance.now();
  
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
let floorMesh = null;
let ceilingMesh = null;

function generateMaze(keysCount = 8) {
  // Clear any existing walls
  walls.forEach(w => {
    scene.remove(w);
    if (w.geometry) w.geometry.dispose();
    if (w.material) {
      if (Array.isArray(w.material)) {
        w.material.forEach(m => m.dispose());
      } else {
        w.material.dispose();
      }
    }
  });
  walls = [];
  slidingWallSegments = [];

  // Cleanup old floor and ceiling
  if (floorMesh) {
    scene.remove(floorMesh);
    if (floorMesh.geometry) floorMesh.geometry.dispose();
    if (floorMesh.material) floorMesh.material.dispose();
  }
  if (ceilingMesh) {
    scene.remove(ceilingMesh);
    if (ceilingMesh.geometry) ceilingMesh.geometry.dispose();
    if (ceilingMesh.material) ceilingMesh.material.dispose();
  }

  // Ground plane with photorealistic floor texture
  const textureLoader = new THREE.TextureLoader();
  const floorTex = textureLoader.load('/assets/floor_texture.png');
  floorTex.wrapS = THREE.RepeatWrapping;
  floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(8, 8);
  const floorGeo = new THREE.PlaneGeometry(300, 300);
  const floorMat = new THREE.MeshStandardMaterial({ 
    map: floorTex,
    bumpMap: floorTex,
    bumpScale: 0.08,
    color: 0x1a1a2e, 
    roughness: 0.92,
    metalness: 0.05
  });
  floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  // Ceiling with photorealistic texture
  const ceilTex = textureLoader.load('/assets/ceiling_texture.png');
  ceilTex.wrapS = THREE.RepeatWrapping;
  ceilTex.wrapT = THREE.RepeatWrapping;
  ceilTex.repeat.set(6, 6);
  const ceilGeo = new THREE.PlaneGeometry(300, 300);
  const ceilMat = new THREE.MeshStandardMaterial({ 
    map: ceilTex,
    color: 0x060a12, 
    roughness: 0.95,
    metalness: 0.0
  });
  ceilingMesh = new THREE.Mesh(ceilGeo, ceilMat);
  ceilingMesh.rotation.x = Math.PI / 2;
  ceilingMesh.position.y = 4.5; // Match wall height exactly
  scene.add(ceilingMesh);

  // Grid layout for corridors (Massive Procedural Generation)
  const blockSize = 4.5;
  const mazeSize = 35; // 35x35 blocks = massive
  const layout = Array(mazeSize).fill(0).map(() => Array(mazeSize).fill(1));
  
  function carve(x, z) {
    layout[z][x] = 0;
    const dirs = [[0,-2], [0,2], [-2,0], [2,0]];
    shuffleArray(dirs);
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

  // Randomly select one of the 4 cardinal boundaries for the Master Gate (Vault)
  window.vaultEdge = ['N', 'S', 'E', 'W'][Math.floor(seededRandom() * 4)];
  
  // Find all possible exit points along the chosen edge that are adjacent to the maze paths
  let possibleExits = [];
  if (window.vaultEdge === 'N') {
    for (let c = 1; c < mazeSize - 1; c++) if (layout[1][c] === 0) possibleExits.push(c);
    if (possibleExits.length > 0) {
      window.vaultC = possibleExits[Math.floor(seededRandom() * possibleExits.length)];
      window.vaultR = 0;
      layout[0][window.vaultC] = 0;
    }
  } else if (window.vaultEdge === 'S') {
    for (let c = 1; c < mazeSize - 1; c++) if (layout[mazeSize - 2][c] === 0) possibleExits.push(c);
    if (possibleExits.length > 0) {
      window.vaultC = possibleExits[Math.floor(seededRandom() * possibleExits.length)];
      window.vaultR = mazeSize - 1;
      layout[mazeSize - 1][window.vaultC] = 0;
    }
  } else if (window.vaultEdge === 'E') {
    for (let r = 1; r < mazeSize - 1; r++) if (layout[r][mazeSize - 2] === 0) possibleExits.push(r);
    if (possibleExits.length > 0) {
      window.vaultR = possibleExits[Math.floor(seededRandom() * possibleExits.length)];
      window.vaultC = mazeSize - 1;
      layout[window.vaultR][mazeSize - 1] = 0;
    }
  } else if (window.vaultEdge === 'W') {
    for (let r = 1; r < mazeSize - 1; r++) if (layout[r][1] === 0) possibleExits.push(r);
    if (possibleExits.length > 0) {
      window.vaultR = possibleExits[Math.floor(seededRandom() * possibleExits.length)];
      window.vaultC = 0;
      layout[window.vaultR][0] = 0;
    }
  }

  // Fallback if no paths touch the chosen edge (rare)
  if (possibleExits.length === 0) {
    window.vaultC = centerCoord;
    if (window.vaultEdge === 'N') { window.vaultR = 0; for (let i = 1; i <= centerCoord; i++) layout[i][centerCoord] = 0; }
    else if (window.vaultEdge === 'S') { window.vaultR = mazeSize - 1; for (let i = centerCoord; i < mazeSize - 1; i++) layout[i][centerCoord] = 0; }
    else if (window.vaultEdge === 'E') { window.vaultR = centerCoord; window.vaultC = mazeSize - 1; for (let i = centerCoord; i < mazeSize - 1; i++) layout[centerCoord][i] = 0; }
    else if (window.vaultEdge === 'W') { window.vaultR = centerCoord; window.vaultC = 0; for (let i = 1; i <= centerCoord; i++) layout[centerCoord][i] = 0; }
  }

  // Easter Egg: For Ariadne_999, carve a direct unobstructed straight hallway from center spawn (0, 0) directly to the Master Gate vault
  const myPlayerCheck = (currentLobby && currentLobby.players) ? currentLobby.players[myId] : null;
  const currentUsername = (myPlayerCheck && myPlayerCheck.username) || sessionStorage.getItem('rejoinUsername') || window.myUsername || '';
  const isAriadneUser = currentUsername === 'Ariadne_999';

  if (isAriadneUser) {
    if (window.vaultEdge === 'N') {
      window.vaultR = 0;
      window.vaultC = centerCoord;
      for (let r = 1; r <= centerCoord; r++) {
        layout[r][centerCoord] = 0; // Open straight corridor
        layout[r][centerCoord - 1] = 1; // Solid left wall
        layout[r][centerCoord + 1] = 1; // Solid right wall
      }
      layout[0][centerCoord] = 1; // Solid back wall behind vault
      layout[0][centerCoord - 1] = 1;
      layout[0][centerCoord + 1] = 1;
    } else if (window.vaultEdge === 'S') {
      window.vaultR = mazeSize - 1;
      window.vaultC = centerCoord;
      for (let r = centerCoord; r < mazeSize - 1; r++) {
        layout[r][centerCoord] = 0; // Open straight corridor
        layout[r][centerCoord - 1] = 1; // Solid left wall
        layout[r][centerCoord + 1] = 1; // Solid right wall
      }
      layout[mazeSize - 1][centerCoord] = 1; // Solid back wall behind vault
      layout[mazeSize - 1][centerCoord - 1] = 1;
      layout[mazeSize - 1][centerCoord + 1] = 1;
    } else if (window.vaultEdge === 'W') {
      window.vaultR = centerCoord;
      window.vaultC = 0;
      for (let c = 1; c <= centerCoord; c++) {
        layout[centerCoord][c] = 0; // Open straight corridor
        layout[centerCoord - 1][c] = 1; // Solid top wall
        layout[centerCoord + 1][c] = 1; // Solid bottom wall
      }
      layout[centerCoord][0] = 1; // Solid back wall behind vault
      layout[centerCoord - 1][0] = 1;
      layout[centerCoord + 1][0] = 1;
    } else if (window.vaultEdge === 'E') {
      window.vaultR = centerCoord;
      window.vaultC = mazeSize - 1;
      for (let c = centerCoord; c < mazeSize - 1; c++) {
        layout[centerCoord][c] = 0; // Open straight corridor
        layout[centerCoord - 1][c] = 1; // Solid top wall
        layout[centerCoord + 1][c] = 1; // Solid bottom wall
      }
      layout[centerCoord][mazeSize - 1] = 1; // Solid back wall behind vault
      layout[centerCoord - 1][mazeSize - 1] = 1;
      layout[centerCoord + 1][mazeSize - 1] = 1;
    }
  }

  // Scatter sliding doors (type 2)
  for(let i=0; i < 40; i++) {
    const rx = 1 + Math.floor(seededRandom() * (mazeSize-2));
    const rz = 1 + Math.floor(seededRandom() * (mazeSize-2));
    if (isAriadneUser) {
      if ((window.vaultEdge === 'N' || window.vaultEdge === 'S') && Math.abs(rx - centerCoord) <= 1) continue;
      if ((window.vaultEdge === 'E' || window.vaultEdge === 'W') && Math.abs(rz - centerCoord) <= 1) continue;
    }
    if (layout[rz][rx] === 1) layout[rz][rx] = 2; 
  }

  // Store layout globally for ghost pathfinding
  mazeLayout = layout.map(row => row.map(cell => cell === 0 ? 0 : 1)); // 0=open, 1=wall (treat sliding doors as walls for pathfinding)

  const generatedTex = textureLoader.load('/assets/wall_texture.png');
  generatedTex.wrapS = THREE.RepeatWrapping;
  generatedTex.wrapT = THREE.RepeatWrapping;
  generatedTex.repeat.set(1, 1);

  const wallBumpTex = new THREE.TextureLoader().load('/assets/wall_bump_map.png');
  wallBumpTex.wrapS = THREE.RepeatWrapping;
  wallBumpTex.wrapT = THREE.RepeatWrapping;
  wallBumpTex.repeat.set(1, 1);

  const wallMat = new THREE.MeshStandardMaterial({ 
    map: generatedTex,
    bumpMap: wallBumpTex,
    bumpScale: 0.8, // restoring the high bump scale for physical depth since it wasn't the issue
    color: 0x475569,
    roughness: 0.92,
    metalness: 0.03
  });
  
  const slidingWallMat = new THREE.MeshStandardMaterial({
    map: generatedTex,
    bumpMap: wallBumpTex,
    bumpScale: 0.25,
    color: 0x78350f,
    roughness: 0.6,
    metalness: 0.4
  });

  // Overlap tiles aggressively (+0.5 units) to completely seal all gaps
  const wallGeo = new THREE.BoxGeometry(blockSize + 0.5, 4.5, blockSize + 0.5);

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

  // Draw the Master Gate — Photorealistic Vault Door
  const vaultXPos = (window.vaultC - layout[0].length / 2) * blockSize + blockSize/2;
  const vaultZPos = (window.vaultR - layout.length / 2) * blockSize + blockSize/2;

  // Offset slightly from the boundary wall so it's visible and doesn't z-fight
  let offsetZ = 0, offsetX = 0, padOffsetZ = 0, padOffsetX = 0, blockOffsetZ = 0, blockOffsetX = 0;
  let gateRotY = 0;
  
  // Use 2.6 to firmly place it 0.1 units outside the 2.5 radius wall
  if (window.vaultEdge === 'N') {
    // North wall: faces South (+Z).
    offsetZ = 2.6; padOffsetX = 1.2; padOffsetZ = 0.05; blockOffsetZ = 1.75; gateRotY = 0;
  } else if (window.vaultEdge === 'S') {
    // South wall: faces North (-Z).
    offsetZ = -2.6; padOffsetX = -1.2; padOffsetZ = -0.05; blockOffsetZ = -1.75; gateRotY = Math.PI;
  } else if (window.vaultEdge === 'E') {
    // East wall: faces West (-X).
    offsetX = -2.6; padOffsetZ = -1.2; padOffsetX = -0.05; blockOffsetX = -1.75; gateRotY = -Math.PI / 2;
  } else if (window.vaultEdge === 'W') {
    // West wall: faces East (+X).
    offsetX = 2.6; padOffsetZ = 1.2; padOffsetX = 0.05; blockOffsetX = 1.75; gateRotY = Math.PI / 2;
  }

  gateCoordinates = { x: vaultXPos + offsetX, z: vaultZPos + offsetZ };
  
  if (gateMeshRef) { 
    scene.remove(gateMeshRef); 
    if (gateMeshRef.geometry) gateMeshRef.geometry.dispose();
    if (gateMeshRef.material) gateMeshRef.material.dispose();
    gateMeshRef = null; 
  }
  if (padMeshRef) { 
    scene.remove(padMeshRef); 
    if (padMeshRef.geometry) padMeshRef.geometry.dispose();
    if (padMeshRef.material) padMeshRef.material.dispose();
    padMeshRef = null; 
  }
  
  const gateGeo = new THREE.PlaneGeometry(4.5, 4); // Match corridor width
  const vaultTex = textureLoader.load('/assets/vault_door.png');
  vaultTex.wrapS = THREE.ClampToEdgeWrapping;
  vaultTex.wrapT = THREE.ClampToEdgeWrapping;
  const gateMat = new THREE.MeshStandardMaterial({ 
    map: vaultTex,
    color: 0x8899aa,
    metalness: 0.8,
    roughness: 0.3
  });
  const gateMesh = new THREE.Mesh(gateGeo, gateMat);
  gateMesh.position.set(gateCoordinates.x, 2, gateCoordinates.z);
  gateMesh.rotation.y = gateRotY;
  gateMeshRef = gateMesh;
  scene.add(gateMesh);
  
  // Create an invisible blocking volume so player can't walk through the door
  let blockerSizeX = 4.5, blockerSizeZ = 1;
  if (window.vaultEdge === 'E' || window.vaultEdge === 'W') {
    blockerSizeX = 1; blockerSizeZ = 4.5;
  }
  const gateBlockerGeo = new THREE.BoxGeometry(blockerSizeX, 4, blockerSizeZ);
  const gateBlockerMat = new THREE.MeshBasicMaterial({ visible: false });
  const gateBlocker = new THREE.Mesh(gateBlockerGeo, gateBlockerMat);
  gateBlocker.position.set(vaultXPos + blockOffsetX, 2, vaultZPos + blockOffsetZ);
  gateBlocker.userData = { halfSizeX: blockerSizeX / 2, halfSizeZ: blockerSizeZ / 2 };
  scene.add(gateBlocker);
  walls.push(gateBlocker);
  gateBlockerRef = gateBlocker;

  // Add a photorealistic keypad to the wall next to the door
  const padGeo = new THREE.PlaneGeometry(0.6, 0.9);
  const padTex = textureLoader.load('/assets/keypad.png');
  const padMat = new THREE.MeshStandardMaterial({ map: padTex, metalness: 0.5, roughness: 0.5 });
  const padMesh = new THREE.Mesh(padGeo, padMat);
  padMesh.position.set(gateCoordinates.x + padOffsetX, 1.5, gateCoordinates.z + padOffsetZ);
  padMesh.rotation.y = gateRotY;
  padMeshRef = padMesh;
  scene.add(padMesh);

  // Spawn key collectibles in chests/lockers represented by boxes
  generateCollectibles(keysCount);
  generateCircuitBreakers();
  generateConsumableItems();
}

// Create a detailed 3D key using Torus, Cylinder, and Box components
function createKeyMeshGroup(colorHex, emissiveHex) {
  const group = new THREE.Group();
  
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: emissiveHex,
    emissiveIntensity: 0.5,
    metalness: 0.8,
    roughness: 0.25
  });

  // 1. Ring/Handle (Torus)
  const ringGeo = new THREE.TorusGeometry(0.18, 0.05, 8, 16);
  const ring = new THREE.Mesh(ringGeo, mat);
  ring.position.y = 0.25;
  group.add(ring);

  // 2. Stem/Shaft (Cylinder)
  const shaftGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8);
  const shaft = new THREE.Mesh(shaftGeo, mat);
  shaft.position.y = -0.05;
  group.add(shaft);

  // 3. Tooth/Bit (Box)
  const bitGeo = new THREE.BoxGeometry(0.12, 0.15, 0.04);
  const bit = new THREE.Mesh(bitGeo, mat);
  bit.position.set(0.08, -0.2, 0);
  group.add(bit);

  // Rotate group slightly to lie flatter/more interesting on the floor
  group.rotation.x = Math.PI / 4;
  group.rotation.y = Math.PI / 6;

  return group;
}

// 4 distinct key type definitions: shape + color + name
const KEY_TYPES = [
  { color: 0xf59e0b, emissive: 0xf59e0b, label: 'Amber Key'   },
  { color: 0x60a5fa, emissive: 0x3b82f6, label: 'Sapphire Key' },
  { color: 0xa78bfa, emissive: 0x7c3aed, label: 'Violet Key' },
  { color: 0x34d399, emissive: 0x10b981, label: 'Emerald Key'  },
];

function generateCollectibles(keysCount) {
  // Clear any existing keys
  keysInMaze.forEach(k => {
    scene.remove(k.mesh);
    k.mesh.traverse(child => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      }
    });
  });
  keysInMaze = [];

  // Also clear old code clue notes
  codeClueNotes.forEach(n => {
    scene.remove(n.mesh);
    if (n.mesh.geometry) n.mesh.geometry.dispose();
    if (n.mesh.material) n.mesh.material.dispose();
  });
  codeClueNotes = [];

  // Guarantee unique separated corridor positions for each key
  const availableCorridors = shuffleArray([...openCorridors]);

  for (let i = 0; i < keysCount; i++) {
    const kt = KEY_TYPES[i % KEY_TYPES.length];
    const mesh = createKeyMeshGroup(kt.color, kt.emissive);

    let x = 0, z = 0;
    if (availableCorridors.length > i) {
      x = availableCorridors[i].x;
      z = availableCorridors[i].z;
    } else {
      const angle = (i / keysCount) * Math.PI * 2;
      x = Math.cos(angle) * (15 + seededRandom() * 20);
      z = Math.sin(angle) * (15 + seededRandom() * 20);
    }
    mesh.position.set(x, 0.45, z);
    // Store key type label in userData for HUD hints
    mesh.userData.keyTypeLabel = kt.label;
    scene.add(mesh);

    keysInMaze.push({ id: 'key_' + i, mesh, symbol: kt.label, index: i, typeName: kt.label });
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
  circuitBreakers.forEach(b => {
    scene.remove(b.mesh);
    if (b.mesh.geometry) b.mesh.geometry.dispose();
    if (b.mesh.material) b.mesh.material.dispose();
  });
  circuitBreakers = [];
  fixedBreakersCount = 0;

  // A flat 3D box that mounts flush against a wall
  const breakerGeo = new THREE.BoxGeometry(0.8, 1.2, 0.15);
  const breakerTex = new THREE.TextureLoader().load('/assets/breaker_texture.png');
  // Initial color slightly red tinted to show it is broken/needs fixing
  const breakerMat = new THREE.MeshStandardMaterial({ map: breakerTex, color: 0xffaaaa, roughness: 0.4, metalness: 0.8 });
  
  for (let i = 0; i < totalBreakersRequired; i++) {
    const mesh = new THREE.Mesh(breakerGeo, breakerMat.clone());
    
    let mounted = false;
    const shuffledCorridors = shuffleArray([...openCorridors]);
    
    for (const corr of shuffledCorridors) {
      const col = Math.floor(corr.x / mazeBlockSize + mazeSizeGlobal / 2);
      const row = Math.floor(corr.z / mazeBlockSize + mazeSizeGlobal / 2);
      
      const dirs = [
        { dc: 0, dr: -1, rx: 0, rz: -mazeBlockSize/2, rotY: 0 },         
        { dc: 0, dr: 1, rx: 0, rz: mazeBlockSize/2, rotY: Math.PI },     
        { dc: -1, dr: 0, rx: -mazeBlockSize/2, rz: 0, rotY: Math.PI/2 }, 
        { dc: 1, dr: 0, rx: mazeBlockSize/2, rz: 0, rotY: -Math.PI/2 }   
      ];
      
      for (const d of dirs) {
        const nr = row + d.dr;
        const nc = col + d.dc;
        if (nr >= 0 && nr < mazeSizeGlobal && nc >= 0 && nc < mazeSizeGlobal && mazeLayout[nr][nc] === 1) {
          // Calculate exact placement on the expanded wall surface (+0.5 overlap)
          const expandedWallWidth = mazeBlockSize + 0.5;
          const distToWallFace = mazeBlockSize - (expandedWallWidth / 2); // e.g. 4.5 - 2.5 = 2.0
          const breakerThickness = 0.15;
          const offset = distToWallFace - (breakerThickness / 2) - 0.01; // Subtract half-thickness so it rests perfectly on wall

          const dirX = Math.sign(d.rx); // 1, -1, or 0
          const dirZ = Math.sign(d.rz);

          // Mount the breaker perfectly flush against the wall surface
          mesh.position.set(corr.x + dirX * offset, 1.5, corr.z + dirZ * offset);
          mesh.rotation.y = d.rotY;
          mounted = true;
          break;
        }
      }
      if (mounted) break;
    }
    
    if (!mounted) {
      mesh.position.set((seededRandom() - 0.5) * 40, 1.5, (seededRandom() - 0.5) * 40);
    }
    
    scene.add(mesh);
    mesh.userData.id = `breaker_${i}`;
    
    circuitBreakers.push({
      id: `breaker_${i}`,
      mesh: mesh,
      isFixed: false
    });
  }
}

function generateConsumableItems() {
  itemsInMaze.forEach(item => {
    scene.remove(item.mesh);
    if (item.mesh.geometry) item.mesh.geometry.dispose();
    if (item.mesh.material) item.mesh.material.dispose();
  });
  itemsInMaze = [];

  const textureLoader = new THREE.TextureLoader();
  const itemTypes = [
    { name: 'Battery Pack', map: textureLoader.load('/assets/battery_sprite.png') },
    { name: 'EMF Radar', map: textureLoader.load('/assets/emf_sprite.png') },
    { name: 'Thermal Camera', map: textureLoader.load('/assets/thermal_sprite.png') },
    { name: 'Sanity Pills', map: textureLoader.load('/assets/pills_sprite.png') },
    { name: 'Med Kit', map: textureLoader.load('/assets/medkit_sprite.png') },
    { name: 'Salt Cannister', map: textureLoader.load('/assets/salt_sprite.png') },
    { name: 'Breaker Remote', map: textureLoader.load('/assets/remote_sprite.png') }
  ];

  // Generate 1 EMF, 1 Thermal, 1 Breaker Remote, 6 guaranteed Battery Packs, then randomly pick remaining items
  const itemsToSpawn = [
    itemTypes[1], // EMF
    itemTypes[2], // Thermal
    itemTypes[6], // Breaker Remote
    itemTypes[0], // Battery Pack 1
    itemTypes[0], // Battery Pack 2
    itemTypes[0], // Battery Pack 3
    itemTypes[0], // Battery Pack 4
    itemTypes[0], // Battery Pack 5
    itemTypes[0]  // Battery Pack 6
  ];
  for (let i = 0; i < 10; i++) {
    const rand = seededRandom();
    if (rand > 0.7) {
      itemsToSpawn.push(itemTypes[0]); // Extra Battery (avg ~3 more)
    } else if (rand > 0.4) {
      itemsToSpawn.push(itemTypes[3]); // Sanity Pills
    } else if (rand > 0.2) {
      itemsToSpawn.push(itemTypes[4]); // Med Kit
    } else {
      itemsToSpawn.push(itemTypes[5]); // Salt Cannister
    }
  }

  itemsToSpawn.forEach(type => {
    const spriteMat = new THREE.SpriteMaterial({ 
      map: type.map, 
      color: 0xffffff,
      fog: true,
      transparent: true,
      blending: THREE.AdditiveBlending, // Hides black background
      depthWrite: false
    });
    const mesh = new THREE.Sprite(spriteMat);
    mesh.scale.set(0.6, 0.6, 1);

    let x = 0, z = 0;
    if (openCorridors.length > 0) {
      const randIdx = Math.floor(seededRandom() * openCorridors.length);
      x = openCorridors[randIdx].x;
      z = openCorridors[randIdx].z;
    } else {
      x = (seededRandom() - 0.5) * 40;
      z = (seededRandom() - 0.5) * 40;
    }

    mesh.position.set(x, 0.35, z);
    scene.add(mesh);

    itemsInMaze.push({
      id: 'item_' + seededRandom().toString(36).substr(2, 9),
      mesh: mesh,
      name: type.name
    });
  });
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

function toggleCameraView() {
  currentViewIndex = (currentViewIndex + 1) % viewModes.length;
  const mode = viewModes[currentViewIndex];
  
  if (!activeViewCamera) {
    activeViewCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    scene.add(activeViewCamera);
  }
  
  // Make sure we have a local player visual if we enter TPS
  if (mode !== 'fps' && !localPlayerVisual) {
    const pSkinId = localStorage.getItem('manifestation_equipped_skin') || null;
    const pUsername = localStorage.getItem('manifestation_username') || 'Operative';
    localPlayerVisual = myTeam === 'Ghost' ? createGhostMeshGroup(pSkinId) : createHumanMeshGroup(pSkinId, pUsername);
    // Align visual downwards slightly since camera is at eye level (1.6)
    localPlayerVisual.position.set(0, myTeam === 'Ghost' ? -1.25 : -1.6, 0);
    camera.add(localPlayerVisual);
  }

  if (mode === 'fps') {
    if (localPlayerVisual) localPlayerVisual.visible = false;
  } else {
    if (localPlayerVisual) localPlayerVisual.visible = true;
  }
  triggerNotification("Camera View: " + mode.toUpperCase());
}

let controlsSetup = false;
function setupControls() {
  if (controlsSetup) return;
  controlsSetup = true;

  const container = document.getElementById('canvas-container');
  const onKeyDown = (event) => {
    // If keypad is open, intercept numeric keys and backspace
    if (typeof keypadUI !== 'undefined' && keypadUI && keypadUI.style.display !== 'none') {
      if (event.code.startsWith('Digit') || event.code.startsWith('Numpad')) {
        const num = event.code.replace('Digit', '').replace('Numpad', '');
        if (num.length === 1 && num >= '0' && num <= '9') {
          if (codeEntered.length < 4) {
            codeEntered += num;
            if (typeof keypadScreen !== 'undefined') {
              keypadScreen.textContent = getKeypadDisplayString();
            }
          }
          return; // Prevent other actions like changing inventory
        }
      } else if (event.key === 'Backspace') {
        if (codeEntered.length > 0) {
          codeEntered = codeEntered.slice(0, -1);
          if (typeof keypadScreen !== 'undefined') {
            keypadScreen.textContent = getKeypadDisplayString();
          }
        }
        return;
      } else if (event.key === 'Enter') {
        if (codeEntered.length < 4) {
          if (typeof triggerNotification === 'function') triggerNotification("Enter all 4 digits first.");
        } else {
          if (typeof socketClient !== 'undefined') socketClient.emit('try_cipher', codeEntered);
          keypadUI.style.display = 'none';
          codeEntered = '';
          const ptrOverlay = document.getElementById('pointer-lock-overlay');
          if (ptrOverlay && !window.isMobileDevice) {
            ptrOverlay.style.display = 'flex';
            (renderer && renderer.domElement || document.getElementById('canvas-container')).requestPointerLock();
          }
        }
        return;
      }
    }

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
      case 'KeyF':
        dropActiveItem();
        break;
      case 'Space':
        // Risk/Reward Ability: Panic Hide
        triggerPanicHide();
        break;
      case 'KeyG':
        dropKey();
        break;
      case 'KeyV':
        toggleCameraView();
        break;
      case 'BracketLeft':
        activeSlot = (activeSlot - 1 + inventory.length) % inventory.length;
        renderHUDInventory();
        break;
      case 'BracketRight':
        activeSlot = (activeSlot + 1) % inventory.length;
        renderHUDInventory();
        break;
      case 'KeyM':
        const wrapper = document.getElementById('minimap-wrapper');
        const controls = document.getElementById('minimap-expanded-controls');
        if (wrapper && controls && window.gameReady && myTeam === 'Human') {
          if (!isMinimapExpanded) {
            isMinimapExpanded = true;
            wrapper.classList.add('expanded');
            controls.style.display = 'block';
            if (document.pointerLockElement) document.exitPointerLock();
            drawMinimap();
          } else {
            isMinimapExpanded = false;
            wrapper.classList.remove('expanded');
            controls.style.display = 'none';
            const ptrOverlay = document.getElementById('pointer-lock-overlay');
            if (ptrOverlay && !window.isMobileDevice) {
              ptrOverlay.style.display = 'flex';
              (renderer && renderer.domElement || document.getElementById('canvas-container')).requestPointerLock();
            }
          }
        }
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
      case 'Minus': if (inventory.length > 10) { activeSlot = 10; renderHUDInventory(); } break;
      case 'Equal': if (inventory.length > 11) { activeSlot = 11; renderHUDInventory(); } break;
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
  
  let cheatBuffer = '';
  document.addEventListener('keydown', (e) => {
    if (e.key && e.key.length === 1) {
      cheatBuffer += e.key.toLowerCase();
      if (cheatBuffer.length > 20) cheatBuffer = cheatBuffer.substring(1);
      if (cheatBuffer.includes('spawnwin')) {
        cheatBuffer = '';
        try {
          // Teleport player to the gate
          let telX = gateCoordinates.x;
          let telZ = gateCoordinates.z;
          if (window.vaultEdge === 'N') telZ += 4;
          if (window.vaultEdge === 'S') telZ -= 4;
          if (window.vaultEdge === 'E') telX -= 4;
          if (window.vaultEdge === 'W') telX += 4;
          camera.position.set(telX, 1.6, telZ);
          
          // Move ALL keys in maze right in front of the player
          keysInMaze.forEach((k, index) => {
            const xOff = -2 + (index * 1.5);
            k.mesh.position.set(camera.position.x + xOff, 0.5, camera.position.z - 2);
          });
          
          // Move ALL circuit breakers right in front of the player
          circuitBreakers.forEach((b, index) => {
            const xOff = -2 + (index * 1.5);
            b.mesh.position.set(camera.position.x + xOff, 1.2, camera.position.z - 3);
          });
          
          // Move code clue notes right in front of the player
          codeClueNotes.forEach((note, index) => {
            const xOff = -2.5 + (index * 1.5);
            note.mesh.position.set(camera.position.x + xOff, 0.8, camera.position.z - 4);
          });
          
          const codeStr = (window.cipherCodeDigits || []).join('');
          triggerNotification(`CHEAT: Items spawned! Vault code: ${codeStr}`);
          console.log('spawnwin cheat executed. Code:', codeStr, 'Real keys:', functionalKeysRevealed);
        } catch(err) {
          console.error('spawnwin cheat error:', err);
          triggerNotification('CHEAT ERROR: ' + err.message);
        }
      }
      
      if (cheatBuffer.includes('testwin')) {
        cheatBuffer = '';
        try {
          // 1. Give the player the 2 REAL functional keys using the CORRECT symbols from the server
          carriedKeys = [
            { symbol: functionalKeysRevealed[0], typeName: 'Amber Key', mesh: null },
            { symbol: functionalKeysRevealed[1], typeName: 'Sapphire Key', mesh: null }
          ];
          foundKeysList = [...functionalKeysRevealed];
          renderCarriedKeysHUD();
          
          // 2. Do not mark cipher as solved, so player still has to type it
          // gateSolved = true;
          
          // 3. Fix all breakers
          fixedBreakersCount = totalBreakersRequired;
          // Also visually mark all breakers as fixed
          circuitBreakers.forEach(b => {
            b.isFixed = true;
            b.mesh.material.color.setHex(0x10b981);
          });
          updateEnvironmentLighting();

          // 4. Teleport right in front of the vault (close enough to trigger win on interaction)
          let telX = gateCoordinates.x;
          let telZ = gateCoordinates.z;
          if (window.vaultEdge === 'N') telZ += 4;
          if (window.vaultEdge === 'S') telZ -= 4;
          if (window.vaultEdge === 'E') telX -= 4;
          if (window.vaultEdge === 'W') telX += 4;
          camera.position.set(telX, 1.6, telZ);
          
          const codeStr = (window.cipherCodeDigits || []).join('');
          triggerNotification(`WIN STATE READY! Walk to gate & press E. Code: ${codeStr}`);
          console.log('testwin cheat executed. Keys:', functionalKeysRevealed, 'Code:', codeStr);
          
          checkWinCondition();
        } catch(err) {
          console.error('testwin cheat error:', err);
          triggerNotification('CHEAT ERROR: ' + err.message);
        }
      }
    }
  });
  
  document.addEventListener('mousedown', (e) => {
    if (!document.pointerLockElement || (isCaptured && !window.isSpectating)) return;
    if (e.button === 0 && !window.isSpectating) { // Left click
      useActiveItem();
    }
  });

  // Mouse camera rotation controller
  document.addEventListener('mousemove', (e) => {
    if (!document.pointerLockElement || (isCaptured && !window.isSpectating)) return;
    
    // Ignore massive spikes caused by browser Pointer Lock bugs
    if (Math.abs(e.movementX) > 200 || Math.abs(e.movementY) > 200) return;

    const sensitivity = window.lookSensitivity !== undefined ? window.lookSensitivity : 1.0;
    camera.rotation.y -= e.movementX * 0.002 * sensitivity;
    camera.rotation.x -= e.movementY * 0.002 * sensitivity;
    camera.rotation.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camera.rotation.x));
  });

  // Mobile Touch Controls
  {
    let lookTouchId = null;
    let lastLookX = 0;
    let lastLookY = 0;

    // Listen on document to bypass pointer-events touch bugs in mobile viewports
    document.addEventListener('touchstart', (e) => {
      if (!isMobileDevice) return;
      if ((isCaptured && !window.isSpectating) || !window.gameReady) return;
      
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

          const sensitivity = window.lookSensitivity !== undefined ? window.lookSensitivity : 1.0;
          camera.rotation.y -= dx * 0.004 * sensitivity;
          camera.rotation.x -= dy * 0.004 * sensitivity;
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
      isSprinting = false;
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

    // Sprint button — toggle: tap to start, tap again to stop
    const sprintBtn = document.getElementById('btn-mobile-sprint');
    if (sprintBtn) {
      const handleSprintToggle = (e) => {
        if (!isMobileDevice) return;
        e.preventDefault();
        e.stopPropagation();
        if (isSprinting) {
          isSprinting = false;
          sprintBtn.classList.remove('sprinting');
        } else if (myTeam === 'Human' && stamina > SPRINT_MIN_STAMINA && !isCaptured && window.gameReady) {
          isSprinting = true;
          sprintBtn.classList.add('sprinting');
        }
      };
      sprintBtn.addEventListener('touchstart', handleSprintToggle, { passive: false });
      sprintBtn.addEventListener('click', handleSprintToggle);
    }

    const handlePause = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isMobileDevice) {
        window.mobileGameActive = false;
        ptrOverlay.style.display = 'flex';
      } else {
        document.exitPointerLock();
      }
    };
    if (pauseBtn) {
      pauseBtn.addEventListener('touchstart', handlePause, { passive: false });
      pauseBtn.addEventListener('click', handlePause);
    }
    const globalPauseBtn = document.getElementById('global-pause-btn');
    if (globalPauseBtn) {
      globalPauseBtn.addEventListener('touchstart', handlePause, { passive: false });
      globalPauseBtn.addEventListener('click', handlePause);
    }

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

// Helper to check if player is looking roughly towards a target
function isLookingAtTarget(targetPos, maxDist, maxAngle = 0.6) {
  const dist = camera.position.distanceTo(targetPos);
  if (dist > maxDist) return { looking: false, dist };
  
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const toTarget = targetPos.clone().sub(camera.position).normalize();
  const angle = dir.angleTo(toTarget);
  return { looking: angle < maxAngle, dist };
}

function isKeyFunctional(k) {
  if (!k) return false;
  return functionalKeysRevealed.some(f => 
    f === k.symbol || 
    f === k.typeName || 
    (k.typeName && f.toLowerCase().includes(k.typeName.toLowerCase())) ||
    (k.symbol && f.toLowerCase().includes(k.symbol.toLowerCase()))
  );
}

function getKeyIdentifier(k) {
  return k.typeName || k.symbol;
}

// Dynamically render on-screen keys/breaker/item interaction prompts in HUD
function updateInteractionPrompt() {
  const promptEl = document.getElementById('interaction-prompt');
  if (myTeam === 'Ghost') {
    if (promptEl) promptEl.style.display = 'none';
    return;
  }
  if (!promptEl) return;

  if (myTeam !== 'Human' || isCaptured || !window.gameReady) {
    promptEl.style.display = 'none';
    return;
  }

  let minDistance = Infinity;
  let promptText = "";

  // 1. Check Master Gate
  const gateVec = new THREE.Vector3(gateCoordinates.x, 2, gateCoordinates.z);
  const { looking: lookingAtGate, dist: distToGate } = isLookingAtTarget(gateVec, 6.0);

  if (lookingAtGate) { // Must be looking roughly at the door/keypad
    if (distToGate < minDistance) {
      minDistance = distToGate;
      const breakersFixed = fixedBreakersCount >= totalBreakersRequired;

      if (!breakersFixed) {
        promptText = `ACCESS DENIED: Need 3 Breakers to power terminal (${fixedBreakersCount}/${totalBreakersRequired})`;
      } else if (!gateSolved) {
        if (window.securityLockoutActive) {
          const remaining = Math.max(1, Math.ceil((window.securityLockoutEndTime - performance.now()) / 1000));
          promptText = `ACCESS DENIED: Security Lockout (${remaining}s remaining)`;
        } else {
          promptText = isMobileDevice ? "Tap INTERACT to Open Keypad" : "Press <kbd>E</kbd> to Open Keypad";
        }
      } else {
        // Gate keypad is cracked! Now players can insert keys
        const uninsertedKeyIndex = carriedKeys.findIndex(k => 
          isKeyFunctional(k) && !insertedGateKeys.includes(getKeyIdentifier(k))
        );

        if (uninsertedKeyIndex !== -1) {
          const keyToInsert = carriedKeys[uninsertedKeyIndex];
          const keyId = getKeyIdentifier(keyToInsert);
          promptText = isMobileDevice ? `Tap INTERACT to Insert [${keyId}]` : `Press <kbd>E</kbd> to Insert [${keyId}]`;
        } else if (insertedGateKeys.length >= 2) {
          promptText = isMobileDevice ? "Tap INTERACT to Escape Labyrinth!" : "Press <kbd>E</kbd> to Escape Labyrinth!";
        } else {
          promptText = `ACCESS DENIED: ${insertedGateKeys.length}/2 Keys Installed into Gate`;
        }
      }
    }
  }

  // 2. Check Keys in Maze
  for (let i = 0; i < keysInMaze.length; i++) {
    const key = keysInMaze[i];
    const { looking: lookingAtKey, dist: distToKey } = isLookingAtTarget(key.mesh.position, 5.0);
    if (lookingAtKey) {
      if (distToKey < minDistance) {
        minDistance = distToKey;
        if (carriedKeys.length < MAX_CARRIED_KEYS) {
          promptText = isMobileDevice ? `Tap INTERACT to collect ${key.typeName}` : `Press <kbd>E</kbd> to collect ${key.typeName}`;
        } else {
          promptText = isMobileDevice ? `Hands Full! Tap DROP KEY to replace` : `Hands Full! Press <kbd>G</kbd> to drop a key first`;
        }
      }
    }
  }

  // 3. Check Circuit Breakers
  for (let i = 0; i < circuitBreakers.length; i++) {
    const breaker = circuitBreakers[i];
    if (breaker.isFixed) continue;
    const { looking: lookingAtBreaker, dist: distToBreaker } = isLookingAtTarget(breaker.mesh.position, 4.5);
    if (lookingAtBreaker) {
      if (distToBreaker < minDistance) {
        minDistance = distToBreaker;
        promptText = isMobileDevice ? "Tap INTERACT to repair breaker" : "Press <kbd>E</kbd> to repair breaker";
      }
    }
  }

  // 4. Check Code Clue Notes (Glowing Cipher Pages)
  for (let i = 0; i < codeClueNotes.length; i++) {
    const clue = codeClueNotes[i];
    const { looking: lookingAtClue, dist: distToClue } = isLookingAtTarget(clue.mesh.position, 4.0);
    if (lookingAtClue) {
      if (distToClue < minDistance) {
        minDistance = distToClue;
        if (clue.collected) {
          const digits = window.cipherCodeDigits || [];
          const revealedDigit = digits[clue.digitIndex] !== undefined ? digits[clue.digitIndex] : '?';
          promptText = `Cipher Clue #${clue.digitIndex + 1}: [ ${revealedDigit} ] (Code Already Read)`;
        } else {
          promptText = isMobileDevice ? `Tap INTERACT to inspect Cipher Clue #${clue.digitIndex + 1}` : `Press <kbd>E</kbd> to inspect Cipher Clue #${clue.digitIndex + 1}`;
        }
      }
    }
  }

  // 5. Check Ground Dropped Items
  for (let i = 0; i < itemsInMaze.length; i++) {
    const dItem = itemsInMaze[i];
    if (!dItem || !dItem.mesh) continue;
    const { looking: lookingAtItem, dist: distToItem } = isLookingAtTarget(dItem.mesh.position, 4.0);
    if (lookingAtItem) {
      if (distToItem < minDistance) {
        minDistance = distToItem;
        promptText = isMobileDevice ? `Tap INTERACT to pick up ${dItem.name || 'Item'}` : `Press <kbd>E</kbd> to pick up ${dItem.name || 'Item'}`;
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
  if (myTeam === 'Ghost' || window.isSpectating) return;

  // 1. Check proximity to Keypad Terminal (Master Gate)
  const gateVec = new THREE.Vector3(gateCoordinates.x, 2, gateCoordinates.z);
  const { looking: lookingAtGate, dist: distToGate } = isLookingAtTarget(gateVec, 6.0);

  if (lookingAtGate) {
    const breakersFixed = fixedBreakersCount >= totalBreakersRequired;

    if (!breakersFixed) {
      triggerNotification(`Master Gate needs power! Fix circuit breakers (${fixedBreakersCount}/${totalBreakersRequired})`);
      return;
    }

    if (!gateSolved) {
      if (window.securityLockoutActive) {
        const remaining = Math.max(1, Math.ceil((window.securityLockoutEndTime - performance.now()) / 1000));
        triggerNotification(`ACCESS DENIED: Keypad locked out for ${remaining} more seconds!`);
        return;
      }
      openKeypadModal();
      return;
    }

    // Gate cipher is solved! Now players can insert twin keys or escape
    const uninsertedKeyIndex = carriedKeys.findIndex(k => 
      isKeyFunctional(k) && !insertedGateKeys.includes(getKeyIdentifier(k))
    );

    if (uninsertedKeyIndex !== -1) {
      const poppedKey = carriedKeys.splice(uninsertedKeyIndex, 1)[0];
      const keyId = getKeyIdentifier(poppedKey);
      if (!insertedGateKeys.includes(keyId)) {
        insertedGateKeys.push(keyId);
      }
      renderCarriedKeysHUD();
      updateGateHUD();
      if (typeof socketClient !== 'undefined') {
        socketClient.emit('insert_gate_key', { symbol: keyId });
      }
      triggerNotification(`🔑 Inserted [${keyId}] into Master Gate! (${insertedGateKeys.length}/2 installed)`);
      checkWinCondition();
      return;
    }

    // Check if player is carrying a decoy key
    if (carriedKeys.length > 0 && insertedGateKeys.length < 2) {
      triggerNotification(`Key does not fit! [${carriedKeys[0].typeName || 'Key'}] is not one of the twin gate keys.`);
      return;
    }

    if (insertedGateKeys.length >= 2 && breakersFixed) {
      // All conditions satisfied -> Escape victory!
      if (socketClient) {
        socketClient.emit('human_escaped', { id: socketClient.id });
      }
      isCaptured = true; // Lock controls during cinematic
      window.isEscaping = true;
      playEscapeCinematic(() => {
        document.getElementById('hud-overlay').style.display = 'none';
        if (document.pointerLockElement) document.exitPointerLock();
        window.mobileGameActive = false;
      });
    } else {
      triggerNotification(`Master Gate requires remaining twin key! (${insertedGateKeys.length}/2 installed: [${insertedGateKeys.join(', ') || 'None'}])`);
    }
    return;
  }

  // 2. Check Key Interactions
  for (let i = 0; i < keysInMaze.length; i++) {
    const key = keysInMaze[i];
    const { looking: lookingAtKey } = isLookingAtTarget(key.mesh.position, 5.0);
    if (lookingAtKey) {
      // Enforce carry limit
      if (carriedKeys.length >= MAX_CARRIED_KEYS) {
        triggerNotification(`Cannot carry more than ${MAX_CARRIED_KEYS} keys. Press G to drop one.`);
        break;
      }
      // Picked up!
      scene.remove(key.mesh);
      key.mesh.traverse(child => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        }
      });
      carriedKeys.push({ symbol: key.symbol, typeName: key.typeName });
      foundKeysList.push(key.symbol);

      const isReal = gateSolved && functionalKeysRevealed.includes(key.symbol);
      triggerNotification(`Picked up [${key.typeName}]${isReal ? ' ★ (Twin Key Verified)' : ''} (${carriedKeys.length}/${MAX_CARRIED_KEYS})`);

      // Refresh the carried-keys HUD
      renderCarriedKeysHUD();

      // Check if we retrieved the exact matching real keys
      checkWinCondition();

      // Emit events
      if (typeof socketClient !== 'undefined') socketClient.emit('key_picked_up', { keyId: key.id });
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
      if (typeof socketClient !== 'undefined') socketClient.emit('breaker_fixed', { breakerId: breaker.id });
      fixBreakerLocal(breaker.id);
      break;
    }
  }

  // 4. Check proximity to Code Clue Notes (yellow glowing slabs)
  for (let i = 0; i < codeClueNotes.length; i++) {
    const note = codeClueNotes[i];
    const distToNote = camera.position.distanceTo(note.mesh.position);
    if (distToNote < 4.5) {
      const { looking: lookingAtNote } = isLookingAtTarget(note.mesh.position, 4.5);
      if (lookingAtNote) {
        if (note.collected) {
          const digitNames = ['1ST', '2ND', '3RD', '4TH'];
          const digits = window.cipherCodeDigits || [];
          const revealedDigit = digits[note.digitIndex] !== undefined ? digits[note.digitIndex] : '?';
          triggerNotification(`Code already read! ${digitNames[note.digitIndex]} digit of gate code: [ ${revealedDigit} ]`);
        } else {
          if (typeof socketClient !== 'undefined') {
            socketClient.emit('clue_collected', { digitIndex: note.digitIndex });
          }
          collectClueLocal(note.digitIndex);
        }
        break;
      }
    }
  }

  // 5. Check proximity to Pick-up Items (find empty slot & check unique items)
  for (let i = 0; i < itemsInMaze.length; i++) {
    const item = itemsInMaze[i];
    const { looking: lookingAtItem } = isLookingAtTarget(item.mesh.position, 4.5);
    if (lookingAtItem) {
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
        if (item.mesh.geometry) item.mesh.geometry.dispose();
        if (item.mesh.material) item.mesh.material.dispose();
        itemsInMaze.splice(i, 1);
        if (window.socket) window.socket.emit('item_picked_up', { id: item.id });
        triggerNotification(`Picked up ${item.name}`);
        renderHUDInventory();
      } else {
        triggerNotification("Inventory full! Drop an item first.");
      }
      break;
    }
  }
}

function collectClueLocal(digitIndex) {
  const note = codeClueNotes.find(n => n.digitIndex === digitIndex);
  if (note && !note.collected) {
    note.collected = true;
    note.mesh.material.emissiveIntensity = 0.1;
  }

  const digitNames = ['1ST', '2ND', '3RD', '4TH'];
  const digits = window.cipherCodeDigits || [null, null, null, null];
  const revealedDigit = digits[digitIndex];

  triggerNotification(`cipher clue found! ${digitNames[digitIndex]} digit of gate code: [ ${revealedDigit} ]`);

  const cipherHUD = document.getElementById('hud-cipher-info');
  if (cipherHUD) {
    const display = digits.map((d, idx) => {
      const collected = codeClueNotes.find(n => n.digitIndex === idx && n.collected);
      return collected ? d : '_';
    }).join(' ');
    cipherHUD.textContent = `CODE: ${display}`;
  }

  if (typeof keypadUI !== 'undefined' && keypadUI.style.display !== 'none') {
    keypadScreen.textContent = getKeypadDisplayString();
  }
}

function useActiveItem() {
  if (window.isSpectating) return;
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
  } else if (item === "Med Kit") {
    currentHP = 100;
    document.getElementById('hp-value').textContent = `${Math.ceil(currentHP)} HP`;
    document.getElementById('hp-bar').style.width = `${currentHP}%`;
    triggerNotification("health fully restored.");
    removeItem(activeSlot);
  } else if (item === "Defibrillator") {
    // Medic Revive Ability: revive 1 dead/captured teammate
    if (myTeam !== 'Human') return;
    
    let targetPlayerId = null;
    let targetPlayerName = 'Survivor';

    if (currentLobby && currentLobby.players) {
      for (const [id, p] of Object.entries(currentLobby.players)) {
        if (id !== myId && p.team === 'Human' && p.isCaptured) {
          targetPlayerId = id;
          targetPlayerName = p.username || 'Survivor';
          break;
        }
      }
    }

    if (targetPlayerId) {
      if (typeof socketClient !== 'undefined') {
        socketClient.emit('revive_player', { targetId: targetPlayerId });
      }
      removeItem(activeSlot);
      triggerNotification(`⚡ Defibrillator discharged! Reviving Operative ${targetPlayerName}!`);
    } else {
      triggerNotification("Defibrillator ready: No fallen teammates currently require revival.");
    }
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
    
    // 5-second cooldown on Ghost Claws attacks
    const now = Date.now();
    if (abilityCooldowns[item] && abilityCooldowns[item] > now) {
      triggerNotification(`Ghost Claws recharging (${Math.ceil((abilityCooldowns[item] - now) / 1000)}s)`);
      return;
    }

    let closestId = null;
    let closestDist = 4.0;
    Object.keys(players3D).forEach(id => {
      const dist = camera.position.distanceTo(players3D[id].position);
      const isHuman = players3D[id].userData && players3D[id].userData.type === 'Human';
      if (isHuman && dist < closestDist) {
        closestDist = dist;
        closestId = id;
      }
    });
    if (closestId) {
      socketClient.emit('capture_human', { targetId: closestId });
      triggerNotification("Captured a survivor!");
      abilityCooldowns[item] = now + 5000;
    } else {
      triggerNotification("No survivor in range.");
    }
  } else if (item === "Scent Tracker") {
    const now = Date.now();
    if (abilityCooldowns[item] && abilityCooldowns[item] > now) {
      triggerNotification(`Scent Tracker recharging (${Math.ceil((abilityCooldowns[item] - now) / 1000)}s)`);
      return;
    }
    triggerNotification("Scent tracking active.");
    let closestDist = 9999;
    let closestPos = null;
    Object.keys(players3D).forEach(id => {
      const dist = camera.position.distanceTo(players3D[id].position);
      const isHuman = players3D[id].userData && players3D[id].userData.type === 'Human';
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
      setTimeout(() => {
        scene.remove(line);
        if (line.geometry) line.geometry.dispose();
        if (line.material) line.material.dispose();
      }, 5000);
    }
    abilityCooldowns[item] = now + 20000; // 20s cooldown
  } else if (item === "Infiltration Clone") {
    const now = Date.now();
    if (abilityCooldowns[item] && abilityCooldowns[item] > now) {
      triggerNotification(`Clone recharging (${Math.ceil((abilityCooldowns[item] - now) / 1000)}s)`);
      return;
    }
    triggerNotification("Mimic clone active! You appear human.");
    socketClient.emit('mimic_clone');
    abilityCooldowns[item] = now + 30000; // 30s cooldown
  } else if (item === "Audio Amplifiers") {
    const now = Date.now();
    if (abilityCooldowns[item] && abilityCooldowns[item] > now) {
      triggerNotification(`Amplifiers recharging (${Math.ceil((abilityCooldowns[item] - now) / 1000)}s)`);
      return;
    }
    triggerNotification("Audio Amplifiers engaged! Extreme speed.");
    speedBoostTimer = 10;
    abilityCooldowns[item] = now + 45000; // 45s cooldown
  } else if (item === "Vapor Leap") {
    const now = Date.now();
    if (abilityCooldowns[item] && abilityCooldowns[item] > now) {
      triggerNotification(`Vapor Leap recharging (${Math.ceil((abilityCooldowns[item] - now) / 1000)}s)`);
      return;
    }
    triggerNotification("Vapor Leap!");
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    camera.position.addScaledVector(forward, 12);
    abilityCooldowns[item] = now + 15000; // 15s cooldown
  } else if (item === "Breaker Siphon") {
    const now = Date.now();
    if (abilityCooldowns[item] && abilityCooldowns[item] > now) {
      triggerNotification(`Siphon recharging (${Math.ceil((abilityCooldowns[item] - now) / 1000)}s)`);
      return;
    }
    triggerNotification("Breaker Siphon deployed!");
    socketClient.emit('breaker_siphon', { position: { x: camera.position.x, z: camera.position.z } });
    abilityCooldowns[item] = now + 30000; // 30s cooldown
  } else if (item === "Sound Scrambler") {
    const now = Date.now();
    if (abilityCooldowns[item] && abilityCooldowns[item] > now) {
      triggerNotification(`Scrambler recharging (${Math.ceil((abilityCooldowns[item] - now) / 1000)}s)`);
      return;
    }
    triggerNotification("Scrambler unleashed!");
    socketClient.emit('sound_scramble', { position: { x: camera.position.x, z: camera.position.z } });
    abilityCooldowns[item] = now + 40000; // 40s cooldown
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
  const mat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(pos.x, 0.05, pos.z);
  scene.add(mesh);
  chalkDecals.push(mesh);
}

function removeItem(index) {
  inventory[index] = "";
  renderHUDInventory();
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
    const ptrOverlay = document.getElementById('pointer-lock-overlay');
    if (ptrOverlay && !window.isMobileDevice) {
      ptrOverlay.style.display = 'flex';
      (renderer && renderer.domElement || document.getElementById('canvas-container')).requestPointerLock();
    }
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
  if (window.isSpectating) return;
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

  const itemId = 'item_' + Math.random().toString(36).substr(2, 9);
  
  // Emit event to network so teammates see it
  socketClient.emit('item_dropped', {
    id: itemId,
    name: item,
    position: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z }
  });

  // Spawn it locally
  spawnDroppedItemLocal(itemId, item, spawnPos);
  triggerNotification(`Dropped ${item}`);
}

function spawnDroppedItemLocal(id, name, pos) {
  const textureLoader = new THREE.TextureLoader();
  let texPath = '';
  if (name === 'Battery Pack') texPath = '/assets/battery_sprite.png';
  else if (name === 'EMF Radar') texPath = '/assets/emf_sprite.png';
  else if (name === 'Thermal Camera') texPath = '/assets/thermal_sprite.png';
  else if (name === 'Sanity Pills') texPath = '/assets/pills_sprite.png';
  else if (name === 'Med Kit') texPath = '/assets/medkit_sprite.png';

  let mesh;
  if (texPath !== '') {
    const spriteMat = new THREE.SpriteMaterial({ 
      map: textureLoader.load(texPath), 
      color: 0xffffff,
      fog: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    mesh = new THREE.Sprite(spriteMat);
    mesh.scale.set(0.6, 0.6, 1);
  } else {
    // Fallback for class-specific untextured items
    const itemGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.6, 8);
    const itemMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0xa855f7, emissiveIntensity: 0.2 });
    mesh = new THREE.Mesh(itemGeo, itemMat);
  }
  
  mesh.position.copy(pos);
  mesh.position.y = 0.35; // ensure it is on floor
  scene.add(mesh);

  itemsInMaze.push({
    id: id,
    mesh: mesh,
    name: name
  });
}

// Drop the most recently collected key, prioritizing fake keys
function dropKey() {
  if (carriedKeys.length === 0) {
    triggerNotification("No keys to drop.");
    return;
  }

  // Try to find a fake key to drop first
  let dropIndex = -1;
  for (let i = carriedKeys.length - 1; i >= 0; i--) {
    if (!functionalKeysRevealed.includes(carriedKeys[i].symbol)) {
      dropIndex = i;
      break;
    }
  }
  
  // If all carried keys are somehow functional, drop the last one
  if (dropIndex === -1) {
    dropIndex = carriedKeys.length - 1;
  }

  const poppedKey = carriedKeys.splice(dropIndex, 1)[0];
  
  // Remove from foundKeysList so it doesn't count towards the win condition anymore
  const symbolIndex = foundKeysList.indexOf(poppedKey.symbol);
  if (symbolIndex > -1) {
    foundKeysList.splice(symbolIndex, 1);
  }

  // Re-instantiate the 3D mesh
  const kt = KEY_TYPES.find(k => k.label === poppedKey.typeName) || KEY_TYPES[0];
  const mesh = createKeyMeshGroup(kt.color, kt.emissive);
  
  // Drop it slightly in front of the player
  const dropPos = new THREE.Vector3(0, 0, -2).applyQuaternion(camera.quaternion).add(camera.position);
  mesh.position.set(dropPos.x, 1.0, dropPos.z);
  scene.add(mesh);

  keysInMaze.push({
    mesh: mesh,
    symbol: poppedKey.symbol,
    typeName: poppedKey.typeName
  });

  if (socketClient) {
    socketClient.emit('key_dropped', {
      symbol: poppedKey.symbol,
      typeName: poppedKey.typeName,
      position: { x: dropPos.x, y: 1.0, z: dropPos.z }
    });
  }

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
  if (myTeam !== 'Human' || window.isSpectating || inventory[activeSlot] !== 'EMF Radar') return;

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
  if (myTeam !== 'Human' || window.isSpectating) {
    if (window.isSpectating) document.body.style.filter = 'none';
    return;
  }

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

  if (window.sensorsScrambled) {
    document.body.style.filter = "invert(1) hue-rotate(180deg)";
  } else if (currentSanity < 30) {
    // Hallucinations overlay
    document.body.style.filter = `hue-rotate(${Math.sin(performance.now() * 0.01) * 30}deg) contrast(1.2)`;
  } else {
    document.body.style.filter = 'none';
  }
}

function getVisionMultiplier() {
  if (typeof fixedBreakersCount === 'undefined') return 1.0;
  if (fixedBreakersCount >= 3) return 1.50;
  if (fixedBreakersCount === 2) return 1.25;
  if (fixedBreakersCount === 1) return 1.10;
  return 1.0;
}

function processFlashlightBattery(delta) {
  if (myTeam !== 'Human' || window.isSpectating) return;
  if (!flashLight) return;

  const mult = getVisionMultiplier();
  const baseIntensity = (inventory.includes('Battery Pack') ? 200 : 80) * mult;

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
    } else if (window.flashlightDisabledBySiphon) {
      // Siphon penalty flicker (same as critical battery)
      flashLight.intensity = Math.random() < 0.18 ? 0 : baseIntensity * 0.2;
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

let exitGateShown = false;

function updateGateHUD() {
  const keysHud = document.getElementById('keys-hud-info');
  if (keysHud) {
    const realCarried = carriedKeys.filter(k => functionalKeysRevealed.includes(k.symbol)).length;
    if (insertedGateKeys.length >= 2) {
      keysHud.style.color = "#10b981";
      keysHud.textContent = `GATE KEYS: 2 / 2 INSTALLED (GATE READY!)`;
    } else {
      keysHud.style.color = "var(--secondary-accent)";
      keysHud.textContent = `GATE KEYS: ${insertedGateKeys.length} / 2 INSTALLED (${carriedKeys.length}/${MAX_CARRIED_KEYS} in hand)`;
    }
  }
  const lockLabel = document.getElementById('terminal-lock-label');
  if (lockLabel) {
    if (gateSolved && insertedGateKeys.length >= 2 && fixedBreakersCount >= totalBreakersRequired) {
      lockLabel.textContent = "GATE UNLOCKED — PRESS E TO ESCAPE";
      lockLabel.style.color = "#10b981";
    } else if (gateSolved) {
      lockLabel.textContent = `Keys: ${insertedGateKeys.length}/2 Installed`;
      lockLabel.style.color = "var(--secondary-accent)";
    }
  }
}

function checkWinCondition() {
  const breakersFixed = fixedBreakersCount >= totalBreakersRequired;

  // Change gate material when ALL conditions are satisfied for the first time
  if (gateSolved && insertedGateKeys.length >= 2 && breakersFixed) {
    if (gateMeshRef && !exitGateShown) {
      showExitGate();
      exitGateShown = true;
    }
  }
  updateGateHUD();
}

// Setup network synchronization
function setupSocketListeners() {
  socketClient.on('player_moved', ({ id, position, rotation, team, characterClass }) => {
    // Ignore local player position broadcasts so we don't spawn a clone on ourselves
    if (!id || id === myId) return;

    // If player mesh exists but team has changed, remove it to spawn the correct mesh type
    if (players3D[id] && players3D[id].userData && players3D[id].userData.type !== team) {
      scene.remove(players3D[id]);
      players3D[id].traverse(child => {
        if (child.isMesh || child.isSprite) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
        }
      });
      delete players3D[id];
    }

    if (!players3D[id]) {
      const isGhost = team === 'Ghost';
      const pSkinId = currentLobby && currentLobby.players[id] ? currentLobby.players[id].skinId : null;
      const pUsername = currentLobby && currentLobby.players[id] ? currentLobby.players[id].username : 'Unknown';
      const capMesh = isGhost ? createGhostMeshGroup(pSkinId) : createHumanMeshGroup(pSkinId, pUsername);
      
      // Setup thermal camera support (Cyan for teammates, Red for ghosts)
      const meshThermalMat = new THREE.MeshBasicMaterial({ 
        color: isGhost ? 0xff5555 : 0x38bdf8, 
        fog: false, 
        depthTest: false, 
        side: THREE.DoubleSide 
      });
      capMesh.traverse(c => {
        if (c.isMesh) {
          c.userData.normalMat = c.material;
          c.userData.thermalMat = meshThermalMat;
        } else if (c.isSprite) {
          c.userData.normalMat = c.material;
          c.userData.thermalMat = new THREE.SpriteMaterial({
            map: c.material.map,
            color: isGhost ? 0xff5555 : 0x38bdf8,
            fog: false,
            depthTest: false,
            transparent: true,
            blending: THREE.AdditiveBlending
          });
        }
      });

      capMesh.position.set(position.x, isGhost ? 0.35 : 0, position.z);
      scene.add(capMesh);
      players3D[id] = capMesh;
    } else {
      // Update pos
      const isGhost = team === 'Ghost';
      players3D[id].position.set(position.x, isGhost ? 0.35 : 0, position.z);
      players3D[id].rotation.y = rotation.y;
    }
  });

  // Cipher successfully solved!
  socketClient.on('cipher_solved', ({ realKeySymbols }) => {
    gateSolved = true;
    functionalKeysRevealed = realKeySymbols;

    triggerNotification(`Cipher cracked! Twin functional keys revealed: [${realKeySymbols.join(' & ')}]`);
    
    const keypadModal = document.getElementById('keypad-modal-ui');
    if (keypadModal) {
      keypadModal.style.display = 'none';
      if (!isMobileDevice && !document.pointerLockElement) {
        (renderer && renderer.domElement || document.getElementById('canvas-container')).requestPointerLock();
      }
    }

    // Remove the 3D keypad terminal mesh from the wall now that code is cracked
    if (padMeshRef) {
      scene.remove(padMeshRef);
      if (padMeshRef.geometry) padMeshRef.geometry.dispose();
      if (padMeshRef.material) padMeshRef.material.dispose();
      padMeshRef = null;
    }

    const cipherHUD = document.getElementById('hud-cipher-info');
    if (cipherHUD) {
      cipherHUD.textContent = `Keys: ${realKeySymbols.join(' & ')}`;
    }
    
    updateGateHUD();
    checkWinCondition();
  });

  // Keypad failure penalty trigger
  socketClient.on('cipher_failed_penalty', ({ cooldownSeconds, revealSeconds }) => {
    window.securityLockoutActive = true;
    window.securityLockoutEndTime = performance.now() + (cooldownSeconds * 1000);
    triggerAlarmFlashing();
    playWrongCodeAnimation();
    triggerNotification(`terminal lockout active (${cooldownSeconds}s) | outlines exposed (${revealSeconds}s)`);
  });

  socketClient.on('security_cooldown_ended', () => {
    window.securityLockoutActive = false;
    triggerNotification('terminal lockout ended. keypad ready.');
  });

  socketClient.on('corridor_realignment', (realignmentState) => {
    realignMazeCorridors(realignmentState);
  });
  
  socketClient.on('clue_collected_sync', ({ digitIndex }) => {
    collectClueLocal(digitIndex);
  });

  socketClient.on('key_picked_up_sync', ({ keyId }) => {
    const idx = keysInMaze.findIndex(k => k.id === keyId);
    if (idx !== -1) {
      const key = keysInMaze[idx];
      scene.remove(key.mesh);
      key.mesh.traverse(child => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        }
      });
      keysInMaze.splice(idx, 1);
    }
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

  socketClient.on('gate_key_inserted_sync', ({ symbol, insertedKeys, installerName }) => {
    insertedGateKeys = insertedKeys;
    triggerNotification(`🔑 [${installerName}] installed [${symbol}] into Master Gate! (${insertedGateKeys.length}/2 installed)`);
    updateGateHUD();
    if (insertedGateKeys.length >= 2) {
      showExitGate();
    }
  });

  socketClient.on('player_revived_sync', ({ targetId, medicName, revivedName }) => {
    if (currentLobby && currentLobby.players && currentLobby.players[targetId]) {
      currentLobby.players[targetId].isCaptured = false;
    }
    triggerNotification(`⚡ [${medicName}] revived Operative ${revivedName}!`);

    if (targetId === myId) {
      isCaptured = false;
      window.isSpectating = false;
      currentHP = 75;
      currentSanity = 75;
      
      const hpVal = document.getElementById('hp-value');
      const hpBar = document.getElementById('hp-bar');
      const sanityVal = document.getElementById('sanity-value');
      const sanityBar = document.getElementById('sanity-bar');
      if (hpVal) hpVal.textContent = "75 HP";
      if (hpBar) hpBar.style.width = "75%";
      if (sanityVal) sanityVal.textContent = "75%";
      if (sanityBar) sanityBar.style.width = "75%";

      const capOverlay = document.getElementById('captured-overlay');
      if (capOverlay) capOverlay.style.display = 'none';
      const hudOverlay = document.getElementById('hud-overlay');
      if (hudOverlay) hudOverlay.style.display = 'flex';

      if (!isMobileDevice) {
        (renderer && renderer.domElement || document.getElementById('canvas-container')).requestPointerLock();
      } else {
        window.mobileGameActive = true;
        const mobileCtrl = document.getElementById('mobile-controls-container');
        if (mobileCtrl) mobileCtrl.style.display = 'flex';
      }
      triggerNotification("⚡ REVIVED BY MEDIC! BACK IN THE ACTION!");
    }
  });

  socketClient.on('human_captured', ({ targetId }) => {
    if (currentLobby && currentLobby.players && currentLobby.players[targetId]) {
      currentLobby.players[targetId].isCaptured = true;
    }
    if (targetId === myId) {
      isCaptured = true;
      socketClient.emit('chat_message', { msg: `[SYSTEM]: Operative ${myId} (${myClass}) was captured by a Ghost.` });
      playGhostCaptureAnimation(() => {
        if (document.pointerLockElement) document.exitPointerLock();
        window.mobileGameActive = false;
        document.getElementById('hud-overlay').style.display = 'none';
        const mobileCtrl = document.getElementById('mobile-controls-container');
        if (mobileCtrl) mobileCtrl.style.display = 'none';
        document.getElementById('captured-overlay').style.display = 'flex';
      });
    } else if (players3D[targetId]) {
      scene.remove(players3D[targetId]);
      delete players3D[targetId];
    }
  });

  socketClient.on('ghost_mimic_clone', ({ id }) => {
    if (players3D[id]) {
      const originalPosition = players3D[id].position.clone();
      const originalRotation = players3D[id].rotation.clone();
      
      // Remove ghost mesh
      scene.remove(players3D[id]);
      players3D[id].traverse(child => {
        if (child.isMesh || child.isSprite) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
        }
      });
      
      // Spawn human mesh in its place
      const pSkinId = currentLobby && currentLobby.players[id] ? currentLobby.players[id].skinId : null;
      const pUsername = currentLobby && currentLobby.players[id] ? currentLobby.players[id].username : 'Unknown';
      const humanMesh = createHumanMeshGroup(pSkinId, pUsername);
      humanMesh.position.copy(originalPosition);
      humanMesh.rotation.copy(originalRotation);
      scene.add(humanMesh);
      players3D[id] = humanMesh;
      
      setTimeout(() => {
        if (players3D[id]) {
          const currentPos = players3D[id].position.clone();
          const currentRot = players3D[id].rotation.clone();
          scene.remove(players3D[id]);
          
          // Swap back to ghost mesh
          const ghostMesh = createGhostMeshGroup(pSkinId);
          ghostMesh.position.copy(currentPos);
          ghostMesh.rotation.copy(currentRot);
          
          // Setup thermal vision support for the recreated ghost mesh
          const thermalMat = new THREE.MeshBasicMaterial({ 
            color: 0xffffff, fog: false, depthTest: false, side: THREE.DoubleSide 
          });
          ghostMesh.traverse(c => {
            if (c.isMesh) {
              c.userData.normalMat = c.material;
              c.userData.thermalMat = thermalMat;
            } else if (c.isSprite) {
              c.userData.normalMat = c.material;
              c.userData.thermalMat = new THREE.SpriteMaterial({
                map: c.material.map,
                color: 0xffffff,
                fog: false,
                depthTest: false,
                transparent: true,
                blending: THREE.AdditiveBlending
              });
            }
          });

          scene.add(ghostMesh);
          players3D[id] = ghostMesh;
        }
      }, 15000);
    }
  });

  socketClient.on('ghost_breaker_siphon', (data) => {
    if (myTeam === 'Human' && !window.isSpectating) {
      const effectRadius = 6 * 4.5; // 6 blocks
      let applyEffect = true;
      if (data && data.position) {
        const dist = Math.hypot(camera.position.x - data.position.x, camera.position.z - data.position.z);
        if (dist > effectRadius) applyEffect = false;
      }
      
      if (applyEffect) {
        window.flashlightDisabledBySiphon = true;
        triggerNotification("Breaker Siphon! Flashlights disrupted (10s)");
        setTimeout(() => {
          window.flashlightDisabledBySiphon = false;
        }, 10000);
      }
    }
  });

  socketClient.on('ghost_sound_scramble', (data) => {
    if (myTeam === 'Human' && !window.isSpectating) {
      const effectRadius = 6 * 4.5;
      let applyEffect = true;
      if (data && data.position) {
        const dist = Math.hypot(camera.position.x - data.position.x, camera.position.z - data.position.z);
        if (dist > effectRadius) applyEffect = false;
      }

      if (applyEffect) {
        window.sensorsScrambled = true;
        triggerNotification("Signal scrambled! Sensors offline (10s)");
        setTimeout(() => {
          window.sensorsScrambled = false;
        }, 10000);
      }
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
    if (document.pointerLockElement) document.exitPointerLock();
    window.mobileGameActive = false;
    window.gameReady = false;
    isCaptured = true;

    const renderOverlay = () => {
      // Show the End Game Overlay
      const overlay = document.getElementById('end-game-overlay');
      const title = document.getElementById('end-game-title');
      const details = document.getElementById('end-game-details');

      if (overlay && title && details) {
        overlay.style.display = 'flex';
      
      const isMyWin = (myTeam === winner);

      if (isMyWin) {
        title.textContent = "VICTORY";
        title.style.color = myTeam === 'Ghost' ? "#a855f7" : "#10b981";
        title.style.textShadow = myTeam === 'Ghost' ? "0 0 20px rgba(168, 85, 247, 0.7)" : "0 0 20px rgba(16, 185, 129, 0.7)";
        const victoryMsg = myTeam === 'Ghost' ? "ALL SURVIVORS HARVESTED!" : "SURVIVORS ESCAPED!";
        details.innerHTML = `<div style="font-weight:bold; color: ${title.style.color}; margin-bottom: 1rem; font-size: 1.3rem;">${victoryMsg}</div>`;
      } else {
        title.textContent = "DEFEAT";
        title.style.color = "#ef4444";
        title.style.textShadow = "0 0 20px rgba(239, 68, 68, 0.6)";
        const defeatMsg = myTeam === 'Ghost' ? "SURVIVORS ESCAPED THE LABYRINTH!" : "ALL SURVIVORS ELIMINATED!";
        details.innerHTML = `<div style="font-weight:bold; color: #ef4444; margin-bottom: 1rem; font-size: 1.3rem;">${defeatMsg}</div>`;
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
  };

    const bindRejoinBtn = (btnId) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.onclick = () => {
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
    };

    bindRejoinBtn('end-game-lobby-btn');
    bindRejoinBtn('captured-lobby-btn');

    if (window.isEscaping) {
      setTimeout(renderOverlay, 6500);
    } else if (window.isCapturedAnimation) {
      setTimeout(renderOverlay, 3500);
    } else {
      renderOverlay();
    }
  });

  // Sync dropped items dynamically across all teammates in the lobby
  socketClient.on('item_dropped_sync', ({ id, name, position }) => {
    // Teammate dropped an item, spawn it locally
    spawnDroppedItemLocal(id, name, new THREE.Vector3(position.x, position.y, position.z));
  });

  socketClient.on('key_dropped_sync', (data) => {
    const kt = KEY_TYPES.find(k => k.label === data.typeName) || KEY_TYPES[0];
    const mesh = createKeyMeshGroup(kt.color, kt.emissive);
    mesh.position.set(data.position.x, data.position.y, data.position.z);
    scene.add(mesh);

    keysInMaze.push({
      mesh: mesh,
      symbol: data.symbol,
      typeName: data.typeName
    });
  });

  socketClient.on('item_picked_up_sync', ({ id }) => {
    // Teammate picked up an item, remove it locally
    const index = itemsInMaze.findIndex(item => item.id === id);
    if (index !== -1) {
      const itemMesh = itemsInMaze[index].mesh;
      scene.remove(itemMesh);
      if (itemMesh.geometry) itemMesh.geometry.dispose();
      if (itemMesh.material) itemMesh.material.dispose();
      itemsInMaze.splice(index, 1);
    }
  });

  socketClient.on('breaker_fixed_sync', ({ breakerId }) => {
    fixBreakerLocal(breakerId);
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

  // Calculate and draw glowing path to the source
  const startGrid = worldToGrid(camera.position.x, camera.position.z);
  const endGrid = worldToGrid(position.x, position.z);
  const path = bfsPath(startGrid.col, startGrid.row, endGrid.col, endGrid.row);
  
  // Clean up any old path
  ghostPathMeshes.forEach(m => {
    scene.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
  });
  ghostPathMeshes = [];

  // Create new path orbs
  path.forEach((pt, index) => {
    if (index === 0) return; // skip exact current block
    const sphereGeom = new THREE.SphereGeometry(0.3, 8, 8);
    const sphereMat = new THREE.MeshBasicMaterial({ 
      color: 0xff3333, // Glowing red
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const orb = new THREE.Mesh(sphereGeom, sphereMat);
    orb.position.set(pt.x, 0.5, pt.z); // Hovering at knee height
    scene.add(orb);
    ghostPathMeshes.push(orb);
  });

  const startTime = performance.now();
  const duration = 2000; // 2 seconds

  function animatePing() {
    const elapsed = performance.now() - startTime;
    const progress = elapsed / duration;

    if (progress >= 1.0) {
      scene.remove(pingMesh);
      geom.dispose();
      mat.dispose();
      
      // Clean up path
      ghostPathMeshes.forEach(orb => {
        scene.remove(orb);
        orb.geometry.dispose();
        orb.material.dispose();
      });
      ghostPathMeshes = [];
    } else {
      const scale = 1.0 + progress * 8.0;
      pingMesh.scale.set(scale, 1, scale);
      pingMesh.material.opacity = 0.8 * (1.0 - progress);
      
      // Animate path orbs
      ghostPathMeshes.forEach((orb, i) => {
        const waveOffset = i * 60; // 60ms delay per orb for sweeping effect
        if (elapsed > waveOffset) {
           orb.material.opacity = 0.8 * (1.0 - progress);
           orb.position.y = 0.5 + Math.sin((elapsed - waveOffset) * 0.01) * 0.2; // slight bob
        } else {
           orb.material.opacity = 0; // invisible until wave reaches
        }
      });
      
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

// ==========================================
// CINEMATIC ANIMATION: WRONG CODE
// ==========================================
function playWrongCodeAnimation() {
  const overlay = document.getElementById('wrong-code-overlay');
  const text = document.getElementById('wrong-code-text');
  const canvas = document.getElementById('canvas-container');
  if (!overlay || !text) return;

  overlay.style.display = 'block';
  overlay.style.background = 'transparent';
  
  // Screen shake
  let shakeCount = 0;
  const shakeInterval = setInterval(() => {
    const offX = (Math.random() - 0.5) * 18;
    const offY = (Math.random() - 0.5) * 12;
    canvas.style.transform = `translate(${offX}px, ${offY}px)`;
    shakeCount++;
    if (shakeCount > 20) {
      clearInterval(shakeInterval);
      canvas.style.transform = '';
    }
  }, 40);

  // Red flash pulse
  overlay.style.background = 'rgba(255, 0, 0, 0.25)';
  setTimeout(() => { overlay.style.background = 'rgba(255, 0, 0, 0.15)'; }, 150);
  setTimeout(() => { overlay.style.background = 'rgba(255, 0, 0, 0.25)'; }, 300);
  setTimeout(() => { overlay.style.background = 'rgba(255, 0, 0, 0.1)'; }, 500);

  // ACCESS DENIED text slam in
  text.style.transition = 'none';
  text.style.opacity = '0';
  text.style.transform = 'translate(-50%, -50%) scale(2.5)';
  
  requestAnimationFrame(() => {
    text.style.transition = 'opacity 0.2s ease, transform 0.3s cubic-bezier(0.17, 0.67, 0.21, 1.2)';
    text.style.opacity = '1';
    text.style.transform = 'translate(-50%, -50%) scale(1)';
  });

  // Fade out after 1.5s
  setTimeout(() => {
    text.style.transition = 'opacity 0.8s ease';
    text.style.opacity = '0';
  }, 1500);

  setTimeout(() => {
    overlay.style.display = 'none';
    overlay.style.background = 'transparent';
    text.style.opacity = '0';
  }, 2500);
}

// ==========================================
// CINEMATIC ANIMATION: ESCAPE / VICTORY
// ==========================================
let gateBlockerRef = null; // Will be set during maze building

function playEscapeCinematic(callback) {
  const overlay = document.getElementById('escape-cinematic-overlay');
  const lbTop = document.getElementById('escape-letterbox-top');
  const lbBottom = document.getElementById('escape-letterbox-bottom');
  const flash = document.getElementById('escape-flash');
  const escText = document.getElementById('escape-text');
  if (!overlay) { if (callback) callback(); return; }

  overlay.style.display = 'block';

  // Phase 1: Letterbox bars slide in (cinematic framing)
  setTimeout(() => {
    lbTop.style.top = '0';
    lbBottom.style.bottom = '0';
  }, 100);

  // Phase 2: Gate opens — slide the door mesh up over 2 seconds
  if (gateMeshRef) {
    const startY = gateMeshRef.position.y;
    const targetY = startY + 5;
    const startTime = performance.now();
    const duration = 2000;
    
    const animateGate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      gateMeshRef.position.y = startY + (targetY - startY) * eased;
      
      // Rumble effect during opening
      if (progress < 1) {
        const rumble = (1 - progress) * 3;
        const rX = (Math.random() - 0.5) * rumble;
        const rY = (Math.random() - 0.5) * rumble;
        document.getElementById('canvas-container').style.transform = `translate(${rX}px, ${rY}px)`;
        requestAnimationFrame(animateGate);
      } else {
        document.getElementById('canvas-container').style.transform = '';
      }
    };
    requestAnimationFrame(animateGate);

    // Remove the blocker so the player can conceptually walk through
    if (gateBlockerRef) {
      setTimeout(() => {
        const idx = walls.indexOf(gateBlockerRef);
        if (idx !== -1) walls.splice(idx, 1);
        scene.remove(gateBlockerRef);
      }, 1500);
    }
  }

  // Phase 3: Camera auto-walk forward directly through the vault gate
  setTimeout(() => {
    const walkDuration = 1500;
    const walkStart = performance.now();
    const startX = camera.position.x;
    const startZ = camera.position.z;
    
    // Direction from camera position straight through the gate
    let dirX = gateCoordinates.x - startX;
    let dirZ = gateCoordinates.z - startZ;
    const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (len > 0.001) {
      dirX /= len;
      dirZ /= len;
    } else {
      dirX = 0;
      dirZ = -1;
    }

    // Pass through the gate coordinates and continue 6 units beyond the doorway
    const walkTargetX = gateCoordinates.x + dirX * 6;
    const walkTargetZ = gateCoordinates.z + dirZ * 6;
    
    const walkAnim = (now) => {
      const elapsed = now - walkStart;
      const progress = Math.min(elapsed / walkDuration, 1);
      const eased = progress * progress; // Ease in
      camera.position.x = startX + (walkTargetX - startX) * eased;
      camera.position.z = startZ + (walkTargetZ - startZ) * eased;
      camera.lookAt(walkTargetX, 1.6, walkTargetZ);
      if (progress < 1) requestAnimationFrame(walkAnim);
    };
    requestAnimationFrame(walkAnim);
  }, 2500);

  // Phase 4: Bright white flash at 3.5s
  setTimeout(() => {
    flash.style.opacity = '1';
  }, 3500);

  // Phase 5: "ESCAPED" text appears at 4s
  setTimeout(() => {
    escText.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
    escText.style.opacity = '1';
    escText.style.transform = 'translate(-50%, -50%) scale(1)';
    flash.style.transition = 'opacity 1.5s ease';
    flash.style.opacity = '0.3';
  }, 4000);

  // Phase 6: Clean up and show end screen at 6s
  setTimeout(() => {
    overlay.style.display = 'none';
    lbTop.style.top = '-15%';
    lbBottom.style.bottom = '-15%';
    flash.style.opacity = '0';
    escText.style.opacity = '0';
    if (callback) callback();
  }, 6000);
}

// ==========================================
// CINEMATIC ANIMATION: GHOST CAPTURE
// ==========================================
function playGhostCaptureAnimation(callback) {
  window.isCapturedAnimation = true;
  const overlay = document.getElementById('ghost-capture-overlay');
  const vignette = document.getElementById('ghost-capture-vignette');
  const captureText = document.getElementById('ghost-capture-text');
  const staticEl = document.getElementById('ghost-capture-static');
  const canvas = document.getElementById('canvas-container');
  if (!overlay) { if (callback) callback(); return; }

  overlay.style.display = 'block';

  // Find closest ghost to create pull effect
  let closestGhost = null;
  let closestDist = Infinity;
  ghosts3D.forEach(g => {
    const d = camera.position.distanceTo(g.position);
    if (d < closestDist) { closestDist = d; closestGhost = g; }
  });

  // Phase 1: Purple vignette closes in (0 - 1.5s)
  vignette.style.background = 'radial-gradient(ellipse at center, transparent 30%, rgba(80,0,120,0.7) 100%)';
  
  // TV static flickers in
  staticEl.style.transition = 'opacity 1s ease';
  staticEl.style.opacity = '0.6';

  // Camera shake + slight pull toward ghost
  const shakeStart = performance.now();
  const shakeDur = 2000;
  const origPos = camera.position.clone();
  
  const shakeAnim = (now) => {
    const elapsed = now - shakeStart;
    const progress = Math.min(elapsed / shakeDur, 1);
    
    // Increasing shake intensity
    const intensity = progress * 8;
    const sX = (Math.random() - 0.5) * intensity;
    const sY = (Math.random() - 0.5) * intensity;
    canvas.style.transform = `translate(${sX}px, ${sY}px)`;
    
    // Slight camera pull toward ghost
    if (closestGhost && progress < 0.8) {
      const pullStrength = progress * 0.02;
      const dir = new THREE.Vector3().subVectors(closestGhost.position, camera.position).normalize();
      camera.position.x += dir.x * pullStrength;
      camera.position.z += dir.z * pullStrength;
      // Slowly rotate camera to face ghost
      const targetAngle = Math.atan2(
        closestGhost.position.x - camera.position.x,
        closestGhost.position.z - camera.position.z
      );
      camera.rotation.y += (targetAngle - camera.rotation.y) * 0.02;
    }
    
    if (progress < 1) requestAnimationFrame(shakeAnim);
    else canvas.style.transform = '';
  };
  requestAnimationFrame(shakeAnim);

  // Phase 2: Text appears at 1.2s
  const captureMessages = [
    "THE VOID CLAIMS YOU",
    "YOU CANNOT ESCAPE",
    "DRAGGED INTO DARKNESS",
    "CONSUMED BY SHADOW"
  ];
  const msg = captureMessages[Math.floor(Math.random() * captureMessages.length)];
  
  setTimeout(() => {
    captureText.textContent = msg;
    captureText.style.transition = 'opacity 0.5s ease';
    captureText.style.opacity = '1';
  }, 1200);

  // Phase 3: Full vignette closes in + screen goes dark
  setTimeout(() => {
    vignette.style.background = 'radial-gradient(ellipse at center, rgba(40,0,60,0.5) 0%, rgba(0,0,0,0.95) 70%)';
    captureText.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    captureText.style.transform = 'translate(-50%, -50%) scale(1.3)';
  }, 2000);

  // Phase 4: Full blackout and cleanup
  setTimeout(() => {
    overlay.style.display = 'none';
    vignette.style.background = 'radial-gradient(ellipse at center, transparent 30%, rgba(80,0,120,0.0) 100%)';
    captureText.style.opacity = '0';
    captureText.style.transform = 'translate(-50%, -50%) scale(1)';
    staticEl.style.opacity = '0';
    if (callback) callback();
  }, 3000);
}

function createHumanMeshGroup(skinId, username) {
  const group = new THREE.Group();
  
  if (skinId) {
    const texPath = skinId === 'skin_cyborg' ? '/assets/skin_neon_cyborg.jpg' : '/assets/skin_shadow_ghost.jpg';
    const spriteMat = new THREE.SpriteMaterial({ 
      map: new THREE.TextureLoader().load(texPath), 
      color: 0xffffff,
      fog: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.2, 1.2, 1);
    sprite.position.y = 0.8;
    group.add(sprite);
  } else if (preloadedHumanModel) {
    const clone = SkeletonUtils.clone(preloadedHumanModel);
    clone.rotation.y = Math.PI; // Fix reversed facing
    group.add(clone);
  } else {
    const spriteMat = new THREE.SpriteMaterial({ 
      map: new THREE.TextureLoader().load('/assets/human_sprite.png'), 
      color: 0xffffff,
      fog: true,
      transparent: true,
      blending: THREE.AdditiveBlending, // Use additive to hide the black background
      depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.5, 2.8, 1);
    sprite.position.y = 1.4;
    group.add(sprite);
  }

  if (username) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // Background for legibility
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Text
    ctx.font = 'bold 36px monospace';
    ctx.fillStyle = '#10b981'; // Cyber green
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(username, canvas.width/2, canvas.height/2 + 2);
    
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false });
    const textSprite = new THREE.Sprite(mat);
    textSprite.scale.set(1.5, 0.375, 1);
    textSprite.position.y = 2.8; // Place it well above the head
    
    // We add it to the group, but ThreeJS sprites always face the camera automatically
    group.add(textSprite);
  }


  // Keep userData compatible with the animation loop
  group.userData = {
    type: 'Human',
    walkCycle: 0,
    leftLeg: { rotation: {x:0} }, rightLeg: { rotation: {x:0} }, 
    leftArm: { rotation: {x:0} }, rightArm: { rotation: {x:0} },
    lastPosition: new THREE.Vector3()
  };
  
  return group;
}

function createGhostMeshGroup(skinId) {
  const group = new THREE.Group();
  
  if (skinId) {
    const texPath = skinId === 'skin_cyborg' ? '/assets/skin_neon_cyborg.jpg' : '/assets/skin_shadow_ghost.jpg';
    const spriteMat = new THREE.SpriteMaterial({ 
      map: new THREE.TextureLoader().load(texPath), 
      color: 0xffffff,
      fog: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.2, 1.2, 1);
    sprite.position.y = 0.8;
    group.add(sprite);
  } else if (preloadedGhostModel) {
    const clone = SkeletonUtils.clone(preloadedGhostModel);
    const anchorGroup = new THREE.Group();
    anchorGroup.add(clone);
    group.add(anchorGroup);
  } else {
    // Fallback to sprite
    const spriteMat = new THREE.SpriteMaterial({ 
      map: new THREE.TextureLoader().load('/assets/ghost_sprite.png'), 
      color: 0xffdddd, // slightly tint red
      fog: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending, // Hides black background, makes ghost glow
      depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(3.0, 4.0, 1); // Massive imposing ghost
    sprite.position.y = 2.0;
    group.add(sprite);
  }

  // Eerie purple aura light — bright enough to notice
  const aura = new THREE.PointLight(0x6b21a8, 3.0, 12);
  aura.position.y = 2.0;
  group.add(aura);

  // Secondary dim red under-light
  const underLight = new THREE.PointLight(0x7f1d1d, 1.2, 6);
  underLight.position.y = 0.5;
  group.add(underLight);

  group.userData = {
    type: 'Ghost',
    bobAccumulator: Math.random() * 10,
    flickerTimer: Math.random() * 100,
    lastPosition: new THREE.Vector3()
  };
  
  return group;
}

function spawnGhostAIs(count) {
  ghosts3D.forEach(g => scene.remove(g));
  ghosts3D = [];

  for (let i = 0; i < count; i++) {
    const ghostGroup = createGhostMeshGroup();
    
    // Thermal materials for X-Ray
    const meshThermalMat = new THREE.MeshBasicMaterial({ 
      color: 0xffffff, fog: false, depthTest: false, side: THREE.DoubleSide 
    });
    ghostGroup.traverse(c => {
      if (c.isMesh) {
        c.userData.normalMat = c.material;
        c.userData.thermalMat = meshThermalMat;
      } else if (c.isSprite) {
        c.userData.normalMat = c.material;
        c.userData.thermalMat = new THREE.SpriteMaterial({
          map: c.material.map,
          color: 0xffffff,
          fog: false,
          depthTest: false,
          transparent: true,
          blending: THREE.AdditiveBlending
        });
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

// ==========================================
// MINIMAP LOGIC
// ==========================================
let minimapSetupDone = false;
function setupMinimap() {
  if (minimapSetupDone) return;
  const wrapper = document.getElementById('minimap-wrapper');
  const canvas = document.getElementById('minimap-canvas');
  const controls = document.getElementById('minimap-expanded-controls');
  const btnClose = document.getElementById('minimap-btn-close');
  const btnClear = document.getElementById('minimap-btn-clear');

  if (!wrapper || !canvas) return;
  minimapSetupDone = true;

  // Toggle map expansion
  wrapper.addEventListener('click', (e) => {
    // Ignore clicks on buttons inside the wrapper
    if (e.target.tagName === 'BUTTON') return;
    
    if (!isMinimapExpanded) {
      isMinimapExpanded = true;
      wrapper.classList.add('expanded');
      controls.style.display = 'block';
      if (document.pointerLockElement) document.exitPointerLock();
      drawMinimap(); // Redraw immediately
    } else {
      // If clicking directly on the canvas while expanded, drop a mark
      if (e.target.id === 'minimap-canvas') {
        const rect = canvas.getBoundingClientRect();
        // Since canvas CSS width is 400px but internal is 200px
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        const px = (e.clientX - rect.left) * scaleX;
        const py = (e.clientY - rect.top) * scaleY;
        
        // Map canvas coordinates to grid
        const mazeSize = 35;
        const cellSize = canvas.width / mazeSize;
        const c = Math.floor(px / cellSize);
        const r = Math.floor(py / cellSize);
        
        if (c >= 0 && c < mazeSize && r >= 0 && r < mazeSize) {
          mapMarks.push({r, c});
          drawMinimap();
        }
      }
    }
  });

  btnClose.addEventListener('click', (e) => {
    e.stopPropagation(); // prevent wrapper click
    isMinimapExpanded = false;
    wrapper.classList.remove('expanded');
    controls.style.display = 'none';
    if (!isMobileDevice) {
      (renderer && renderer.domElement || document.getElementById('canvas-container')).requestPointerLock();
    }
  });

  btnClear.addEventListener('click', (e) => {
    e.stopPropagation();
    mapMarks = [];
    drawMinimap();
  });
}

function updateEnvironmentLighting() {
  if (window.isSpectating) {
    if (ambientLight) {
      ambientLight.color.setHex(0xffffff);
      ambientLight.intensity = 4.0;
    }
    if (scene) {
      scene.fog = null; // Completely remove fog
      scene.background = new THREE.Color(0x1e293b); // Clean slate sky background
      
      if (!spectatorSunLight) {
        spectatorSunLight = new THREE.DirectionalLight(0xffffff, 3.5);
        spectatorSunLight.position.set(0, 60, 0);
        spectatorSunLight.target.position.set(0, 0, 0);
        scene.add(spectatorSunLight);
        scene.add(spectatorSunLight.target);
      }
      if (!spectatorHemiLight) {
        spectatorHemiLight = new THREE.HemisphereLight(0xffffff, 0x64748b, 3.0);
        scene.add(spectatorHemiLight);
      }
      if (!spectatorCamLight && camera) {
        spectatorCamLight = new THREE.PointLight(0xffffff, 300, 200);
        camera.add(spectatorCamLight);
      }
    }
    return;
  }

  let mult = getVisionMultiplier();
  
  if (myTeam === 'Ghost') {
    ambientLight.intensity = 2.0 * mult;
    ambientLight.color.setHex(0x444455);
  } else {
    // Dramatically scale up ambient light if breakers are fixed
    if (fixedBreakersCount === 1) {
      ambientLight.color.setHex(0x333344);
      mult *= 1.8;
    } else if (fixedBreakersCount === 2) {
      ambientLight.color.setHex(0x555566);
      mult *= 2.5;
    } else if (fixedBreakersCount >= 3) {
      ambientLight.color.setHex(0x888899);
      mult *= 3.5;
    } else {
      ambientLight.color.setHex(0x222233);
    }

    if (!isMobileDevice) {
      ambientLight.intensity = 1.5 * mult;
    } else {
      ambientLight.intensity = 2.0 * mult;
    }
    
    // Boost flashlight range and width slightly based on original mult
    const baseMult = getVisionMultiplier();
    if (flashLight) {
      flashLight.distance = 45 * baseMult;
      flashLight.angle = (Math.PI / 3) * baseMult;
    }
  }
}

function fixBreakerLocal(breakerId) {
  const breaker = circuitBreakers.find(b => b.id === breakerId);
  if (!breaker || breaker.isFixed) return;

  breaker.isFixed = true;
  breaker.mesh.material.color.setHex(0x10b981); // Turn green
  fixedBreakersCount++;
  
  updateEnvironmentLighting();

  const breakersInfo = document.getElementById('hud-breakers-info');
  if (breakersInfo) {
    breakersInfo.textContent = `POWER: ${fixedBreakersCount} / ${totalBreakersRequired} BREAKERS REPAIRED`;
    if (fixedBreakersCount >= totalBreakersRequired) {
      breakersInfo.style.color = '#10b981';
      breakersInfo.textContent = 'POWER: FULLY RESTORED';
    }
  }

  triggerNotification(`circuit breaker repaired! (${fixedBreakersCount}/${totalBreakersRequired})`);
  checkWinCondition();
}

function updateMinimapVisibility() {
  if (!mazeLayout || mazeLayout.length === 0) return;
  const mazeSize = 35;
  const blockSize = 4.5;
  
  // Calculate current grid cell
  const px = camera.position.x;
  const pz = camera.position.z;
  const c = Math.floor((px / blockSize) + (mazeSize / 2));
  const r = Math.floor((pz / blockSize) + (mazeSize / 2));
  
  // Mark cells using a 2-step flood fill to prevent revealing through walls
  const queue = [{c, r, dist: 0}];
  const currentVisible = new Set();
  currentVisible.add(`${r},${c}`);
  
  while (queue.length > 0) {
    const curr = queue.shift();
    if (curr.dist >= 2) continue; // max 2 steps for radius ~5x5
    
    const neighbors = [
      {dc: 0, dr: -1}, {dc: 0, dr: 1}, {dc: -1, dr: 0}, {dc: 1, dr: 0},
      {dc: -1, dr: -1}, {dc: 1, dr: -1}, {dc: -1, dr: 1}, {dc: 1, dr: 1} // Diagonals
    ];
    
    for (const n of neighbors) {
      const nc = curr.c + n.dc;
      const nr = curr.r + n.dr;
      
      if (nr < 0 || nr >= mazeSize || nc < 0 || nc >= mazeSize) continue;
      
      const key = `${nr},${nc}`;
      if (currentVisible.has(key)) continue;
      
      // If current cell is a wall, we cannot see PAST it
      if (curr.dist > 0 && mazeLayout[curr.r][curr.c] !== 0) continue;
      
      // Prevent diagonal sight through two adjacent corner walls
      if (Math.abs(n.dc) === 1 && Math.abs(n.dr) === 1) {
        if (mazeLayout[curr.r][nc] === 1 && mazeLayout[nr][curr.c] === 1) continue; 
      }
      
      currentVisible.add(key);
      queue.push({c: nc, r: nr, dist: curr.dist + 1});
    }
  }

  currentVisible.forEach(key => visitedCells.add(key));
}

function drawMinimap() {
  const canvas = document.getElementById('minimap-canvas');
  if (!canvas || !mazeLayout || mazeLayout.length === 0) return;
  const ctx = canvas.getContext('2d');
  
  const mazeSize = 35;
  const cellSize = canvas.width / mazeSize;
  
  // Clear canvas
  ctx.fillStyle = myTeam === 'Ghost' ? '#0a0512' : '#050a10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw cells (Ghosts see entire realigned maze, Humans see explored cells)
  for (let r = 0; r < mazeSize; r++) {
    for (let c = 0; c < mazeSize; c++) {
      if (myTeam === 'Ghost' || visitedCells.has(`${r},${c}`)) {
        const type = mazeLayout[r][c];
        if (type === 1) {
          // Wall
          ctx.fillStyle = myTeam === 'Ghost' ? '#1f1330' : '#1e293b'; 
          ctx.fillRect(c * cellSize, r * cellSize, cellSize + 0.5, cellSize + 0.5);
        } else {
          // Floor
          ctx.fillStyle = myTeam === 'Ghost' ? '#4c1d95' : '#64748b';
          ctx.fillRect(c * cellSize, r * cellSize, cellSize + 0.5, cellSize + 0.5);
        }
      }
    }
  }

  // Draw Marks
  ctx.fillStyle = '#0ea5e9'; // bright blue
  for (const mark of mapMarks) {
    ctx.beginPath();
    ctx.arc((mark.c + 0.5) * cellSize, (mark.r + 0.5) * cellSize, cellSize * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  const blockSize = 4.5;

  // Draw AI Ghosts on minimap if player is Ghost
  if (myTeam === 'Ghost' && typeof ghosts3D !== 'undefined') {
    ghosts3D.forEach(g => {
      const gc = (g.position.x / blockSize) + (mazeSize / 2);
      const gr = (g.position.z / blockSize) + (mazeSize / 2);
      ctx.save();
      ctx.translate(gc * cellSize, gr * cellSize);
      ctx.fillStyle = '#c084fc'; // Purple AI Ghost marker
      ctx.beginPath();
      ctx.arc(0, 0, cellSize * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  // Draw Teammates
  Object.values(players3D).forEach(p => {
    if (p.userData && p.userData.type === myTeam) {
      const tc = (p.position.x / blockSize) + (mazeSize / 2);
      const tr = (p.position.z / blockSize) + (mazeSize / 2);
      
      ctx.save();
      ctx.translate(tc * cellSize, tr * cellSize);
      ctx.fillStyle = myTeam === 'Ghost' ? '#a855f7' : '#3b82f6'; // Ghost purple / Human blue
      ctx.beginPath();
      ctx.arc(0, 0, cellSize * 0.45, 0, Math.PI * 2);
      ctx.fill();
      
      // Outline
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  });

  // Draw Player Marker (Local)
  const pc = (camera.position.x / blockSize) + (mazeSize / 2);
  const pr = (camera.position.z / blockSize) + (mazeSize / 2);
  
  ctx.save();
  ctx.translate(pc * cellSize, pr * cellSize);
  
  // Three.js camera.rotation.y is positive when turning left (counter-clockwise in top-down view)
  // Canvas rotate() is clockwise. So we use negative to match.
  ctx.rotate(-camera.rotation.y); 
  
  ctx.fillStyle = myTeam === 'Ghost' ? '#ec4899' : '#10b981'; // Pink/Magenta for Ghost, Green for Human
  ctx.beginPath();
  // Draw an arrow pointing UP (-Z is Up on minimap)
  ctx.moveTo(0, -cellSize * 0.8);
  ctx.lineTo(cellSize * 0.6, cellSize * 0.6);
  ctx.lineTo(-cellSize * 0.6, cellSize * 0.6);
  ctx.closePath();
  ctx.fill();
  
  ctx.restore();
}

// 3D Game Loop rendering
let animationFrameId = null;
let networkTimer = 0;
function animate() {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
  animationFrameId = requestAnimationFrame(animate);

  if (localPlayerVisual) {
    localPlayerVisual.rotation.x = -camera.rotation.x;
  }
  
  if (activeViewCamera) {
    const mode = viewModes[currentViewIndex];
    if (mode === 'fps') {
      activeViewCamera.position.copy(camera.position);
      activeViewCamera.quaternion.copy(camera.quaternion);
    } else {
      const offset = new THREE.Vector3();
      const euler = new THREE.Euler(0, camera.rotation.y, 0, 'YXZ');
      
      if (mode === 'tps_shoulder') {
        offset.set(0.8, 0.5, 3);
        activeViewCamera.rotation.set(camera.rotation.x, camera.rotation.y, 0, 'YXZ');
      } else if (mode === 'tps_far') {
        offset.set(0, 1.5, 6);
        activeViewCamera.rotation.set(camera.rotation.x - 0.1, camera.rotation.y, 0, 'YXZ');
      } else if (mode === 'top_down') {
        offset.set(0, 15, 0);
        activeViewCamera.rotation.set(-Math.PI / 2, camera.rotation.y, 0, 'YXZ');
      }
      
      offset.applyEuler(euler);
      activeViewCamera.position.copy(camera.position).add(offset);
    }
  }

  const time = performance.now();
  const delta = (time - prevTime) / 1000;
  prevTime = time;

  const isActive = isMobileDevice ? (window.mobileGameActive && (!isCaptured || window.isSpectating)) : (Boolean(document.pointerLockElement) && (!isCaptured || window.isSpectating));
  if (isActive) {
    // 1. Process movement physics with friction
    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;

    direction.z = Number(moveForward) - Number(moveBackward);
    direction.x = Number(moveRight) - Number(moveLeft);
    direction.normalize(); // Ensure consistent speed

    let speed = myTeam === 'Ghost' ? 55.0 : 90.0;
    if (myTeam === 'Ghost' && myClass === 'Juggernaut') speed = 75.0;
    
    if (window.isSpectating) speed = 250.0; // Fast roaming

    // --- Sprint logic (humans only) ---
    if (myTeam === 'Human') {
      const moving = moveForward || moveBackward || moveLeft || moveRight;
      if (isSprinting && moving && stamina > 0) {
        speed *= 1.55; // sprint multiplier
        stamina = Math.max(0, stamina - STAMINA_DRAIN_RATE * delta);
        if (stamina <= 0) {
          isSprinting = false;
          const sb = document.getElementById('btn-mobile-sprint');
          if (sb) sb.classList.remove('sprinting');
        }
      } else {
        if (isSprinting) {
          isSprinting = false;
          const sb = document.getElementById('btn-mobile-sprint');
          if (sb) sb.classList.remove('sprinting');
        }
        stamina = Math.min(100, stamina + STAMINA_REGEN_RATE * delta);
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
              if (trap.geometry) trap.geometry.dispose();
              if (trap.material) trap.material.dispose();
              const idx = saltTraps.indexOf(trap);
              if (idx > -1) saltTraps.splice(idx, 1);
            }, 3000);
          }
        }
      }
      if (nearSalt) {
        speed *= 0.2; // 80% slow down, matching AI slow down ratio
      }

      // Breaker Remote freeze for human Ghost players
      if (window.ghostsFrozen) {
        speed = 0;
        velocity.set(0, 0, 0);
      }
    }

    if (window.isSpectating) {
      // 6-DOF Free-Cam Spectator Flight
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward); // Unit vector in 3D look direction

      const right = new THREE.Vector3();
      right.crossVectors(forward, camera.up).normalize();

      if (moveForward || moveBackward) {
        camera.position.addScaledVector(forward, direction.z * (speed / 10.0) * delta);
      }
      if (moveLeft || moveRight) {
        camera.position.addScaledVector(right, direction.x * (speed / 10.0) * delta);
      }
    } else {
      if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
      if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;

      camera.translateX(-velocity.x * delta);
      camera.translateZ(velocity.z * delta);
      camera.position.y = 1.6; // Lock height if not spectating
    }

    // Robust AABB Wall collision checking
    if (!window.isSpectating) {
      const playerRadius = 0.8; // Radius to prevent near-clipping
      const wallHalfSize = 4.5 / 2;
      
      // Run two iterations to smoothly resolve corner pinches
      for (let iter = 0; iter < 2; iter++) {
        walls.forEach(wall => {
          if (wall.position.y < 0) return; // Skip walls shifted below floor level (open sliding gates)
          
          const px = camera.position.x;
          const pz = camera.position.z;
          const wx = wall.position.x;
          const wz = wall.position.z;
          
          const hx = (wall.userData && wall.userData.halfSizeX) ? wall.userData.halfSizeX : wallHalfSize;
          const hz = (wall.userData && wall.userData.halfSizeZ) ? wall.userData.halfSizeZ : wallHalfSize;
          
          const overlapX = (hx + playerRadius) - Math.abs(px - wx);
          const overlapZ = (hz + playerRadius) - Math.abs(pz - wz);
          
          if (overlapX > 0 && overlapZ > 0) {
            if (overlapX < overlapZ) {
              camera.position.x += (px > wx ? overlapX : -overlapX);
            } else {
              camera.position.z += (pz > wz ? overlapZ : -overlapZ);
            }
          }
        });
      }
    }

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
          const fogDensity = myTeam === 'Human' ? Math.max(0.005, 0.018 - (fixedBreakersCount * 0.004)) : 0.015;
          if (!scene.fog) scene.fog = new THREE.FogExp2(0x000000, fogDensity);
          scene.fog.color.setHex(0x000000);
          scene.fog.density = fogDensity;
        }
        if (flashLight) flashLight.intensity = 200;
        triggerNotification("invisibility ended. sensors active.");
      }
    } 
    
    // Process Thermal Camera regardless of panic (skip if spectating)
    if (window.isSpectating) {
      if (scene && scene.fog) scene.fog = null;
      if (ambientLight) {
        ambientLight.color.setHex(0xffffff);
        ambientLight.intensity = 4.0;
      }
    } else if (myTeam === 'Human') {
      // Thermal Camera passive effect
      if (inventory[activeSlot] === "Thermal Camera") {
        if (!scene.fog) scene.fog = new THREE.FogExp2(0x330000, 0.015);
        scene.fog.color.setHex(0x330000);
        scene.fog.density = 0.015; // Red thermal vision

        // Make AI ghosts bright and glowing (red heat signature)
        ghosts3D.forEach(g => {
          g.traverse(c => {
            if ((c.isMesh || c.isSprite) && c.userData.thermalMat && c.material !== c.userData.thermalMat) {
              c.material = c.userData.thermalMat;
              c.renderOrder = 999;
            }
          });
        });
        // Make network players (Ghosts in red, Teammates in cyan) visible through walls
        Object.values(players3D).forEach(p => {
          p.traverse(c => {
            if ((c.isMesh || c.isSprite) && c.userData.thermalMat && c.material !== c.userData.thermalMat) {
              c.material = c.userData.thermalMat;
              c.renderOrder = 999;
            }
          });
        });
      } else {
        const fogDensity = Math.max(0.005, 0.018 - (fixedBreakersCount * 0.004));
        if (!scene.fog) scene.fog = new THREE.FogExp2(0x000000, fogDensity);
        scene.fog.color.setHex(0x000000);
        scene.fog.density = fogDensity;

        // Disable X-Ray vision for AI ghosts
        ghosts3D.forEach(g => {
          g.traverse(c => {
            if ((c.isMesh || c.isSprite) && c.userData.normalMat && c.material !== c.userData.normalMat) {
              c.material = c.userData.normalMat;
              c.renderOrder = 0;
            }
          });
        });
        // Disable X-Ray vision for network players
        Object.values(players3D).forEach(p => {
          p.traverse(c => {
            if ((c.isMesh || c.isSprite) && c.userData.normalMat && c.material !== c.userData.normalMat) {
              c.material = c.userData.normalMat;
              c.renderOrder = 0;
            }
          });
        });
      }
    }

    // Helper function to apply damage if human is near a ghost
    const applyGhostDamageToHuman = (ghostPos) => {
      if (window.isSpectating) return;
      const distToPlayer = ghostPos.distanceTo(new THREE.Vector3(camera.position.x, ghostPos.y, camera.position.z));
      if (distToPlayer < 1.5 && myTeam === 'Human' && !isPanicked) {
        currentHP = Math.max(0, currentHP - delta * 45);
        document.getElementById('hp-value').textContent = `${Math.ceil(currentHP)} HP`;
        document.getElementById('hp-bar').style.width = `${currentHP}%`;
        
        if (currentHP <= 0 && !isCaptured) {
          isCaptured = true;
          
          if (socketClient) {
            socketClient.emit('chat_message', { msg: `[SYSTEM]: Operative ${myId} (${myClass}) has been captured by the void.` });
            socketClient.emit('capture_human', { targetId: myId }); // Tell server we died!

            // Drop all items and keys
            inventory.forEach(itemName => {
              if (itemName && itemName !== '') {
                socketClient.emit('item_dropped', {
                  id: 'item_' + seededRandom().toString(36).substr(2, 9),
                  name: itemName,
                  position: { x: camera.position.x, y: 1.6, z: camera.position.z }
                });
              }
            });
            carriedKeys.forEach(key => {
              socketClient.emit('key_dropped', {
                typeName: key.typeName,
                symbol: key.symbol,
                position: { x: camera.position.x, y: 1.6, z: camera.position.z }
              });
            });
            inventory = [];
            carriedKeys = [];
            renderHUDInventory();
          }

          playGhostCaptureAnimation(() => {
            if (document.pointerLockElement) document.exitPointerLock();
            window.mobileGameActive = false;
            document.getElementById('hud-overlay').style.display = 'none';
            const mobileCtrl = document.getElementById('mobile-controls-container');
            if (mobileCtrl) mobileCtrl.style.display = 'none';
            document.getElementById('captured-overlay').style.display = 'flex';
          });
        }
      }
    };

    // Helper function to check chalk decals for a given ghost position
    const checkChalkDecals = (ghostPos) => {
      for (let i = chalkDecals.length - 1; i >= 0; i--) {
        const decal = chalkDecals[i];
        if (ghostPos.distanceTo(decal.position) < 2.5) {
          if (!decal.userData || !decal.userData.triggered) {
            decal.userData = decal.userData || {};
            decal.userData.triggered = true;
            if (myTeam === 'Human') {
              triggerNotification("Ghost detected stepping on UV Chalk!");
            }
            // Flash red to indicate detection, then fade away
            decal.material.color.setHex(0xff3333);
            setTimeout(() => {
              scene.remove(decal);
              if (decal.geometry) decal.geometry.dispose();
              if (decal.material) decal.material.dispose();
              const idx = chalkDecals.indexOf(decal);
              if (idx > -1) chalkDecals.splice(idx, 1);
            }, 3000);
          }
        }
      }
    };

    // Damage check against network Ghost players
    Object.values(players3D).forEach(p => {
      if (p.userData && p.userData.type === 'Ghost') {
        applyGhostDamageToHuman(p.position);
        checkChalkDecals(p.position);
      }
    });

    // 4. Update AI Bots pathing behaviors toward nearest human
    ghosts3D.forEach((ghost, idx) => {
      // Breaker Remote freezes all ghost movement
      if (window.ghostsFrozen) return;

      // Find nearest human
      let nearestHumanPos = null;
      let minDist = Infinity;
      
      if (myTeam === 'Human' && !isPanicked && !isCaptured) {
         const d = ghost.position.distanceTo(camera.position);
         if (d < minDist) { minDist = d; nearestHumanPos = new THREE.Vector3(camera.position.x, ghost.position.y, camera.position.z); }
      }
      Object.values(players3D).forEach(p => {
         if (p.userData && p.userData.type === 'Human' && !p.userData.isCaptured && !p.userData.isPanicked) {
            const d = ghost.position.distanceTo(p.position);
            if (d < minDist) { minDist = d; nearestHumanPos = new THREE.Vector3(p.position.x, ghost.position.y, p.position.z); }
         }
      });

      const distToPlayer = minDist !== Infinity ? minDist : 9999;
      const targetPos = nearestHumanPos;

      // Damage check uses actual distance to PLAYER (only damages humans)
      applyGhostDamageToHuman(ghost.position);
      checkChalkDecals(ghost.position);

      // Check salt traps (triggering & consumption)
      let moveSpeed = (ghost.userData.ghostClass === 'Juggernaut') ? 6.5 : 4.0;
      if (ghost.userData.speedBoostTimer && ghost.userData.speedBoostTimer > 0) {
        ghost.userData.speedBoostTimer -= delta;
        moveSpeed = 8.5;
      }
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
              if (trap.geometry) trap.geometry.dispose();
              if (trap.material) trap.material.dispose();
              const idx = saltTraps.indexOf(trap);
              if (idx > -1) saltTraps.splice(idx, 1);
            }, 3000);
          }
        }
      }

      // AI State Machine Initialization
      if (!ghost.userData.aiState) {
        ghost.userData.aiState = 'WANDER';
        ghost.userData.targetGrid = null;
        ghost.userData.loseSightTimer = 0;
        ghost.userData.lastSoundTime = 0;
        ghost.userData.abilityCooldown = 15.0 + Math.random() * 10.0;
      }

      // Check Line of Sight (LOS) ONLY if there is an active Human
      let canSeePlayer = false;
      if (targetPos && distToPlayer < 13.5) { // 3 blocks max sight range
        const rayOrigin = new THREE.Vector3(ghost.position.x, 2.0, ghost.position.z);
        const directionToPlayer = new THREE.Vector3().subVectors(targetPos, rayOrigin).normalize();
        const raycaster = new THREE.Raycaster(rayOrigin, directionToPlayer, 0, 15);
        const intersects = raycaster.intersectObjects(walls);
        if (intersects.length === 0 || intersects[0].distance > distToPlayer) {
          canSeePlayer = true;
        }
      }

      // State Transitions
      if (canSeePlayer && targetPos) {
        ghost.userData.aiState = 'CHASE';
        ghost.userData.loseSightTimer = 0;
      } else if (ghost.userData.aiState === 'CHASE') {
        if (!targetPos) {
          ghost.userData.aiState = 'WANDER';
          ghost.userData.targetGrid = null;
        } else {
          ghost.userData.loseSightTimer += delta;
          if (ghost.userData.loseSightTimer > 3.0) {
            ghost.userData.aiState = 'WANDER'; // Lost player
            ghost.userData.targetGrid = null;
          }
        }
      }

      // Execute Bot Abilities on human targets
      if (targetPos) {
        if (ghost.userData.abilityCooldown > 0) {
          ghost.userData.abilityCooldown -= delta;
        } else if (distToPlayer < 25) {
          ghost.userData.abilityCooldown = 20.0 + Math.random() * 10.0;
          const gClass = ghost.userData.ghostClass;
          
          if (gClass === 'Stalker') {
            if (myTeam === 'Human') triggerNotification("A Stalker bot caught your scent!");
            ghost.userData.aiState = 'CHASE';
            ghost.userData.targetGrid = worldToGrid(targetPos.x, targetPos.z);
            ghost.userData.pathTime = 0;
          } else if (gClass === 'Mimic') {
            if (myTeam === 'Human') triggerNotification("A Mimic bot is disguising itself!");
            if (typeof preloadedHumanModel !== 'undefined' && preloadedHumanModel) {
              const mimicModel = SkeletonUtils.clone(preloadedHumanModel);
              ghost.add(mimicModel);
              ghost.children.forEach(c => { if(c !== mimicModel) c.visible = false; });
              setTimeout(() => {
                ghost.remove(mimicModel);
                ghost.children.forEach(c => { c.visible = true; });
              }, 10000);
            }
          } else if (gClass === 'Juggernaut') {
            if (myTeam === 'Human') triggerNotification("A Juggernaut bot is enraged!");
            ghost.userData.speedBoostTimer = 5.0;
          } else if (gClass === 'Phantom') {
            if (myTeam === 'Human') triggerNotification("A Phantom bot used Vapor Leap!");
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ghost.quaternion);
            ghost.position.addScaledVector(forward, 8);
          } else if (gClass === 'Poltergeist') {
            const dist = targetPos.distanceTo(ghost.position);
            if (dist <= 6 * 4.5 && myTeam === 'Human' && !window.isSpectating) {
              triggerNotification("Poltergeist bot deployed Breaker Siphon!");
              window.flashlightDisabledBySiphon = true;
              setTimeout(() => { window.flashlightDisabledBySiphon = false; }, 10000);
            }
          } else if (gClass === 'Banshee') {
            const dist = targetPos.distanceTo(ghost.position);
            if (dist <= 6 * 4.5 && myTeam === 'Human' && !window.isSpectating) {
              triggerNotification("Banshee bot scrambled your sensors!");
              window.sensorsScrambled = true;
              setTimeout(() => { window.sensorsScrambled = false; }, 5000);
            }
          }
        }
      }

      // Check Sound Beacons (human noise)
      if (latestSoundBeacon && latestSoundBeacon.time > ghost.userData.lastSoundTime && ghost.userData.aiState !== 'CHASE') {
        const distToSound = ghost.position.distanceTo(new THREE.Vector3(latestSoundBeacon.position.x, ghost.position.y, latestSoundBeacon.position.z));
        let hearingRadius = 0;
        if (latestSoundBeacon.volume <= 1.0) hearingRadius = 5 * mazeBlockSize; // Walking
        else if (latestSoundBeacon.volume <= 2.0) hearingRadius = 9 * mazeBlockSize; // Sprinting
        else if (latestSoundBeacon.volume <= 35) hearingRadius = 14 * mazeBlockSize; // Whisper
        else hearingRadius = 35 * mazeBlockSize; // Scream

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
        if (ghost.userData.aiState === 'CHASE' && targetPos) {
          destGrid = worldToGrid(targetPos.x, targetPos.z);
          ghost.userData.targetGrid = destGrid;
        } else if (ghost.userData.aiState === 'INVESTIGATE') {
          destGrid = ghost.userData.targetGrid;
          if (!destGrid) destGrid = ghostGrid;
          if (ghostGrid.col === destGrid.col && ghostGrid.row === destGrid.row) {
             ghost.userData.aiState = 'WANDER';
             ghost.userData.targetGrid = null;
          }
        } 

        if (ghost.userData.aiState === 'WANDER' || !destGrid) {
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
      } else if (ghost.userData.aiState === 'CHASE' && distToPlayer > 0.5 && targetPos) {
        // Fallback: Chase direct line of sight to human target
        const dir = new THREE.Vector3(targetPos.x - ghost.position.x, 0, targetPos.z - ghost.position.z).normalize();
        ghost.position.addScaledVector(dir, delta * moveSpeed);
      }
      
      // Face the human player if chasing, otherwise face movement direction
      if (ghost.userData.aiState === 'CHASE' && targetPos) {
        ghost.lookAt(targetPos.x, ghost.position.y, targetPos.z);
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
    if (networkTimer >= 0.05 && !window.isSpectating) { // 20Hz update, skip if spectating
      socketClient.emit('player_movement', {
        position: { x: camera.position.x, z: camera.position.z },
        rotation: { y: camera.rotation.y },
        team: myTeam,
        characterClass: myClass
      });

      // Emit walking sound frequency (only for Humans)
      if (myTeam === 'Human' && (Math.abs(velocity.x) > 1 || Math.abs(velocity.z) > 1)) {
        const footstepVolume = isSprinting ? 1.5 : 0.5;
        socketClient.emit('sound_produced', {
          volume: footstepVolume,
          position: { x: camera.position.x, z: camera.position.z }
        });
        latestSoundBeacon = { position: { x: camera.position.x, z: camera.position.z }, volume: footstepVolume, time: performance.now() };
      }
      networkTimer = 0;
    }

    // Process Microphone volume (only for Humans, filter out local EMF beeps)
    if (myTeam === 'Human' && audioAnalyser && !isCaptured) {
      const timeSinceEmfBeep = performance.now() - (window.lastEmfBeepTime || 0);
      
      // Only process microphone if EMF hasn't beeped in the last 450ms (prevents speaker-to-mic feedback)
      if (timeSinceEmfBeep > 450) {
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
    }

    // Update on-screen interaction cues
    updateInteractionPrompt();

    // Check key win triggers
    checkWinCondition();
  } else {
    const promptEl = document.getElementById('interaction-prompt');
    if (promptEl) promptEl.style.display = 'none';
  }

  // --- Active bobbing and walk cycle limb animations ---
  // Bob AI ghosts + flickering visibility
  ghosts3D.forEach(g => {
    const acc = g.userData.bobAccumulator || 0;
    g.position.y = 0.1 + Math.sin(time * 0.0015 + acc) * 0.1;

    // Flickering visibility — ghost pulses in and out
    const flickerPhase = Math.sin(time * 0.004 + acc) * 0.5 
                       + Math.sin(time * 0.011 + acc * 2) * 0.3 
                       + Math.sin(time * 0.027 + acc * 3) * 0.2;
    const glitchBurst = Math.random() < 0.003 ? 0.25 : 0;
    const targetOpacity = Math.max(0.35, Math.min(0.7, 0.5 + flickerPhase * 0.15 + glitchBurst));
    
    g.children.forEach(c => {
      if (c.isMesh && c.material && c.material.transparent) {
        c.material.opacity = Math.min(targetOpacity, c.material.opacity + 0.4);
      }
    });

    // Arm sway
    g.children.forEach(c => {
      if (c.geometry && c.geometry.type === 'CylinderGeometry' && Math.abs(c.position.x) > 0.3) {
        c.rotation.x = -0.2 + Math.sin(time * 0.002 + acc) * 0.25;
      }
    });
  });

  // Bob / swing network players
  Object.keys(players3D).forEach(id => {
    const p = players3D[id];
    if (!p.userData) return;
    
    if (p.userData.type === 'Ghost') {
      const acc = p.userData.bobAccumulator || 0;
      p.position.y = 0.1 + Math.sin(time * 0.0015 + acc) * 0.1;
      const flickerPhase = Math.sin(time * 0.004 + acc) * 0.5 
                         + Math.sin(time * 0.011 + acc * 2) * 0.3;
      const glitchBurst = Math.random() < 0.003 ? 0.25 : 0;
      const targetOpacity = Math.max(0.35, Math.min(0.7, 0.5 + flickerPhase * 0.12 + glitchBurst));
      p.children.forEach(c => {
        if (c.isMesh && c.material && c.material.transparent) {
          c.material.opacity = Math.min(targetOpacity, c.material.opacity + 0.4);
        }
      });
    } else if (p.userData.type === 'Human') {
      // Calculate delta movement to drive the walk cycle
      const currentPos = p.position.clone();
      const lastPos = p.userData.lastPosition || p.position.clone();
      const distMoved = currentPos.distanceTo(lastPos);
      p.userData.lastPosition = currentPos;

      if (distMoved > 0.01) {
        // Human player is moving, advance walk cycle
        p.userData.walkCycle += distMoved * 5.5;
      } else {
        // Human player is standing still, ease limbs back to center/rest position
        p.userData.walkCycle *= 0.85;
      }

      // Swing legs and arms back and forth in opposition
      const swing = Math.sin(p.userData.walkCycle) * 0.6;
      if (p.userData.leftLeg) p.userData.leftLeg.rotation.x = swing;
      if (p.userData.rightLeg) p.userData.rightLeg.rotation.x = -swing;
      if (p.userData.leftArm) p.userData.leftArm.rotation.x = -swing;
      if (p.userData.rightArm) p.userData.rightArm.rotation.x = swing;
    }
  });
  // Handle ghost initial spawning — only after splash screen and pointer lock / active game
  const readyToSpawn = isMobileDevice ? (window.gameReady && window.mobileGameActive) : (window.gameReady && Boolean(document.pointerLockElement));
  if (ghosts3D.length === 0 && currentLobby && currentLobby.settings.ghostsCount > 0 && readyToSpawn) {
    spawnGhostAIs(currentLobby.settings.ghostsCount);
  }

  // Update and draw Minimap & Cooldown Timers
  if (window.gameReady) {
    if (myTeam === 'Human') {
      updateMinimapVisibility();
    }
    drawMinimap();
    updateCooldownHUD();
  }

  renderer.render(scene, activeViewCamera || camera);
}
