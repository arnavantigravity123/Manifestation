import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let preloadedGhostModel = null;
let preloadedHumanModel = null;
let preloadedHumanFBX = null;
let hazmatSuitTexture = null;
const activeAnimationMixers = [];

const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
gltfLoader.setDRACOLoader(dracoLoader);

const fbxLoader = new FBXLoader();
const textureLoader = new THREE.TextureLoader();

// Complete 8-directional Locomotion Animation Clips Dictionary
const humanAnimClips = {
  idle: null,
  walk: null,
  sprint: null,
  walkBack: null,
  strafeLeft: null,
  strafeRight: null
};

const soldierNativeClips = {
  idle: null,
  walk: null,
  sprint: null,
  walkBack: null,
  strafeLeft: null,
  strafeRight: null
};

function getSoldierLocomotionClip(animName) {
  if (soldierNativeClips[animName]) {
    return soldierNativeClips[animName];
  }
  if (animName === 'walkBack' || animName === 'strafeLeft' || animName === 'strafeRight') {
    return soldierNativeClips.walk || soldierNativeClips.idle || null;
  }
  if (animName === 'sprint') {
    return soldierNativeClips.sprint || soldierNativeClips.walk || soldierNativeClips.idle || null;
  }
  return soldierNativeClips.idle || null;
}

// Optimized Hazmat PBR Textures (2K Albedo + 1K Normal + 1K Roughness + Metallic + AO, saving 93% GPU VRAM bandwidth)
const HAZMAT_TEX_VER = 'v=2.3';
let hazmatAlbedoTexture = null;
let hazmatNormalTexture = null;
let hazmatRoughnessTexture = null;
let hazmatMetallicTexture = null;
let hazmatAOTexture = null;

let hazmatSuitMaterial = null;
let hazmatVisorMaterial = null;

// Universal Fast Tap / Click Listener: eliminates 300ms mobile touch delay and responds in < 1ms
export function addFastTapListener(el, callback) {
  if (!el) return;
  let lastTrigger = 0;
  const fire = (e) => {
    const now = performance.now();
    if (now - lastTrigger < 120) return;
    lastTrigger = now;
    try {
      callback(e);
    } catch (err) {
      console.error('[FAST-TAP] Error executing callback:', el.id || el, err);
    }
  };
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    fire(e);
  });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    fire(e);
  });
}

export function getHazmatMaterials() {
  if (!hazmatAlbedoTexture) {
    hazmatAlbedoTexture = textureLoader.load('/assets/hazmat/Hazmat_albedo.jpeg?' + HAZMAT_TEX_VER, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      if (hazmatSuitMaterial) hazmatSuitMaterial.needsUpdate = true;
      if (hazmatVisorMaterial) hazmatVisorMaterial.needsUpdate = true;
    });
    hazmatAlbedoTexture.colorSpace = THREE.SRGBColorSpace;

    hazmatNormalTexture = textureLoader.load('/assets/hazmat/Hazmat_normal.png?' + HAZMAT_TEX_VER, (tex) => {
      tex.needsUpdate = true;
      if (hazmatSuitMaterial) hazmatSuitMaterial.needsUpdate = true;
    });

    hazmatRoughnessTexture = textureLoader.load('/assets/hazmat/Hazmat_roughness.jpeg?' + HAZMAT_TEX_VER, (tex) => {
      tex.needsUpdate = true;
      if (hazmatSuitMaterial) hazmatSuitMaterial.needsUpdate = true;
    });

    hazmatMetallicTexture = textureLoader.load('/assets/hazmat/Hazmat_metallic.jpeg?' + HAZMAT_TEX_VER, (tex) => {
      tex.needsUpdate = true;
      if (hazmatSuitMaterial) hazmatSuitMaterial.needsUpdate = true;
    });

    hazmatAOTexture = textureLoader.load('/assets/hazmat/Hazmat_AO.jpeg?' + HAZMAT_TEX_VER, (tex) => {
      tex.needsUpdate = true;
      if (hazmatSuitMaterial) hazmatSuitMaterial.needsUpdate = true;
    });
  }

  if (!hazmatSuitMaterial) {
    const isMobile = isMobileDevice || isLowEndHardware;
    hazmatSuitMaterial = new THREE.MeshStandardMaterial({
      map: hazmatAlbedoTexture,
      normalMap: !isMobile ? hazmatNormalTexture : null,
      roughnessMap: !isMobile ? hazmatRoughnessTexture : null,
      metalnessMap: !isMobile ? hazmatMetallicTexture : null,
      aoMap: !isMobile ? hazmatAOTexture : null,
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.FrontSide
    });
  }

  if (!hazmatVisorMaterial) {
    hazmatVisorMaterial = new THREE.MeshStandardMaterial({
      map: hazmatAlbedoTexture,
      color: 0x0f172a,
      roughness: 0.05,
      metalness: 0.92,
      side: THREE.DoubleSide
    });
  }

  return { hazmatSuitMaterial, hazmatVisorMaterial };
}

// Apply dedicated authentic modular PBR materials to Hazmat Operative submeshes
export function applyHazmatMaterials(root) {
  if (!root) return;
  const { hazmatSuitMaterial: suitMat, hazmatVisorMaterial: visorMat } = getHazmatMaterials();

  root.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = false;

      // Provide uv2 for AO map calculation
      if (child.geometry && child.geometry.attributes.uv && !child.geometry.attributes.uv2) {
        child.geometry.attributes.uv2 = child.geometry.attributes.uv;
      }

      const name = child.name || '';
      if (name.includes('Cube001_Cube')) {
        // Helmet Visor / Face Shield — Deep glossy tinted obsidian polycarbonate shield
        child.material = visorMat;
      } else {
        // Suit Body, Hood, Arms, Legs, Biohazard Symbol, Gloves, Boots, Belt, and Life Support
        // Powered by authentic 4K Albedo + 2K Normal + 4K Roughness + Metallic + AO maps
        child.material = suitMat;
      }

      child.userData.normalMat = child.material;
    }
  });
}

let soldierDiffuseTexture = null;
let soldierNormalTexture = null;
textureLoader.load('/assets/soldier/textures/vanguard_diffuse.png', (tex) => {
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  soldierDiffuseTexture = tex;
  if (preloadedSoldierModel) {
    preloadedSoldierModel.traverse((child) => {
      if (child.isMesh && child.name === 'vanguard_Mesh' && child.material) {
        child.material.map = soldierDiffuseTexture;
        child.material.needsUpdate = true;
      }
    });
  }
});
textureLoader.load('/assets/soldier/textures/vanguard_normal.png', (tex) => {
  tex.flipY = false;
  soldierNormalTexture = tex;
  if (preloadedSoldierModel) {
    preloadedSoldierModel.traverse((child) => {
      if (child.isMesh && child.name === 'vanguard_Mesh' && child.material) {
        child.material.normalMap = soldierNormalTexture;
        child.material.needsUpdate = true;
      }
    });
  }
});


// Golden VIP Status & Skin Integrity Preservation
export function applyVipGlow(object3D, enabled = true, color = 0xffd700) {
  if (!object3D) return;
  object3D.userData = object3D.userData || {};
  if (enabled) {
    object3D.userData.isVip = true;
  }

  // Remove any internal yellow point light that washes out the character's textures
  const vipLight = object3D.getObjectByName('vipGlowLight');
  if (vipLight) {
    vipLight.visible = false;
    object3D.remove(vipLight);
  }

  // Restore and maintain authentic mesh textures (NEVER overwrite emissive or diffuse with yellow paint)
  object3D.traverse(c => {
    if (c.userData && c.userData.isUsernameTag) return;
    if (c.isMesh && c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(m => {
        if (!m) return;
        if (m.userData && m.userData.origEmissive) {
          m.emissive.copy(m.userData.origEmissive);
          m.emissiveIntensity = m.userData.origEmissiveIntensity !== undefined ? m.userData.origEmissiveIntensity : 0;
        } else if (m.emissive && m.emissive.getHex() === 0xffd700) {
          m.emissive.setHex(0x000000);
          m.emissiveIntensity = 0;
        }
      });
    } else if (c.isSprite && c.material && !c.userData?.isUsernameTag) {
      if (c.userData && c.userData.origColor) {
        c.material.color.copy(c.userData.origColor);
      }
    }
  });
}

window.applyVipGlow = applyVipGlow;
window.updateAllVipGlows = function(enabled) {
  const isVipLocal = window.isVipActive ? window.isVipActive() : false;
  if (typeof localPlayerVisual !== 'undefined' && localPlayerVisual && isVipLocal) {
    applyVipGlow(localPlayerVisual, enabled);
  }
  if (typeof players3D !== 'undefined') {
    Object.values(players3D).forEach(pMesh => {
      if (pMesh && pMesh.userData && pMesh.userData.isVip) {
        applyVipGlow(pMesh, enabled);
      }
    });
  }
};

function upgradeMeshGroupToFBX(group) {
  if (!group || !preloadedHumanFBX) return;
  if (group.userData && group.userData.skinId && group.userData.skinId !== 'skin_hazmat') {
    return; // Preserve custom skins
  }
  // Remove non-username children
  const toRemove = [];
  group.children.forEach(c => {
    if (c.userData && c.userData.isUsernameTag) return;
    toRemove.push(c);
  });
  toRemove.forEach(c => group.remove(c));

  const clone = SkeletonUtils.clone(preloadedHumanFBX);
  applyHazmatMaterials(clone);
  group.add(clone);

  // Setup full 8-directional locomotion animation mixer & actions for Hazmat
  const mixer = new THREE.AnimationMixer(clone);
  const actions = {};

  Object.keys(humanAnimClips).forEach(key => {
    const clip = humanAnimClips[key];
    if (clip) {
      actions[key] = mixer.clipAction(clip);
    }
  });

  if (actions.idle) {
    actions.idle.play();
  } else if (preloadedHumanFBX.animations && preloadedHumanFBX.animations.length > 0) {
    const act = mixer.clipAction(preloadedHumanFBX.animations[0]);
    act.play();
    actions.idle = act;
  }

  activeAnimationMixers.push(mixer);
  group.userData.animMixer = mixer;
  group.userData.animActions = actions;
  group.userData.currentAction = 'idle';

  if (group.userData && group.userData.isVip && (window.isVipGlowEnabled ? window.isVipGlowEnabled() : true)) {
    applyVipGlow(group, true);
  }
}

// Strip root motion (Hips position tracks) from animation clips so the game physics controls position
function stripRootMotion(clip, animName) {
  if (!clip || !clip.tracks) return clip;
  clip.tracks = clip.tracks.filter(track => {
    // Remove position tracks on the root bone (Hips) — keeps natural rotational kinematics intact
    const isRootPosition = track.name.match(/Hips\.position/) || track.name.match(/^position/);
    return !isRootPosition;
  });

  // Strafe Stabilization (Mandatory Rule from AGENTS.md / GEMINI.md):
  // For strafeLeft and strafeRight, lock pitch (X) and roll (Z) rotations on Hips, Spine, Neck, and Head
  // quaternion tracks to 0 to eliminate sideways torso tilting (45° lean into walls) caused by yaw/pitch coupling.
  if (animName === 'strafeLeft' || animName === 'strafeRight') {
    const stabilizedBones = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'];
    const _q = new THREE.Quaternion();
    const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
    clip.tracks.forEach(track => {
      if (track.name.endsWith('.quaternion')) {
        const boneName = track.name.split('.')[0];
        if (stabilizedBones.some(sb => boneName.includes(sb))) {
          const vals = track.values;
          for (let i = 0; i < vals.length; i += 4) {
            _q.fromArray(vals, i);
            _euler.setFromQuaternion(_q, 'YXZ');
            _euler.x = 0; // Lock pitch
            _euler.z = 0; // Lock roll
            _q.setFromEuler(_euler);
            _q.toArray(vals, i);
          }
        }
      }
    });
  }

  return clip;
}

function registerAnimationToActiveMixers(animName, clip) {
  if (!clip) return;
  stripRootMotion(clip, animName);
  humanAnimClips[animName] = clip;
  clip.name = animName;

  const bindToEntity = (entity) => {
    if (!entity || !entity.userData || !entity.userData.animMixer) return;
    // Soldier character exclusively uses native GLTF skeleton animations — never bind FBX clips!
    if (entity.userData.skinId === 'skin_soldier') return;

    const mixer = entity.userData.animMixer;
    entity.userData.animActions = entity.userData.animActions || {};
    entity.userData.animActions[animName] = mixer.clipAction(clip);
    if (entity.userData.currentAction === animName) {
      setHumanLocomotionAction(entity, animName, 0.15);
    }
  };

  if (localPlayerVisual) bindToEntity(localPlayerVisual);
  Object.values(players3D).forEach(p => bindToEntity(p));
}
let isHazmatLoading = false;
let isHumanGLBLoading = false;
let isGhostGLBLoading = false;
let preloadedSoldierModel = null;
let isSoldierLoading = false;


function upgradeMeshGroupToSoldier(group) {
  if (!group || !preloadedSoldierModel) return;
  if (group.userData && group.userData.skinId && group.userData.skinId !== 'skin_soldier') {
    return; // Preserve other skins
  }
  // Remove non-username children
  const toRemove = [];
  group.children.forEach(c => {
    if (c.userData && c.userData.isUsernameTag) return;
    toRemove.push(c);
  });
  toRemove.forEach(c => group.remove(c));

  if (group.userData && group.userData.animMixer) {
    const oldIdx = activeAnimationMixers.indexOf(group.userData.animMixer);
    if (oldIdx !== -1) activeAnimationMixers.splice(oldIdx, 1);
    group.userData.animMixer.stopAllAction();
  }

  const clone = SkeletonUtils.clone(preloadedSoldierModel);
  group.add(clone);

  const mixer = new THREE.AnimationMixer(clone);
  const actions = {};

  ['idle', 'walk', 'sprint', 'walkBack', 'strafeLeft', 'strafeRight'].forEach(key => {
    const clip = getSoldierLocomotionClip(key);
    if (clip) {
      actions[key] = mixer.clipAction(clip);
    }
  });

  if (actions.idle) {
    actions.idle.play();
  }

  activeAnimationMixers.push(mixer);
  group.userData.animMixer = mixer;
  group.userData.animActions = actions;
  group.userData.currentAction = 'idle';

  if (group.userData && group.userData.isVip && (window.isVipGlowEnabled ? window.isVipGlowEnabled() : true)) {
    applyVipGlow(group, true);
  }
}

function upgradeMeshGroupToGLB(group) {
  if (!group || !preloadedHumanModel) return;
  if (group.userData && group.userData.skinId && group.userData.skinId !== 'skin_default') return;
  // Remove non-username children
  const toRemove = [];
  group.children.forEach(c => {
    if (c.userData && c.userData.isUsernameTag) return;
    toRemove.push(c);
  });
  toRemove.forEach(c => group.remove(c));

  const clone = SkeletonUtils.clone(preloadedHumanModel);
  clone.rotation.y = Math.PI; // Face forward direction
  group.add(clone);

  if (group.userData && group.userData.isVip && (window.isVipGlowEnabled ? window.isVipGlowEnabled() : true)) {
    applyVipGlow(group, true);
  }
}

export function loadHazmatFBXAssets() {
  if (preloadedHumanFBX || isHazmatLoading) return;
  isHazmatLoading = true;

  // Load authentic Hazmat Suit 3D Model with Breathing Idle animation
  fbxLoader.load('/assets/human_idle.fbx', (fbx) => {
    if (fbx.animations && fbx.animations.length > 0) {
      registerAnimationToActiveMixers('idle', fbx.animations[0]);
    }

    // Compute true bounding box and scale to standard player height (1.85 meters)
    const initialBox = new THREE.Box3().setFromObject(fbx);
    const rawSize = initialBox.getSize(new THREE.Vector3());
    const rawHeight = rawSize.y || 180;
    
    const targetHeight = 1.85;
    const scale = targetHeight / rawHeight;
    fbx.scale.set(scale, scale, scale);
    fbx.rotation.y = Math.PI; // Face forward direction

    // Recenter pivot so feet rest perfectly on the floor (y = 0) and centered on X/Z
    const scaledBox = new THREE.Box3().setFromObject(fbx);
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    fbx.position.x = -scaledCenter.x;
    fbx.position.z = -scaledCenter.z;
    fbx.position.y = -scaledBox.min.y;

    // Apply authentic modular PBR materials across suit, visor, boots, belt, and life support
    applyHazmatMaterials(fbx);

    preloadedHumanFBX = fbx;
    isHazmatLoading = false;

    // Upgrade localPlayerVisual if skin_hazmat was waiting for FBX
    if (localPlayerVisual && localPlayerVisual.userData && localPlayerVisual.userData.skinId === 'skin_hazmat' && !localPlayerVisual.userData.animMixer) {
      upgradeMeshGroupToFBX(localPlayerVisual);
    }

    // Upgrade all remote human players with skin_hazmat
    Object.values(players3D).forEach(p => {
      if (p && p.userData && p.userData.skinId === 'skin_hazmat' && !p.userData.animMixer) {
        upgradeMeshGroupToFBX(p);
      }
    });
  }, undefined, (err) => {
    console.error('[HAZMAT] Failed to load human_idle.fbx:', err);
    isHazmatLoading = false;
  });

  loadLocomotionFBXClips();
}

function disposeUnusedFBXMesh(group) {
  if (!group || typeof group.traverse !== 'function') return;
  group.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(m => m && m.dispose());
      else child.material.dispose();
    }
  });
}

let isLocomotionClipsLoading = false;
export function loadLocomotionFBXClips() {
  if (isLocomotionClipsLoading) return;
  isLocomotionClipsLoading = true;

  // 0. Load Breathing Idle animation (Mixamo FBX)
  fbxLoader.load('/assets/Breathing Idle.fbx', (anim) => {
    if (anim.animations && anim.animations.length > 0) {
      registerAnimationToActiveMixers('idle', anim.animations[0]);
    }
    disposeUnusedFBXMesh(anim);
  });

  // 1. Load Walk Forward animation (With-Skin FBX)
  fbxLoader.load('/assets/Walking (1).fbx', (anim) => {
    if (anim.animations && anim.animations.length > 0) {
      registerAnimationToActiveMixers('walk', anim.animations[0]);
    }
    disposeUnusedFBXMesh(anim);
  }, undefined, () => {
    fbxLoader.load('/assets/Walking.fbx', (anim) => {
      if (anim.animations && anim.animations.length > 0) {
        registerAnimationToActiveMixers('walk', anim.animations[0]);
      }
      disposeUnusedFBXMesh(anim);
    });
  });

  // 2. Load Sprint Forward animation (With-Skin FBX)
  fbxLoader.load('/assets/Sprint.fbx', (anim) => {
    if (anim.animations && anim.animations.length > 0) {
      registerAnimationToActiveMixers('sprint', anim.animations[0]);
    }
    disposeUnusedFBXMesh(anim);
  }, undefined, () => {
    fbxLoader.load('/assets/Standing Sprint Forward.fbx', (anim) => {
      if (anim.animations && anim.animations.length > 0) {
        registerAnimationToActiveMixers('sprint', anim.animations[0]);
      }
      disposeUnusedFBXMesh(anim);
    });
  });

  // 3. Load Walk Backwards animation (With-Skin FBX)
  fbxLoader.load('/assets/Walking Backwards (1).fbx', (anim) => {
    if (anim.animations && anim.animations.length > 0) {
      registerAnimationToActiveMixers('walkBack', anim.animations[0]);
    }
    disposeUnusedFBXMesh(anim);
  }, undefined, () => {
    fbxLoader.load('/assets/Walking Backwards.fbx', (anim) => {
      if (anim.animations && anim.animations.length > 0) {
        registerAnimationToActiveMixers('walkBack', anim.animations[0]);
      }
      disposeUnusedFBXMesh(anim);
    });
  });

  // 4. Load Left Strafe Walk animation (With-Skin FBX)
  fbxLoader.load('/assets/Left Strafe Walking.fbx', (anim) => {
    if (anim.animations && anim.animations.length > 0) {
      registerAnimationToActiveMixers('strafeLeft', anim.animations[0]);
    }
    disposeUnusedFBXMesh(anim);
  }, undefined, () => {
    fbxLoader.load('/assets/Left Strafe Walk.fbx', (anim) => {
      if (anim.animations && anim.animations.length > 0) {
        registerAnimationToActiveMixers('strafeLeft', anim.animations[0]);
      }
      disposeUnusedFBXMesh(anim);
    });
  });

  // 5. Load Right Strafe Walk animation (With-Skin FBX)
  fbxLoader.load('/assets/Right Strafe Walking (1).fbx', (anim) => {
    if (anim.animations && anim.animations.length > 0) {
      registerAnimationToActiveMixers('strafeRight', anim.animations[0]);
    }
    disposeUnusedFBXMesh(anim);
  }, undefined, () => {
    fbxLoader.load('/assets/Right Strafe Walking.fbx', (anim) => {
      if (anim.animations && anim.animations.length > 0) {
        registerAnimationToActiveMixers('strafeRight', anim.animations[0]);
      }
      disposeUnusedFBXMesh(anim);
    });
  });
}

export function loadHumanGLBAsset() {
  if (preloadedHumanModel || isHumanGLBLoading) return;
  isHumanGLBLoading = true;

  gltfLoader.load('/assets/human_model.glb', (gltf) => {
    preloadedHumanModel = gltf.scene;
    
    // Scale accurately to canonical player height (1.85 meters) matching the Hazmat suit
    const initialBox = new THREE.Box3().setFromObject(preloadedHumanModel);
    const rawSize = initialBox.getSize(new THREE.Vector3());
    const rawHeight = rawSize.y || 2.0;
    const targetHeight = 1.85;
    const scale = targetHeight / rawHeight;
    preloadedHumanModel.scale.set(scale, scale, scale);
    
    const scaledBox = new THREE.Box3().setFromObject(preloadedHumanModel);
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    
    preloadedHumanModel.position.x = -scaledCenter.x;
    preloadedHumanModel.position.z = -scaledCenter.z;
    preloadedHumanModel.position.y = -scaledBox.min.y; 
    
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

    isHumanGLBLoading = false;

    // Upgrade localPlayerVisual if skin_default was waiting for GLB to load
    if (localPlayerVisual && localPlayerVisual.userData && localPlayerVisual.userData.skinId === 'skin_default') {
      upgradeMeshGroupToGLB(localPlayerVisual);
    }

    // Upgrade any remote players equipped with skin_default
    Object.values(players3D).forEach(p => {
      if (p && p.userData && p.userData.skinId === 'skin_default') {
        upgradeMeshGroupToGLB(p);
      }
    });
  });
}

// Procedural Strafe Clip Generator: turns Hips into movement vector while counter-rotating Spine forward
function createSoldierStrafeClip(baseClip, clipName, yawAngleRad) {
  const strafeClip = baseClip.clone();
  strafeClip.name = clipName;

  const qHipsYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawAngleRad);
  const qSpineYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yawAngleRad);

  strafeClip.tracks.forEach(track => {
    if (track.name.endsWith('Hips.quaternion')) {
      const vals = track.values;
      const q = new THREE.Quaternion();
      for (let i = 0; i < vals.length; i += 4) {
        q.fromArray(vals, i);
        q.multiply(qHipsYaw);
        q.toArray(vals, i);
      }
    } else if (track.name.endsWith('Spine.quaternion')) {
      const vals = track.values;
      const q = new THREE.Quaternion();
      for (let i = 0; i < vals.length; i += 4) {
        q.fromArray(vals, i);
        q.premultiply(qSpineYaw);
        q.toArray(vals, i);
      }
    }
  });
  return strafeClip;
}

export function loadSoldierAsset() {
  loadLocomotionFBXClips();
  if (preloadedSoldierModel || isSoldierLoading) return;
  isSoldierLoading = true;

  gltfLoader.load('/assets/soldier_animated.glb', (gltf) => {
    const model = gltf.scene;
    // Scale accurately to standard player height (1.85 meters)
    const initialBox = new THREE.Box3().setFromObject(model);
    const rawSize = initialBox.getSize(new THREE.Vector3());
    const rawHeight = rawSize.y || 1.832;
    const targetHeight = 1.85;
    const scale = targetHeight / rawHeight;
    model.scale.set(scale, scale, scale);
    // Note: soldier_animated.glb naturally faces -Z (forward direction), so no Math.PI rotation is applied

    // Center pivot so feet rest cleanly at y = 0
    const scaledBox = new THREE.Box3().setFromObject(model);
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    model.position.x = -scaledCenter.x;
    model.position.z = -scaledCenter.z;
    model.position.y = -scaledBox.min.y;

    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.frustumCulled = false;
        if (child.name === 'vanguard_Mesh') {
          child.material = new THREE.MeshStandardMaterial({
            map: soldierDiffuseTexture || null,
            normalMap: soldierNormalTexture || null,
            roughness: 0.40,
            metalness: 0.20,
            side: THREE.DoubleSide
          });
        } else if (child.name === 'vanguard_visor') {
          child.material = new THREE.MeshStandardMaterial({
            color: 0x111827,
            roughness: 0.08,
            metalness: 0.90,
            side: THREE.DoubleSide
          });
        }
        child.userData.normalMat = child.material;
      }
    });

    // Store native GLB clips for soldier
    if (gltf.animations && gltf.animations.length > 0) {
      gltf.animations.forEach(clip => {
        const lowerName = clip.name.toLowerCase();
        if (lowerName.includes('idle')) {
          soldierNativeClips.idle = clip;
        } else if (lowerName.includes('run')) {
          soldierNativeClips.sprint = clip;
        } else if (lowerName.includes('walk')) {
          soldierNativeClips.walk = clip;
        }
      });
      if (soldierNativeClips.walk) {
        soldierNativeClips.walkBack = soldierNativeClips.walk.clone();
        soldierNativeClips.walkBack.name = 'walkBack';
        // Dedicated authentic sideways strafe cycles: hips angled 70 deg into movement direction, spine oriented forward!
        soldierNativeClips.strafeLeft = createSoldierStrafeClip(soldierNativeClips.walk, 'strafeLeft', (70 * Math.PI) / 180);
        soldierNativeClips.strafeRight = createSoldierStrafeClip(soldierNativeClips.walk, 'strafeRight', (-70 * Math.PI) / 180);
      }
    }

    preloadedSoldierModel = model;
    isSoldierLoading = false;

    // Helper to rebind all native soldier actions to an existing soldier entity
    const rebindSoldierActions = (entity) => {
      if (!entity || !entity.userData || !entity.userData.animMixer || entity.userData.skinId !== 'skin_soldier') return;
      const mixer = entity.userData.animMixer;
      entity.userData.animActions = {};
      ['idle', 'walk', 'sprint', 'walkBack', 'strafeLeft', 'strafeRight'].forEach(key => {
        const c = getSoldierLocomotionClip(key);
        if (c) {
          entity.userData.animActions[key] = mixer.clipAction(c);
        }
      });
      if (entity.userData.animActions.idle) {
        entity.userData.animActions.idle.play();
      }
      entity.userData.currentAction = 'idle';
    };

    // Upgrade localPlayerVisual if skin_soldier was waiting for model to load
    if (localPlayerVisual && localPlayerVisual.userData && localPlayerVisual.userData.skinId === 'skin_soldier') {
      if (!localPlayerVisual.userData.animMixer) {
        upgradeMeshGroupToSoldier(localPlayerVisual);
      } else {
        rebindSoldierActions(localPlayerVisual);
      }
    }

    // Upgrade all remote human players with skin_soldier
    Object.values(players3D).forEach(p => {
      if (p && p.userData && p.userData.skinId === 'skin_soldier') {
        if (!p.userData.animMixer) {
          upgradeMeshGroupToSoldier(p);
        } else {
          rebindSoldierActions(p);
        }
      }
    });
  }, undefined, (err) => {
    console.error('[SOLDIER] Failed to load soldier_animated.glb:', err);
    isSoldierLoading = false;
  });
}
export const loadSoldierFBXAssets = loadSoldierAsset;


export function loadGhostGLBAsset() {
  if (preloadedGhostModel || isGhostGLBLoading) return;
  isGhostGLBLoading = true;

  gltfLoader.load('/assets/ghost_model.glb', (gltf) => {
    preloadedGhostModel = gltf.scene;
    // Scale 1.6 provides a menacing, imposing presence (~3.2m tall) that fills the corridor while remaining comfortably within the 3.2m pillar clearance
    preloadedGhostModel.scale.set(1.6, 1.6, 1.6);

    // Center the model's pivot point so it rotates in place instead of sweeping
    const box = new THREE.Box3().setFromObject(preloadedGhostModel);
    const center = box.getCenter(new THREE.Vector3());

    preloadedGhostModel.position.x = -center.x;
    preloadedGhostModel.position.z = -center.z;
    preloadedGhostModel.position.y = -box.min.y + 0.15; // Hover menacingly just above the red runner rug
    
    preloadedGhostModel.traverse((child) => {
      if (child.isMesh) {
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
    isGhostGLBLoading = false;
  }, undefined, (error) => {
    console.error("Failed to load ghost model:", error);
    isGhostGLBLoading = false;
  });
}

// Preload 3D Ghost Model immediately for all matches
loadGhostGLBAsset();

// ==========================================
// 3D FOREST OUTDOOR ENVIRONMENT (ESCAPE DESTINATION)
// ==========================================
let preloadedForestModel = null;
let isForestLoading = false;
let vaultGroupRef = null;
let forestSceneInstance = null;

function disposeHierarchy(obj) {
  if (!obj) return;
  obj.traverse(child => {
    if (child.isMesh || child.isPoints) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    }
  });
}

export function loadForestAsset() {
  if (preloadedForestModel || isForestLoading) return;
  isForestLoading = true;

  gltfLoader.load('/assets/forest.glb', (gltf) => {
    preloadedForestModel = gltf.scene;

    preloadedForestModel.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          child.material.roughness = Math.max(0.65, child.material.roughness || 0.65);
          if (child.material.transparent) {
            child.material.depthWrite = true;
            child.material.alphaTest = 0.35;
          }
        }
      }
    });

    isForestLoading = false;
    console.log("[FOREST] 3D Forest environment model loaded successfully!");
    if (forestSceneInstance) {
      addGLBModelToForest(forestSceneInstance);
    }
  }, undefined, (err) => {
    console.warn('[FOREST] Error loading /assets/forest.glb:', err);
    isForestLoading = false;
  });
}

function addGLBModelToForest(forestContainer) {
  if (!preloadedForestModel || !forestContainer || forestContainer.userData.hasGlb) return;
  try {
    const forestCloneWrapper = new THREE.Group();
    forestCloneWrapper.name = 'forest_glb_wrapper';
    // Accurately scales trail to 4.8m width and pine trees to 14m height
    const scale = 0.016;
    forestCloneWrapper.scale.set(scale, scale, scale);

    const forestClone = preloadedForestModel.clone(true);
    // CRUCIAL FIX: GLTFLoader already parses Node 0's -90 deg X-axis rotation matrix from Sketchfab.
    // Setting rotation.x = 0 keeps the model upright (Y-up) without inverted flipping.
    // Rotating around Y by 315 deg (7*PI/4) points the magnificent white marble sitting rotunda,
    // peaceful lake, and pine mountain amphitheater directly toward the open vault doorway!
    forestClone.rotation.x = 0;
    forestClone.rotation.y = (315 * Math.PI) / 180;
    forestClone.rotation.z = 0;
    // Perfectly aligns the white marble sitting pavilion and water 18m in front of the doorway threshold
    forestClone.position.set(-629.33, -930.10, -1718.69);

    forestClone.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.frustumCulled = false;
        if (child.material) {
          child.material.side = THREE.DoubleSide;
          if (child.material.transparent) {
            child.material.alphaTest = 0.35;
            child.material.depthWrite = true;
          }
        }
      }
    });

    forestCloneWrapper.add(forestClone);
    forestContainer.add(forestCloneWrapper);
    forestContainer.userData.hasGlb = true;
    console.log('[FOREST] Authentic 3D Forest model (/assets/forest.glb) mounted to outdoor world successfully!');
  } catch (e) {
    console.warn('[FOREST] Error attaching GLB model to forest container:', e);
  }
}

// Preload forest.glb and latern.glb immediately so they are ready
loadForestAsset();
loadLanternAsset();

export function attachForestToVault() {
  if (!vaultGroupRef) return;

  if (forestSceneInstance && forestSceneInstance.parent) {
    forestSceneInstance.parent.remove(forestSceneInstance);
    disposeHierarchy(forestSceneInstance);
  }

  const forestContainer = new THREE.Group();
  forestContainer.name = 'forest_outdoor_world';
  // Kept strictly 100% hidden during normal maze gameplay — only revealed when escaping through the vault!
  forestContainer.visible = false;

  // 1. Outdoor Natural Sunlight & Sky Light
  const outdoorSun = new THREE.DirectionalLight(0xfffae0, 3.4);
  outdoorSun.position.set(18, 40, -30);
  outdoorSun.target.position.set(0, 2, -15);
  outdoorSun.visible = false;
  forestContainer.add(outdoorSun);
  forestContainer.add(outdoorSun.target);

  const skyHemisphere = new THREE.HemisphereLight(0xbfe3ff, 0x245229, 2.4);
  skyHemisphere.position.set(0, 40, -20);
  skyHemisphere.visible = false;
  forestContainer.add(skyHemisphere);

  forestContainer.userData.outdoorSun = outdoorSun;
  forestContainer.userData.skyHemisphere = skyHemisphere;

  // 2. Atmospheric Volumetric God Rays streaming down into the forest
  const rayGeo = new THREE.CylinderGeometry(0.5, 3.2, 28, 8, 1, true);
  const rayMat = new THREE.MeshBasicMaterial({
    color: 0xfffae0,
    transparent: true,
    opacity: 0.035,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const rayAngles = [
    { x: -8, y: 14, z: -16, rotZ: -0.22, rotX: 0.15 },
    { x: 7,  y: 15, z: -20, rotZ: -0.28, rotX: 0.18 },
    { x: -6, y: 16, z: -28, rotZ: -0.24, rotX: 0.20 },
    { x: 8,  y: 15, z: -32, rotZ: -0.30, rotX: 0.14 }
  ];
  rayAngles.forEach(ra => {
    const ray = new THREE.Mesh(rayGeo, rayMat);
    ray.position.set(ra.x, ra.y, ra.z);
    ray.rotation.z = ra.rotZ;
    ray.rotation.x = ra.rotX;
    forestContainer.add(ray);
  });

  // 3. Drifting Golden Sun Dust / Forest Pollen Particles
  const moteCount = 140;
  const moteGeo = new THREE.BufferGeometry();
  const motePositions = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    motePositions[i * 3 + 0] = (Math.random() - 0.5) * 26; // X
    motePositions[i * 3 + 1] = 0.5 + Math.random() * 7.5;  // Y
    motePositions[i * 3 + 2] = -Math.random() * 35;        // Z
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const moteMat = new THREE.PointsMaterial({
    color: 0xffe699,
    size: 0.16,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  forestContainer.add(motes);

  // 4. Attach the authentic 3D forest.glb model!
  if (preloadedForestModel) {
    addGLBModelToForest(forestContainer);
  } else {
    loadForestAsset();
  }

  vaultGroupRef.add(forestContainer);
  forestSceneInstance = forestContainer;
}

// 3D Forest Environment Model is preloaded and augmented with procedural scenery

let scene, camera, renderer;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let mobileSprintLocked = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let prevTime = performance.now();
let localPlayerGroundSpeed = 0;
export const currentlyHeldKeys = new Set();
export let joystickTouchId = null;

export function resetPlayerMovementState(force = false) {
  // If player is actively using the mobile joystick (finger on screen), do NOT reset joystick unless forced (e.g. game paused, player captured)
  const isHoldingJoy = (joystickTouchId !== null);
  if (!force && isHoldingJoy && isMobileDevice) {
    return;
  }
  if (!force && !isMobileDevice && currentlyHeldKeys.size > 0 && typeof document.hasFocus === 'function' && document.hasFocus()) {
    // Re-verify keyboard state instead of resetting to false
    moveForward = currentlyHeldKeys.has('KeyW') || currentlyHeldKeys.has('ArrowUp');
    moveBackward = currentlyHeldKeys.has('KeyS') || currentlyHeldKeys.has('ArrowDown');
    moveLeft = currentlyHeldKeys.has('KeyA') || currentlyHeldKeys.has('ArrowLeft');
    moveRight = currentlyHeldKeys.has('KeyD') || currentlyHeldKeys.has('ArrowRight');
    return;
  }
  moveForward = false;
  moveBackward = false;
  moveLeft = false;
  moveRight = false;
  isSprinting = false;
  mobileSprintLocked = false;
  localPlayerGroundSpeed = 0;
  if (velocity) velocity.set(0, 0, 0);
  if (direction) direction.set(0, 0, 0);

  const jb = document.getElementById('joystick-base');
  const jk = document.getElementById('joystick-knob');
  if (jb) jb.classList.remove('sprinting');
  if (jk) {
    jk.classList.remove('sprinting');
    jk.style.transform = 'translate(0px, 0px)';
  }
  const sb = document.getElementById('btn-mobile-sprint');
  if (sb) sb.classList.remove('sprinting');
  if (force) {
    joystickTouchId = null;
  }

  if (typeof localPlayerVisual !== 'undefined' && localPlayerVisual) {
    if (localPlayerVisual.userData && localPlayerVisual.userData.animMixer) {
      setHumanLocomotionAction(localPlayerVisual, 'idle', 0.05);
    }
    localPlayerVisual.rotation.z = 0;
  }
}
window.resetPlayerMovementState = resetPlayerMovementState;
export function detectMobileDevice() {
  const isNative = Boolean(
    window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === 'function' &&
    window.Capacitor.isNativePlatform()
  );
  if (isNative) return true;

  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  if (isMobileUA) return true;

  // Desktop PCs and laptops (Windows, macOS, Linux) with keyboards and mice
  // must NEVER default to mobile touch mode just because the screen has touch sensors!
  // (e.g. Windows touchscreen laptops like Surface, Lenovo Yoga, Dell XPS, HP Spectre, etc.)
  if (/Windows NT|X11; Linux/i.test(ua) && !/Android/i.test(ua)) {
    return false;
  }

  // macOS (differentiate real Mac desktop from iPadOS Safari requesting desktop site)
  if (/Macintosh|Mac OS X/i.test(ua) && (!navigator.maxTouchPoints || navigator.maxTouchPoints <= 1)) {
    return false;
  }

  // Fallback for mobile devices / tablets
  return ('ontouchstart' in window) && (navigator.maxTouchPoints > 1);
}

export let isMobileDevice = detectMobileDevice();
window.isMobileDevice = isMobileDevice;

export function detectLowEndOrIntegratedGPU() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return false;
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return false;
    const rendererStr = (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
    const isIntegrated = /intel|uhd|hd graphics|iris|radeon\(tm\)|vega|mali|adreno|swiftshader|llvmpipe/i.test(rendererStr);
    const lowCores = typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4;
    return isIntegrated || lowCores;
  } catch (e) {
    return false;
  }
}
export const isLowEndHardware = detectLowEndOrIntegratedGPU();
window.isLowEndHardware = isLowEndHardware;

if (isMobileDevice) {
  document.body.classList.add('is-mobile');
} else {
  document.body.classList.remove('is-mobile');
}

export function setMobileMode(mode) {
  if (mode === 'touch') {
    isMobileDevice = true;
  } else if (mode === 'keyboard') {
    isMobileDevice = false;
  } else {
    isMobileDevice = detectMobileDevice();
  }
  window.isMobileDevice = isMobileDevice;
  if (renderer) {
    renderer.setPixelRatio((isMobileDevice || isLowEndHardware) ? 1.0 : Math.min(window.devicePixelRatio || 1, 1.25));
  }
  
  const mobileCtrl = document.getElementById('mobile-controls-container');
  if (isMobileDevice) {
    document.body.classList.add('is-mobile');
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    if (mobileCtrl && (window.mobileGameActive || window.gameReady)) {
      mobileCtrl.style.display = 'flex';
    }
    const resumeTarget = document.getElementById('resume-click-target');
    if (resumeTarget) resumeTarget.textContent = 'TAP TO ENTER LABYRINTH';
    const subtext = document.querySelector('#pointer-lock-overlay p');
    if (subtext) subtext.textContent = '(Drag Screen to Look | Joystick to Move | Tap UI to Act)';
  } else {
    document.body.classList.remove('is-mobile');
    if (mobileCtrl) {
      mobileCtrl.style.display = 'none';
    }
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
let wasSoloPaused = false;
let soloPauseStartTime = 0;
let ghostsFrozenRemaining = 0;
let alarmFlashRemaining = 0;
window.siphonDurationTimer = 0;
window.scrambleDurationTimer = 0;
window.ghostsFrozenRemaining = 0;
let matchCreditsAwardedThisSession = false;
window.gameDifficulty = localStorage.getItem('manifestation_difficulty') || 'easy';
let totalBreakersRequired = window.gameDifficulty === 'easy' ? 2 : (window.gameDifficulty === 'hard' ? 4 : (window.gameDifficulty === 'impossible' ? 6 : 3));

function getMazeSizeForDifficulty(difficulty = window.gameDifficulty || 'medium') {
  if (window.isTutorialMatch) return 11;
  if (difficulty === 'easy') return 21;
  if (difficulty === 'hard') return 41;
  if (difficulty === 'impossible') return 51;
  return 31; // medium
}
window.getMazeSizeForDifficulty = getMazeSizeForDifficulty;
window.mazeSizeGlobal = getMazeSizeForDifficulty(window.gameDifficulty);

function getGhostAbilityParams(difficulty = window.gameDifficulty || 'medium') {
  switch (difficulty) {
    case 'easy':
      return {
        // Ghost Claws
        clawsCooldown: 7000,
        clawsRange: 3.2,
        // Scent Tracker (Stalker)
        scentDuration: 3500,
        scentCooldown: 28000,
        // Infiltration Clone (Mimic)
        cloneDuration: 8000,
        cloneCooldown: 40000,
        // Audio Amplifiers (Juggernaut)
        rageDurationPlayer: 7.0,
        rageDurationBot: 3.5,
        rageCooldown: 60000,
        // Vapor Leap (Phantom)
        leapDistancePlayer: 8.0,
        leapDistanceBot: 5.0,
        leapCooldown: 22000,
        // Breaker Siphon (Poltergeist)
        siphonDuration: 6000,
        siphonRadius: 4 * 4.5, // 18m
        siphonCooldown: 42000,
        // Sound Scrambler (Banshee)
        scrambleDuration: 5000,
        scrambleRadius: 4 * 4.5, // 18m
        scrambleCooldown: 50000,
        // Bot Combat & Perception
        botAbilityCooldownMin: 22.0,
        botAbilityCooldownMax: 32.0,
        botSightRange: 9.0, // ~2 blocks
        botLoseSightDuration: 2.0,
        // Hearing radii multipliers (in block lengths)
        hearingWalking: 3.5,
        hearingSprinting: 6.0,
        hearingWhisper: 10.0,
        hearingScream: 25.0,
        // Sanity proximity drain rate per second
        sanityDrainRate: 2.5
      };
    case 'hard':
      return {
        // Ghost Claws
        clawsCooldown: 3500,
        clawsRange: 4.8,
        // Scent Tracker (Stalker)
        scentDuration: 7500,
        scentCooldown: 14000,
        // Infiltration Clone (Mimic)
        cloneDuration: 18000,
        cloneCooldown: 22000,
        // Audio Amplifiers (Juggernaut)
        rageDurationPlayer: 14.0,
        rageDurationBot: 7.0,
        rageCooldown: 32000,
        // Vapor Leap (Phantom)
        leapDistancePlayer: 16.0,
        leapDistanceBot: 12.0,
        leapCooldown: 10000,
        // Breaker Siphon (Poltergeist)
        siphonDuration: 14000,
        siphonRadius: 8 * 4.5, // 36m
        siphonCooldown: 20000,
        // Sound Scrambler (Banshee)
        scrambleDuration: 12000,
        scrambleRadius: 8 * 4.5, // 36m
        scrambleCooldown: 28000,
        // Bot Combat & Perception
        botAbilityCooldownMin: 10.0,
        botAbilityCooldownMax: 16.0,
        botSightRange: 18.0, // 4 blocks
        botLoseSightDuration: 5.5,
        // Hearing radii multipliers
        hearingWalking: 7.0,
        hearingSprinting: 12.0,
        hearingWhisper: 18.0,
        hearingScream: 45.0,
        // Sanity proximity drain rate per second
        sanityDrainRate: 6.0
      };
    case 'impossible':
      return {
        // Ghost Claws
        clawsCooldown: 2500,
        clawsRange: 5.5,
        // Scent Tracker (Stalker)
        scentDuration: 10000,
        scentCooldown: 10000,
        // Mimic Clone (Mimic)
        cloneDuration: 25000,
        cloneCooldown: 16000,
        // Audio Amplifiers (Juggernaut)
        rageDurationPlayer: 18.0,
        rageDurationBot: 9.0,
        rageCooldown: 24000,
        // Vapor Leap (Phantom)
        leapDistancePlayer: 22.0,
        leapDistanceBot: 16.0,
        leapCooldown: 7000,
        // Breaker Siphon (Poltergeist)
        siphonDuration: 18000,
        siphonRadius: 10 * 4.5, // 45m
        siphonCooldown: 14000,
        // Sound Scrambler (Banshee)
        scrambleDuration: 16000,
        scrambleRadius: 10 * 4.5, // 45m
        scrambleCooldown: 20000,
        // Bot Combat & Perception
        botAbilityCooldownMin: 6.0,
        botAbilityCooldownMax: 10.0,
        botSightRange: 24.0, // 5.3 blocks
        botLoseSightDuration: 8.0,
        // Hearing radii multipliers
        hearingWalking: 9.0,
        hearingSprinting: 16.0,
        hearingWhisper: 24.0,
        hearingScream: 60.0,
        // Sanity proximity drain rate per second
        sanityDrainRate: 8.5
      };
    case 'medium':
    default:
      return {
        // Ghost Claws
        clawsCooldown: 5000,
        clawsRange: 4.0,
        // Scent Tracker (Stalker)
        scentDuration: 5000,
        scentCooldown: 20000,
        // Mimic Clone (Mimic)
        cloneDuration: 12000,
        cloneCooldown: 30000,
        // Audio Amplifiers (Juggernaut)
        rageDurationPlayer: 10.0,
        rageDurationBot: 5.0,
        rageCooldown: 45000,
        // Vapor Leap (Phantom)
        leapDistancePlayer: 12.0,
        leapDistanceBot: 8.0,
        leapCooldown: 15000,
        // Breaker Siphon (Poltergeist)
        siphonDuration: 10000,
        siphonRadius: 6 * 4.5, // 27m
        siphonCooldown: 30000,
        // Sound Scrambler (Banshee)
        scrambleDuration: 8000,
        scrambleRadius: 6 * 4.5, // 27m
        scrambleCooldown: 40000,
        // Bot Combat & Perception
        botAbilityCooldownMin: 16.0,
        botAbilityCooldownMax: 24.0,
        botSightRange: 13.5, // 3 blocks
        botLoseSightDuration: 3.5,
        // Hearing radii multipliers
        hearingWalking: 5.0,
        hearingSprinting: 9.0,
        hearingWhisper: 14.0,
        hearingScream: 35.0,
        // Sanity proximity drain rate per second
        sanityDrainRate: 4.0
      };
  }
}
let ghostPathMeshes = [];
let chalkDecals = [];

// Sprint / Stamina
let isSprinting = false;
let isSprintExhausted = false; // When stamina drops to 0%, locked until 20% recovered
let stamina = 100; // 0-100
const STAMINA_DRAIN_RATE = 20;  // per second while sprinting
const STAMINA_REGEN_RATE  = 12; // per second while not sprinting
const SPRINT_MIN_STAMINA  = 5;   // normal min stamina to continue sprinting
const SPRINT_RECOVERY_THRESHOLD = 20; // must reach 20% to re-engage sprint after exhaustion

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
let gateKeypadWorldPos = new THREE.Vector3(0, 1.5, -35);
let gateMeshRef = null;  // Global ref so we can toggle visibility
let padMeshRef = null;   // Global ref for the keypad
let vaultObjects = [];   // Global tracker for all 3D vault portal components
let gateKeypadLed = null; // Status LED on the 3D keypad terminal
let gateSolved = false;
let hasEscaped = false;
let codeEntered = "";
let functionalKeysRevealed = [];
let foundKeysList = [];
let carriedKeys = [];      // Keys currently carried (max 3)
let discoveredKeyIds = new Set(); // Tracks unique key IDs discovered to prevent dropped keys from re-triggering maze realignment
const MAX_CARRIED_KEYS = 3;
let insertedGateKeys = []; // Keys installed into the Master Gate
let codeClueNotes = []; // Clue objects in the maze
let pauseOpenedTime = 0; // Timestamp when pause menu is opened to block instant ghost resumes

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
let lastMinimapX = -9999, lastMinimapZ = -9999, lastMinimapRot = -9999, lastMinimapTime = 0;
let lastLightCullTime = 0;

// Persistent Dead Bodies tracking
let deadBodies = [];
let playerCorpses = {}; // targetId -> { mesh, position: { x, y, z }, rotationY, username }

// Sanity Features: Sanctuaries, Shadow Decoys, and Mirage Loot
let sanctuaryZones = [];
let shadowDecoys = [];
let nextDecoyTimer = 15;
let mirageItems = [];
let nextMirageTimer = 20;

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

export function initGame(socket, socketId, matchConfig, isSolo = false, isTutorial = false) {
  socketClient = socket;
  myId = socketId;
  currentLobby = matchConfig;
  window.isTutorialMatch = Boolean(
    isTutorial ||
    (matchConfig && matchConfig.id && matchConfig.id.startsWith('tutorial-')) ||
    (matchConfig && matchConfig.settings && matchConfig.settings.isTutorial)
  );
  const humanPlayersCount = Object.values(matchConfig.players || {}).filter(p => p.team === 'Human').length;
  window.isSoloMatch = Boolean(
    isSolo ||
    window.isTutorialMatch ||
    (matchConfig && matchConfig.id && matchConfig.id.startsWith('solo-')) ||
    (sessionStorage.getItem('rejoinIsSolo') === 'true') ||
    humanPlayersCount <= 1
  );
  // Info Screen (Breakers, Keys, and 4-Digit Code) must ALWAYS be visible across all modes!
  const objBar = document.querySelector('.compact-objective-bar');
  if (objBar) objBar.style.display = 'flex';

  if (window.isTutorialMatch) {
    totalBreakersRequired = 1;
  } else {
    const tutBanner = document.getElementById('tutorial-quest-banner');
    if (tutBanner) tutBanner.style.display = 'none';
  }

  // Initialize seededRandom using server-provided mazeGeometrySeed
  const seed = (matchConfig.puzzleState && matchConfig.puzzleState.mazeGeometrySeed) || 0.12345;
  const seedInt = Math.floor(seed * 2147483647);
  seededRandom = mulberry32(seedInt);

  // Reset core game state variables for clean start/re-entry
  currentViewIndex = 0;
  activeViewCamera = null;
  matchCreditsAwardedThisSession = false;
  if (localPlayerVisual) {
    if (localPlayerVisual.parent) localPlayerVisual.parent.remove(localPlayerVisual);
    else if (scene) scene.remove(localPlayerVisual);
    localPlayerVisual = null;
  }

  // Remove any stale dead bodies from previous matches
  if (deadBodies && deadBodies.length > 0) {
    deadBodies.forEach(corpse => {
      if (scene) scene.remove(corpse);
      corpse.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
    });
    deadBodies = [];
    playerCorpses = {};
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
    activeAnimationMixers.length = 0;
  }

  // Remove any stale ghost bots from previous matches
  if (typeof ghosts3D !== 'undefined' && ghosts3D.length > 0) {
    ghosts3D.forEach(g => {
      if (typeof revertMimicDisguise === 'function') revertMimicDisguise(g);
      if (scene) scene.remove(g);
      g.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
    });
    ghosts3D = [];
  }
  window.ghostsSpawned = false;
  
  currentHP = 100;
  currentSanity = 100;
  isPanicked = false;
  isCaptured = false;
  window.isSpectating = false;
  hasEscaped = false;
  window.isEscaping = false;
  if (ceilingMesh) ceilingMesh.visible = true;
  if (floorMesh) floorMesh.visible = true;
  stamina = 100;
  isSprinting = false;
  isSprintExhausted = false;
  panicTimer = 0;
  speedBoostTimer = 0;
  latestSoundBeacon = null;
  gateSolved = false;
  codeEntered = "";
  window.securityLockoutActive = false;
  window.securityLockoutEndTime = 0;
  if (window._securityLockoutTimer) {
    clearTimeout(window._securityLockoutTimer);
    window._securityLockoutTimer = null;
  }
  wasSoloPaused = false;
  soloPauseStartTime = 0;
  ghostsFrozenRemaining = 0;
  alarmFlashRemaining = 0;
  window.ghostsFrozen = false;
  window.ghostsFrozenRemaining = 0;
  window.flashlightDisabledBySiphon = false;
  window.sensorsScrambled = false;
  window.siphonDurationTimer = 0;
  window.scrambleDurationTimer = 0;
  matchCreditsAwardedThisSession = false;
  // Preload forest model and 3D lantern model in background during gameplay
  loadForestAsset();
  loadLanternAsset();
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
  sanctuaryZones = [];
  shadowDecoys = [];
  mirageItems = [];
  nextDecoyTimer = 15;
  nextMirageTimer = 20;

  const exitToLobbyOrMenu = () => {
    if (currentLobby && currentLobby.id && !currentLobby.id.startsWith('solo-')) {
      sessionStorage.setItem('rejoinLobbyId', currentLobby.id);
      sessionStorage.setItem('rejoinUsername', (currentLobby.players && currentLobby.players[myId]?.username) || `Operative_${Math.floor(100 + Math.random() * 900)}`);
      sessionStorage.setItem('rejoinIsPublic', currentLobby.isPublic ? 'true' : 'false');
      sessionStorage.setItem('rejoinIsSolo', 'false');
    } else {
      sessionStorage.removeItem('rejoinLobbyId');
      sessionStorage.removeItem('rejoinUsername');
      sessionStorage.removeItem('rejoinIsPublic');
      sessionStorage.removeItem('rejoinIsSolo');
    }
    if (window.leaveGameWithAd) {
      window.leaveGameWithAd(() => window.location.reload());
    } else {
      window.location.reload();
    }
  };

  const spectateBtn = document.getElementById('spectate-btn');
  if (spectateBtn) {
    spectateBtn.onclick = () => {
      const capOverlay = document.getElementById('captured-overlay');
      if (capOverlay) capOverlay.style.display = 'none';
      window.isSpectating = true;
      camera.position.y = Math.max(camera.position.y, 5.0);
      updateEnvironmentLighting();

      const specHud = document.getElementById('spectator-hud');
      if (specHud) specHud.style.display = 'flex';

      const resumeTarget = document.getElementById('resume-click-target');
      if (resumeTarget) resumeTarget.textContent = isMobileDevice ? '▶ TAP TO RESUME SPECTATING' : '▶ CLICK TO RESUME SPECTATING';

      if (isMobileDevice) {
        window.mobileGameActive = true;
        const mobileCtrl = document.getElementById('mobile-controls-container');
        if (mobileCtrl) mobileCtrl.style.display = 'flex';
      } else {
        const lockTarget = (renderer && renderer.domElement) || container;
        if (lockTarget && lockTarget.requestPointerLock) {
          lockTarget.requestPointerLock();
        }
      }
      triggerNotification("SPECTATOR MODE: Roam with WASD. Tap Menu/Pause to Abort.");
    };
  }

  const capturedLobbyBtn = document.getElementById('captured-lobby-btn');
  if (capturedLobbyBtn) {
    addFastTapListener(capturedLobbyBtn, exitToLobbyOrMenu);
  }

  const capturedQuitBtn = document.getElementById('captured-quit-btn');
  if (capturedQuitBtn) {
    addFastTapListener(capturedQuitBtn, () => {
      sessionStorage.clear();
      if (window.leaveGameWithAd) {
        window.leaveGameWithAd(() => window.location.reload());
      } else {
        window.location.reload();
      }
    });
  }

  const spectatorPauseBtn = document.getElementById('spectator-pause-btn');
  if (spectatorPauseBtn) {
    addFastTapListener(spectatorPauseBtn, (e) => {
      if (window.togglePauseMenu) window.togglePauseMenu(e);
    });
  }

  const spectatorAbortBtn = document.getElementById('spectator-abort-btn');
  if (spectatorAbortBtn) {
    addFastTapListener(spectatorAbortBtn, exitToLobbyOrMenu);
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
  if (hudOverlay) hudOverlay.style.display = 'none';

  const me = matchConfig.players[myId];
  myTeam = me.team;
  myClass = me.characterClass;

  if (localStorage.getItem('manifestation_equipped_skin') === 'skin_rogue') {
    localStorage.setItem('manifestation_equipped_skin', 'skin_hazmat');
  }

  // Preload Hazmat Suit and Mech Soldier assets so players and Mimic bots always have high-fidelity models
  loadHazmatFBXAssets();
  loadSoldierFBXAssets();
  loadGhostGLBAsset();

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
  if (ptrOverlay) {
    ptrOverlay.style.display = 'none';
    const resumeTarget = document.getElementById('resume-click-target');
    const subtext = document.querySelector('#pointer-lock-overlay p');
    if (isMobileDevice) {
      if (resumeTarget) resumeTarget.textContent = 'TAP TO ENTER LABYRINTH';
      if (subtext) subtext.textContent = '(Drag Screen to Look | Joystick to Move | Tap UI to Act)';
    } else {
      if (resumeTarget) resumeTarget.textContent = 'CLICK TO RESUME LABYRINTH';
      if (subtext) subtext.textContent = '(Press ESC to Pause | WASD to Move | Mouse to Look)';
    }
  }

  const handleEnterGame = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (performance.now() - pauseOpenedTime < 400) {
      return; // Discard trailing touches / synthetic clicks from the tap that opened pause
    }
    resetPlayerMovementState();
    if (window.isSpectating) {
      if (ptrOverlay) ptrOverlay.style.display = 'none';
      const specHud = document.getElementById('spectator-hud');
      if (specHud) specHud.style.display = 'flex';
      if (isMobileDevice) {
        window.mobileGameActive = true;
        const mobileCtrl = document.getElementById('mobile-controls-container');
        if (mobileCtrl) mobileCtrl.style.display = 'flex';
      } else {
        const lockTarget = (renderer && renderer.domElement) || container;
        if (lockTarget && lockTarget.requestPointerLock) lockTarget.requestPointerLock();
      }
      return;
    }
    if (window.isEscaping || isCaptured || window.isCapturedAnimation || !window.gameReady) {
      if (ptrOverlay) ptrOverlay.style.display = 'none';
      return;
    }
    const endOverlay = document.getElementById('end-game-overlay');
    if (endOverlay && endOverlay.style.display === 'flex') {
      if (ptrOverlay) ptrOverlay.style.display = 'none';
      return;
    }
    const capturedOverlay = document.getElementById('captured-overlay');
    if (capturedOverlay && capturedOverlay.style.display === 'flex') {
      if (ptrOverlay) ptrOverlay.style.display = 'none';
      return;
    }
    const keypadEl = document.getElementById('keypad-modal-ui');
    if (keypadEl && keypadEl.style.display !== 'none') return;
    if (isMinimapExpanded) return;
    window.mobileGameActive = true;
    window.gameReady = true;
    ptrOverlay.style.display = 'none';
    if (roleSplash) {
      roleSplash.style.display = 'none';
      roleSplash.style.backdropFilter = 'none';
      roleSplash.style.webkitBackdropFilter = 'none';
    }
    const hud = document.getElementById('hud-overlay');
    if (hud) hud.style.display = 'flex';
    const reticle = document.getElementById('crosshair') || document.getElementById('reticle');
    if (reticle) reticle.style.display = 'block';

    if (!isMobileDevice) {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      const lockTarget = (renderer && renderer.domElement) || container || document.body;
      if (lockTarget && lockTarget.requestPointerLock) {
        try {
          const promise = lockTarget.requestPointerLock();
          if (promise && promise.catch) {
            promise.catch(err => {
              console.warn('[POINTER] Pointer lock request deferred by browser:', err);
              // Do NOT force pause overlay back on temporary browser Esc-cooldown
            });
          }
        } catch(err) {
          console.warn('[POINTER] Pointer lock exception:', err);
        }
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  };

  ptrOverlay.addEventListener('click', (e) => {
    if (isMobileDevice) return; // On mobile devices, do not resume by clicking empty overlay background!
    if (performance.now() - pauseOpenedTime < 400) return;
    if (e.target.closest('#pause-settings-btn') || e.target.closest('#pause-abort-btn') || e.target.closest('#pause-controls-btn') || e.target.closest('.glass-panel')) return;
    handleEnterGame(e);
  });
  if (!isMobileDevice) {
    container.addEventListener('click', handleEnterGame);
  }
  const resumeBtn = document.getElementById('resume-click-target');
  if (resumeBtn) {
    resumeBtn.addEventListener('click', (e) => {
      if (performance.now() - pauseOpenedTime < 400) return;
      handleEnterGame(e);
    });
    resumeBtn.addEventListener('touchend', (e) => {
      if (performance.now() - pauseOpenedTime < 400) return;
      if (e.cancelable) e.preventDefault();
      handleEnterGame(e);
    }, { passive: false });
  }
  const pauseResumeBtn = document.getElementById('pause-resume-btn');
  if (pauseResumeBtn) {
    pauseResumeBtn.addEventListener('click', (e) => {
      if (performance.now() - pauseOpenedTime < 400) return;
      handleEnterGame(e);
    });
    pauseResumeBtn.addEventListener('touchend', (e) => {
      if (performance.now() - pauseOpenedTime < 400) return;
      if (e.cancelable) e.preventDefault();
      handleEnterGame(e);
    }, { passive: false });
  }

  // Initialize Controls Guide & Tutorial Quest engine
  setupControlsGuideModal();
  // Info Screen (Breakers, Keys, and 4-Digit Code) must ALWAYS be visible across all modes!
  if (objBar) objBar.style.display = 'flex';

  if (window.isTutorialMatch) {
    totalBreakersRequired = 1;
    initTutorialQuest();
  } else {
    const tutBanner = document.getElementById('tutorial-quest-banner');
    if (tutBanner) tutBanner.style.display = 'none';
  }

  // Global helper to request pointer lock during active gameplay
  window.requestGamePointerLock = () => {
    if (isMobileDevice || (!window.gameReady && !window.isSpectating) || window.isEscaping || (isCaptured && !window.isSpectating) || window.isCapturedAnimation) return;
    if (document.pointerLockElement) return;
    if (ptrOverlay && ptrOverlay.style.display === 'flex') return;
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal && settingsModal.style.display === 'flex') return;
    const controlsGuideModal = document.getElementById('controls-guide-modal');
    if (controlsGuideModal && controlsGuideModal.style.display === 'flex') return;
    const keypadEl = document.getElementById('keypad-modal-ui');
    if (keypadEl && keypadEl.style.display !== 'none') return;
    if (isMinimapExpanded) return;
    const capturedEl = document.getElementById('captured-overlay');
    const endEl = document.getElementById('end-game-overlay');
    if ((capturedEl && capturedEl.style.display === 'flex') || (endEl && endEl.style.display === 'flex')) return;

    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
      document.activeElement.blur();
    }
    const lockTarget = (renderer && renderer.domElement) || container || document.body;
    if (lockTarget && lockTarget.requestPointerLock) {
      try {
        const p = lockTarget.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch(_) {}
    }
  };

  // Global click & pointerdown to relock mouse anytime desktop player clicks during gameplay
  window.addEventListener('click', (e) => {
    if (isMobileDevice || window.isEscaping || (isCaptured && !window.isSpectating) || window.isCapturedAnimation || (!window.gameReady && !window.isSpectating)) return;
    const keypadEl = document.getElementById('keypad-modal-ui');
    if (keypadEl && keypadEl.style.display !== 'none') return;
    if (e.target.closest('#pause-settings-btn') || e.target.closest('#pause-abort-btn') || e.target.closest('#pause-controls-btn') || e.target.closest('#controls-guide-modal') || e.target.closest('.keypad-modal') || e.target.closest('.glass-panel') || e.target.closest('#mobile-controls-container') || e.target.closest('.mobile-action-btn') || e.target.closest('#mobile-actions') || e.target.closest('#spectator-hud')) return;
    if (ptrOverlay.style.display !== 'flex') {
      window.requestGamePointerLock();
    }
  });
  window.addEventListener('pointerdown', (e) => {
    if (isMobileDevice || window.isEscaping || (isCaptured && !window.isSpectating) || window.isCapturedAnimation || (!window.gameReady && !window.isSpectating)) return;
    const keypadEl = document.getElementById('keypad-modal-ui');
    if (keypadEl && keypadEl.style.display !== 'none') return;
    if (e.target.closest('#pause-settings-btn') || e.target.closest('#pause-abort-btn') || e.target.closest('#pause-controls-btn') || e.target.closest('#controls-guide-modal') || e.target.closest('.keypad-modal') || e.target.closest('.glass-panel') || e.target.closest('#mobile-controls-container') || e.target.closest('.mobile-action-btn') || e.target.closest('#mobile-actions') || e.target.closest('#spectator-hud')) return;
    if (ptrOverlay.style.display !== 'flex') {
      window.requestGamePointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    if (
      isMobileDevice || 
      window.isEscaping || 
      (isCaptured && !window.isSpectating) || 
      window.isCapturedAnimation || 
      (!window.gameReady && !window.isSpectating)
    ) {
      ptrOverlay.style.display = 'none';
      return;
    }
    if (document.pointerLockElement) {
      ptrOverlay.style.display = 'none';
    } else {
      resetPlayerMovementState(true);
      // Don't show pause overlay if dying, captured, escaping, keypad modal, minimap, settings modal, or game-over is open
      const keypadEl = document.getElementById('keypad-modal-ui');
      const isKeypadOpen = Boolean(keypadEl && keypadEl.style.display !== 'none');
      const settingsModal = document.getElementById('settings-modal');
      const isSettingsOpen = Boolean(settingsModal && settingsModal.style.display === 'flex');
      const capturedOverlay = document.getElementById('captured-overlay');
      const isCapturedOpen = Boolean(capturedOverlay && capturedOverlay.style.display === 'flex');
      const endOverlay = document.getElementById('end-game-overlay');
      const isEndOpen = Boolean(endOverlay && endOverlay.style.display === 'flex');
      const captureAnimOverlay = document.getElementById('ghost-capture-overlay');
      const isCaptureAnimOpen = Boolean(captureAnimOverlay && captureAnimOverlay.style.display !== 'none');

      if (
        isKeypadOpen || 
        isMinimapExpanded || 
        isSettingsOpen || 
        isCapturedOpen || 
        isEndOpen || 
        isCaptureAnimOpen || 
        (isCaptured && !window.isSpectating) || 
        window.isCapturedAnimation || 
        window.isEscaping || 
        (!window.gameReady && !window.isSpectating)
      ) {
        ptrOverlay.style.display = 'none';
      } else {
        const isMultiplayer = Boolean(currentLobby && currentLobby.id && !currentLobby.id.startsWith('solo-'));
        const warnEl = document.getElementById('multiplayer-pause-warning');
        if (warnEl) warnEl.style.display = isMultiplayer ? 'block' : 'none';

        const resumeTarget = document.getElementById('resume-click-target');
        if (resumeTarget) {
          resumeTarget.textContent = window.isSpectating ? '▶ CLICK TO RESUME SPECTATING' : '▶ CLICK TO RESUME LABYRINTH';
        }
        const canvasContainer = document.getElementById('canvas-container');
        if (canvasContainer) canvasContainer.style.filter = 'none';
        document.body.style.filter = 'none';
        ptrOverlay.style.display = 'flex';
      }
    }
  });

  window.addEventListener('blur', () => {
    if (isMobileDevice) return;
    if (typeof document.hasFocus === 'function' && document.hasFocus()) return;
    currentlyHeldKeys.clear();
    resetPlayerMovementState(true);
  });

  document.addEventListener('pointerlockerror', () => {
    if (isMobileDevice) return;
    console.warn('[POINTER] Pointer lock error/cooldown event fired — awaiting next player interaction');
  });

  // Display Role Splash & Class Assignment Screen (Stage 2 of Match Entry)
  const roleSplash = document.getElementById('role-splash-screen');
  const splashBadge = document.getElementById('splash-team-badge');
  const splashTitle = document.getElementById('splash-role-title');
  const splashDesc = document.getElementById('splash-role-desc');
  const splashObjectives = document.getElementById('splash-objectives');
  const roleEnterBtn = document.getElementById('role-enter-btn');

  const isGhostRole = (myTeam === 'Ghost');
  if (splashBadge) {
    if (window.isTutorialMatch) {
      splashBadge.textContent = "FIELD TRAINING ACADEMY";
      splashBadge.style.background = "rgba(14, 165, 233, 0.25)";
      splashBadge.style.border = "1px solid #38bdf8";
      splashBadge.style.color = "#38bdf8";
    } else {
      splashBadge.textContent = isGhostRole ? "SPECTRAL ENTITY (GHOST)" : "HUMAN OPERATIVE";
      splashBadge.style.background = isGhostRole ? "rgba(168, 85, 247, 0.2)" : "rgba(56, 189, 248, 0.2)";
      splashBadge.style.border = isGhostRole ? "1px solid #a855f7" : "1px solid #38bdf8";
      splashBadge.style.color = isGhostRole ? "#c084fc" : "#38bdf8";
    }
  }
  if (splashTitle) {
    splashTitle.textContent = window.isTutorialMatch ? "TRAINING PROTOCOL" : `${myClass.toUpperCase()}`;
    splashTitle.style.color = isGhostRole ? "#c084fc" : "#38bdf8";
  }
  if (splashDesc) {
    if (window.isTutorialMatch) {
      splashDesc.textContent = "Operative Field Training Simulation. Complete each guided stage to master movement, sprint, illumination, salvage, power restoration, and extraction.";
    } else {
      const classInfo = (window.classesData && window.classesData[myTeam] && window.classesData[myTeam][myClass]) 
        ? window.classesData[myTeam][myClass].desc 
        : "Standard tactical operative gear equipped.";
      splashDesc.textContent = classInfo;
    }
  }
  if (splashObjectives) {
    if (window.isTutorialMatch) {
      splashObjectives.textContent = "STAGE 1: Locomotion Calibration. Walk through the training corridors to calibrate your operative sensors.";
    } else {
      splashObjectives.textContent = isGhostRole
        ? "Patrol the dark corridors, stalk the human survivors, and harvest all souls before they break the ciphers and escape."
        : "Survive the labyrinth, fix power breakers, crack the 4-digit cipher at the keypad terminal, find the twin gate keys, and reach the extraction gate.";
    }
  }

  if (roleSplash) roleSplash.style.display = 'flex';
  window.gameReady = false;

  let roleCountdownSeconds = 2;
  let roleCountdownInterval = null;

  const dismissSplash = () => {
    if (roleCountdownInterval) {
      clearInterval(roleCountdownInterval);
      roleCountdownInterval = null;
    }
    if (roleSplash) {
      roleSplash.style.display = 'none';
      roleSplash.style.backdropFilter = 'none';
      roleSplash.style.webkitBackdropFilter = 'none';
    }
    const ptrOverlay = document.getElementById('pointer-lock-overlay');
    if (ptrOverlay) ptrOverlay.style.display = 'none';

    const hud = document.getElementById('hud-overlay');
    if (hud) hud.style.display = 'flex';
    const reticle = document.getElementById('crosshair') || document.getElementById('reticle');
    if (reticle) reticle.style.display = 'block';
    window.gameReady = true;

    // Relink pointer lock or mobile joystick controls
    if (isMobileDevice) {
      window.mobileGameActive = true;
      const mobileCtrl = document.getElementById('mobile-controls-container');
      if (mobileCtrl) mobileCtrl.style.display = 'flex';
    } else {
      const mobileCtrl = document.getElementById('mobile-controls-container');
      if (mobileCtrl) mobileCtrl.style.display = 'none';
      if (window.requestGamePointerLock) {
        window.requestGamePointerLock();
      } else {
        const lockTarget = (renderer && renderer.domElement) || container;
        if (lockTarget && lockTarget.requestPointerLock && !document.pointerLockElement) {
          try { lockTarget.requestPointerLock(); } catch (_) {}
        }
      }
    }
  };

  const handleRoleDismiss = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    dismissSplash();
    if (!isMobileDevice && window.requestGamePointerLock) {
      window.requestGamePointerLock();
    }
  };

  if (roleEnterBtn) {
    roleEnterBtn.textContent = window.isTutorialMatch ? "START TRAINING PROTOCOL" : `ENTER LABYRINTH (${roleCountdownSeconds}s)`;
    addFastTapListener(roleEnterBtn, handleRoleDismiss);
  }

  if (roleSplash) {
    // Tapping anywhere on the role splash screen enters immediately
    roleSplash.addEventListener('pointerdown', handleRoleDismiss);
  }

  // Any keypress (Space, Enter, WASD, Escape) enters immediately
  const onRoleKey = (e) => {
    if (roleSplash && roleSplash.style.display !== 'none') {
      window.removeEventListener('keydown', onRoleKey);
      handleRoleDismiss(e);
    }
  };
  window.addEventListener('keydown', onRoleKey);

  roleCountdownInterval = setInterval(() => {
    roleCountdownSeconds -= 1;
    if (roleCountdownSeconds <= 0) {
      dismissSplash();
    } else if (roleEnterBtn) {
      roleEnterBtn.textContent = window.isTutorialMatch ? "START TRAINING PROTOCOL" : `ENTER LABYRINTH (${roleCountdownSeconds}s)`;
    }
  }, 1000);

  // Setup ThreeJS scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000); // Pure black to eliminate any gap visibility
  scene.fog = new THREE.FogExp2(0x000000, 0.015);

  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  
  camera = new THREE.PerspectiveCamera(75, w / h, 0.25, 200);
  camera.rotation.order = 'YXZ'; // Fixes the weird rolling/tilted camera issues!
  camera.position.set(0, 1.6, 0); // Eye level

  // EXPOSE FOR DEBUGGING & DEV CONSOLE
  window.scene = scene;
  window.camera = camera;
  window.keysInMaze = keysInMaze;
  window.tpToLastKey = () => {
    const keys = window.keysInMaze || [];
    let targetPos = null;
    let label = 'Key';
    if (keys.length > 0) {
      const last = keys[keys.length - 1];
      if (last && last.mesh) {
        targetPos = last.mesh.position;
        label = last.typeName || last.symbol || 'Key';
      }
    }
    if (!targetPos && window.scene) {
      const sceneKeys = [];
      window.scene.traverse(o => {
        if (o.userData && o.userData.keyTypeLabel && o.parent === window.scene) sceneKeys.push(o);
      });
      if (sceneKeys.length > 0) {
        const last = sceneKeys[sceneKeys.length - 1];
        targetPos = last.position;
        label = last.userData.keyTypeLabel;
      }
    }
    if (targetPos && window.camera) {
      window.camera.position.set(targetPos.x, 1.6, targetPos.z);
      console.log(`%c[TELEPORT] Teleported to ${label} at x: ${targetPos.x.toFixed(1)}, z: ${targetPos.z.toFixed(1)}`, 'color: #10b981; font-weight: bold;');
    } else {
      console.warn("No keys found in the maze!");
    }
  };
  window.teleportToLastKey = window.tpToLastKey;
  window.tpToKey = (idx = 0) => {
    const keys = window.keysInMaze || [];
    if (keys[idx] && keys[idx].mesh) {
      window.camera.position.set(keys[idx].mesh.position.x, 1.6, keys[idx].mesh.position.z);
      console.log(`%c[TELEPORT] Teleported to key ${idx} (${keys[idx].typeName})`, 'color: #10b981;');
    } else {
      window.tpToLastKey();
    }
  };
  window.circuitBreakers = circuitBreakers;
  window.tpToBreaker = (idx) => {
    const list = (window.circuitBreakers && window.circuitBreakers.length > 0) ? window.circuitBreakers : circuitBreakers;
    const unfixed = list.filter(b => !b.isFixed && b.mesh);
    const target = (idx !== undefined && list[idx] && list[idx].mesh) 
      ? list[idx] 
      : (unfixed[unfixed.length - 1] || list[list.length - 1]);
    if (target && target.mesh && window.camera) {
      window.camera.position.set(target.mesh.position.x, 1.6, target.mesh.position.z);
      console.log(`%c[TELEPORT] Teleported to breaker ${target.id} at [${target.mesh.position.x.toFixed(1)}, ${target.mesh.position.z.toFixed(1)}]`, 'color: #10b981; font-weight: bold;');
    } else {
      console.warn("No circuit breakers found or all fixed!");
    }
  };
  window.teleportToBreaker = window.tpToBreaker;
  window.pullBreakers = () => {
    const list = (window.circuitBreakers && window.circuitBreakers.length > 0) ? window.circuitBreakers : circuitBreakers;
    list.filter(b => !b.isFixed && b.mesh).forEach((b, i) => {
      b.mesh.position.set(window.camera.position.x - 1 + (i * 1.5), 1.2, window.camera.position.z - 2);
      console.log(`%c[PULL] Pulled ${b.id} to your location`, 'color: #38bdf8;');
    });
  };

  // 3. Renderer cleanup & setup
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (renderer) {
    if (renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    renderer.dispose();
    renderer = null;
  }
  if (container) {
    container.innerHTML = '';
  }

  prevTime = performance.now();

  const isLowEnd = isMobileDevice || isLowEndHardware;

  renderer = new THREE.WebGLRenderer({ 
    antialias: !isLowEnd,
    powerPreference: "high-performance",
    precision: isLowEnd ? "mediump" : "highp",
    depth: true
  });
  renderer.setPixelRatio(isLowEnd ? 1.0 : Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = false; // Disable heavy multi-pass shadow map rendering for smooth 60-144 FPS
  renderer.localClippingEnabled = true; // Enables GPU fragment clipping planes for doorway threshold
  container.appendChild(renderer.domElement);

  // Live memory & GPU diagnostic utility
  window.getGameMemoryStats = () => {
    const mem = window.performance && window.performance.memory;
    const jsHeapMB = mem ? (mem.usedJSHeapSize / (1024 * 1024)).toFixed(1) + ' MB' : 'N/A';
    const totalAllocatedMB = mem ? (mem.totalJSHeapSize / (1024 * 1024)).toFixed(1) + ' MB' : 'N/A';
    const gpuInfo = renderer ? renderer.info : null;
    const stats = {
      activeJSHeap: jsHeapMB,
      allocatedHeap: totalAllocatedMB,
      estimatedTotalRAM: isMobileDevice ? '~250 - 380 MB (0.25 - 0.38 GB)' : '~380 - 480 MB (0.38 - 0.48 GB)',
      gpuGeometries: gpuInfo ? gpuInfo.memory.geometries : 'N/A',
      gpuTextures: gpuInfo ? gpuInfo.memory.textures : 'N/A',
      drawCallsPerFrame: gpuInfo ? gpuInfo.render.calls : 'N/A',
      trianglesPerFrame: gpuInfo ? gpuInfo.render.triangles : 'N/A'
    };
    console.table(stats);
    return stats;
  };

  // Setup Audio Context for procedural EMF sound
  setupProceduralAudio();

  // Lightings
  ambientLight = new THREE.AmbientLight(0x445566, 2.0); // Balanced ambient for clear corridor visibility
  scene.add(ambientLight);

  if (myTeam === 'Human') {
    // Add player flashlight
    const isDungeon = (localStorage.getItem('manifestation_maze_theme') || 'dungeon') === 'dungeon';
    flashLight = new THREE.SpotLight(0xffffff, isDungeon ? 45 : 100, 50, Math.PI / 3, 0.4, 1.2);
    flashLight.position.set(0, 0, 0);
    flashLight.castShadow = false;
    const shadowRes = isMobileDevice ? 512 : 1024;
    flashLight.shadow.mapSize.set(shadowRes, shadowRes);
    flashLight.shadow.bias = -0.0001;
    flashLight.shadow.normalBias = 0.04;
    flashLight.shadow.camera.near = 0.5;
    flashLight.shadow.camera.far = 45;
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
  window.gameDifficulty = (matchConfig.puzzleState && matchConfig.puzzleState.difficulty) || localStorage.getItem('manifestation_difficulty') || 'easy';
  const defaultBreakers = window.isTutorialMatch ? 1 : (window.gameDifficulty === 'easy' ? 2 : (window.gameDifficulty === 'hard' ? 4 : (window.gameDifficulty === 'impossible' ? 6 : 3)));
  totalBreakersRequired = window.isTutorialMatch ? 1 : ((matchConfig.puzzleState && matchConfig.puzzleState.totalBreakers) || defaultBreakers);
  mazeSizeGlobal = window.isTutorialMatch ? 11 : ((matchConfig.puzzleState && matchConfig.puzzleState.mazeSize) || getMazeSizeForDifficulty(window.gameDifficulty));
  window.mazeSizeGlobal = mazeSizeGlobal;

  // Know which 2 keys are functional from the start (players must find them via trial/error or clues)
  if (matchConfig.puzzleState.realKeySymbols && matchConfig.puzzleState.realKeySymbols.length > 0) {
    functionalKeysRevealed = matchConfig.puzzleState.realKeySymbols;
  }

  // Create Labyrinth
  generateMaze(matchConfig.puzzleState.keysCount);
  updateGateHUD();

  // Set spawn positions (All Humans spawn together at center (0, 1.6, 0))
  if (myTeam === 'Ghost') {
    // Pick a deterministic open corridor far from the center
    const minFarDist = Math.max(10, mazeSizeGlobal * 4.5 * 0.25);
    const farCorridors = openCorridors.filter(c => Math.abs(c.x) > minFarDist || Math.abs(c.z) > minFarDist);
    if (farCorridors.length > 0) {
      const spawnIdx = Math.floor(seededRandom() * farCorridors.length);
      const spawnNode = farCorridors[spawnIdx];
      camera.position.set(spawnNode.x, 1.6, spawnNode.z);
    } else {
      camera.position.set(minFarDist, 1.6, minFarDist);
    }
  } else {
    // All humans spawn together at the exact same labyrinth entrance (guaranteed open corridor hub)
    const sx = (window.humanSpawnPos && !isNaN(window.humanSpawnPos.x)) ? window.humanSpawnPos.x : 0;
    const sz = (window.humanSpawnPos && !isNaN(window.humanSpawnPos.z)) ? window.humanSpawnPos.z : 0;
    camera.position.set(sx, 1.6, sz);
  }

  // Pause buttons remain active in all modes to access In-Game Menu & Settings
  const mobilePauseBtn = document.getElementById('btn-mobile-pause');
  const globalPauseBtn = document.getElementById('global-pause-btn');
  if (mobilePauseBtn) {
    mobilePauseBtn.style.display = '';
    mobilePauseBtn.onclick = (e) => {
      if (window.togglePauseMenu) window.togglePauseMenu(e);
    };
  }
  if (globalPauseBtn) {
    globalPauseBtn.style.display = '';
    globalPauseBtn.onclick = (e) => {
      if (window.togglePauseMenu) window.togglePauseMenu(e);
    };
  }

  // Easter Egg: Ariadne's Thread to the Vault (Path through labyrinth corridors for Ariadne_999 / Aridane_999)
  const myPlayer = (currentLobby && currentLobby.players) ? currentLobby.players[myId] : null;
  const rawName = (myPlayer && myPlayer.username) 
    || localStorage.getItem('manifestation_username') 
    || sessionStorage.getItem('rejoinUsername') 
    || '';
  const cleanName = rawName.trim().toLowerCase();
  const isAriadne = cleanName === 'ariadne_999' || cleanName === 'aridane_999' || cleanName.includes('ariadne') || cleanName.includes('aridane');
  window.isAriadneDev = isAriadne;
  const showAriadneThread = isAriadne;

  if (showAriadneThread) {
    console.log("🌀 [ARIADNE PROTOCOL] Activated for developer/easter-egg operative", rawName);
    buildAriadneThread({ x: camera.position.x, z: camera.position.z });

    if (isAriadne && !window.isTutorialMatch) {
      window.securityLockoutActive = false;
      window.securityLockoutEndTime = 0;
      if (window._securityLockoutTimer) {
        clearTimeout(window._securityLockoutTimer);
        window._securityLockoutTimer = null;
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
        if (b.mesh) {
          if (b.mesh.userData && b.mesh.userData.ledMesh) {
            b.mesh.userData.ledMesh.material.color.setHex(0x10b981);
            b.mesh.userData.ledMesh.material.emissive.setHex(0x10b981);
          }
          if (b.mesh.userData && b.mesh.userData.statusLight) {
            b.mesh.userData.statusLight.color.setHex(0x10b981);
          }
          if (b.mesh.material) {
            if (Array.isArray(b.mesh.material)) {
              b.mesh.material.forEach(m => {
                if (m.map) m.color.setHex(0xdcfce7);
              });
            } else {
              b.mesh.material.color.setHex(0x10b981);
            }
          }
        }
      });
      updateEnvironmentLighting();

      const codeStr = (window.cipherCodeDigits || []).join('');
      setTimeout(() => {
        triggerNotification(`ARIADNE PROTOCOL ACTIVE: Labyrinth thread revealed. Vault Code: ${codeStr}`);
        
        const cipherHUD = document.getElementById('hud-cipher-info');
        if (cipherHUD) {
          cipherHUD.textContent = `CODE: ${codeStr}`;
          cipherHUD.style.color = '#3b82f6';
          cipherHUD.style.letterSpacing = '0.3em';
        }

        checkWinCondition(); // Will update gate lights
      }, 1000);
    }
  }

  // Keyboard controls
  setupControls();

  // Socket listener in-game
  setupSocketListeners();
  
  // Setup Microphone for audio mechanics
  setupMicrophone();

  // Setup keypad button listeners now that the game DOM is visible
  setupKeypadListeners();

  // Pre-spawn 3D character meshes for all other lobby peers so teammates & ghosts are physically visible in person and on the minimap from frame 1
  if (matchConfig && matchConfig.players) {
    let peerSpawnIndex = 1;
    const sx = (window.humanSpawnPos && !isNaN(window.humanSpawnPos.x)) ? window.humanSpawnPos.x : 0;
    const sz = (window.humanSpawnPos && !isNaN(window.humanSpawnPos.z)) ? window.humanSpawnPos.z : 0;

    Object.entries(matchConfig.players).forEach(([pId, pData]) => {
      if (!pId || pId === myId) return;

      const pTeam = pData.team || 'Human';
      const isGhost = pTeam === 'Ghost';
      const pSkinId = pData.skinId || (isGhost ? 'skin_ghost' : 'skin_hazmat');
      const pUsername = pData.username || (isGhost ? 'Phantom' : 'Operative');
      const isVipPlayer = Boolean(pData.isVip);

      let spawnX = sx;
      let spawnZ = sz;
      if (isGhost) {
        const farCorridors = openCorridors.filter(c => Math.hypot(c.x - sx, c.z - sz) > 15);
        if (farCorridors.length > 0) {
          const spawnNode = farCorridors[0];
          spawnX = spawnNode.x;
          spawnZ = spawnNode.z;
        } else {
          spawnX = sx + 20;
          spawnZ = sz + 20;
        }
      } else {
        const angle = (peerSpawnIndex * Math.PI * 2) / Math.max(2, Object.keys(matchConfig.players).length);
        spawnX = sx + Math.cos(angle) * 1.2;
        spawnZ = sz + Math.sin(angle) * 1.2;
        peerSpawnIndex++;
      }

      const pMesh = isGhost ? createGhostMeshGroup(pSkinId) : createHumanMeshGroup(pSkinId, pUsername, isVipPlayer);
      pMesh.userData.isVip = isVipPlayer;
      const glowPref = window.isVipGlowEnabled ? window.isVipGlowEnabled() : true;
      if (isVipPlayer && glowPref) {
        applyVipGlow(pMesh, true);
      }

      // Setup thermal camera support (Cyan for teammates, Red for ghosts)
      const meshThermalMat = new THREE.MeshBasicMaterial({ 
        color: isGhost ? 0xff5555 : 0x38bdf8, 
        fog: false, 
        depthTest: false, 
        side: THREE.DoubleSide 
      });
      pMesh.traverse(c => {
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

      pMesh.position.set(spawnX, isGhost ? 0.35 : 0, spawnZ);
      scene.add(pMesh);
      players3D[pId] = pMesh;
    });
  }

  // Broadcast initial spawn position immediately so peers know our location from t=0
  if (socketClient && !window.isSpectating) {
    socketClient.emit('player_movement', {
      position: { x: camera.position.x, z: camera.position.z },
      rotation: { y: camera.rotation.y },
      team: myTeam,
      characterClass: myClass,
      isVip: window.isVipActive ? window.isVipActive() : false
    });
  }

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
    renderer.setPixelRatio((isMobileDevice || isLowEndHardware) ? 1.0 : Math.min(window.devicePixelRatio || 1, 1.25));
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

  const isQM = inventory.length >= 10;
  const isLarge = inventory.length > 6;
  invGrid.classList.toggle('quartermaster-inventory', isQM);
  invGrid.classList.toggle('large-inventory', isLarge);
  const hotbarContainer = invGrid.closest('.sleek-hotbar-container');
  if (hotbarContainer) {
    hotbarContainer.classList.toggle('quartermaster-inventory', isQM);
    hotbarContainer.classList.toggle('large-inventory', isLarge);
  }

  // --- Class ability items ---
  inventory.forEach((item, index) => {
    const slot = document.createElement('div');
    const isCd = item && abilityCooldowns[item] && abilityCooldowns[item] > now;
    slot.className = index === activeSlot ? 'inventory-slot active' : 'inventory-slot';
    if (isCd) slot.classList.add('on-cooldown');
    slot.style.pointerEvents = 'auto';
    const selectSlot = (e) => {
      e.stopPropagation();
      if (activeSlot === index) {
        if (!isCaptured && !window.isSpectating) {
          useActiveItem();
        }
        return;
      }
      activeSlot = index;
      renderHUDInventory();
    };
    slot.addEventListener('click', selectSlot);
    slot.addEventListener('touchstart', selectSlot, { passive: true });
    slot.addEventListener('pointerdown', selectSlot);
    
    const idxSpan = document.createElement('span');
    idxSpan.className = 'inventory-slot-index';
    if (index === 9) idxSpan.textContent = '0';
    else if (index === 10) idxSpan.textContent = '-';
    else if (index === 11) idxSpan.textContent = '=';
    else idxSpan.textContent = index + 1;
    slot.appendChild(idxSpan);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'item-label';
    nameSpan.textContent = getIconOrShortName(item);
    nameSpan.style.color = index === activeSlot ? '#ffffff' : '#94a3b8';
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
    'Ruby Key':      '#ef4444',
    'Topaz Key':     '#fbbf24',
    'Opal Key':      '#38bdf8',
    'Quartz Key':    '#e2e8f0',
    'Onyx Key':      '#64748b',
    'Pearl Key':     '#fbcfe8',
  };
  const keyIcons = {
    'Amber Key':     '🔑',
    'Sapphire Key':  '🗝️',
    'Violet Key':    '🗝️',
    'Emerald Key':   '🔑',
    'Ruby Key':      '🗝️',
    'Topaz Key':     '🔑',
    'Opal Key':      '🗝️',
    'Quartz Key':    '🔑',
    'Onyx Key':      '🗝️',
    'Pearl Key':     '🗝️',
  };

  // Show 3 slots always (empty ones greyed out)
  for (let i = 0; i < MAX_CARRIED_KEYS; i++) {
    const slot = document.createElement('div');
    slot.className = 'key-slot';

    if (i < carriedKeys.length) {
      const k = carriedKeys[i];
      const isReal = gateSolved && isKeyFunctional(k);
      const typeName = normalizeKeySymbol(k.typeName || k.symbol || 'Unknown Key');
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
let mazeBlockSize = 6.0;
let mazeSizeGlobal = 35;

// Pathfinding helpers
function worldToGrid(wx, wz) {
  const totalCols = (mazeLayout && mazeLayout[0]) ? mazeLayout[0].length : mazeSizeGlobal;
  const totalRows = (mazeLayout && mazeLayout.length) ? mazeLayout.length : mazeSizeGlobal;
  const col = Math.round((wx - mazeBlockSize/2) / mazeBlockSize + totalCols / 2);
  const row = Math.round((wz - mazeBlockSize/2) / mazeBlockSize + totalRows / 2);
  return { col: Math.max(0, Math.min(totalCols - 1, col)), row: Math.max(0, Math.min(totalRows - 1, row)) };
}

function gridToWorld(col, row) {
  const totalCols = (mazeLayout && mazeLayout[0]) ? mazeLayout[0].length : mazeSizeGlobal;
  const totalRows = (mazeLayout && mazeLayout.length) ? mazeLayout.length : mazeSizeGlobal;
  const x = (col - totalCols / 2) * mazeBlockSize + mazeBlockSize/2;
  const z = (row - totalRows / 2) * mazeBlockSize + mazeBlockSize/2;
  return { x, z };
}

// Pre-allocated typed arrays for zero-GC, ultra-fast BFS pathfinding (Max 65x65 grid supported)
const MAX_BFS_NODES = 65 * 65;
const _bfsVisited = new Uint8Array(MAX_BFS_NODES);
const _bfsParent = new Int32Array(MAX_BFS_NODES);
const _bfsQueue = new Int32Array(MAX_BFS_NODES);
let _bfsIterationToken = 1;

function bfsPath(startCol, startRow, endCol, endRow, canPassDoors = false) {
  if (startCol === endCol && startRow === endRow) {
    return [gridToWorld(endCol, endRow)];
  }
  if (!mazeLayout || !mazeLayout[0]) return [];

  const totalCols = mazeLayout[0].length;
  const totalRows = mazeLayout.length;
  const totalNodes = totalCols * totalRows;
  if (totalNodes > MAX_BFS_NODES) return [];

  // Clamp coordinates safely inside grid bounds
  const safeEndCol = Math.max(0, Math.min(totalCols - 1, endCol));
  const safeEndRow = Math.max(0, Math.min(totalRows - 1, endRow));
  const safeStartCol = Math.max(0, Math.min(totalCols - 1, startCol));
  const safeStartRow = Math.max(0, Math.min(totalRows - 1, startRow));

  // Increment token so we never have to reallocate or zero the visited array (O(1) reset)
  _bfsIterationToken = (_bfsIterationToken + 1) & 0xFF;
  if (_bfsIterationToken === 0) {
    _bfsVisited.fill(0);
    _bfsIterationToken = 1;
  }
  const token = _bfsIterationToken;

  const startIdx = safeStartRow * totalCols + safeStartCol;
  const endIdx = safeEndRow * totalCols + safeEndCol;

  let head = 0;
  let tail = 0;

  _bfsQueue[tail++] = startIdx;
  _bfsVisited[startIdx] = token;
  _bfsParent[startIdx] = -1;

  while (head < tail) {
    const currIdx = _bfsQueue[head++];
    if (currIdx === endIdx) {
      // Reconstruct path backward in O(N), then reverse once
      const path = [];
      let cIdx = currIdx;
      while (cIdx !== -1) {
        const r = Math.floor(cIdx / totalCols);
        const c = cIdx % totalCols;
        path.push(gridToWorld(c, r));
        cIdx = _bfsParent[cIdx];
      }
      path.reverse();
      return path;
    }

    const currR = Math.floor(currIdx / totalCols);
    const currC = currIdx % totalCols;

    // Fast 4-way neighbors
    const nbrs = [
      [currR + 1, currC],
      [currR - 1, currC],
      [currR, currC + 1],
      [currR, currC - 1]
    ];

    for (let i = 0; i < 4; i++) {
      const nr = nbrs[i][0];
      const nc = nbrs[i][1];
      if (nc >= 0 && nc < totalCols && nr >= 0 && nr < totalRows) {
        const nIdx = nr * totalCols + nc;
        const cellVal = mazeLayout[nr] ? mazeLayout[nr][nc] : 1;
        const isPassable = (cellVal === 0) || (canPassDoors && cellVal === 2);
        if (_bfsVisited[nIdx] !== token && isPassable) {
          _bfsVisited[nIdx] = token;
          _bfsParent[nIdx] = currIdx;
          _bfsQueue[tail++] = nIdx;
        }
      }
    }
  }

  return [];
}

// Ariadne's Thread: Dynamic Developer Navigation Ribbon to the Vault Gate
function buildAriadneThread(fromPos = null) {
  if (!window.isAriadneDev || !scene || !mazeLayout || !mazeLayout.length) return;

  // 1. Cleanly dispose and remove existing thread group
  const prevGroup = scene.getObjectByName('ariadneThreadGroup');
  if (prevGroup) {
    scene.remove(prevGroup);
    prevGroup.traverse(child => {
      if (child.isMesh || child.isLight) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      }
    });
  }
  window.ariadneOrbs = [];

  // 2. Identify start position
  const pX = (fromPos && typeof fromPos.x === 'number') ? fromPos.x : (camera ? camera.position.x : 0);
  const pZ = (fromPos && typeof fromPos.z === 'number') ? fromPos.z : (camera ? camera.position.z : 0);

  // 3. Find vault end cell (strictly cellVal === 0)
  let endCol = window.vaultC;
  let endRow = window.vaultR;
  if (typeof endCol !== 'number' || typeof endRow !== 'number' || !mazeLayout[endRow] || mazeLayout[endRow][endCol] !== 0) {
    const targetGate = (typeof gateCoordinates !== 'undefined' && gateCoordinates) ? gateCoordinates : { x: 0, z: -35 };
    let bestDist = Infinity;
    for (let r = 0; r < mazeLayout.length; r++) {
      for (let c = 0; c < mazeLayout[r].length; c++) {
        if (mazeLayout[r][c] === 0) {
          const w = gridToWorld(c, r);
          const d = Math.hypot(w.x - targetGate.x, w.z - targetGate.z);
          if (d < bestDist) {
            bestDist = d;
            endCol = c;
            endRow = r;
          }
        }
      }
    }
  }

  // 4. Find nearest open corridor cell to current position (strictly cellVal === 0)
  const startGrid = worldToGrid(pX, pZ);
  let startCol = startGrid.col;
  let startRow = startGrid.row;
  if (!mazeLayout[startRow] || mazeLayout[startRow][startCol] !== 0) {
    let bestDist = Infinity;
    for (let r = 0; r < mazeLayout.length; r++) {
      for (let c = 0; c < mazeLayout[r].length; c++) {
        if (mazeLayout[r][c] === 0) {
          const w = gridToWorld(c, r);
          const d = Math.hypot(w.x - pX, w.z - pZ);
          if (d < bestDist) {
            bestDist = d;
            startCol = c;
            startRow = r;
          }
        }
      }
    }
  }

  if (typeof startCol !== 'number' || typeof endCol !== 'number') return;

  // 5. BFS path strictly impassable to closed shifting walls (canPassDoors = false)
  let path = bfsPath(startCol, startRow, endCol, endRow, false);
  if (!path || path.length === 0) {
    console.warn("🌀 [ARIADNE] No open corridor path currently available to vault gate without traversing closed shifting walls.");
    return;
  }

  // Add the vault portal position as the terminal point
  if (typeof gateCoordinates !== 'undefined' && gateCoordinates) {
    path.push({ x: gateCoordinates.x, z: gateCoordinates.z });
  }

  // 6. Build the 3D ribbon and waypoint orbs along the corridor segments
  const threadGroup = new THREE.Group();
  threadGroup.name = 'ariadneThreadGroup';

  const threadMat = new THREE.MeshBasicMaterial({ 
    color: 0x00ffff, 
    transparent: true, 
    opacity: 0.85, 
    side: THREE.DoubleSide, 
    depthWrite: false 
  });

  const orbGeo = new THREE.SphereGeometry(0.22, 12, 12);
  const orbMat = new THREE.MeshBasicMaterial({ 
    color: 0x38bdf8, 
    transparent: true, 
    opacity: 0.95, 
    depthWrite: false 
  });

  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const segDist = Math.hypot(dx, dz);
    if (segDist < 0.05) continue;

    const angle = Math.atan2(dx, dz);
    const segGeo = new THREE.PlaneGeometry(0.7, segDist);
    const segMesh = new THREE.Mesh(segGeo, threadMat);
    segMesh.rotation.x = -Math.PI / 2;
    segMesh.rotation.z = -angle;
    segMesh.position.set((p1.x + p2.x) / 2, 0.08, (p1.z + p2.z) / 2);
    threadGroup.add(segMesh);

    // Glowing waypoint orb
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.set(p1.x, 0.35, p1.z);
    threadGroup.add(orb);
    window.ariadneOrbs.push(orb);
  }

  if (typeof gateCoordinates !== 'undefined' && gateCoordinates) {
    // Final guide beacon hovering at the top arch of the vault door
    const finalOrb = new THREE.Mesh(orbGeo, orbMat);
    finalOrb.position.set(gateCoordinates.x, 3.2, gateCoordinates.z + 0.3);
    threadGroup.add(finalOrb);

    const gateLight = new THREE.PointLight(0x00ffff, 1.5, 8.0);
    gateLight.position.set(gateCoordinates.x, 3.2, gateCoordinates.z + 0.5);
    threadGroup.add(gateLight);
  }

  scene.add(threadGroup);
}
window.buildAriadneThread = buildAriadneThread;

// Ultra-Fast 2D Grid Raymarching for Bot Line of Sight (Zero 3D raycasting overhead)
function hasGridLineOfSight(x1, z1, x2, z2) {
  if (!mazeLayout || !mazeLayout[0]) return true;
  const totalCols = mazeLayout[0].length;
  const totalRows = mazeLayout.length;

  const g1 = worldToGrid(x1, z1);
  const g2 = worldToGrid(x2, z2);
  const c1 = g1.col;
  const r1 = g1.row;
  const c2 = g2.col;
  const r2 = g2.row;

  let dx = Math.abs(c2 - c1);
  let dz = Math.abs(r2 - r1);
  let sx = (c1 < c2) ? 1 : -1;
  let sz = (r1 < r2) ? 1 : -1;
  let err = dx - dz;

  let currC = c1;
  let currR = r1;

  while (true) {
    if (currR >= 0 && currR < totalRows && currC >= 0 && currC < totalCols) {
      if (mazeLayout[currR][currC] === 1 || mazeLayout[currR][currC] === 2) {
        if (!(currC === c1 && currR === r1) && !(currC === c2 && currR === r2)) {
          return false; // Obstructed by wall or closed sliding door
        }
      }
    }
    if (currC === c2 && currR === r2) break;
    let e2 = 2 * err;
    if (e2 > -dz) { err -= dz; currC += sx; }
    if (e2 < dx) { err += dx; currR += sz; }
  }
  return true;
}

let floorMesh = null;
let ceilingMesh = null;
let staticWallsMesh = null;

// Shared Texture Cache to prevent duplicate GPU memory allocations
const textureCache = new Map();
function getLoadedTexture(url, wrapRepeat = null, isColor = false) {
  const cacheKey = wrapRepeat ? `${url}_${wrapRepeat.x}_${wrapRepeat.y}_${isColor}` : `${url}_${isColor}`;
  if (!textureCache.has(cacheKey)) {
    const tex = new THREE.TextureLoader().load(url);
    if (wrapRepeat) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(wrapRepeat.x, wrapRepeat.y);
    }
    if (isColor && THREE.SRGBColorSpace) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    textureCache.set(cacheKey, tex);
  }
  return textureCache.get(cacheKey);
}

// --- Dungeon Corridor Pack 3D Props & Materials ---
let dungeonAssetsLoaded = false;
let dungeonModules = {
  cross: null,
  t: null,
  corner: null,
  straight2: null,
  straight4: null,
  wall: null,
  squareWall: null,
  pillar: null,
  statue: null,
  rug: null
};
let dungeonWallGeo = null;
let dungeonWallMat = null;
let dungeonPillarGeo = null;
let dungeonPillarMat = null;
let dungeonStatueGeo = null;
let dungeonStatueMat = null;
let dungeonRugGeo = null;
let dungeonRugGeoFull = null;
let dungeonRugGeoArm = null;
let dungeonRugGeoCenterPure = null;
let dungeonRugGeoBorder = null;
let dungeonRugGeoDeadEnd = null;
let dungeonRugCrestGeo = null;
let dungeonRugMat = null;
let dungeonProps = [];
let dungeonPropColliders = []; // Solid collision for pillars (radius 0.60m) and statues (radius 0.80m)
let dungeonPropGrid = new Map(); // Spatial partition for O(1) collision queries
let pendingDungeonPropsFn = null;
let lastDungeonLayout = null;
let lastDungeonBlockSize = 6.0;

/* ── Helper: create PBR material from separate texture PNGs ── */
function makeDungeonMat(colorPath, normalPath, roughPath, opts = {}) {
  const isMobile = isMobileDevice || isLowEndHardware;
  const mat = new THREE.MeshStandardMaterial({
    map:          getLoadedTexture(colorPath, null, true),
    normalMap:    (!isMobile && normalPath) ? getLoadedTexture(normalPath) : null,
    roughnessMap: (!isMobile && roughPath)  ? getLoadedTexture(roughPath)  : null,
    roughness:    opts.roughness ?? 0.6,
    metalness:    opts.metalness ?? 0.05,
    color:        0xffffff,
    emissive:     new THREE.Color(opts.emissive ?? 0x111418),
    emissiveIntensity: opts.emissiveIntensity ?? 0.15,
    side:         opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  });
  mat.needsUpdate = true;
  return mat;
}

/* ── Seamless 100% Opaque Rug Plane Generators (Zero black seams, zero border cutoffs) ── */
// 1. Straight runner with gold borders on left and right, 100% solid opaque (alpha=255)
function createSeamlessRugGeo(width = 2.0, length = 6.0) {
  const geo = new THREE.PlaneGeometry(width, length);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.035, 0);
  const uvAttr = geo.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    // Samples strictly from the 100% opaque runner with gold side borders (zero border fade or black fringe)
    uvAttr.setXY(i, 0.0488 + u * (0.4512 - 0.0488), 0.8150 + v * (0.9200 - 0.8150));
  }
  uvAttr.needsUpdate = true;
  return geo;
}

// 2. Connecting 2m x 2m arm with gold borders on left and right
function createArmRugGeo(width = 2.0, length = 2.0) {
  const geo = new THREE.PlaneGeometry(width, length);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.035, 0);
  const uvAttr = geo.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    uvAttr.setXY(i, 0.0488 + u * (0.4512 - 0.0488), 0.8150 + v * (0.9200 - 0.8150));
  }
  uvAttr.needsUpdate = true;
  return geo;
}

// 3. Center 2m x 2m pure red velvet base (100% opaque, zero borders, zero black seams)
function createPureRedTileGeo(width = 2.0, length = 2.0) {
  const geo = new THREE.PlaneGeometry(width, length);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.035, 0);
  const uvAttr = geo.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    // Samples from center of red velvet field (alpha=255, completely seamless)
    uvAttr.setXY(i, 0.1465 + u * (0.3418 - 0.1465), 0.8242 + v * (0.9218 - 0.8242));
  }
  uvAttr.needsUpdate = true;
  return geo;
}

// 4. Border strip along wall edges of intersections (length 2m, width 0.20m)
function createBorderStripGeo(length = 2.0, width = 0.20) {
  const geo = new THREE.PlaneGeometry(width, length);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.039, 0); // Elevated over red base prevents any z-fighting
  const uvAttr = geo.attributes.uv;
  // Match the exact texture scale of createSeamlessRugGeo and createArmRugGeo:
  // In a 2.0m runner, U spans (0.4512 - 0.0488) over 2.0m.
  // Proportional U span across width:
  const uSpan = (0.4512 - 0.0488) * (width / 2.0);
  for (let i = 0; i < uvAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    // Outer edge (u=0, local X = -width/2) has the gold line, inner edge (u=1, local X = +width/2) blends into red velvet
    uvAttr.setXY(i, 0.0488 + u * uSpan, 0.8150 + v * (0.9200 - 0.8150));
  }
  uvAttr.needsUpdate = true;
  return geo;
}

// 5. Golden Winged Crest rug for shrine cells (proportional center emblem + seamless runner ends)
function createCrestRugGeo(width = 2.0, length = 6.0) {
  // Center crest emblem panel is 0.95m long (aspect ratio 2.0 / 0.95 = 2.10, exact match to texture 522/238 = 2.19)
  const crestLen = 0.95;
  const runnerLen = (length - crestLen) / 2; // ~2.525m on each side

  const geos = [];

  // 1. South runner arm
  const southGeo = new THREE.PlaneGeometry(width, runnerLen);
  southGeo.rotateX(-Math.PI / 2);
  southGeo.translate(0, 0.035, (crestLen + runnerLen) / 2);
  const southUV = southGeo.attributes.uv;
  for (let i = 0; i < southUV.count; i++) {
    const u = southUV.getX(i);
    const v = southUV.getY(i);
    southUV.setXY(i, 0.0488 + u * (0.4512 - 0.0488), 0.8150 + v * (0.9200 - 0.8150));
  }
  southUV.needsUpdate = true;
  geos.push(southGeo);

  // 2. Center crest panel (authentic golden winged crest from panel 4, head facing forward down corridor)
  const crestGeo = new THREE.PlaneGeometry(width, crestLen);
  crestGeo.rotateX(-Math.PI / 2);
  crestGeo.translate(0, 0.039, 0);
  const crestUV = crestGeo.attributes.uv;
  for (let i = 0; i < crestUV.count; i++) {
    const u = crestUV.getX(i);
    const v = crestUV.getY(i);
    crestUV.setXY(i, 0.0488 + u * (0.4590 - 0.0488), 0.2516 - v * (0.2516 - 0.0195));
  }
  crestUV.needsUpdate = true;
  geos.push(crestGeo);

  // 3. North runner arm
  const northGeo = new THREE.PlaneGeometry(width, runnerLen);
  northGeo.rotateX(-Math.PI / 2);
  northGeo.translate(0, 0.035, -(crestLen + runnerLen) / 2);
  const northUV = northGeo.attributes.uv;
  for (let i = 0; i < northUV.count; i++) {
    const u = northUV.getX(i);
    const v = northUV.getY(i);
    northUV.setXY(i, 0.0488 + u * (0.4512 - 0.0488), 0.8150 + v * (0.9200 - 0.8150));
  }
  northUV.needsUpdate = true;
  geos.push(northGeo);

  return BufferGeometryUtils.mergeGeometries(geos);
}

/* ── Authentic Stone Brick Wall Box Generator (100% stone masonry, zero black cutouts or panels) ── */
function createDungeonWallBox(width = 6.0, height = 3.5, depth = 6.0) {
  const geo = new THREE.BoxGeometry(width, height, depth);
  const uvAttr = geo.attributes.uv;
  // BoxGeometry faces: 0 (+X), 1 (-X), 2 (+Y), 3 (-Y), 4 (+Z), 5 (-Z)
  const verticalFaces = [0, 1, 4, 5];
  for (const f of verticalFaces) {
    const base = f * 4;
    for (let i = 0; i < 4; i++) {
      const u = uvAttr.getX(base + i);
      const v = uvAttr.getY(base + i);
      // Map strictly into stone masonry brick band (u: 0.005 -> 0.996, v: 0.495 -> 0.985)
      const mappedU = 0.005 + u * (0.996 - 0.005);
      const mappedV = 0.495 + v * (0.985 - 0.495);
      uvAttr.setXY(base + i, mappedU, mappedV);
    }
  }
  // Architectural stone trim / cap on top face (+Y)
  const topBase = 2 * 4;
  for (let i = 0; i < 4; i++) {
    const u = uvAttr.getX(topBase + i);
    const v = uvAttr.getY(topBase + i);
    uvAttr.setXY(topBase + i, 0.077 + u * (0.918 - 0.077), 0.435 + v * (0.485 - 0.435));
  }
  uvAttr.needsUpdate = true;
  return geo;
}

/* ── Authentic Dungeon Asset Initializer & Loader ── */
function initDungeonMaterialsAndRugs() {
  // Wall — stone wall segment with moldings
  dungeonWallGeo = createDungeonWallBox(0.4, 3.5, 6.0);
  dungeonWallGeo.translate(0, 1.75, 0);
  dungeonWallMat = makeDungeonMat(
    '/assets/dungeon/textures/WallColor.png',
    '/assets/dungeon/textures/WallNormal.png',
    '/assets/dungeon/textures/WallRoughness.png',
    { roughness: 0.85, metalness: 0.05, color: 0xffffff, emissive: 0x000000, emissiveIntensity: 0.0, doubleSide: true }
  );

  // Pillar — ornate column material
  dungeonPillarMat = makeDungeonMat(
    '/assets/dungeon/textures/ColumnColor.png',
    '/assets/dungeon/textures/ColumnNormal.png',
    '/assets/dungeon/textures/ColumnRoughness.png',
    { roughness: 0.8, metalness: 0.02, color: 0xffffff, emissive: 0x111315, emissiveIntensity: 0.1 }
  );

  // Statue — monk statue material
  dungeonStatueMat = makeDungeonMat(
    '/assets/dungeon/textures/StatueColor.png',
    '/assets/dungeon/textures/StatueNormal.png',
    '/assets/dungeon/textures/StatueRoughness.png',
    { roughness: 0.8, metalness: 0.04, color: 0xffffff, emissive: 0x121416, emissiveIntensity: 0.12 }
  );

  // Seamless continuous velvet runner rugs (Full 6m, Modular 2m Hub, 2m Extension Arms, Perimeter Borders, Dead-End 4.4m, Crest 6m)
  dungeonRugGeoFull = createSeamlessRugGeo(2.0, 6.0);
  dungeonRugGeoArm = createArmRugGeo(2.0, 2.0);
  dungeonRugGeoCenterPure = createPureRedTileGeo(2.0, 2.0);
  dungeonRugGeoBorder = createBorderStripGeo(2.0, 0.20);
  dungeonRugGeoDeadEnd = createSeamlessRugGeo(2.0, 4.4);
  dungeonRugGeo = dungeonRugGeoFull;
  dungeonRugCrestGeo = createCrestRugGeo(2.0, 6.0);
  dungeonRugMat = makeDungeonMat(
    '/assets/dungeon/textures/RugColor.png',
    null,
    '/assets/dungeon/textures/RugRoughness.png',
    { roughness: 0.85, emissive: 0x330808, emissiveIntensity: 0.25, doubleSide: true }
  );
  dungeonRugMat.transparent = false;
  dungeonRugMat.depthWrite = true;
  dungeonRugMat.depthTest = true;
  dungeonRugMat.polygonOffset = true;
  dungeonRugMat.polygonOffsetFactor = -1.0;
  dungeonRugMat.polygonOffsetUnits = -1.0;
  dungeonRugMat.needsUpdate = true;
}

let statueLoaded = false;
let pillarLoaded = false;

function checkDungeonAssetsReady() {
  if (statueLoaded && pillarLoaded) {
    dungeonAssetsLoaded = true;
    console.log('[DUNGEON] ✓ Authentic 3D Monk Statue and Ornate Column ready!');
    if (typeof pendingDungeonPropsFn === 'function') {
      pendingDungeonPropsFn();
      pendingDungeonPropsFn = null;
    } else if (dungeonProps.length > 0 && lastDungeonLayout) {
      console.log('[DUNGEON] Refreshing dungeon props with authentic 3D models...');
      spawnDungeonProps(lastDungeonLayout, lastDungeonBlockSize);
    }
  }
}

function loadAuthenticDungeonGeometries() {
  const bufGeoLoader = new THREE.BufferGeometryLoader();

  // Load authentic 3D monk statue (6,876 vertices)
  bufGeoLoader.load(
    '/assets/dungeon/models/statue.json',
    (geo) => {
      // In statue.json, front (face & praying hands) faces -Z (North) natively.
      // Scale by 0.8095 to match authentic 2.27m dungeon scale
      geo.scale(0.8095, 0.8095, 0.8095);
      geo.computeBoundingBox();
      geo.computeVertexNormals();
      dungeonStatueGeo = geo;
      statueLoaded = true;
      console.log('[DUNGEON] ✓ Authentic 3D Monk Statue loaded from statue.json (6,876 vertices)');
      checkDungeonAssetsReady();
    },
    undefined,
    (err) => {
      console.warn('[DUNGEON] Failed to load statue.json:', err);
    }
  );

  // Load authentic 3D ornate pillar (3,300 vertices)
  bufGeoLoader.load(
    '/assets/dungeon/models/pillar.json',
    (geo) => {
      // Scale by 0.463 to match authentic 2.08m dungeon column scale
      geo.scale(0.463, 0.463, 0.463);
      geo.computeBoundingBox();
      geo.computeVertexNormals();
      dungeonPillarGeo = geo;
      pillarLoaded = true;
      console.log('[DUNGEON] ✓ Authentic 3D Ornate Column loaded from pillar.json (3,300 vertices)');
      checkDungeonAssetsReady();
    },
    undefined,
    (err) => {
      console.warn('[DUNGEON] Failed to load pillar.json:', err);
    }
  );

  // Safety fallback after 3s only if network completely unavailable
  setTimeout(() => {
    if (!statueLoaded || !pillarLoaded) {
      console.warn('[DUNGEON] Geometry loading timed out — creating emergency geometric fallbacks');
      if (!dungeonPillarGeo) {
        dungeonPillarGeo = new THREE.CylinderGeometry(0.48, 0.56, 3.5, 16);
        dungeonPillarGeo.translate(0, 1.75, 0);
        pillarLoaded = true;
      }
      if (!dungeonStatueGeo) {
        dungeonStatueGeo = new THREE.BoxGeometry(0.9, 2.8, 0.9);
        dungeonStatueGeo.translate(0, 1.4, 0);
        statueLoaded = true;
      }
      checkDungeonAssetsReady();
    }
  }, 3000);
}

// Backward compatibility wrappers
function createProceduralDungeonAssets() {
  initDungeonMaterialsAndRugs();
  loadAuthenticDungeonGeometries();
}
function loadDungeonPackAssets() {
  // Model loading handled directly by loadAuthenticDungeonGeometries()
}

// Initialize dungeon materials and load authentic 3D models immediately
initDungeonMaterialsAndRugs();
loadAuthenticDungeonGeometries();

function spawnDungeonProps(layout, blockSize) {
  lastDungeonLayout = layout;
  lastDungeonBlockSize = blockSize;

  // Clear any existing props
  dungeonProps.forEach(p => {
    scene.remove(p);
  });
  dungeonProps = [];

  const isDungeon = (localStorage.getItem('manifestation_maze_theme') || 'dungeon') === 'dungeon';
  if (!isDungeon) {
    console.log('[DUNGEON-SPAWN] Theme is not dungeon, skipping props');
    return;
  }

  if (!dungeonAssetsLoaded || !dungeonPillarGeo || !dungeonStatueGeo || !dungeonRugGeo) {
    console.log('[DUNGEON-SPAWN] Assets not ready yet, deferring. loaded:', dungeonAssetsLoaded);
    pendingDungeonPropsFn = () => spawnDungeonProps(layout, blockSize);
    return;
  }

  console.log('[DUNGEON-SPAWN] Placing dungeon props throughout the entire labyrinth...');
  dungeonPropColliders = [];
  dungeonPropGrid.clear();
  let placedPillars = 0;
  let placedStatues = 0;
  let placedRugs = 0;

  const pillarTransforms = [];
  const statueTransforms = [];
  const rugGeometries = [];

  const totalCols = (layout && layout[0] && layout[0].length) ? layout[0].length : (layout ? layout.length : 21);
  const totalRows = layout ? layout.length : 21;

  const maxPillarsBudget = Math.max(1200, Math.ceil(totalRows * totalCols * 1.6));
  const maxStatuesBudget = Math.max(120, Math.ceil(totalRows * totalCols * 0.20));
  const maxRugsBudget = Math.max(6000, Math.ceil(totalRows * totalCols * 3.5));

  const isPassable = (row, col) => {
    if (!layout[row] || layout[row][col] === undefined) return false;
    return layout[row][col] === 0 || layout[row][col] === 2;
  };

  const isStaticWall = (row, col) => {
    if (!layout[row] || layout[row][col] === undefined) return false;
    return layout[row][col] === 1;
  };

  function addPropCollider(px, pz, radius, slidingWallRef = null, type = 'prop') {
    const col = { x: px, z: pz, radius, slidingWallRef, isPillar: type === 'pillar', isStatue: type === 'statue' };
    dungeonPropColliders.push(col);
    const c = Math.floor((px / blockSize) + (totalCols / 2));
    const r = Math.floor((pz / blockSize) + (totalRows / 2));
    const key = (r * 1000) + c;
    if (!dungeonPropGrid.has(key)) dungeonPropGrid.set(key, []);
    dungeonPropGrid.get(key).push(col);
  }

  // Helper: prevent spawning any dungeon prop on top of or within collision radius of a circuit breaker
  function isBlockedByBreaker(x, z, radius = 1.8) {
    return Array.isArray(circuitBreakers) && circuitBreakers.some(b => b.mesh && Math.hypot(b.mesh.position.x - x, b.mesh.position.z - z) < radius);
  }

  // Helper: prevent spawning any column within collision radius of a statue (O(1) local spatial bucket check)
  function isNearStatue(x, z, minDist = 2.8) {
    const c = Math.floor((x / blockSize) + (totalCols / 2));
    const r = Math.floor((z / blockSize) + (totalRows / 2));
    const minDistSq = minDist * minDist;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const bucket = dungeonPropGrid.get(((r + dr) * 1000) + (c + dc));
        if (bucket) {
          for (let i = 0; i < bucket.length; i++) {
            const p = bucket[i];
            if (p.isStatue) {
              const dx = p.x - x;
              const dz = p.z - z;
              if (dx * dx + dz * dz < minDistSq) return true;
            }
          }
        }
      }
    }
    return false;
  }

  function isNearPillar(x, z, minDist = 1.8) {
    const c = Math.floor((x / blockSize) + (totalCols / 2));
    const r = Math.floor((z / blockSize) + (totalRows / 2));
    const minDistSq = minDist * minDist;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const bucket = dungeonPropGrid.get(((r + dr) * 1000) + (c + dc));
        if (bucket) {
          for (let i = 0; i < bucket.length; i++) {
            const p = bucket[i];
            if (p.isPillar) {
              const dx = p.x - x;
              const dz = p.z - z;
              if (dx * dx + dz * dz < minDistSq) return true;
            }
          }
        }
      }
    }
    return false;
  }

  // Helper: prevent spawning props inside or within collision radius of player spawn hub
  function isNearSpawn(x, z, minDist = 1.8) {
    if (!window.humanSpawnPos) return false;
    return Math.hypot(x - window.humanSpawnPos.x, z - window.humanSpawnPos.z) < minDist;
  }

  // Helper: prevent spawning props directly in front of or blocking the master vault entrance
  function isNearVaultDoorway(x, z, minDist = 2.0) {
    if (typeof gateCoordinates === 'undefined' || !gateCoordinates) return false;
    return Math.hypot(x - gateCoordinates.x, z - gateCoordinates.z) < minDist;
  }

  // Helper: prevent spawning pillar or statue on top of a wall lantern sconce
  function isBlockedByLantern(x, z, minDist = 1.3) {
    return Array.isArray(sanctuaryZones) && sanctuaryZones.some(s => {
      const lx = (s.lanternX !== undefined) ? s.lanternX : s.x;
      const lz = (s.lanternZ !== undefined) ? s.lanternZ : s.z;
      return Math.hypot(lx - x, lz - z) < minDist;
    });
  }

  function spawnPillarMesh(px, pz) {
    if (placedPillars >= maxPillarsBudget) return false;
    if (isBlockedByBreaker(px, pz) || isBlockedByLantern(px, pz, 1.3) || isNearSpawn(px, pz) || isNearVaultDoorway(px, pz)) return false;
    if (isNearStatue(px, pz, 0.75)) return false; // Never spawn pillar inside or overlapping a statue
    if (isNearPillar(px, pz, 1.8)) return false;
    pillarTransforms.push({ x: px, z: pz });
    addPropCollider(px, pz, 0.60, null, 'pillar');
    placedPillars++;
    return true;
  }

  function spawnStatueMesh(sx, sz, rotY = 0) {
    if (placedStatues >= maxStatuesBudget) return false;
    if (isBlockedByBreaker(sx, sz) || isBlockedByLantern(sx, sz, 1.4) || isNearSpawn(sx, sz) || isNearVaultDoorway(sx, sz)) return false;
    if (isNearStatue(sx, sz, 2.5)) return false;
    if (isNearPillar(sx, sz, 0.75)) return false; // Never spawn statue inside or overlapping an existing pillar
    statueTransforms.push({ x: sx, z: sz, rotY });
    addPropCollider(sx, sz, 0.80, null, 'statue');
    placedStatues++;
    return true;
  }

  function addRugTile(geo, rx, rz, rotY = 0) {
    if (placedRugs >= maxRugsBudget) return;
    const baseGeo = geo || dungeonRugGeo;
    if (!baseGeo) return;
    const g = baseGeo.clone();
    _scratchDummy.position.set(rx, 0, rz);
    _scratchDummy.rotation.set(0, rotY, 0);
    _scratchDummy.scale.set(1, 1, 1);
    _scratchDummy.updateMatrix();
    g.applyMatrix4(_scratchDummy.matrix);
    rugGeometries.push(g);
    placedRugs++;
  }

  // 1. Master Vault Gate Flanking (Pillars + Statues + Entrance Grand Runner Rug)
  if (typeof gateCoordinates !== 'undefined' && gateCoordinates) {
    const edge = window.vaultEdge || 'N';
    const isNorthSouth = (edge === 'N' || edge === 'S');

    // Pillars flanking gate door frame
    [-2.5, 2.5].forEach(offset => {
      const px = isNorthSouth ? (gateCoordinates.x + offset) : gateCoordinates.x;
      const pz = isNorthSouth ? gateCoordinates.z : (gateCoordinates.z + offset);
      spawnPillarMesh(px, pz);
    });

    [-3.4, 3.4].forEach((offset) => {
      const sx = isNorthSouth ? (gateCoordinates.x + offset) : gateCoordinates.x;
      const sz = isNorthSouth ? gateCoordinates.z : (gateCoordinates.z + offset);
      let rotY = 0;
      if (edge === 'N') rotY = Math.PI;          // Vault on North wall -> faces South (+Z) down corridor
      else if (edge === 'S') rotY = 0;            // Vault on South wall -> faces North (-Z) down corridor
      else if (edge === 'E') rotY = Math.PI / 2;  // Vault on East wall -> faces West (-X) down corridor
      else if (edge === 'W') rotY = -Math.PI / 2; // Vault on West wall -> faces East (+X) down corridor
      spawnStatueMesh(sx, sz, rotY);
    });

    let rugX = gateCoordinates.x;
    let rugZ = gateCoordinates.z;
    let rugRot = 0;
    if (edge === 'N') { rugZ += 2.8; rugRot = 0; }
    else if (edge === 'S') { rugZ -= 2.8; rugRot = Math.PI; }
    else if (edge === 'E') { rugX -= 2.8; rugRot = Math.PI / 2; }
    else if (edge === 'W') { rugX += 2.8; rugRot = -Math.PI / 2; }
    addRugTile(dungeonRugCrestGeo || dungeonRugGeo, rugX, rugZ, rugRot);
  }

  // 2. Light Sanctuaries (Zero Pillars — clean wall sconce clearance)
  // Sanctuary corridors are kept 100% open with zero pillars or blocking statues!

  // 3. Statues at ALL Dead-Ends (facing down corridor on stone plinths)
  // 3. Statues at ALL Dead-Ends (facing down corridor on stone plinths with guaranteed solid back wall)
  if (layout && layout.length > 0) {
    const deadEnds = [];
    const dirs = [
      { dx: 0, dz: -1, rot: 0 },             // Open North (-Z) -> statue against South wall faces North (-Z) into corridor
      { dx: 0, dz: 1, rot: Math.PI },        // Open South (+Z) -> statue against North wall faces South (+Z) into corridor
      { dx: -1, dz: 0, rot: Math.PI / 2 },   // Open West (-X) -> statue against East wall faces West (-X) into corridor
      { dx: 1, dz: 0, rot: -Math.PI / 2 }    // Open East (+X) -> statue against West wall faces East (+X) into corridor
    ];

    for (let r = 1; r < layout.length - 1; r++) {
      for (let c = 1; c < layout[r].length - 1; c++) {
        if (layout[r][c] === 0) {
          let openCount = 0;
          let openDir = null;
          let hasSlidingDoorNeighbor = false;
          for (const d of dirs) {
            if (isPassable(r + d.dz, c + d.dx)) {
              openCount++;
              openDir = d;
            }
            if (layout[r + d.dz] && layout[r + d.dz][c + d.dx] === 2) {
              hasSlidingDoorNeighbor = true;
            }
          }

          // A genuine dead-end alcove MUST:
          // 1. Have exactly 1 open passage in openDir
          // 2. Have NO sliding door neighbors (sliding doors lower/open into passages!)
          // 3. Have a guaranteed solid static wall directly behind the statue (r - openDir.dz, c - openDir.dx)
          // 4. Have guaranteed solid static side walls on the left and right
          if (openCount === 1 && openDir && !hasSlidingDoorNeighbor) {
            const backR = r - openDir.dz;
            const backC = c - openDir.dx;
            const leftR = r - openDir.dx;
            const leftC = c + openDir.dz;
            const rightR = r + openDir.dx;
            const rightC = c - openDir.dz;

            if (isStaticWall(backR, backC) && isStaticWall(leftR, leftC) && isStaticWall(rightR, rightC)) {
              const xPos = (c - layout[r].length / 2) * blockSize + blockSize / 2;
              const zPos = (r - layout.length / 2) * blockSize + blockSize / 2;
              deadEnds.push({ x: xPos, z: zPos, dir: openDir });
            }
          }
        }
      }
    }

    deadEnds.forEach(de => {
      // Don't spawn dead-end shrines right in front of the master vault entrance
      if (isNearVaultDoorway(de.x, de.z, 3.5)) return;

      // 1. Monk statue centered against the back wall
      const backOffsetX = -de.dir.dx * 2.2;
      const backOffsetZ = -de.dir.dz * 2.2;
      const sx = de.x + backOffsetX;
      const sz = de.z + backOffsetZ;
      spawnStatueMesh(sx, sz, de.dir.rot);

      // 2. Flank statue with two ornate columns on LEFT and RIGHT (snug against back wall)
      const isNS = (de.dir.dz !== 0);
      const flankOffset = 1.85; // Distance to left and right from statue center
      const pillarDistFromCenter = 2.45; // Snug against back wall

      [-flankOffset, flankOffset].forEach(fo => {
        let px, pz;
        if (isNS) {
          px = de.x + fo;
          pz = de.z - de.dir.dz * pillarDistFromCenter;
        } else {
          px = de.x - de.dir.dx * pillarDistFromCenter;
          pz = de.z + fo;
        }
        spawnPillarMesh(px, pz);
      });
    });
  }

  // Set to track cells with statue shrines so the carpet uses the golden crest emblem
  const shrineCells = new Set();

  // 4. Side-Wall Statue Shrines along Straight Corridors (Nestled against side wall, flanked by two pillars!)
  // Exactly matches reference photo media_1788720114228.png (Corridor_X4 in dungeon.glb)
  if (layout && layout.length > 0) {
    const wallOffset = 2.20; // 1.20m clearance from carpet edge (2.0m wide runner)
    const pillarWallOffset = 2.45;
    const flankDist = 1.85;

    for (let r = 1; r < layout.length - 1; r++) {
      for (let c = 1; c < layout[r].length - 1; c++) {
        if (layout[r][c] === 0) {
          const northOpen = isPassable(r - 1, c);
          const southOpen = isPassable(r + 1, c);
          const westOpen  = isPassable(r, c - 1);
          const eastOpen  = isPassable(r, c + 1);

          const cx = (c - layout[r].length / 2) * blockSize + blockSize / 2;
          const cz = (r - layout.length / 2) * blockSize + blockSize / 2;

          // Straight North-South corridor (must have solid static walls on West or East)
          if (northOpen && southOpen && !westOpen && !eastOpen) {
            // Deterministic distribution: every ~3-4 straight cells
            if ((r * 7 + c * 11) % 4 === 0) {
              const westSolid = isStaticWall(r, c - 1);
              const eastSolid = isStaticWall(r, c + 1);
              if (westSolid && !isBlockedByBreaker(cx - wallOffset, cz) && !isNearStatue(cx - wallOffset, cz, 4.0)) {
                // Statue against West wall facing East (+X) into corridor
                if (spawnStatueMesh(cx - wallOffset, cz, -Math.PI / 2)) {
                  shrineCells.add(`${r},${c}`);
                  // Flanking Pillars (North & South of statue at ±1.85m)
                  [-flankDist, flankDist].forEach(fo => spawnPillarMesh(cx - pillarWallOffset, cz + fo));
                }
              } else if (eastSolid && !isBlockedByBreaker(cx + wallOffset, cz) && !isNearStatue(cx + wallOffset, cz, 4.0)) {
                // Statue against East wall facing West (-X) into corridor
                if (spawnStatueMesh(cx + wallOffset, cz, Math.PI / 2)) {
                  shrineCells.add(`${r},${c}`);
                  // Flanking Pillars (North & South of statue at ±1.85m)
                  [-flankDist, flankDist].forEach(fo => spawnPillarMesh(cx + pillarWallOffset, cz + fo));
                }
              }
            }
          }

          // Straight East-West corridor (must have solid static walls on North or South)
          if (westOpen && eastOpen && !northOpen && !southOpen) {
            // Deterministic distribution: every ~3-4 straight cells
            if ((r * 7 + c * 11) % 4 === 0) {
              const northSolid = isStaticWall(r - 1, c);
              const southSolid = isStaticWall(r + 1, c);
              if (northSolid && !isBlockedByBreaker(cx, cz - wallOffset) && !isNearStatue(cx, cz - wallOffset, 4.0)) {
                // Statue against North wall facing South (+Z) into corridor
                if (spawnStatueMesh(cx, cz - wallOffset, Math.PI)) {
                  shrineCells.add(`${r},${c}`);
                  // Flanking Pillars (West & East of statue at ±1.85m)
                  [-flankDist, flankDist].forEach(fo => spawnPillarMesh(cx + fo, cz - pillarWallOffset));
                }
              } else if (southSolid && !isBlockedByBreaker(cx, cz + wallOffset) && !isNearStatue(cx, cz + wallOffset, 4.0)) {
                // Statue against South wall facing North (-Z) into corridor
                if (spawnStatueMesh(cx, cz + wallOffset, 0)) {
                  shrineCells.add(`${r},${c}`);
                  // Flanking Pillars (West & East of statue at ±1.85m)
                  [-flankDist, flankDist].forEach(fo => spawnPillarMesh(cx + fo, cz + pillarWallOffset));
                }
              }
            }
          }
        }
      }
    }
  }

  // 5. Ornate Columns Lining Corridor Walls (Architectural cadence lining all labyrinth walls)
  if (layout && layout.length > 0) {
    const wallOffset = 2.45; // Snug against wall in 6.0m wide corridor
    for (let r = 1; r < layout.length - 1; r++) {
      for (let c = 1; c < layout[r].length - 1; c++) {
        if (layout[r][c] === 0) {
          // Dead-End Protection: Dead ends are handled in section 3 with statue & flanking columns
          let openNeighbors = 0;
          if (isPassable(r - 1, c)) openNeighbors++;
          if (isPassable(r + 1, c)) openNeighbors++;
          if (isPassable(r, c - 1)) openNeighbors++;
          if (isPassable(r, c + 1)) openNeighbors++;
          if (openNeighbors <= 1) continue;
          // Shrines already have their own statue and flanking columns; skip placing additional columns here
          if (shrineCells.has(`${r},${c}`)) continue;

          const cx = (c - layout[r].length / 2) * blockSize + blockSize / 2;
          const cz = (r - layout.length / 2) * blockSize + blockSize / 2;

          // West wall
          if (layout[r][c - 1] === 1) {
            if (!(window.vaultEdge === 'W' && c === 1 && r === window.vaultR)) {
              spawnPillarMesh(cx - wallOffset, cz);
            }
          }
          // East wall
          if (layout[r][c + 1] === 1) {
            if (!(window.vaultEdge === 'E' && c === layout[r].length - 2 && r === window.vaultR)) {
              spawnPillarMesh(cx + wallOffset, cz);
            }
          }
          // North wall
          if (layout[r - 1] && layout[r - 1][c] === 1) {
            if (!(window.vaultEdge === 'N' && r === 1 && c === window.vaultC)) {
              spawnPillarMesh(cx, cz - wallOffset);
            }
          }
          // South wall
          if (layout[r + 1] && layout[r + 1][c] === 1) {
            if (!(window.vaultEdge === 'S' && r === layout.length - 2 && c === window.vaultC)) {
              spawnPillarMesh(cx, cz + wallOffset);
            }
          }
        }
      }
    }
  }

  // 6. Seamless Continuous Red Velvet Runner Carpets
  // Connects strictly along all open pathways (open floors & sliding doorways), never clipping into statues, dead-end pedestals, or wall columns!
  if (layout && layout.length > 0) {
    for (let r = 0; r < layout.length; r++) {
      for (let c = 0; c < layout[r].length; c++) {
        if (isPassable(r, c)) {
          const northOpen = isPassable(r - 1, c);
          const southOpen = isPassable(r + 1, c);
          const westOpen  = isPassable(r, c - 1);
          const eastOpen  = isPassable(r, c + 1);

          const openCount = (northOpen ? 1 : 0) + (southOpen ? 1 : 0) + (westOpen ? 1 : 0) + (eastOpen ? 1 : 0);
          if (openCount === 0) continue;

          const rx = (c - layout[r].length / 2) * blockSize + blockSize / 2;
          const rz = (r - layout.length / 2) * blockSize + blockSize / 2;

          // Case A: Dead End (exactly 1 open neighbor) -> rug leads up to statue, stopping cleanly 0.8m before pedestal
          if (openCount === 1) {
            const deadEndGeo = dungeonRugGeoDeadEnd || dungeonRugGeo;
            if (northOpen) {
              addRugTile(deadEndGeo, rx, rz - 0.8, 0);
            } else if (southOpen) {
              addRugTile(deadEndGeo, rx, rz + 0.8, Math.PI);
            } else if (westOpen) {
              addRugTile(deadEndGeo, rx - 0.8, rz, -Math.PI / 2);
            } else if (eastOpen) {
              addRugTile(deadEndGeo, rx + 0.8, rz, Math.PI / 2);
            }
            continue;
          }

          // Case B: Straight Corridors (openCount === 2 with opposite openings)
          const isStraightNS = (openCount === 2 && northOpen && southOpen);
          const isStraightEW = (openCount === 2 && westOpen && eastOpen);

          if (isStraightNS) {
            // Featured at statue shrines and spaced evenly every 4th straight cell (25% frequency - rhythmic, never cluttered)
            const hasCrest = shrineCells.has(`${r},${c}`) || ((r * 13 + c * 17) % 4 === 0);
            const geo = hasCrest ? (dungeonRugCrestGeo || dungeonRugGeoFull) : dungeonRugGeoFull;
            addRugTile(geo, rx, rz, 0);
            continue;
          }
          if (isStraightEW) {
            // Featured at statue shrines and spaced evenly every 4th straight cell (25% frequency - rhythmic, never cluttered)
            const hasCrest = shrineCells.has(`${r},${c}`) || ((r * 13 + c * 17) % 4 === 0);
            const geo = hasCrest ? (dungeonRugCrestGeo || dungeonRugGeoFull) : dungeonRugGeoFull;
            addRugTile(geo, rx, rz, Math.PI / 2);
            continue;
          }

          // Case C: 90-Degree Corners, T-Junctions, and 4-Way Crossroads (openCount >= 2)
          // 1. Center 2m x 2m pure red velvet base (zero borders, 100% solid opaque)
          addRugTile(dungeonRugGeoCenterPure, rx, rz, 0);

          // 2. Add connecting 2m x 2m arms to every open corridor (reaches flush from center hub to cell boundary)
          if (northOpen) addRugTile(dungeonRugGeoArm, rx, rz - 2.0, 0);
          if (southOpen) addRugTile(dungeonRugGeoArm, rx, rz + 2.0, Math.PI);
          if (westOpen)  addRugTile(dungeonRugGeoArm, rx - 2.0, rz, -Math.PI / 2);
          if (eastOpen)  addRugTile(dungeonRugGeoArm, rx + 2.0, rz, Math.PI / 2);

          // 3. Add gold border strips along the WALL sides of the center 2m x 2m hub
          // (Wall sides have borders; OPEN corridor sides have ZERO borders so walking path is 100% seamless!)
          if (!northOpen) addRugTile(dungeonRugGeoBorder, rx, rz - 0.90, -Math.PI / 2); // Faces North (-Z) flush to perimeter wall
          if (!southOpen) addRugTile(dungeonRugGeoBorder, rx, rz + 0.90, Math.PI / 2);  // Faces South (+Z) flush to perimeter wall
          if (!westOpen)  addRugTile(dungeonRugGeoBorder, rx - 0.90, rz, 0);             // Faces West (-X) flush to perimeter wall
          if (!eastOpen)  addRugTile(dungeonRugGeoBorder, rx + 0.90, rz, Math.PI);        // Faces East (+X) flush to perimeter wall
        }
      }
    }
  }

  // 7. Hardware Instancing & Geometry Merging (Consolidates 1,200+ draw calls into 3 single calls!)
  // A. All Floor Runner Rugs -> 1 Single Merged Mesh Draw Call
  if (rugGeometries.length > 0) {
    const mergedRugGeo = BufferGeometryUtils.mergeGeometries(rugGeometries, false);
    if (mergedRugGeo) {
      const mergedRugMesh = new THREE.Mesh(mergedRugGeo, dungeonRugMat);
      mergedRugMesh.receiveShadow = false; // Planar rugs don't need expensive multi-pass self-shadowing
      mergedRugMesh.frustumCulled = false; // Always render floor rugs across whole labyrinth
      mergedRugMesh.renderOrder = 2; // Guaranteed to render AFTER floorMesh (renderOrder=0) to eliminate any Z-fighting
      mergedRugMesh.userData = { isDungeonProp: true, isRug: true };
      scene.add(mergedRugMesh);
      dungeonProps.push(mergedRugMesh);
    }
    rugGeometries.forEach(g => g.dispose());
  }

  // B. All Ornate Columns -> 1 Single InstancedMesh Draw Call
  if (pillarTransforms.length > 0 && dungeonPillarGeo && dungeonPillarMat) {
    const instancedPillars = new THREE.InstancedMesh(dungeonPillarGeo, dungeonPillarMat, pillarTransforms.length);
    for (let i = 0; i < pillarTransforms.length; i++) {
      const p = pillarTransforms[i];
      _scratchDummy.position.set(p.x, 0, p.z);
      _scratchDummy.rotation.set(0, 0, 0);
      _scratchDummy.scale.set(1.5, 1.68, 1.5);
      _scratchDummy.updateMatrix();
      instancedPillars.setMatrixAt(i, _scratchDummy.matrix);
    }
    instancedPillars.instanceMatrix.needsUpdate = true;
    instancedPillars.castShadow = false; // Massively reduces shadow map pass overhead
    instancedPillars.receiveShadow = true;
    instancedPillars.frustumCulled = false; // Ensure pillars remain visible throughout the maze
    instancedPillars.userData = { isDungeonProp: true, isPillar: true };
    scene.add(instancedPillars);
    dungeonProps.push(instancedPillars);
  }

  // C. All Monk Statues -> 1 Single InstancedMesh Draw Call
  if (statueTransforms.length > 0 && dungeonStatueGeo && dungeonStatueMat) {
    const instancedStatues = new THREE.InstancedMesh(dungeonStatueGeo, dungeonStatueMat, statueTransforms.length);
    for (let i = 0; i < statueTransforms.length; i++) {
      const s = statueTransforms[i];
      _scratchDummy.position.set(s.x, 0, s.z);
      _scratchDummy.rotation.set(0, s.rotY, 0);
      _scratchDummy.scale.set(1.3, 1.45, 1.3);
      _scratchDummy.updateMatrix();
      instancedStatues.setMatrixAt(i, _scratchDummy.matrix);
    }
    instancedStatues.instanceMatrix.needsUpdate = true;
    instancedStatues.castShadow = false; // Massively reduces shadow map pass overhead
    instancedStatues.receiveShadow = true;
    instancedStatues.frustumCulled = false; // Ensure statues remain visible throughout the maze
    instancedStatues.userData = { isDungeonProp: true, isStatue: true };
    scene.add(instancedStatues);
    dungeonProps.push(instancedStatues);
  }

  // 6. Sliding Wall Indent Shrines (Monk Statue & Flanking Columns parented to sliding wall)
  // Ensures closed sliding wall indents are never bare empty walls, and seamlessly sink into the floor on key realignment!
  if (slidingWallSegments && slidingWallSegments.length > 0 && dungeonStatueGeo && dungeonPillarGeo) {
    slidingWallSegments.forEach(wallMesh => {
      if (!wallMesh || !wallMesh.userData) return;
      if (wallMesh.userData.decorations) {
        wallMesh.userData.decorations.forEach(d => {
          wallMesh.remove(d);
        });
      }
      wallMesh.userData.decorations = [];

      const r = wallMesh.userData.row;
      const c = wallMesh.userData.col;
      const isEW = wallMesh.userData.isEW;
      const wx = wallMesh.position.x;
      const wz = wallMesh.position.z;

      const addShrineFace = (localX, localZ, rotY, flankAxis) => {
        // Center Monk Statue
        const statue = new THREE.Mesh(dungeonStatueGeo, dungeonStatueMat);
        statue.scale.set(1.3, 1.45, 1.3);
        statue.position.set(localX, 0, localZ);
        statue.rotation.set(0, rotY, 0);
        statue.castShadow = false;
        statue.receiveShadow = true;
        statue.frustumCulled = false;
        wallMesh.add(statue);
        wallMesh.userData.decorations.push(statue);

        // Statue dynamic prop collider tied to sliding wall
        addPropCollider(wx + localX, wz + localZ, 0.70, wallMesh, 'statue');

        // Flanking Ornate Columns (snug against wall at ±1.85m lateral)
        const flankDist = 1.85;
        [-flankDist, flankDist].forEach(fo => {
          const pillar = new THREE.Mesh(dungeonPillarGeo, dungeonPillarMat);
          pillar.scale.set(1.5, 1.68, 1.5);
          const pLocalX = (flankAxis === 'z') ? localX : (localX + fo);
          const pLocalZ = (flankAxis === 'z') ? (localZ + fo) : localZ;
          pillar.position.set(pLocalX, 0, pLocalZ);
          pillar.castShadow = false;
          pillar.receiveShadow = true;
          pillar.frustumCulled = false;
          wallMesh.add(pillar);
          wallMesh.userData.decorations.push(pillar);

          // Pillar dynamic prop collider tied to sliding wall
          addPropCollider(wx + pLocalX, wz + pLocalZ, 0.55, wallMesh, 'pillar');
        });
      };

      const wallFaceOffset = 0.85;

      if (isEW) {
        // Wall spans North-South across an East-West passage
        if (c > 0 && layout[r] && layout[r][c - 1] === 0) {
          addShrineFace(-wallFaceOffset, 0, Math.PI / 2, 'z');
        }
        if (c < layout[r].length - 1 && layout[r] && layout[r][c + 1] === 0) {
          addShrineFace(wallFaceOffset, 0, -Math.PI / 2, 'z');
        }
      } else {
        // Wall spans East-West across a North-South passage
        if (r > 0 && layout[r - 1] && layout[r - 1][c] === 0) {
          addShrineFace(0, -wallFaceOffset, 0, 'x');
        }
        if (r < layout.length - 1 && layout[r + 1] && layout[r + 1][c] === 0) {
          addShrineFace(0, wallFaceOffset, Math.PI, 'x');
        }
      }
    });
  }

  console.log(`[DUNGEON-SPAWN] Successfully placed throughout labyrinth: ${placedPillars} Pillars (Instanced), ${placedStatues} Statues (Instanced), ${placedRugs} Red Runner Rugs (Merged into 1 draw call)!`);
}

// Reusable scratch objects to eliminate Garbage Collection allocations in render loops
const _scratchVec3_1 = new THREE.Vector3();
const _scratchVec3_2 = new THREE.Vector3();
const _scratchNearestHuman = new THREE.Vector3();
const _scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _scratchDummy = new THREE.Object3D();
const _scratchCameraOffset = new THREE.Vector3();
let _tpsCurrentDist = null;

// Ray-AABB intersection test for third-person camera spring arm
function rayAABBIntersect(rx, ry, rz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tMin = -Infinity;
  let tMax = Infinity;

  if (Math.abs(dx) > 1e-6) {
    let t1 = (minX - rx) / dx;
    let t2 = (maxX - rx) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  } else if (rx < minX || rx > maxX) {
    return null;
  }

  if (Math.abs(dy) > 1e-6) {
    let t1 = (minY - ry) / dy;
    let t2 = (maxY - ry) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  } else if (ry < minY || ry > maxY) {
    return null;
  }

  if (Math.abs(dz) > 1e-6) {
    let t1 = (minZ - rz) / dz;
    let t2 = (maxZ - rz) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  } else if (rz < minZ || rz > maxZ) {
    return null;
  }

  if (tMin < 0) return tMax > 0 ? 0 : null;
  return tMin;
}

function syncActiveViewCamera(delta = 0.016) {
  if (!activeViewCamera) return;
  const mode = viewModes[currentViewIndex];
  if (mode === 'fps') {
    activeViewCamera.position.copy(camera.position);
    activeViewCamera.quaternion.copy(camera.quaternion);
    if (localPlayerVisual) localPlayerVisual.visible = false;
    _tpsCurrentDist = null;
    return;
  }

  const isDungeon = Boolean(window.isDungeonKit);
  const ceilingY = (ceilingMesh && typeof ceilingMesh.position.y === 'number') ? ceilingMesh.position.y : (isDungeon ? 3.5 : 4.5);
  const wallHeight = isDungeon ? 3.5 : 4.5;
  const R_cam = 0.35; // Safe padding radius around camera to prevent near-plane wall clipping

  if (mode === 'top_down') {
    // Keep camera safely underneath ceiling so it never clips into the void or sees through the roof
    const safeTopDownY = Math.min(3.15, ceilingY - 0.35);
    activeViewCamera.position.set(camera.position.x, safeTopDownY, camera.position.z);
    activeViewCamera.rotation.set(-Math.PI / 2, camera.rotation.y, 0, 'YXZ');
    if (localPlayerVisual) localPlayerVisual.visible = true;
    _tpsCurrentDist = null;
    return;
  }

  // TPS Modes (tps_shoulder, tps_far)
  _scratchEuler.set(0, camera.rotation.y, 0, 'YXZ');
  if (mode === 'tps_shoulder') {
    _scratchCameraOffset.set(0.55, 0.45, 2.3);
    activeViewCamera.rotation.set(camera.rotation.x, camera.rotation.y + 0.035, 0, 'YXZ');
  } else if (mode === 'tps_far') {
    _scratchCameraOffset.set(0, 1.4, 3.8);
    activeViewCamera.rotation.set(camera.rotation.x - 0.12, camera.rotation.y, 0, 'YXZ');
  }
  _scratchCameraOffset.applyEuler(_scratchEuler);

  // Ray origin (player eye level) and target position
  const px = camera.position.x;
  const py = camera.position.y;
  const pz = camera.position.z;

  const targetDist = _scratchCameraOffset.length();
  if (targetDist < 0.001) {
    activeViewCamera.position.copy(camera.position);
    return;
  }

  const uX = _scratchCameraOffset.x / targetDist;
  const uY = _scratchCameraOffset.y / targetDist;
  const uZ = _scratchCameraOffset.z / targetDist;

  let safeDist = targetDist;

  // 1. Ceiling collision clamp
  if (py + uY * safeDist > ceilingY - R_cam) {
    if (uY > 0.001) {
      const tCeil = (ceilingY - R_cam - py) / uY;
      safeDist = Math.min(safeDist, Math.max(0.2, tCeil));
    }
  }

  // 2. Floor collision clamp
  if (py + uY * safeDist < R_cam) {
    if (uY < -0.001) {
      const tFloor = (R_cam - py) / uY;
      safeDist = Math.min(safeDist, Math.max(0.2, tFloor));
    }
  }

  // 3. Static Maze Walls Occlusion Check
  const blockSize = mazeBlockSize || 4.5;
  const wallHalfSize = blockSize / 2;
  const totalCols = (mazeLayout && mazeLayout[0]) ? mazeLayout[0].length : mazeSizeGlobal;
  const totalRows = mazeLayout ? mazeLayout.length : mazeSizeGlobal;

  const targetX = px + uX * safeDist;
  const targetZ = pz + uZ * safeDist;

  const minC = Math.max(0, Math.floor(Math.min(px, targetX) / blockSize + totalCols / 2) - 1);
  const maxC = Math.min(totalCols - 1, Math.floor(Math.max(px, targetX) / blockSize + totalCols / 2) + 1);
  const minR = Math.max(0, Math.floor(Math.min(pz, targetZ) / blockSize + totalRows / 2) - 1);
  const maxR = Math.min(totalRows - 1, Math.floor(Math.max(pz, targetZ) / blockSize + totalRows / 2) + 1);

  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (mazeLayout && mazeLayout[r] && mazeLayout[r][c] === 1) {
        const wx = (c - totalCols / 2) * blockSize + wallHalfSize;
        const wz = (r - totalRows / 2) * blockSize + wallHalfSize;

        const hitT = rayAABBIntersect(
          px, py, pz,
          uX, uY, uZ,
          wx - wallHalfSize - R_cam, 0, wz - wallHalfSize - R_cam,
          wx + wallHalfSize + R_cam, wallHeight + 0.5, wz + wallHalfSize + R_cam
        );

        if (hitT !== null && hitT < safeDist) {
          safeDist = Math.max(0.2, hitT - 0.05);
        }
      }
    }
  }

  // 4. Dynamic & Sliding Walls Occlusion Check (with rapid distance-squared culling)
  if (walls && walls.length > 0) {
    const maxWallDistSq = (safeDist + wallHalfSize + R_cam) * (safeDist + wallHalfSize + R_cam);
    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      if (!wall || wall.position.y < -0.5) continue; // Lowered sliding doors are clear

      const wx = wall.position.x;
      const wz = wall.position.z;
      const dSq = (wx - px) * (wx - px) + (wz - pz) * (wz - pz);
      if (dSq > maxWallDistSq) continue;

      const hx = (wall.userData && wall.userData.halfSizeX) ? wall.userData.halfSizeX : wallHalfSize;
      const hz = (wall.userData && wall.userData.halfSizeZ) ? wall.userData.halfSizeZ : wallHalfSize;

      const hitT = rayAABBIntersect(
        px, py, pz,
        uX, uY, uZ,
        wx - hx - R_cam, 0, wz - hz - R_cam,
        wx + hx + R_cam, wallHeight + 0.5, wz + hz + R_cam
      );

      if (hitT !== null && hitT < safeDist) {
        safeDist = Math.max(0.2, hitT - 0.05);
      }
    }
  }

  // 5. Solid Dungeon Props (Pillars & Statues) Occlusion Check via O(1) Spatial Grid
  if (dungeonPropGrid && dungeonPropGrid.size > 0) {
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const bucket = dungeonPropGrid.get((r * 1000) + c);
        if (!bucket || bucket.length === 0) continue;
        for (let i = 0; i < bucket.length; i++) {
          const prop = bucket[i];
          if (prop.slidingWallRef && prop.slidingWallRef.position.y < -0.5) continue;
          const effRadius = prop.radius + R_cam;
          const dx = px - prop.x;
          const dz = pz - prop.z;
          const dSq = dx * dx + dz * dz;
          if (dSq > (safeDist + effRadius) * (safeDist + effRadius)) continue;
          const a = uX * uX + uZ * uZ;
          const b = 2 * (dx * uX + dz * uZ);
          const cCoeff = dSq - effRadius * effRadius;
          const disc = b * b - 4 * a * cCoeff;
          if (disc >= 0 && a > 1e-6) {
            const t1 = (-b - Math.sqrt(disc)) / (2 * a);
            if (t1 > 0 && t1 < safeDist) {
              safeDist = Math.max(0.2, t1 - 0.05);
            }
          }
        }
      }
    }
  } else if (dungeonPropColliders && dungeonPropColliders.length > 0) {
    const maxPropDistSq = (safeDist + 2.5 + R_cam) * (safeDist + 2.5 + R_cam);
    for (let i = 0; i < dungeonPropColliders.length; i++) {
      const prop = dungeonPropColliders[i];
      if (!prop || (prop.slidingWallRef && prop.slidingWallRef.position.y < -0.5)) continue;
      const dx = px - prop.x;
      const dz = pz - prop.z;
      const dSq = dx * dx + dz * dz;
      if (dSq > maxPropDistSq) continue;
      const effRadius = prop.radius + R_cam;
      const a = uX * uX + uZ * uZ;
      const b = 2 * (dx * uX + dz * uZ);
      const cCoeff = dSq - effRadius * effRadius;
      const disc = b * b - 4 * a * cCoeff;
      if (disc >= 0 && a > 1e-6) {
        const t1 = (-b - Math.sqrt(disc)) / (2 * a);
        if (t1 > 0 && t1 < safeDist) {
          safeDist = Math.max(0.2, t1 - 0.05);
        }
      }
    }
  }

  // Apply spring arm safe distance with responsive pull-in and smooth ease-out
  if (_tpsCurrentDist === null || Math.abs(_tpsCurrentDist - safeDist) > 5.0) {
    _tpsCurrentDist = safeDist;
  } else if (safeDist < _tpsCurrentDist) {
    // Wall detected behind camera: pull camera in quickly to prevent wall clipping
    _tpsCurrentDist = safeDist;
  } else {
    // Wall cleared: smoothly ease camera back out (15 Hz lerp)
    _tpsCurrentDist = THREE.MathUtils.lerp(_tpsCurrentDist, safeDist, Math.min(1.0, delta * 15.0));
  }

  activeViewCamera.position.set(
    px + uX * _tpsCurrentDist,
    py + uY * _tpsCurrentDist,
    pz + uZ * _tpsCurrentDist
  );

  // If pushed tightly against a wall, hide player mesh to prevent near-plane head clipping (with hysteresis to prevent visual flicker)
  if (localPlayerVisual) {
    if (localPlayerVisual.visible) {
      if (_tpsCurrentDist < 0.38) localPlayerVisual.visible = false;
    } else {
      if (_tpsCurrentDist >= 0.45) localPlayerVisual.visible = true;
    }
  }
}

function generateMaze(keysCount = 8) {
  // Clear any existing walls
  walls.forEach(w => {
    scene.remove(w);
    if (w.userData && w.userData.isDungeonProp) return;
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

  // Cleanup old merged mesh for static walls
  if (staticWallsMesh) {
    scene.remove(staticWallsMesh);
    if (staticWallsMesh.geometry) staticWallsMesh.geometry.dispose();
    if (staticWallsMesh.material) staticWallsMesh.material.dispose();
    staticWallsMesh = null;
  }

  // Clear any existing dungeon props and safely dispose their GPU memory
  dungeonProps.forEach(p => {
    scene.remove(p);
    // Only dispose dynamically generated merged rug geometries, preserving cached shared assets
    if (p.userData && p.userData.isRug && p.geometry) {
      p.geometry.dispose();
    }
    // Release instanced matrix buffers
    if (typeof p.dispose === 'function') {
      p.dispose();
    }
  });
  dungeonProps = [];
  dungeonPropColliders = [];
  dungeonPropGrid.clear();

  // Hide the 3D forest environment so it never appears inside the maze
  if (forestSceneInstance) {
    forestSceneInstance.visible = false;
    if (forestSceneInstance.userData.outdoorSun) forestSceneInstance.userData.outdoorSun.visible = false;
    if (forestSceneInstance.userData.skyHemisphere) forestSceneInstance.userData.skyHemisphere.visible = false;
  }

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

  const currentTheme = localStorage.getItem('manifestation_maze_theme') || 'dungeon';
  const isDungeon = currentTheme === 'dungeon';

  // Ambient light & clear visibility for Dungeon Corridor
  if (ambientLight) {
    if (isDungeon) {
      ambientLight.intensity = 0.55;
      ambientLight.color.setHex(0x758090); // Dark atmospheric medieval stone ambient matching reference
    } else {
      ambientLight.intensity = 2.0;
      ambientLight.color.setHex(0x445566); // Cool facility blue
    }
  }

  // Fog & Atmosphere adjustment for Dungeon Corridor
  if (scene && scene.fog) {
    if (isDungeon) {
      scene.fog.color.setHex(0x06080c);
      scene.fog.density = 0.012; // Dark atmospheric medieval dungeon
    } else {
      scene.fog.color.setHex(0x000000);
      scene.fog.density = 0.015;
    }
  }

  // Ground plane with photorealistic floor texture scaled to difficulty map size
  const blockSize = 6.0;
  mazeBlockSize = blockSize;
  window.mazeBlockSize = blockSize;
  const mazeSize = window.isTutorialMatch ? 11 : ((typeof mazeSizeGlobal !== 'undefined' && mazeSizeGlobal) ? mazeSizeGlobal : getMazeSizeForDifficulty(window.gameDifficulty));
  mazeSizeGlobal = mazeSize;
  window.mazeSizeGlobal = mazeSize;

  const floorExtent = Math.max(300, (mazeSize * blockSize) + 120);
  const floorRep = Math.max(6, Math.round(mazeSize / 4));
  
  let floorMat;
  if (isDungeon) {
    const isMobile = isMobileDevice || isLowEndHardware;
    const dungeonFloorRep = Math.max(15, Math.round(floorExtent / 3.0));
    const groundTex = getLoadedTexture('/assets/dungeon/textures/GroundColor.png', { x: dungeonFloorRep, y: dungeonFloorRep }, true);
    const groundRoughness = !isMobile ? getLoadedTexture('/assets/dungeon/textures/GroundRoughness.png', { x: dungeonFloorRep, y: dungeonFloorRep }) : null;
    const groundNormal = !isMobile ? getLoadedTexture('/assets/dungeon/textures/GroundNormal.png', { x: dungeonFloorRep, y: dungeonFloorRep }) : null;
    floorMat = new THREE.MeshStandardMaterial({ 
      map: groundTex,
      roughnessMap: groundRoughness,
      normalMap: groundNormal,
      roughness: 0.85,
      metalness: 0.05,
      color: 0x656565,
      emissive: 0x000000,
      emissiveIntensity: 0.0,
      side: THREE.FrontSide // FrontSide enables hardware backface culling, doubling fillrate!
    });
  } else {
    const floorTex = getLoadedTexture('/assets/floor_texture.png', { x: floorRep, y: floorRep });
    floorMat = new THREE.MeshStandardMaterial({ 
      map: floorTex,
      bumpMap: floorTex,
      bumpScale: 0.08,
      color: 0x1a1a2e, 
      roughness: 0.92,
      metalness: 0.05,
      side: THREE.FrontSide
    });
  }

  const floorGeo = new THREE.PlaneGeometry(floorExtent, floorExtent);
  floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  floorMesh.frustumCulled = false;
  floorMesh.renderOrder = 0; // Base ground floor always renders first
  scene.add(floorMesh);

  // Ceiling with photorealistic texture scaled to difficulty map size
  const ceilRep = Math.max(5, Math.round(mazeSize / 5));
  let ceilMat;
  if (isDungeon) {
    const dungeonCeilRep = Math.max(15, Math.round(floorExtent / 3.0));
    const ceilTex = getLoadedTexture('/assets/dungeon/textures/GroundColor.png', { x: dungeonCeilRep, y: dungeonCeilRep }, true);
    ceilMat = new THREE.MeshStandardMaterial({ 
      map: ceilTex,
      color: 0x080a0f, 
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.FrontSide // FrontSide enables hardware backface culling!
    });
  } else {
    const ceilTex = getLoadedTexture('/assets/ceiling_texture.png', { x: ceilRep, y: ceilRep });
    ceilMat = new THREE.MeshStandardMaterial({ 
      map: ceilTex,
      color: 0x060a12, 
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.FrontSide
    });
  }
  
  const ceilGeo = new THREE.PlaneGeometry(floorExtent, floorExtent);
  ceilingMesh = new THREE.Mesh(ceilGeo, ceilMat);
  ceilingMesh.rotation.x = Math.PI / 2;
  ceilingMesh.position.y = isDungeon ? 3.5 : 4.5;
  ceilingMesh.frustumCulled = false;
  ceilingMesh.renderOrder = 0;
  scene.add(ceilingMesh);

  // Grid layout for corridors (Procedurally Scaled with Difficulty)
  const layout = Array(mazeSize).fill(0).map(() => Array(mazeSize).fill(1));
  const centerCoord = Math.floor(mazeSize / 2) | 1; // Always an odd index

  // Calculate guaranteed open human spawn coordinates in world space (exact center tile)
  const humanSpawnX = (centerCoord - mazeSize / 2) * blockSize + blockSize / 2;
  const humanSpawnZ = (centerCoord - mazeSize / 2) * blockSize + blockSize / 2;
  window.humanSpawnPos = { x: humanSpawnX, y: 1.6, z: humanSpawnZ };

  // 1. Pure Stack-Based Iterative DFS Maze Carving (Guarantees strict 1-tile tight corridors everywhere)
  const stack = [[centerCoord, centerCoord]];
  layout[centerCoord][centerCoord] = 0;
  if (centerCoord > 1) layout[centerCoord - 1][centerCoord] = 0;
  if (centerCoord < mazeSize - 2) layout[centerCoord + 1][centerCoord] = 0;
  if (centerCoord > 1) layout[centerCoord][centerCoord - 1] = 0;
  if (centerCoord < mazeSize - 2) layout[centerCoord][centerCoord + 1] = 0;

  while (stack.length > 0) {
    const [currX, currZ] = stack[stack.length - 1];
    const neighbors = [];
    const dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];
    
    for (const [dx, dz] of dirs) {
      const nx = currX + dx;
      const nz = currZ + dz;
      if (nx > 0 && nx < mazeSize - 1 && nz > 0 && nz < mazeSize - 1 && layout[nz][nx] === 1) {
        neighbors.push([nx, nz, currX + dx / 2, currZ + dz / 2]);
      }
    }

    if (neighbors.length > 0) {
      const chosenIdx = Math.floor(seededRandom() * neighbors.length);
      const [nx, nz, wallX, wallZ] = neighbors[chosenIdx];
      layout[wallZ][wallX] = 0; // Carve exactly 1-tile path between cells
      layout[nz][nx] = 0;       // Carve target cell
      stack.push([nx, nz]);
    } else {
      stack.pop();
    }
  }

  // 2. Controlled Loop Openings (Only open isolated 1-tile doorways without creating 2x2 or 3x3 open spaces)
  for (let r = 2; r < mazeSize - 2; r += 2) {
    for (let c = 2; c < mazeSize - 2; c += 2) {
      if (layout[r][c] === 1 && seededRandom() < 0.05) {
        // Strict single-wall doorway check: must have walls on perpendicular axis to prevent wide open rooms
        const horizontalDoor = (layout[r][c - 1] === 0 && layout[r][c + 1] === 0 && layout[r - 1][c] === 1 && layout[r + 1][c] === 1);
        const verticalDoor = (layout[r - 1][c] === 0 && layout[r + 1][c] === 0 && layout[r][c - 1] === 1 && layout[r][c + 1] === 1);
        if (horizontalDoor || verticalDoor) {
          layout[r][c] = 0;
        }
      }
    }
  }

  // 3. Randomly select one of the 4 cardinal boundaries for the Master Gate (Vault)
  window.vaultEdge = ['N', 'S', 'E', 'W'][Math.floor(seededRandom() * 4)];
  
  // Find all possible exit points along the chosen edge that are adjacent to the maze paths
  let possibleExits = [];
  if (window.vaultEdge === 'N') {
    for (let c = 1; c < mazeSize - 1; c++) if (layout[1][c] === 0) possibleExits.push(c);
    if (possibleExits.length > 0) {
      window.vaultC = possibleExits[Math.floor(seededRandom() * possibleExits.length)];
      window.vaultR = 0;
    }
  } else if (window.vaultEdge === 'S') {
    for (let c = 1; c < mazeSize - 1; c++) if (layout[mazeSize - 2][c] === 0) possibleExits.push(c);
    if (possibleExits.length > 0) {
      window.vaultC = possibleExits[Math.floor(seededRandom() * possibleExits.length)];
      window.vaultR = mazeSize - 1;
    }
  } else if (window.vaultEdge === 'E') {
    for (let r = 1; r < mazeSize - 1; r++) if (layout[r][mazeSize - 2] === 0) possibleExits.push(r);
    if (possibleExits.length > 0) {
      window.vaultR = possibleExits[Math.floor(seededRandom() * possibleExits.length)];
      window.vaultC = mazeSize - 1;
    }
  } else if (window.vaultEdge === 'W') {
    for (let r = 1; r < mazeSize - 1; r++) if (layout[r][1] === 0) possibleExits.push(r);
    if (possibleExits.length > 0) {
      window.vaultR = possibleExits[Math.floor(seededRandom() * possibleExits.length)];
      window.vaultC = 0;
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

  // Clear the doorway cell in layout so collision allows passage
  if (layout[window.vaultR] && layout[window.vaultR][window.vaultC] !== undefined) {
    layout[window.vaultR][window.vaultC] = 0;
  }

  // 4. BFS Reachability Flood-Fill: Mathematically verify 100% of open maze cells are reachable from spawn
  const reachable = Array(mazeSize).fill(0).map(() => Array(mazeSize).fill(false));
  const bfsQueue = [[centerCoord, centerCoord]];
  reachable[centerCoord][centerCoord] = true;
  const bfsDirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];

  while (bfsQueue.length > 0) {
    const [c, r] = bfsQueue.shift();
    for (const [dc, dr] of bfsDirs) {
      const nc = c + dc;
      const nr = r + dr;
      if (nr >= 0 && nr < mazeSize && nc >= 0 && nc < mazeSize) {
        if (!reachable[nr][nc] && layout[nr][nc] === 0) {
          reachable[nr][nc] = true;
          bfsQueue.push([nc, nr]);
        }
      }
    }
  }

  // Connect any unreachable open pocket by carving direct 1-tile doorways to reachable neighbors
  for (let r = 1; r < mazeSize - 1; r++) {
    for (let c = 1; c < mazeSize - 1; c++) {
      if (layout[r][c] === 0 && !reachable[r][c]) {
        for (const [dc, dr] of bfsDirs) {
          const nc = c + dc;
          const nr = r + dr;
          if (nr > 0 && nr < mazeSize - 1 && nc > 0 && nc < mazeSize - 1) {
            layout[nr][nc] = 0;
            reachable[nr][nc] = true;
            reachable[r][c] = true;
            break;
          }
        }
      }
    }
  }

  // 5. Safe Sliding Doors Placement (Only on single internal walls with open passages on both sides)
  const slidingDoorCount = window.isTutorialMatch ? 0 : Math.round(mazeSize * 0.7);
  let placedDoors = 0;
  let attempts = 0;
  while (placedDoors < slidingDoorCount && attempts < 200) {
    attempts++;
    const rx = 2 + Math.floor(seededRandom() * (mazeSize - 4));
    const rz = 2 + Math.floor(seededRandom() * (mazeSize - 4));
    
    if (Math.abs(rx - centerCoord) <= 2 && Math.abs(rz - centerCoord) <= 2) continue;

    if (layout[rz][rx] === 1) {
      const horizontalValid = (layout[rz][rx - 1] === 0 && layout[rz][rx + 1] === 0 && layout[rz - 1][rx] === 1 && layout[rz + 1][rx] === 1);
      const verticalValid = (layout[rz - 1][rx] === 0 && layout[rz + 1][rx] === 0 && layout[rz][rx - 1] === 1 && layout[rz][rx + 1] === 1);
      if (horizontalValid || verticalValid) {
        layout[rz][rx] = 2; // Sliding door
        placedDoors++;
      }
    }
  }

  // Store layout globally for ghost pathfinding & spatial collision (0=open, 1=static wall, 2=sliding door)
  mazeLayout = layout.map(row => row.map(cell => cell === 2 ? 2 : (cell === 0 ? 0 : 1)));

  let wallMat, slidingWallMat;
  if (isDungeon) {
    const isMobile = isMobileDevice || isLowEndHardware;
    const dungeonWallTex = getLoadedTexture('/assets/dungeon/textures/WallColor.png', null, true);
    const dungeonWallNormal = !isMobile ? getLoadedTexture('/assets/dungeon/textures/WallNormal.png') : null;
    const dungeonWallRoughness = !isMobile ? getLoadedTexture('/assets/dungeon/textures/WallRoughness.png') : null;

    wallMat = new THREE.MeshStandardMaterial({ 
      map: dungeonWallTex,
      normalMap: dungeonWallNormal,
      roughnessMap: dungeonWallRoughness,
      roughness: 0.85,
      metalness: 0.05,
      color: 0x656565,
      emissive: 0x000000,
      emissiveIntensity: 0.0,
      side: THREE.FrontSide // FrontSide enables hardware backface culling, doubling fillrate!
    });
    
    // Sliding wall shares the same textures directly without wasteful GPU cloning
    slidingWallMat = new THREE.MeshStandardMaterial({
      map: dungeonWallTex,
      normalMap: dungeonWallNormal,
      roughnessMap: dungeonWallRoughness,
      roughness: 0.85,
      metalness: 0.05,
      color: 0x5a5a5a,
      side: THREE.FrontSide
    });
  } else {
    const generatedTex = getLoadedTexture('/assets/wall_texture.png', { x: 1, y: 1 });
    const wallBumpTex = getLoadedTexture('/assets/wall_bump_map.png', { x: 1, y: 1 });

    wallMat = new THREE.MeshStandardMaterial({ 
      map: generatedTex,
      bumpMap: wallBumpTex,
      bumpScale: 0.25,
      color: 0x64748b, // Clean balanced stone tone for visibility
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide
    });
    
    slidingWallMat = new THREE.MeshStandardMaterial({
      map: generatedTex,
      bumpMap: wallBumpTex,
      bumpScale: 0.25,
      color: 0x475569,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide
    });
  }

  const wallHeight = isDungeon ? 3.5 : 4.5;
  const wallGeo = isDungeon 
    ? createDungeonWallBox(blockSize + 0.1, wallHeight, blockSize + 0.1) 
    : new THREE.BoxGeometry(blockSize + 0.1, wallHeight, blockSize + 0.1);

  openCorridors = []; // Reset for new maze
  const wallGeometries = [];

  for (let r = 0; r < layout.length; r++) {
    for (let c = 0; c < layout[r].length; c++) {
      const type = layout[r][c];
      const xPos = (c - layout[r].length / 2) * blockSize + blockSize/2;
      const zPos = (r - layout.length / 2) * blockSize + blockSize/2;

      if (type === 1) {
        if (r === window.vaultR && c === window.vaultC) {
          // Master Vault doorway location: skip generating solid wall cube here
          // so the corridor opening is completely unobstructed. The 3D Vault portal,
          // reinforced frame, door, and extraction chamber are built below.
          continue;
        }
        // Static wall: create transformed geometry for single merged mesh
        const singleGeo = isDungeon 
          ? createDungeonWallBox(blockSize + 0.1, wallHeight, blockSize + 0.1) 
          : new THREE.BoxGeometry(blockSize + 0.1, wallHeight, blockSize + 0.1);
        singleGeo.translate(xPos, wallHeight / 2, zPos);
        wallGeometries.push(singleGeo);
      } else if (type === 2) {
        // Dynamic sliding door: Piece #1 (IndAssetWall) or matching procedural door barrier
        let wallMesh;
        const isEW = (c > 0 && layout[r][c - 1] === 0) || (c < layout[r].length - 1 && layout[r][c + 1] === 0);
        const halfX = isEW ? 0.35 : (blockSize / 2);
        const halfZ = isEW ? (blockSize / 2) : 0.35;

        // Precise doorway thickness matching corridor opening, translated vertically so base rests at Y=0 and top touches ceiling
        const doorGeo = isDungeon
          ? createDungeonWallBox(isEW ? 0.7 : blockSize + 0.1, wallHeight, isEW ? blockSize + 0.1 : 0.7)
          : new THREE.BoxGeometry(isEW ? 0.7 : blockSize + 0.1, wallHeight, isEW ? blockSize + 0.1 : 0.7);
        doorGeo.translate(0, wallHeight / 2, 0);

        wallMesh = new THREE.Mesh(doorGeo, slidingWallMat);
        wallMesh.position.set(xPos, 0, zPos);
        wallMesh.castShadow = false;
        wallMesh.receiveShadow = true;


        // Floor sliding trackway plate embedded in the corridor floor
        const trackGeo = new THREE.PlaneGeometry(isEW ? 0.9 : (blockSize + 0.1), isEW ? (blockSize + 0.1) : 0.9);
        const trackMat = new THREE.MeshStandardMaterial({
          color: 0x181a20,
          roughness: 0.6,
          metalness: 0.75
        });
        const trackMesh = new THREE.Mesh(trackGeo, trackMat);
        trackMesh.rotation.x = -Math.PI / 2;
        trackMesh.position.set(xPos, 0.015, zPos);
        trackMesh.receiveShadow = true;
        scene.add(trackMesh);
        dungeonProps.push(trackMesh);

        wallMesh.userData = { 
          isSliding: true, 
          col: c, 
          row: r, 
          halfSizeX: halfX, 
          halfSizeZ: halfZ,
          isEW: isEW
        };
        wallMesh.frustumCulled = false;
        scene.add(wallMesh);
        walls.push(wallMesh);
        slidingWallSegments.push(wallMesh);
      } else {
        openCorridors.push({ x: xPos, z: zPos });
      }
    }
  }

  // Build a single merged Mesh for ALL static walls (1 single draw call, native shadow & light support!)
  if (wallGeometries.length > 0) {
    const mergedGeo = BufferGeometryUtils.mergeGeometries(wallGeometries, false);
    staticWallsMesh = new THREE.Mesh(mergedGeo, wallMat);
    staticWallsMesh.castShadow = false; // Disable heavy shadow map depth pass for static walls
    staticWallsMesh.receiveShadow = true;
    staticWallsMesh.frustumCulled = false;
    scene.add(staticWallsMesh);
    
    // Dispose intermediate individual geometries to free memory
    wallGeometries.forEach(g => g.dispose());
  }

  // Draw the Master Gate — Robust 3D Vault Portal & Extraction Gateway
  const vaultXPos = (window.vaultC - layout[0].length / 2) * blockSize + blockSize/2;
  const vaultZPos = (window.vaultR - layout.length / 2) * blockSize + blockSize/2;

  let offsetX = 0, offsetZ = 0;
  let gateRotY = 0;
  
  // Outer perimeter boundary offset: blockSize is 6.0, half-width is 3.0.
  // The corridor is inside the maze. The door faces inward towards the corridor.
  if (window.vaultEdge === 'N') {
    // North wall: corridor is South (+Z). Door faces South (+Z).
    offsetZ = 3.0; gateRotY = 0;
  } else if (window.vaultEdge === 'S') {
    // South wall: corridor is North (-Z). Door faces North (-Z).
    offsetZ = -3.0; gateRotY = Math.PI;
  } else if (window.vaultEdge === 'E') {
    // East wall: corridor is West (-X). Door faces West (-X).
    offsetX = -3.0; gateRotY = -Math.PI / 2;
  } else if (window.vaultEdge === 'W') {
    // West wall: corridor is East (+X). Door faces East (+X).
    offsetX = 3.0; gateRotY = Math.PI / 2;
  }

  gateCoordinates = { x: vaultXPos + offsetX, z: vaultZPos + offsetZ };
  
  // Clean up any previously created vault portal elements
  if (Array.isArray(vaultObjects)) {
    vaultObjects.forEach(obj => {
      scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }
  vaultObjects = [];
  if (gateBlockerRef) {
    const idx = walls.indexOf(gateBlockerRef);
    if (idx !== -1) walls.splice(idx, 1);
    scene.remove(gateBlockerRef);
    gateBlockerRef = null;
  }
  gateMeshRef = null;
  padMeshRef = null;
  gateKeypadLed = null;

  // Unified Master Vault Group positioned right at the corridor opening
  const vaultGroup = new THREE.Group();
  vaultGroup.position.set(gateCoordinates.x, 0, gateCoordinates.z);
  vaultGroup.rotation.y = gateRotY;
  scene.add(vaultGroup);
  vaultObjects.push(vaultGroup);
  vaultGroupRef = vaultGroup;

  // 1. Heavy Gothic Wrought Iron & Stone Architrave Frame
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x242933,
    metalness: 0.35,
    roughness: 0.7
  });

  // Top header lintel beam spanning between flanking stone pillars
  const lintelGeo = new THREE.BoxGeometry(3.8, 0.38, 0.38);
  const lintelMesh = new THREE.Mesh(lintelGeo, frameMat);
  lintelMesh.position.set(0, 3.25, 0);
  lintelMesh.castShadow = true;
  lintelMesh.receiveShadow = true;
  vaultGroup.add(lintelMesh);

  // Left jamb post
  const leftJambGeo = new THREE.BoxGeometry(0.24, 3.1, 0.38);
  const leftJambMesh = new THREE.Mesh(leftJambGeo, frameMat);
  leftJambMesh.position.set(-1.82, 1.55, 0);
  leftJambMesh.castShadow = true;
  leftJambMesh.receiveShadow = true;
  vaultGroup.add(leftJambMesh);

  // Right jamb post
  const rightJambGeo = new THREE.BoxGeometry(0.24, 3.1, 0.38);
  const rightJambMesh = new THREE.Mesh(rightJambGeo, frameMat);
  rightJambMesh.position.set(1.82, 1.55, 0);
  rightJambMesh.castShadow = true;
  rightJambMesh.receiveShadow = true;
  vaultGroup.add(rightJambMesh);

  // Floor threshold plate
  const threshGeo = new THREE.BoxGeometry(3.8, 0.05, 0.38);
  const threshMesh = new THREE.Mesh(threshGeo, frameMat);
  threshMesh.position.set(0, 0.025, 0);
  threshMesh.receiveShadow = true;
  vaultGroup.add(threshMesh);

  // Decorative iron rivet studs along the lintel beam
  const boltGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8);
  const boltMat = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.9, roughness: 0.3 });
  [-1.4, -0.85, -0.3, 0.3, 0.85, 1.4].forEach(bx => {
    const bolt = new THREE.Mesh(boltGeo, boltMat);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(bx, 3.25, 0.20);
    vaultGroup.add(bolt);
  });

  // 2. The Massive Reinforced 3D Vault Door (gateMeshRef)
  // Cropped strictly to the heavy iron circular lock & reinforced hinges (omits 2D room floor/ceiling)
  const doorGeo = new THREE.BoxGeometry(3.4, 3.06, 0.18);
  const uvAttr = doorGeo.attributes.uv;
  // BoxGeometry face 4 (+Z front face): crop to inner steel door mechanism [u: 0.12..0.88, v: 0.10..0.88]
  const uMin = 0.12, uMax = 0.88;
  const vMin = 0.10, vMax = 0.88;
  uvAttr.setXY(16, uMin, vMax);
  uvAttr.setXY(17, uMax, vMax);
  uvAttr.setXY(18, uMin, vMin);
  uvAttr.setXY(19, uMax, vMin);
  uvAttr.needsUpdate = true;

  const vaultTex = getLoadedTexture('/assets/vault_door.png', null, true);
  const doorFrontMat = new THREE.MeshStandardMaterial({
    map: vaultTex,
    color: 0xffffff,
    metalness: 0.75,
    roughness: 0.65, // Diffused realistic cast iron sheen, zero blown-out glare
    emissive: 0x021520,
    emissiveIntensity: 0.05
  });
  const doorBackMat = new THREE.MeshStandardMaterial({
    color: 0x181e26,
    metalness: 0.8,
    roughness: 0.4
  });
  const doorMaterials = [
    doorBackMat,
    doorBackMat,
    doorBackMat,
    doorBackMat,
    doorFrontMat,
    doorBackMat
  ];
  const gateMesh = new THREE.Mesh(doorGeo, doorMaterials);
  gateMesh.position.set(0, 1.55, 0);
  gateMesh.castShadow = true;
  gateMesh.receiveShadow = true;
  vaultGroup.add(gateMesh);
  gateMeshRef = gateMesh;

  // 3. Overhead Engraved Extraction Plaque (mounted cleanly on lintel beam below ceiling)
  const exitSignGeo = new THREE.BoxGeometry(1.6, 0.22, 0.06);
  const exitSignMat = new THREE.MeshStandardMaterial({
    color: 0x091e2b,
    emissive: 0x06b6d4,
    emissiveIntensity: 0.65,
    roughness: 0.3,
    metalness: 0.8
  });
  const exitSignMesh = new THREE.Mesh(exitSignGeo, exitSignMat);
  exitSignMesh.position.set(0, 3.25, 0.20);
  vaultGroup.add(exitSignMesh);

  // Soft atmospheric cyan extraction beacon casting gentle radiance onto the red runner carpet
  const exitBeacon = new THREE.PointLight(0x06b6d4, 1.4, 10);
  exitBeacon.position.set(0, 3.0, 0.7);
  vaultGroup.add(exitBeacon);

  // 4. 3D Keypad Terminal Station (Grounded Gothic Cast-Iron Pedestal + Heavy Wall Anchor)
  const padGroup = new THREE.Group();
  padGroup.position.set(2.38, 0, 0.36);
  padGroup.rotation.y = -0.15; // Angled invitingly towards approaching player
  vaultGroup.add(padGroup);

  const padMountMat = new THREE.MeshStandardMaterial({ color: 0x181e29, metalness: 0.8, roughness: 0.35 });

  // A. Floor Base Flange Plate resting firmly on dungeon floor
  const baseFlangeGeo = new THREE.BoxGeometry(0.44, 0.06, 0.44);
  const baseFlangeMesh = new THREE.Mesh(baseFlangeGeo, padMountMat);
  baseFlangeMesh.position.set(0, 0.03, 0);
  baseFlangeMesh.receiveShadow = true;
  padGroup.add(baseFlangeMesh);

  // Four corner mounting flange bolts
  const flangeBoltGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.025, 8);
  [[-0.16, -0.16], [-0.16, 0.16], [0.16, -0.16], [0.16, 0.16]].forEach(([bx, bz]) => {
    const bMesh = new THREE.Mesh(flangeBoltGeo, boltMat);
    bMesh.position.set(bx, 0.065, bz);
    padGroup.add(bMesh);
  });

  // B. Sturdy Cast-Iron Support Pedestal Column (eliminates vertical floating)
  const pedestalPostGeo = new THREE.BoxGeometry(0.18, 1.05, 0.18);
  const pedestalPostMesh = new THREE.Mesh(pedestalPostGeo, padMountMat);
  pedestalPostMesh.position.set(0, 0.585, 0);
  pedestalPostMesh.castShadow = true;
  pedestalPostMesh.receiveShadow = true;
  padGroup.add(pedestalPostMesh);

  // Sub-console Capital Collar
  const collarGeo = new THREE.BoxGeometry(0.36, 0.05, 0.28);
  const collarMesh = new THREE.Mesh(collarGeo, padMountMat);
  collarMesh.position.set(0, 1.135, 0);
  padGroup.add(collarMesh);

  // C. Keypad Console Head Housing
  const padMountGeo = new THREE.BoxGeometry(0.42, 0.68, 0.16);
  const padMountMesh = new THREE.Mesh(padMountGeo, padMountMat);
  padMountMesh.position.set(0, 1.48, 0);
  padMountMesh.castShadow = true;
  padMountMesh.receiveShadow = true;
  padGroup.add(padMountMesh);

  // D. Heavy Wall Mounting Anchor Bracket (extends deeply into stone pillar masonry, eliminating rear air gap)
  const wallBracketGeo = new THREE.BoxGeometry(0.26, 0.48, 0.44);
  const wallBracketMesh = new THREE.Mesh(wallBracketGeo, padMountMat);
  wallBracketMesh.position.set(0, 1.48, -0.22);
  wallBracketMesh.castShadow = true;
  padGroup.add(wallBracketMesh);

  // E. Interactive Keypad Interface Plane (Authentic industrial metal terminal)
  const padGeo = new THREE.PlaneGeometry(0.38, 0.62);
  const padTex = getLoadedTexture('/assets/keypad.png', null, true);
  const padMat = new THREE.MeshStandardMaterial({
    map: padTex,
    metalness: 0.3,
    roughness: 0.6,
    emissive: 0x000000,
    emissiveIntensity: 0.0
  });
  const padMesh = new THREE.Mesh(padGeo, padMat);
  padMesh.position.set(0, 1.48, 0.082);
  padGroup.add(padMesh);
  padMeshRef = padMesh;

  // F. Keypad LED Status Light recessed into top bezel
  const ledBezelGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.025, 12);
  const ledBezelMesh = new THREE.Mesh(ledBezelGeo, padMountMat);
  ledBezelMesh.position.set(0, 1.835, 0.03);
  padGroup.add(ledBezelMesh);

  const ledGeo = new THREE.SphereGeometry(0.035, 12, 12);
  const ledMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xef4444,
    emissiveIntensity: 1.5
  });
  const ledMesh = new THREE.Mesh(ledGeo, ledMat);
  ledMesh.position.set(0, 1.85, 0.03);
  padGroup.add(ledMesh);
  gateKeypadLed = ledMesh;
  padMeshRef = padGroup;

  // Accurately compute and cache the world position of the Keypad terminal
  vaultGroup.updateMatrixWorld(true);
  gateKeypadWorldPos = new THREE.Vector3();
  padGroup.getWorldPosition(gateKeypadWorldPos);
  gateKeypadWorldPos.y = 1.5;

  // 5. Extraction Portal Frame & Open Tunnel Wing Walls (Leading out into the 3D Forest)
  const chamberWallMat = (isDungeon && typeof dungeonWallMat !== 'undefined' && dungeonWallMat) ? dungeonWallMat : frameMat;
  const chamberSideGeo = new THREE.BoxGeometry(0.35, 3.6, 3.2);
  const chamberLeftMesh = new THREE.Mesh(chamberSideGeo, chamberWallMat);
  chamberLeftMesh.position.set(-2.2, 1.8, -1.6);
  vaultGroup.add(chamberLeftMesh);

  const chamberRightMesh = new THREE.Mesh(chamberSideGeo, chamberWallMat);
  chamberRightMesh.position.set(2.2, 1.8, -1.6);
  vaultGroup.add(chamberRightMesh);

  // Attach 3D Forest Environment directly outside the vault portal
  attachForestToVault();
  loadForestAsset();
  loadLanternAsset();

  // 6. Invisible Collision Blocker volume preventing players from walking through the closed door
  let blockerSizeX = 4.5, blockerSizeZ = 0.8;
  if (window.vaultEdge === 'E' || window.vaultEdge === 'W') {
    blockerSizeX = 0.8; blockerSizeZ = 4.5;
  }
  const gateBlockerGeo = new THREE.BoxGeometry(blockerSizeX, 4, blockerSizeZ);
  const gateBlockerMat = new THREE.MeshBasicMaterial({ visible: false });
  const gateBlocker = new THREE.Mesh(gateBlockerGeo, gateBlockerMat);
  gateBlocker.position.set(gateCoordinates.x, 2, gateCoordinates.z);
  gateBlocker.userData = { halfSizeX: blockerSizeX / 2, halfSizeZ: blockerSizeZ / 2 };
  scene.add(gateBlocker);
  walls.push(gateBlocker);
  gateBlockerRef = gateBlocker;

  // Initialize dedicated spawn placement tracker with entrance & exit gate protection
  resetSpawnLocations();

  // Spawn Light Sanctuaries FIRST (establishes sanctuaryZones)
  generateLightSanctuaries();
  // Spawn Dungeon Corridor Pack 3D Props (Gothic Pillars, Statues, Rugs)
  spawnDungeonProps(layout, blockSize);
  // Spawn circuit breakers on walls (guaranteed to avoid all pillars and props)
  generateCircuitBreakers();
  // Spawn key collectibles & cipher clue notes
  generateCollectibles(keysCount);
  // Spawn consumable items
  generateConsumableItems();
}

// Spatial isolation tracker ensuring ZERO overlap across all spawn entities
let occupiedSpawnLocations = [];

function resetSpawnLocations() {
  occupiedSpawnLocations = [];
  // 1. Reserve Player Spawn center (0, 0)
  occupiedSpawnLocations.push({ x: 0, z: 0, radius: 5.5, type: 'Spawn' });
  // 2. Reserve Master Gate / Keypad area
  if (typeof gateCoordinates !== 'undefined' && gateCoordinates) {
    occupiedSpawnLocations.push({ x: gateCoordinates.x, z: gateCoordinates.z, radius: 5.5, type: 'Gate' });
  }
}

function isLocationOccupied(x, z, minDist = 4.0) {
  return occupiedSpawnLocations.some(loc => {
    const required = Math.max(minDist, loc.radius || 4.0);
    return Math.hypot(loc.x - x, loc.z - z) < required;
  });
}

function claimSpawnLocation(x, z, radius = 4.0, type = 'Object') {
  occupiedSpawnLocations.push({ x, z, radius, type });
}

function getAvailableCorridors(minDist = 4.0) {
  return openCorridors.filter(c => !isLocationOccupied(c.x, c.z, minDist));
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

  group.rotation.x = Math.PI / 4;
  group.rotation.y = Math.PI / 6;

  return group;
}

// 10 distinct key type definitions matching server gemstone registry: shape + color + name
const KEY_TYPES = [
  { color: 0xf59e0b, emissive: 0xf59e0b, label: 'Amber Key'   },
  { color: 0x60a5fa, emissive: 0x3b82f6, label: 'Sapphire Key' },
  { color: 0xa78bfa, emissive: 0x7c3aed, label: 'Violet Key'   },
  { color: 0x34d399, emissive: 0x10b981, label: 'Emerald Key'  },
  { color: 0xef4444, emissive: 0xdc2626, label: 'Ruby Key'     },
  { color: 0xfbbf24, emissive: 0xd97706, label: 'Topaz Key'    },
  { color: 0x38bdf8, emissive: 0x0284c7, label: 'Opal Key'     },
  { color: 0xe2e8f0, emissive: 0x94a3b8, label: 'Quartz Key'   },
  { color: 0x64748b, emissive: 0x475569, label: 'Onyx Key'     },
  { color: 0xfbcfe8, emissive: 0xf472b6, label: 'Pearl Key'    },
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
  discoveredKeyIds.clear();

  // Also clear old code clue notes
  codeClueNotes.forEach(n => {
    scene.remove(n.mesh);
    if (n.mesh.geometry) n.mesh.geometry.dispose();
    if (n.mesh.material) n.mesh.material.dispose();
  });
  codeClueNotes = [];

  // Guarantee isolated unique corridor positions for each key (no overlapping with other items or clues)
  const realKeys = (functionalKeysRevealed && functionalKeysRevealed.length > 0)
    ? functionalKeysRevealed
    : ['Amber Key', 'Sapphire Key'];

  for (let i = 0; i < keysCount; i++) {
    const kt = KEY_TYPES[i % KEY_TYPES.length];
    const mesh = createKeyMeshGroup(kt.color, kt.emissive);

    // Dedicated gemstone radiance light hovering above the key
    const keyLight = new THREE.PointLight(kt.color, 1.2, 5.0);
    keyLight.position.set(0, 0.35, 0);
    mesh.add(keyLight);

    let corr;
    if (window.isTutorialMatch) {
      if (realKeys[0] && kt.label === realKeys[0]) {
        // Place Key 1 along an accessible corridor (6m to 14m from spawn)
        const nearCorrs = [...openCorridors].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
        corr = nearCorrs.find(c => {
          const d = Math.hypot(c.x, c.z);
          return d >= 6 && d <= 14 && !isLocationOccupied(c.x, c.z, 3.5);
        }) || nearCorrs[0];
      } else if (realKeys[1] && kt.label === realKeys[1] && gateCoordinates) {
        // Place Key 2 near the Master Vault sector (6m to 16m from gate)
        const gateCorrs = [...openCorridors].sort((a, b) => 
          Math.hypot(a.x - gateCoordinates.x, a.z - gateCoordinates.z) - Math.hypot(b.x - gateCoordinates.x, b.z - gateCoordinates.z)
        );
        corr = gateCorrs.find(c => {
          const d = Math.hypot(c.x - gateCoordinates.x, c.z - gateCoordinates.z);
          return d >= 6 && d <= 16 && !isLocationOccupied(c.x, c.z, 3.5);
        }) || gateCorrs[0];
      } else {
        const available = shuffleArray(getAvailableCorridors(3.5));
        corr = available.length > 0 ? available[0] : (openCorridors[i % openCorridors.length] || { x: 0, z: 0 });
      }
    } else {
      const available = shuffleArray(getAvailableCorridors(4.5));
      corr = available.length > 0 ? available[0] : (openCorridors[i % openCorridors.length] || { x: 0, z: 0 });
    }
    
    mesh.position.set(corr.x, 0.45, corr.z);
    mesh.userData.keyTypeLabel = kt.label;
    scene.add(mesh);

    claimSpawnLocation(corr.x, corr.z, window.isTutorialMatch ? 3.5 : 4.5, `Key_${kt.label}`);
    keysInMaze.push({ id: 'key_' + i, mesh, symbol: kt.label, index: i, typeName: kt.label });
  }

  // Spawn code clue notes — small glowing plates hinting at the cipher code digits in unique rooms
  generateCodeClues();
}

function generateCodeClues() {
  codeClueNotes.forEach(n => {
    if (n.mesh) {
      scene.remove(n.mesh);
      n.mesh.traverse(child => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
        }
      });
    }
  });
  codeClueNotes = [];

  // Parchment note lying flat on the floor (like items and supplies)
  const noteGeo = new THREE.BoxGeometry(0.65, 0.03, 0.85);
  const noteMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xfde047,
    emissiveIntensity: 0.9,
    roughness: 0.5,
    metalness: 0.05
  });

  for (let i = 0; i < 4; i++) {
    let corr;
    if (window.isTutorialMatch && i === 0 && openCorridors.length > 0) {
      const nearCorridors = [...openCorridors].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
      corr = nearCorridors.find(c => {
        const d = Math.hypot(c.x, c.z);
        return d >= 6 && d <= 16 && !isLocationOccupied(c.x, c.z, 3.5);
      }) || nearCorridors[Math.min(2, nearCorridors.length - 1)];
    } else {
      const available = shuffleArray(getAvailableCorridors(window.isTutorialMatch ? 2.5 : 4.5));
      corr = available.length > 0 ? available[0] : (openCorridors[i % openCorridors.length] || { x: 0, z: 0 });
    }

    const noteMesh = new THREE.Mesh(noteGeo, noteMat.clone());
    // Lie flat slightly above floor (y = 0.05m) to avoid any z-fighting with carpets or stone tiles
    noteMesh.position.set(corr.x, 0.05, corr.z);
    noteMesh.rotation.y = seededRandom() * Math.PI;

    // Dedicated subtle golden point light hovering slightly above the floor note
    const clueLight = new THREE.PointLight(0xfef08a, 1.2, 4.5);
    clueLight.position.set(0, 0.35, 0);
    noteMesh.add(clueLight);

    scene.add(noteMesh);
    claimSpawnLocation(corr.x, corr.z, window.isTutorialMatch ? 2.5 : 4.5, `Clue_${i}`);
    codeClueNotes.push({ mesh: noteMesh, digitIndex: i, collected: false });
  }
}

function generateCircuitBreakers() {
  circuitBreakers.forEach(b => {
    if (b.mesh) {
      scene.remove(b.mesh);
      b.mesh.traverse(child => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
        }
      });
    }
  });
  circuitBreakers = [];
  fixedBreakersCount = 0;

  const totalRows = mazeLayout ? mazeLayout.length : mazeSizeGlobal;
  const totalCols = (mazeLayout && mazeLayout[0]) ? mazeLayout[0].length : totalRows;
  const blockSize = mazeBlockSize || 6.0;
  const breakerThickness = 0.16;
  const wallFaceOffset = (blockSize / 2) - (breakerThickness / 2); // 2.92m from center to wall surface

  const breakerGeo = new THREE.BoxGeometry(0.95, 0.95, breakerThickness);
  const breakerTex = getLoadedTexture('/assets/breaker_texture.png');
  const casingMat = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.6, metalness: 0.7 });
  const faceMat = new THREE.MeshStandardMaterial({ map: breakerTex, color: 0xffffff, roughness: 0.45, metalness: 0.75 });
  // BoxGeometry faces: 0 (+X), 1 (-X), 2 (+Y), 3 (-Y), 4 (+Z - Front), 5 (-Z - Back)
  const breakerMaterials = [casingMat, casingMat, casingMat, casingMat, faceMat, casingMat];

  // Gather all open corridor cells that have at least one adjacent static wall (mazeLayout === 1)
  const wallCandidates = [];
  for (let r = 1; r < totalRows - 1; r++) {
    for (let c = 1; c < totalCols - 1; c++) {
      // Strictly ONLY open corridor cells (never sliding door cells or walls)
      if (!mazeLayout[r] || mazeLayout[r][c] !== 0) continue;

      // Never spawn in a cell that touches a dynamic sliding door trackway/mechanism
      const touchesSlidingDoor = [
        [-1, 0], [1, 0], [0, -1], [0, 1]
      ].some(([dr, dc]) => {
        const ar = r + dr;
        const ac = c + dc;
        return mazeLayout[ar] && mazeLayout[ar][ac] === 2;
      });
      if (touchesSlidingDoor) continue;

      const corrX = (c - totalCols / 2) * blockSize + blockSize / 2;
      const corrZ = (r - totalRows / 2) * blockSize + blockSize / 2;

      const dirs = [
        { dc: 0, dr: -1, candX: corrX, candZ: corrZ - wallFaceOffset, rotY: 0 },          // North wall, faces South (+Z)
        { dc: 0, dr: 1,  candX: corrX, candZ: corrZ + wallFaceOffset, rotY: Math.PI },      // South wall, faces North (-Z)
        { dc: -1, dr: 0, candX: corrX - wallFaceOffset, candZ: corrZ, rotY: Math.PI / 2 },  // West wall, faces East (+X)
        { dc: 1, dr: 0,  candX: corrX + wallFaceOffset, candZ: corrZ, rotY: -Math.PI / 2 }  // East wall, faces West (-X)
      ];

      for (const d of dirs) {
        const nr = r + d.dr;
        const nc = c + d.dc;
        if (nr >= 0 && nr < totalRows && nc >= 0 && nc < totalCols && mazeLayout[nr][nc] === 1) {
          // Never mount on dynamic sliding doors
          if (mazeLayout[nr][nc] === 2) continue;

          // Avoid solid pillars and monk statues (O(1) local spatial bucket check)
          let collidesWithSolidProp = false;
          if (dungeonPropGrid && dungeonPropGrid.size > 0) {
            const candC = Math.floor((d.candX / blockSize) + (totalCols / 2));
            const candR = Math.floor((d.candZ / blockSize) + (totalRows / 2));
            for (let dr = -1; dr <= 1 && !collidesWithSolidProp; dr++) {
              for (let dc = -1; dc <= 1 && !collidesWithSolidProp; dc++) {
                const bucket = dungeonPropGrid.get(((candR + dr) * 1000) + (candC + dc));
                if (bucket) {
                  for (let pi = 0; pi < bucket.length; pi++) {
                    const p = bucket[pi];
                    if (Math.hypot(p.x - d.candX, p.z - d.candZ) < (p.radius + 0.85)) {
                      collidesWithSolidProp = true;
                      break;
                    }
                  }
                }
              }
            }
          } else {
            collidesWithSolidProp = dungeonPropColliders.some(p => Math.hypot(p.x - d.candX, p.z - d.candZ) < (p.radius + 0.85));
          }
          if (collidesWithSolidProp) continue;

          // Avoid Master Vault Gate area
          if (typeof gateCoordinates !== 'undefined' && gateCoordinates) {
            if (Math.hypot(d.candX - gateCoordinates.x, d.candZ - gateCoordinates.z) < 6.0) continue;
          }

          // Avoid Human spawn center
          const sx = (window.humanSpawnPos && !isNaN(window.humanSpawnPos.x)) ? window.humanSpawnPos.x : 0;
          const sz = (window.humanSpawnPos && !isNaN(window.humanSpawnPos.z)) ? window.humanSpawnPos.z : 0;
          if (Math.hypot(d.candX - sx, d.candZ - sz) < 5.0) continue;

          // Avoid Light Sanctuary centers
          if (typeof sanctuaryZones !== 'undefined' && Array.isArray(sanctuaryZones)) {
            if (sanctuaryZones.some(s => Math.hypot(d.candX - s.x, d.candZ - s.z) < 5.0)) continue;
          }

          wallCandidates.push({
            x: d.candX,
            z: d.candZ,
            rotY: d.rotY,
            corrX,
            corrZ
          });
        }
      }
    }
  }

  const shuffledCandidates = shuffleArray(wallCandidates);
  if (window.isTutorialMatch) {
    shuffledCandidates.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  }

  for (let i = 0; i < totalBreakersRequired; i++) {
    // Attempt spacing with 10m threshold, then 6m, then any candidate
    let chosen = null;
    for (const minSpacing of [10.0, 6.0, 0.0]) {
      chosen = shuffledCandidates.find(cand => {
        return !circuitBreakers.some(b => Math.hypot(b.mesh.position.x - cand.x, b.mesh.position.z - cand.z) < minSpacing);
      });
      if (chosen) break;
    }

    // Failsafe: if no candidates survived prop filter, select any open wall face
    if (!chosen && shuffledCandidates.length > 0) {
      chosen = shuffledCandidates[i % shuffledCandidates.length];
    }

    const mesh = new THREE.Mesh(breakerGeo, breakerMaterials.map(m => m.clone()));
    const posY = 1.60; // Eye-level flush wall mounting

    if (chosen) {
      mesh.position.set(chosen.x, posY, chosen.z);
      mesh.rotation.y = chosen.rotY;
      claimSpawnLocation(chosen.corrX, chosen.corrZ, 4.0, `Breaker_${i}`);
    } else {
      // Last-resort fallback pinned to border wall
      mesh.position.set((totalCols / 2 - 1) * blockSize, posY, -wallFaceOffset);
      mesh.rotation.y = 0;
    }

    // Top Status Indicator LED (Amber/Red when broken, Green when fixed)
    const ledGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.08, 12);
    const ledMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 1.5 });
    const ledMesh = new THREE.Mesh(ledGeo, ledMat);
    ledMesh.position.set(0, 0.51, 0.04);
    mesh.add(ledMesh);

    const statusLight = new THREE.PointLight(0xef4444, 1.2, 3.5);
    statusLight.position.set(0, 0.54, 0.08);
    mesh.add(statusLight);

    mesh.userData = {
      id: `breaker_${i}`,
      ledMesh: ledMesh,
      statusLight: statusLight
    };

    scene.add(mesh);

    circuitBreakers.push({
      id: `breaker_${i}`,
      mesh: mesh,
      isFixed: false
    });
  }
}

// Item Visual & Audio Configuration for 3D In-World Collectibles
const ITEM_CONFIGS = {
  'EMF Radar':        { tex: '/assets/emf_sprite.png',     haloColor: 0x38bdf8, emissive: 0x0284c7 },
  'Battery Pack':     { tex: '/assets/battery_sprite.png', haloColor: 0xf59e0b, emissive: 0xd97706 },
  'Thermal Camera':   { tex: '/assets/thermal_sprite.png', haloColor: 0xef4444, emissive: 0xdc2626 },
  'Sanity Pills':     { tex: '/assets/pills_sprite.png',   haloColor: 0x10b981, emissive: 0x059669 },
  'Med Kit':          { tex: '/assets/medkit_sprite.png',  haloColor: 0x22c55e, emissive: 0x16a34a },
  'Salt Cannister':   { tex: '/assets/salt_sprite.png',    haloColor: 0xe2e8f0, emissive: 0x94a3b8 },
  'Breaker Remote':   { tex: '/assets/remote_sprite.png',  haloColor: 0xa855f7, emissive: 0x9333ea },
  'Adrenaline Shot':  { tex: '/assets/pills_sprite.png',   haloColor: 0xf97316, emissive: 0xea580c },
  'Chalk / UV Spray': { tex: '/assets/salt_sprite.png',    haloColor: 0x06b6d4, emissive: 0x0891b2 },
  'Defibrillator':    { tex: '/assets/medkit_sprite.png',  haloColor: 0xeab308, emissive: 0xca8a04 }
};

function disposeItemMesh(mesh) {
  if (!mesh) return;
  scene.remove(mesh);
  mesh.traverse(child => {
    if (child.isMesh || child.isSprite) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  });
}

function createItemPickupMesh(id, name, pos) {
  const conf = ITEM_CONFIGS[name] || {
    tex: '/assets/battery_sprite.png',
    haloColor: 0x38bdf8,
    emissive: 0x0284c7
  };

  const group = new THREE.Group();
  group.name = `pickup_${id}`;
  // Floating at eye-friendly y = 0.45 ensures it hovers clearly above floor & carpets (y = 0.035)
  group.position.set(pos.x, 0.45, pos.z);

  // 1. High-Clarity 2D Sprite Billboard (matches reference photo with 100% solid, crystal-clear visibility)
  const tex = getLoadedTexture(conf.tex);
  const spriteMat = new THREE.SpriteMaterial({
    map: tex,
    color: 0xffffff,
    fog: true,
    transparent: true,
    alphaTest: 0.05, // Discards transparent background fragments cleanly
    blending: THREE.NormalBlending, // Crisp, solid colors & sharp text, zero black boxes!
    depthTest: true,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(0.72, 0.72, 1);
  sprite.position.set(0, 0, 0);
  group.add(sprite);

  // 2. Ground illuminated beacon halo ring on floor/carpet
  const ringGeo = new THREE.RingGeometry(0.12, 0.45, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: conf.haloColor || 0x38bdf8,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.415; // Local offset puts ring at world y = 0.035 (resting right on carpet)
  group.add(ring);

  group.userData.sprite = sprite;
  group.userData.ring = ring;
  group.userData.bobOffset = Math.random() * Math.PI * 2;

  scene.add(group);
  return group;
}

function generateConsumableItems() {
  itemsInMaze.forEach(item => {
    disposeItemMesh(item.mesh);
  });
  itemsInMaze = [];

  // Guaranteed essential items + random utility loot
  const itemsToSpawn = [
    'EMF Radar',
    'Thermal Camera',
    'Breaker Remote',
    'Battery Pack',
    'Battery Pack',
    'Battery Pack',
    'Battery Pack',
    'Battery Pack',
    'Battery Pack'
  ];
  for (let i = 0; i < 10; i++) {
    const rand = seededRandom();
    if (rand > 0.7) {
      itemsToSpawn.push('Battery Pack'); // Extra Battery
    } else if (rand > 0.4) {
      itemsToSpawn.push('Sanity Pills'); // Sanity Pills
    } else if (rand > 0.2) {
      itemsToSpawn.push('Med Kit'); // Med Kit
    } else {
      itemsToSpawn.push('Salt Cannister'); // Salt Cannister
    }
  }

  itemsToSpawn.forEach((name, idx) => {
    // Pick unique un-occupied corridor cell
    const available = shuffleArray(getAvailableCorridors(4.0));
    const corr = available.length > 0 ? available[0] : (openCorridors[idx % openCorridors.length] || { x: 0, z: 0 });

    const itemId = 'item_' + seededRandom().toString(36).substr(2, 9);
    const mesh = createItemPickupMesh(itemId, name, corr);

    claimSpawnLocation(corr.x, corr.z, 4.0, `Item_${name}`);
    itemsInMaze.push({
      id: itemId,
      mesh: mesh,
      name: name
    });
  });

  // In Tutorial Mode, place a guaranteed Battery Pack and Med Kit in corridors right next to human spawn
  if (window.isTutorialMatch && openCorridors.length > 0) {
    const nearCorridors = [...openCorridors].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    if (nearCorridors[1]) {
      const c = nearCorridors[1];
      const itemId = 'tutorial_battery';
      const mesh = createItemPickupMesh(itemId, 'Battery Pack', c);
      itemsInMaze.push({ id: itemId, mesh: mesh, name: 'Battery Pack' });
    }
    if (nearCorridors[2]) {
      const c = nearCorridors[2];
      const itemId = 'tutorial_medkit';
      const mesh = createItemPickupMesh(itemId, 'Med Kit', c);
      itemsInMaze.push({ id: itemId, mesh: mesh, name: 'Med Kit' });
    }
  }
}

// --- Feature 4: 3D Gothic UV Lantern Wall Sconce Asset Loader (/assets/latern.glb) ---
let preloadedLanternModel = null;
let isLanternLoading = false;

export function loadLanternAsset() {
  if (preloadedLanternModel || isLanternLoading) return;
  isLanternLoading = true;

  gltfLoader.load('/assets/latern.glb', (gltf) => {
    try {
      const rawScene = gltf.scene;
      rawScene.updateMatrixWorld(true);

      // Find vertex bounds across the model
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;

      const tempV = new THREE.Vector3();
      rawScene.traverse((child) => {
        if (child.isMesh && child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
          const pos = child.geometry.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            tempV.fromBufferAttribute(pos, i);
            tempV.applyMatrix4(child.matrixWorld);
            if (tempV.x < minX) minX = tempV.x;
            if (tempV.x > maxX) maxX = tempV.x;
            if (tempV.y < minY) minY = tempV.y;
            if (tempV.y > maxY) maxY = tempV.y;
            if (tempV.z < minZ) minZ = tempV.z;
            if (tempV.z > maxZ) maxZ = tempV.z;
          }
        }
      });

      const totalHeight = maxY - minY;
      const targetScale = (totalHeight > 0) ? (0.90 / totalHeight) : 0.768;

      // The rectangular mounting plate is flush at maxZ, centered at (minX + maxX)/2 horizontally, and plate Y at maxY - 0.109
      const plateX = (minX + maxX) / 2;
      const plateY = maxY - 0.109;
      const plateZ = maxZ;

      // Create a normalized master template group
      const normalizedGroup = new THREE.Group();
      normalizedGroup.name = 'lantern_master_template';

      rawScene.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = false;
          if (child.material) {
            child.material.side = THREE.DoubleSide;
            // Warm golden amber UV sanctuary glow
            child.material.emissive = new THREE.Color(0xf59e0b);
            child.material.emissiveIntensity = 2.4;
            child.material.roughness = THREE.MathUtils.clamp(child.material.roughness || 0.45, 0.35, 0.7);
            child.material.metalness = THREE.MathUtils.clamp(child.material.metalness || 0.7, 0.5, 0.9);
            if (child.material.map) child.material.map.colorSpace = THREE.SRGBColorSpace;
            if (child.material.emissiveMap) child.material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
          }
        }
      });

      // Scale and offset rawScene so (0, 0, 0) is the flush back surface center of the wall mounting plate
      rawScene.scale.set(targetScale, targetScale, targetScale);
      rawScene.position.set(-plateX * targetScale, -plateY * targetScale, -plateZ * targetScale);

      normalizedGroup.add(rawScene);
      preloadedLanternModel = normalizedGroup;
      isLanternLoading = false;
      console.log('[LANTERN] Authentic 3D UV Lantern wall sconce (/assets/latern.glb) loaded & normalized successfully!');

      // Upgrade any sanctuary zones spawned before the GLB finished loading
      upgradeExistingSanctuaryLanterns();
    } catch (err) {
      console.warn('[LANTERN] Error processing /assets/latern.glb:', err);
      isLanternLoading = false;
    }
  }, undefined, (err) => {
    console.warn('[LANTERN] Error loading /assets/latern.glb:', err);
    isLanternLoading = false;
  });
}

// --- Feature 4: 3D Gothic UV Ceiling Lantern & Wall Sconce Asset System ---
function createCeilingLanternGroup() {
  const lanternGroup = new THREE.Group();
  lanternGroup.name = 'ceiling_sanctuary_lantern';

  // Materials
  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x1f242d,
    roughness: 0.65,
    metalness: 0.85
  });

  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    emissive: 0xb45309,
    emissiveIntensity: 0.4,
    roughness: 0.35,
    metalness: 0.85
  });

  const amberGlassMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xf59e0b,
    emissiveIntensity: 1.8,
    roughness: 0.2,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85
  });

  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a
  });

  // 1. Ceiling Rosette Mounting Plate at Y = 3.47 (flush with ceiling at 3.5m)
  const rosetteGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.05, 16);
  const rosetteMesh = new THREE.Mesh(rosetteGeo, ironMat);
  rosetteMesh.position.y = 3.47;
  lanternGroup.add(rosetteMesh);

  // 2. Ceiling Hook
  const hookGeo = new THREE.TorusGeometry(0.06, 0.02, 8, 16);
  const hookMesh = new THREE.Mesh(hookGeo, ironMat);
  hookMesh.position.y = 3.42;
  hookMesh.rotation.x = Math.PI / 2;
  lanternGroup.add(hookMesh);

  // 3. Hanging Chain (Interlocking links between Y = 3.40 and Y = 2.65)
  const chainStemGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.75, 8);
  const chainStemMesh = new THREE.Mesh(chainStemGeo, ironMat);
  chainStemMesh.position.y = 3.02;
  lanternGroup.add(chainStemMesh);

  for (let y = 3.35; y >= 2.70; y -= 0.14) {
    const linkGeo = new THREE.TorusGeometry(0.045, 0.015, 6, 12);
    const linkMesh = new THREE.Mesh(linkGeo, ironMat);
    linkMesh.position.y = y;
    linkMesh.rotation.y = (y % 0.28 === 0) ? 0 : Math.PI / 2;
    lanternGroup.add(linkMesh);
  }

  // 4. Lantern Top Finial Ring at Y = 2.62
  const topRingGeo = new THREE.TorusGeometry(0.055, 0.018, 8, 16);
  const topRingMesh = new THREE.Mesh(topRingGeo, brassMat);
  topRingMesh.position.y = 2.62;
  lanternGroup.add(topRingMesh);

  // 5. Gothic Octagonal Brass Hood / Roof (Y = 2.48 to 2.58)
  const roofGeo = new THREE.ConeGeometry(0.32, 0.16, 8);
  const roofMesh = new THREE.Mesh(roofGeo, brassMat);
  roofMesh.position.y = 2.50;
  lanternGroup.add(roofMesh);

  // 6. Octagonal Upper Collar Rim
  const topCollarGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.04, 8);
  const topCollarMesh = new THREE.Mesh(topCollarGeo, ironMat);
  topCollarMesh.position.y = 2.42;
  lanternGroup.add(topCollarMesh);

  // 7. Radiant Amber Glass Chamber (Y = 2.22)
  const glassGeo = new THREE.CylinderGeometry(0.24, 0.21, 0.38, 8);
  const glassMesh = new THREE.Mesh(glassGeo, amberGlassMat);
  glassMesh.position.y = 2.22;
  lanternGroup.add(glassMesh);

  // 8. 8 Vertical Wrought-Iron Struts / Cage Bars
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const rTop = 0.28, rBot = 0.25;
    const barGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.38, 6);
    const barMesh = new THREE.Mesh(barGeo, ironMat);
    barMesh.position.set(Math.cos(angle) * ((rTop + rBot) / 2), 2.22, Math.sin(angle) * ((rTop + rBot) / 2));
    lanternGroup.add(barMesh);
  }

  // 9. Octagonal Lower Collar Rim & Bottom Finial
  const botCollarGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.04, 8);
  const botCollarMesh = new THREE.Mesh(botCollarGeo, ironMat);
  botCollarMesh.position.y = 2.02;
  lanternGroup.add(botCollarMesh);

  const baseConeGeo = new THREE.ConeGeometry(0.24, 0.10, 8);
  const baseConeMesh = new THREE.Mesh(baseConeGeo, brassMat);
  baseConeMesh.position.y = 1.96;
  baseConeMesh.rotation.x = Math.PI;
  lanternGroup.add(baseConeMesh);

  const bottomDropGeo = new THREE.SphereGeometry(0.035, 8, 8);
  const bottomDropMesh = new THREE.Mesh(bottomDropGeo, brassMat);
  bottomDropMesh.position.y = 1.88;
  lanternGroup.add(bottomDropMesh);

  // 10. Incandescent Core / Flame
  const flameGeo = new THREE.SphereGeometry(0.08, 12, 12);
  const flameMesh = new THREE.Mesh(flameGeo, flameMat);
  flameMesh.position.y = 2.22;
  lanternGroup.add(flameMesh);

  return lanternGroup;
}

function createLanternInstance() {
  const container = new THREE.Group();
  container.name = 'sanctuary_lantern_container';

  if (preloadedLanternModel) {
    const glbClone = preloadedLanternModel.clone(true);
    glbClone.name = 'sanctuary_lantern_glb';
    container.add(glbClone);
  } else {
    // Procedural Fallback Wall Sconce while GLB loads
    const fallbackGroup = new THREE.Group();
    fallbackGroup.name = 'sanctuary_lantern_fallback';
    fallbackGroup.userData = { isProceduralFallback: true };

    // Wall mounting plate
    const plateGeo = new THREE.BoxGeometry(0.2, 0.22, 0.04);
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x1f1f23, roughness: 0.7, metalness: 0.85 });
    const plateMesh = new THREE.Mesh(plateGeo, ironMat);
    plateMesh.position.set(0, 0, -0.02);
    fallbackGroup.add(plateMesh);

    // Horizontal arm reaching out into corridor
    const armGeo = new THREE.BoxGeometry(0.04, 0.04, 0.38);
    const armMesh = new THREE.Mesh(armGeo, ironMat);
    armMesh.position.set(0, 0, -0.19);
    fallbackGroup.add(armMesh);

    // Hanging lantern cage
    const lanternGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.35, 8);
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.3,
      metalness: 0.8,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.8
    });
    const lanternMesh = new THREE.Mesh(lanternGeo, lanternMat);
    lanternMesh.position.set(0, -0.386, -0.395);
    fallbackGroup.add(lanternMesh);

    container.add(fallbackGroup);
  }

  return container;
}

function upgradeExistingSanctuaryLanterns() {
  if (!preloadedLanternModel || !Array.isArray(sanctuaryZones)) return;
  sanctuaryZones.forEach((s) => {
    if (s.group) {
      const container = s.group.getObjectByName('sanctuary_lantern_container');
      if (container) {
        const fallback = container.getObjectByName('sanctuary_lantern_fallback');
        if (fallback) {
          container.remove(fallback);
          disposeHierarchy(fallback);

          const glbClone = preloadedLanternModel.clone(true);
          glbClone.name = 'sanctuary_lantern_glb';
          container.add(glbClone);
        }
      }
    }
  });
}

// --- Feature 4: Light Sanctuaries (UV Lantern Zones) ---
function generateLightSanctuaries() {
  loadLanternAsset();

  sanctuaryZones.forEach(s => {
    if (s.group) scene.remove(s.group);
  });
  sanctuaryZones = [];

  const totalRows = (typeof mazeLayout !== 'undefined' && mazeLayout) ? mazeLayout.length : mazeSizeGlobal;
  const totalCols = (typeof mazeLayout !== 'undefined' && mazeLayout && mazeLayout[0]) ? mazeLayout[0].length : totalRows;
  const blockSize = (typeof mazeBlockSize !== 'undefined' && mazeBlockSize) ? mazeBlockSize : 6.0;

  const sanctuaryCount = window.isTutorialMatch ? 1 : (mazeSizeGlobal >= 41 ? 3 : 2);
  const sanctuaryCandidates = openCorridors.filter(cand => {
    const d = Math.sqrt(cand.x * cand.x + cand.z * cand.z);
    if (d <= (window.isTutorialMatch ? 4 : 12) || d >= (mazeSizeGlobal * 2.0)) return false;
    if (isLocationOccupied(cand.x, cand.z, window.isTutorialMatch ? 3.5 : 6.5)) return false;
    // Guaranteed to have at least one adjacent static solid wall to mount onto
    if (mazeLayout && mazeLayout.length > 0) {
      const col = Math.floor((cand.x / blockSize) + (totalCols / 2));
      const row = Math.floor((cand.z / blockSize) + (totalRows / 2));
      const hasWall = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dr, dc]) => {
        const nr = row + dr, nc = col + dc;
        return mazeLayout[nr] && mazeLayout[nr][nc] === 1;
      });
      if (!hasWall) return false;
    }
    return true;
  });

  const chosenSanctuaries = [];
  if (window.isTutorialMatch) {
    // In Tutorial Mode, place strictly ONE guaranteed Light Sanctuary near the player (no duplicate lights!)
    const nearCorridors = [...openCorridors].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const tutorialSanctuary = nearCorridors.find(c => {
      const d = Math.hypot(c.x, c.z);
      return d >= 6 && d <= 18 && !isLocationOccupied(c.x, c.z, 3.5);
    }) || nearCorridors[Math.min(2, nearCorridors.length - 1)];
    if (tutorialSanctuary) {
      chosenSanctuaries.push(tutorialSanctuary);
      claimSpawnLocation(tutorialSanctuary.x, tutorialSanctuary.z, 5.0, 'Tutorial_Sanctuary');
    }
  } else {
    for (let sIdx = 0; sIdx < sanctuaryCount && sanctuaryCandidates.length > 0; sIdx++) {
      const rIdx = Math.floor(seededRandom() * sanctuaryCandidates.length);
      const pos = sanctuaryCandidates.splice(rIdx, 1)[0];
      const tooClose = chosenSanctuaries.some(cs => Math.hypot(cs.x - pos.x, cs.z - pos.z) < 16);
      if (!tooClose || chosenSanctuaries.length === 0) {
        chosenSanctuaries.push(pos);
        claimSpawnLocation(pos.x, pos.z, 7.0, `Sanctuary_${sIdx}`);
      }
    }
  }

  chosenSanctuaries.forEach((pos, idx) => {
    const group = new THREE.Group();
    group.position.set(pos.x, 0, pos.z);

    // Glowing floor sanctuary ring (centered on the corridor floor)
    const circleGeo = new THREE.RingGeometry(0.3, 3.8, 24);
    const circleMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending
    });
    const circle = new THREE.Mesh(circleGeo, circleMat);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.03;
    group.add(circle);

    // Identify which adjacent wall to attach the 3D lantern wall sconce onto
    const c = Math.floor((pos.x / blockSize) + (totalCols / 2));
    const r = Math.floor((pos.z / blockSize) + (totalRows / 2));

    const wallDirs = [
      { dc: 0, dr: -1, localX: 0, localZ: -2.96, rotY: Math.PI },       // North wall, faces South (+Z into corridor)
      { dc: 0, dr: 1,  localX: 0, localZ: 2.96,  rotY: 0 },             // South wall, faces North (-Z into corridor)
      { dc: -1, dr: 0, localX: -2.96, localZ: 0, rotY: Math.PI / 2 },   // West wall, faces East (+X into corridor)
      { dc: 1, dr: 0,  localX: 2.96,  localZ: 0, rotY: -Math.PI / 2 }   // East wall, faces West (-X into corridor)
    ];

    // 1. Gorgeous 3D Gothic Ceiling Lantern suspended directly over the center of the Sanctuary Zone
    const ceilingLantern = createCeilingLanternGroup();
    group.add(ceilingLantern);

    // 2. Warm Sanctuary Point Light directly inside the hanging lantern casting illumination down onto the floor ring
    const sanctuaryLight = new THREE.PointLight(0xf59e0b, 4.2, 12.0);
    sanctuaryLight.position.set(0, 2.22, 0);
    group.add(sanctuaryLight);

    // 3. If an adjacent solid wall is present, also mount an authentic wall sconce for extra architectural detail
    const chosenWall = wallDirs.find(d => {
      const nr = r + d.dr;
      const nc = c + d.dc;
      return mazeLayout && mazeLayout[nr] && mazeLayout[nr][nc] === 1;
    });

    if (chosenWall) {
      const lanternContainer = createLanternInstance();
      lanternContainer.position.set(chosenWall.localX, 2.35, chosenWall.localZ);
      lanternContainer.rotation.y = chosenWall.rotY;
      group.add(lanternContainer);
    }

    scene.add(group);

    sanctuaryZones.push({
      id: `sanctuary_${idx}`,
      x: pos.x,
      z: pos.z,
      lanternX: pos.x,
      lanternZ: pos.z,
      radius: 4.5,
      group: group,
      light: sanctuaryLight
    });
  });
}

// Corridor shifting alignment
function realignMazeCorridors(realignmentState) {
  const solvedCount = realignmentState.puzzleRoomsSolved;
  
  // Display shifting alert
  // Display shifting alert
  triggerNotification(`⚠️ Labyrinth Realignment Triggered! Corridors Shifting...`);

  // Move sliding wall pieces either completely flush with ceiling/floor (upY = 0) or completely submerged under the floor (downY)
  const isDungeonTheme = (localStorage.getItem('manifestation_maze_theme') || 'dungeon') === 'dungeon';
  const wallHeight = isDungeonTheme ? 3.5 : 4.5;
  const upY = 0;
  const downY = -wallHeight - 0.2;
  slidingWallSegments.forEach((segment, idx) => {
    // Odd/Even shift patterns: upY blocks passage, downY opens passage
    const targetY = (solvedCount % 2 === 0) ? (idx % 2 === 0 ? upY : downY) : (idx % 2 === 0 ? downY : upY);
    
    // Update mazeLayout immediately for pathfinding path recalculation
    if (segment.userData && segment.userData.col !== undefined) {
      const { col, row } = segment.userData;
      mazeLayout[row][col] = (targetY < -0.5) ? 0 : 2;
    }

    // Cancel any ongoing animation on this segment
    if (segment.userData && segment.userData.animId) {
      cancelAnimationFrame(segment.userData.animId);
      segment.userData.animId = null;
    }

    // Smooth sliding animation
    const anim = () => {
      if (Math.abs(segment.position.y - targetY) > 0.05) {
        segment.position.y += (targetY - segment.position.y) * 0.1;
        segment.userData.animId = requestAnimationFrame(anim);
      } else {
        segment.position.y = targetY;
        segment.userData.animId = null;
      }
    };
    anim();
  });

  // Dynamically recalculate Ariadne's Thread around newly shifted corridors!
  if (window.isAriadneDev && typeof buildAriadneThread === 'function') {
    buildAriadneThread({ x: camera.position.x, z: camera.position.z });
  }
}

function toggleCameraView() {
  currentViewIndex = (currentViewIndex + 1) % viewModes.length;
  const mode = viewModes[currentViewIndex];
  
  if (!activeViewCamera) {
    activeViewCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.25, 200);
    activeViewCamera.rotation.order = 'YXZ';
    scene.add(activeViewCamera);
  } else {
    activeViewCamera.rotation.order = 'YXZ';
  }
  syncActiveViewCamera();
  
  // Make sure we have a local player visual if we enter TPS, and recreate if equipped skin changed
  const pSkinId = myTeam === 'Ghost' ? 'skin_ghost' : (localStorage.getItem('manifestation_equipped_skin') || 'skin_hazmat');
  const pUsername = localStorage.getItem('manifestation_username') || 'Operative';
  
  if (localPlayerVisual && localPlayerVisual.userData && localPlayerVisual.userData.skinId !== pSkinId) {
    if (localPlayerVisual.userData.animMixer) {
      const idx = activeAnimationMixers.indexOf(localPlayerVisual.userData.animMixer);
      if (idx !== -1) activeAnimationMixers.splice(idx, 1);
    }
    if (localPlayerVisual.parent) localPlayerVisual.parent.remove(localPlayerVisual);
    else if (scene) scene.remove(localPlayerVisual);
    localPlayerVisual = null;
  }
  
  if (mode !== 'fps' && !localPlayerVisual) {
    const isVip = window.isVipActive ? window.isVipActive() : false;
    localPlayerVisual = myTeam === 'Ghost' ? createGhostMeshGroup(pSkinId) : createHumanMeshGroup(pSkinId, pUsername, isVip);
    localPlayerVisual.userData.isVip = isVip;
    const glowPref = window.isVipGlowEnabled ? window.isVipGlowEnabled() : true;
    if (isVip && glowPref) {
      applyVipGlow(localPlayerVisual, true);
    }
    // Place visual firmly on the world floor (y = 0), facing camera horizontal yaw
    localPlayerVisual.position.set(camera.position.x, myTeam === 'Ghost' ? 0.35 : 0, camera.position.z);
    localPlayerVisual.rotation.set(0, camera.rotation.y, 0);
    scene.add(localPlayerVisual);
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
    currentlyHeldKeys.add(event.code);

    // If keypad is open, intercept numeric keys and backspace
    const activeKeypad = document.getElementById('keypad-modal-ui');
    const isKeypadOpen = Boolean(activeKeypad && activeKeypad.style.display !== 'none');
    if (isKeypadOpen) {
      if (event.code.startsWith('Digit') || event.code.startsWith('Numpad')) {
        const num = event.code.replace('Digit', '').replace('Numpad', '');
        if (num.length === 1 && num >= '0' && num <= '9') {
          if (codeEntered.length < 4) {
            codeEntered += num;
            const scr = document.getElementById('keypad-screen-display');
            if (scr) scr.textContent = getKeypadDisplayString();
          }
          return; // Prevent other actions like changing inventory
        }
      } else if (event.key === 'Backspace') {
        if (codeEntered.length > 0) {
          codeEntered = codeEntered.slice(0, -1);
          const scr = document.getElementById('keypad-screen-display');
          if (scr) scr.textContent = getKeypadDisplayString();
        }
        return;
      } else if (event.key === 'Enter') {
        submitKeypadCode(codeEntered);
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
      case 'KeyR':
        if (!isCaptured && !window.isSpectating) {
          useActiveItem();
        }
        break;
      case 'KeyE':
        // Interact key
        checkInteractions();
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        if (myTeam === 'Human' && !isSprintExhausted && stamina > 0) {
          isSprinting = true;
        }
        break;
      case 'KeyQ':
        dropActiveItem();
        break;
      case 'KeyF':
        if (myTeam === 'Human') {
          toggleFlashlight();
        }
        break;
      case 'KeyH':
      case 'KeyC':
        const ctrlModal = document.getElementById('controls-guide-modal');
        if (ctrlModal) {
          if (ctrlModal.style.display === 'flex') {
            if (window.closeControlsGuideModal) window.closeControlsGuideModal();
            else ctrlModal.style.display = 'none';
          } else {
            if (window.openControlsGuideModal) window.openControlsGuideModal();
            else ctrlModal.style.display = 'flex';
          }
        }
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
        const topClose = document.getElementById('minimap-top-close-btn');
        const titleText = document.getElementById('minimap-title-text');
        const backdrop = document.getElementById('minimap-modal-backdrop');
        const promptEl = document.getElementById('interaction-prompt');
        if (wrapper && controls && window.gameReady && myTeam === 'Human') {
          if (!isMinimapExpanded) {
            isMinimapExpanded = true;
            wrapper.classList.add('expanded');
            controls.style.display = 'block';
            if (topClose) topClose.style.display = 'flex';
            if (backdrop) backdrop.style.display = 'block';
            if (promptEl) promptEl.style.display = 'none';
            if (titleText) titleText.textContent = 'TACTICAL MAP';
            if (document.pointerLockElement) document.exitPointerLock();
            drawMinimap();
            if (window.isTutorialMatch && tutorialStage === 6) {
              advanceTutorialStage(7, "Tactical Navigation Calibrated! Next: UV Lantern Sanctuaries");
            }
          } else {
            isMinimapExpanded = false;
            wrapper.classList.remove('expanded');
            controls.style.display = 'none';
            if (topClose) topClose.style.display = 'none';
            if (backdrop) backdrop.style.display = 'none';
            if (titleText) titleText.textContent = 'MINIMAP (Press M / Tap)';
            if (!window.isMobileDevice && window.gameReady && !isCaptured) {
              (renderer && renderer.domElement || document.getElementById('canvas-container')).requestPointerLock();
            }
            drawMinimap();
          }
        }
        break;
      case 'Escape':
        resetPlayerMovementState();
        const ctrlGuideModal = document.getElementById('controls-guide-modal');
        if (ctrlGuideModal && ctrlGuideModal.style.display === 'flex') {
          if (window.closeControlsGuideModal) window.closeControlsGuideModal();
          else ctrlGuideModal.style.display = 'none';
          return;
        }
        if (isMinimapExpanded) {
          const mapWrap = document.getElementById('minimap-wrapper');
          const mapCtrl = document.getElementById('minimap-expanded-controls');
          const topCls = document.getElementById('minimap-top-close-btn');
          const ttlTxt = document.getElementById('minimap-title-text');
          const bkdrop = document.getElementById('minimap-modal-backdrop');
          isMinimapExpanded = false;
          if (mapWrap) mapWrap.classList.remove('expanded');
          if (mapCtrl) mapCtrl.style.display = 'none';
          if (topCls) topCls.style.display = 'none';
          if (bkdrop) bkdrop.style.display = 'none';
          if (ttlTxt) ttlTxt.textContent = 'MINIMAP (Press M / Tap)';
          if (!window.isMobileDevice && window.gameReady && !isCaptured) {
            (renderer && renderer.domElement || document.getElementById('canvas-container')).requestPointerLock();
          }
          drawMinimap();
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
    currentlyHeldKeys.delete(event.code);
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
            if (b.mesh) {
              if (b.mesh.userData && b.mesh.userData.ledMesh) {
                b.mesh.userData.ledMesh.material.color.setHex(0x10b981);
                b.mesh.userData.ledMesh.material.emissive.setHex(0x10b981);
              }
              if (b.mesh.userData && b.mesh.userData.statusLight) {
                b.mesh.userData.statusLight.color.setHex(0x10b981);
              }
              if (b.mesh.material) {
                if (Array.isArray(b.mesh.material)) {
                  b.mesh.material.forEach(m => {
                    if (m.map) m.color.setHex(0xdcfce7);
                  });
                } else {
                  b.mesh.material.color.setHex(0x10b981);
                }
              }
            }
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
    window._lastMouseX = e.clientX;
    window._lastMouseY = e.clientY;

    const ptrOverlay = document.getElementById('pointer-lock-overlay');
    const isPaused = Boolean(ptrOverlay && ptrOverlay.style.display === 'flex');
    const settingsModal = document.getElementById('settings-modal');
    const isSettingsOpen = Boolean(settingsModal && settingsModal.style.display === 'flex');
    const keypadModalEl = document.getElementById('keypad-modal-ui');
    const isKeypadOpen = Boolean(keypadModalEl && keypadModalEl.style.display !== 'none');

    if (isPaused || isSettingsOpen || isKeypadOpen || e.target.closest('#pointer-lock-overlay') || e.target.closest('#settings-modal') || e.target.closest('.settings-modal') || e.target.closest('.keypad-modal') || e.target.closest('.glass-panel')) {
      return; // Never relock mouse, capture clicks, or use items while in pause menu, settings, or modals!
    }

    if (!document.pointerLockElement && window.gameReady && !isCaptured && window.requestGamePointerLock) {
      window.requestGamePointerLock();
    }
    if ((!document.pointerLockElement && e.target.id !== 'canvas-container') || (isCaptured && !window.isSpectating)) return;
    if (e.button === 0 && !window.isSpectating) { // Left click: use active inventory item
      useActiveItem();
    }
  });

  // Mouse camera rotation controller with seamless relock & drag fallback
  document.addEventListener('mousemove', (e) => {
    const hasLock = Boolean(document.pointerLockElement);
    if ((!hasLock && e.buttons !== 1 && !window.gameReady) || (isCaptured && !window.isSpectating)) return;
    const ptrOverlay = document.getElementById('pointer-lock-overlay');
    if (ptrOverlay && ptrOverlay.style.display === 'flex') return;
    const keypadModalEl = document.getElementById('keypad-modal-ui');
    if (keypadModalEl && keypadModalEl.style.display !== 'none') return;
    if (isMinimapExpanded) return;

    let mx = e.movementX;
    let my = e.movementY;
    if (!hasLock) {
      if (typeof window._lastMouseX === 'number' && typeof window._lastMouseY === 'number') {
        mx = e.clientX - window._lastMouseX;
        my = e.clientY - window._lastMouseY;
      } else {
        mx = 0;
        my = 0;
      }
      window._lastMouseX = e.clientX;
      window._lastMouseY = e.clientY;
    } else {
      window._lastMouseX = e.clientX;
      window._lastMouseY = e.clientY;
    }

    // Ignore massive spikes caused by browser Pointer Lock transitions
    if (Math.abs(mx) > 150 || Math.abs(my) > 150) return;

    const sensitivity = window.lookSensitivity !== undefined ? window.lookSensitivity : 1.0;
    camera.rotation.y -= mx * 0.002 * sensitivity;
    camera.rotation.x -= my * 0.002 * sensitivity;
    camera.rotation.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camera.rotation.x));
  });

  // Mobile Touch Controls
  {
    let lookTouchId = null;
    let lastLookX = 0;
    let lastLookY = 0;
    let lookStartX = 0;
    let lookStartY = 0;
    let lookStartTime = 0;
    let lookTouchMovedFar = false;

    // Listen on document for looking around, but ignore all touch events on interactive buttons and HUD
    document.addEventListener('touchstart', (e) => {
      if ((isCaptured && !window.isSpectating) || !window.gameReady) return;
      
      // Ignore touch starts ONLY on specific interactive buttons, inputs, joystick base, or modal panels
      if (
        e.target.closest('button') ||
        e.target.closest('input') ||
        e.target.closest('select') ||
        e.target.closest('a') ||
        e.target.closest('#mobile-joystick') || 
        e.target.closest('#mobile-actions') || 
        e.target.closest('#minimap-container') ||
        e.target.closest('#keypad-modal-ui') ||
        e.target.closest('#interaction-prompt') ||
        e.target.closest('.inventory-slot') ||
        e.target.closest('.key-slot') ||
        e.target.closest('.glass-panel')
      ) {
        return;
      }

      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (lookTouchId === null) {
          lookTouchId = t.identifier;
          lastLookX = t.clientX;
          lastLookY = t.clientY;
          lookStartX = t.clientX;
          lookStartY = t.clientY;
          lookStartTime = performance.now();
          lookTouchMovedFar = false;
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

          if (Math.hypot(t.clientX - lookStartX, t.clientY - lookStartY) > 12) {
            lookTouchMovedFar = true;
          }

          const sensitivity = window.lookSensitivity !== undefined ? window.lookSensitivity : 1.0;
          // Responsive mobile swipe look speed
          camera.rotation.y -= dx * 0.0055 * sensitivity;
          camera.rotation.x -= dy * 0.0055 * sensitivity;
          camera.rotation.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camera.rotation.x));

          lastLookX = t.clientX;
          lastLookY = t.clientY;
          if (e.cancelable) e.preventDefault();
          break;
        }
      }
    }, { passive: false });

    const clearLookTouch = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === lookTouchId) {
          const duration = performance.now() - lookStartTime;
          const distMoved = Math.hypot(t.clientX - lookStartX, t.clientY - lookStartY);
          lookTouchId = null;

          // If finger tapped without a significant swipe (<350ms duration & <18px displacement), trigger direct 3D object click
          if (!lookTouchMovedFar && duration < 350 && distMoved < 18) {
            handleDirectTapInteraction(t.clientX, t.clientY);
          }
          break;
        }
      }
    };
    document.addEventListener('touchend', clearLookTouch);
    document.addEventListener('touchcancel', clearLookTouch);

    // Joystick touch controls with responsive bounding box
    const joystickBase = document.getElementById('joystick-base');
    const joystickKnob = document.getElementById('joystick-knob');
    joystickTouchId = null;
    let joyCenterX = 0;
    let joyCenterY = 0;

    let joystickAutoSprinting = false;
    const SPRINT_ENGAGE_THRESHOLD = 72; // Must pull thumb significantly farther outside base (170% of base radius) to sprint
    const SPRINT_RELEASE_THRESHOLD = 58; // Hysteresis buffer to maintain sprint smoothly without stutter

    const resetJoy = () => {
      moveForward = false;
      moveBackward = false;
      moveLeft = false;
      moveRight = false;
      joystickAutoSprinting = false;
      if (!mobileSprintLocked) {
        isSprinting = false;
        joystickBase.classList.remove('sprinting');
        joystickKnob.classList.remove('sprinting');
      }
      joystickKnob.style.transform = `translate(0px, 0px)`;
      joystickTouchId = null;
    };

    joystickBase.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (joystickTouchId !== null) return;
      const t = e.changedTouches[0];
      joystickTouchId = t.identifier;
      const rect = joystickBase.getBoundingClientRect();
      joyCenterX = rect.left + rect.width / 2;
      joyCenterY = rect.top + rect.height / 2;
      handleJoyMove(t.clientX, t.clientY);
    }, { passive: false });

    joystickBase.addEventListener('touchmove', (e) => {
      e.preventDefault();
      e.stopPropagation();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === joystickTouchId) {
          handleJoyMove(t.clientX, t.clientY);
          break;
        }
      }
    }, { passive: false });

    joystickBase.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joystickTouchId) {
          resetJoy();
          break;
        }
      }
    });

    joystickBase.addEventListener('touchcancel', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joystickTouchId) {
          resetJoy();
          break;
        }
      }
    });

    // Also attach window listeners for the active joystick touch so fast wide drags never drop tracking
    window.addEventListener('touchmove', (e) => {
      if (joystickTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === joystickTouchId) {
          handleJoyMove(t.clientX, t.clientY);
          break;
        }
      }
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
      if (joystickTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joystickTouchId) {
          resetJoy();
          break;
        }
      }
    });

    function handleJoyMove(clientX, clientY) {
      const dx = clientX - joyCenterX;
      const dy = clientY - joyCenterY;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);

      const walkMaxRadius = 42; // Base rim radius for 100% walk speed
      const maxVisualRadius = 56; // Elastic visual stretch limit for knob
      
      // Elastic visual stretch: knob stays within 42px during walk, and stretches slightly up to 56px when pulled far
      let visualDist = dist;
      if (dist > walkMaxRadius) {
        visualDist = walkMaxRadius + Math.min(maxVisualRadius - walkMaxRadius, (dist - walkMaxRadius) * 0.35);
      } else {
        visualDist = Math.min(dist, walkMaxRadius);
      }
      
      const kx = Math.cos(angle) * visualDist;
      const ky = Math.sin(angle) * visualDist;
      
      joystickKnob.style.transform = `translate(${kx}px, ${ky}px)`;
      
      const joyX = Math.cos(angle) * Math.min(1.0, dist / walkMaxRadius);
      const joyY = Math.sin(angle) * Math.min(1.0, dist / walkMaxRadius);
      
      moveForward = joyY < -0.2;
      moveBackward = joyY > 0.2;
      moveLeft = joyX < -0.2;
      moveRight = joyX > 0.2;

      // Auto-sprint requires pulling thumb significantly farther (≥72px) with hysteresis buffer (58px)
      const isMoving = moveForward || moveBackward || moveLeft || moveRight;
      if (isMoving) {
        if (!joystickAutoSprinting && dist >= SPRINT_ENGAGE_THRESHOLD) {
          joystickAutoSprinting = true;
        } else if (joystickAutoSprinting && dist < SPRINT_RELEASE_THRESHOLD) {
          joystickAutoSprinting = false;
        }
      } else {
        joystickAutoSprinting = false;
      }

      const canSprint = myTeam === 'Human' && !isSprintExhausted && stamina > 0;
      const shouldSprint = isMoving && (mobileSprintLocked || joystickAutoSprinting) && canSprint;

      if (shouldSprint) {
        isSprinting = true;
        joystickBase.classList.add('sprinting');
        joystickKnob.classList.add('sprinting');
      } else {
        isSprinting = false;
        joystickBase.classList.remove('sprinting');
        joystickKnob.classList.remove('sprinting');
      }
    }

    // Helper for robust, instant tap response without double-fires or missed touches
    function addTapListener(el, callback) {
      if (!el) return;
      el.setAttribute('tabindex', '-1');
      let lastTrigger = 0;

      const fire = (e) => {
        const now = performance.now();
        if (now - lastTrigger < 90) return; // Prevent duplicate triggers within 90ms
        lastTrigger = now;
        try {
          callback(e);
        } catch (err) {
          console.error('[TAP] Error executing callback for element:', el.id, err);
        }
      };

      // 1. Pointer Down (Universal modern standard across mobile touch and desktop click)
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        el.classList.add('btn-pressed');
        fire(e);
      });

      el.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        el.classList.remove('btn-pressed');
      });

      el.addEventListener('pointercancel', () => {
        el.classList.remove('btn-pressed');
      });

      // 2. Direct touchstart for mobile WebViews (zero latency, fires immediately on contact)
      el.addEventListener('touchstart', (e) => {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        el.classList.add('btn-pressed');
        fire(e);
      }, { passive: false });

      el.addEventListener('touchend', (e) => {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        el.classList.remove('btn-pressed');
      }, { passive: false });

      el.addEventListener('touchcancel', () => {
        el.classList.remove('btn-pressed');
      }, { passive: true });

      // 3. Fallback click for desktop
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        fire(e);
      });
    }

    // Action button bindings using addTapListener for 100% reliable mobile response
    const useBtn = document.getElementById('btn-mobile-use');
    const interactBtn = document.getElementById('btn-mobile-interact');
    const sprintBtn = document.getElementById('btn-mobile-sprint');
    const specialBtn = document.getElementById('btn-mobile-special');
    const dropBtn = document.getElementById('btn-mobile-drop');
    const dropItemBtn = document.getElementById('btn-mobile-drop-item');
    const pauseBtn = document.getElementById('btn-mobile-pause');
    const globalPauseBtn = document.getElementById('global-pause-btn');
    const cameraToggleBtn = document.getElementById('btn-camera-toggle');
    const ptrOverlay = document.getElementById('pointer-lock-overlay');

    if (useBtn) {
      addTapListener(useBtn, () => {
        if (!isCaptured) {
          const item = inventory[activeSlot];
          if (!item || item === "") {
            if (myTeam === 'Human') {
              toggleFlashlight();
            } else {
              triggerNotification("No usable item in active slot. Tap a hotbar slot to select.");
            }
          } else {
            useActiveItem();
          }
        }
      });
    }

    if (interactBtn) {
      addTapListener(interactBtn, () => {
        if (!isCaptured) checkInteractions();
      });
    }

    const interactionPromptEl = document.getElementById('interaction-prompt');
    if (interactionPromptEl) {
      addTapListener(interactionPromptEl, () => {
        if (!isCaptured) checkInteractions();
      });
    }

    if (sprintBtn) {
      addTapListener(sprintBtn, () => {
        if (myTeam !== 'Human' || isCaptured) return;
        if (isSprintExhausted) {
          triggerNotification("Stamina exhausted! Recovering (need 20%)...");
          return;
        }
        mobileSprintLocked = !mobileSprintLocked;
        isSprinting = mobileSprintLocked;
        sprintBtn.classList.toggle('sprinting', mobileSprintLocked);
        triggerNotification(mobileSprintLocked ? "⚡ SPRINT LOCKED ON" : "🚶 WALK MODE RESTORED");
      });
    }

    if (specialBtn) {
      addTapListener(specialBtn, () => {
        if (isCaptured) return;
        if (isPanicked) {
          triggerNotification("Ability active: Invisibility engaged!");
          return;
        }
        triggerPanicHide();
      });
    }

    if (dropBtn) {
      addTapListener(dropBtn, () => {
        if (!isCaptured) dropKey();
      });
    }

    if (dropItemBtn) {
      addTapListener(dropItemBtn, () => {
        if (!isCaptured) dropActiveItem();
      });
    }

    const handlePause = (e) => {
      if (e) {
        if (e.stopPropagation) e.stopPropagation();
        if (e.preventDefault && e.cancelable) e.preventDefault();
      }
      if ((isCaptured && !window.isSpectating) || window.isCapturedAnimation || window.isEscaping || (!window.gameReady && !window.isSpectating)) return;

      const overlay = ptrOverlay || document.getElementById('pointer-lock-overlay');
      if (overlay && overlay.style.display === 'flex') {
        if (performance.now() - pauseOpenedTime > 350) {
          handleEnterGame(e);
        }
        return;
      }

      window.mobileGameActive = false;
      pauseOpenedTime = performance.now();
      resetPlayerMovementState();

      const isMultiplayer = Boolean(currentLobby && currentLobby.id && !currentLobby.id.startsWith('solo-'));
      const warnEl = document.getElementById('multiplayer-pause-warning');
      if (warnEl) warnEl.style.display = isMultiplayer ? 'block' : 'none';

      const resumeTarget = document.getElementById('resume-click-target');
      if (resumeTarget) {
        resumeTarget.textContent = window.isSpectating
          ? (isMobileDevice ? '▶ TAP TO RESUME SPECTATING' : '▶ CLICK TO RESUME SPECTATING')
          : (isMobileDevice ? '▶ TAP TO RESUME LABYRINTH' : '▶ CLICK TO RESUME LABYRINTH');
      }

      const canvasContainer = document.getElementById('canvas-container');
      if (canvasContainer) canvasContainer.style.filter = 'none';
      document.body.style.filter = 'none';

      if (overlay) overlay.style.display = 'flex';
      if (document.exitPointerLock && document.pointerLockElement) {
        document.exitPointerLock();
      }
    };

    window.togglePauseMenu = handlePause;
    window.openPauseMenu = handlePause;

    if (pauseBtn) {
      addTapListener(pauseBtn, handlePause);
      pauseBtn.onclick = handlePause;
    }
    if (globalPauseBtn) {
      addTapListener(globalPauseBtn, handlePause);
      globalPauseBtn.onclick = handlePause;
    }

    const pauseSettingsBtn = document.getElementById('pause-settings-btn');
    if (pauseSettingsBtn) {
      addTapListener(pauseSettingsBtn, (e) => {
        if (window.showSettings) {
          window.showSettings(e);
        } else {
          const sModal = document.getElementById('settings-modal');
          if (sModal) sModal.style.display = 'flex';
        }
      });
    }

    const pauseControlsBtn = document.getElementById('pause-controls-btn');
    if (pauseControlsBtn) {
      addTapListener(pauseControlsBtn, () => {
        if (window.openControlsGuideModal) window.openControlsGuideModal();
      });
    }

    const hudControlsBtn = document.getElementById('btn-controls-guide');
    if (hudControlsBtn) {
      addTapListener(hudControlsBtn, () => {
        if (window.openControlsGuideModal) window.openControlsGuideModal();
      });
    }

    const pauseAbortBtn = document.getElementById('pause-abort-btn');
    if (pauseAbortBtn) {
      addTapListener(pauseAbortBtn, () => {
        if (window.leaveGameWithAd) {
          window.leaveGameWithAd(() => window.location.reload());
        } else {
          window.location.reload();
        }
      });
    }

    const quitGameBtn = document.getElementById('quit-game-btn');
    if (quitGameBtn) {
      addTapListener(quitGameBtn, () => {
        if (window.leaveGameWithAd) {
          window.leaveGameWithAd(() => window.location.reload());
        } else {
          window.location.reload();
        }
      });
    }

    if (cameraToggleBtn) {
      addTapListener(cameraToggleBtn, () => {
        if (!isCaptured) toggleCameraView();
      });
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

// Universal Interaction Helper: Works seamlessly across FPS, Third-Person (TPS), and Top-Down cameras!
function isLookingAtTarget(targetPos, maxDist = 4.5, maxAngle = 0.7) {
  if (!targetPos) return { looking: false, dist: Infinity };

  // 1. Player character location in the maze (camera.position is player body center)
  const playerX = camera.position.x;
  const playerY = camera.position.y;
  const playerZ = camera.position.z;

  const dist = camera.position.distanceTo(targetPos);
  const horizDist = Math.hypot(playerX - targetPos.x, playerZ - targetPos.z);
  const vertDist = Math.abs(playerY - targetPos.y);

  // Proximity pickup: If the player character is standing right next to the item (within 2.6m horizontally and 2.5m vertically),
  // they can ALWAYS grab or interact with it in ANY camera mode (especially Top-Down and Third-Person)!
  if (horizDist <= 2.6 && vertDist <= 2.6) {
    return { looking: true, dist };
  }

  // Mobile Proximity Boost: On touch devices, players navigate using virtual joysticks and lack a fine-grained mouse reticle.
  // Within 4.8m horizontal distance, tapping INTERACT immediately picks up keys, repairs breakers, or reads clues!
  if (isMobileDevice && horizDist <= 4.8 && vertDist <= 3.5) {
    return { looking: true, dist };
  }

  // If outside maximum interaction radius from player body, cannot interact
  if (dist > maxDist) return { looking: false, dist };

  // 2. Camera View Vector Check (check the camera the player is actually viewing through)
  const renderCam = activeViewCamera || camera;
  const camDir = new THREE.Vector3();
  renderCam.getWorldDirection(camDir);
  const toTargetFromCam = targetPos.clone().sub(renderCam.position).normalize();
  const camAngle = camDir.angleTo(toTargetFromCam);

  // 3. Horizontal Facing Check (direction player body is facing)
  const playerFaceDir = new THREE.Vector3();
  camera.getWorldDirection(playerFaceDir);
  playerFaceDir.y = 0;
  playerFaceDir.normalize();

  const toTargetHoriz = new THREE.Vector3(targetPos.x - playerX, 0, targetPos.z - playerZ).normalize();
  const bodyAngle = playerFaceDir.angleTo(toTargetHoriz);

  // In top-down mode (activeViewCamera looking down from above), horizontal proximity is king
  const isTopDown = (typeof viewModes !== 'undefined' && viewModes[currentViewIndex] === 'top_down');
  const looking = (camAngle < maxAngle) || 
                  (bodyAngle < 1.05 && dist <= maxDist) || 
                  (isTopDown && horizDist <= 3.8);

  return { looking, dist };
}

const KEY_NAME_CANONICAL = {
  'alpha': 'Amber Key',
  'alpha key': 'Amber Key',
  'amber': 'Amber Key',
  'amber key': 'Amber Key',
  'beta': 'Sapphire Key',
  'beta key': 'Sapphire Key',
  'sapphire': 'Sapphire Key',
  'sapphire key': 'Sapphire Key',
  'gamma': 'Violet Key',
  'gamma key': 'Violet Key',
  'violet': 'Violet Key',
  'violet key': 'Violet Key',
  'delta': 'Emerald Key',
  'delta key': 'Emerald Key',
  'emerald': 'Emerald Key',
  'emerald key': 'Emerald Key',
  'ruby': 'Ruby Key',
  'ruby key': 'Ruby Key',
  'topaz': 'Topaz Key',
  'topaz key': 'Topaz Key',
  'opal': 'Opal Key',
  'opal key': 'Opal Key',
  'quartz': 'Quartz Key',
  'quartz key': 'Quartz Key',
  'onyx': 'Onyx Key',
  'onyx key': 'Onyx Key',
  'pearl': 'Pearl Key',
  'pearl key': 'Pearl Key'
};

function getCanonicalGemstone(keyOrName) {
  if (!keyOrName) return '';
  const str = typeof keyOrName === 'object'
    ? (keyOrName.typeName || keyOrName.symbol || keyOrName.label || '')
    : String(keyOrName);
  const lower = str.toLowerCase().trim();
  if (lower.includes('amber') || lower.includes('alpha')) return 'Amber Key';
  if (lower.includes('sapphire') || lower.includes('beta')) return 'Sapphire Key';
  if (lower.includes('violet') || lower.includes('gamma')) return 'Violet Key';
  if (lower.includes('emerald') || lower.includes('delta')) return 'Emerald Key';
  if (lower.includes('ruby')) return 'Ruby Key';
  if (lower.includes('topaz')) return 'Topaz Key';
  if (lower.includes('opal')) return 'Opal Key';
  if (lower.includes('quartz')) return 'Quartz Key';
  if (lower.includes('onyx')) return 'Onyx Key';
  if (lower.includes('pearl')) return 'Pearl Key';
  return KEY_NAME_CANONICAL[lower] || str;
}

function normalizeKeySymbol(sym) {
  if (!sym) return '';
  return getCanonicalGemstone(sym);
}

function formatFunctionalKeyName(sym) {
  const norm = normalizeKeySymbol(sym);
  return String(norm).replace(/ Key$/i, '');
}

function isKeyFunctional(k) {
  if (!k || !functionalKeysRevealed || functionalKeysRevealed.length === 0) return false;
  const kGem = getCanonicalGemstone(k);
  if (!kGem) return false;
  return functionalKeysRevealed.some(f => {
    const fGem = getCanonicalGemstone(f);
    return fGem && fGem.toLowerCase() === kGem.toLowerCase();
  });
}

function getKeyIdentifier(k) {
  if (!k) return '';
  return getCanonicalGemstone(k);
}

function isKeyAlreadyInserted(k) {
  if (!k || !insertedGateKeys || insertedGateKeys.length === 0) return false;
  const kGem = getCanonicalGemstone(k);
  if (!kGem) return false;
  return insertedGateKeys.some(ins => {
    const insGem = getCanonicalGemstone(ins);
    return insGem && insGem.toLowerCase() === kGem.toLowerCase();
  });
}

// Interaction Candidate Evaluator: Determines the best object under player's crosshair or immediate reach
const _interactCamDir = new THREE.Vector3();
const _interactToTarget = new THREE.Vector3();

function evalInteractionCandidate(targetPos, maxDist = 5.5, maxAngle = 0.85) {
  if (!targetPos) return { eligible: false, score: Infinity, dist: Infinity };

  const renderCam = (typeof activeViewCamera !== 'undefined' && activeViewCamera) ? activeViewCamera : camera;
  const camPos = renderCam.position;
  const dist = camPos.distanceTo(targetPos);
  if (dist < 0.001) return { eligible: true, score: 0, dist: 0, dot: 1, horizDist: 0 };
  if (dist > maxDist) return { eligible: false, score: Infinity, dist };

  _interactToTarget.subVectors(targetPos, camPos).normalize();
  renderCam.getWorldDirection(_interactCamDir);

  const dot = _interactCamDir.dot(_interactToTarget);
  const angle = _interactCamDir.angleTo(_interactToTarget);

  const playerX = camera.position.x;
  const playerZ = camera.position.z;
  const horizDist = Math.hypot(playerX - targetPos.x, playerZ - targetPos.z);
  const vertDist = Math.abs(camera.position.y - targetPos.y);

  const isTopDown = (typeof viewModes !== 'undefined' && viewModes[currentViewIndex] === 'top_down');
  const isDirectAim = dot > 0.70; // within ~45° of reticle
  const isInViewCone = dot > 0.35 && angle < maxAngle; // within view cone
  const isCloseTouch = horizDist <= 1.8 && vertDist <= 2.2;
  const isMobileClose = isMobileDevice && horizDist <= 3.8 && dot > 0.15;

  if (!isDirectAim && !isInViewCone && !isCloseTouch && !isTopDown && !isMobileClose) {
    return { eligible: false, score: Infinity, dist };
  }

  // Scoring function: Smaller is better!
  // Direct crosshair aim heavily prioritized over peripheral objects
  let aimFactor = 1.0;
  if (dot >= 0.95) {
    aimFactor = 0.45; // Dead center: 55% discount
  } else if (dot >= 0.82) {
    aimFactor = 0.65;
  } else if (dot >= 0.60) {
    aimFactor = 0.90;
  } else if (dot >= 0.35) {
    aimFactor = 1.35;
  } else {
    aimFactor = 2.40;
  }

  const score = dist * aimFactor;
  return { eligible: true, score, dist, dot, horizDist };
}

function getBestInteractionTarget() {
  let bestCandidate = null;
  let bestScore = Infinity;

  // 1. Mirage Loot
  if (typeof mirageItems !== 'undefined' && mirageItems.length > 0) {
    for (let i = 0; i < mirageItems.length; i++) {
      const mItem = mirageItems[i];
      if (!mItem || !mItem.mesh || mItem.dissolving) continue;
      const res = evalInteractionCandidate(mItem.mesh.position, 5.5);
      if (res.eligible && res.score < bestScore) {
        bestScore = res.score;
        bestCandidate = {
          type: 'mirage',
          item: mItem,
          promptText: isMobileDevice ? `Tap to pick up ${mItem.name}` : `Press <kbd>E</kbd> to pick up ${mItem.name}`,
          action: () => dissolveMirageItem(mItem)
        };
      }
    }
  }

  // 2. Ground Dropped Items
  if (typeof itemsInMaze !== 'undefined' && itemsInMaze.length > 0) {
    for (let i = 0; i < itemsInMaze.length; i++) {
      const item = itemsInMaze[i];
      if (!item || !item.mesh) continue;
      const res = evalInteractionCandidate(item.mesh.position, 5.5);
      if (res.eligible && res.score < bestScore) {
        bestScore = res.score;
        const itemName = item.name || 'Item';
        bestCandidate = {
          type: 'item',
          item: item,
          promptText: isMobileDevice ? `Tap to pick up ${itemName}` : `Press <kbd>E</kbd> to pick up ${itemName}`,
          action: () => {
            const uniqueEquipment = ["EMF Radar", "Thermal Camera", "Breaker Remote"];
            if (uniqueEquipment.includes(item.name) && inventory.includes(item.name)) {
              triggerNotification(`You already have a ${item.name}!`);
              return;
            }
            const emptyIndex = inventory.indexOf('');
            if (emptyIndex !== -1) {
              inventory[emptyIndex] = item.name;
              disposeItemMesh(item.mesh);
              const idx = itemsInMaze.indexOf(item);
              if (idx !== -1) itemsInMaze.splice(idx, 1);
              if (window.socket) window.socket.emit('item_picked_up', { id: item.id });
              triggerNotification(`Picked up ${item.name}`);
              renderHUDInventory();
              if (window.isTutorialMatch && tutorialStage === 4) {
                advanceTutorialStage(5, `Secured ${item.name}! Next: Share Supplies & Keys`);
              }
            } else {
              triggerNotification("Inventory full! Drop an item first.");
            }
          }
        };
      }
    }
  }

  // 3. Keys in Maze
  if (typeof keysInMaze !== 'undefined' && keysInMaze.length > 0) {
    for (let i = 0; i < keysInMaze.length; i++) {
      const key = keysInMaze[i];
      if (!key || !key.mesh) continue;
      const res = evalInteractionCandidate(key.mesh.position, 6.0);
      if (res.eligible && res.score < bestScore) {
        bestScore = res.score;
        const hasKeySpace = carriedKeys.length < MAX_CARRIED_KEYS;
        const prompt = hasKeySpace
          ? (isMobileDevice ? `Tap to collect ${key.typeName}` : `Press <kbd>E</kbd> to collect ${key.typeName}`)
          : (isMobileDevice ? `Hands Full! Tap DROP KEY to replace` : `Hands Full! Press <kbd>G</kbd> to drop a key first`);
        bestCandidate = {
          type: 'key',
          key: key,
          promptText: prompt,
          action: () => {
            if (carriedKeys.length >= MAX_CARRIED_KEYS) {
              triggerNotification(`Cannot carry more than ${MAX_CARRIED_KEYS} keys. Press G to drop one.`);
              return;
            }
            const keyId = key.id || ('key_' + key.symbol);
            const isNewKey = !discoveredKeyIds.has(keyId);
            if (isNewKey) {
              discoveredKeyIds.add(keyId);
            }

            scene.remove(key.mesh);
            key.mesh.traverse(child => {
              if (child.isMesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
              }
            });
            carriedKeys.push({ id: keyId, symbol: key.symbol, typeName: key.typeName });
            foundKeysList.push(key.symbol);

            const isReal = gateSolved && isKeyFunctional(key);
            if (isNewKey) {
              triggerNotification(`Discovered NEW [${key.typeName}]! The labyrinth shifts! (${carriedKeys.length}/${MAX_CARRIED_KEYS})`);
            } else {
              triggerNotification(`Picked up [${key.typeName}]${isReal ? ' ★ (Twin Key Verified)' : ''} (${carriedKeys.length}/${MAX_CARRIED_KEYS})`);
            }

            renderCarriedKeysHUD();
            checkWinCondition();

            if (window.isTutorialMatch) {
              if (tutorialStage === 4) {
                advanceTutorialStage(5, `Secured ${key.typeName}! Next: Share Supplies & Keys`);
              } else if (tutorialStage === 11) {
                if (isReal) {
                  triggerNotification(`🔑 Required Twin Key [${key.typeName}] Acquired! Bring it to the Master Vault Gate!`);
                } else {
                  triggerNotification(`⚠️ [${key.typeName}] is a Decoy! Gate requires: [${(functionalKeysRevealed || []).join(' & ')}]`);
                }
                updateTutorialQuestBanner();
              }
            }

            if (typeof socketClient !== 'undefined') {
              socketClient.emit('key_picked_up', { keyId: keyId });
              if (isNewKey) {
                socketClient.emit('solve_puzzle_room', { keyId: keyId });
              }
            }
            const idx = keysInMaze.indexOf(key);
            if (idx !== -1) keysInMaze.splice(idx, 1);
          }
        };
      }
    }
  }

  // 4. Circuit Breakers
  if (typeof circuitBreakers !== 'undefined' && circuitBreakers.length > 0) {
    for (let i = 0; i < circuitBreakers.length; i++) {
      const breaker = circuitBreakers[i];
      if (!breaker || !breaker.mesh || breaker.isFixed) continue;
      const res = evalInteractionCandidate(breaker.mesh.position, 5.5);
      if (res.eligible && res.score < bestScore) {
        bestScore = res.score;
        bestCandidate = {
          type: 'breaker',
          breaker: breaker,
          promptText: isMobileDevice ? "Tap to repair Breaker" : "Press <kbd>E</kbd> to repair breaker",
          action: () => {
            if (typeof socketClient !== 'undefined') socketClient.emit('breaker_fixed', { breakerId: breaker.id });
            fixBreakerLocal(breaker.id);
          }
        };
      }
    }
  }

  // 5. Code Clue Notes
  if (typeof codeClueNotes !== 'undefined' && codeClueNotes.length > 0) {
    for (let i = 0; i < codeClueNotes.length; i++) {
      const clue = codeClueNotes[i];
      if (!clue || !clue.mesh) continue;
      const res = evalInteractionCandidate(clue.mesh.position, 5.5);
      if (res.eligible && res.score < bestScore) {
        bestScore = res.score;
        let prompt = "";
        if (clue.collected) {
          const digits = window.cipherCodeDigits || [];
          const revealedDigit = digits[clue.digitIndex] !== undefined ? digits[clue.digitIndex] : '?';
          prompt = `Cipher Clue #${clue.digitIndex + 1}: [ ${revealedDigit} ] (Code Already Read)`;
        } else {
          prompt = isMobileDevice ? `Tap to inspect Cipher Clue #${clue.digitIndex + 1}` : `Press <kbd>E</kbd> to inspect Cipher Clue #${clue.digitIndex + 1}`;
        }
        bestCandidate = {
          type: 'clue',
          clue: clue,
          promptText: prompt,
          action: () => {
            if (clue.collected) {
              const digitNames = ['1ST', '2ND', '3RD', '4TH'];
              const digits = window.cipherCodeDigits || [];
              const revealedDigit = digits[clue.digitIndex] !== undefined ? digits[clue.digitIndex] : '?';
              triggerNotification(`Code already read! ${digitNames[clue.digitIndex]} digit of gate code: [ ${revealedDigit} ]`);
            } else {
              if (typeof socketClient !== 'undefined') {
                socketClient.emit('clue_collected', { digitIndex: clue.digitIndex });
              }
              collectClueLocal(clue.digitIndex);
            }
          }
        };
      }
    }
  }

  // 6. Master Gate & Keypad Terminal
  if (typeof gateCoordinates !== 'undefined') {
    const gateVec = new THREE.Vector3(gateCoordinates.x, 1.8, gateCoordinates.z);
    const padVec = (gateKeypadWorldPos && gateKeypadWorldPos.lengthSq() > 0) ? gateKeypadWorldPos : gateVec;

    const resPad = evalInteractionCandidate(padVec, 5.0, 0.95);
    const resGate = evalInteractionCandidate(gateVec, 5.5, 0.95);

    let bestVaultRes = (resPad.eligible && resPad.score <= resGate.score) ? resPad : (resGate.eligible ? resGate : null);

    // Proximity fallback: If close to keypad/gate (dist < 2.5m) and facing toward it (dot > 0.1)
    if (!bestVaultRes) {
      const pDistPad = camera.position.distanceTo(padVec);
      const pDistGate = camera.position.distanceTo(gateVec);
      const minPDist = Math.min(pDistPad, pDistGate);
      if (minPDist <= 2.5) {
        const checkPos = (pDistPad <= pDistGate) ? padVec : gateVec;
        const resNear = evalInteractionCandidate(checkPos, 3.5, 1.5);
        if (resNear.eligible) bestVaultRes = resNear;
      }
    }

    if (bestVaultRes && bestVaultRes.eligible && bestVaultRes.score < bestScore) {
      bestScore = bestVaultRes.score;

      let prompt = "";
      if (!gateSolved) {
        const breakersFixed = fixedBreakersCount >= totalBreakersRequired;
        if (!breakersFixed) {
          prompt = isMobileDevice 
            ? `⚡ KEYPAD UNPOWERED (${fixedBreakersCount}/${totalBreakersRequired} Breakers)` 
            : `⚡ KEYPAD UNPOWERED: Repair all breakers (${fixedBreakersCount}/${totalBreakersRequired}) to restore power`;
        } else if (window.securityLockoutActive) {
          const diff = window.securityLockoutEndTime - performance.now();
          if (diff <= 0) {
            window.securityLockoutActive = false;
            prompt = isMobileDevice ? "Tap to Open Keypad" : "Press <kbd>E</kbd> to Open Keypad";
          } else {
            const remaining = Math.max(1, Math.ceil(diff / 1000));
            prompt = `ACCESS DENIED: Security Lockout (${remaining}s remaining)`;
          }
        } else {
          prompt = isMobileDevice ? "Tap to Open Keypad" : "Press <kbd>E</kbd> to Open Keypad";
        }
      } else {
        const uninsertedKeyIndex = carriedKeys.findIndex(k => 
          isKeyFunctional(k) && !isKeyAlreadyInserted(k)
        );

        if (uninsertedKeyIndex !== -1) {
          const keyToInsert = carriedKeys[uninsertedKeyIndex];
          const keyId = getKeyIdentifier(keyToInsert);
          prompt = isMobileDevice ? `Tap to Insert [${keyId}]` : `Press <kbd>E</kbd> to Insert [${keyId}]`;
        } else if (insertedGateKeys.length >= 2) {
          const breakersFixed = fixedBreakersCount >= totalBreakersRequired;
          if (!breakersFixed) {
            prompt = `MASTER GATE LOCKED: Need ${totalBreakersRequired} Breakers to Power Door (${fixedBreakersCount}/${totalBreakersRequired})`;
          } else {
            prompt = isMobileDevice ? "Tap to Escape Labyrinth!" : "Press <kbd>E</kbd> to Escape Labyrinth!";
          }
        } else {
          const installedGems = (insertedGateKeys || []).map(ins => getCanonicalGemstone(ins)).filter(Boolean);
          const requiredGems = (functionalKeysRevealed || []).map(f => getCanonicalGemstone(f)).filter(Boolean);
          const missingGems = requiredGems.filter(r => !installedGems.some(ig => ig.toLowerCase() === r.toLowerCase()));
          const carriedInstalledKey = carriedKeys.find(k => isKeyAlreadyInserted(k));
          if (carriedInstalledKey) {
            const gemName = getCanonicalGemstone(carriedInstalledKey);
            prompt = `[${gemName}] ALREADY INSTALLED — NEED: ${missingGems.join(' + ') || 'Twin Key'}`;
          } else if (insertedGateKeys.length > 0) {
            prompt = `GATE KEYS: ${insertedGateKeys.length}/2 INSTALLED — NEED: ${missingGems.join(' + ') || 'Twin Key'}`;
          } else {
            prompt = `GATE LOCKED: Insert 2 Twin Extraction Keys`;
          }
        }
      }

      bestCandidate = {
        type: 'keypad_or_gate',
        promptText: prompt,
        action: () => {
          if (!gateSolved) {
            const breakersFixed = fixedBreakersCount >= totalBreakersRequired;
            if (!breakersFixed) {
              triggerNotification(`⚡ KEYPAD UNPOWERED: Repair all circuit breakers (${fixedBreakersCount}/${totalBreakersRequired}) to restore power!`);
              return;
            }
            if (window.securityLockoutActive) {
              const diff = window.securityLockoutEndTime - performance.now();
              if (diff <= 0) {
                window.securityLockoutActive = false;
              } else {
                const remaining = Math.max(1, Math.ceil(diff / 1000));
                triggerNotification(`ACCESS DENIED: Keypad locked out for ${remaining} more seconds!`);
                return;
              }
            }
            openKeypadModal();
            return;
          }

          const uninsertedKeyIndex = carriedKeys.findIndex(k => 
            isKeyFunctional(k) && !isKeyAlreadyInserted(k)
          );

          if (uninsertedKeyIndex !== -1) {
            const poppedKey = carriedKeys.splice(uninsertedKeyIndex, 1)[0];
            const keyId = getKeyIdentifier(poppedKey);
            if (!isKeyAlreadyInserted(poppedKey)) {
              insertedGateKeys.push(keyId);
            }
            renderCarriedKeysHUD();
            updateGateHUD();
            if (typeof socketClient !== 'undefined') {
              socketClient.emit('insert_gate_key', { symbol: keyId });
            }
            triggerNotification(`🔑 Inserted [${keyId}] into Master Gate! (${insertedGateKeys.length}/2 installed)`);
            if (window.isTutorialMatch) {
              updateTutorialQuestBanner();
            }
            checkWinCondition();
            return;
          }

          if (insertedGateKeys.length < 2) {
            const installedGems = (insertedGateKeys || []).map(ins => getCanonicalGemstone(ins)).filter(Boolean);
            const requiredGems = (functionalKeysRevealed || []).map(f => getCanonicalGemstone(f)).filter(Boolean);
            const missingGems = requiredGems.filter(r => !installedGems.some(ig => ig.toLowerCase() === r.toLowerCase()));
            const carriedAlreadyInstalled = carriedKeys.find(k => isKeyAlreadyInserted(k));
            if (carriedAlreadyInstalled) {
              const gemName = getCanonicalGemstone(carriedAlreadyInstalled);
              triggerNotification(`⚠️ [${gemName}] is already installed in the Gate! Seek the remaining twin key: [${missingGems.join(' & ')}]`);
              return;
            }
            if (carriedKeys.length > 0) {
              const nonFuncKey = carriedKeys.find(k => !isKeyFunctional(k)) || carriedKeys[0];
              const keyName = nonFuncKey ? (nonFuncKey.typeName || nonFuncKey.symbol || 'Key') : 'Carried Key';
              triggerNotification(`❌ [${keyName}] does not fit! Gate requires: [${missingGems.join(' & ')}]`);
              return;
            }
          }

          const breakersFixed = fixedBreakersCount >= totalBreakersRequired;
          if (insertedGateKeys.length >= 2) {
            if (!breakersFixed) {
              triggerNotification(`Master Gate needs power! Fix circuit breakers (${fixedBreakersCount}/${totalBreakersRequired}) to open door`);
              return;
            }
            if (socketClient) {
              socketClient.emit('human_escaped', { id: socketClient.id });
            }
            isCaptured = true;
            window.isEscaping = true;
function awardMatchWinCredits() {
  if (matchCreditsAwardedThisSession) {
    return { creditsAwarded: 0, rewardTitle: '', rewardSub: '', isOneTimeClaimed: false };
  }
  matchCreditsAwardedThisSession = true;

  const profileStr = localStorage.getItem('manifestation_user_profile');
  let profile = null;
  try {
    if (profileStr) profile = JSON.parse(profileStr);
  } catch(e) {}

  let localCreds = parseInt(localStorage.getItem('manifestation_credits') || '0', 10);
  let creditsAwarded = 0;
  let rewardTitle = '';
  let rewardSub = '';
  let isOneTimeClaimed = false;

  if (window.isTutorialMatch) {
    const claimed = localStorage.getItem('manifestation_reward_training_claimed') === 'true';
    if (!claimed) {
      creditsAwarded = 20;
      localStorage.setItem('manifestation_reward_training_claimed', 'true');
      rewardTitle = '🏆 CERTIFICATION REWARD: +20 CREDITS';
      rewardSub = 'First-time training protocol completion bonus!';
    } else {
      creditsAwarded = 0;
      isOneTimeClaimed = true;
      rewardTitle = '✅ CERTIFICATION COMPLETED';
      rewardSub = 'First-time completion reward (+20 credits) already claimed.';
    }
  } else if (window.gameDifficulty === 'impossible') {
    const claimed = localStorage.getItem('manifestation_reward_impossible_claimed') === 'true';
    if (!claimed) {
      creditsAwarded = 500;
      localStorage.setItem('manifestation_reward_impossible_claimed', 'true');
      rewardTitle = '🏆 IMPOSSIBLE SURVIVOR: +500 CREDITS';
      rewardSub = 'One-time bonus for conquering the impossible labyrinth!';
    } else {
      creditsAwarded = 50;
      isOneTimeClaimed = true;
      rewardTitle = '🏆 EXTRACTION REWARD: +50 CREDITS';
      rewardSub = 'Impossible mastery bonus (+500) already claimed.';
    }
  } else if (window.gameDifficulty === 'hard') {
    creditsAwarded = 100;
    rewardTitle = '🏆 HARD EXTRACTION: +100 CREDITS';
    rewardSub = 'Hard mode labyrinth victory reward!';
  } else if (window.gameDifficulty === 'easy') {
    creditsAwarded = 20;
    rewardTitle = '🏆 EASY EXTRACTION: +20 CREDITS';
    rewardSub = 'Labyrinth escape victory reward!';
  } else {
    // Medium / Default
    creditsAwarded = 50;
    rewardTitle = '🏆 EXTRACTION REWARD: +50 CREDITS';
    rewardSub = 'Standard labyrinth victory reward!';
  }

  if (creditsAwarded > 0) {
    localCreds += creditsAwarded;
    localStorage.setItem('manifestation_credits', localCreds.toString());
    if (profile) {
      profile.credits = (profile.credits || 0) + creditsAwarded;
      localStorage.setItem('manifestation_user_profile', JSON.stringify(profile));
    }
    const hudCreds = document.getElementById('player-credits-display');
    if (hudCreds) hudCreds.textContent = localCreds;
    const acctCreds = document.getElementById('account-credits-display');
    if (acctCreds) acctCreds.textContent = `💰 ${localCreds}`;
    const token = localStorage.getItem('manifestation_auth_token') || (typeof authToken !== 'undefined' ? authToken : null);
    if (token && socketClient && socketClient.emit) {
      socketClient.emit('account_update_credits', { token, credits: localCreds });
    }
  }

  return { creditsAwarded, rewardTitle, rewardSub, isOneTimeClaimed };
}

            playEscapeCinematic(() => {
              document.getElementById('hud-overlay').style.display = 'none';
              if (document.pointerLockElement) document.exitPointerLock();
              window.mobileGameActive = false;
              const endOverlay = document.getElementById('end-game-overlay');
              if (endOverlay && endOverlay.style.display !== 'flex') {
                const title = document.getElementById('end-game-title');
                const details = document.getElementById('end-game-details');
                if (title && details) {
                  endOverlay.style.display = 'flex';
                  const rewardInfo = awardMatchWinCredits();
                  if (window.isTutorialMatch) {
                    title.textContent = "🎓 CERTIFIED!";
                    title.style.color = "#38bdf8";
                    title.style.textShadow = "0 0 25px rgba(56, 189, 248, 0.8)";
                    details.innerHTML = `
                      <div style="font-weight:bold; color: #38bdf8; margin-bottom: 0.8rem; font-size: 1.3rem;">TRAINING PROTOCOL CERTIFIED</div>
                      <p style="color: #cbd5e1; font-size: 0.95rem; line-height: 1.5;">You successfully mastered movement, sprint boosters, flashlight operation, supply salvage, circuit breaker power restoration, and master vault keypad extraction!</p>
                      <div style="margin-top: 1rem; padding: 0.6rem; background: rgba(56, 189, 248, 0.15); border: 1px solid #38bdf8; border-radius: 8px; color: #7dd3fc; font-weight: bold; font-size: 0.9rem;">
                        ${rewardInfo.rewardTitle}<br>
                        <span style="font-size: 0.8rem; font-weight: normal; color: #94a3b8;">${rewardInfo.rewardSub}</span>
                      </div>
                    `;
                  } else {
                    title.textContent = "ESCAPED!";
                    title.style.color = "#10b981";
                    title.style.textShadow = "0 0 25px rgba(16, 185, 129, 0.8)";
                    details.innerHTML = `
                      <div style="font-weight:bold; color: #10b981; margin-bottom: 0.8rem; font-size: 1.3rem;">EXTRACTION SUCCESSFUL</div>
                      <p style="color: #cbd5e1; font-size: 0.95rem; line-height: 1.5;">You cracked the master vault cipher, outsmarted the entities, and extracted through the Master Gate into the open pine forest!</p>
                      <div style="margin-top: 1rem; padding: 0.6rem; background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 8px; color: #6ee7b7; font-weight: bold; font-size: 0.9rem;">
                        ${rewardInfo.rewardTitle}<br>
                        <span style="font-size: 0.8rem; font-weight: normal; color: #94a3b8;">${rewardInfo.rewardSub}</span>
                      </div>
                    `;
                  }

                  const lobbyBtn = document.getElementById('end-game-lobby-btn');
                  if (lobbyBtn) {
                    lobbyBtn.textContent = 'Return to Lobby';
                    addFastTapListener(lobbyBtn, () => {
                      if (window.leaveGameWithAd) {
                        window.leaveGameWithAd(() => window.location.reload());
                      } else {
                        window.location.reload();
                      }
                    });
                  }
                  const retryBtn = document.getElementById('end-game-retry-btn');
                  if (retryBtn) {
                    retryBtn.style.display = window.isTutorialMatch ? 'inline-block' : 'none';
                    retryBtn.textContent = 'REPLAY TUTORIAL';
                    addFastTapListener(retryBtn, () => {
                      window.location.reload();
                    });
                  }
                }
              }
            });
            return;
          } else {
            triggerNotification(`Master Gate requires remaining twin key! (${insertedGateKeys.length}/2 installed: [${insertedGateKeys.join(', ') || 'None'}])`);
          }
        }
      };
    }
  }

  return bestCandidate;
}

// Dynamically render on-screen keys/breaker/item interaction prompts in HUD
function updateInteractionPrompt() {
  const promptEl = document.getElementById('interaction-prompt');
  if (myTeam === 'Ghost') {
    if (promptEl && promptEl.style.display !== 'none') promptEl.style.display = 'none';
    return;
  }
  if (!promptEl) return;

  const keypadEl = document.getElementById('keypad-modal-ui');
  const isKeypadOpen = keypadEl && keypadEl.style.display !== 'none';
  const ptrOverlay = document.getElementById('pointer-lock-overlay');
  const isPauseOpen = ptrOverlay && ptrOverlay.style.display !== 'none';

  if (myTeam !== 'Human' || isCaptured || !window.gameReady || isMinimapExpanded || isKeypadOpen || isPauseOpen || window.isEscaping) {
    if (promptEl.style.display !== 'none') promptEl.style.display = 'none';
    return;
  }

  const bestTarget = getBestInteractionTarget();
  if (bestTarget && bestTarget.promptText) {
    if (promptEl.innerHTML !== bestTarget.promptText) {
      promptEl.innerHTML = bestTarget.promptText;
    }
    if (promptEl.style.display !== 'block') {
      promptEl.style.display = 'block';
    }
  } else {
    if (promptEl.style.display !== 'none') {
      promptEl.style.display = 'none';
    }
  }
}

// Direct tap interaction for mobile touchscreen: click on 3D items, breakers, clues, keys, or keypad directly
function handleDirectTapInteraction(clientX, clientY) {
  if (myTeam === 'Ghost' || window.isSpectating || isMinimapExpanded || isCaptured || window.isEscaping) return;
  const keypadEl = document.getElementById('keypad-modal-ui');
  if (keypadEl && keypadEl.style.display !== 'none') return;
  const ptrOverlay = document.getElementById('pointer-lock-overlay');
  if (ptrOverlay && ptrOverlay.style.display !== 'none') return;

  const renderCam = (typeof activeViewCamera !== 'undefined' && activeViewCamera) ? activeViewCamera : camera;
  if (!renderCam) return;

  // 1. Raycast from touch screen coordinates into the 3D scene
  const raycaster = new THREE.Raycaster();
  const touchNDC = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(touchNDC, renderCam);

  const candidates = [];

  // Ground dropped items
  if (typeof itemsInMaze !== 'undefined' && itemsInMaze.length > 0) {
    for (let i = 0; i < itemsInMaze.length; i++) {
      const itm = itemsInMaze[i];
      if (itm && itm.mesh) {
        candidates.push({
          mesh: itm.mesh,
          pos: itm.mesh.position,
          maxDist: 6.0,
          action: () => {
            const uniqueEquipment = ["EMF Radar", "Thermal Camera", "Breaker Remote"];
            if (uniqueEquipment.includes(itm.name) && inventory.includes(itm.name)) {
              triggerNotification(`You already have a ${itm.name}!`);
              return;
            }
            const emptyIndex = inventory.indexOf('');
            if (emptyIndex !== -1) {
              inventory[emptyIndex] = itm.name;
              disposeItemMesh(itm.mesh);
              const idx = itemsInMaze.indexOf(itm);
              if (idx !== -1) itemsInMaze.splice(idx, 1);
              if (window.socket) window.socket.emit('item_picked_up', { id: itm.id });
              triggerNotification(`Picked up ${itm.name}`);
              renderHUDInventory();
              if (window.isTutorialMatch && tutorialStage === 4) {
                advanceTutorialStage(5, `Secured ${itm.name}! Next: Share Supplies & Keys`);
              }
            } else {
              triggerNotification("Inventory full! Drop an item first.");
            }
          }
        });
      }
    }
  }

  // Circuit Breakers
  if (typeof circuitBreakers !== 'undefined' && circuitBreakers.length > 0) {
    for (let i = 0; i < circuitBreakers.length; i++) {
      const cb = circuitBreakers[i];
      if (cb && cb.mesh && !cb.isFixed) {
        candidates.push({
          mesh: cb.mesh,
          pos: cb.mesh.position,
          maxDist: 6.0,
          action: () => {
            if (typeof socketClient !== 'undefined') socketClient.emit('breaker_fixed', { breakerId: cb.id });
            fixBreakerLocal(cb.id);
          }
        });
      }
    }
  }

  // Code Clue Notes
  if (typeof codeClueNotes !== 'undefined' && codeClueNotes.length > 0) {
    for (let i = 0; i < codeClueNotes.length; i++) {
      const clue = codeClueNotes[i];
      if (clue && clue.mesh) {
        candidates.push({
          mesh: clue.mesh,
          pos: clue.mesh.position,
          maxDist: 6.0,
          action: () => {
            if (clue.collected) {
              const digitNames = ['1ST', '2ND', '3RD', '4TH'];
              const digits = window.cipherCodeDigits || [];
              const revealedDigit = digits[clue.digitIndex] !== undefined ? digits[clue.digitIndex] : '?';
              triggerNotification(`Code already read! ${digitNames[clue.digitIndex]} digit of gate code: [ ${revealedDigit} ]`);
            } else {
              if (typeof socketClient !== 'undefined') {
                socketClient.emit('clue_collected', { digitIndex: clue.digitIndex });
              }
              collectClueLocal(clue.digitIndex);
            }
          }
        });
      }
    }
  }

  // Keys in Maze
  if (typeof keysInMaze !== 'undefined' && keysInMaze.length > 0) {
    for (let i = 0; i < keysInMaze.length; i++) {
      const k = keysInMaze[i];
      if (k && k.mesh) {
        candidates.push({
          mesh: k.mesh,
          pos: k.mesh.position,
          maxDist: 6.0,
          action: () => {
            if (carriedKeys.length >= MAX_CARRIED_KEYS) {
              triggerNotification(`Cannot carry more than ${MAX_CARRIED_KEYS} keys. Tap DROP KEY first.`);
              return;
            }
            const keyId = k.id || ('key_' + k.symbol);
            const isNewKey = !discoveredKeyIds.has(keyId);
            if (isNewKey) discoveredKeyIds.add(keyId);

            scene.remove(k.mesh);
            k.mesh.traverse(child => {
              if (child.isMesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
              }
            });
            carriedKeys.push({ id: keyId, symbol: k.symbol, typeName: k.typeName });
            foundKeysList.push(k.symbol);

            const isReal = gateSolved && isKeyFunctional(k);
            if (isNewKey) {
              triggerNotification(`Discovered NEW [${k.typeName}]! The labyrinth shifts! (${carriedKeys.length}/${MAX_CARRIED_KEYS})`);
            } else {
              triggerNotification(`Picked up [${k.typeName}]${isReal ? ' ★ (Twin Key Verified)' : ''} (${carriedKeys.length}/${MAX_CARRIED_KEYS})`);
            }

            renderCarriedKeysHUD();
            checkWinCondition();

            if (typeof socketClient !== 'undefined') {
              socketClient.emit('key_picked_up', { keyId: keyId });
              if (isNewKey) {
                socketClient.emit('solve_puzzle_room', { keyId: keyId });
              }
            }
            const idx = keysInMaze.indexOf(k);
            if (idx !== -1) keysInMaze.splice(idx, 1);
          }
        });
      }
    }
  }

  // Mirage Items
  if (typeof mirageItems !== 'undefined' && mirageItems.length > 0) {
    for (let i = 0; i < mirageItems.length; i++) {
      const mi = mirageItems[i];
      if (mi && mi.mesh && !mi.dissolving) {
        candidates.push({
          mesh: mi.mesh,
          pos: mi.mesh.position,
          maxDist: 6.0,
          action: () => dissolveMirageItem(mi)
        });
      }
    }
  }

  // Vault Keypad & Master Gate
  if (typeof vaultGroup !== 'undefined' && vaultGroup) {
    const gateVec = (typeof gateCoordinates !== 'undefined') ? new THREE.Vector3(gateCoordinates.x, 1.8, gateCoordinates.z) : null;
    const padVec = (gateKeypadWorldPos && gateKeypadWorldPos.lengthSq() > 0) ? gateKeypadWorldPos : gateVec;
    candidates.push({
      mesh: vaultGroup,
      pos: padVec || camera.position,
      maxDist: 6.0,
      action: () => {
        const bestTarget = getBestInteractionTarget();
        if (bestTarget && typeof bestTarget.action === 'function') {
          bestTarget.action();
        } else {
          checkInteractions();
        }
      }
    });
  }

  // Check raycast intersections
  const pPos = camera.position;
  let directHitAction = null;
  let minRayDist = Infinity;

  for (let c = 0; c < candidates.length; c++) {
    const cand = candidates[c];
    if (!cand.mesh) continue;
    const pDist = pPos.distanceTo(cand.pos);
    if (pDist > cand.maxDist) continue;

    const hits = raycaster.intersectObject(cand.mesh, true);
    if (hits && hits.length > 0) {
      if (hits[0].distance < minRayDist) {
        minRayDist = hits[0].distance;
        directHitAction = cand.action;
      }
    }
  }

  if (directHitAction) {
    directHitAction();
    return;
  }

  // 2. Proximity tap fallback: If ray missed the tiny geometry, but an interaction target is currently eligible and in range
  const bestTarget = getBestInteractionTarget();
  if (bestTarget && typeof bestTarget.action === 'function') {
    if (clientY > 45 && clientY < window.innerHeight - 60) {
      bestTarget.action();
    }
  }
}

function checkInteractions() {
  if (myTeam === 'Ghost' || window.isSpectating || isMinimapExpanded) return;
  const keypadEl = document.getElementById('keypad-modal-ui');
  if (keypadEl && keypadEl.style.display !== 'none') return;
  const ptrOverlay = document.getElementById('pointer-lock-overlay');
  if (ptrOverlay && ptrOverlay.style.display !== 'none') return;

  const bestTarget = getBestInteractionTarget();
  if (bestTarget && typeof bestTarget.action === 'function') {
    bestTarget.action();
    return;
  }

  // Fallback feedback when tapping interact in an empty hallway
  triggerNotification("Nothing nearby to interact with.");
}

function collectClueLocal(digitIndex) {
  const note = codeClueNotes.find(n => n.digitIndex === digitIndex);
  if (note && !note.collected) {
    note.collected = true;
    if (note.mesh) {
      note.mesh.traverse(c => {
        if (c.isMesh && c.material) {
          if (c.material.emissiveIntensity !== undefined) c.material.emissiveIntensity = 0.1;
        }
        if (c.isPointLight) {
          c.intensity = 0.2;
        }
      });
    }

    // Feature 1: Lore Journal & Cipher Clarity (+15% Sanity boost)
    if (myTeam === 'Human') {
      currentSanity = Math.min(100, currentSanity + 15);
      const sVal = document.getElementById('sanity-value');
      const sBar = document.getElementById('sanity-bar');
      if (sVal) sVal.textContent = `${Math.floor(currentSanity)}%`;
      if (sBar) sBar.style.width = `${currentSanity}%`;
      triggerNotification(`📖 Lore Note Deciphered! (+15% Sanity — Cipher Clarity)`);
    }
  }

  const digitNames = ['1ST', '2ND', '3RD', '4TH'];
  const digits = window.cipherCodeDigits || [null, null, null, null];
  const revealedDigit = digits[digitIndex];
  const cipherHUD = document.getElementById('hud-cipher-info');

  if (window.gameDifficulty === 'impossible') {
    triggerNotification(`Cipher clue discovered! [ ${revealedDigit} ] (Position Unknown)`);
    if (cipherHUD) {
      const foundDigits = codeClueNotes
        .filter(n => n.collected)
        .map(n => digits[n.digitIndex]);
      cipherHUD.textContent = `UNORDERED DIGITS: [ ${foundDigits.join(', ')} ] (${foundDigits.length}/4 found)`;
      cipherHUD.style.color = '#f59e0b';
    }
  } else {
    triggerNotification(`Cipher clue found! ${digitNames[digitIndex]} digit of gate code: [ ${revealedDigit} ]`);
    if (cipherHUD) {
      const display = digits.map((d, idx) => {
        const collected = codeClueNotes.find(n => n.digitIndex === idx && n.collected);
        return collected ? d : '_';
      }).join(' ');
      cipherHUD.textContent = `CODE: ${display}`;
      cipherHUD.style.color = '#38bdf8';
    }
  }

  if (window.isTutorialMatch) {
    const fullCode = (window.cipherCodeDigits || []).join('');
    if (cipherHUD) {
      cipherHUD.textContent = `VAULT CODE: ${fullCode}`;
      cipherHUD.style.color = '#38bdf8';
    }
    if (tutorialStage === 9) {
      if (fixedBreakersCount >= 1) {
        advanceTutorialStage(10, `Power Restored & Code Intel [${fullCode}] Acquired! Head to Master Vault Keypad to reveal the Twin Keys!`);
      } else {
        triggerNotification(`📝 Code Intel [ ${fullCode} ] Decoded! Next: Repair yellow Circuit Breaker (⚡) to power the vault terminal!`);
        updateTutorialQuestBanner();
      }
    }
  }

  if (typeof keypadUI !== 'undefined' && keypadUI.style.display !== 'none') {
    keypadScreen.textContent = getKeypadDisplayString();
  }
}

function useActiveItem() {
  if (window.isSpectating) return;
  const item = inventory[activeSlot];
  if (!item || item === "") {
    triggerNotification("No usable item in active slot.");
    return;
  }

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
    let targetCorpsePos = null;

    // 1. Prefer closest fallen teammate's corpse
    let closestDist = Infinity;
    if (typeof playerCorpses !== 'undefined') {
      for (const [id, corpse] of Object.entries(playerCorpses)) {
        if (id !== myId && corpse && corpse.position) {
          const d = Math.hypot(corpse.position.x - camera.position.x, corpse.position.z - camera.position.z);
          if (d < closestDist) {
            closestDist = d;
            targetPlayerId = id;
            targetPlayerName = corpse.username || (currentLobby && currentLobby.players[id]?.username) || 'Survivor';
            targetCorpsePos = { x: corpse.position.x, y: corpse.position.y || 1.6, z: corpse.position.z };
          }
        }
      }
    }

    // 2. Fallback to any captured human in lobby if corpse registry had not synced yet
    if (!targetPlayerId && currentLobby && currentLobby.players) {
      for (const [id, p] of Object.entries(currentLobby.players)) {
        if (id !== myId && p.team === 'Human' && p.isCaptured) {
          targetPlayerId = id;
          targetPlayerName = p.username || 'Survivor';
          if (p.x !== undefined && p.z !== undefined) {
            targetCorpsePos = { x: p.x, y: p.y || 1.6, z: p.z };
          }
          break;
        }
      }
    }

    if (targetPlayerId) {
      if (typeof socketClient !== 'undefined') {
        socketClient.emit('revive_player', { targetId: targetPlayerId, position: targetCorpsePos });
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
    const gParams = getGhostAbilityParams();
    const now = Date.now();
    if (abilityCooldowns[item] && abilityCooldowns[item] > now) {
      triggerNotification(`Ghost Claws recharging (${Math.ceil((abilityCooldowns[item] - now) / 1000)}s)`);
      return;
    }

    let closestId = null;
    let closestDist = gParams.clawsRange;
    Object.keys(players3D).forEach(id => {
      const dist = camera.position.distanceTo(players3D[id].position);
      const isHuman = players3D[id].userData && (players3D[id].userData.type === 'Human' || !players3D[id].userData.isGhost);
      if (isHuman && dist < closestDist) {
        closestDist = dist;
        closestId = id;
      }
    });
    if (closestId) {
      const dmg = 35;
      if (socketClient && socketClient.emit) {
        socketClient.emit('damage_human', { targetId: closestId, amount: dmg });
      }
      triggerNotification(`Struck survivor with Ghost Claws! (-${dmg} HP)`);
      abilityCooldowns[item] = now + gParams.clawsCooldown;
    } else {
      triggerNotification("No survivor in range.");
    }
  } else if (item === "Scent Tracker") {
    const gParams = getGhostAbilityParams();
    const now = Date.now();
    if (abilityCooldowns[item] && abilityCooldowns[item] > now) {
      triggerNotification(`Scent Tracker recharging (${Math.ceil((abilityCooldowns[item] - now) / 1000)}s)`);
      return;
    }
    triggerNotification(`Scent tracking active (${(gParams.scentDuration / 1000).toFixed(1)}s).`);
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
      }, gParams.scentDuration);
    }
    abilityCooldowns[item] = now + gParams.scentCooldown;
  } else if (item === "Infiltration Clone") {
    const gParams = getGhostAbilityParams();
    const now = Date.now();
    if (abilityCooldowns[item] && abilityCooldowns[item] > now) {
      triggerNotification(`Clone recharging (${Math.ceil((abilityCooldowns[item] - now) / 1000)}s)`);
      return;
    }
    triggerNotification(`Mimic clone active (${Math.round(gParams.cloneDuration / 1000)}s)! You appear human.`);
    socketClient.emit('mimic_clone');
    abilityCooldowns[item] = now + gParams.cloneCooldown;
  } else if (item === "Audio Amplifiers") {
    const gParams = getGhostAbilityParams();
    const now = Date.now();
    if (abilityCooldowns[item] && abilityCooldowns[item] > now) {
      triggerNotification(`Amplifiers recharging (${Math.ceil((abilityCooldowns[item] - now) / 1000)}s)`);
      return;
    }
    triggerNotification(`Audio Amplifiers engaged (${gParams.rageDurationPlayer}s)! Extreme speed.`);
    speedBoostTimer = gParams.rageDurationPlayer;
    abilityCooldowns[item] = now + gParams.rageCooldown;
  } else if (item === "Vapor Leap") {
    const gParams = getGhostAbilityParams();
    const now = Date.now();
    if (abilityCooldowns[item] && abilityCooldowns[item] > now) {
      triggerNotification(`Vapor Leap recharging (${Math.ceil((abilityCooldowns[item] - now) / 1000)}s)`);
      return;
    }
    triggerNotification(`Vapor Leap (${gParams.leapDistancePlayer}m)!`);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    camera.position.addScaledVector(forward, gParams.leapDistancePlayer);
    abilityCooldowns[item] = now + gParams.leapCooldown;
  } else if (item === "Breaker Siphon") {
    const gParams = getGhostAbilityParams();
    const now = Date.now();
    if (abilityCooldowns[item] && abilityCooldowns[item] > now) {
      triggerNotification(`Siphon recharging (${Math.ceil((abilityCooldowns[item] - now) / 1000)}s)`);
      return;
    }
    triggerNotification(`Breaker Siphon deployed (${gParams.siphonRadius.toFixed(0)}m radius)!`);
    socketClient.emit('breaker_siphon', { position: { x: camera.position.x, z: camera.position.z } });
    abilityCooldowns[item] = now + gParams.siphonCooldown;
  } else if (item === "Sound Scrambler") {
    const gParams = getGhostAbilityParams();
    const now = Date.now();
    if (abilityCooldowns[item] && abilityCooldowns[item] > now) {
      triggerNotification(`Scrambler recharging (${Math.ceil((abilityCooldowns[item] - now) / 1000)}s)`);
      return;
    }
    triggerNotification(`Scrambler unleashed (${gParams.scrambleRadius.toFixed(0)}m radius)!`);
    socketClient.emit('sound_scramble', { position: { x: camera.position.x, z: camera.position.z } });
    abilityCooldowns[item] = now + gParams.scrambleCooldown;
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
  if (Array.isArray(gateMeshRef.material)) {
    gateMeshRef.material.forEach(m => {
      if (m.color) m.color.setHex(0x10b981);
      if (m.emissive) {
        m.emissive.setHex(0x10b981);
        m.emissiveIntensity = 1.0;
      }
    });
  } else if (gateMeshRef.material) {
    if (gateMeshRef.material.color) gateMeshRef.material.color.setHex(0x10b981);
    if (gateMeshRef.material.emissive) {
      gateMeshRef.material.emissive.setHex(0x10b981);
      gateMeshRef.material.emissiveIntensity = 1.0;
    }
  }
  if (gateKeypadLed && gateKeypadLed.material) {
    gateKeypadLed.material.color.setHex(0x10b981);
    if (gateKeypadLed.material.emissive) gateKeypadLed.material.emissive.setHex(0x10b981);
  }
  setTimeout(() => {
    if (gateMeshRef) {
      if (Array.isArray(gateMeshRef.material)) {
        gateMeshRef.material.forEach(m => { if (m.emissive) m.emissiveIntensity = 0.3; });
      } else if (gateMeshRef.material && gateMeshRef.material.emissive) {
        gateMeshRef.material.emissiveIntensity = 0.3;
      }
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
  if (isMinimapExpanded) {
    isMinimapExpanded = false;
    const mapWrap = document.getElementById('minimap-wrapper');
    const mapCtrl = document.getElementById('minimap-expanded-controls');
    const topCls = document.getElementById('minimap-top-close-btn');
    const ttlTxt = document.getElementById('minimap-title-text');
    const bkdrop = document.getElementById('minimap-modal-backdrop');
    if (mapWrap) mapWrap.classList.remove('expanded');
    if (mapCtrl) mapCtrl.style.display = 'none';
    if (topCls) topCls.style.display = 'none';
    if (bkdrop) bkdrop.style.display = 'none';
    if (ttlTxt) ttlTxt.textContent = 'MINIMAP (Press M / Tap)';
  }
  const promptEl = document.getElementById('interaction-prompt');
  if (promptEl) promptEl.style.display = 'none';

  if (gateSolved) {
    triggerNotification("Master Gate cipher already bypassed.");
    return;
  }
  const breakersFixed = fixedBreakersCount >= totalBreakersRequired;
  if (!breakersFixed) {
    triggerNotification(`⚡ KEYPAD UNPOWERED: Repair all circuit breakers (${fixedBreakersCount}/${totalBreakersRequired}) to restore power!`);
    return;
  }
  if (window.securityLockoutActive) {
    const diff = window.securityLockoutEndTime - performance.now();
    if (diff <= 0) {
      window.securityLockoutActive = false;
    } else {
      const remaining = Math.max(1, Math.ceil(diff / 1000));
      triggerNotification(`ACCESS DENIED: Keypad locked out for ${remaining} more seconds!`);
      return;
    }
  }
  const modal = document.getElementById('keypad-modal-ui');
  if (!modal) return;
  modal.style.display = 'flex';
  keypadUI = modal;
  keypadScreen = document.getElementById('keypad-screen-display');
  codeEntered = "";
  if (keypadScreen) keypadScreen.textContent = getKeypadDisplayString();

  // Hide pause overlay if it happened to be open
  const ptrOverlay = document.getElementById('pointer-lock-overlay');
  if (ptrOverlay) ptrOverlay.style.display = 'none';

  // Release pointer lock so desktop player has visible cursor to tap digits
  if (document.pointerLockElement) {
    try {
      document.exitPointerLock();
    } catch (_) {}
  }
}

function submitKeypadCode(code) {
  if (!code || code.length < 4) {
    triggerNotification("Enter all 4 digits first.");
    return;
  }

  const isOfflineOrSolo = Boolean(
    window.isSoloMatch ||
    window.isTutorialMatch ||
    !socketClient ||
    !socketClient.emit ||
    !socketClient.on ||
    !socketClient.connected
  );

  if (isOfflineOrSolo) {
    const targetDigits = window.cipherCodeDigits || [];
    const targetCode = targetDigits.join('');

    if (code === targetCode) {
      gateSolved = true;
      const realKeys = (functionalKeysRevealed && functionalKeysRevealed.length > 0)
        ? functionalKeysRevealed
        : ((currentLobby && currentLobby.puzzleState && currentLobby.puzzleState.realKeySymbols) || ['Amber Key', 'Sapphire Key']);
      functionalKeysRevealed = realKeys;

      const formattedKeys = realKeys.map(s => formatFunctionalKeyName(s));
      triggerNotification(`🎉 CIPHER CRACKED! Twin functional keys revealed: [${formattedKeys.join(' & ')}]`);

      if (window.isTutorialMatch) {
        // Automatically place beacon markers on tactical map for required keys so the operative can navigate to them
        keysInMaze.forEach(k => {
          if (realKeys.includes(k.symbol) && k.mesh) {
            const c = Math.floor((k.mesh.position.x / mazeBlockSize) + (mazeSizeGlobal / 2));
            const r = Math.floor((k.mesh.position.z / mazeBlockSize) + (mazeSizeGlobal / 2));
            if (!mapMarks.some(m => m.r === r && m.c === c)) {
              mapMarks.push({ r, c });
            }
          }
        });
        drawMinimap();
        advanceTutorialStage(11, `Cipher Cracked! Master Gate requires [${formattedKeys.join(' & ')}]! Retrieve & insert them into the Gate!`);
      }

      // Close modal
      const keypadModal = document.getElementById('keypad-modal-ui');
      if (keypadModal) {
        keypadModal.style.display = 'none';
        if (!isMobileDevice && !document.pointerLockElement) {
          (renderer && renderer.domElement || document.getElementById('canvas-container')).requestPointerLock();
        }
      }

      // Remove the 3D keypad terminal mesh from the wall
      if (padMeshRef) {
        if (padMeshRef.parent) padMeshRef.parent.remove(padMeshRef);
        else scene.remove(padMeshRef);
        if (padMeshRef.geometry) padMeshRef.geometry.dispose();
        if (padMeshRef.material) padMeshRef.material.dispose();
        padMeshRef = null;
      }

      const cipherHUD = document.getElementById('hud-cipher-info');
      if (cipherHUD) {
        const cleanSymbols = realKeys.map(s => formatFunctionalKeyName(s));
        cipherHUD.textContent = `REQUIRED: ${cleanSymbols.join(' + ')}`;
        cipherHUD.style.color = '#38bdf8';
      }

      renderCarriedKeysHUD();
      updateGateHUD();
      checkWinCondition();
      codeEntered = '';
      const scr = document.getElementById('keypad-screen-display');
      if (scr) scr.textContent = getKeypadDisplayString();
    } else {
      playWrongCodeAnimation();
      triggerNotification(`❌ ACCESS DENIED: [${code}] is incorrect! Check glowing floor clue notes.`);
      codeEntered = '';
      const scr = document.getElementById('keypad-screen-display');
      if (scr) scr.textContent = getKeypadDisplayString();
    }
  } else {
    // Multiplayer online: emit to server
    if (typeof socketClient !== 'undefined' && socketClient.emit) {
      socketClient.emit('try_cipher', code);
    }
    const modal = document.getElementById('keypad-modal-ui');
    if (modal) modal.style.display = 'none';
    codeEntered = '';
    if (!window.isMobileDevice && window.gameReady && !isCaptured && window.requestGamePointerLock) {
      window.requestGamePointerLock();
    }
  }
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
    const modal = document.getElementById('keypad-modal-ui');
    if (modal) modal.style.display = 'none';
    codeEntered = '';
    if (!window.isMobileDevice && window.gameReady && !isCaptured && window.requestGamePointerLock) {
      window.requestGamePointerLock();
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
      if (val === 'CLR') {
        codeEntered = "";
        keypadScreen.textContent = getKeypadDisplayString();
        return;
      }
      if (val === 'ENT') {
        submitKeypadCode(codeEntered);
        return;
      }
      // Let players type all 4 digits freely — no auto-fill from clue notes
      if (codeEntered.length < 4) {
        codeEntered += val;
        keypadScreen.textContent = getKeypadDisplayString();
      }
    });
  });

  keypadSubmitBtn.addEventListener('click', () => {
    submitKeypadCode(codeEntered);
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

  if (window.isTutorialMatch && tutorialStage === 5) {
    advanceTutorialStage(6, "Item Dropped! Sharing supplies saves teams. Next: Tactical Minimap");
  }
}

function spawnDroppedItemLocal(id, name, pos) {
  const mesh = createItemPickupMesh(id, name, pos);

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
    if (!isKeyFunctional(carriedKeys[i])) {
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

  const preservedId = poppedKey.id || ('key_' + poppedKey.symbol);
  keysInMaze.push({
    id: preservedId,
    mesh: mesh,
    symbol: poppedKey.symbol,
    typeName: poppedKey.typeName,
    isDropped: true
  });

  if (socketClient) {
    socketClient.emit('key_dropped', {
      id: preservedId,
      symbol: poppedKey.symbol,
      typeName: poppedKey.typeName,
      position: { x: dropPos.x, y: 1.0, z: dropPos.z }
    });
  }

  renderCarriedKeysHUD();
  checkWinCondition();
  triggerNotification(`Dropped [${poppedKey.typeName}]`);

  if (window.isTutorialMatch && tutorialStage === 5) {
    advanceTutorialStage(6, "Key Dropped! Teammates can now retrieve it. Next: Tactical Minimap");
  }
}

// Trigger risk/reward: Panic Hide / Ghost Shadow Cloak
function triggerPanicHide() {
  if (isPanicked || isCaptured || window.isSpectating) return;

  isPanicked = true;
  panicTimer = 20; // 20 seconds duration

  if (myTeam === 'Human') {
    // Immediately break sight & aggro for all AI ghost bots
    ghosts3D.forEach(g => {
      g.userData.aiState = 'WANDER';
      g.userData.targetGrid = null;
      g.userData.loseSightTimer = 999;
    });

    // Stealth visual aura
    if (flashLight) flashLight.intensity = 40;
    camera.fog = new THREE.FogExp2(0x38bdf8, 0.025); // Subtle stealth cyan haze
    triggerNotification("Invisibility Activated (20s)");
  } else if (myTeam === 'Ghost') {
    triggerNotification("Shadow Cloak Invisibility Activated (20s)");
  }

  // Make local player visual semi-transparent in 3rd-person view
  if (localPlayerVisual) {
    localPlayerVisual.traverse(c => {
      if ((c.isMesh || c.isSprite) && c.material) {
        c.material.transparent = true;
        c.material.opacity = 0.2;
        c.material.depthWrite = false;
        c.material.needsUpdate = true;
      }
    });
  }

  // Emit event to network
  if (socketClient) {
    socketClient.emit('panic_hide');
  }
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

// --- Feature 3: Fake Ghosts (Hallucination Phantoms — Client-Side Only) ---
function spawnFakeGhost() {
  if (openCorridors.length === 0) return;

  const pDir = new THREE.Vector3();
  camera.getWorldDirection(pDir);
  pDir.y = 0;
  pDir.normalize();

  // Try to find open corridor cell 7 to 16 meters directly in front of the player's view
  const candidates = openCorridors.filter(c => {
    const dx = c.x - camera.position.x;
    const dz = c.z - camera.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 7 || d > 17) return false;

    const dot = (dx * pDir.x + dz * pDir.z) / d;
    return dot > 0.35 && hasGridLineOfSight(camera.position.x, camera.position.z, c.x, c.z);
  });

  let chosenPos = null;
  if (candidates.length > 0) {
    chosenPos = candidates[Math.floor(Math.random() * candidates.length)];
  } else {
    // Fallback: any nearby corridor with line of sight
    const nearby = openCorridors.filter(c => {
      const d = Math.hypot(c.x - camera.position.x, c.z - camera.position.z);
      return d > 6 && d < 15 && hasGridLineOfSight(camera.position.x, camera.position.z, c.x, c.z);
    });
    if (nearby.length > 0) chosenPos = nearby[Math.floor(Math.random() * nearby.length)];
  }

  if (!chosenPos) return;

  // Build Doppelganger Ghost (looks like the operative's 3D model with glowing red eyes!)
  const ghostGroup = new THREE.Group();
  ghostGroup.position.set(chosenPos.x, 0, chosenPos.z);

  // Humanoid operative model matching player
  const humanVisual = createHumanMeshGroup(null, '');
  ghostGroup.add(humanVisual);

  // Glowing Crimson/Magenta Phantom Eyes on the face
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
  const eyeGeo = new THREE.SphereGeometry(0.08, 8, 8);
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.16, 2.3, 0.35);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.16, 2.3, 0.35);
  ghostGroup.add(leftEye);
  ghostGroup.add(rightEye);

  // Eerie purple/red phantom light aura
  const phantomLight = new THREE.PointLight(0xd946ef, 3.8, 10.0);
  phantomLight.position.y = 2.0;
  ghostGroup.add(phantomLight);

  scene.add(ghostGroup);
  shadowDecoys.push({
    group: ghostGroup,
    light: phantomLight,
    x: chosenPos.x,
    z: chosenPos.z,
    spawnTime: performance.now(),
    focusTimer: 0,
    dissolving: false
  });
}

function updateShadowDecoys(delta) {
  const time = performance.now();
  for (let i = shadowDecoys.length - 1; i >= 0; i--) {
    const decoy = shadowDecoys[i];
    if (!decoy || !decoy.group) continue;

    const age = (time - decoy.spawnTime) / 1000;

    // Bobbing & floating ghost animation + face toward player
    decoy.group.position.y = 0.2 + Math.sin(time * 0.003 + decoy.x) * 0.2;
    decoy.group.lookAt(camera.position.x, decoy.group.position.y, camera.position.z);

    // Slowly glide / stalk down the hallway toward the player while active
    const d = Math.hypot(camera.position.x - decoy.group.position.x, camera.position.z - decoy.group.position.z);
    if (!decoy.dissolving && d > 3.0) {
      const dirX = (camera.position.x - decoy.group.position.x) / d;
      const dirZ = (camera.position.z - decoy.group.position.z) / d;
      decoy.group.position.x += dirX * delta * 1.2;
      decoy.group.position.z += dirZ * delta * 1.2;
    }

    const { looking } = isLookingAtTarget(decoy.group.position, 18.0);
    const flashlightOn = flashLight && flashLight.intensity > 15;
    
    // Accumulate flashlight focus time
    if (looking && flashlightOn) {
      decoy.focusTimer = (decoy.focusTimer || 0) + delta;
    }

    // Dissolve ONLY IF:
    // 1. Has lingered for at least 2.5s AND flashlight shined steadily for 1.2s
    // 2. OR player walked very close (d < 2.5m)
    // 3. OR stalked for > 6.5s
    const shouldDissolve = (age >= 2.5 && decoy.focusTimer >= 1.2) || (d < 2.5) || (age >= 6.5);

    if (shouldDissolve && !decoy.dissolving) {
      decoy.dissolving = true;
      triggerNotification("👁️ A hallucinated ghost dissolved into thin air!");
      if (audioCtx) {
        try {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(260, audioCtx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(35, audioCtx.currentTime + 0.6);
          gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
          gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.6);
        } catch(e) {}
      }
    }

    if (decoy.dissolving) {
      decoy.group.position.y += delta * 0.8;
      decoy.group.scale.multiplyScalar(0.96);
      if (decoy.light) decoy.light.intensity *= 0.92;
      
      decoy.group.traverse(child => {
        if (child.material && child.material.opacity !== undefined) {
          child.material.opacity = Math.max(0, child.material.opacity - delta * 1.2);
        }
      });

      if (decoy.group.scale.x < 0.08) {
        scene.remove(decoy.group);
        shadowDecoys.splice(i, 1);
      }
    }
  }
}

// --- Feature 2: Fake Objective Items (Mirage Loot — Client-Side Only) ---
function spawnMirageLoot() {
  if (openCorridors.length === 0) return;

  const pDir = new THREE.Vector3();
  camera.getWorldDirection(pDir);
  pDir.y = 0;
  pDir.normalize();

  // Try to find open corridor cell 5 to 14 meters in front of the player's view
  const candidates = openCorridors.filter(c => {
    const dx = c.x - camera.position.x;
    const dz = c.z - camera.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 5 || d > 14) return false;

    const nearRealItem = itemsInMaze.some(item => item.mesh && Math.hypot(item.mesh.position.x - c.x, item.mesh.position.z - c.z) < 4.0);
    const nearKey = keysInMaze.some(k => k.mesh && Math.hypot(k.mesh.position.x - c.x, k.mesh.position.z - c.z) < 4.0);
    const nearClue = codeClueNotes.some(n => n.mesh && Math.hypot(n.mesh.position.x - c.x, n.mesh.position.z - c.z) < 4.0);
    if (nearRealItem || nearKey || nearClue) return false;

    const dot = (dx * pDir.x + dz * pDir.z) / d;
    return dot > 0.2 && hasGridLineOfSight(camera.position.x, camera.position.z, c.x, c.z);
  });

  let chosenPos = null;
  if (candidates.length > 0) {
    chosenPos = candidates[Math.floor(Math.random() * candidates.length)];
  } else {
    const nearby = openCorridors.filter(c => {
      const d = Math.hypot(c.x - camera.position.x, c.z - camera.position.z);
      const nearReal = itemsInMaze.some(item => item.mesh && Math.hypot(item.mesh.position.x - c.x, item.mesh.position.z - c.z) < 4.0);
      return d > 4 && d < 14 && !nearReal && hasGridLineOfSight(camera.position.x, camera.position.z, c.x, c.z);
    });
    if (nearby.length > 0) chosenPos = nearby[Math.floor(Math.random() * nearby.length)];
  }

  if (!chosenPos) return;

  const lootTypes = [
    { name: 'Battery Pack', tex: '/assets/battery_sprite.png' },
    { name: 'Sanity Pills', tex: '/assets/pills_sprite.png' },
    { name: 'Med Kit', tex: '/assets/medkit_sprite.png' }
  ];
  const selected = lootTypes[Math.floor(Math.random() * lootTypes.length)];

  const mirageMat = new THREE.SpriteMaterial({
    map: getLoadedTexture(selected.tex),
    color: 0xffffff,
    fog: true,
    transparent: true,
    alphaTest: 0.05,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(mirageMat);
  sprite.scale.set(0.65, 0.65, 1);
  sprite.position.set(chosenPos.x, 0.35, chosenPos.z);
  scene.add(sprite);

  mirageItems.push({
    id: 'mirage_' + Math.random().toString(36).substr(2, 9),
    mesh: sprite,
    material: mirageMat,
    name: selected.name,
    x: chosenPos.x,
    z: chosenPos.z,
    spawnTime: performance.now(),
    dissolving: false
  });
}

function updateMirageLoot(delta) {
  const time = performance.now();
  for (let i = mirageItems.length - 1; i >= 0; i--) {
    const m = mirageItems[i];
    if (!m || !m.mesh) continue;

    m.mesh.position.y = 0.35 + Math.sin(time * 0.005) * 0.05;
    m.mesh.material.opacity = 0.65 + Math.sin(time * 0.01) * 0.3;

    if (time - m.spawnTime > 40000 && !m.dissolving) {
      m.dissolving = true;
    }

    if (m.dissolving) {
      m.material.opacity -= delta * 3.0;
      m.mesh.scale.multiplyScalar(0.92);
      if (m.material.opacity <= 0.04) {
        scene.remove(m.mesh);
        if (m.mesh.geometry) m.mesh.geometry.dispose();
        if (m.material) m.material.dispose();
        mirageItems.splice(i, 1);
      }
    }
  }
}

function dissolveMirageItem(mirage) {
  if (!mirage || mirage.dissolving) return;
  mirage.dissolving = true;
  
  // Instantly remove mesh and clean up
  if (mirage.mesh) {
    scene.remove(mirage.mesh);
    if (mirage.mesh.geometry) mirage.mesh.geometry.dispose();
    if (mirage.material) mirage.material.dispose();
  }
  const idx = mirageItems.indexOf(mirage);
  if (idx > -1) mirageItems.splice(idx, 1);

  triggerNotification("🌫️ Mirage crumbled into ash! It was a hallucination.");

  if (audioCtx) {
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.4);
    } catch(e) {}
  }
}

let lastHeartbeatAudioTime = 0;
function processGhostProximityAudio(distToGhost) {
  if (distToGhost > 14.0 || window.isSpectating || isCaptured) return;
  const now = performance.now();
  // Dynamic heartbeat interval: 450ms when close, 1200ms at 14m perimeter
  const interval = 450 + (distToGhost / 14.0) * 750;
  if (now - lastHeartbeatAudioTime < interval) return;
  lastHeartbeatAudioTime = now;

  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    if (!audioCtx) return;

    const t = audioCtx.currentTime;
    const vol = Math.max(0.04, Math.min(0.24, (1.0 - distToGhost / 14.0) * 0.24));

    // Beat 1 (lub): 60Hz -> 35Hz
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(60, t);
    osc1.frequency.exponentialRampToValueAtTime(35, t + 0.11);
    gain1.gain.setValueAtTime(vol, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(t);
    osc1.stop(t + 0.11);

    // Beat 2 (dub): 48Hz -> 28Hz
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(48, t + 0.12);
    osc2.frequency.exponentialRampToValueAtTime(28, t + 0.22);
    gain2.gain.setValueAtTime(vol * 0.75, t + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(t + 0.12);
    osc2.stop(t + 0.22);
  } catch(e) {}
}

function updateGhostProximityVignette(distToGhost, inSanctuary) {
  let vig = document.getElementById('ghost-proximity-vignette');
  if (!vig) {
    vig = document.createElement('div');
    vig.id = 'ghost-proximity-vignette';
    vig.style.position = 'fixed';
    vig.style.top = '0';
    vig.style.left = '0';
    vig.style.width = '100vw';
    vig.style.height = '100vh';
    vig.style.pointerEvents = 'none';
    vig.style.zIndex = '45';
    vig.style.transition = 'opacity 0.25s ease-out';
    document.body.appendChild(vig);
  }

  if (window.isSpectating || isCaptured || distToGhost > 14.0) {
    vig.style.opacity = '0';
    return;
  }

  if (inSanctuary) {
    // Warm golden amber sanctuary shield vignette
    vig.style.background = 'radial-gradient(ellipse at center, transparent 65%, rgba(251, 191, 36, 0.25) 100%)';
    vig.style.opacity = '1';
  } else {
    // Eerie pulsing purple threat vignette
    const intensity = Math.max(0.18, (1.0 - distToGhost / 14.0) * 0.65);
    const pulse = 0.85 + Math.sin(performance.now() * 0.008) * 0.15;
    vig.style.background = `radial-gradient(ellipse at center, transparent 55%, rgba(147, 51, 234, ${intensity * pulse}) 100%)`;
    vig.style.opacity = '1';
  }
}

// Proximity micro-vibrations and sanity regression
function processSanity(delta) {
  const canvasContainer = document.getElementById('canvas-container');
  const ptrOverlay = document.getElementById('pointer-lock-overlay');
  const isPauseActive = Boolean(ptrOverlay && ptrOverlay.style.display === 'flex');

  // Immediately clear any visual filters if paused, spectating, or dead/captured
  if (myTeam !== 'Human' || window.isSpectating || isPauseActive || isCaptured) {
    if (canvasContainer) canvasContainer.style.filter = 'none';
    document.body.style.filter = 'none';
    updateGhostProximityVignette(999, false);
    return;
  }

  // Feature 4: Check if inside Light Sanctuary (UV Lantern Zones)
  let inSanctuary = false;
  if (typeof sanctuaryZones !== 'undefined') {
    sanctuaryZones.forEach(s => {
      const d = Math.hypot(camera.position.x - s.x, camera.position.z - s.z);
      if (d < s.radius) inSanctuary = true;
    });
  }

  // If near any active ghost (AI or player ghost), sanity decays!
  const gParams = getGhostAbilityParams();
  let nearGhost = false;
  let minGhostDist = Infinity;
  if (typeof ghosts3D !== 'undefined') {
    ghosts3D.forEach(g => {
      const d = camera.position.distanceTo(g.position);
      if (d < minGhostDist) minGhostDist = d;
      if (d < 8) nearGhost = true;
    });
  }
  if (typeof players3D !== 'undefined') {
    Object.values(players3D).forEach(p => {
      if (p.userData && p.userData.type === 'Ghost') {
        const d = camera.position.distanceTo(p.position);
        if (d < minGhostDist) minGhostDist = d;
        if (d < 8) nearGhost = true;
      }
    });
  }

  // Dynamic heartbeat audio and atmospheric proximity vignette
  processGhostProximityAudio(minGhostDist);
  updateGhostProximityVignette(minGhostDist, inSanctuary);

  if (inSanctuary) {
    // Steadily restore sanity inside warm Light Sanctuaries (+8.5%/s)
    currentSanity = Math.min(100, currentSanity + delta * 8.5);
    if (window.isTutorialMatch && tutorialStage === 7) {
      advanceTutorialStage(8, "Light Sanctuary Reached! Sanity Restoring (+8.5%/s)! Next: Core Objectives & Ghost Drill");
    }
  } else if (nearGhost) {
    currentSanity = Math.max(0, currentSanity - delta * gParams.sanityDrainRate); // Difficulty scaled fast decay
  } else {
    currentSanity = Math.max(0, currentSanity - delta * 0.2); // Idle slow decay in labyrinth
  }

  // Feature 3: Trigger Fake Ghosts when Sanity is low (<40%) — strictly local hallucination
  if (currentSanity < 40) {
    nextDecoyTimer -= delta;
    if (nextDecoyTimer <= 0 && shadowDecoys.length < 2) {
      spawnFakeGhost();
      nextDecoyTimer = currentSanity === 0 ? 8 + Math.random() * 6 : 15 + Math.random() * 10;
    }
  }

  // Feature 2: Trigger Fake Mirage Loot when Sanity is low (<45%) — strictly local hallucination
  if (currentSanity < 45) {
    nextMirageTimer -= delta;
    if (nextMirageTimer <= 0 && mirageItems.length < 1) {
      spawnMirageLoot();
      nextMirageTimer = currentSanity === 0 ? 10 + Math.random() * 6 : 18 + Math.random() * 10;
    }
  }

  // Update HUD
  const sanityVal = document.getElementById('sanity-value');
  const sanityBar = document.getElementById('sanity-bar');
  if (sanityVal) sanityVal.textContent = `${Math.floor(currentSanity)}%`;
  if (sanityBar) sanityBar.style.width = `${currentSanity}%`;

  // Apply visual distortion ONLY to the 3D canvas viewport, NEVER to document.body!
  // This ensures the pause menu, UI overlays, inventory hotbar, and settings dialog stay 100% clean.
  if (window.sensorsScrambled && !isPauseActive) {
    if (canvasContainer) canvasContainer.style.filter = "invert(1) hue-rotate(180deg)";
  } else if (currentSanity < 30 && !isPauseActive) {
    // Hallucinations overlay on 3D canvas
    if (canvasContainer) canvasContainer.style.filter = `hue-rotate(${Math.sin(performance.now() * 0.01) * 30}deg) contrast(1.2)`;
  } else {
    if (canvasContainer) canvasContainer.style.filter = 'none';
  }
  document.body.style.filter = 'none';
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

  if (!isFlashlightToggledOn) {
    flashLight.intensity = 0;
    return;
  }

  const mult = getVisionMultiplier();
  const isDungeon = (localStorage.getItem('manifestation_maze_theme') || 'dungeon') === 'dungeon';
  const baseIntensity = (isDungeon ? (inventory.includes('Battery Pack') ? 80 : 45) : (inventory.includes('Battery Pack') ? 200 : 80)) * mult;

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
  const breakersInfo = document.getElementById('hud-breakers-info');
  if (breakersInfo) {
    if (window.isTutorialMatch) {
      breakersInfo.textContent = `POWER: ${fixedBreakersCount}/${totalBreakersRequired} BREAKER`;
      breakersInfo.style.color = fixedBreakersCount >= totalBreakersRequired ? '#10b981' : '#f59e0b';
    } else {
      breakersInfo.textContent = `⚡ ${fixedBreakersCount}/${totalBreakersRequired} BREAKERS`;
      breakersInfo.style.color = fixedBreakersCount >= totalBreakersRequired ? '#10b981' : '#f59e0b';
    }
  }

  const keysHud = document.getElementById('keys-hud-info');
  if (keysHud) {
    if (insertedGateKeys.length >= 2) {
      keysHud.style.color = "#10b981";
      keysHud.textContent = `KEYS: 2/2 INSTALLED (GATE READY)`;
    } else {
      keysHud.style.color = "var(--secondary-accent)";
      keysHud.textContent = `KEYS: ${insertedGateKeys.length}/2 (${carriedKeys.length}/${MAX_CARRIED_KEYS} IN HAND)`;
    }
  }
  const lockLabel = document.getElementById('terminal-lock-label');
  if (lockLabel) {
    if (window.isTutorialMatch) {
      if (gateSolved && fixedBreakersCount >= 1) {
        lockLabel.textContent = "MASTER GATE UNLOCKED — ESCAPE TO FOREST!";
        lockLabel.style.color = "#10b981";
      } else if (gateSolved) {
        lockLabel.textContent = "CIPHER CRACKED — REPAIR 1 BREAKER TO POWER GATE";
        lockLabel.style.color = "#38bdf8";
      } else if (fixedBreakersCount >= 1) {
        lockLabel.textContent = "POWER RESTORED — ENTER 4-DIGIT CODE AT KEYPAD";
        lockLabel.style.color = "#38bdf8";
      } else {
        lockLabel.textContent = "VAULT PROTOCOL: SECURED";
        lockLabel.style.color = "var(--primary-accent)";
      }
    } else {
      if (gateSolved && insertedGateKeys.length >= 2 && fixedBreakersCount >= totalBreakersRequired) {
        lockLabel.textContent = "GATE UNLOCKED — PRESS E TO ESCAPE";
        lockLabel.style.color = "#10b981";
      } else if (gateSolved) {
        lockLabel.textContent = "CIPHER CRACKED — INSTALL 2 GATE KEYS";
        lockLabel.style.color = "#38bdf8";
      } else {
        lockLabel.textContent = "SECURED (3-TIER LOCK)";
        lockLabel.style.color = "var(--primary-accent)";
      }
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

let socketListenersSetup = false;
// Setup network synchronization
function setupSocketListeners() {
  if (socketListenersSetup) return;
  socketListenersSetup = true;
  socketClient.on('player_moved', ({ id, position, rotation, team, characterClass, isVip: isVipMove }) => {
    // Ignore local player position broadcasts so we don't spawn a clone on ourselves
    if (!id || id === myId) return;

    // Never spawn or update 3D living player models for captured/dead operatives (prevents ghost camping corpses)
    if (currentLobby && currentLobby.players && currentLobby.players[id] && currentLobby.players[id].isCaptured) {
      if (players3D[id]) {
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
      return;
    }

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
      const isVipPlayer = Boolean((currentLobby && currentLobby.players[id] && currentLobby.players[id].isVip) || isVipMove);
      const capMesh = isGhost ? createGhostMeshGroup(pSkinId) : createHumanMeshGroup(pSkinId, pUsername, isVipPlayer);
      capMesh.userData.id = id;
      capMesh.userData.isVip = isVipPlayer;
      const glowPref = window.isVipGlowEnabled ? window.isVipGlowEnabled() : true;
      if (isVipPlayer && glowPref) {
        applyVipGlow(capMesh, true);
      }
      
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
      if (isVipMove !== undefined && players3D[id].userData.isVip !== isVipMove) {
        players3D[id].userData.isVip = isVipMove;
        const glowPref = window.isVipGlowEnabled ? window.isVipGlowEnabled() : true;
        applyVipGlow(players3D[id], isVipMove && glowPref);
      }
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
      if (padMeshRef.parent) padMeshRef.parent.remove(padMeshRef);
      else scene.remove(padMeshRef);
      if (padMeshRef.geometry) padMeshRef.geometry.dispose();
      if (padMeshRef.material) padMeshRef.material.dispose();
      padMeshRef = null;
    }

    const cipherHUD = document.getElementById('hud-cipher-info');
    if (cipherHUD) {
      const cleanSymbols = realKeySymbols.map(s => formatFunctionalKeyName(s));
      cipherHUD.textContent = `REQUIRED: ${cleanSymbols.join(' + ')}`;
      cipherHUD.style.color = '#38bdf8';
    }
    
    renderCarriedKeysHUD();
    updateGateHUD();
    checkWinCondition();
  });

  // Keypad failure penalty trigger
  socketClient.on('cipher_failed_penalty', ({ cooldownSeconds = 30, revealSeconds = 10 }) => {
    window.securityLockoutActive = true;
    window.securityLockoutEndTime = performance.now() + (cooldownSeconds * 1000);
    triggerAlarmFlashing();
    playWrongCodeAnimation();
    triggerNotification(`Terminal lockout active (${cooldownSeconds}s) | Outlines exposed (${revealSeconds}s)`);

    if (window._securityLockoutTimer) clearTimeout(window._securityLockoutTimer);
    window._securityLockoutTimer = setTimeout(() => {
      if (window.securityLockoutActive) {
        window.securityLockoutActive = false;
        triggerNotification('Terminal lockout ended. Keypad ready.');
      }
    }, cooldownSeconds * 1000);
  });

  socketClient.on('security_cooldown_ended', () => {
    if (window._securityLockoutTimer) clearTimeout(window._securityLockoutTimer);
    window.securityLockoutActive = false;
    triggerNotification('Terminal lockout ended. Keypad ready.');
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

  socketClient.on('player_revived_sync', ({ targetId, medicName, revivedName, position }) => {
    if (currentLobby && currentLobby.players && currentLobby.players[targetId]) {
      currentLobby.players[targetId].isCaptured = false;
      if (position) {
        currentLobby.players[targetId].x = position.x;
        currentLobby.players[targetId].y = position.y;
        currentLobby.players[targetId].z = position.z;
      }
    }

    // Resolve corpse location
    const corpseEntry = (typeof playerCorpses !== 'undefined') ? playerCorpses[targetId] : null;
    const spawnX = (position && position.x !== undefined) ? position.x : (corpseEntry && corpseEntry.position ? corpseEntry.position.x : 0);
    const spawnZ = (position && position.z !== undefined) ? position.z : (corpseEntry && corpseEntry.position ? corpseEntry.position.z : 0);

    // Remove the dead body from the 3D scene and clear corpse tracking
    if (typeof removeCorpse === 'function') {
      removeCorpse(targetId);
    }

    triggerNotification(`⚡ [${medicName}] revived Operative ${revivedName}!`);

    if (targetId === myId) {
      isCaptured = false;
      window.isSpectating = false;
      window.isCapturedAnimation = false;
      window.gameReady = true; // CRITICAL: Unfreeze controls, physics loop, and input processing!
      currentHP = 75;
      currentSanity = 75;
      isPanicked = false;
      panicTimer = 0;

      // Teleport local player camera directly over their dead body
      camera.position.set(spawnX, 1.6, spawnZ);
      velocity.set(0, 0, 0);
      direction.set(0, 0, 0);

      // Restore carry slots so player can hold items and pick up dropped gear
      if (!inventory || inventory.length === 0 || inventory.every(s => !s || s === '')) {
        inventory = ['', '', '', '', '', '', '', ''];
      }
      activeSlot = 0;
      renderHUDInventory();
      renderCarriedKeysHUD();
      updateEnvironmentLighting();
      
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
      const ghostCapOverlay = document.getElementById('ghost-capture-overlay');
      if (ghostCapOverlay) ghostCapOverlay.style.display = 'none';
      const endOverlay = document.getElementById('end-game-overlay');
      if (endOverlay) endOverlay.style.display = 'none';
      const hudOverlay = document.getElementById('hud-overlay');
      if (hudOverlay) hudOverlay.style.display = 'flex';

      if (!isMobileDevice) {
        if (window.requestGamePointerLock) {
          window.requestGamePointerLock();
        } else {
          (renderer && renderer.domElement || document.getElementById('canvas-container')).requestPointerLock();
        }
      } else {
        window.mobileGameActive = true;
        const mobileCtrl = document.getElementById('mobile-controls-container');
        if (mobileCtrl) mobileCtrl.style.display = 'flex';
      }

      // Immediately broadcast new position so all peers and server register local player alive and in-place
      if (socketClient) {
        socketClient.emit('player_move', {
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z }
        });
      }

      triggerNotification("⚡ REVIVED BY MEDIC! BACK IN THE ACTION!");
    } else {
      // Remote player revived: ensure their 3D model is active and positioned at their corpse
      if (players3D[targetId]) {
        players3D[targetId].visible = true;
        if (players3D[targetId].userData) {
          players3D[targetId].userData.isCaptured = false;
        }
        players3D[targetId].position.set(spawnX, 0, spawnZ);
      } else {
        const pSkinId = (currentLobby && currentLobby.players && currentLobby.players[targetId] && currentLobby.players[targetId].skinId) || null;
        const pUsername = (currentLobby && currentLobby.players && currentLobby.players[targetId] && currentLobby.players[targetId].username) || revivedName || 'Survivor';
        const isVipPlayer = Boolean(currentLobby && currentLobby.players && currentLobby.players[targetId] && currentLobby.players[targetId].isVip);
        const revivedMesh = createHumanMeshGroup(pSkinId, pUsername, isVipPlayer);
        revivedMesh.userData.id = targetId;
        revivedMesh.userData.isCaptured = false;
        revivedMesh.userData.type = 'Human';
        revivedMesh.position.set(spawnX, 0, spawnZ);
        scene.add(revivedMesh);
        players3D[targetId] = revivedMesh;
      }
    }
  });

  socketClient.on('player_panicked', ({ id, isPanicked: panickedState }) => {
    if (players3D[id]) {
      players3D[id].userData = players3D[id].userData || {};
      const isInv = (panickedState !== undefined ? panickedState : true);
      players3D[id].userData.isPanicked = isInv;
      players3D[id].traverse(c => {
        if ((c.isMesh || c.isSprite) && c.material) {
          c.material.transparent = true;
          c.material.opacity = isInv ? 0.15 : 1.0;
          c.material.depthWrite = !isInv;
          c.material.needsUpdate = true;
        }
      });
    }
  });

  socketClient.on('human_captured', (data) => {
    const { targetId, position, rotation, username, characterClass, skinId } = data || {};
    if (currentLobby && currentLobby.players && currentLobby.players[targetId]) {
      currentLobby.players[targetId].isCaptured = true;
    }
    if (targetId === myId) {
      if (!isCaptured) {
        isCaptured = true;
        const myUsername = username || (currentLobby && currentLobby.players[myId]?.username) || 'Operative';
        spawnDeadBody(camera.position, camera.rotation.y, myUsername, myClass, skinId, myId);
        onHumanKilled(myId, camera.position);
        playGhostCaptureAnimation(() => {
          const ptrOverlay = document.getElementById('pointer-lock-overlay');
          if (ptrOverlay) ptrOverlay.style.display = 'none';
          if (document.pointerLockElement) document.exitPointerLock();
          window.mobileGameActive = false;
          window.gameReady = false;
          document.getElementById('hud-overlay').style.display = 'none';
          const mobileCtrl = document.getElementById('mobile-controls-container');
          if (mobileCtrl) mobileCtrl.style.display = 'none';
          const otherLivingHumans = Object.values((currentLobby && currentLobby.players) || {}).filter(p => p.id !== myId && p.team === 'Human' && !p.isCaptured);
          if (window.isSoloMatch || otherLivingHumans.length === 0) {
            showSoloDeathEndScreen();
          } else {
            const capOverlay = document.getElementById('captured-overlay');
            if (capOverlay) capOverlay.style.display = 'flex';
          }
        });
      }
    } else {
      const spawnPos = position || (players3D[targetId] && players3D[targetId].position);
      const spawnRot = rotation || (players3D[targetId] && players3D[targetId].rotation.y) || 0;
      const targetUser = username || (currentLobby && currentLobby.players[targetId]?.username) || 'Operative';
      const targetClass = characterClass || (currentLobby && currentLobby.players[targetId]?.characterClass) || 'Survivor';
      if (spawnPos) {
        spawnDeadBody(spawnPos, spawnRot, targetUser, targetClass, skinId, targetId);
        onHumanKilled(targetId, spawnPos);
      }
      if (players3D[targetId]) {
        scene.remove(players3D[targetId]);
        delete players3D[targetId];
      }
    }
  });

  socketClient.on('human_damaged', ({ targetId, amount, attackerId }) => {
    if (targetId === myId && myTeam === 'Human' && !isCaptured && !window.isSpectating) {
      const dmg = amount || 35;
      currentHP = Math.max(0, currentHP - dmg);
      const hpVal = document.getElementById('hp-value');
      const hpBar = document.getElementById('hp-bar');
      if (hpVal) hpVal.textContent = `${Math.ceil(currentHP)} HP`;
      if (hpBar) hpBar.style.width = `${currentHP}%`;
      triggerNotification(`⚠️ Struck by Ghost Claws! (-${dmg} HP)`);

      const vig = document.getElementById('damage-vignette') || document.getElementById('vignette-overlay');
      if (vig) {
        vig.style.boxShadow = 'inset 0 0 80px rgba(239, 68, 68, 0.9)';
        setTimeout(() => { if (vig) vig.style.boxShadow = ''; }, 300);
      }

      if (currentHP <= 0 && !isCaptured) {
        triggerLocalPlayerCapture();
      }
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
      
      // Spawn human mesh in its place (Mech or Hazmat, never default!)
      let pSkinId = currentLobby && currentLobby.players[id] ? currentLobby.players[id].skinId : null;
      if (!pSkinId || pSkinId === 'skin_default' || pSkinId === 'skin_ghost' || pSkinId === 'skin_rogue') {
        pSkinId = Math.random() < 0.5 ? 'skin_soldier' : 'skin_hazmat';
      }
      const pUsername = currentLobby && currentLobby.players[id] ? currentLobby.players[id].username : 'Operative';
      const humanMesh = createHumanMeshGroup(pSkinId, pUsername);
      humanMesh.position.copy(originalPosition);
      humanMesh.rotation.copy(originalRotation);
      humanMesh.userData.isGhost = true; // Ensure proximity damage identifies them as hostile ghost even in disguise!
      humanMesh.userData.isMimicDisguised = true;
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
      }, getGhostAbilityParams().cloneDuration);
    }
  });

  socketClient.on('ghost_breaker_siphon', (data) => {
    if (myTeam === 'Human' && !window.isSpectating) {
      const gParams = getGhostAbilityParams();
      const effectRadius = gParams.siphonRadius;
      let applyEffect = true;
      if (data && data.position) {
        const dist = Math.hypot(camera.position.x - data.position.x, camera.position.z - data.position.z);
        if (dist > effectRadius) applyEffect = false;
      }
      
      if (applyEffect) {
        window.flashlightDisabledBySiphon = true;
        triggerNotification(`Breaker Siphon! Flashlights disrupted (${Math.round(gParams.siphonDuration / 1000)}s)`);
        setTimeout(() => {
          window.flashlightDisabledBySiphon = false;
        }, gParams.siphonDuration);
      }
    }
  });

  socketClient.on('ghost_sound_scramble', (data) => {
    if (myTeam === 'Human' && !window.isSpectating) {
      const gParams = getGhostAbilityParams();
      const effectRadius = gParams.scrambleRadius;
      let applyEffect = true;
      if (data && data.position) {
        const dist = Math.hypot(camera.position.x - data.position.x, camera.position.z - data.position.z);
        if (dist > effectRadius) applyEffect = false;
      }

      if (applyEffect) {
        window.sensorsScrambled = true;
        triggerNotification(`Signal scrambled! Sensors offline (${Math.round(gParams.scrambleDuration / 1000)}s)`);
        setTimeout(() => {
          window.sensorsScrambled = false;
        }, gParams.scrambleDuration);
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
    // Hide pause/resume overlay immediately so it never leaks onto the end flow
    const ptrOverlay = document.getElementById('pointer-lock-overlay');
    if (ptrOverlay) ptrOverlay.style.display = 'none';
    if (document.pointerLockElement) document.exitPointerLock();
    window.mobileGameActive = false;
    window.gameReady = false;
    isCaptured = true;

    const renderOverlay = () => {
      // Hide active in-game overlays so they never overlap with the end screen
      if (ptrOverlay) ptrOverlay.style.display = 'none';
      const capOverlay = document.getElementById('captured-overlay');
      if (capOverlay) capOverlay.style.display = 'none';
      const hud = document.getElementById('hud-overlay');
      if (hud) hud.style.display = 'none';
      const mobileCtrl = document.getElementById('mobile-controls-container');
      if (mobileCtrl) mobileCtrl.style.display = 'none';
      const specHud = document.getElementById('spectator-hud');
      if (specHud) specHud.style.display = 'none';

      // Show the End Game Overlay
      const overlay = document.getElementById('end-game-overlay');
      const title = document.getElementById('end-game-title');
      const details = document.getElementById('end-game-details');
      const retryBtn = document.getElementById('end-game-retry-btn');
      const lobbyBtn = document.getElementById('end-game-lobby-btn');

      if (overlay && title && details) {
        overlay.style.display = 'flex';

        const otherLivingHumans = Object.values((currentLobby && currentLobby.players) || {}).filter(p => p.id !== myId && p.team === 'Human' && !p.isCaptured);
        const isSoloGame = window.isSoloMatch || otherLivingHumans.length === 0;
        if (isSoloGame) {
          // SOLO MODE END GAME FLOW
          const isEscapeWin = (winner === 'Human' || window.isEscaping);
          if (isEscapeWin) {
            const rewardInfo = awardMatchWinCredits();
            title.textContent = "ESCAPED!";
            title.style.color = "#10b981";
            title.style.textShadow = "0 0 25px rgba(16, 185, 129, 0.8)";
            details.innerHTML = `
              <div style="font-weight:bold; color: #10b981; margin-bottom: 0.8rem; font-size: 1.3rem;">EXTRACTION SUCCESSFUL</div>
              <p style="color: #cbd5e1; font-size: 0.95rem; line-height: 1.5;">You cracked the master vault cipher, outsmarted the entities, and extracted through the Master Gate!</p>
              <div style="margin-top: 1rem; padding: 0.6rem; background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 8px; color: #6ee7b7; font-weight: bold; font-size: 0.9rem;">
                ${rewardInfo.rewardTitle}<br>
                <span style="font-size: 0.8rem; font-weight: normal; color: #94a3b8;">${rewardInfo.rewardSub}</span>
              </div>
            `;
          } else {
            title.textContent = "YOU DIED";
            title.style.color = "#ef4444";
            title.style.textShadow = "0 0 30px rgba(239, 68, 68, 0.9)";
            details.innerHTML = `<div style="font-weight:bold; color: #ef4444; margin-bottom: 0.8rem; font-size: 1.3rem;">CONSUMED BY THE VOID</div><p style="color: #cbd5e1; font-size: 0.95rem; line-height: 1.5;">You were dragged into the darkness before completing the extraction sequence.</p>`;
          }

          if (retryBtn) {
            retryBtn.style.display = 'inline-block';
            addFastTapListener(retryBtn, () => {
              sessionStorage.setItem('rejoinRetrySolo', 'true');
              sessionStorage.setItem('rejoinIsSolo', 'true');
              if (window.leaveGameWithAd) {
                window.leaveGameWithAd(() => window.location.reload());
              } else {
                window.location.reload();
              }
            });
          }

          if (lobbyBtn) {
            lobbyBtn.textContent = 'Main Menu';
            addFastTapListener(lobbyBtn, () => {
              sessionStorage.removeItem('rejoinLobbyId');
              sessionStorage.removeItem('rejoinUsername');
              sessionStorage.removeItem('rejoinIsPublic');
              sessionStorage.removeItem('rejoinIsSolo');
              sessionStorage.removeItem('rejoinRetrySolo');
              if (window.leaveGameWithAd) {
                window.leaveGameWithAd(() => window.location.reload());
              } else {
                window.location.reload();
              }
            });
          }
        } else {
          // MULTIPLAYER MODE END GAME FLOW
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
          if (Array.isArray(summary)) {
            summary.forEach(p => {
              const teamColor = p.team === 'Ghost' ? '#a855f7' : '#3b82f6';
              const statusText = p.team === 'Ghost' ? 'Spectral Threat' : (p.isCaptured ? 'Captured' : 'Escaped');
              const statusColor = p.team === 'Ghost' ? '#a855f7' : (p.isCaptured ? '#ef4444' : '#10b981');
              summaryHTML += `<div style="display:flex; justify-content:space-between; margin-bottom:0.4rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom:0.2rem;">
                <span style="font-weight: bold; color: ${teamColor};">${p.username}</span> 
                <span style="font-weight: bold; color: ${statusColor};">${statusText.toUpperCase()}</span>
              </div>`;
            });
          }
          summaryHTML += `</div>`;
          details.innerHTML += summaryHTML;

          if (retryBtn) retryBtn.style.display = 'none';
          if (lobbyBtn) {
            lobbyBtn.textContent = 'Return to Lobby';
          }
          bindRejoinBtn('end-game-lobby-btn');
        }
      }
    };

    const bindRejoinBtn = (btnId) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        addFastTapListener(btn, () => {
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
          if (window.leaveGameWithAd) {
            window.leaveGameWithAd(() => window.location.reload());
          } else {
            window.location.reload();
          }
        });
      }
    };

    bindRejoinBtn('end-game-lobby-btn');
    bindRejoinBtn('captured-lobby-btn');

    const capturedQuitBtn = document.getElementById('captured-quit-btn');
    if (capturedQuitBtn) {
      addFastTapListener(capturedQuitBtn, () => {
        sessionStorage.clear();
        if (window.leaveGameWithAd) {
          window.leaveGameWithAd(() => window.location.reload());
        } else {
          window.location.reload();
        }
      });
    }

    if (window.isEscaping) {
      setTimeout(renderOverlay, 3500);
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

    const preservedId = data.id || ('key_' + data.symbol);
    discoveredKeyIds.add(preservedId);

    keysInMaze.push({
      id: preservedId,
      mesh: mesh,
      symbol: data.symbol,
      typeName: data.typeName,
      isDropped: true
    });
  });

  socketClient.on('item_picked_up_sync', ({ id }) => {
    // Teammate picked up an item, remove it locally
    const index = itemsInMaze.findIndex(item => item.id === id);
    if (index !== -1) {
      const itemMesh = itemsInMaze[index].mesh;
      disposeItemMesh(itemMesh);
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
  const path = bfsPath(startGrid.col, startGrid.row, endGrid.col, endGrid.row, false);
  
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

function revertMimicDisguise(ghost) {
  if (!ghost || !ghost.userData) return;
  if (ghost.userData.mimicGroup) {
    const mg = ghost.userData.mimicGroup;
    if (mg.userData && mg.userData.animMixer) {
      const idx = activeAnimationMixers.indexOf(mg.userData.animMixer);
      if (idx !== -1) activeAnimationMixers.splice(idx, 1);
    }
    ghost.remove(mg);
    mg.traverse(child => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      } else if (child.isSprite) {
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      }
    });
    ghost.userData.mimicGroup = null;
  }
  ghost.userData.isMimicDisguised = false;
  ghost.userData.mimicDurationTimer = 0;
  ghost.children.forEach(c => { c.visible = true; });
}

function freezeGhosts() {
  window.ghostsFrozen = true;
  ghostsFrozenRemaining = 10.0;
  ghosts3D.forEach(g => {
    g.children.forEach(c => { if (c.isPointLight) c.intensity = 0; });
  });
  triggerNotification("breaker remote used. ghosts frozen (10s).");
}

function triggerAlarmFlashing() {
  const flash = document.getElementById('alarm-flash');
  if (flash) flash.style.display = 'block';
  alarmFlashRemaining = 10.0;
}

let notificationTimeout = null;
function triggerNotification(text) {
  const box = document.getElementById('game-notification');
  if (!box) return;
  box.textContent = text.toUpperCase();
  box.style.display = 'block';
  
  if (notificationTimeout) clearTimeout(notificationTimeout);
  notificationTimeout = setTimeout(() => {
    box.style.display = 'none';
  }, 2800);
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
  window.isEscaping = true;

  // Suppress pointer lock and pause overlay immediately
  if (document.pointerLockElement) {
    document.exitPointerLock();
  }
  const ptrOverlay = document.getElementById('pointer-lock-overlay');
  if (ptrOverlay) ptrOverlay.style.display = 'none';

  // Hide the giant dungeon ceiling and floor so they do not clip the outdoor forest or block the sky
  if (ceilingMesh) ceilingMesh.visible = false;
  if (floorMesh) floorMesh.visible = false;

  // Hide in-game HUD and center reticle during cinematic
  const hud = document.getElementById('hud-overlay');
  if (hud) hud.style.display = 'none';
  const reticle = document.getElementById('crosshair') || document.getElementById('reticle');
  if (reticle) reticle.style.display = 'none';

  // Instantly establish outdoor sunny sky and soft horizon fog
  if (scene) {
    scene.background = new THREE.Color(0x6bb5ea); // Clear azure blue sky!
    if (scene.fog) {
      scene.fog.color.setHex(0x9fd2ee); // Soft atmospheric aerial horizon mist
      scene.fog.density = 0.0035; // Expansive outdoor sightlines
    }
  }

  // Dismiss any open modals so the cinematic viewport is completely unobstructed
  const keypadEl = document.getElementById('keypad-modal-ui');
  if (keypadEl) keypadEl.style.display = 'none';
  if (isMinimapExpanded) {
    isMinimapExpanded = false;
    const mapWrap = document.getElementById('minimap-wrapper');
    const mapCtrl = document.getElementById('minimap-expanded-controls');
    const topCls = document.getElementById('minimap-top-close-btn');
    const ttlTxt = document.getElementById('minimap-title-text');
    const bkdrop = document.getElementById('minimap-modal-backdrop');
    if (mapWrap) mapWrap.classList.remove('expanded');
    if (mapCtrl) mapCtrl.style.display = 'none';
    if (topCls) topCls.style.display = 'none';
    if (bkdrop) bkdrop.style.display = 'none';
    if (ttlTxt) ttlTxt.textContent = 'MINIMAP (Press M / Tap)';
  }

  const overlay = document.getElementById('escape-cinematic-overlay');
  const lbTop = document.getElementById('escape-letterbox-top');
  const lbBottom = document.getElementById('escape-letterbox-bottom');
  const flash = document.getElementById('escape-flash');
  const escText = document.getElementById('escape-text');
  if (!overlay) { if (callback) callback(); return; }

  overlay.style.display = 'block';

  // Force clean first-person camera mode for cinematic presentation
  currentViewIndex = 0;
  if (activeViewCamera) {
    scene.remove(activeViewCamera);
    activeViewCamera = null;
  }
  if (localPlayerVisual) {
    localPlayerVisual.visible = false;
  }

  // Phase 1: Letterbox bars slide in (cinematic framing)
  lbTop.style.transition = 'top 0.4s ease';
  lbBottom.style.transition = 'bottom 0.4s ease';
  setTimeout(() => {
    lbTop.style.top = '0';
    lbBottom.style.bottom = '0';
  }, 50);

  // Position camera directly in front of the vault door facing straight at it
  let startLocalZ = 2.4;
  if (vaultGroupRef) {
    const currentLocal = vaultGroupRef.worldToLocal(camera.position.clone());
    // Don't snap the player backwards if they are already standing close to the gate
    startLocalZ = Math.min(2.4, Math.max(1.2, currentLocal.z));
    const camStart = vaultGroupRef.localToWorld(new THREE.Vector3(0, 1.65, startLocalZ));
    const camLookAt = vaultGroupRef.localToWorld(new THREE.Vector3(0, 1.85, -18.0));
    camera.position.copy(camStart);
    camera.lookAt(camLookAt);
  }

  // Phase 2: Reveal 3D Forest & Atmospheric Horizon
  if (forestSceneInstance) {
    forestSceneInstance.visible = true;
    if (forestSceneInstance.userData.outdoorSun) forestSceneInstance.userData.outdoorSun.visible = true;
    if (forestSceneInstance.userData.skyHemisphere) forestSceneInstance.userData.skyHemisphere.visible = true;
  }

  // Atmospheric transition: dark dungeon fog opens into crisp, expansive outdoor forest air and vibrant sky
  if (scene) {
    scene.background = new THREE.Color(0x6bb5ea); // Clear azure blue sky!
    if (scene.fog) {
      scene.fog.color.setHex(0x9fd2ee); // Soft atmospheric aerial horizon mist
      scene.fog.density = 0.005; // Expansive outdoor sightlines
    }
  }
  if (ambientLight) {
    ambientLight.intensity = Math.max(ambientLight.intensity, 2.2);
  }

  // Gate opens — slide the heavy door mesh up dynamically over 1100ms
  if (gateMeshRef) {
    const startY = gateMeshRef.position.y;
    const targetY = startY + 5.2;
    const startTime = performance.now();
    const duration = 1100;
    
    const animateGate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      gateMeshRef.position.y = startY + (targetY - startY) * eased;

      // Rumble effect during opening
      if (progress < 1) {
        const rumble = (1 - progress) * 2.0;
        const rX = (Math.random() - 0.5) * rumble;
        const rY = (Math.random() - 0.5) * rumble;
        document.getElementById('canvas-container').style.transform = `translate(${rX}px, ${rY}px)`;
        requestAnimationFrame(animateGate);
      } else {
        document.getElementById('canvas-container').style.transform = '';
      }
    };
    requestAnimationFrame(animateGate);

    // Remove the collision blocker immediately so the camera glides through seamlessly
    if (gateBlockerRef) {
      const idx = walls.indexOf(gateBlockerRef);
      if (idx !== -1) walls.splice(idx, 1);
      scene.remove(gateBlockerRef);
    }
  }

  // Phase 3: Immediate forward momentum — camera steps forward under the rising gate directly into the 3D Forest!
  setTimeout(() => {
    const walkDuration = 2200;
    const walkStart = performance.now();

    const walkAnim = (now) => {
      const elapsed = now - walkStart;
      const progress = Math.min(elapsed / walkDuration, 1);
      // Confident, smooth forward stride into the open sunlight
      const eased = 1 - Math.pow(1 - progress, 2.5);

      if (vaultGroupRef) {
        // Walk from startLocalZ through doorway threshold out towards the sunlit white pavilion
        const localZ = startLocalZ + (-6.5 - startLocalZ) * eased;
        const localY = 1.65 + Math.sin(progress * Math.PI * 4.0) * 0.04; // Gentle natural footsteps
        const localCamPos = new THREE.Vector3(0, localY, localZ);
        
        // Look ahead and frame the majestic white marble sitting rotunda and pine trees
        const lookZ = -18.0;
        const lookY = 1.95 + eased * 0.15;
        const localLookTarget = new THREE.Vector3(0, lookY, lookZ);

        camera.position.copy(vaultGroupRef.localToWorld(localCamPos));
        camera.lookAt(vaultGroupRef.localToWorld(localLookTarget));
      }

      if (progress < 1) requestAnimationFrame(walkAnim);
    };
    requestAnimationFrame(walkAnim);
  }, 150);

  // Phase 4: Soft warm sunlight flare at 1.0s as player crosses into the outdoor glade
  setTimeout(() => {
    flash.style.background = 'radial-gradient(circle, rgba(255,250,225,0.45) 0%, rgba(255,255,255,0.15) 70%, transparent 100%)';
    flash.style.opacity = '0.45';
    setTimeout(() => {
      flash.style.transition = 'opacity 1.0s ease';
      flash.style.opacity = '0.08';
    }, 300);
  }, 1000);

  // Phase 5: "ESCAPED" & "YOU EMERGED INTO THE FOREST" text appears at 1.2s
  setTimeout(() => {
    escText.style.transition = 'opacity 0.6s ease, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
    escText.style.opacity = '1';
    escText.style.transform = 'translate(-50%, -50%) scale(1)';
  }, 1200);

  // Phase 6: Clean up and show end screen at 3.4s
  setTimeout(() => {
    overlay.style.display = 'none';
    lbTop.style.top = '-15%';
    lbBottom.style.bottom = '-15%';
    flash.style.opacity = '0';
    escText.style.opacity = '0';
    if (callback) callback();
  }, 3400);
}

// ==========================================
// CINEMATIC ANIMATION: GHOST CAPTURE
// ==========================================
function playGhostCaptureAnimation(callback) {
  window.isCapturedAnimation = true;
  const ptrOverlay = document.getElementById('pointer-lock-overlay');
  if (ptrOverlay) ptrOverlay.style.display = 'none';

  // Dismiss in-game interactive modals so the capture jumpscare and cinematic are fully visible
  if (typeof keypadUI !== 'undefined' && keypadUI) {
    keypadUI.style.display = 'none';
    codeEntered = '';
  }
  if (isMinimapExpanded) {
    isMinimapExpanded = false;
    const mapWrap = document.getElementById('minimap-wrapper');
    const mapCtrl = document.getElementById('minimap-expanded-controls');
    const topCls = document.getElementById('minimap-top-close-btn');
    const ttlTxt = document.getElementById('minimap-title-text');
    const bkdrop = document.getElementById('minimap-modal-backdrop');
    if (mapWrap) mapWrap.classList.remove('expanded');
    if (mapCtrl) mapCtrl.style.display = 'none';
    if (topCls) topCls.style.display = 'none';
    if (bkdrop) bkdrop.style.display = 'none';
    if (ttlTxt) ttlTxt.textContent = 'MINIMAP (Press M / Tap)';
  }

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
    window.isCapturedAnimation = false;
    const ptrOverlay = document.getElementById('pointer-lock-overlay');
    if (ptrOverlay) ptrOverlay.style.display = 'none';
    if (callback) callback();
  }, 3000);
}

function setHumanLocomotionAction(humanGroup, targetActionName, crossfadeDuration = 0.15, playbackRate = 1.0) {
  if (!humanGroup || !humanGroup.userData) return;
  const mixer = humanGroup.userData.animMixer;
  if (!mixer) return;

  if (!humanGroup.userData.animActions) {
    humanGroup.userData.animActions = {};
  }
  const actions = humanGroup.userData.animActions;

  // On-demand action instantiation if clip finished loading after mesh creation
  const getClipForSkin = (name) => {
    return (humanGroup.userData.skinId === 'skin_soldier')
      ? getSoldierLocomotionClip(name)
      : humanAnimClips[name];
  };

  if (!actions[targetActionName]) {
    const targetClip = getClipForSkin(targetActionName);
    if (targetClip) {
      actions[targetActionName] = mixer.clipAction(targetClip);
    }
  }
  if (!actions.idle) {
    const idleClip = getClipForSkin('idle');
    if (idleClip) {
      actions.idle = mixer.clipAction(idleClip);
    }
  }

  const currentActionName = humanGroup.userData.currentAction || 'idle';
  const targetAction = actions[targetActionName] || actions.idle;
  if (!targetAction) return;

  const currentAction = actions[currentActionName] || actions.idle;
  const isSoldier = (humanGroup.userData.skinId === 'skin_soldier');
  let desiredTimeScale = (targetActionName === 'idle') ? 1.0 : playbackRate;
  if (isSoldier && targetActionName === 'walkBack') {
    desiredTimeScale = -Math.abs(desiredTimeScale);
  }

  // If already playing the EXACT same AnimationAction instance, do not reset or crossfade
  if (currentAction === targetAction) {
    if (Math.abs(targetAction.getEffectiveTimeScale() - desiredTimeScale) > 0.02) {
      targetAction.setEffectiveTimeScale(desiredTimeScale);
    }
    if (!targetAction.isRunning()) {
      targetAction.play();
    }
    humanGroup.userData.currentAction = targetActionName;
    return;
  }

  if (currentActionName !== targetActionName || !targetAction.isRunning()) {
    targetAction.enabled = true;
    targetAction.setEffectiveTimeScale(desiredTimeScale);
    targetAction.setEffectiveWeight(1.0);

    if (currentAction && currentAction.isRunning()) {
      currentAction.crossFadeTo(targetAction, crossfadeDuration, false);
    } else {
      targetAction.fadeIn(crossfadeDuration);
    }
    targetAction.play();

    // Safely fade out any other running actions (avoiding duplicate action references)
    const keepActions = new Set([targetAction, currentAction]);
    Object.values(actions).forEach(act => {
      if (act && !keepActions.has(act) && act.isRunning()) {
        act.fadeOut(crossfadeDuration);
        keepActions.add(act);
      }
    });

    humanGroup.userData.currentAction = targetActionName;
  }
}

function createHumanMeshGroup(skinId, username, isVip) {
  const group = new THREE.Group();
  let effectiveSkin = skinId;
  if (!effectiveSkin || effectiveSkin === 'skin_ghost' || effectiveSkin === 'skin_rogue') {
    effectiveSkin = (localStorage.getItem('manifestation_equipped_skin') || 'skin_hazmat');
    if (effectiveSkin === 'skin_rogue') effectiveSkin = 'skin_hazmat';
  }
  const vipActive = isVip !== undefined ? Boolean(isVip) : (window.isVipActive ? window.isVipActive() : false);
  group.userData = group.userData || {};
  group.userData.type = 'Human';
  group.userData.skinId = effectiveSkin;
  group.userData.username = username || '';
  group.userData.walkCycle = 0;
  group.userData.lastPosition = new THREE.Vector3();
  group.userData.isVip = vipActive;
  
  if (effectiveSkin === 'skin_default') {
    loadHumanGLBAsset();
    if (preloadedHumanModel) {
      const clone = SkeletonUtils.clone(preloadedHumanModel);
      clone.rotation.y = Math.PI; // Face forward direction
      group.add(clone);
    } else {
      // Fallback sprite until 9.5MB human_model.glb loads
      const spriteMat = new THREE.SpriteMaterial({ 
        map: getLoadedTexture('/assets/human_sprite.png'), 
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
    }
  } else if (effectiveSkin === 'skin_hazmat') {
    loadHazmatFBXAssets();
    if (preloadedHumanFBX) {
      const clone = SkeletonUtils.clone(preloadedHumanFBX);
      applyHazmatMaterials(clone);
      group.add(clone);

      // Setup full 8-directional locomotion animation mixer & actions
      const mixer = new THREE.AnimationMixer(clone);
      const actions = {};

      Object.keys(humanAnimClips).forEach(key => {
        const clip = humanAnimClips[key];
        if (clip) {
          actions[key] = mixer.clipAction(clip);
        }
      });

      if (actions.idle) {
        actions.idle.play();
      } else if (preloadedHumanFBX.animations && preloadedHumanFBX.animations.length > 0) {
        const act = mixer.clipAction(preloadedHumanFBX.animations[0]);
        act.play();
        actions.idle = act;
      }

      activeAnimationMixers.push(mixer);
      group.userData.animMixer = mixer;
      group.userData.animActions = actions;
      group.userData.currentAction = 'idle';
    } else {
      const spriteMat = new THREE.SpriteMaterial({ 
        map: getLoadedTexture('/assets/human_sprite.png'), 
        color: 0xf59e0b,
        fog: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(1.2, 1.2, 1);
      sprite.position.y = 0.8;
      group.add(sprite);
    }
  } else if (effectiveSkin === 'skin_soldier') {
    loadSoldierAsset();
    if (preloadedSoldierModel) {
      const clone = SkeletonUtils.clone(preloadedSoldierModel);
      group.add(clone);

      const mixer = new THREE.AnimationMixer(clone);
      const actions = {};

      ['idle', 'walk', 'sprint', 'walkBack', 'strafeLeft', 'strafeRight'].forEach(key => {
        const clip = getSoldierLocomotionClip(key);
        if (clip) {
          actions[key] = mixer.clipAction(clip);
        }
      });

      if (actions.idle) {
        actions.idle.play();
      }

      activeAnimationMixers.push(mixer);
      group.userData.animMixer = mixer;
      group.userData.animActions = actions;
      group.userData.currentAction = 'idle';
    } else {
      const spriteMat = new THREE.SpriteMaterial({ 
        map: getLoadedTexture('/assets/human_sprite.png'), 
        color: 0x38bdf8,
        fog: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(1.2, 1.2, 1);
      sprite.position.y = 0.8;
      group.add(sprite);
    }
  } else {
    const spriteMat = new THREE.SpriteMaterial({ 
      map: getLoadedTexture('/assets/human_sprite.png'), 
      color: 0xffffff,
      fog: true,
      transparent: true,
      alphaTest: 0.05,
      blending: THREE.NormalBlending,
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
    ctx.fillStyle = vipActive ? '#fde047' : '#10b981'; // Gold for VIP, cyber green for standard
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tagText = vipActive ? `⭐ ${username}` : username;
    ctx.fillText(tagText, canvas.width/2, canvas.height/2 + 2);
    
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false });
    const textSprite = new THREE.Sprite(mat);
    textSprite.scale.set(1.5, 0.375, 1);
    textSprite.position.y = 2.8; // Place it well above the head
    textSprite.userData = { isUsernameTag: true };
    
    // We add it to the group, but ThreeJS sprites always face the camera automatically
    group.add(textSprite);
  }


  // Keep userData compatible with the animation loop – MERGE, don't overwrite (preserve animMixer/animActions)
  group.userData.type = 'Human';
  group.userData.walkCycle = group.userData.walkCycle || 0;
  if (!group.userData.leftLeg) group.userData.leftLeg = { rotation: {x:0} };
  if (!group.userData.rightLeg) group.userData.rightLeg = { rotation: {x:0} };
  if (!group.userData.leftArm) group.userData.leftArm = { rotation: {x:0} };
  if (!group.userData.rightArm) group.userData.rightArm = { rotation: {x:0} };
  if (!group.userData.lastPosition) group.userData.lastPosition = new THREE.Vector3();
  
  const glowPref = window.isVipGlowEnabled ? window.isVipGlowEnabled() : true;
  if (vipActive && glowPref) {
    applyVipGlow(group, true);
  }

  return group;
}

export function removeCorpse(targetId) {
  if (!targetId || !playerCorpses[targetId]) return;
  const entry = playerCorpses[targetId];
  if (entry && entry.mesh) {
    if (scene) scene.remove(entry.mesh);
    const idx = deadBodies.indexOf(entry.mesh);
    if (idx !== -1) deadBodies.splice(idx, 1);
    entry.mesh.traverse(child => {
      if (child.isMesh || child.isSprite || child.isPoints) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      }
    });
  }
  delete playerCorpses[targetId];
}

export function spawnDeadBody(position, rotationY = 0, username = 'Operative', characterClass = 'Survivor', skinId = null, targetId = null) {
  if (!scene || !position) return null;

  if (targetId) {
    removeCorpse(targetId);
  }

  const corpseGroup = new THREE.Group();
  const posX = (position.x !== undefined) ? position.x : 0;
  const posY = 0.04;
  const posZ = (position.z !== undefined) ? position.z : 0;
  corpseGroup.position.set(posX, posY, posZ);
  corpseGroup.userData.targetId = targetId;
  corpseGroup.userData.position = { x: posX, y: posY, z: posZ };
  corpseGroup.userData.username = username;
  corpseGroup.userData.characterClass = characterClass;

  // 1. Dark Blood Pool / Void Corruption Decal on floor
  const poolGeo = new THREE.CircleGeometry(0.85, 24);
  const poolMat = new THREE.MeshStandardMaterial({
    color: 0x450a0a, // Deep blood crimson / void residue
    roughness: 0.15,
    metalness: 0.2,
    transparent: true,
    opacity: 0.88,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
  const poolMesh = new THREE.Mesh(poolGeo, poolMat);
  poolMesh.rotation.x = -Math.PI / 2;
  poolMesh.position.y = 0.01;
  corpseGroup.add(poolMesh);

  // 2. 3D Body Mesh lying on the floor
  if (preloadedHumanModel) {
    try {
      const clone = SkeletonUtils.clone(preloadedHumanModel);
      clone.rotation.x = -Math.PI / 2; // Lie flat on back
      clone.rotation.z = rotationY || 0;
      clone.position.set(0, 0.1, 0);
      clone.scale.set(1, 1, 1);
      clone.traverse(c => {
        if (c.isMesh && c.material) {
          c.material = c.material.clone();
          c.material.color.multiplyScalar(0.45); // Darken deceased player
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      corpseGroup.add(clone);
    } catch(e) {
      console.warn('Failed to clone preloaded model for corpse:', e);
      addProceduralCorpse(corpseGroup, rotationY);
    }
  } else {
    addProceduralCorpse(corpseGroup, rotationY);
  }

  // 3. Floating Deceased Nameplate
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(15, 5, 5, 0.7)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = '#ef4444';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`☠ ${username} (K.I.A.)`, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  const textMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false });
  const textSprite = new THREE.Sprite(textMat);
  textSprite.scale.set(1.4, 0.35, 1);
  textSprite.position.set(0, 0.75, 0);
  corpseGroup.add(textSprite);

  // 4. Subtle eerie purple spirit dissipation smoke
  const particleGeo = new THREE.BufferGeometry();
  const particleCount = 25;
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 0.8;
    positions[i * 3 + 1] = Math.random() * 0.9;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
  }
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: 0xa855f7,
    size: 0.07,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending
  });
  const smokePoints = new THREE.Points(particleGeo, particleMat);
  corpseGroup.add(smokePoints);

  scene.add(corpseGroup);
  deadBodies.push(corpseGroup);
  if (targetId) {
    playerCorpses[targetId] = {
      mesh: corpseGroup,
      position: { x: posX, y: posY, z: posZ },
      rotationY: rotationY,
      username: username
    };
  }
  return corpseGroup;
}

export function onHumanKilled(victimId, victimPos) {
  if (!victimPos) return;
  const vPos = (victimPos.isVector3) ? victimPos : new THREE.Vector3(victimPos.x, victimPos.y || 0, victimPos.z);

  // If ghost bots were chasing this victim, or are lingering within 16m of the corpse, force immediate disengagement & dispersal
  if (typeof ghosts3D !== 'undefined' && ghosts3D.length > 0) {
    ghosts3D.forEach((ghost, idx) => {
      const distToVictim = ghost.position.distanceTo(vPos);
      if (ghost.userData && (ghost.userData.chasedTargetId === victimId || distToVictim < 16.0)) {
        ghost.userData.aiState = 'WANDER';
        ghost.userData.chasedTargetId = null;
        ghost.userData.loseSightTimer = 0;
        ghost.userData.path = null;
        ghost.userData.pathIdx = 0;
        ghost.userData.pathTime = 0;

        // Immediately choose a distant patrol corridor cell (> 20m away) so the ghost vacates the area
        if (typeof openCorridors !== 'undefined' && openCorridors.length > 0) {
          const farCandidates = openCorridors.filter(c => {
            const d = Math.hypot(c.x - vPos.x, c.z - vPos.z);
            return d > 20.0;
          });
          const pool = farCandidates.length > 0 ? farCandidates : openCorridors;
          const seedInt = Math.floor(Math.random() * 100000);
          const farTarget = pool[seedInt % pool.length];
          ghost.userData.targetGrid = worldToGrid(farTarget.x, farTarget.z);
        } else {
          ghost.userData.targetGrid = null;
        }
      }
    });
  }
}

function addProceduralCorpse(group, rotationY) {
  const bodySubgroup = new THREE.Group();
  
  // Torso / Hazmat suit
  const torsoGeo = new THREE.BoxGeometry(0.5, 0.22, 0.8);
  const torsoMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.position.set(0, 0.11, 0);
  torso.castShadow = true;
  bodySubgroup.add(torso);

  // Head with helmet
  const headGeo = new THREE.SphereGeometry(0.18, 12, 12);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.3 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.set(0, 0.12, -0.55);
  bodySubgroup.add(head);

  // Visor
  const visorGeo = new THREE.BoxGeometry(0.18, 0.08, 0.08);
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.2, metalness: 0.8, emissive: 0x0284c7, emissiveIntensity: 0.2 });
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, 0.18, -0.55);
  bodySubgroup.add(visor);

  // Left & Right Arms sprawled
  const armGeo = new THREE.BoxGeometry(0.15, 0.12, 0.6);
  const armMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
  const leftArm = new THREE.Mesh(armGeo, armMat);
  leftArm.position.set(-0.35, 0.08, -0.1);
  leftArm.rotation.y = 0.4;
  bodySubgroup.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, armMat);
  rightArm.position.set(0.35, 0.08, -0.1);
  rightArm.rotation.y = -0.5;
  bodySubgroup.add(rightArm);

  // Left & Right Legs sprawled
  const legGeo = new THREE.BoxGeometry(0.18, 0.14, 0.7);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.18, 0.08, 0.65);
  leftLeg.rotation.y = -0.15;
  bodySubgroup.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.18, 0.08, 0.65);
  rightLeg.rotation.y = 0.25;
  bodySubgroup.add(rightLeg);

  bodySubgroup.rotation.y = rotationY || 0;
  group.add(bodySubgroup);
}

function createGhostMeshGroup(skinId) {
  const group = new THREE.Group();
  loadGhostGLBAsset();
  
  if (preloadedGhostModel) {
    const clone = SkeletonUtils.clone(preloadedGhostModel);
    const anchorGroup = new THREE.Group();
    anchorGroup.add(clone);
    group.add(anchorGroup);
  } else {
    // Fallback to sprite
    const spriteMat = new THREE.SpriteMaterial({ 
      map: getLoadedTexture('/assets/ghost_sprite.png'), 
      color: 0xffdddd, // slightly tint red
      fog: true,
      transparent: true,
      alphaTest: 0.05,
      opacity: 0.85,
      blending: THREE.AdditiveBlending, // Hides black background, makes ghost glow
      depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(3.0, 4.0, 1); // Massive imposing ghost
    sprite.position.y = 2.0;
    group.add(sprite);
  }

  // Eerie purple aura light — optimized single light with distance culling
  const aura = new THREE.PointLight(0x6b21a8, 1.8, 8.0);
  aura.position.y = 2.0;
  group.add(aura);

  group.userData = {
    type: 'Ghost',
    skinId: 'skin_ghost',
    bobAccumulator: Math.random() * 10,
    flickerTimer: Math.random() * 100,
    lastPosition: new THREE.Vector3(),
    auraLight: aura
  };
  
  return group;
}

function spawnGhostAIs(count) {
  ghosts3D.forEach(g => {
    scene.remove(g);
    g.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material.dispose();
      }
    });
  });
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

    // Spawn in deterministic open corridor cells away from Human Spawn (0, 0)
    let spawnPos = { x: 10, z: 10 };
    const candidates = openCorridors.filter(c => {
      // Deterministic distance relative to human spawn point (0, 0)
      const d = Math.sqrt(c.x * c.x + c.z * c.z);
      return d > 15 && d < 55;
    });
    if (candidates.length > 0) {
      spawnPos = candidates[Math.floor(seededRandom() * candidates.length)];
    }
    ghostGroup.position.set(spawnPos.x, 0, spawnPos.z);
    scene.add(ghostGroup);

    // Assign a randomized ghost class to vary AI behavior
    const AI_GHOST_TYPES = ['Stalker', 'Mimic', 'Juggernaut', 'Phantom', 'Poltergeist', 'Banshee'];
    ghostGroup.userData.ghostClass = AI_GHOST_TYPES[Math.floor(seededRandom() * AI_GHOST_TYPES.length)];
    ghosts3D.push(ghostGroup);
  }
}

// ==========================================
// CONTROLS & BUTTONS GUIDE MODAL
// ==========================================
let controlsGuideSetupDone = false;
export function setupControlsGuideModal() {
  const modal = document.getElementById('controls-guide-modal');
  const hudGuideBtn = document.getElementById('btn-controls-guide');
  const pauseGuideBtn = document.getElementById('pause-controls-btn');
  const closeBtn = document.getElementById('close-controls-modal-btn');
  const resumeBtn = document.getElementById('resume-from-controls-btn');
  const tabPc = document.getElementById('tab-controls-pc');
  const tabMobile = document.getElementById('tab-controls-mobile');
  const tabRules = document.getElementById('tab-controls-rules');
  const contentPc = document.getElementById('controls-content-pc');
  const contentMobile = document.getElementById('controls-content-mobile');
  const contentRules = document.getElementById('controls-content-rules');

  if (!modal) return;

  const showModal = (e, requestedTab) => {
    if (e && e.preventDefault) {
      if (e.stopPropagation) e.stopPropagation();
      e.preventDefault();
    }
    modal.style.display = 'flex';
    
    // Choose active tab based on requestedTab or device detection
    if (requestedTab === 'rules') {
      if (tabRules) tabRules.classList.add('active');
      if (tabPc) tabPc.classList.remove('active');
      if (tabMobile) tabMobile.classList.remove('active');
      if (contentRules) contentRules.style.display = 'block';
      if (contentPc) contentPc.style.display = 'none';
      if (contentMobile) contentMobile.style.display = 'none';
    } else if (isMobileDevice) {
      if (tabMobile) tabMobile.classList.add('active');
      if (tabPc) tabPc.classList.remove('active');
      if (tabRules) tabRules.classList.remove('active');
      if (contentMobile) contentMobile.style.display = 'block';
      if (contentPc) contentPc.style.display = 'none';
      if (contentRules) contentRules.style.display = 'none';
    } else {
      if (tabPc) tabPc.classList.add('active');
      if (tabMobile) tabMobile.classList.remove('active');
      if (tabRules) tabRules.classList.remove('active');
      if (contentPc) contentPc.style.display = 'block';
      if (contentMobile) contentMobile.style.display = 'none';
      if (contentRules) contentRules.style.display = 'none';
    }

    // Ariadne Protocol is developer-only: keep strictly hidden from public unless playing under dev callsign
    const ariadneRow = document.getElementById('ariadne-control-row');
    if (ariadneRow) {
      const uName = (localStorage.getItem('manifestation_username') || sessionStorage.getItem('rejoinUsername') || '').trim().toLowerCase();
      const isDev = Boolean(window.isAriadneDev || uName.includes('ariadne') || uName.includes('aridane'));
      ariadneRow.style.display = isDev ? 'flex' : 'none';
    }

    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch(err) {}
    }
  };

  const hideModal = (e) => {
    if (e) {
      if (e.stopPropagation) e.stopPropagation();
      if (e.preventDefault) e.preventDefault();
    }
    modal.style.display = 'none';
    const ptrOverlay = document.getElementById('pointer-lock-overlay');
    const isPaused = ptrOverlay && ptrOverlay.style.display === 'flex';
    if (!isMobileDevice && window.gameReady && !isCaptured && !isPaused && window.requestGamePointerLock) {
      window.requestGamePointerLock();
    }
  };

  window.openControlsGuideModal = (tab) => showModal(null, tab);
  window.closeControlsGuideModal = hideModal;

  if (!controlsGuideSetupDone) {
    controlsGuideSetupDone = true;

    const bindFastTap = (el, fn) => {
      if (!el) return;
      let lastT = 0;
      const handler = (e) => {
        if (e && e.cancelable && e.type === 'touchstart') e.preventDefault();
        const now = performance.now();
        if (now - lastT < 120) return;
        lastT = now;
        fn(e);
      };
      el.addEventListener('pointerdown', handler);
      el.addEventListener('click', handler);
      if ('ontouchstart' in window) {
        el.addEventListener('touchend', handler);
      }
    };

    if (hudGuideBtn) bindFastTap(hudGuideBtn, showModal);
    if (pauseGuideBtn) bindFastTap(pauseGuideBtn, showModal);
    if (closeBtn) bindFastTap(closeBtn, hideModal);
    if (resumeBtn) bindFastTap(resumeBtn, hideModal);

    // Backdrop click to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideModal(e);
    });

    // Escape key to close
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'Escape' || e.key === 'Esc') && modal.style.display !== 'none') {
        hideModal(e);
      }
    });

    const selectTab = (activeTab, activeContent) => {
      [tabPc, tabMobile, tabRules].forEach(t => { if (t) t.classList.remove('active'); });
      [contentPc, contentMobile, contentRules].forEach(c => { if (c) c.style.display = 'none'; });
      if (activeTab) activeTab.classList.add('active');
      if (activeContent) activeContent.style.display = 'block';
    };

    if (tabPc) bindFastTap(tabPc, () => selectTab(tabPc, contentPc));
    if (tabMobile) bindFastTap(tabMobile, () => selectTab(tabMobile, contentMobile));
    if (tabRules) bindFastTap(tabRules, () => selectTab(tabRules, contentRules));
  }
}

// Auto-run on initial script load so the modal works anytime from main menu or in-game
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupControlsGuideModal);
  } else {
    setupControlsGuideModal();
  }
}

// ==========================================
// FLASHLIGHT TOGGLE CONTROLLER
// ==========================================
let isFlashlightToggledOn = true;
function toggleFlashlight() {
  if (myTeam !== 'Human' || window.isSpectating) return;
  if (!flashLight) return;
  if (flashlightBattery <= 0) {
    triggerNotification("Flashlight battery depleted! Find a Battery Pack.");
    return;
  }
  isFlashlightToggledOn = !isFlashlightToggledOn;
  if (!isFlashlightToggledOn) {
    flashLight.intensity = 0;
    triggerNotification("Flashlight [OFF] — Conserving Battery");
  } else {
    triggerNotification("Flashlight [ON]");
  }
  if (window.isTutorialMatch && tutorialStage === 3) {
    advanceTutorialStage(4, "Illumination Operational! Next: Salvage Supplies");
  }
}

// ==========================================
// TUTORIAL TRAINING QUEST ENGINE
// ==========================================
let tutorialStage = 1;
let tutorialDistanceMoved = 0;
let tutorialSprintTime = 0;
let tutorialGhostDrillTimer = 0;
let tutorialLastPlayerPos = null;

function removePracticeGhost() {
  updateGhostProximityVignette(999, false);
  for (let i = ghosts3D.length - 1; i >= 0; i--) {
    const g = ghosts3D[i];
    if (g && g.userData && g.userData.isPracticeGhost) {
      scene.remove(g);
      g.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
      ghosts3D.splice(i, 1);
    }
  }
}

function createPracticeGhostBillboard() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(24, 10, 40, 0.92)';
  ctx.strokeStyle = '#d946ef';
  ctx.lineWidth = 6;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(8, 8, 496, 144, 16);
  } else {
    ctx.rect(8, 8, 496, 144);
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f0abfc';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('👻 TRAINING GHOST', 256, 52);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('STALKER ENTITY (DRILL)', 256, 104);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.8, 0.9, 1.0);
  sprite.position.set(0, 3.4, 0);
  return sprite;
}

function createPracticeGhostGroundRing() {
  const geo = new THREE.RingGeometry(0.8, 1.3, 32);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xd946ef,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.06;
  return mesh;
}

function spawnPracticeGhost() {
  removePracticeGhost();

  const pX = camera.position.x;
  const pZ = camera.position.z;
  const pG = worldToGrid(pX, pZ);
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  camDir.y = 0;
  camDir.normalize();

  let targetPos = null;
  let initialPath = null;

  if (openCorridors && openCorridors.length > 0) {
    const candidates = [];

    openCorridors.forEach(c => {
      const dx = c.x - pX;
      const dz = c.z - pZ;
      const d = Math.hypot(dx, dz);
      if (d >= 5.5 && d <= 14.0) {
        const cG = worldToGrid(c.x, c.z);
        const path = bfsPath(cG.col, cG.row, pG.col, pG.row, false);
        if (path && path.length > 0) {
          const dot = (camDir.lengthSq() > 0.01) ? (dx * camDir.x + dz * camDir.z) / d : 0;
          const hasLos = hasGridLineOfSight(pX, pZ, c.x, c.z);
          candidates.push({ x: c.x, z: c.z, dist: d, dot, hasLos, path });
        }
      }
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        if (a.hasLos !== b.hasLos) return a.hasLos ? -1 : 1;
        const aFront = a.dot > 0.1 ? 1 : 0;
        const bFront = b.dot > 0.1 ? 1 : 0;
        if (aFront !== bFront) return bFront - aFront;
        return Math.abs(a.dist - 8.5) - Math.abs(b.dist - 8.5);
      });
      targetPos = candidates[0];
      initialPath = targetPos.path;
    } else {
      // Fallback: any reachable corridor cell
      const backup = [];
      openCorridors.forEach(c => {
        const d = Math.hypot(c.x - pX, c.z - pZ);
        if (d >= 4.0) {
          const cG = worldToGrid(c.x, c.z);
          const path = bfsPath(cG.col, cG.row, pG.col, pG.row, false);
          if (path && path.length > 0) backup.push({ x: c.x, z: c.z, dist: d, path });
        }
      });
      if (backup.length > 0) {
        backup.sort((a, b) => Math.abs(a.dist - 8.5) - Math.abs(b.dist - 8.5));
        targetPos = backup[0];
        initialPath = targetPos.path;
      }
    }
  }

  if (!targetPos) {
    targetPos = gridToWorld(pG.col, pG.row);
  }

  const ghostGroup = createGhostMeshGroup('skin_ghost');
  ghostGroup.position.set(targetPos.x, 0, targetPos.z);
  ghostGroup.userData.isPracticeGhost = true;
  ghostGroup.userData.ghostClass = 'Stalker';
  ghostGroup.userData.aiState = 'CHASE';
  ghostGroup.userData.loseSightTimer = 0;
  ghostGroup.userData.chasedTargetId = myId || 'local_human';
  if (initialPath && initialPath.length > 0) {
    ghostGroup.userData.path = initialPath;
    ghostGroup.userData.pathIdx = 1;
    ghostGroup.userData.pathTime = performance.now();
  }

  // Face the player directly upon spawning
  ghostGroup.lookAt(pX, ghostGroup.position.y, pZ);

  // Dedicated bright purple illumination light (lights up walls and floors)
  const drillLight = new THREE.PointLight(0xd946ef, 3.8, 16.0);
  drillLight.position.set(0, 2.0, 0);
  ghostGroup.add(drillLight);
  ghostGroup.userData.drillLight = drillLight;

  // Floating 3D billboard header
  const billboard = createPracticeGhostBillboard();
  ghostGroup.add(billboard);

  // Pulsing floor ring
  const ring = createPracticeGhostGroundRing();
  ghostGroup.add(ring);
  ghostGroup.userData.groundRing = ring;

  // Enhance emissive glow on meshes so it stands out distinctly
  ghostGroup.traverse(child => {
    if (child.isMesh && child.material) {
      if (child.material.emissive) {
        child.material.emissive.setHex(0x581c87);
      }
      child.material.opacity = 0.95;
      child.material.transparent = true;
    }
  });

  scene.add(ghostGroup);
  ghosts3D.push(ghostGroup);

  triggerNotification("👻 GHOST DRILL: Training Ghost manifested down the corridor! Observe UV protection!");
}

function isInsideSanctuary(pos) {
  if (typeof sanctuaryZones === 'undefined' || !pos) return false;
  return sanctuaryZones.some(s => Math.hypot(pos.x - s.x, pos.z - s.z) < (s.radius || 4.5));
}

function playTutorialChime() {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 (Ascending major chord fanfare)
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.18, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.35);
    });
  } catch(e) {}
}

function initTutorialQuest() {
  tutorialStage = 1;
  tutorialDistanceMoved = 0;
  tutorialSprintTime = 0;
  tutorialGhostDrillTimer = 0;
  removePracticeGhost();
  if (codeClueNotes && codeClueNotes.length > 0) {
    codeClueNotes.forEach(n => n.collected = false);
  }
  tutorialLastPlayerPos = (camera && camera.position) ? camera.position.clone() : new THREE.Vector3(0, 1.6, 0);

  const banner = document.getElementById('tutorial-quest-banner');
  if (banner) banner.style.display = 'block';

  // Info Screen (Breakers, Keys, Code) is ALWAYS visible in the tutorial!
  const objBar = document.querySelector('.compact-objective-bar');
  if (objBar) {
    objBar.style.display = 'flex';
    const breakersInfo = document.getElementById('hud-breakers-info');
    if (breakersInfo) {
      breakersInfo.textContent = `POWER: ${fixedBreakersCount}/${totalBreakersRequired} BREAKER`;
      breakersInfo.style.color = '#f59e0b';
    }
    const cipherHUD = document.getElementById('hud-cipher-info');
    if (cipherHUD) {
      cipherHUD.textContent = `VAULT CODE: _ _ _ _`;
      cipherHUD.style.color = '#94a3b8';
    }
    const lockLabel = document.getElementById('terminal-lock-label');
    if (lockLabel) {
      lockLabel.textContent = "VAULT PROTOCOL: SECURED";
      lockLabel.style.color = "var(--primary-accent)";
    }
  }

  const minBtn = document.getElementById('tutorial-minimize-btn');
  if (minBtn) {
    minBtn.onclick = (e) => {
      if (e) {
        if (e.stopPropagation) e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
      }
      if (banner) {
        banner.classList.toggle('minimized');
        const isMin = banner.classList.contains('minimized');
        minBtn.textContent = isMin ? '▲ EXP' : '▼ MIN';
      }
    };
  }

  const abortBtn = document.getElementById('tutorial-abort-btn');
  if (abortBtn) {
    abortBtn.onclick = (e) => {
      if (e) {
        if (e.stopPropagation) e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
      }
      if (confirm("Exit Training Protocol and return to lobby?")) {
        removePracticeGhost();
        window.location.reload();
      }
    };
  }

  const rulesBtn = document.getElementById('tutorial-rules-btn');
  if (rulesBtn) {
    rulesBtn.onclick = (e) => {
      if (e) {
        if (e.stopPropagation) e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
      }
      if (window.openControlsGuideModal) {
        window.openControlsGuideModal('rules');
      } else {
        const modal = document.getElementById('controls-guide-modal');
        if (modal) modal.style.display = 'flex';
      }
    };
  }

  updateTutorialQuestBanner();
}

function updateTutorialQuestBanner() {
  const banner = document.getElementById('tutorial-quest-banner');
  // Always keep the Info Screen (breakers, keys, code) active!
  const objBar = document.querySelector('.compact-objective-bar');
  if (objBar) {
    objBar.style.display = 'flex';
    const breakersInfo = document.getElementById('hud-breakers-info');
    if (breakersInfo) {
      breakersInfo.textContent = `POWER: ${fixedBreakersCount}/${totalBreakersRequired} BREAKER`;
      breakersInfo.style.color = fixedBreakersCount >= 1 ? '#10b981' : '#f59e0b';
    }
    const cipherHUD = document.getElementById('hud-cipher-info');
    if (cipherHUD) {
      const hasClue = codeClueNotes && codeClueNotes.some(n => n.collected);
      if (hasClue) {
        const code = (window.cipherCodeDigits || []).join('');
        cipherHUD.textContent = `CODE: ${code}`;
        cipherHUD.style.color = '#38bdf8';
      } else {
        cipherHUD.textContent = `VAULT CODE: _ _ _ _`;
        cipherHUD.style.color = '#94a3b8';
      }
    }
  }

  if (!banner || !window.isTutorialMatch) {
    if (banner) banner.style.display = 'none';
    return;
  }

  banner.style.display = 'block';
  const stageInd = document.getElementById('tutorial-stage-indicator');
  const titleEl = document.getElementById('tutorial-task-title');
  const descEl = document.getElementById('tutorial-task-desc');
  const progBar = document.getElementById('tutorial-progress-bar');
  const hintEl = document.getElementById('tutorial-task-hint');

  if (!stageInd || !titleEl || !descEl || !progBar || !hintEl) return;

  switch (tutorialStage) {
    case 1:
      stageInd.textContent = 'STAGE 1/11';
      titleEl.textContent = 'LOCOMOTION CALIBRATION';
      descEl.innerHTML = isMobileDevice 
        ? 'Move through corridors using the <strong>Left Virtual Joystick</strong>.' 
        : 'Move through corridors using <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>.';
      const pct1 = Math.min(100, Math.floor((tutorialDistanceMoved / 8) * 100));
      progBar.style.width = `${pct1}%`;
      hintEl.textContent = `Distance: ${Math.floor(tutorialDistanceMoved)}m / 8m`;
      break;

    case 2:
      stageInd.textContent = 'STAGE 2/11';
      titleEl.textContent = 'TACTICAL SPRINT & STAMINA';
      descEl.innerHTML = isMobileDevice 
        ? 'Move using the <strong>Left Joystick</strong> and tap <span class="touch-badge">SPRINT</span> while moving to sprint. Notice your <strong>Stamina Bar</strong> drains!' 
        : 'Move using <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> and hold <kbd>SHIFT</kbd> while moving to sprint. Keep an eye on your <strong>Stamina Gauge</strong>!';
      const pct2 = Math.min(100, Math.floor((tutorialSprintTime / 1.5) * 100));
      progBar.style.width = `${pct2}%`;
      hintEl.textContent = isMobileDevice 
        ? `Move Joystick + Tap SPRINT: ${tutorialSprintTime.toFixed(1)}s / 1.5s`
        : `Move W/A/S/D + Hold SHIFT: ${tutorialSprintTime.toFixed(1)}s / 1.5s`;
      break;

    case 3:
      stageInd.textContent = 'STAGE 3/11';
      titleEl.textContent = 'ILLUMINATION & STEALTH';
      descEl.innerHTML = isMobileDevice 
        ? 'Tap <span class="touch-badge">USE</span> (with empty slot) to toggle flashlight. Turn it OFF to conserve battery or stealth!' 
        : 'Press <kbd>F</kbd> to toggle your Flashlight. Turn it OFF to conserve battery or hide from entities!';
      progBar.style.width = isFlashlightToggledOn ? '50%' : '100%';
      hintEl.textContent = isMobileDevice ? 'Tap USE to cycle beam' : 'Press [F] to toggle beam';
      break;

    case 4:
      stageInd.textContent = 'STAGE 4/11';
      titleEl.textContent = 'SALVAGE SUPPLIES & KEYS';
      descEl.innerHTML = isMobileDevice 
        ? 'Corridors contain supplies (<strong>Batteries</strong>, <strong>Medkits</strong>) and <strong>Gemstone Keys</strong> (Amber, Sapphire, Emerald, etc.). You can carry up to 3 keys on your key ring! Tap any glowing item or key on the floor.' 
        : 'Corridors contain supplies (<strong>Batteries</strong>, <strong>Medkits</strong>) and <strong>Gemstone Keys</strong> (Amber, Sapphire, Emerald, etc.). You can carry up to 3 keys on your key ring! Press <kbd>E</kbd> on any glowing item or key on the floor to pick it up.';
      progBar.style.width = '36%';
      hintEl.textContent = 'Look on the corridor floor for glowing batteries, medkits, or gemstone keys';
      break;

    case 5:
      stageInd.textContent = 'STAGE 5/11';
      titleEl.textContent = 'SHARE SUPPLIES & KEYS';
      descEl.innerHTML = isMobileDevice 
        ? 'In multiplayer, sharing gear saves teams! Tap <span class="touch-badge">DROP ITEM</span> to drop held supplies. Tap <span class="touch-badge">DROP KEY</span> to drop keys when your key ring is full (max 3 keys).' 
        : 'In multiplayer, sharing gear saves teams! Press <kbd>Q</kbd> to drop held supplies on the floor. Press <kbd>G</kbd> to drop carried keys when your key ring is full (max 3 keys).';
      progBar.style.width = '45%';
      hintEl.textContent = isMobileDevice ? 'Tap DROP ITEM or DROP KEY to share gear' : 'Press [Q] to drop held item or [G] to drop key';
      break;

    case 6:
      stageInd.textContent = 'STAGE 6/11';
      titleEl.textContent = 'TACTICAL MAP & BEACONS';
      descEl.innerHTML = isMobileDevice 
        ? 'Tap the top-right <strong>Radar Minimap</strong> to open the Tactical Map, then <strong>tap anywhere on the map grid</strong> to place a beacon marker pin!' 
        : 'Press <kbd>M</kbd> (or click the top-right radar) to open the Tactical Map, then <strong>click anywhere on the map grid</strong> to place a beacon marker pin!';
      progBar.style.width = mapMarks.length > 0 ? '70%' : '55%';
      hintEl.textContent = isMobileDevice 
        ? 'Tap Radar -> Tap map grid to drop beacon marker' 
        : 'Press [M] -> Click map grid to drop beacon marker';
      break;

    case 7:
      stageInd.textContent = 'STAGE 7/11';
      titleEl.textContent = 'UV LANTERN SANCTUARIES';
      descEl.innerHTML = isMobileDevice 
        ? 'Find a <strong>Warm Brass Ceiling Lantern</strong>. Standing in its light recovers <strong>Sanity (+8.5%/s)</strong> and shields you!' 
        : 'Find a <strong>Warm Brass Ceiling Lantern</strong>. Standing under it rapidly recovers <strong>Sanity (+8.5%/s)</strong>!';
      progBar.style.width = '64%';
      hintEl.textContent = 'Follow corridors toward the warm amber lantern glow';
      break;

    case 8:
      stageInd.textContent = 'STAGE 8/11';
      titleEl.textContent = 'GHOST SURVIVAL & OBJECTIVES';
      descEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.35rem; text-align: left; font-size: 0.78rem;">
          <div style="background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.45); border-radius: 6px; padding: 0.4rem 0.65rem;">
            <div style="color: #c084fc; font-weight: 800; margin-bottom: 0.2rem; display: flex; align-items: center; gap: 0.3rem;">
              <span>👻</span> GHOST SURVIVAL DRILL:
            </div>
            <div style="color: #f3e8ff; line-height: 1.38;">
              • <strong>Heartbeat & Purple Aura:</strong> Fast heartbeats mean an entity is hunting near you.<br>
              • <strong>UV Sanctuaries:</strong> Stand under the brass ceiling lantern — <strong>ghosts cannot enter UV light!</strong><br>
              • <strong>Stealth:</strong> Turn off your flashlight and walk quietly to evade detection.
            </div>
          </div>
          <div style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 6px; padding: 0.4rem 0.65rem;">
            <div style="color: #38bdf8; font-weight: 800; margin-bottom: 0.2rem; display: flex; align-items: center; gap: 0.3rem;">
              <span>🎯</span> COMPLETE 5-STEP ESCAPE PLAN:
            </div>
            <div style="color: #e0f2fe; line-height: 1.38;">
              1️⃣ <strong>Breakers:</strong> Repair yellow wall panels ⚡ to restore grid power to the vault.<br>
              2️⃣ <strong>Clue Notes:</strong> Inspect glowing parchment notes 📝 on corridor floors to decode the 4-digit cipher.<br>
              3️⃣ <strong>Crack Cipher:</strong> Enter the 4-digit code at the Keypad 🔢 to reveal <strong>WHICH 2 Twin Keys</strong> 🔑 are needed!<br>
              4️⃣ <strong>Twin Keys:</strong> Locate the 2 matching gemstone keys 🔑 in the maze and insert them into the Master Gate sockets.<br>
              5️⃣ <strong>Master Gate Escape:</strong> With power on and both keys installed, interact with the blast door 🌲 to escape!
            </div>
          </div>
        </div>
      `;
      const drillDuration = 12.0;
      const drillPct = Math.min(100, Math.floor((tutorialGhostDrillTimer / drillDuration) * 100));
      progBar.style.width = `${drillPct}%`;

      const practiceGhost = (typeof ghosts3D !== 'undefined') ? ghosts3D.find(g => g && g.userData && g.userData.isPracticeGhost) : null;
      const distToPractice = practiceGhost ? Math.hypot(practiceGhost.position.x - camera.position.x, practiceGhost.position.z - camera.position.z) : 999;
      const inSanc = isInsideSanctuary(camera.position);
      const remainingSecs = Math.max(0, drillDuration - tutorialGhostDrillTimer).toFixed(1);

      if (inSanc) {
        if (practiceGhost && practiceGhost.userData && practiceGhost.userData.isBlockedBySanctuary) {
          hintEl.textContent = `🛡️ UV Shield Repelling Ghost! (${remainingSecs}s) — Ghosts cannot enter UV light!`;
        } else {
          hintEl.textContent = `👀 Watch the ghost approach down the hall (${distToPractice.toFixed(1)}m)! UV light protects you (${remainingSecs}s)`;
        }
      } else {
        hintEl.textContent = `⚠️ Outside Safe Zone! (${distToPractice.toFixed(1)}m) — Return under the UV Lantern! (${remainingSecs}s)`;
      }
      break;

    case 9:
      stageInd.textContent = 'STAGE 9/11';
      titleEl.textContent = 'GRID POWER & CLUE NOTES';
      const fullCode9 = (window.cipherCodeDigits || []).join('');
      const hasClue9 = codeClueNotes && codeClueNotes.some(n => n.collected);
      const isBreakerDone9 = fixedBreakersCount >= 1;
      
      descEl.innerHTML = isMobileDevice 
        ? `To escape, you must restore <strong>Grid Power</strong> and discover the <strong>4-Digit Cipher</strong>!<br>
           ⚡ <strong>Breaker:</strong> Locate the yellow breaker box on the wall and tap it.<br>
           📝 <strong>Clue Notes:</strong> Lying on the corridor floor — tap to decode code digits.` 
        : `To escape, you must restore <strong>Grid Power</strong> and discover the <strong>4-Digit Cipher</strong>!<br>
           ⚡ <strong>Breaker:</strong> Locate the yellow breaker box on the wall and press <kbd>E</kbd>.<br>
           📝 <strong>Clue Notes:</strong> Lying on the corridor floor — press <kbd>E</kbd> to decode code digits.`;

      let doneCount9 = (isBreakerDone9 ? 1 : 0) + (hasClue9 ? 1 : 0);
      progBar.style.width = doneCount9 === 0 ? '75%' : (doneCount9 === 1 ? '80%' : '85%');

      if (!isBreakerDone9 && !hasClue9) {
        hintEl.textContent = `⚡ Breaker: [ 0/1 ] | 📝 Clue Notes: [ 0/1 ] — Search corridor floors`;
      } else if (isBreakerDone9 && !hasClue9) {
        hintEl.textContent = `⚡ Grid Powered! Now find and inspect the glowing Floor Clue Note (📝)`;
      } else if (!isBreakerDone9 && hasClue9) {
        hintEl.textContent = `📝 Code Intel Decoded: [ ${fullCode9} ]! Now repair yellow Circuit Breaker (⚡)`;
      } else {
        hintEl.textContent = `✅ Ready! Code [ ${fullCode9} ] Intel Acquired & Grid Powered!`;
      }
      break;

    case 10:
      stageInd.textContent = 'STAGE 10/11';
      titleEl.textContent = 'CRACK KEYPAD CIPHER';
      const fullCode10 = (window.cipherCodeDigits || []).join('') || '4821';
      descEl.innerHTML = isMobileDevice 
        ? `Head to the <strong>Master Vault Keypad</strong> at the corridor terminus and enter the code: <span style="color: #facc15; font-size: 0.95rem; font-weight: 900; letter-spacing: 2px; text-shadow: 0 0 8px rgba(250, 204, 21, 0.6); background: rgba(250, 204, 21, 0.15); padding: 0.1rem 0.45rem; border-radius: 4px; border: 1px solid rgba(250, 204, 21, 0.4);">[ ${fullCode10} ]</span>. The terminal will decrypt the gate locks and <strong>reveal WHICH 2 Twin Keys</strong> are required!` 
        : `Head to the <strong>Master Vault Keypad</strong> at the corridor terminus and enter the code: <span style="color: #facc15; font-size: 0.95rem; font-weight: 900; letter-spacing: 2px; text-shadow: 0 0 8px rgba(250, 204, 21, 0.6); background: rgba(250, 204, 21, 0.15); padding: 0.1rem 0.45rem; border-radius: 4px; border: 1px solid rgba(250, 204, 21, 0.4);">[ ${fullCode10} ]</span>. The terminal will decrypt the gate locks and <strong>reveal WHICH 2 Twin Keys</strong> are required!`;
      progBar.style.width = '88%';
      hintEl.textContent = `Enter code [ ${fullCode10} ] at Master Vault Keypad terminal to reveal Twin Keys!`;
      break;

    case 11:
      stageInd.textContent = 'STAGE 11/11';
      titleEl.textContent = 'TWIN EXTRACTION KEYS & ESCAPE';
      const reqGems11 = (functionalKeysRevealed || []).map(f => formatFunctionalKeyName(f));
      const reqText11 = reqGems11.join(' + ') || 'Twin Extraction Keys';
      const installedCount11 = (insertedGateKeys || []).length;
      const carriedReqKeys11 = carriedKeys.filter(k => isKeyFunctional(k) && !isKeyAlreadyInserted(k));

      if (installedCount11 === 0) {
        if (carriedReqKeys11.length > 0) {
          const carriedName = carriedReqKeys11[0].typeName || carriedReqKeys11[0].symbol;
          descEl.innerHTML = isMobileDevice
            ? `You are carrying <strong>[${carriedName}]</strong>! Approach the Master Vault Gate and tap it to insert the key into the lock!`
            : `You are carrying <strong>[${carriedName}]</strong>! Approach the Master Vault Gate and press <kbd>E</kbd> to insert the key into the lock!`;
          hintEl.textContent = `Holding [${carriedName}]! Approach Master Gate to insert key (1/2)`;
        } else {
          descEl.innerHTML = `The Keypad decoded the lock! The Master Gate requires 2 Twin Keys: <span style="color: #38bdf8; font-weight: 800;">[ ${reqText11} ]</span>! Out of all keys in the maze, only these two fit. Check your <strong>Tactical Minimap</strong> (marked with beacon pins), collect the keys, and bring them to the Master Gate!`;
          hintEl.textContent = `Keys: 0/2 Installed (${carriedKeys.length}/3 in hand) — Find & collect [${reqText11}]`;
        }
        progBar.style.width = carriedReqKeys11.length > 0 ? '94%' : '90%';
      } else if (installedCount11 === 1) {
        if (carriedReqKeys11.length > 0) {
          const carriedName = carriedReqKeys11[0].typeName || carriedReqKeys11[0].symbol;
          descEl.innerHTML = isMobileDevice
            ? `First key installed! You have the second Twin Key <strong>[${carriedName}]</strong> in hand! Tap the Master Gate to insert it!`
            : `First key installed! You have the second Twin Key <strong>[${carriedName}]</strong> in hand! Press <kbd>E</kbd> at the Master Gate to insert it!`;
          hintEl.textContent = `Insert second Twin Key [${carriedName}] into Master Gate! (2/2)`;
        } else {
          const installedGems = (insertedGateKeys || []).map(ins => getCanonicalGemstone(ins)).filter(Boolean);
          const missingGems = reqGems11.filter(r => !installedGems.some(ig => ig.toLowerCase() === r.toLowerCase()));
          const missingName = missingGems[0] || 'Twin Key';
          descEl.innerHTML = `First key installed into the gate (1/2)! Now search the corridors for the remaining Twin Key: <span style="color: #38bdf8; font-weight: 800;">[ ${missingName} ]</span>, bring it to the Master Gate, and insert it!`;
          hintEl.textContent = `Keys: 1/2 Installed (${carriedKeys.length}/3 in hand) — Find remaining [${missingName}]`;
        }
        progBar.style.width = '96%';
      } else {
        descEl.innerHTML = isMobileDevice 
          ? '🎉 <strong>BOTH TWIN KEYS INSTALLED! Master Gate Unlocked!</strong> Tap the blast door to escape into the pine forest!' 
          : '🎉 <strong>BOTH TWIN KEYS INSTALLED! Master Gate Unlocked!</strong> Press <kbd>E</kbd> at the blast door to escape into the pine forest!';
        progBar.style.width = '100%';
        hintEl.textContent = isMobileDevice ? 'Gate Unlocked! Tap blast door to Escape into the Forest!' : 'Gate Unlocked! Press E to Escape into the Forest!';
      }
      break;
  }
}

function advanceTutorialStage(nextStage, successMsg) {
  if (tutorialStage >= nextStage) return;
  tutorialStage = nextStage;
  playTutorialChime();
  if (successMsg) triggerNotification(`🎓 ${successMsg}`);

  if (nextStage === 8) {
    tutorialGhostDrillTimer = 0;
    spawnPracticeGhost();
  } else if (nextStage > 8) {
    removePracticeGhost();
  }

  updateTutorialQuestBanner();
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
  const topCloseBtn = document.getElementById('minimap-top-close-btn');
  const backdrop = document.getElementById('minimap-modal-backdrop');

  if (!wrapper || !canvas) return;
  minimapSetupDone = true;

  const closeMinimap = (e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    isMinimapExpanded = false;
    wrapper.classList.remove('expanded');
    controls.style.display = 'none';
    if (topCloseBtn) topCloseBtn.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';
    const titleText = document.getElementById('minimap-title-text');
    if (titleText) titleText.textContent = 'MINIMAP (Press M / Tap)';
    if (!isMobileDevice && window.gameReady && !isCaptured) {
      (renderer && renderer.domElement || document.getElementById('canvas-container')).requestPointerLock();
    }
    drawMinimap();
  };

  const openMinimap = () => {
    isMinimapExpanded = true;
    wrapper.classList.add('expanded');
    controls.style.display = 'block';
    if (topCloseBtn) topCloseBtn.style.display = 'flex';
    if (backdrop) backdrop.style.display = 'block';
    const promptEl = document.getElementById('interaction-prompt');
    if (promptEl) promptEl.style.display = 'none';
    const titleText = document.getElementById('minimap-title-text');
    if (titleText) titleText.textContent = 'TACTICAL MAP';
    if (document.pointerLockElement) document.exitPointerLock();
    drawMinimap();
  };

  const handleMapMark = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const px = (clientX - rect.left) * scaleX;
    const py = (clientY - rect.top) * scaleY;
    
    // Map canvas coordinates to maze grid
    const mazeSize = mazeSizeGlobal;
    const cellSize = canvas.width / mazeSize;
    const c = Math.floor(px / cellSize);
    const r = Math.floor(py / cellSize);
    
    if (c >= 0 && c < mazeSize && r >= 0 && r < mazeSize) {
      // Toggle mark: if already exists, remove it; else add it
      const existingIdx = mapMarks.findIndex(m => m.r === r && m.c === c);
      if (existingIdx !== -1) {
        mapMarks.splice(existingIdx, 1);
      } else {
        mapMarks.push({r, c});
      }
      drawMinimap();

      if (window.isTutorialMatch && tutorialStage === 6) {
        advanceTutorialStage(7, "Tactical Beacon Placed! Markers help your team navigate. Next: UV Lantern Sanctuaries");
      }
    }
  };

  // Toggle map expansion & drop markers on touch/click
  wrapper.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
    
    if (!isMinimapExpanded) {
      openMinimap();
    } else if (e.target.id === 'minimap-canvas') {
      handleMapMark(e.clientX, e.clientY);
    }
  });

  canvas.addEventListener('touchstart', (e) => {
    if (!isMinimapExpanded) {
      openMinimap();
    } else if (e.touches && e.touches[0]) {
      e.preventDefault();
      e.stopPropagation();
      handleMapMark(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  if (btnClose) {
    btnClose.addEventListener('click', closeMinimap);
    btnClose.addEventListener('touchstart', closeMinimap, { passive: false });
  }

  if (topCloseBtn) {
    topCloseBtn.addEventListener('click', closeMinimap);
    topCloseBtn.addEventListener('touchstart', closeMinimap, { passive: false });
  }

  if (backdrop) {
    backdrop.addEventListener('click', closeMinimap);
    backdrop.addEventListener('touchstart', closeMinimap, { passive: false });
  }

  if (btnClear) {
    const handleClear = (e) => {
      e.stopPropagation();
      e.preventDefault();
      mapMarks = [];
      drawMinimap();
    };
    btnClear.addEventListener('click', handleClear);
    btnClear.addEventListener('touchstart', handleClear, { passive: false });
  }
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
  if (breaker.mesh) {
    if (breaker.mesh.userData && breaker.mesh.userData.ledMesh) {
      breaker.mesh.userData.ledMesh.material.color.setHex(0x10b981);
      breaker.mesh.userData.ledMesh.material.emissive.setHex(0x10b981);
    }
    if (breaker.mesh.userData && breaker.mesh.userData.statusLight) {
      breaker.mesh.userData.statusLight.color.setHex(0x10b981);
    }
    if (breaker.mesh.material) {
      if (Array.isArray(breaker.mesh.material)) {
        breaker.mesh.material.forEach(m => {
          if (m.map) m.color.setHex(0xdcfce7); // Subtle restore tint on front face
        });
      } else {
        breaker.mesh.material.color.setHex(0x10b981);
      }
    }
  }
  fixedBreakersCount++;
  
  updateEnvironmentLighting();

  updateGateHUD();

  if (fixedBreakersCount >= totalBreakersRequired) {
    triggerNotification(`⚡ ALL BREAKERS REPAIRED! Keypad terminal is now powered online.`);
    if (gateKeypadLed && gateKeypadLed.material) {
      gateKeypadLed.material.color.setHex(0x10b981);
      if (gateKeypadLed.material.emissive) gateKeypadLed.material.emissive.setHex(0x10b981);
    }
    if (window.isTutorialMatch) {
      const fullCode = (window.cipherCodeDigits || []).join('');
      const hasClue = codeClueNotes && codeClueNotes.some(n => n.collected);
      if (hasClue) {
        advanceTutorialStage(10, `Grid Power Restored & Code Intel [${fullCode}] Acquired! Head to Master Vault Keypad to reveal the Twin Keys!`);
      } else {
        triggerNotification(`⚡ Grid Power Restored! Next: Inspect glowing floor clue note (📝) to decode vault cipher!`);
        updateTutorialQuestBanner();
      }
    }
  } else {
    triggerNotification(`Circuit breaker repaired! (${fixedBreakersCount}/${totalBreakersRequired})`);
  }
  checkWinCondition();
}

function updateMinimapVisibility() {
  if (!mazeLayout || mazeLayout.length === 0) return;
  const totalRows = mazeLayout.length;
  const totalCols = (mazeLayout[0] && mazeLayout[0].length) ? mazeLayout[0].length : totalRows;
  const blockSize = mazeBlockSize || 6.0;
  
  // Calculate current grid cell safely clamped
  const px = camera.position.x;
  const pz = camera.position.z;
  let c = Math.max(0, Math.min(totalCols - 1, Math.floor((px / blockSize) + (totalCols / 2))));
  let r = Math.max(0, Math.min(totalRows - 1, Math.floor((pz / blockSize) + (totalRows / 2))));
  
  // If the calculated cell lands on a closed sliding door (type === 2), the player is physically
  // standing in the corridor approaching the door slab. Clamp the origin cell back to the player's corridor!
  if (mazeLayout[r] && mazeLayout[r][c] === 2) {
    const wx = (c - totalCols / 2) * blockSize + blockSize / 2;
    const wz = (r - totalRows / 2) * blockSize + blockSize / 2;
    const isEW = (c > 0 && mazeLayout[r] && mazeLayout[r][c - 1] === 0) || 
                 (c < totalCols - 1 && mazeLayout[r] && mazeLayout[r][c + 1] === 0);
    if (isEW) {
      c = px < wx ? Math.max(0, c - 1) : Math.min(totalCols - 1, c + 1);
    } else {
      r = pz < wz ? Math.max(0, r - 1) : Math.min(totalRows - 1, r + 1);
    }
  } else if (mazeLayout[r] && mazeLayout[r][c] === 1) {
    // If player coordinate lands inside a static wall block, clamp to nearest open corridor neighbor
    const cardinalDirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    let bestDist = Infinity;
    let bestC = c;
    let bestR = r;
    for (const [dc, dr] of cardinalDirs) {
      const nc = c + dc;
      const nr = r + dr;
      if (nr >= 0 && nr < totalRows && nc >= 0 && nc < totalCols && mazeLayout[nr] && mazeLayout[nr][nc] === 0) {
        const cellX = (nc - totalCols / 2) * blockSize + blockSize / 2;
        const cellZ = (nr - totalRows / 2) * blockSize + blockSize / 2;
        const d = Math.hypot(px - cellX, pz - cellZ);
        if (d < bestDist) {
          bestDist = d;
          bestC = nc;
          bestR = nr;
        }
      }
    }
    c = bestC;
    r = bestR;
  }

  // Mark cells using a 2-step flood fill to prevent revealing through walls or closed doors
  const queue = [{c, r, dist: 0}];
  const currentVisible = new Set();
  currentVisible.add((r * 1000) + c);
  
  while (queue.length > 0) {
    const curr = queue.shift();
    if (curr.dist >= 2) continue; // max 2 steps for radius ~5x5
    
    // Cannot expand sight past a wall (1) or a closed sliding door (2)
    const currVal = (mazeLayout[curr.r] ? mazeLayout[curr.r][curr.c] : 1);
    if (currVal !== 0) continue;

    const neighbors = [
      {dc: 0, dr: -1}, {dc: 0, dr: 1}, {dc: -1, dr: 0}, {dc: 1, dr: 0},
      {dc: -1, dr: -1}, {dc: 1, dr: -1}, {dc: -1, dr: 1}, {dc: 1, dr: 1} // Diagonals
    ];
    
    for (const n of neighbors) {
      const nc = curr.c + n.dc;
      const nr = curr.r + n.dr;
      
      if (nr < 0 || nr >= totalRows || nc < 0 || nc >= totalCols) continue;
      
      // Never reveal or see through the vault doorway cell on the minimap (conceals vault entrance)
      if (typeof window !== 'undefined' && nr === window.vaultR && nc === window.vaultC) continue;
      
      const key = (nr * 1000) + nc;
      if (currentVisible.has(key)) continue;

      const neighborVal = (mazeLayout[nr] ? mazeLayout[nr][nc] : 1);

      // Prevent diagonal sight through two adjacent corner walls or closed doors
      if (Math.abs(n.dc) === 1 && Math.abs(n.dr) === 1) {
        const isBlocking = (cell) => cell !== undefined && cell !== 0;
        const side1 = mazeLayout[curr.r] ? mazeLayout[curr.r][nc] : 1;
        const side2 = mazeLayout[nr] ? mazeLayout[nr][curr.c] : 1;
        if (isBlocking(side1) && isBlocking(side2)) continue; 
      }
      
      currentVisible.add(key);

      // Only expand further into open corridors (0).
      // Walls (1) and closed doors (2) are visible on the map, but line-of-sight NEVER passes through them!
      if (neighborVal === 0) {
        queue.push({c: nc, r: nr, dist: curr.dist + 1});
      }
    }
  }

  currentVisible.forEach(key => visitedCells.add(key));
}

function drawMinimap() {
  const canvas = document.getElementById('minimap-canvas');
  if (!canvas || !mazeLayout || mazeLayout.length === 0) return;
  const ctx = canvas.getContext('2d');
  
  const totalRows = mazeLayout.length;
  const totalCols = (mazeLayout[0] && mazeLayout[0].length) ? mazeLayout[0].length : totalRows;
  const blockSize = mazeBlockSize || 6.0;
  const cellSize = canvas.width / totalCols;
  
  // Clear canvas
  ctx.fillStyle = myTeam === 'Ghost' ? '#0a0512' : '#050a10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw cells (Ghosts see entire realigned maze, Humans see explored cells)
  for (let r = 0; r < totalRows; r++) {
    if (!mazeLayout[r]) continue;
    for (let c = 0; c < totalCols; c++) {
      if (myTeam === 'Ghost' || visitedCells.has((r * 1000) + c)) {
        // Conceal vault doorway on minimap as a solid perimeter wall so the map doesn't look like it extends further
        const isVaultDoor = (typeof window !== 'undefined' && r === window.vaultR && c === window.vaultC);
        const type = isVaultDoor ? 1 : mazeLayout[r][c];
        if (type === 1) {
          // Static Wall
          ctx.fillStyle = myTeam === 'Ghost' ? '#1f1330' : '#1e293b'; 
          ctx.fillRect(c * cellSize, r * cellSize, cellSize + 0.5, cellSize + 0.5);
        } else if (type === 2) {
          // Closed Sliding Door / Shifting Wall Barrier
          // Draw wall background
          ctx.fillStyle = myTeam === 'Ghost' ? '#2a1745' : '#1e293b'; 
          ctx.fillRect(c * cellSize, r * cellSize, cellSize + 0.5, cellSize + 0.5);
          
          // Draw distinctive amber/gold sliding gate barrier across the corridor opening
          ctx.fillStyle = '#f59e0b';
          const gateThickness = Math.max(2, cellSize * 0.3);
          const isEW = (c > 0 && mazeLayout[r] && mazeLayout[r][c - 1] === 0) || 
                       (c < totalCols - 1 && mazeLayout[r] && mazeLayout[r][c + 1] === 0);
          if (isEW) {
            // East-West corridor: gate barrier spans North-South across the opening
            ctx.fillRect((c + 0.5) * cellSize - gateThickness / 2, r * cellSize + 0.5, gateThickness, cellSize);
          } else {
            // North-South corridor: gate barrier spans East-West across the opening
            ctx.fillRect(c * cellSize + 0.5, (r + 0.5) * cellSize - gateThickness / 2, cellSize, gateThickness);
          }
        } else {
          // Floor (Open corridor)
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



  // Draw Light Sanctuaries (Feature 4: Warm Gold Lantern markers)
  if (typeof sanctuaryZones !== 'undefined') {
    sanctuaryZones.forEach(s => {
      const sc = (s.x / blockSize) + (totalCols / 2);
      const sr = (s.z / blockSize) + (totalRows / 2);
      ctx.save();
      ctx.translate(sc * cellSize, sr * cellSize);
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(0, 0, cellSize * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    });
  }

  // Draw AI Ghosts on minimap if player is Ghost
  if (myTeam === 'Ghost' && typeof ghosts3D !== 'undefined') {
    ghosts3D.forEach(g => {
      const gc = (g.position.x / blockSize) + (totalCols / 2);
      const gr = (g.position.z / blockSize) + (totalRows / 2);
      ctx.save();
      ctx.translate(gc * cellSize, gr * cellSize);
      ctx.fillStyle = '#c084fc'; // Purple AI Ghost marker
      ctx.beginPath();
      ctx.arc(0, 0, cellSize * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  // Draw Training Practice Ghost on minimap during training drill so player can immediately locate it
  if (window.isTutorialMatch && typeof ghosts3D !== 'undefined') {
    ghosts3D.forEach(g => {
      if (g && g.userData && g.userData.isPracticeGhost) {
        const gc = (g.position.x / blockSize) + (totalCols / 2);
        const gr = (g.position.z / blockSize) + (totalRows / 2);
        ctx.save();
        ctx.translate(gc * cellSize, gr * cellSize);

        // Pulsing radar ping ring
        const pingRadius = cellSize * (0.6 + Math.sin(performance.now() * 0.008) * 0.3);
        ctx.strokeStyle = 'rgba(217, 70, 239, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, pingRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Bright magenta ghost core with crisp white border
        ctx.fillStyle = '#e879f9';
        ctx.beginPath();
        ctx.arc(0, 0, cellSize * 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  // Draw Teammates
  Object.values(players3D).forEach(p => {
    if (p.userData && p.userData.type === myTeam) {
      const tc = (p.position.x / blockSize) + (totalCols / 2);
      const tr = (p.position.z / blockSize) + (totalRows / 2);
      
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

  // Draw Fallen Teammates (Corpses)
  if (myTeam === 'Human' && typeof playerCorpses !== 'undefined') {
    Object.values(playerCorpses).forEach(c => {
      if (c && c.position) {
        const cc = (c.position.x / blockSize) + (totalCols / 2);
        const cr = (c.position.z / blockSize) + (totalRows / 2);
        ctx.save();
        ctx.translate(cc * cellSize, cr * cellSize);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const half = cellSize * 0.35;
        ctx.moveTo(-half, -half);
        ctx.lineTo(half, half);
        ctx.moveTo(half, -half);
        ctx.lineTo(-half, half);
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  // Draw Player Marker (Local)
  const pc = (camera.position.x / blockSize) + (totalCols / 2);
  const pr = (camera.position.z / blockSize) + (totalRows / 2);
  
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

// Helper function to apply damage if human is near a ghost (hoisted to prevent per-frame closure GC churn)
function applyGhostDamageToHuman(ghostPos, delta) {
  if (window.isSpectating) return;
  const distToPlayer = Math.hypot(ghostPos.x - camera.position.x, ghostPos.z - camera.position.z);
  if (distToPlayer < 1.5 && myTeam === 'Human' && !isPanicked) {
    if (window.isTutorialMatch) {
      if (currentHP > 50) {
        currentHP = Math.max(50, currentHP - delta * 15);
        const hpVal = document.getElementById('hp-value');
        const hpBar = document.getElementById('hp-bar');
        if (hpVal) hpVal.textContent = `${Math.ceil(currentHP)} HP`;
        if (hpBar) hpBar.style.width = `${currentHP}%`;
      }
      return; // In training drill, ghost proximity demonstrates threat without capturing player
    }
    currentHP = Math.max(0, currentHP - delta * 45);
    const hpVal = document.getElementById('hp-value');
    const hpBar = document.getElementById('hp-bar');
    if (hpVal) hpVal.textContent = `${Math.ceil(currentHP)} HP`;
    if (hpBar) hpBar.style.width = `${currentHP}%`;

    const activeKeypadModal = document.getElementById('keypad-modal-ui');
    if (activeKeypadModal && activeKeypadModal.style.display !== 'none') {
      if (!window._lastKeypadWarn || performance.now() - window._lastKeypadWarn > 1500) {
        window._lastKeypadWarn = performance.now();
        triggerNotification("⚠️ DANGER: HOSTILE ATTACKING! DISENGAGE TERMINAL!");
      }
    }
    
    if (currentHP <= 0 && !isCaptured) {
      triggerLocalPlayerCapture();
    }
  }
}

export function showSoloDeathEndScreen() {
  const ptrOverlay = document.getElementById('pointer-lock-overlay');
  if (ptrOverlay) ptrOverlay.style.display = 'none';
  if (document.pointerLockElement) {
    try { document.exitPointerLock(); } catch(_) {}
  }
  window.mobileGameActive = false;
  window.gameReady = false;

  const capOverlay = document.getElementById('captured-overlay');
  if (capOverlay) capOverlay.style.display = 'none';
  const hud = document.getElementById('hud-overlay');
  if (hud) hud.style.display = 'none';
  const mobileCtrl = document.getElementById('mobile-controls-container');
  if (mobileCtrl) mobileCtrl.style.display = 'none';

  const specHud = document.getElementById('spectator-hud');
  if (specHud) specHud.style.display = 'none';

  const overlay = document.getElementById('end-game-overlay');
  const title = document.getElementById('end-game-title');
  const details = document.getElementById('end-game-details');
  const retryBtn = document.getElementById('end-game-retry-btn');
  const lobbyBtn = document.getElementById('end-game-lobby-btn');

  if (overlay && title && details) {
    overlay.style.display = 'flex';
    title.textContent = "YOU DIED";
    title.style.color = "#ef4444";
    title.style.textShadow = "0 0 30px rgba(239, 68, 68, 0.9)";
    details.innerHTML = `<div style="font-weight:bold; color: #ef4444; margin-bottom: 0.8rem; font-size: 1.3rem;">CONSUMED BY THE VOID</div><p style="color: #cbd5e1; font-size: 0.95rem; line-height: 1.5;">You were dragged into the darkness before completing the extraction sequence.</p>`;

    if (retryBtn) {
      retryBtn.style.display = 'inline-block';
      addFastTapListener(retryBtn, () => {
        sessionStorage.setItem('rejoinRetrySolo', 'true');
        sessionStorage.setItem('rejoinIsSolo', 'true');
        if (window.leaveGameWithAd) {
          window.leaveGameWithAd(() => window.location.reload());
        } else {
          window.location.reload();
        }
      });
    }

    if (lobbyBtn) {
      lobbyBtn.textContent = 'Main Menu';
      addFastTapListener(lobbyBtn, () => {
        sessionStorage.removeItem('rejoinLobbyId');
        sessionStorage.removeItem('rejoinUsername');
        sessionStorage.removeItem('rejoinIsPublic');
        sessionStorage.removeItem('rejoinIsSolo');
        sessionStorage.removeItem('rejoinRetrySolo');
        if (window.leaveGameWithAd) {
          window.leaveGameWithAd(() => window.location.reload());
        } else {
          window.location.reload();
        }
      });
    }
  }
}
window.showSoloDeathEndScreen = showSoloDeathEndScreen;

function triggerLocalPlayerCapture() {
  if (isCaptured) return;
  isCaptured = true;

  const myUsername = (currentLobby && currentLobby.players && currentLobby.players[myId]?.username) || 'Operative';
  const mySkin = (currentLobby && currentLobby.players && currentLobby.players[myId]?.skinId) || null;

  // Spawn persistent dead body model at exact death location
  spawnDeadBody(camera.position, camera.rotation.y, myUsername, myClass, mySkin, myId);
  onHumanKilled(myId, camera.position);
  
  if (socketClient) {
    socketClient.emit('chat_message', { msg: `[SYSTEM]: Operative ${myUsername} (${myClass}) has been captured by the void.` });
    socketClient.emit('capture_human', { 
      targetId: myId,
      position: { x: camera.position.x, y: 0.04, z: camera.position.z },
      rotation: camera.rotation.y,
      username: myUsername,
      characterClass: myClass,
      skinId: mySkin
    });

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
      const preservedId = key.id || ('key_' + key.symbol);
      socketClient.emit('key_dropped', {
        id: preservedId,
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
    const ptrOverlay = document.getElementById('pointer-lock-overlay');
    if (ptrOverlay) ptrOverlay.style.display = 'none';
    if (document.pointerLockElement) document.exitPointerLock();
    window.mobileGameActive = false;
    window.gameReady = false;
    const hud = document.getElementById('hud-overlay');
    if (hud) hud.style.display = 'none';
    const mobileCtrl = document.getElementById('mobile-controls-container');
    if (mobileCtrl) mobileCtrl.style.display = 'none';
    const otherLivingHumans = Object.values((currentLobby && currentLobby.players) || {}).filter(p => p.id !== myId && p.team === 'Human' && !p.isCaptured);
    if (window.isSoloMatch || otherLivingHumans.length === 0) {
      showSoloDeathEndScreen();
    } else {
      const capOverlay = document.getElementById('captured-overlay');
      if (capOverlay) capOverlay.style.display = 'flex';
    }
  });
}

// Helper function to check chalk decals for a given ghost position (hoisted to prevent per-frame closure GC churn)
function checkChalkDecals(ghostPos) {
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
        if (decal.material && decal.material.color) decal.material.color.setHex(0xff3333);
        decal.userData.fadeTimer = 3.0; // Handled in animate loop via delta
      }
    }
  }
}

// 3D Game Loop rendering
let animationFrameId = null;
let networkTimer = 0;
let lastRenderTime = 0;
function animate() {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
  animationFrameId = requestAnimationFrame(animate);

  const time = performance.now();

  // Mobile / Low-End Thermal Guard: Cap frame rate to 60 FPS
  // High-refresh mobile displays (90Hz / 120Hz / 144Hz) push phone GPUs past thermal limits.
  // Throttling to smooth 60 FPS halves GPU work, keeps the phone cool, and conserves battery!
  const isMobile = isMobileDevice || isLowEndHardware;
  if (isMobile && (time - lastRenderTime < 15.5)) {
    return;
  }
  lastRenderTime = time;

  const rawDelta = (time - prevTime) / 1000;
  prevTime = time;
  const delta = Math.min(0.05, Math.max(0.0001, rawDelta)); // Clamp delta to prevent time jumps

  const keypadModalEl = document.getElementById('keypad-modal-ui');
  const isKeypadOpen = Boolean(keypadModalEl && keypadModalEl.style.display !== 'none');
  const isMinimapOpen = Boolean(isMinimapExpanded);
  const ptrOverlay = document.getElementById('pointer-lock-overlay');
  const isPauseMenuOpen = Boolean(ptrOverlay && ptrOverlay.style.display === 'flex');

  // Interactive overlays (keypad terminal cipher, tactical minimap) are live in-game actions:
  // AI ghosts must continue pathfinding, stalking, and attacking even while the player views these overlays!
  const isInteractiveOverlay = isKeypadOpen || isMinimapOpen;

  // Solo Offline Matches: Truly PAUSE game simulation ONLY when the dedicated pause menu is open.
  // Never pause for in-game interactive terminals or tactical map, and never in multiplayer!
  const isMultiplayer = Boolean(currentLobby && currentLobby.id && !currentLobby.id.startsWith('solo-'));
  const isSoloPaused = !isMultiplayer && isPauseMenuOpen && !isInteractiveOverlay && !window.isSpectating && window.gameReady;

  if (isSoloPaused) {
    if (!wasSoloPaused) {
      wasSoloPaused = true;
      soloPauseStartTime = performance.now();
    }
    resetPlayerMovementState();
    const canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer) canvasContainer.style.filter = 'none';
    document.body.style.filter = 'none';

    if (activeViewCamera) renderer.render(scene, activeViewCamera);
    else renderer.render(scene, camera);
    return;
  }

  // Resume transition from solo pause: shift all real-time timestamp cooldowns forward
  if (wasSoloPaused) {
    wasSoloPaused = false;
    const pauseDurationMs = performance.now() - soloPauseStartTime;
    if (pauseDurationMs > 0) {
      const now = Date.now();
      for (const key in abilityCooldowns) {
        if (typeof abilityCooldowns[key] === 'number' && abilityCooldowns[key] > (now - pauseDurationMs)) {
          abilityCooldowns[key] += pauseDurationMs;
        }
      }
      if (window.securityLockoutActive && window.securityLockoutEndTime > (performance.now() - pauseDurationMs)) {
        window.securityLockoutEndTime += pauseDurationMs;
        if (window._securityLockoutTimer) clearTimeout(window._securityLockoutTimer);
        const remainingLockoutMs = Math.max(0, window.securityLockoutEndTime - performance.now());
        window._securityLockoutTimer = setTimeout(() => {
          if (window.securityLockoutActive) {
            window.securityLockoutActive = false;
            window.securityLockoutEndTime = 0;
            triggerNotification('Terminal lockout ended. Keypad ready.');
          }
        }, remainingLockoutMs);
      }
    }
  }

  // Active gameplay timers (delta-decremented so they automatically pause when solo is paused)
  if (window.ghostsFrozen) {
    ghostsFrozenRemaining -= delta;
    if (ghostsFrozenRemaining <= 0) {
      window.ghostsFrozen = false;
      ghostsFrozenRemaining = 0;
      ghosts3D.forEach(g => {
        g.children.forEach(c => { if (c.isPointLight) c.intensity = 80; });
      });
      triggerNotification("ghosts reactivated!");
    }
  }

  if (alarmFlashRemaining > 0) {
    alarmFlashRemaining -= delta;
    if (alarmFlashRemaining <= 0) {
      alarmFlashRemaining = 0;
      const flash = document.getElementById('alarm-flash');
      if (flash) flash.style.display = 'none';
    }
  }

  if (window.flashlightDisabledBySiphon && typeof window.siphonDurationTimer === 'number') {
    window.siphonDurationTimer -= delta;
    if (window.siphonDurationTimer <= 0) {
      window.flashlightDisabledBySiphon = false;
      window.siphonDurationTimer = 0;
    }
  }

  if (window.sensorsScrambled && typeof window.scrambleDurationTimer === 'number') {
    window.scrambleDurationTimer -= delta;
    if (window.scrambleDurationTimer <= 0) {
      window.sensorsScrambled = false;
      window.scrambleDurationTimer = 0;
    }
  }

  if (saltTraps.length > 0) {
    for (let sIdx = saltTraps.length - 1; sIdx >= 0; sIdx--) {
      const sTrap = saltTraps[sIdx];
      if (sTrap && sTrap.userData && sTrap.userData.triggered && typeof sTrap.userData.dissolveTimer === 'number') {
        sTrap.userData.dissolveTimer -= delta;
        if (sTrap.userData.dissolveTimer <= 0) {
          scene.remove(sTrap);
          if (sTrap.geometry) sTrap.geometry.dispose();
          if (sTrap.material) sTrap.material.dispose();
          saltTraps.splice(sIdx, 1);
        }
      }
    }
  }

  if (typeof chalkDecals !== 'undefined' && chalkDecals.length > 0) {
    for (let cIdx = chalkDecals.length - 1; cIdx >= 0; cIdx--) {
      const cDecal = chalkDecals[cIdx];
      if (cDecal && cDecal.userData && cDecal.userData.triggered && typeof cDecal.userData.fadeTimer === 'number') {
        cDecal.userData.fadeTimer -= delta;
        if (cDecal.userData.fadeTimer <= 0) {
          scene.remove(cDecal);
          if (cDecal.geometry) cDecal.geometry.dispose();
          if (cDecal.material) cDecal.material.dispose();
          chalkDecals.splice(cIdx, 1);
        }
      }
    }
  }

  // Update active 3D character animation mixers (e.g. Breathing Idle)
  if (activeAnimationMixers.length > 0) {
    for (let mIdx = activeAnimationMixers.length - 1; mIdx >= 0; mIdx--) {
      const mixer = activeAnimationMixers[mIdx];
      const root = mixer ? mixer.getRoot() : null;
      if (!root || !root.parent) {
        activeAnimationMixers.splice(mIdx, 1);
      } else {
        mixer.update(delta);
      }
    }
  }

  // Floating bob animation for Ariadne's thread orbs (O(1) cached list, zero scene traversal)
  const ariadneOrbs = window.ariadneOrbs;
  if (ariadneOrbs && ariadneOrbs.length > 0) {
    const t = time * 0.003;
    for (let oIdx = 0; oIdx < ariadneOrbs.length; oIdx++) {
      ariadneOrbs[oIdx].position.y = 0.35 + Math.sin(t + oIdx * 0.4) * 0.08;
    }
  }

  // Floating hover & smooth rotation for 3D maze items (EMF, batteries, cameras, etc.)
  if (itemsInMaze && itemsInMaze.length > 0) {
    const t = time * 0.003;
    for (let i = 0; i < itemsInMaze.length; i++) {
      const it = itemsInMaze[i];
      if (!it || !it.mesh) continue;
      if (it.mesh.userData && (it.mesh.userData.sprite || it.mesh.userData.badge)) {
        const itemObj = it.mesh.userData.sprite || it.mesh.userData.badge;
        itemObj.position.y = Math.sin(t + (it.mesh.userData.bobOffset || i)) * 0.04;
        if (it.mesh.userData.badge) {
          it.mesh.userData.badge.rotation.y = time * 0.0018 + i;
        }
        if (it.mesh.userData.ring && it.mesh.userData.ring.material) {
          it.mesh.userData.ring.material.opacity = 0.35 + Math.sin(time * 0.004 + i) * 0.15;
        }
      } else {
        it.mesh.rotation.y = time * 0.0018 + i;
      }
    }
  }

  // Gentle hover & rotation for maze keys
  if (keysInMaze && keysInMaze.length > 0) {
    const t = time * 0.003;
    for (let i = 0; i < keysInMaze.length; i++) {
      const k = keysInMaze[i];
      if (!k || !k.mesh) continue;
      k.mesh.rotation.y = time * 0.002 + i;
      k.mesh.position.y = 0.45 + Math.sin(t + i * 0.8) * 0.05;
    }
  }

  // Active controls: on desktop, allow movement physics if pointer lock is active OR if interacting with minimap OR unpaused in-game
  const isActive = isMobileDevice 
    ? (window.mobileGameActive && (!isCaptured || window.isSpectating)) 
    : ((Boolean(document.pointerLockElement) || isMinimapOpen || (!isPauseMenuOpen && window.gameReady)) && (!isCaptured || window.isSpectating));

  // Auto-close keypad if player moves away from the terminal station (> 5.5m)
  if (isKeypadOpen) {
    const padTarget = (gateKeypadWorldPos && gateKeypadWorldPos.lengthSq() > 0)
      ? gateKeypadWorldPos
      : new THREE.Vector3(gateCoordinates.x, 1.5, gateCoordinates.z);
    const distToKeypad = camera.position.distanceTo(padTarget);
    if (distToKeypad > 5.5) {
      if (keypadModalEl) {
        keypadModalEl.style.display = 'none';
        codeEntered = '';
        if (!window.isMobileDevice && window.gameReady && !isCaptured && window.requestGamePointerLock) {
          window.requestGamePointerLock();
        }
      }
    }
  }

  if (isActive) {
    if (!isMobileDevice) {
      moveForward = currentlyHeldKeys.has('KeyW') || currentlyHeldKeys.has('ArrowUp');
      moveBackward = currentlyHeldKeys.has('KeyS') || currentlyHeldKeys.has('ArrowDown');
      moveLeft = currentlyHeldKeys.has('KeyA') || currentlyHeldKeys.has('ArrowLeft');
      moveRight = currentlyHeldKeys.has('KeyD') || currentlyHeldKeys.has('ArrowRight');
      if (myTeam === 'Human') {
        const wantsSprint = currentlyHeldKeys.has('ShiftLeft') || currentlyHeldKeys.has('ShiftRight');
        if (wantsSprint && !isSprintExhausted && stamina > 0) {
          isSprinting = true;
        } else if (!wantsSprint) {
          isSprinting = false;
        }
      }
    }

    // 1. Process movement physics with friction
    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;

    direction.z = Number(moveForward) - Number(moveBackward);
    direction.x = Number(moveRight) - Number(moveLeft);
    direction.normalize(); // Ensure consistent speed

    let speed = myTeam === 'Ghost' ? 50.0 : 90.0;
    if (myTeam === 'Ghost' && myClass === 'Juggernaut') speed = 65.0;
    
    if (window.isSpectating) speed = 250.0; // Fast roaming

    // --- Sprint logic (humans only) ---
    if (myTeam === 'Human') {
      const moving = moveForward || moveBackward || moveLeft || moveRight;
      if (isSprinting) {
        if (moving && stamina > 0) {
          speed *= 1.55; // sprint multiplier (up to 13.95 m/s)
          stamina = Math.max(0, stamina - STAMINA_DRAIN_RATE * delta);
          if (stamina <= 0) {
            stamina = 0;
            isSprinting = false;
            mobileSprintLocked = false;
            isSprintExhausted = true; // Lock sprint until 20% recovered
            const jb = document.getElementById('joystick-base');
            const jk = document.getElementById('joystick-knob');
            if (jb) jb.classList.remove('sprinting');
            if (jk) jk.classList.remove('sprinting');
            const sb = document.getElementById('btn-mobile-sprint');
            if (sb) sb.classList.remove('sprinting');
          }
        } else if (!moving) {
          // Stationary while sprint is toggled: slowly regenerate stamina without cancelling sprint mode
          stamina = Math.min(100, stamina + STAMINA_REGEN_RATE * 0.5 * delta);
          if (isSprintExhausted && stamina >= SPRINT_RECOVERY_THRESHOLD) {
            isSprintExhausted = false;
          }
        }
      } else {
        stamina = Math.min(100, stamina + STAMINA_REGEN_RATE * delta);
        if (isSprintExhausted && stamina >= SPRINT_RECOVERY_THRESHOLD) {
          isSprintExhausted = false;
        }
      }
      // Update stamina bar
      const stBar = document.getElementById('stamina-bar');
      const stVal = document.getElementById('stamina-value');
      if (stBar) {
        stBar.style.width = `${stamina}%`;
        if (isSprintExhausted) {
          stBar.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
        } else {
          stBar.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
        }
      }
      if (stVal) {
        if (isSprintExhausted) {
          stVal.textContent = `${Math.ceil(stamina)}% (EXHAUSTED)`;
          stVal.style.color = '#ef4444';
        } else {
          stVal.textContent = `${Math.ceil(stamina)}%`;
          stVal.style.color = '';
        }
      }
    }

    if (speedBoostTimer > 0) {
      speedBoostTimer -= delta;
      if (myTeam === 'Ghost') {
        // Mode-scaled Juggernaut rage speeds (Easy: 5.5 m/s, Med: 7.5 m/s, Hard: 9.5 m/s, Impossible: 10.5 m/s)
        if (myClass === 'Juggernaut') {
          if (window.gameDifficulty === 'easy') speed = 55.0;
          else if (window.gameDifficulty === 'medium') speed = 75.0;
          else if (window.gameDifficulty === 'hard') speed = 95.0;
          else speed = 105.0;
        } else {
          speed = Math.min(78.0, speed * 1.25);
        }
      } else {
        speed *= 1.5;
      }
    }

    // Freeze effect (Breaker Remote)
    if (myTeam === 'Ghost') {
      if (window.ghostsFrozen) {
        speed = 0;
        velocity.set(0, 0, 0);
      }
    }

    const prevPlayerX = camera.position.x;
    const prevPlayerZ = camera.position.z;

    if (window.isSpectating) {
      // 6-DOF Free-Cam Spectator Flight using preallocated scratch vectors
      camera.getWorldDirection(_scratchVec3_1);
      _scratchVec3_2.crossVectors(_scratchVec3_1, camera.up).normalize();

      if (moveForward || moveBackward) {
        camera.position.addScaledVector(_scratchVec3_1, direction.z * (speed / 10.0) * delta);
      }
      if (moveLeft || moveRight) {
        camera.position.addScaledVector(_scratchVec3_2, direction.x * (speed / 10.0) * delta);
      }
    } else {
      if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
      if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;

      camera.translateX(-velocity.x * delta);
      camera.translateZ(velocity.z * delta);
      camera.position.y = 1.6; // Lock height if not spectating
    }

    // High-Performance O(1) Spatial Grid AABB Wall Collision Checking
    if (!window.isSpectating) {
      const playerRadius = 0.8;
      const blockSize = mazeBlockSize || 4.5;
      const wallHalfSize = blockSize / 2;
      const totalCols = (mazeLayout && mazeLayout[0]) ? mazeLayout[0].length : mazeSizeGlobal;
      const totalRows = mazeLayout ? mazeLayout.length : mazeSizeGlobal;

      // Convert player position to maze grid coordinates
      const pGridC = Math.floor((camera.position.x / blockSize) + totalCols / 2);
      const pGridR = Math.floor((camera.position.z / blockSize) + totalRows / 2);

      // Run two iterations to smoothly resolve corner pinches
      for (let iter = 0; iter < 2; iter++) {
        const px = camera.position.x;
        const pz = camera.position.z;

        // 1. Test immediate 3x3 grid neighborhood for static walls
        for (let r = Math.max(0, pGridR - 1); r <= Math.min(totalRows - 1, pGridR + 1); r++) {
          for (let c = Math.max(0, pGridC - 1); c <= Math.min(totalCols - 1, pGridC + 1); c++) {
            if (mazeLayout && mazeLayout[r] && mazeLayout[r][c] === 1) {
              const wx = (c - totalCols / 2) * blockSize + blockSize / 2;
              const wz = (r - totalRows / 2) * blockSize + blockSize / 2;

              const overlapX = (wallHalfSize + playerRadius) - Math.abs(px - wx);
              const overlapZ = (wallHalfSize + playerRadius) - Math.abs(pz - wz);

              if (overlapX > 0 && overlapZ > 0) {
                if (overlapX < overlapZ) {
                  camera.position.x += (px > wx ? overlapX : -overlapX);
                } else {
                  camera.position.z += (pz > wz ? overlapZ : -overlapZ);
                }
              }
            }
          }
        }

        // 2. Test active dynamic walls (sliding doors & gate blocker)
        for (let i = 0; i < walls.length; i++) {
          const wall = walls[i];
          if (wall.position.y < -0.5) continue; // Skip lowered sliding doors
          
          const wx = wall.position.x;
          const wz = wall.position.z;
          const hx = (wall.userData && wall.userData.halfSizeX) ? wall.userData.halfSizeX : wallHalfSize;
          const hz = (wall.userData && wall.userData.halfSizeZ) ? wall.userData.halfSizeZ : wallHalfSize;

          const overlapX = (hx + playerRadius) - Math.abs(camera.position.x - wx);
          const overlapZ = (hz + playerRadius) - Math.abs(camera.position.z - wz);

          if (overlapX > 0 && overlapZ > 0) {
            if (overlapX < overlapZ) {
              camera.position.x += (camera.position.x > wx ? overlapX : -overlapX);
            } else {
              camera.position.z += (camera.position.z > wz ? overlapZ : -overlapZ);
            }
          }
        }

        // 3. Solid Dungeon Props Collision (Spatial grid check - O(1))
        const playerBodyRadius = 0.45;
        if (dungeonPropGrid && dungeonPropGrid.size > 0) {
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const bucket = dungeonPropGrid.get(((pGridR + dr) * 1000) + (pGridC + dc));
              if (!bucket) continue;
              for (let i = 0; i < bucket.length; i++) {
                const prop = bucket[i];
                if (prop.slidingWallRef && prop.slidingWallRef.position.y < -0.5) continue;
                const dx = camera.position.x - prop.x;
                const dz = camera.position.z - prop.z;
                const maxD = prop.radius + playerBodyRadius;
                if (Math.abs(dx) > maxD || Math.abs(dz) > maxD) continue; // Fast AABB prune
                const dist = Math.hypot(dx, dz);
                if (dist < maxD && dist > 0.0001) {
                  const overlap = maxD - dist;
                  camera.position.x += (dx / dist) * overlap;
                  camera.position.z += (dz / dist) * overlap;
                }
              }
            }
          }
        }
      }

      // Hard Map Boundary Safety Clamp (Prevents glitching outside walls or void falling)
      const maxPlayableLimit = (mazeSizeGlobal / 2 - 1.0) * blockSize;
      camera.position.x = Math.max(-maxPlayableLimit, Math.min(maxPlayableLimit, camera.position.x));
      camera.position.z = Math.max(-maxPlayableLimit, Math.min(maxPlayableLimit, camera.position.z));
      if (camera.position.y < -2.0 || isNaN(camera.position.y)) {
        const sx = (window.humanSpawnPos && !isNaN(window.humanSpawnPos.x)) ? window.humanSpawnPos.x : 0;
        const sz = (window.humanSpawnPos && !isNaN(window.humanSpawnPos.z)) ? window.humanSpawnPos.z : 0;
        camera.position.set(sx, 1.6, sz); // Safety recovery to center spawn
        velocity.set(0, 0, 0);
      }

      // 4. Post-Collision Motion Analysis & Dynamic Animation State Selection
      const actualDispX = camera.position.x - prevPlayerX;
      const actualDispZ = camera.position.z - prevPlayerZ;
      const actualDistMoved = Math.hypot(actualDispX, actualDispZ);
      const instantaneousSpeed = actualDistMoved / Math.max(0.0001, delta);

      // Smooth ground speed to eliminate single-frame collision jitter (responsive 15 Hz lerp)
      localPlayerGroundSpeed = THREE.MathUtils.lerp(
        localPlayerGroundSpeed,
        instantaneousSpeed,
        Math.min(1.0, delta * 15.0)
      );

      // Reconcile and synchronize localPlayerVisual position with resolved camera position
      if (localPlayerVisual) {
        localPlayerVisual.position.x = camera.position.x;
        localPlayerVisual.position.z = camera.position.z;
        if (localPlayerVisual.userData && localPlayerVisual.userData.animMixer) {
          localPlayerVisual.position.y = myTeam === 'Ghost' ? 0.35 : 0;
        }
        localPlayerVisual.rotation.set(0, camera.rotation.y, 0);
      }

      // Synchronize 3rd-person activeViewCamera immediately to prevent 1-frame camera lag
      syncActiveViewCamera();

      // Detect whether player is physically moving or blocked against an obstacle/wall
      const hasMoveInput = Boolean(moveForward || moveBackward || moveLeft || moveRight);
      const isBlockedByWall = hasMoveInput && (localPlayerGroundSpeed < 0.45 && instantaneousSpeed < 0.35);

      if (isBlockedByWall) {
        // Dampen residual physics velocity while running directly into obstacles to prevent vibration
        velocity.x *= 0.1;
        velocity.z *= 0.1;
      }

      const isEffectivelyMoving = hasMoveInput && !isBlockedByWall && (localPlayerGroundSpeed >= 0.35);

      // Update local player 3D locomotion animation state
      if (localPlayerVisual && localPlayerVisual.userData && localPlayerVisual.userData.animMixer) {
        let desired = 'idle';
        let playbackRate = 1.0;

        if (isEffectivelyMoving) {
          const absX = Math.abs(direction.x);
          const absZ = Math.abs(direction.z);
          if ((moveLeft || moveRight) && (absX >= absZ || (!moveForward && !moveBackward))) {
            desired = moveLeft ? 'strafeLeft' : 'strafeRight';
          } else if (moveForward) {
            desired = (isSprinting && localPlayerGroundSpeed > 7.0) ? 'sprint' : 'walk';
          } else if (moveBackward) {
            desired = 'walkBack';
          } else if (moveLeft) {
            desired = 'strafeLeft';
          } else if (moveRight) {
            desired = 'strafeRight';
          } else {
            desired = 'walk';
          }

          // Dynamically scale animation speed to match actual ground speed (Base reference: 7.0 m/s)
          playbackRate = THREE.MathUtils.clamp(localPlayerGroundSpeed / 7.0, 0.45, 1.55);
        } else {
          desired = 'idle';
          playbackRate = 1.0;
        }

        setHumanLocomotionAction(localPlayerVisual, desired, 0.15, playbackRate);
        localPlayerVisual.rotation.z = 0;
      } else if (localPlayerVisual) {
        // Procedural stride bob, sway, forward lean, and idle breathing for static 3D meshes (Standard Issue GLB & Hazmat Suit)
        if (isEffectivelyMoving) {
          const moveSpeed = (isSprinting ? 12 : 7) * THREE.MathUtils.clamp(localPlayerGroundSpeed / 7.0, 0.5, 1.4);
          localPlayerVisual.userData.walkCycle = (localPlayerVisual.userData.walkCycle || 0) + delta * moveSpeed;
          const baseFootY = myTeam === 'Ghost' ? 0.35 : 0;
          localPlayerVisual.position.y = baseFootY + Math.abs(Math.sin(localPlayerVisual.userData.walkCycle)) * 0.06;
          const rollSway = Math.sin(localPlayerVisual.userData.walkCycle * 0.5) * 0.04;
          const pitchLean = isSprinting ? -0.08 : -0.025;
          localPlayerVisual.rotation.set(pitchLean, camera.rotation.y, rollSway, 'YXZ');
        } else {
          const baseFootY = myTeam === 'Ghost' ? 0.35 : 0;
          localPlayerVisual.position.y = baseFootY + Math.sin(time * 0.003) * 0.015;
          localPlayerVisual.rotation.set(0, camera.rotation.y, 0, 'YXZ');
        }
      }
    }
  } else {
    // When controls are inactive (paused, cursor released, overlay open):
    resetPlayerMovementState();
    if (localPlayerVisual) {
      localPlayerVisual.position.x = camera.position.x;
      localPlayerVisual.position.z = camera.position.z;
      if (localPlayerVisual.userData && localPlayerVisual.userData.animMixer) {
        localPlayerVisual.position.y = myTeam === 'Ghost' ? 0.35 : 0;
      }
      localPlayerVisual.rotation.set(0, camera.rotation.y, 0);
    }
    syncActiveViewCamera(delta);
  }

  if (window.gameReady) {
    // 2. Active sensors & sanity ticks (runs continuously even when minimap is open)
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
        triggerNotification(myTeam === 'Ghost' ? "Shadow Cloak Ended" : "Invisibility Deactivated");
        
        // Restore local player visual opacity
        if (localPlayerVisual) {
          localPlayerVisual.traverse(c => {
            if ((c.isMesh || c.isSprite) && c.material) {
              c.material.opacity = 1.0;
              c.material.depthWrite = true;
              c.material.needsUpdate = true;
            }
          });
        }

        if (socketClient) {
          socketClient.emit('invisibility_ended');
        }
      }
    } 
    
    // Process Thermal Camera regardless of panic (skip if spectating or escaping)
    if (window.isEscaping) {
      if (scene) {
        scene.background = new THREE.Color(0x6bb5ea); // Retain clear sky blue
        if (scene.fog) {
          scene.fog.color.setHex(0x9fd2ee); // Soft atmospheric aerial perspective
          scene.fog.density = 0.0035; // Expansive outdoor sightlines
        }
      }
    } else if (window.isSpectating) {
      if (scene && scene.fog) scene.fog = null;
      if (ambientLight) {
        ambientLight.color.setHex(0xffffff);
        ambientLight.intensity = 4.0;
      }
    } else if (myTeam === 'Human') {
      const isThermalActive = (inventory[activeSlot] === "Thermal Camera");
      if (typeof window._lastThermalActive === 'undefined' || window._lastThermalActive !== isThermalActive) {
        window._lastThermalActive = isThermalActive;
        if (isThermalActive) {
          if (!scene.fog) scene.fog = new THREE.FogExp2(0x330000, 0.015);
          scene.fog.color.setHex(0x330000);
          scene.fog.density = 0.015; // Red thermal vision

          // Make AI ghosts bright and glowing (red heat signature)
          ghosts3D.forEach(g => {
            g.traverse(c => {
              if ((c.isMesh || c.isSprite) && c.userData.thermalMat) {
                c.material = c.userData.thermalMat;
                c.renderOrder = 999;
              }
            });
          });
          // Make network players (Ghosts in red, Teammates in cyan) visible through walls
          Object.values(players3D).forEach(p => {
            p.traverse(c => {
              if ((c.isMesh || c.isSprite) && c.userData.thermalMat) {
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

          // Restore normal materials for AI ghosts
          ghosts3D.forEach(g => {
            g.traverse(c => {
              if ((c.isMesh || c.isSprite) && c.userData.normalMat) {
                c.material = c.userData.normalMat;
                c.renderOrder = 0;
              }
            });
          });
          // Restore normal materials for network players
          Object.values(players3D).forEach(p => {
            p.traverse(c => {
              if ((c.isMesh || c.isSprite) && c.userData.normalMat) {
                c.material = c.userData.normalMat;
                c.renderOrder = 0;
              }
            });
          });
        }
      }
    }

    // Damage check against network Ghost players (including disguised Mimics)
    Object.values(players3D).forEach(p => {
      if (p.userData && (p.userData.type === 'Ghost' || p.userData.isGhost)) {
        applyGhostDamageToHuman(p.position, delta);
        checkChalkDecals(p.position);
      }
    });

    // Deterministic Grid-Plane & Exposed Corner Collision Solver for Ghost AI
    // Guarantees ghosts can NEVER penetrate, corner-squeeze, or phase through walls or alcoves
    function resolveGhostCollision(ghost) {
      if (!ghost || !ghost.position || !mazeLayout || !mazeLayout[0]) return;
      const blockSize = mazeBlockSize || 6.0;
      const ghostRadius = 0.55;
      const totalCols = mazeLayout[0].length;
      const totalRows = mazeLayout.length;
      const halfBlock = blockSize / 2;
      const isSolid = (v) => (v === 1 || v === 2);

      for (let pass = 0; pass < 2; pass++) {
        const px = ghost.position.x;
        const pz = ghost.position.z;
        const col = Math.max(0, Math.min(totalCols - 1, Math.floor((px / blockSize) + totalCols / 2)));
        const row = Math.max(0, Math.min(totalRows - 1, Math.floor((pz / blockSize) + totalRows / 2)));

        const currentCellVal = mazeLayout[row] ? mazeLayout[row][col] : 1;

        if (isSolid(currentCellVal)) {
          // Recovery: Ghost has penetrated inside a solid wall cell. Immediately eject to nearest open neighbor!
          const dirs = [
            { dc: 0, dr: -1, axis: 'z', sign: -1 }, // North
            { dc: 0, dr: 1, axis: 'z', sign: 1 },   // South
            { dc: -1, dr: 0, axis: 'x', sign: -1 }, // West
            { dc: 1, dr: 0, axis: 'x', sign: 1 }    // East
          ];
          let bestDir = null;
          let minDisplacement = Infinity;

          for (const d of dirs) {
            const nc = col + d.dc;
            const nr = row + d.dr;
            if (nr >= 0 && nr < totalRows && nc >= 0 && nc < totalCols && mazeLayout[nr] && mazeLayout[nr][nc] === 0) {
              if (d.axis === 'z') {
                const edgeZ = (d.sign < 0) ? (row - totalRows / 2) * blockSize : (row + 1 - totalRows / 2) * blockSize;
                const disp = Math.abs(pz - edgeZ);
                if (disp < minDisplacement) {
                  minDisplacement = disp;
                  bestDir = { ...d, target: edgeZ + d.sign * ghostRadius };
                }
              } else {
                const edgeX = (d.sign < 0) ? (col - totalCols / 2) * blockSize : (col + 1 - totalCols / 2) * blockSize;
                const disp = Math.abs(px - edgeX);
                if (disp < minDisplacement) {
                  minDisplacement = disp;
                  bestDir = { ...d, target: edgeX + d.sign * ghostRadius };
                }
              }
            }
          }

          if (bestDir) {
            if (bestDir.axis === 'z') ghost.position.z = bestDir.target;
            else ghost.position.x = bestDir.target;
          }
        } else {
          // Ghost is in an open corridor/alcove cell. Apply hard boundary planes against all cardinal solid neighbors!
          // 1. North neighbor (row - 1)
          if (row > 0 && isSolid(mazeLayout[row - 1][col])) {
            const northEdgeZ = (row - totalRows / 2) * blockSize;
            if (ghost.position.z < northEdgeZ + ghostRadius) {
              ghost.position.z = northEdgeZ + ghostRadius;
            }
          }
          // 2. South neighbor (row + 1)
          if (row < totalRows - 1 && isSolid(mazeLayout[row + 1][col])) {
            const southEdgeZ = (row + 1 - totalRows / 2) * blockSize;
            if (ghost.position.z > southEdgeZ - ghostRadius) {
              ghost.position.z = southEdgeZ - ghostRadius;
            }
          }
          // 3. West neighbor (col - 1)
          if (col > 0 && isSolid(mazeLayout[row][col - 1])) {
            const westEdgeX = (col - totalCols / 2) * blockSize;
            if (ghost.position.x < westEdgeX + ghostRadius) {
              ghost.position.x = westEdgeX + ghostRadius;
            }
          }
          // 4. East neighbor (col + 1)
          if (col < totalCols - 1 && isSolid(mazeLayout[row][col + 1])) {
            const eastEdgeX = (col + 1 - totalCols / 2) * blockSize;
            if (ghost.position.x > eastEdgeX - ghostRadius) {
              ghost.position.x = eastEdgeX - ghostRadius;
            }
          }

          // 5. Diagonal exposed convex corner vertices (smooth rounding around hallway corners)
          const diags = [
            { dc: -1, dr: -1 }, // Northwest
            { dc: 1, dr: -1 },  // Northeast
            { dc: -1, dr: 1 },  // Southwest
            { dc: 1, dr: 1 }   // Southeast
          ];

          for (const dg of diags) {
            const diagC = col + dg.dc;
            const diagR = row + dg.dr;
            if (diagR >= 0 && diagR < totalRows && diagC >= 0 && diagC < totalCols) {
              if (isSolid(mazeLayout[diagR][diagC])) {
                const card1Open = !isSolid(mazeLayout[row][diagC]);
                const card2Open = !isSolid(mazeLayout[diagR][col]);
                if (card1Open || card2Open) {
                  const cornerX = (col + (dg.dc > 0 ? 1 : 0) - totalCols / 2) * blockSize;
                  const cornerZ = (row + (dg.dr > 0 ? 1 : 0) - totalRows / 2) * blockSize;
                  const dx = ghost.position.x - cornerX;
                  const dz = ghost.position.z - cornerZ;
                  if (dx * dg.dc < 0 && dz * dg.dr < 0) {
                    const distSq = dx * dx + dz * dz;
                    if (distSq < ghostRadius * ghostRadius && distSq > 0.0001) {
                      const dist = Math.sqrt(distSq);
                      ghost.position.x = cornerX + (dx / dist) * ghostRadius;
                      ghost.position.z = cornerZ + (dz / dist) * ghostRadius;
                    }
                  }
                }
              }
            }
          }
        }

        // Dynamic sliding door meshes collision (if raised)
        if (walls && walls.length > 0) {
          for (let i = 0; i < walls.length; i++) {
            const wall = walls[i];
            if (wall.position.y < -0.5) continue; // Skip lowered doors
            const wx = wall.position.x;
            const wz = wall.position.z;
            const hx = (wall.userData && wall.userData.halfSizeX) ? wall.userData.halfSizeX : halfBlock;
            const hz = (wall.userData && wall.userData.halfSizeZ) ? wall.userData.halfSizeZ : halfBlock;

            const minX = wx - hx - ghostRadius;
            const maxX = wx + hx + ghostRadius;
            const minZ = wz - hz - ghostRadius;
            const maxZ = wz + hz + ghostRadius;

            if (ghost.position.x > minX && ghost.position.x < maxX &&
                ghost.position.z > minZ && ghost.position.z < maxZ) {
              const penLeft = ghost.position.x - minX;
              const penRight = maxX - ghost.position.x;
              const penTop = ghost.position.z - minZ;
              const penBottom = maxZ - ghost.position.z;

              const minPenX = penLeft < penRight ? -penLeft : penRight;
              const minPenZ = penTop < penBottom ? -penTop : penBottom;
              if (Math.abs(minPenX) < Math.abs(minPenZ)) {
                ghost.position.x += minPenX;
              } else {
                ghost.position.z += minPenZ;
              }
            }
          }
        }

        // Dungeon Props Collision (Spatial grid check - O(1))
        if (dungeonPropGrid && dungeonPropGrid.size > 0) {
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const bucket = dungeonPropGrid.get(((row + dr) * 1000) + (col + dc));
              if (!bucket) continue;
              for (let i = 0; i < bucket.length; i++) {
                const prop = bucket[i];
                if (prop.slidingWallRef && prop.slidingWallRef.position.y < -0.5) continue;
                const dx = ghost.position.x - prop.x;
                const dz = ghost.position.z - prop.z;
                const maxD = prop.radius + ghostRadius;
                if (Math.abs(dx) > maxD || Math.abs(dz) > maxD) continue;
                const dist = Math.hypot(dx, dz);
                if (dist < maxD && dist > 0.0001) {
                  const overlap = maxD - dist;
                  ghost.position.x += (dx / dist) * overlap;
                  ghost.position.z += (dz / dist) * overlap;
                }
              }
            }
          }
        }
      }

      // Hard Map Boundary Safety Clamp
      const maxPlayableLimit = (mazeSizeGlobal / 2 - 1.0) * blockSize;
      ghost.position.x = Math.max(-maxPlayableLimit, Math.min(maxPlayableLimit, ghost.position.x));
      ghost.position.z = Math.max(-maxPlayableLimit, Math.min(maxPlayableLimit, ghost.position.z));
      if (isNaN(ghost.position.x) || isNaN(ghost.position.z) || ghost.position.y < -2.0) {
        const spawnCell = openCorridors && openCorridors.length > 0 ? openCorridors[0] : { x: 0, z: 0 };
        ghost.position.set(spawnCell.x, 0.35, spawnCell.z);
      }
    }

    // 4. Update AI Bots pathing behaviors toward nearest human
    ghosts3D.forEach((ghost, idx) => {
      // Handle Mimic disguise countdown (delta-based so it pauses cleanly in solo matches)
      if (ghost.userData && ghost.userData.isMimicDisguised && typeof ghost.userData.mimicDurationTimer === 'number') {
        ghost.userData.mimicDurationTimer -= delta;
        if (ghost.userData.mimicDurationTimer <= 0) {
          revertMimicDisguise(ghost);
        }
      }

      // Breaker Remote freezes all ghost movement
      if (window.ghostsFrozen) return;

      const prevGhostX = ghost.position.x;
      const prevGhostZ = ghost.position.z;

      // Find nearest human
      let nearestHumanPos = null;
      let minDist = Infinity;
      let closestHumanId = null;
      
      if (myTeam === 'Human' && !isPanicked && !isCaptured) {
        const d = ghost.position.distanceTo(camera.position);
        if (d < minDist) {
          minDist = d;
          _scratchNearestHuman.set(camera.position.x, ghost.position.y, camera.position.z);
          nearestHumanPos = _scratchNearestHuman;
          closestHumanId = myId || 'local_human';
        }
      }
      for (const pId in players3D) {
        const p = players3D[pId];
        const isDead = Boolean((p && p.userData && p.userData.isCaptured) || (currentLobby && currentLobby.players && currentLobby.players[pId] && currentLobby.players[pId].isCaptured));
        if (p && p.userData && p.userData.type === 'Human' && !isDead && !p.userData.isPanicked) {
          const d = ghost.position.distanceTo(p.position);
          if (d < minDist) {
            minDist = d;
            _scratchNearestHuman.set(p.position.x, ghost.position.y, p.position.z);
            nearestHumanPos = _scratchNearestHuman;
            closestHumanId = pId;
          }
        }
      }

      const distToPlayer = minDist !== Infinity ? minDist : 9999;
      const targetPos = nearestHumanPos;

      // Distance culling for ghost dynamic light: prevents 8 simultaneous point lights melting GPU (hidden while Mimic is disguised)
      if (ghost.userData && ghost.userData.auraLight) {
        ghost.userData.auraLight.visible = !ghost.userData.isMimicDisguised && (distToPlayer < 14.0);
      }

      // Damage check uses actual distance to PLAYER (only damages humans)
      applyGhostDamageToHuman(ghost.position, delta);
      checkChalkDecals(ghost.position);

      // Check salt traps (triggering & consumption)
      let baseMoveSpeed = 3.8;
      let juggernautSpeed = 5.2;
      let juggernautRageSpeed = 7.5;
      let standardSurgeSpeed = 5.2;

      if (window.gameDifficulty === 'easy') {
        baseMoveSpeed = 2.8;
        juggernautSpeed = 4.2;
        juggernautRageSpeed = 5.5;
        standardSurgeSpeed = 3.8;
      } else if (window.gameDifficulty === 'hard') {
        baseMoveSpeed = 4.8;
        juggernautSpeed = 6.2;
        juggernautRageSpeed = 9.5;
        standardSurgeSpeed = 6.8;
      } else if (window.gameDifficulty === 'impossible') {
        baseMoveSpeed = 5.8;
        juggernautSpeed = 7.0;
        juggernautRageSpeed = 10.5;
        standardSurgeSpeed = 7.8;
      }

      let moveSpeed = (ghost.userData.ghostClass === 'Juggernaut') ? juggernautSpeed : baseMoveSpeed;
      if (ghost.userData && ghost.userData.isPracticeGhost) {
        moveSpeed = 2.8;
      }

      // In Impossible and Hard modes, ghosts can trigger occasional speed surges
      if (window.gameDifficulty === 'impossible' || window.gameDifficulty === 'hard') {
        if (!ghost.userData.randomBoostTimer) {
          ghost.userData.randomBoostTimer = 6.0 + Math.random() * 8.0;
        } else {
          ghost.userData.randomBoostTimer -= delta;
          if (ghost.userData.randomBoostTimer <= 0) {
            ghost.userData.speedBoostTimer = 3.5;
            ghost.userData.randomBoostTimer = 9.0 + Math.random() * 10.0;
          }
        }
      }

      if (ghost.userData.speedBoostTimer && ghost.userData.speedBoostTimer > 0) {
        ghost.userData.speedBoostTimer -= delta;
        moveSpeed = (ghost.userData.ghostClass === 'Juggernaut') ? juggernautRageSpeed : standardSurgeSpeed;
      }

      // Hard safety limit: Normal ghosts capped at standardSurgeSpeed; Juggernauts capped at juggernautRageSpeed
      const maxAllowed = (ghost.userData.ghostClass === 'Juggernaut') ? juggernautRageSpeed : standardSurgeSpeed;
      moveSpeed = Math.min(maxAllowed, moveSpeed);
      for (let i = saltTraps.length - 1; i >= 0; i--) {
        const trap = saltTraps[i];
        if (ghost.position.distanceTo(trap.position) < 2.5) {
          moveSpeed = 1.0;
          if (!trap.userData || !trap.userData.triggered) {
            trap.userData = trap.userData || {};
            trap.userData.triggered = true;
            trap.userData.dissolveTimer = 3.0; // Dissolve handled in animate loop via delta
            if (myTeam === 'Human') {
              triggerNotification("Salt barrier disturbed by a ghost!");
            }
          }
        }
      }

      // AI State Machine Initialization
      const gParams = getGhostAbilityParams();
      if (!ghost.userData.aiState) {
        ghost.userData.aiState = 'WANDER';
        ghost.userData.targetGrid = null;
        ghost.userData.loseSightTimer = 0;
        ghost.userData.lastSoundTime = 0;
        const initialSpread = gParams.botAbilityCooldownMax - gParams.botAbilityCooldownMin;
        ghost.userData.abilityCooldown = gParams.botAbilityCooldownMin + Math.random() * initialSpread;
      }

      // High-Performance Grid-Based Line of Sight (LOS) + Spectral Proximity Scent
      let hasDirectLos = false;
      if (targetPos && distToPlayer < gParams.botSightRange) {
        hasDirectLos = hasGridLineOfSight(ghost.position.x, ghost.position.z, targetPos.x, targetPos.z);
      }
      // Direct visual line of sight OR spectral proximity scent within 8.0m
      const canSeePlayer = hasDirectLos || (targetPos && distToPlayer < 8.0);

      // State Transitions
      if (canSeePlayer && targetPos) {
        ghost.userData.aiState = 'CHASE';
        ghost.userData.loseSightTimer = 0;
        ghost.userData.chasedTargetId = closestHumanId;
      } else if (ghost.userData.aiState === 'CHASE') {
        if (!targetPos) {
          ghost.userData.aiState = 'WANDER';
          ghost.userData.targetGrid = null;
          ghost.userData.path = null;
          ghost.userData.pathTime = 0;
          ghost.userData.chasedTargetId = null;
        } else {
          ghost.userData.loseSightTimer += delta;
          if (ghost.userData.loseSightTimer > gParams.botLoseSightDuration) {
            ghost.userData.aiState = 'WANDER'; // Lost player
            ghost.userData.targetGrid = null;
            ghost.userData.path = null;
            ghost.userData.pathTime = 0;
            ghost.userData.chasedTargetId = null;
          }
        }
      }

      // Practice Ghost in Training Drill strictly locks to CHASE mode targeting the player
      if (ghost.userData && ghost.userData.isPracticeGhost) {
        ghost.userData.aiState = 'CHASE';
        ghost.userData.loseSightTimer = 0;
        ghost.userData.chasedTargetId = closestHumanId;
      }

      // Execute Bot Abilities on human targets
      if (targetPos) {
        if (ghost.userData.abilityCooldown > 0) {
          ghost.userData.abilityCooldown -= delta;
        } else if (distToPlayer < (gParams.botSightRange + 10)) {
          const cdSpread = gParams.botAbilityCooldownMax - gParams.botAbilityCooldownMin;
          ghost.userData.abilityCooldown = gParams.botAbilityCooldownMin + Math.random() * cdSpread;
          const gClass = ghost.userData.ghostClass;
          
          if (gClass === 'Stalker') {
            if (myTeam === 'Human') triggerNotification("A Stalker bot caught your scent!");
            ghost.userData.aiState = 'CHASE';
            ghost.userData.targetGrid = worldToGrid(targetPos.x, targetPos.z);
            ghost.userData.pathTime = 0;
          } else if (gClass === 'Mimic') {
            if (!ghost.userData.isMimicDisguised) {
              ghost.userData.isMimicDisguised = true;
              if (myTeam === 'Human') triggerNotification(`A Mimic bot is disguising itself (${Math.round(gParams.cloneDuration / 1000)}s)!`);
              
              // Exclude the closest person to the bot AND the person it is actively chasing
              const excludedIds = new Set();
              if (closestHumanId) excludedIds.add(closestHumanId);
              if (ghost.userData.chasedTargetId) excludedIds.add(ghost.userData.chasedTargetId);

              // 1. Choose a random teammate from active humans in the labyrinth (excluding closest & chased)
              const eligibleTeammates = [];
              if (myTeam === 'Human' && !isPanicked && !isCaptured && !excludedIds.has(myId || 'local_human')) {
                const myUsername = (currentLobby && currentLobby.players && currentLobby.players[myId]?.username) || 'Operative';
                const mySkin = (currentLobby && currentLobby.players && currentLobby.players[myId]?.skinId) || localStorage.getItem('manifestation_equipped_skin') || 'skin_hazmat';
                const myVip = Boolean((window.isVipActive && window.isVipActive()) || (currentLobby && currentLobby.players && currentLobby.players[myId]?.isVip));
                eligibleTeammates.push({
                  id: myId || 'local_human',
                  username: myUsername,
                  skinId: mySkin,
                  isVip: myVip
                });
              }
              for (const pId in players3D) {
                const p = players3D[pId];
                if (p && p.userData && p.userData.type === 'Human' && !p.userData.isCaptured && !p.userData.isPanicked && !excludedIds.has(pId)) {
                  const lobbyEntry = (currentLobby && currentLobby.players) ? currentLobby.players[pId] : null;
                  const pUsername = (lobbyEntry && lobbyEntry.username) || p.userData.username || 'Operative';
                  const pSkin = (lobbyEntry && lobbyEntry.skinId) || p.userData.skinId || 'skin_hazmat';
                  const pVip = Boolean((lobbyEntry && lobbyEntry.isVip) || p.userData.isVip);
                  eligibleTeammates.push({
                    id: pId,
                    username: pUsername,
                    skinId: pSkin,
                    isVip: pVip
                  });
                }
              }

              let chosenTeammate = null;
              if (eligibleTeammates.length > 0) {
                chosenTeammate = eligibleTeammates[Math.floor(Math.random() * eligibleTeammates.length)];
              } else if (currentLobby && currentLobby.players) {
                // 2. Check general lobby roster for other teammates (even if waiting / captured)
                const eligibleLobby = Object.entries(currentLobby.players)
                  .filter(([pId, pData]) => pData.team !== 'Ghost' && !excludedIds.has(pId))
                  .map(([pId, pData]) => ({
                    id: pId,
                    username: pData.username || 'Operative',
                    skinId: pData.skinId || (pId === myId ? localStorage.getItem('manifestation_equipped_skin') : 'skin_hazmat') || 'skin_hazmat',
                    isVip: Boolean(pData.isVip || (pId === myId && window.isVipActive && window.isVipActive()))
                  }));
                if (eligibleLobby.length > 0) {
                  chosenTeammate = eligibleLobby[Math.floor(Math.random() * eligibleLobby.length)];
                }
              }

              // 3. Fallback for solo/singleplayer matches where only 1 human exists in total
              if (!chosenTeammate) {
                const fallbackSkins = ['skin_soldier', 'skin_hazmat'];
                const fallbackNames = ['Operative_Echo', 'Agent_Cipher', 'Spectre_4', 'Operative_Bravo'];
                chosenTeammate = {
                  id: 'fallback_solo',
                  username: fallbackNames[Math.floor(Math.random() * fallbackNames.length)],
                  skinId: fallbackSkins[Math.floor(Math.random() * fallbackSkins.length)],
                  isVip: Math.random() < 0.25
                };
              }

              const chosenSkin = chosenTeammate.skinId || 'skin_hazmat';
              const chosenUsername = chosenTeammate.username || 'Operative';
              const chosenIsVip = Boolean(chosenTeammate.isVip);

              const mimicGroup = createHumanMeshGroup(chosenSkin, chosenUsername, chosenIsVip);
              mimicGroup.rotation.y = Math.PI; // Aligns human model facing forward (+Z in ghost space) matching ghost lookAt direction
              
              // Thermal camera material setup (Cyan for teammates)
              const meshThermalMat = new THREE.MeshBasicMaterial({ 
                color: 0x38bdf8, 
                fog: false, 
                depthTest: false, 
                side: THREE.DoubleSide 
              });
              mimicGroup.traverse(c => {
                if (c.isMesh) {
                  c.userData.normalMat = c.material;
                  c.userData.thermalMat = meshThermalMat;
                } else if (c.isSprite && !c.userData.isUsernameTag) {
                  c.userData.normalMat = c.material;
                  c.userData.thermalMat = new THREE.SpriteMaterial({
                    map: c.material.map,
                    color: 0x38bdf8,
                    fog: false,
                    depthTest: false,
                    transparent: true,
                    blending: THREE.AdditiveBlending
                  });
                }
              });

              ghost.add(mimicGroup);
              ghost.userData.mimicGroup = mimicGroup;
              
              // Hide the ghost aura lights and phantom meshes
              ghost.children.forEach(c => {
                if (c !== mimicGroup) c.visible = false;
              });
              
              // Start locomotion animations
              if (mimicGroup.userData && mimicGroup.userData.animActions) {
                if (mimicGroup.userData.animActions.idle) {
                  mimicGroup.userData.animActions.idle.stop();
                }
                if (mimicGroup.userData.animActions.walk) {
                  mimicGroup.userData.animActions.walk.reset().play();
                } else if (mimicGroup.userData.animActions.idle) {
                  mimicGroup.userData.animActions.idle.play();
                }
              }
              
              // Disguise duration is decremented by delta in the ghost update loop (cleanly pauses in solo matches)
              ghost.userData.mimicDurationTimer = gParams.cloneDuration / 1000;
            }
          } else if (gClass === 'Juggernaut') {
            if (myTeam === 'Human') triggerNotification(`A Juggernaut bot is enraged (${gParams.rageDurationBot}s)!`);
            ghost.userData.speedBoostTimer = gParams.rageDurationBot;
          } else if (gClass === 'Phantom') {
            if (myTeam === 'Human') triggerNotification(`A Phantom bot used Vapor Leap (${gParams.leapDistanceBot}m)!`);
            const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(ghost.quaternion);
            const maxLeap = gParams.leapDistanceBot;
            const stepSize = 0.3;
            let safeLeapDist = 0;
            const testPos = new THREE.Vector3();
            const leapRadius = 0.55;
            const totalCols = (mazeLayout && mazeLayout[0]) ? mazeLayout[0].length : mazeSizeGlobal;
            const totalRows = mazeLayout ? mazeLayout.length : mazeSizeGlobal;
            const blockSize = mazeBlockSize || 6.0;
            const wallHalfSize = blockSize / 2;

            for (let d = stepSize; d <= maxLeap; d += stepSize) {
              testPos.copy(ghost.position).addScaledVector(forward, d);
              const gC = Math.floor((testPos.x / blockSize) + totalCols / 2);
              const gR = Math.floor((testPos.z / blockSize) + totalRows / 2);
              let hitWall = false;
              for (let r = Math.max(0, gR - 1); r <= Math.min(totalRows - 1, gR + 1); r++) {
                for (let c = Math.max(0, gC - 1); c <= Math.min(totalCols - 1, gC + 1); c++) {
                  if (mazeLayout && mazeLayout[r] && (mazeLayout[r][c] === 1 || mazeLayout[r][c] === 2)) {
                    const wx = (c - totalCols / 2) * blockSize + blockSize / 2;
                    const wz = (r - totalRows / 2) * blockSize + blockSize / 2;
                    if (Math.abs(testPos.x - wx) < (wallHalfSize + leapRadius) &&
                        Math.abs(testPos.z - wz) < (wallHalfSize + leapRadius)) {
                      hitWall = true;
                      break;
                    }
                  }
                }
                if (hitWall) break;
              }
              if (hitWall) break;
              safeLeapDist = d;
            }
            if (safeLeapDist > 0) {
              ghost.position.addScaledVector(forward, safeLeapDist);
              resolveGhostCollision(ghost);
            }
          } else if (gClass === 'Poltergeist') {
            const dist = targetPos.distanceTo(ghost.position);
            if (dist <= gParams.siphonRadius && myTeam === 'Human' && !window.isSpectating) {
              triggerNotification(`Poltergeist bot deployed Breaker Siphon (${Math.round(gParams.siphonDuration / 1000)}s)!`);
              window.flashlightDisabledBySiphon = true;
              window.siphonDurationTimer = gParams.siphonDuration / 1000;
            }
          } else if (gClass === 'Banshee') {
            const dist = targetPos.distanceTo(ghost.position);
            if (dist <= gParams.scrambleRadius && myTeam === 'Human' && !window.isSpectating) {
              triggerNotification(`Banshee bot scrambled your sensors (${Math.round(gParams.scrambleDuration / 1000)}s)!`);
              window.sensorsScrambled = true;
              window.scrambleDurationTimer = gParams.scrambleDuration / 1000;
            }
          }
        }
      }

      // Check Sound Beacons (human noise)
      if (latestSoundBeacon && latestSoundBeacon.time > ghost.userData.lastSoundTime && ghost.userData.aiState !== 'CHASE') {
        const distToSound = ghost.position.distanceTo(new THREE.Vector3(latestSoundBeacon.position.x, ghost.position.y, latestSoundBeacon.position.z));
        let hearingRadius = 0;
        if (latestSoundBeacon.volume <= 1.0) hearingRadius = gParams.hearingWalking * mazeBlockSize; // Walking
        else if (latestSoundBeacon.volume <= 2.0) hearingRadius = gParams.hearingSprinting * mazeBlockSize; // Sprinting
        else if (latestSoundBeacon.volume <= 35) hearingRadius = gParams.hearingWhisper * mazeBlockSize; // Whisper
        else hearingRadius = gParams.hearingScream * mazeBlockSize; // Scream

        if (distToSound <= hearingRadius) {
          ghost.userData.aiState = 'INVESTIGATE';
          ghost.userData.targetGrid = worldToGrid(latestSoundBeacon.position.x, latestSoundBeacon.position.z);
          ghost.userData.pathTime = 0; // Force immediate repath
        }
        ghost.userData.lastSoundTime = latestSoundBeacon.time;
      }

      // BFS Pathfinding — recalculate path periodically, or when waypoint finishes, or when target changes
      const needsRepath = !ghost.userData.path || 
                          !ghost.userData.pathTime || 
                          (ghost.userData.pathIdx && ghost.userData.pathIdx >= ghost.userData.path.length) ||
                          (time - ghost.userData.pathTime > (ghost.userData.aiState === 'CHASE' ? 1000 : 2500));

      if (needsRepath) {
        ghost.userData.pathTime = time;
        const ghostGrid = worldToGrid(ghost.position.x, ghost.position.z);
        
        let destGrid = null;
        if (ghost.userData.aiState === 'CHASE' && targetPos) {
          destGrid = worldToGrid(targetPos.x, targetPos.z);
          ghost.userData.targetGrid = destGrid;
        } else if (ghost.userData.aiState === 'INVESTIGATE') {
          destGrid = ghost.userData.targetGrid;
          if (!destGrid) destGrid = ghostGrid;
          if (ghostGrid.col === destGrid.col && ghostGrid.row === destGrid.row) {
             ghost.userData.aiState = 'WANDER';
             ghost.userData.targetGrid = null;
             destGrid = null;
          }
        } 

        if (ghost.userData.aiState === 'WANDER' || !destGrid) {
          if (!ghost.userData.targetGrid || (ghostGrid.col === ghost.userData.targetGrid.col && ghostGrid.row === ghost.userData.targetGrid.row)) {
            let rx, rz, attempts = 0;
            ghost.userData.wanderCount = (ghost.userData.wanderCount || 0) + 1;
            const baseSeed = (currentLobby && currentLobby.puzzleState && currentLobby.puzzleState.mazeGeometrySeed) || 0.12345;
            const seedInt = Math.floor(baseSeed * 2147483647);
            const tempRand = mulberry32(seedInt + idx * 1000 + ghost.userData.wanderCount * 17);
            const totalCols = (mazeLayout && mazeLayout[0]) ? mazeLayout[0].length : mazeSizeGlobal;
            const totalRows = mazeLayout ? mazeLayout.length : mazeSizeGlobal;
            const blockSize = mazeBlockSize || 6.0;
            const isNearCorpse = (col, row) => {
              if (!deadBodies || deadBodies.length === 0) return false;
              const wx = (col - totalCols / 2) * blockSize + blockSize / 2;
              const wz = (row - totalRows / 2) * blockSize + blockSize / 2;
              return deadBodies.some(b => Math.hypot(b.position.x - wx, b.position.z - wz) < 9.0);
            };

            do {
              rx = Math.floor(tempRand() * totalCols);
              rz = Math.floor(tempRand() * totalRows);
              attempts++;
            } while ((!mazeLayout[rz] || mazeLayout[rz][rx] === 1 || mazeLayout[rz][rx] === 2 || isNearCorpse(rx, rz)) && attempts < 50);

            // Guaranteed fallback: pick any adjacent open corridor if random sampling picked a wall or closed door
            if (!mazeLayout[rz] || mazeLayout[rz][rx] !== 0) {
              const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
              for (const [dc, dr] of dirs) {
                const nc = ghostGrid.col + dc;
                const nr = ghostGrid.row + dr;
                if (nr >= 0 && nr < totalRows && nc >= 0 && nc < totalCols && mazeLayout[nr] && mazeLayout[nr][nc] === 0 && !isNearCorpse(nc, nr)) {
                  rx = nc;
                  rz = nr;
                  break;
                }
              }
            }
            if (!mazeLayout[rz] || mazeLayout[rz][rx] !== 0) {
              if (typeof openCorridors !== 'undefined' && openCorridors.length > 0) {
                const safeCandidates = openCorridors.filter(c => {
                  const g = worldToGrid(c.x, c.z);
                  return !isNearCorpse(g.col, g.row);
                });
                const pickList = safeCandidates.length > 0 ? safeCandidates : openCorridors;
                const pick = pickList[Math.floor(tempRand() * pickList.length)];
                const gPick = worldToGrid(pick.x, pick.z);
                rx = gPick.col;
                rz = gPick.row;
              } else {
                rx = ghostGrid.col;
                rz = ghostGrid.row;
              }
            }
            if (rx !== undefined && rz !== undefined && mazeLayout[rz] && mazeLayout[rz][rx] === 0) {
              ghost.userData.targetGrid = { col: rx, row: rz };
            } else {
              ghost.userData.targetGrid = null;
            }
          }
          destGrid = ghost.userData.targetGrid;
        }
        
        if (destGrid) {
          const generatedPath = bfsPath(ghostGrid.col, ghostGrid.row, destGrid.col, destGrid.row, false);
          if (generatedPath && generatedPath.length > 0) {
            ghost.userData.path = generatedPath;
            ghost.userData.pathIdx = 1; // Skip start cell waypoint
          } else {
            // If path could not be found to destGrid (e.g. target behind closed sliding door), switch to WANDER so it roams and doesn't lock up against the door!
            ghost.userData.aiState = 'WANDER';
            ghost.userData.targetGrid = null;
            ghost.userData.path = null;
            ghost.userData.pathTime = 0;
          }
        }
      }

      // Follow the path waypoints
      const path = ghost.userData.path;
      const pathIdx = ghost.userData.pathIdx || 1;

      if (path && path.length > 0 && pathIdx < path.length) {
        const waypoint = path[pathIdx];
        const dx = waypoint.x - ghost.position.x;
        const dz = waypoint.z - ghost.position.z;
        const distToWaypoint = Math.hypot(dx, dz);

        if (distToWaypoint < 1.2) {
          ghost.userData.pathIdx = pathIdx + 1; // Advance waypoint
        } else if (distToPlayer > 0.5 || ghost.userData.aiState !== 'CHASE') {
          // Move toward current waypoint
          _scratchVec3_1.set(dx, 0, dz).normalize();
          ghost.position.addScaledVector(_scratchVec3_1, delta * moveSpeed);
          resolveGhostCollision(ghost);
        }
      } else {
        // Arrived at final waypoint or navigating inside destination cell
        if (ghost.userData.aiState === 'CHASE' && distToPlayer > 0.5 && targetPos) {
          const ghostGrid = worldToGrid(ghost.position.x, ghost.position.z);
          const targetGrid = worldToGrid(targetPos.x, targetPos.z);
          const sameCell = (ghostGrid.col === targetGrid.col && ghostGrid.row === targetGrid.row);

          // Only move straight toward human target if in the same cell or has unblocked direct Line of Sight!
          if (sameCell || hasDirectLos) {
            _scratchVec3_1.set(targetPos.x - ghost.position.x, 0, targetPos.z - ghost.position.z).normalize();
            ghost.position.addScaledVector(_scratchVec3_1, delta * moveSpeed);
            resolveGhostCollision(ghost);
          } else {
            // Separated by a wall! Immediately force BFS repath around corridor rather than driving into the wall
            ghost.userData.pathTime = 0;
            ghost.userData.path = null;
          }
        } else {
          // Finished patrol / investigate path: clear to repath smoothly
          ghost.userData.targetGrid = null;
          ghost.userData.path = null;
          ghost.userData.pathTime = 0;
          if (ghost.userData.aiState === 'INVESTIGATE') {
            ghost.userData.aiState = 'WANDER';
          }
        }
      }
      
      // Face the human player if chasing AND has direct line of sight, otherwise face movement direction / waypoint
      if (ghost.userData.aiState === 'CHASE' && targetPos && hasDirectLos) {
        ghost.lookAt(targetPos.x, ghost.position.y, targetPos.z);
      } else if (path && path.length > 0 && pathIdx < path.length) {
        ghost.lookAt(path[pathIdx].x, ghost.position.y, path[pathIdx].z);
      } else if (targetPos && hasDirectLos) {
        ghost.lookAt(targetPos.x, ghost.position.y, targetPos.z);
      }

      // Final robust grid-plane, corner, dynamic door, and prop collision enforcement
      resolveGhostCollision(ghost);

      // UV Sanctuary barrier enforcement for Training Practice Ghost (demonstrates sanctuary shield)
      if (ghost.userData && ghost.userData.isPracticeGhost && Array.isArray(sanctuaryZones)) {
        sanctuaryZones.forEach(s => {
          const dS = Math.hypot(ghost.position.x - s.x, ghost.position.z - s.z);
          const safeBoundary = 3.6; // Right at the visual glowing edge of the sanctuary light circle
          if (dS < safeBoundary) {
            const angle = Math.atan2(ghost.position.z - s.z, ghost.position.x - s.x);
            ghost.position.x = s.x + Math.cos(angle) * safeBoundary;
            ghost.position.z = s.z + Math.sin(angle) * safeBoundary;
            ghost.userData.isBlockedBySanctuary = true;
          } else {
            ghost.userData.isBlockedBySanctuary = false;
          }
        });
      }
    });



    // 5. Emit movement states
    networkTimer += delta;
    if (networkTimer >= 0.05 && !window.isSpectating && !isCaptured) { // 20Hz update, skip if spectating or captured
      socketClient.emit('player_movement', {
        position: { x: camera.position.x, z: camera.position.z },
        rotation: { y: camera.rotation.y },
        team: myTeam,
        characterClass: myClass,
        isVip: window.isVipActive ? window.isVipActive() : false
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

    // Update Shadow Decoys (Feature 3) & Mirage Loot (Feature 2)
    if (typeof updateShadowDecoys === 'function') updateShadowDecoys(delta);
    if (typeof updateMirageLoot === 'function') updateMirageLoot(delta);

    // Update on-screen interaction cues (throttled to 10Hz to eliminate raycast/dot-product CPU overhead)
    if (isActive) {
      if (!window._lastPromptTime || (time - window._lastPromptTime > 100)) {
        window._lastPromptTime = time;
        updateInteractionPrompt();
      }
    } else {
      const promptEl = document.getElementById('interaction-prompt');
      if (promptEl) promptEl.style.display = 'none';
    }

    // Dynamic Point Light distance culling: drops active PBR light evaluation from 15 to 1-3 lights
    if (time - lastLightCullTime > 150) {
      lastLightCullTime = time;
      const pX = camera.position.x;
      const pZ = camera.position.z;

      if (Array.isArray(circuitBreakers)) {
        for (let i = 0; i < circuitBreakers.length; i++) {
          const b = circuitBreakers[i];
          if (b && b.mesh && b.mesh.userData && b.mesh.userData.statusLight) {
            const dx = b.mesh.position.x - pX;
            const dz = b.mesh.position.z - pZ;
            b.mesh.userData.statusLight.visible = (dx * dx + dz * dz) < 196; // 14m
          }
        }
      }

      if (Array.isArray(sanctuaryZones)) {
        for (let i = 0; i < sanctuaryZones.length; i++) {
          const s = sanctuaryZones[i];
          if (s && s.light) {
            const dx = s.x - pX;
            const dz = s.z - pZ;
            s.light.visible = (dx * dx + dz * dz) < 324; // 18m
          }
        }
      }
    }
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
    
    if (!g.userData || !g.userData.isPracticeGhost) {
      g.children.forEach(c => {
        if (c.isMesh && c.material && c.material.transparent) {
          c.material.opacity = Math.min(targetOpacity, c.material.opacity + 0.4);
        }
      });
    } else if (g.userData && g.userData.groundRing) {
      const ringScale = 1.0 + Math.sin(time * 0.006) * 0.15;
      g.userData.groundRing.scale.set(ringScale, ringScale, 1);
    }

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
    } else if (p.userData && (p.userData.type === 'Human' || !p.userData.type)) {
      // Calculate delta movement to drive the locomotion state & walk cycle without GC churn
      if (!p.userData.lastPosition) {
        p.userData.lastPosition = new THREE.Vector3().copy(p.position);
      }
      const distMoved = p.position.distanceTo(p.userData.lastPosition);
      p.userData.lastPosition.copy(p.position);

      if (p.userData.animMixer || p.userData.animActions) {
        const speed = distMoved / Math.max(0.001, delta);
        let targetAnim = 'idle';
        if (speed > 5.2) {
          targetAnim = 'sprint';
        } else if (speed > 0.05) {
          targetAnim = 'walk';
        }
        const remotePlayback = THREE.MathUtils.clamp(speed / 7.0, 0.45, 1.55);
        setHumanLocomotionAction(p, targetAnim, 0.18, remotePlayback);
      } else {
        if (distMoved > 0.01) {
          p.userData.walkCycle += distMoved * 5.5;
        } else {
          p.userData.walkCycle *= 0.85;
        }

        // Swing legs and arms back and forth in opposition
        const swing = Math.sin(p.userData.walkCycle) * 0.6;
        if (p.userData.leftLeg) p.userData.leftLeg.rotation.x = swing;
        if (p.userData.rightLeg) p.userData.rightLeg.rotation.x = -swing;
        if (p.userData.leftArm) p.userData.leftArm.rotation.x = -swing;
        if (p.userData.rightArm) p.userData.rightArm.rotation.x = swing;
      }
    }
  });
  // Handle ghost initial spawning — only after splash screen and active unpaused game
  const readyToSpawn = isMobileDevice ? (window.gameReady && window.mobileGameActive) : (window.gameReady && (!isPauseMenuOpen || Boolean(document.pointerLockElement)));
  if (!window.ghostsSpawned && currentLobby && readyToSpawn) {
    window.ghostsSpawned = true;
    
    // Count real players on Ghost team
    const playerGhostCount = Object.values(currentLobby.players || {}).filter(p => p.team === 'Ghost').length;
    let diffGhostTarget = 3;
    if (window.isTutorialMatch) diffGhostTarget = 0;
    else if (window.gameDifficulty === 'easy') diffGhostTarget = 2;
    else if (window.gameDifficulty === 'hard') diffGhostTarget = 6;
    else if (window.gameDifficulty === 'impossible') diffGhostTarget = 8;

    const totalTargetGhosts = (currentLobby.settings && currentLobby.settings.ghostsCount !== undefined) 
      ? currentLobby.settings.ghostsCount 
      : diffGhostTarget;
    
    // Calculate how many AI bot ghosts are needed so Total Ghosts == totalTargetGhosts exactly
    let botGhostsToSpawn = (currentLobby.settings && currentLobby.settings.botGhostsCount !== undefined)
      ? currentLobby.settings.botGhostsCount
      : Math.max(0, totalTargetGhosts - playerGhostCount);

    if (window.isTutorialMatch) {
      botGhostsToSpawn = 0;
    }

    console.log(`[GHOST SPAWNER] Target Total Ghosts: ${totalTargetGhosts} | Real Player Ghosts: ${playerGhostCount} | AI Bots Spawning: ${botGhostsToSpawn}`);

    if (botGhostsToSpawn > 0) {
      spawnGhostAIs(botGhostsToSpawn);
    }
  }

  // Tutorial Stage 1 (Move 8m) & Stage 2 (Sprint 1.5s) Real-Time Tracking
  if (window.isTutorialMatch && window.gameReady && !isCaptured) {
    if (tutorialStage === 1) {
      if (!tutorialLastPlayerPos) {
        tutorialLastPlayerPos = camera.position.clone();
      } else {
        const stepDist = Math.hypot(camera.position.x - tutorialLastPlayerPos.x, camera.position.z - tutorialLastPlayerPos.z);
        if (stepDist > 0.04) {
          tutorialDistanceMoved += stepDist;
          tutorialLastPlayerPos.copy(camera.position);
          updateTutorialQuestBanner();
          if (tutorialDistanceMoved >= 8) {
            advanceTutorialStage(2, "Locomotion Verified! Next: Sprint Calibration");
          }
        }
      }
    } else if (tutorialStage === 2) {
      if (isSprinting && (moveForward || moveBackward || moveLeft || moveRight || (typeof joystickVector !== 'undefined' && (Math.abs(joystickVector.x) > 0.1 || Math.abs(joystickVector.y) > 0.1)))) {
        tutorialSprintTime += delta;
        updateTutorialQuestBanner();
        if (tutorialSprintTime >= 1.5) {
          advanceTutorialStage(3, "Sprint Boosters Calibrated! Next: Flashlight Operation");
        }
      }
    } else if (tutorialStage === 8) {
      tutorialGhostDrillTimer += delta;
      updateTutorialQuestBanner();
      if (tutorialGhostDrillTimer >= 12.0) {
        removePracticeGhost();
        updateGhostProximityVignette(999, false);
        advanceTutorialStage(9, "Objectives Understood & Ghost Repelled! Next: Restore Grid Power & Inspect Clues");
      }
    }
  }



  // Throttled Minimap & Cooldown Timers (60-144Hz canvas overdraw optimization)
  if (window.gameReady) {
    const dx = Math.abs(camera.position.x - lastMinimapX);
    const dz = Math.abs(camera.position.z - lastMinimapZ);
    const dRot = Math.abs(camera.rotation.y - lastMinimapRot);
    const dt = time - lastMinimapTime;

    if (dx > 0.15 || dz > 0.15 || dRot > 0.04 || dt > 150) {
      lastMinimapX = camera.position.x;
      lastMinimapZ = camera.position.z;
      lastMinimapRot = camera.rotation.y;
      lastMinimapTime = time;
      if (myTeam === 'Human') {
        updateMinimapVisibility();
      }
      drawMinimap();
    }
    updateCooldownHUD();
  }

  renderer.render(scene, activeViewCamera || camera);
}
