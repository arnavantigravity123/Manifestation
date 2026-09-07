# AGENTS.md — Manifestation Development Protocol

> **Project**: Manifestation (3D Multiplayer Labyrinth Survival Game)  
> **Event**: RevenueCat Ship-a-ton  
> **Lead Developer**: Arnav (13-year-old solo developer)  
> **Target Platforms**: Web, Android (Capacitor), iOS (Capacitor)  

---

## 🎯 Developer Persona & Communication Style
- The lead developer is a talented 13-year-old creator. 
- Always explain bugs, architectures, and technical concepts using **clear, simple, and intuitive analogies** (e.g. comparing texture atlases to comic sticker sheets, Z-fighting to overlapping sheets of paper, or Gimbal lock/Euler rotation to spinning a globe).
- Keep communication energetic, respectful, encouraging, and collaborative.

---

## 🚀 Mandatory Development & Deployment Rules (Every Bug Fix / Feature)
1. **Always Build & Verify**:
   - Run `npm run build` after any code modification. Ensure 0 compiler or bundler errors.
2. **Always Sync to Native Platforms**:
   - Run `npx cap sync android` to ensure the Capacitor Android wrapper contains the latest compiled web assets.
3. **Always Push to GitHub `main`**:
   - Stage and commit with clean conventional commit messages (e.g. `fix(locomotion): ...`, `feat(dungeon): ...`).
   - Push immediately to `origin main` so all progress is backed up and deployable.
4. **Mandatory Post-Fix Tricky Dev Quizzes**:
   - At the end of every bug fix response, present a **Tricky Engineering Multiple Choice Quiz** (2 questions, options A, B, C, D).
   - **Crucial Rule on Quiz Design**: **MAKE THE ANSWERS HARD TO FIND!**
     - Do NOT include silly or obvious joke answers (e.g., "the player ran out of battery" or "invisible suns").
     - Every option must read like real, plausible computer science / game engine mechanics (e.g., depth buffer float precision, shader fragment discard, Euler matrix multiplication order, backface culling winding order).
     - The user must genuinely analyze the underlying graphics or math mechanics to find the correct choice.
5. **Preserve Missed / Queued Questions**:
   - If the user reports a queue of bugs or cannot answer questions immediately, **remember all unanswered questions** and provide them when the user asks or in the next quiet cycle. Do not spoil the answers unless explicitly asked!

---

## 🏛️ Game Architecture & Key Subsystems

### 1. 3D Locomotion & Animation Rigging (`src/game.js`)
- **FBX & GLB Skeleton Normalization**:
  - `stripRootMotion(clip, animName)` strips root translation (`Hips.position`) so game physics controls player movement.
  - **Strafe Stabilization**: For `strafeLeft` and `strafeRight`, pitch ($X$) and roll ($Z$) rotations on `Hips`, `Spine`, `Neck`, and `Head` quaternion tracks are locked to $0^\circ$. This eliminates sideways torso tilting ($45^\circ$ lean into walls) caused by yaw/pitch rotational coupling when hips are turned $\sim 66^\circ$.
  - When animated mixers are active on `localPlayerVisual`, ensure `localPlayerVisual.rotation.z = 0` is strictly enforced.

### 2. Modular Dungeon & Carpet Runner System
- **2m × 2m Modular Hub Architecture**:
  - Straight hallways: 6m continuous runner rug (`createSeamlessRugGeo`).
  - Corners & T-Junctions: Modular 2m × 2m center tile (`createPureRedTileGeo`) with 2m extension arms (`createArmRugGeo`) and perimeter wall border strips (`createBorderStripGeo`).
  - Open corridor paths have **zero** crossing borders (no tripwire cuts).
  - Borders are elevated by $+0.002\text{m}$ ($2\text{mm}$) above red bases to completely prevent coplanar **Z-fighting**.
- **Golden Winged Crest Rug (`createCrestRugGeo`)**:
  - Center emblem quad is $2.0\text{m}$ wide by $0.95\text{m}$ long ($2.10 : 1$ aspect ratio), matching the $522\text{px} \times 238\text{px}$ texture atlas panel in `RugColor.png` at 1:1 pixel fidelity.
  - Flanked by two $2.525\text{m}$ seamless velvet runners on North and South ends.
  - The dragon head points forward down the corridor with wings spread wide laterally.
- **Opaque Rendering**: `dungeonRugMat.transparent = false` and `depthWrite = true` to prevent dark floor bleed-through and back-to-front sorting seams.

### 3. High-Performance Collision & Lighting Loop
- **$O(1)$ Spatial Neighborhood Collision**: Ghost bots and players check only the immediate $3 \times 3$ grid block neighborhood (9 checks) rather than scanning all 2,000 maze walls ($O(N)$), saving $358,000+$ math operations per second.
- **No Dynamic Light Floods**: Avoid spawning real-time `PointLight` instances in loops. Use unlit materials or cached single lights with strict radius limits.
- **Delta Clamping**: Game loop clamps `delta = Math.min(0.05, Math.max(0.0001, rawDelta))` to prevent physics tunneling or time jumps after ads or menu pauses.

### 4. Vault & Keypad
- Vault door is positioned at $Z = 3.0\text{m}$ (flush with the $6.0\text{m}$ cell edge, $6.0 / 2 = 3.0\text{m}$) inside a dedicated persistent `vaultGroup` so prop regenerators never delete it.
- Uses heavy gothic iron architrave with steel door mechanism and interactive keypad pillar.
