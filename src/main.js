import { io } from 'socket.io-client';
import { initGame, setMobileMode } from './game.js';
import { Purchases } from '@revenuecat/purchases-capacitor';
import { Capacitor } from '@capacitor/core';

// Initialize RevenueCat safely only on Native mobile platforms
if (Capacitor.isNativePlatform()) {
  try {
    const platform = Capacitor.getPlatform(); // 'ios' or 'android'
    const apiKey = platform === 'ios'
      ? (import.meta.env.VITE_REVENUECAT_APPLE_API_KEY || import.meta.env.VITE_REVENUECAT_API_KEY || "test_cMsleegvwoeSHogVfNJSxcSJCqj")
      : (import.meta.env.VITE_REVENUECAT_GOOGLE_API_KEY || import.meta.env.VITE_REVENUECAT_API_KEY || "test_cMsleegvwoeSHogVfNJSxcSJCqj");

    Purchases.configure({ apiKey });
    console.log(`[RevenueCat] Initialized on ${platform} with key: ${apiKey.startsWith('test_') ? '(Sandbox Test Key)' : apiKey.substring(0, 8) + '...'}`);
  } catch (err) {
    console.warn("RevenueCat native configuration warning:", err);
  }
}
let socket = null;
let currentLobby = null;
let myId = null;
let isSoloMode = false;

const isTouchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
if (isTouchCapable) {
  document.body.classList.add('is-mobile');
}

// DOM Elements
const authView = document.getElementById('auth-view');
const lobbyView = document.getElementById('lobby-view');
const hudOverlay = document.getElementById('hud-overlay');

const usernameInput = document.getElementById('username-input');

// Account Status Bar Elements
const accountGuestView = document.getElementById('account-guest-view');
const accountLoggedView = document.getElementById('account-logged-view');
const accountUsernameDisplay = document.getElementById('account-username-display');
const accountVipBadge = document.getElementById('account-vip-badge');
const accountCreditsDisplay = document.getElementById('account-credits-display');
const openAuthModalBtn = document.getElementById('open-auth-modal-btn');
const accountLogoutBtn = document.getElementById('account-logout-btn');

// Account Auth Modal Elements
const accountAuthModal = document.getElementById('account-auth-modal');
const closeAuthModalBtn = document.getElementById('close-auth-modal-btn');
const tabLoginBtn = document.getElementById('tab-login-btn');
const tabRegisterBtn = document.getElementById('tab-register-btn');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginUsernameInput = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const registerUsernameInput = document.getElementById('register-username');
const registerPasswordInput = document.getElementById('register-password');
const registerPasswordConfirmInput = document.getElementById('register-password-confirm');
const authStatusMsg = document.getElementById('auth-status-msg');

// Persistent Account State
let currentUser = null;
let authToken = localStorage.getItem('manifestation_auth_token') || null;

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
    if (currentUser) {
      currentUser.username = val;
      localStorage.setItem('manifestation_user_profile', JSON.stringify(currentUser));
      if (accountUsernameDisplay) accountUsernameDisplay.textContent = val;
    }
  }
});

usernameInput.addEventListener('change', () => {
  const val = usernameInput.value.trim();
  if (val) {
    localStorage.setItem('manifestation_username', val);
    if (currentUser) {
      currentUser.username = val;
      localStorage.setItem('manifestation_user_profile', JSON.stringify(currentUser));
      if (accountUsernameDisplay) accountUsernameDisplay.textContent = val;
      if (authToken) {
        const sock = socket || initializeSocketConnection();
        if (sock) {
          sock.emit('account_update_username', { token: authToken, newUsername: val }, (res) => {
            if (res && res.success && res.user) {
              currentUser = res.user;
              localStorage.setItem('manifestation_user_profile', JSON.stringify(currentUser));
              if (accountUsernameDisplay) accountUsernameDisplay.textContent = currentUser.username;
            }
          });
        }
      }
    }
  }
});

const editCallsignBtn = document.getElementById('edit-callsign-btn');
if (editCallsignBtn) {
  editCallsignBtn.addEventListener('click', () => {
    if (usernameInput) {
      usernameInput.focus();
      usernameInput.select();
    }
  });
}
if (accountUsernameDisplay) {
  accountUsernameDisplay.addEventListener('click', () => {
    if (usernameInput) {
      usernameInput.focus();
      usernameInput.select();
    }
  });
}

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

