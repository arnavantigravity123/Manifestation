# Manifestation — Unity URP Project Setup Guide

## Prerequisites
Before opening in Unity, install these packages (Window → Package Manager):

| Package | Version | How |
|---|---|---|
| Universal Render Pipeline (URP) | 14.x | Unity Registry |
| TextMeshPro | 3.x | Unity Registry |
| AI Navigation | 1.x | Unity Registry |
| Input System | 1.x | Unity Registry |
| NativeWebSocket | latest | Add from Git URL: `https://github.com/endel/NativeWebSocket.git#upm` |
| RevenueCat Purchases Unity SDK | 5.x | Add from Git URL: `https://github.com/RevenueCat/purchases-unity.git` |

---

## Step-by-Step Unity Setup

### 1. Create the Unity Project
1. Open **Unity Hub** → **New project**
2. Select template: **3D (URP)**
3. Name: `Manifestation`
4. Location: point it to `c:\Antigravity agents\Manifestation\unity\`
5. Click **Create project**

> ⚠️ Unity will generate its own `Assets/` folder. Copy or move our
> `Assets/_Manifestation/` folder INTO the project's `Assets/` folder.

### 2. Install Packages (Package Manager)
Install all packages listed in the table above.

### 3. Configure URP
1. `Edit → Project Settings → Graphics`
2. Set **Scriptable Render Pipeline Settings** → drag in the URP asset
3. `Edit → Project Settings → Quality` → set all quality levels to URP

### 4. Scene Setup
Create a scene called `DungeonScene` and add these GameObjects:

```
_Bootstrapper       → SceneBootstrapper.cs
_GameState          → GameState.cs
_NetworkManager     → NetworkManager.cs + PlayerNetSync.cs
_PurchasesManager   → PurchasesManager.cs
Player (Prefab)     → PlayerController + PlayerCamera + PlayerStats + FlashlightController + Inventory + EMFRadar
MainCamera          → PlayerCamera.cs
Canvas (Screen Space Overlay)
  ├── HUD           → HUDController.cs
  │   ├── HealthBar (Slider)
  │   ├── SanityBar (Slider)
  │   ├── StaminaBar (Slider)
  │   └── BatteryBar (Slider)
  ├── Hotbar        → HotbarUI.cs
  │   ├── Slot0, Slot1, Slot2, Slot3
  ├── InteractionPrompt → InteractionPromptUI.cs
  └── VignetteOverlay (Image, full screen)
VaultGroup
  ├── VaultController.cs
  ├── VaultDoor (mesh)
  ├── CollisionBlocker (BoxCollider, isTrigger=false)
  └── EscapeZone     → EscapeTrigger.cs (BoxCollider, isTrigger=true)
WinSequence         → WinSequenceManager.cs
Keypad              → KeypadTerminal.cs
CircuitBreaker_1/2/3 → CircuitBreaker.cs
GhostEnemy          → GhostAI.cs (needs NavMeshAgent)
```

### 5. Bake NavMesh
1. Open **Window → AI → Navigation**
2. Select all floor/wall meshes → mark as **Navigation Static**
3. Click **Bake**

### 6. RevenueCat API Keys
In `PurchasesManager.cs` Inspector, fill in:
- **Apple API Key**: from RevenueCat Dashboard → Apple → API Keys
- **Google API Key**: from RevenueCat Dashboard → Google → API Keys

### 7. Build for Android
1. `File → Build Settings` → switch to **Android**
2. `Edit → Project Settings → Player`:
   - Package name: `com.yourname.manifestation`
   - Min SDK: API 24 (Android 7.0)
   - Target SDK: API 34
3. Click **Build & Run** with your Android device connected

---

## Script Dependency Map

```
GameState (singleton)
    ↑ written by: VaultController, WinSequenceManager, PurchasesManager
    ↑ read by:    EscapeTrigger, NetworkManager

PlayerStats (events)
    → HUDController (subscribes to health/sanity/stamina/battery events)

Inventory (events)
    → HotbarUI (subscribes to OnItemAdded/OnSlotChanged)

InteractionRaycaster (events)
    → InteractionPromptUI (subscribes to OnInteractableFound/Lost)

CircuitBreaker / CollectibleKey / KeypadTerminal (static events)
    → VaultController (subscribes to all three)

NetworkManager (events)
    → PlayerNetSync (subscribes to OnRemotePlayerMove)
```

---

## What You'll Need to Do Manually in Unity Editor

- [ ] Create **Animator Controllers** for Player and Ghost (Blend Tree for locomotion)
- [ ] Set up **URP Renderer Features** (SSAO, Bloom for horror lighting)
- [ ] Import **character FBX models** from `src/` assets into Unity
- [ ] Drag all **script references** in Inspector (prefabs, audio clips, UI elements)
- [ ] Create **ItemData ScriptableObjects** (Right-click Assets → Manifestation → Item Data)
- [ ] Place **Ghost enemy** in maze and assign NavMeshAgent settings
- [ ] Wire **RevenueCat API keys** in Inspector

---

*All C# scripts are complete. The above are editor-side wiring tasks that require the Unity GUI.*
