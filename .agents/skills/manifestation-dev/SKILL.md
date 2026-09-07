---
name: manifestation-dev
description: Master development skill for Manifestation 3D multiplayer labyrinth game for RevenueCat Ship-a-ton. Includes build/sync/push protocols, Three.js dungeon modular architecture, FBX animation rigging, spatial collision optimizations, and tricky quiz teaching workflows.
---

# Manifestation Game Development Skill

Use this skill whenever working on the **Manifestation** codebase. It provides the architectural blueprint, coding standards, native build pipeline, and user collaboration rules.

---

## 🎯 Developer Profile & Pair Programming Philosophy
- **Lead Developer**: Arnav (13-year-old game developer competing in the **RevenueCat Ship-a-ton**).
- **Teaching Style**: 
  - Explain bugs and architectural choices using clear, everyday analogies.
  - Never patronize; treat the developer as a serious game engineer learning deep 3D graphics, networking, and mathematical principles.
  - End every bug fix with a **Tricky Dev Quiz** (challenging multiple-choice questions with plausible, technically realistic distractors, NO silly joke answers).
  - If the developer has to leave or is queuing issues, track all unanswered questions so they can be reviewed later without spoiling the answers.

---

## 🚀 Mandatory Workflow Checklist (Every Bug / Feature)
1. **Source Edit**: Modify files cleanly, preserving existing structure and comments.
2. **Build Verification**: Run `npm run build` — must produce 0 Vite errors.
3. **Native Synchronization**: Run `npx cap sync android` to copy production assets to Android assets.
4. **Version Control**: `git add .` and `git commit -m "<conventional commit>"` then `git push origin main`.
5. **Tricky Multiple-Choice Quiz**: Present 2 non-trivial multiple choice questions (A, B, C, D) testing the graphics, math, or architectural concepts just applied.

---

## 🏛️ Core Codebase Anatomy

| Path | Purpose |
| :--- | :--- |
| `src/game.js` | Core Three.js game engine, rendering loop, modular dungeon prop system, FBX/GLB animation mixers, audio, minimap, vault, collision detection, and UI integration. |
| `server.js` | Express & Socket.IO multiplayer authoritative backend, lobby matchmaking, game sessions, and proximity voice mechanics. |
| `public/assets/` | 3D models (FBX characters, GLB kits), textures (`RugColor.png`, `hazmat_texture.png`), audio files. |
| `android/` | Capacitor Android native project containing Gradle wrapper, manifests, and web build assets. |

---

## 🔧 Critical Engine Standards

### 1. FBX Skeletal Locomotion & Strafe Rigging
- Mixamo strafe clips (`Left Strafe Walking.fbx`, `Right Strafe Walking (1).fbx`) have large intrinsic hip yaw ($\sim \pm 66^\circ$).
- In `stripRootMotion(clip, animName)`:
  - Remove all translation tracks matching `Hips.position` to let the game engine handle movement velocity.
  - For strafe animations, loop through quaternion keyframes on `Hips`, `Spine`, `Neck`, and `Head`.
  - Neutralize pitch ($X$) and roll ($Z$) rotations to $0^\circ$:
    ```javascript
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    e.x = 0; // Lock pitch
    e.z = 0; // Lock roll
    const nq = new THREE.Quaternion().setFromEuler(e);
    ```
  - This stops rotational coupling from tilting the character $45^\circ$ sideways into the wall.
  - In `animate()`, guarantee `localPlayerVisual.rotation.z = 0` whenever an animation mixer is active.

### 2. Dungeon Modular Rug Geometry & Texture Atlasing
- **Modular 2m × 2m Hubs**: Hallway corners and T-junctions are formed from:
  - `createPureRedTileGeo(2.0, 2.0)`: 100% solid red velvet center tile ($Y = 0.02$).
  - `createArmRugGeo(2.0, 2.0)`: Connector arms extending into open hallway branches.
  - `createBorderStripGeo(2.0, 0.20)`: Raised golden borders ($Y = 0.022$) placed **only along wall edges**, leaving open corridor intersections 100% borderless.
- **Z-Fighting Prevention**: A $+0.002\text{m}$ ($2\text{mm}$) elevation offset between base velvet and border strips stops coplanar depth-buffer rounding flicker.
- **Golden Winged Crest Rug (`createCrestRugGeo`)**:
  - Center quad size: $2.0\text{m}$ wide by $0.95\text{m}$ long ($2.10 : 1$ aspect ratio), matching the $522\text{px} \times 238\text{px}$ texture atlas panel ($2.19 : 1$) in `RugColor.png` at exact 1:1 pixel fidelity.
  - Front and back are joined with seamless $2.525\text{m}$ red runners.
  - Dragon head points forward along $-Z$ (down the corridor).
- **Opaque Material Setting**: Set `dungeonRugMat.transparent = false` and `depthWrite = true` to prevent dark floor see-through.

### 3. Loop & Collision Performance
- **Spatial Grid Neighborhood Collision**: For bot AI and player movement, never loop over all $N = 2{,}000$ walls. Query only the $3 \times 3$ grid cells surrounding the current coordinates ($O(1)$).
- **PointLight Flood Prevention**: Dynamic point lights require real-time shadow & lighting recomputation across hundreds of geometries. Use static/unlit emissive materials (`MeshBasicMaterial`) or cache single point lights.
- **Delta Clamping**: Always clamp loop delta (`Math.min(0.05, Math.max(0.0001, rawDelta))`) to prevent physics explosions after pauses or ad displays.