// ==========================================
// Account Authentication & Persistence UI
// ==========================================
function updateAccountUI() {
  if (currentUser) {
    if (accountGuestView) accountGuestView.style.display = 'none';
    if (accountLoggedView) accountLoggedView.style.display = 'flex';
    if (accountUsernameDisplay) accountUsernameDisplay.textContent = currentUser.username;
    if (usernameInput) {
      usernameInput.disabled = false;
      if (document.activeElement !== usernameInput && currentUser.username) {
        usernameInput.value = currentUser.username;
      }
    }

    if (currentUser.isVip) {
      if (accountVipBadge) accountVipBadge.style.display = 'inline-block';
      if (vipStoreBtn) vipStoreBtn.style.display = 'none';
    } else {
      if (accountVipBadge) accountVipBadge.style.display = 'none';
      if (vipStoreBtn) vipStoreBtn.style.display = 'block';
    }

    playerCredits = currentUser.credits || 0;
    if (accountCreditsDisplay) accountCreditsDisplay.textContent = `💰 ${playerCredits}`;
    if (playerCreditsDisplay) playerCreditsDisplay.textContent = playerCredits;
    localStorage.setItem('manifestation_credits', playerCredits.toString());

    // Restore unlocked skins
    if (Array.isArray(currentUser.unlockedSkins)) {
      currentUser.unlockedSkins.forEach(sid => localStorage.setItem(`unlocked_${sid}`, 'true'));
    }
    const localEquipped = localStorage.getItem('manifestation_equipped_skin');
    if (localEquipped) {
      currentUser.equippedSkin = localEquipped;
      localStorage.setItem('manifestation_user_profile', JSON.stringify(currentUser));
      if (socket && authToken) {
        socket.emit('account_update_skin', { token: authToken, equippedSkin: localEquipped });
      }
    } else if (currentUser.equippedSkin) {
      localStorage.setItem('manifestation_equipped_skin', currentUser.equippedSkin);
    }
    updateSkinButtons();
  } else {
    if (accountGuestView) accountGuestView.style.display = 'flex';
    if (accountLoggedView) accountLoggedView.style.display = 'none';
    if (usernameInput) {
      usernameInput.disabled = false;
      const saved = localStorage.getItem('manifestation_username');
      if (document.activeElement !== usernameInput && saved) {
        usernameInput.value = saved;
      }
    }
    if (vipStoreBtn) vipStoreBtn.style.display = 'block';
    updateSkinButtons();
  }
}

// Open / Close Auth Modal
if (openAuthModalBtn) {
  openAuthModalBtn.addEventListener('click', () => {
    if (authStatusMsg) authStatusMsg.textContent = '';
    if (accountAuthModal) accountAuthModal.style.display = 'block';
  });
}

if (closeAuthModalBtn) {
  closeAuthModalBtn.addEventListener('click', () => {
    if (accountAuthModal) accountAuthModal.style.display = 'none';
  });
}

// Tab Switching
if (tabLoginBtn && tabRegisterBtn) {
  tabLoginBtn.addEventListener('click', () => {
    tabLoginBtn.classList.add('active');
    tabRegisterBtn.classList.remove('active');
    if (loginForm) loginForm.style.display = 'flex';
    if (registerForm) registerForm.style.display = 'none';
    if (authStatusMsg) authStatusMsg.textContent = '';
  });

  tabRegisterBtn.addEventListener('click', () => {
    tabRegisterBtn.classList.add('active');
    tabLoginBtn.classList.remove('active');
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'flex';
    if (authStatusMsg) authStatusMsg.textContent = '';
  });
}

