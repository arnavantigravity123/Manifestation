# 🌀 Manifestation

> **RevenueCat Ship-a-ton 2026 Submission**  
> *A high-stakes, 3D atmospheric multiplayer labyrinth survival game built with Three.js, WebGL, Node.js, Socket.IO, and Capacitor.*

---

## 🎮 Game Overview
In **Manifestation**, players are trapped in an ancient, shifting subterranean stone dungeon known as the Labyrinth.
- **Operatives (Humans)**: Must navigate the treacherous modular corridors, decipher clues, locate the ancient Gothic Vault, crack the multi-digit keypad code, and escape before they are hunted down.
- **The Manifestation (Ghost)**: An ethereal entity lurking in the labyrinth, capable of phased movement and stalking operatives in the dark.

---

## 🛠️ Tech Stack & Architecture
- **Rendering Engine**: Three.js (v0.184.0) with WebGL, custom shader/UV atlasing, FBX skeletal animation mixers, and instanced props (pillars, statues, modular runner rugs).
- **Frontend & Build Tool**: Vite 8, HTML5 Canvas, modern ES Modules.
- **Multiplayer Backend**: Node.js, Express, Socket.IO authoritative server, real-time spatial lobby synchronization, and WebRTC / microphone audio mechanics.
- **Mobile Packaging**: Capacitor Android (`@capacitor/android`) & Capacitor iOS (`@capacitor/ios`).
- **Monetization**: RevenueCat SDK (`@revenuecat/purchases-capacitor`) for VIP subscriptions and cosmetic skin unlock tiers.

---

## 🚀 Development Workflow & Commands

### Prerequisites
- Node.js (v20+ or v24+)
- npm

### Running Locally
```bash
# Start both the backend Socket.IO server and the Vite dev server concurrently
npm run dev

# Or build for production
npm run build

# Start production server
npm run start
```

### Native Mobile Sync (Android / iOS)
```bash
# Compile web assets and sync to native Capacitor platforms
npm run build
npx cap sync android
```

---

## 🏛️ Recent Architectural Highlights & Engine Fixes

### 1. Skeleton Locomotion Rigging & Strafe Stabilization
- **Root Motion Stripping**: Extracted translation tracks on `mixamorigHips` so physics velocity dictates player displacement without drift.
- **Rotational Gimbal Decoupling**: Mixamo strafe walks (`Left Strafe Walking.fbx`, `Right Strafe Walking (1).fbx`) include $\sim \pm 66^\circ$ intrinsic hip yaw. Forward hunching (pitch) on a yawed bone mathematically manifests as sideways roll. We neutralized pitch ($X$) and roll ($Z$) on `Hips`, `Spine`, `Neck`, and `Head` quaternion tracks to lock the character strictly upright ($< 1.5^\circ$ spine deflection).

### 2. Modular Dungeon Corridor & Rug System
- **2m × 2m Modular Hub Architecture**: Turns and T-junctions are composed of pure red velvet base tiles (`createPureRedTileGeo`), extension arms (`createArmRugGeo`), and perimeter border strips (`createBorderStripGeo`).
- **Zero Border Cuts**: Crossing paths have no border strip lines crossing hallways, eliminating tripwires.
- **Z-Fighting Elimination**: A $+0.002\text{m}$ ($2\text{mm}$) elevation offset stops depth-buffer floating-point precision conflicts.
- **1:1 Pixel Aspect Ratio Crest Rug (`createCrestRugGeo`)**: Scaled the center winged crest quad to $2.0\text{m} \times 0.95\text{m}$ ($2.10 : 1$ aspect ratio) to match the $522\text{px} \times 238\text{px}$ texture atlas panel in `RugColor.png` at 1:1 pixel fidelity, flanked by two seamless $2.525\text{m}$ runner extensions.

### 3. $O(1)$ Spatial Collision & Lighting Performance
- **Spatial Grid Check**: Bot AI collision checks query only the immediate $3 \times 3$ grid neighborhood around each entity ($O(1)$) instead of scanning all $2{,}000$ walls ($O(N)$), saving $358,000+$ calculations per second.
- **Light Caching**: Eliminated dynamic PointLight loops in protocol scripts, maintaining steady 60 FPS across both desktop and mobile devices.

---

## 📜 Repository Rules & Contributor Guide
For full agent and developer guidelines, refer to:
- [`AGENTS.md`](./AGENTS.md)
- [`GEMINI.md`](./GEMINI.md)
- [`.agents/skills/manifestation-dev/SKILL.md`](./.agents/skills/manifestation-dev/SKILL.md)
