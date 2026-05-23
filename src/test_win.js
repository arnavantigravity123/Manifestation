// Debug file to help test the win condition without manually exploring the entire maze
// This teleport script brings the required keys, code clues, and breakers directly to the player

import * as THREE from 'three';

export function spawnTestWinItems(globals) {
  const {
    camera,
    keysInMaze,
    circuitBreakers,
    codeClueNotes,
    functionalKeysRevealed,
    gateCoordinates,
    cipherCodeDigits,
    triggerNotification
  } = globals;

  // 1. Teleport the player directly to the Master Gate so they don't have to walk back to it
  camera.position.set(gateCoordinates.x, 1.6, gateCoordinates.z + 10);
  // Point camera at the gate
  camera.rotation.set(0, 0, 0); // Face negative Z (towards the gate)

  const playerPos = camera.position.clone();
  
  // We want to spawn items slightly in front of the player
  const forward = new THREE.Vector3(0, 0, -1);
  const right = new THREE.Vector3(1, 0, 0);
  
  // 2. Move the 2 Functional Keys to the player
  // Filter out the real keys
  const realKeys = keysInMaze.filter(k => functionalKeysRevealed.includes(k.symbol));
  realKeys.forEach((k, index) => {
    // Offset keys to the left
    const offset = right.clone().multiplyScalar(-1.5 + (index * 1.5));
    // Put them 2 units in front of player
    const targetPos = playerPos.clone().add(forward.clone().multiplyScalar(2)).add(offset);
    
    k.mesh.position.set(targetPos.x, 0.5, targetPos.z);
    k.mesh.visible = true; // Just in case it was hidden somehow
  });

  // 3. Move the Circuit Breakers to the player
  // Breakers are normally on walls, but we'll just float them in the air so they can be clicked
  circuitBreakers.forEach((b, index) => {
    // Offset breakers to the right
    const offset = right.clone().multiplyScalar(1.5 + (index * 1.0));
    // Put them 2 units in front of player
    const targetPos = playerPos.clone().add(forward.clone().multiplyScalar(2)).add(offset);
    
    b.mesh.position.set(targetPos.x, 1.2, targetPos.z);
    // Point breakers towards the player
    b.mesh.lookAt(playerPos);
  });

  // 4. Move the Code Clue Notes to the player
  codeClueNotes.forEach((note, index) => {
    // Arrange notes in a small semi-circle in front of the player
    const angleOffset = (index - 1.5) * 0.4;
    const dir = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angleOffset);
    // Put them 3 units in front
    const targetPos = playerPos.clone().add(dir.multiplyScalar(3));
    
    note.mesh.position.set(targetPos.x, 0.8, targetPos.z);
    // Point notes towards the player
    note.mesh.lookAt(playerPos);
  });

  // 5. Tell the player the exact code so they don't have to read the clue notes
  const codeString = cipherCodeDigits.join('');
  setTimeout(() => {
    triggerNotification(`CHEAT INFO: VAULT CODE IS [ ${codeString} ]`);
  }, 2000);

  console.log(`Test Win Items spawned directly in front of the player at Master Gate! Code is ${codeString}`);
}