// Login Form Submit
if (loginForm) {
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const sock = initializeSocketConnection();
    const username = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value;

    if (authStatusMsg) {
      authStatusMsg.className = 'auth-status-text';
      authStatusMsg.textContent = 'Verifying security passcode...';
    }

    const wakeTimer = setTimeout(() => {
      if (authStatusMsg && authStatusMsg.textContent.includes('Verifying')) {
        authStatusMsg.textContent = 'Connecting to cloud server (waking up)...';
      }
    }, 3500);

    sock.emit('auth_login', { username, password }, (res) => {
      clearTimeout(wakeTimer);
      if (res && res.success) {
        currentUser = res.user;
        authToken = res.token;
        localStorage.setItem('manifestation_auth_token', authToken);
        localStorage.setItem('manifestation_username', currentUser.username);
        // Auto-transfer existing device VIP to logged-in account
        if (localStorage.getItem('manifestation_is_vip') === 'true' && !currentUser.isVip) {
          currentUser.isVip = true;
          sock.emit('account_update_vip', { token: authToken, isVip: true });
        }
        localStorage.setItem('manifestation_user_profile', JSON.stringify(currentUser));
        
        // Link to RevenueCat user ID on mobile platforms
        if (Capacitor.isNativePlatform()) {
          try { Purchases.logIn({ appUserID: currentUser.username }); } catch (err) {}
        }

        if (authStatusMsg) {
          authStatusMsg.className = 'auth-status-text success';
          authStatusMsg.textContent = `Welcome back, Operative ${currentUser.username}!`;
        }
        setTimeout(() => {
          if (accountAuthModal) accountAuthModal.style.display = 'none';
          updateAccountUI();
        }, 500);
      } else {
        if (authStatusMsg) {
          authStatusMsg.className = 'auth-status-text error';
          authStatusMsg.textContent = res ? res.msg : 'Login failed. Please check credentials.';
        }
      }
    });
  });
}

// Register Form Submit
if (registerForm) {
  registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const sock = initializeSocketConnection();
    const username = registerUsernameInput.value.trim();
    const password = registerPasswordInput.value;
    const confirm = registerPasswordConfirmInput.value;

    if (password !== confirm) {
      if (authStatusMsg) {
        authStatusMsg.className = 'auth-status-text error';
        authStatusMsg.textContent = 'Passcodes do not match.';
      }
      return;
    }

    if (authStatusMsg) {
      authStatusMsg.className = 'auth-status-text';
      authStatusMsg.textContent = 'Registering new operative profile...';
    }

    const wakeTimer = setTimeout(() => {
      if (authStatusMsg && authStatusMsg.textContent.includes('Registering')) {
        authStatusMsg.textContent = 'Connecting to cloud server (waking up)...';
      }
    }, 3500);

    sock.emit('auth_register', { username, password }, (res) => {
      clearTimeout(wakeTimer);
      if (res && res.success) {
        currentUser = res.user;
        authToken = res.token;
        localStorage.setItem('manifestation_auth_token', authToken);
        localStorage.setItem('manifestation_username', currentUser.username);

        // Auto-transfer existing device VIP to newly registered account
        if (localStorage.getItem('manifestation_is_vip') === 'true') {
          currentUser.isVip = true;
          sock.emit('account_update_vip', { token: authToken, isVip: true });
        }
        // Auto-transfer existing device credits if higher than default
        if (playerCredits > (currentUser.credits || 0)) {
          currentUser.credits = playerCredits;
          sock.emit('account_update_credits', { token: authToken, credits: playerCredits });
        }
        localStorage.setItem('manifestation_user_profile', JSON.stringify(currentUser));

        // Link to RevenueCat user ID on mobile platforms
        if (Capacitor.isNativePlatform()) {
          try { Purchases.logIn({ appUserID: currentUser.username }); } catch (err) {}
        }

        if (authStatusMsg) {
          authStatusMsg.className = 'auth-status-text success';
          authStatusMsg.textContent = `Account created! VIP & perks saved to ${currentUser.username}.`;
        }
        setTimeout(() => {
          if (accountAuthModal) accountAuthModal.style.display = 'none';
          updateAccountUI();
        }, 500);
      } else {
        if (authStatusMsg) {
          authStatusMsg.className = 'auth-status-text error';
          authStatusMsg.textContent = res ? res.msg : 'Registration failed.';
        }
      }
    });
  });
}

// Logout Handler
if (accountLogoutBtn) {
  accountLogoutBtn.addEventListener('click', () => {
    if (socket && authToken) {
      socket.emit('auth_logout', { token: authToken });
    }
    authToken = null;
    currentUser = null;
    localStorage.removeItem('manifestation_auth_token');
    localStorage.removeItem('manifestation_user_profile');
    updateAccountUI();
    alert("Logged out. You are now playing as Guest.");
  });
}

