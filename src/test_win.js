// Debug file to help test the win condition without manually exploring the entire maze
// This teleport script brings the required keys, code clues, and breakers directly to the player

import * as THREE from 'three';

export function spawnTestWinItems(playerCamera, keysInMaze, circuitBreakers, codeClueNotes, functionalKeysRevealed) {
  // Get player's current position and forward direction
  const playerPos = playerCamera.position.clone();
  
  // We want to spawn items slightly in front of the player
  const forward = new THREE.Vector3(0, 0, -1);
  forward.applyQuaternion(playerCamera.quaternion);
  forward.y = 0; // Keep everything on the horizontal plane
  forward.normalize();

  // Create left/right vectors for spreading items out
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  
  // 1. Move the 2 Functional Keys to the player
  // Filter out the real keys
  const realKeys = keysInMaze.filter(k => functionalKeysRevealed.includes(k.symbol));
  realKeys.forEach((k, index) => {
    // Offset keys to the left
    const offset = right.clone().multiplyScalar(-1.5 + (index * 1.0));
    const targetPos = playerPos.clone().add(forward.clone().multiplyScalar(3)).add(offset);
    
    k.mesh.position.set(targetPos.x, 0.5, targetPos.z);
    k.mesh.visible = true; // Just in case it was hidden somehow
  });

  // 2. Move the Circuit Breakers to the player
  // Breakers are normally on walls, but we'll just float them in the air so they can be clicked
  circuitBreakers.forEach((b, index) => {
    // Offset breakers to the right
    const offset = right.clone().multiplyScalar(1.5 + (index * 1.0));
    const targetPos = playerPos.clone().add(forward.clone().multiplyScalar(3)).add(offset);
    
    b.mesh.position.set(targetPos.x, 1.2, targetPos.z);
    // Point breakers towards the player
    b.mesh.lookAt(playerPos);
  });

  // 3. Move the Code Clue Notes to the player
  codeClueNotes.forEach((note, index) => {
    // Arrange notes in a small semi-circle in front of the player
    const angleOffset = (index - 1.5) * 0.4;
    const dir = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angleOffset);
    const targetPos = playerPos.clone().add(dir.multiplyScalar(4));
    
    note.mesh.position.set(targetPos.x, 0.8, targetPos.z);
    // Point notes towards the player
    note.mesh.lookAt(playerPos);
  });

  console.log("Test Win Items spawned directly in front of the player!");
}