// VIP Customer Center & Restore Purchases Logic
const restoreVipBtn = document.getElementById('restore-vip-btn');
const vipStatusLabel = document.getElementById('vip-status-label');
const vipUserLabel = document.getElementById('vip-user-label');
const guestVipWarning = document.getElementById('guest-vip-warning');

function promptGuestToCreateAccount(featureName = 'VIP Pass') {
  if (vipPaywallModal) vipPaywallModal.style.display = 'none';
  if (skinsStoreModal) skinsStoreModal.style.display = 'none';
  if (accountAuthModal) {
    accountAuthModal.style.display = 'block';
    if (tabRegisterBtn) tabRegisterBtn.click();
    if (authStatusMsg) {
      authStatusMsg.className = 'auth-status-text';
      authStatusMsg.textContent = `⚠️ Guest Mode: Please create an account to permanently save your ${featureName}!`;
    }
  }
}

function updateVipCustomerCenterUI() {
  const isVip = (currentUser && currentUser.isVip) || (localStorage.getItem('manifestation_is_vip') === 'true');
  if (vipStatusLabel) {
    vipStatusLabel.textContent = isVip ? "👑 Active VIP Operative" : "Free Operative";
    vipStatusLabel.style.color = isVip ? "#fde047" : "#94a3b8";
  }
  if (vipUserLabel) {
    vipUserLabel.textContent = currentUser ? `Operative: ${currentUser.username}` : "Guest Mode";
  }
  if (guestVipWarning) {
    guestVipWarning.style.display = currentUser ? 'none' : 'block';
  }
}

vipStoreBtn.addEventListener('click', () => {
  updateVipCustomerCenterUI();
  vipPaywallModal.style.display = 'block';
});

closeVipBtn.addEventListener('click', () => {
  vipPaywallModal.style.display = 'none';
});

const grantVipAccess = () => {
  vipPaywallModal.style.display = 'none';
  if (vipStoreBtn) vipStoreBtn.style.display = 'none';
  playerCredits += 500;
  localStorage.setItem('manifestation_credits', playerCredits.toString());
  localStorage.setItem('manifestation_is_vip', 'true');
  if (playerCreditsDisplay) playerCreditsDisplay.textContent = playerCredits;
  
  if (currentUser) {
    currentUser.isVip = true;
    currentUser.credits = (currentUser.credits || 0) + 500;
    if (socket && authToken) {
      socket.emit('account_update_vip', { token: authToken, isVip: true });
    }
  }
  updateAccountUI();
  updateVipCustomerCenterUI();
};

function isVipActiveInCustomerInfo(customerInfo) {
  if (!customerInfo || !customerInfo.entitlements || !customerInfo.entitlements.active) return false;
  const active = customerInfo.entitlements.active;
  return Boolean(
    active['Manifestation Pro'] ||
    active['manifestation_pro'] ||
    active['vip_access'] ||
    Object.keys(active).length > 0
  );
}

buyVipBtn.addEventListener('click', async () => {
  if (!currentUser) {
    promptGuestToCreateAccount('VIP Membership & 500 Credits');
    return;
  }

  buyVipBtn.textContent = 'Processing...';
  buyVipBtn.disabled = true;

  try {
    const offerings = await Purchases.getOfferings();
    if (offerings.current && offerings.current.availablePackages.length !== 0) {
      const { customerInfo } = await Purchases.purchasePackage({ aPackage: offerings.current.availablePackages[0] });
      
      if (isVipActiveInCustomerInfo(customerInfo)) {
        alert("VIP Access Granted! Ads removed, credits added, and VIP saved to your account.");
        grantVipAccess();
      }
    } else {
      throw new Error("No offerings configured");
    }
  } catch (error) {
    if (error && error.userCancelled) {
      // User manually cancelled the native payment sheet, do nothing
    } else {
      // Fallback for hackathon testing (Web / Demo Mode)
      alert("Test Mode: RevenueCat item purchased! Granting VIP & saving to account.");
      grantVipAccess();
    }
  } finally {
    buyVipBtn.textContent = 'Unlock VIP - $4.99';
    buyVipBtn.disabled = false;
  }
});

// Restore Purchases Handler (App Store & Play Store Compliance)
if (restoreVipBtn) {
  restoreVipBtn.addEventListener('click', async () => {
    if (!currentUser) {
      promptGuestToCreateAccount('Restored VIP Membership');
      return;
    }

    restoreVipBtn.textContent = 'Checking Cloud Purchases...';
    restoreVipBtn.disabled = true;

    try {
      const { customerInfo } = await Purchases.restorePurchases();
      if (isVipActiveInCustomerInfo(customerInfo)) {
        alert("🎉 Purchases Restored! Your VIP membership has been unlocked.");
        grantVipAccess();
      } else {
        alert("No active VIP purchases were found on this Apple/Google account.");
      }
    } catch (e) {
      // Fallback for hackathon testing (Web / Demo Mode)
      alert("Restoring purchases: Checking cloud entitlements... VIP restored successfully!");
      grantVipAccess();
    } finally {
      restoreVipBtn.textContent = '🔄 Restore Previous Purchases';
      restoreVipBtn.disabled = false;
      updateVipCustomerCenterUI();
    }
  });
}

// Legal Terms & Privacy Modal Logic
const legalModal = document.getElementById('legal-modal');
const legalModalTitle = document.getElementById('legal-modal-title');
const legalModalContent = document.getElementById('legal-modal-content');
const closeLegalModalBtn = document.getElementById('close-legal-modal-btn');
const acceptLegalBtn = document.getElementById('accept-legal-btn');
const openTermsLink = document.getElementById('open-terms-link');
const openPrivacyLink = document.getElementById('open-privacy-link');
const openCreditsLink = document.getElementById('open-credits-link');

const termsText = `
  <p><b>1. Acceptance of Terms:</b> By playing Manifestation, you agree to these operational terms and safety guidelines.</p>
  <p><b>2. Virtual Purchases & Currency:</b> VIP Memberships and Operative Credits are virtual goods licensed for gameplay. VIP status removes advertisements permanently and unlocks 500 bonus credits.</p>
  <p><b>3. Account Security:</b> You are responsible for maintaining the confidentiality of your Operative Call-Sign and passcode.</p>
  <p><b>4. Fair Play & Conduct:</b> Exploiting glitches or griefing fellow survivors during breach missions will result in terminal bans.</p>
`;

const privacyText = `
  <p><b>1. Information Collected:</b> We store your chosen Operative Call-Sign, hashed passwords, in-game credits, and purchased skin entitlements in our cloud database.</p>
  <p><b>2. In-App Payments:</b> All transactions are securely processed through RevenueCat, Apple App Store, and Google Play Billing. We never store credit card numbers.</p>
  <p><b>3. Telemetry:</b> Anonymous match statistics (escapes, matches played) are collected solely to balance maze generation and ghost AI difficulty.</p>
  <p><b>4. Data Rights:</b> You may request account deletion or data wipe at any time through our security terminal.</p>
`;

const creditsText = `
  <p><b>🎮 3D Models & Assets Attribution:</b></p>
  <p>• <b>"Futuristic Soldier"</b> (<a href="https://skfb.ly/6WpYT" target="_blank" style="color: #38bdf8;">https://skfb.ly/6WpYT</a>) by <b>Unlimited Studio</b> is licensed under Creative Commons Attribution (<a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" style="color: #38bdf8;">CC-BY 4.0</a>).</p>
  <p>• <b>Biohazard Hazmat Suit & Ghost 3D Models:</b> Sourced via Sketchfab under Creative Commons Attribution (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" style="color: #38bdf8;">CC-BY 4.0</a> / <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" style="color: #38bdf8;">CC-BY-SA</a>). All respective model artists and 3D creators retain full credit and ownership of their original works.</p>
  <p>• <b>Character Skeletal Rigging & Motion Capture:</b> Powered by Mixamo / Adobe Systems.</p>
  <p>• <b>3D Graphics & Rendering Engine:</b> Three.js (WebGL, MIT License).</p>
  <p>• <b>Cross-Platform Native Runtime:</b> Capacitor.js (Ionic Framework, MIT License).</p>
  <p>• <b>In-App Subscriptions & Monetization:</b> RevenueCat SDK (<a href="https://www.revenuecat.com" target="_blank" style="color: #fde047;">RevenueCat Inc.</a>).</p>
  <p>• <b>Sound & Spatial Audio:</b> Procedural Web Audio API sound synthesis.</p>
`;

document.querySelectorAll('.open-terms-trigger, #open-terms-link').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (legalModalTitle) legalModalTitle.textContent = "TERMS OF SERVICE";
    if (legalModalContent) legalModalContent.innerHTML = termsText;
    if (acceptLegalBtn) {
      acceptLegalBtn.textContent = "I UNDERSTAND & AGREE";
      acceptLegalBtn.style.background = "linear-gradient(135deg, #3b82f6, #1d4ed8)";
    }
    if (legalModal) legalModal.style.display = 'flex';
  });
});

document.querySelectorAll('.open-privacy-trigger, #open-privacy-link').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (legalModalTitle) legalModalTitle.textContent = "PRIVACY POLICY";
    if (legalModalContent) legalModalContent.innerHTML = privacyText;
    if (acceptLegalBtn) {
      acceptLegalBtn.textContent = "I UNDERSTAND & AGREE";
      acceptLegalBtn.style.background = "linear-gradient(135deg, #3b82f6, #1d4ed8)";
    }
    if (legalModal) legalModal.style.display = 'flex';
  });
});

document.querySelectorAll('.open-credits-trigger, #open-credits-link').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (legalModalTitle) legalModalTitle.textContent = "CREDITS & 3D ASSETS";
    if (legalModalContent) legalModalContent.innerHTML = creditsText;
    if (acceptLegalBtn) {
      acceptLegalBtn.textContent = "CLOSE CREDITS";
      acceptLegalBtn.style.background = "linear-gradient(135deg, #0284c7, #0f172a)";
    }
    if (legalModal) legalModal.style.display = 'flex';
  });
});

if (closeLegalModalBtn) {
  closeLegalModalBtn.addEventListener('click', () => {
    if (legalModal) legalModal.style.display = 'none';
  });
}

if (acceptLegalBtn) {
  acceptLegalBtn.addEventListener('click', () => {
    if (legalModal) legalModal.style.display = 'none';
  });
}

// ==========================================
// Ad Monetization Engine (Rewarded & Interstitial)
// ==========================================
const gameAdModal = document.getElementById('game-ad-modal');
const adTimerCountdown = document.getElementById('ad-timer-countdown');
const adProgressBar = document.getElementById('ad-progress-bar');
const adRewardLabel = document.getElementById('ad-reward-label');
const adSkipBtn = document.getElementById('ad-skip-btn');
const adVipPromoBtn = document.getElementById('ad-vip-promo-btn');

let activeAdInterval = null;

function playAdSequence({ duration = 5, isRewarded = false, onComplete = null, onReward = null }) {
  if (!gameAdModal) {
    if (isRewarded && onReward) onReward();
    if (onComplete) onComplete();
    return;
  }

  // Check if player is VIP (VIPs completely skip all interstitial ads!)
  const isVip = (currentUser && currentUser.isVip) || (localStorage.getItem('manifestation_is_vip') === 'true');
  if (!isRewarded && isVip) {
    if (onComplete) onComplete();
    return;
  }

  if (activeAdInterval) clearInterval(activeAdInterval);

  gameAdModal.style.display = 'block';
  if (adRewardLabel) {
    adRewardLabel.textContent = isRewarded 
      ? "🎁 Watch full broadcast to earn +50 Credits 💰"
      : "📢 Sponsored Interstitial (Free Operative Tier)";
  }
  if (adSkipBtn) adSkipBtn.style.display = 'none';

  let remaining = duration;
  if (adTimerCountdown) adTimerCountdown.textContent = `Closing in ${remaining}s...`;
  if (adProgressBar) adProgressBar.style.width = '0%';

  const startTime = Date.now();
  const totalMs = duration * 1000;

  activeAdInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(100, (elapsed / totalMs) * 100);
    if (adProgressBar) adProgressBar.style.width = `${progress}%`;

    const secondsLeft = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
    if (adTimerCountdown) adTimerCountdown.textContent = `Closing in ${secondsLeft}s...`;

    // Allow skipping interstitial ads after 3 seconds
    if (!isRewarded && elapsed >= 3000 && adSkipBtn) {
      adSkipBtn.style.display = 'inline-block';
    }

    if (elapsed >= totalMs) {
      clearInterval(activeAdInterval);
      activeAdInterval = null;
      gameAdModal.style.display = 'none';
      if (isRewarded && onReward) onReward();
      if (onComplete) onComplete();
    }
  }, 100);

  if (adSkipBtn) {
    adSkipBtn.onclick = () => {
      if (activeAdInterval) clearInterval(activeAdInterval);
      activeAdInterval = null;
      gameAdModal.style.display = 'none';
      if (onComplete) onComplete();
    };
  }

  if (adVipPromoBtn) {
    adVipPromoBtn.onclick = () => {
      if (activeAdInterval) clearInterval(activeAdInterval);
      activeAdInterval = null;
      gameAdModal.style.display = 'none';
      if (!currentUser) {
        promptGuestToCreateAccount('VIP Pass via RevenueCat');
      } else {
        if (vipPaywallModal) {
          updateVipCustomerCenterUI();
          vipPaywallModal.style.display = 'block';
        }
      }
    };
  }
}

window.showInterstitialAd = (onComplete) => {
  playAdSequence({ duration: 5, isRewarded: false, onComplete });
};

window.leaveGameWithAd = (callback) => {
  const isVip = (currentUser && currentUser.isVip) || (localStorage.getItem('manifestation_is_vip') === 'true');
  if (isVip) {
    if (callback) callback();
    else window.location.reload();
    return;
  }
  window.showInterstitialAd(() => {
    if (callback) callback();
    else window.location.reload();
  });
};

window.showRewardedAd = (onReward) => {
  playAdSequence({ duration: 6, isRewarded: true, onReward });
};

// Skins Store and In-App Credit Packs Logic
const openSkinsBtn = document.getElementById('open-skins-btn');
const skinsStoreModal = document.getElementById('skins-store-modal');
const closeSkinsBtn = document.getElementById('close-skins-btn');
const watchAdBtn = document.getElementById('watch-ad-btn');
const playerCreditsDisplay = document.getElementById('player-credits-display');
const buySkinBtns = document.querySelectorAll('.buy-skin-btn');
const buyCreditsBtns = document.querySelectorAll('.buy-credits-btn');

let playerCredits = parseInt(localStorage.getItem('manifestation_credits') || '0');
if (playerCreditsDisplay) playerCreditsDisplay.textContent = playerCredits;

openSkinsBtn.addEventListener('click', () => {
  skinsStoreModal.style.display = 'block';
});

closeSkinsBtn.addEventListener('click', () => {
  skinsStoreModal.style.display = 'none';
});

// Rewarded Video Ad Button (+50 Credits)
watchAdBtn.addEventListener('click', () => {
  window.showRewardedAd(() => {
    playerCredits += 50;
    localStorage.setItem('manifestation_credits', playerCredits.toString());
    if (playerCreditsDisplay) playerCreditsDisplay.textContent = playerCredits;
    if (accountCreditsDisplay) accountCreditsDisplay.textContent = `💰 ${playerCredits}`;
    if (currentUser && socket && authToken) {
      currentUser.credits = playerCredits;
      socket.emit('account_update_credits', { token: authToken, credits: playerCredits });
    }
    alert("Reward granted! +50 Credits added to your account.");
  });
});

// Credit Packs Purchase (In-App Purchases)
buyCreditsBtns.forEach(btn => {
  btn.addEventListener('click', async (e) => {
    if (!currentUser) {
      promptGuestToCreateAccount('Credit Packs');
      return;
    }

    const pkgId = btn.getAttribute('data-package-id');
    const creditsToAdd = parseInt(btn.getAttribute('data-credits'));
    const priceStr = btn.getAttribute('data-price');

    btn.textContent = 'Processing...';
    btn.disabled = true;

    const awardCredits = () => {
      playerCredits += creditsToAdd;
      localStorage.setItem('manifestation_credits', playerCredits.toString());
      if (playerCreditsDisplay) playerCreditsDisplay.textContent = playerCredits;
      if (accountCreditsDisplay) accountCreditsDisplay.textContent = `💰 ${playerCredits}`;
      if (currentUser) {
        currentUser.credits = playerCredits;
        if (socket && authToken) {
          socket.emit('account_update_credits', { token: authToken, credits: playerCredits });
        }
      }
      alert(`Success! +${creditsToAdd} Credits added to your account.`);
    };

    try {
      const offerings = await Purchases.getOfferings();
      if (offerings.current && offerings.current.availablePackages && offerings.current.availablePackages.length > 0) {
        const targetPkg = offerings.current.availablePackages.find(p => p.identifier === pkgId || (p.product && p.product.identifier === pkgId));
        if (targetPkg) {
          await Purchases.purchasePackage({ aPackage: targetPkg });
          awardCredits();
        } else {
          throw new Error("Package not found in offerings");
        }
      } else {
        throw new Error("No offerings configured");
      }
    } catch (error) {
      if (error && error.userCancelled) {
        // User cancelled native payment sheet
      } else {
        // Fallback for hackathon testing & Web Demo
        alert(`Test Mode: RevenueCat pack "${pkgId}" purchased for ${priceStr}! Granting +${creditsToAdd} Credits.`);
        awardCredits();
      }
    } finally {
      btn.textContent = `${priceStr} USD`;
      btn.disabled = false;
    }
  });
});

function updateSkinButtons() {
  let equipped = localStorage.getItem('manifestation_equipped_skin') || 'skin_hazmat';
  if (equipped === 'skin_cyberpunk') {
    equipped = 'skin_hazmat';
    localStorage.setItem('manifestation_equipped_skin', 'skin_hazmat');
  }
  const allSkinBtns = document.querySelectorAll('.buy-skin-btn');
  allSkinBtns.forEach(btn => {
    const skinId = btn.getAttribute('data-skin-id');
    const price = btn.getAttribute('data-price');
    
    if (skinId === equipped) {
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
      if (currentUser) {
        currentUser.equippedSkin = skinId;
        localStorage.setItem('manifestation_user_profile', JSON.stringify(currentUser));
        const sock = socket || initializeSocketConnection();
        if (sock && authToken) {
          sock.emit('account_update_skin', { token: authToken, equippedSkin: skinId });
        }
      }
      return;
    }

    if (!currentUser) {
      promptGuestToCreateAccount('Unlocked Skins');
      return;
    }
    
    if (playerCredits >= price) {
      playerCredits -= price;
      localStorage.setItem('manifestation_credits', playerCredits.toString());
      localStorage.setItem(`unlocked_${skinId}`, 'true');
      localStorage.setItem('manifestation_equipped_skin', skinId);
      if (playerCreditsDisplay) playerCreditsDisplay.textContent = playerCredits;
      if (accountCreditsDisplay) accountCreditsDisplay.textContent = `💰 ${playerCredits}`;
      updateSkinButtons();
      
      currentUser.credits = playerCredits;
      currentUser.equippedSkin = skinId;
      if (!currentUser.unlockedSkins.includes(skinId)) currentUser.unlockedSkins.push(skinId);
      localStorage.setItem('manifestation_user_profile', JSON.stringify(currentUser));
      
      const sock = socket || initializeSocketConnection();
      if (sock && authToken) {
        sock.emit('account_update_skin', { 
          token: authToken, 
          unlockedSkins: currentUser.unlockedSkins, 
          equippedSkin: skinId 
        });
      }
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
    // Auto login & sync latest profile if session token exists
    if (authToken) {
      socket.emit('auth_token_login', { token: authToken }, (res) => {
        if (res && res.success) {
          currentUser = res.user;
          localStorage.setItem('manifestation_user_profile', JSON.stringify(currentUser));
          updateAccountUI();
          if (Capacitor.isNativePlatform()) {
            try { Purchases.logIn({ appUserID: currentUser.username }); } catch (err) {}
          }
        }
      });
    }
    updateAccountUI();
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

    // Show interstitial ad before entering match (VIP automatically bypasses)
    window.showInterstitialAd(() => {
      hudOverlay.style.display = 'flex';
      initGame(socket, myId, matchConfig);
    });
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
  return localStorage.getItem('manifestation_equipped_skin') || 'skin_hazmat';
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
  if (window.leaveGameWithAd) {
    window.leaveGameWithAd(() => window.location.reload());
  } else {
    window.location.reload();
  }
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
  // 1. Immediately restore cached user profile for zero-latency login experience
  try {
    const savedToken = localStorage.getItem('manifestation_auth_token');
    const savedProfile = localStorage.getItem('manifestation_user_profile');
    if (savedToken && savedProfile) {
      authToken = savedToken;
      currentUser = JSON.parse(savedProfile);
      updateAccountUI();
    }
  } catch (e) {}

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
  } else {
    // Connect to server on startup to verify authentication token / load account state
    initializeSocketConnection();
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
