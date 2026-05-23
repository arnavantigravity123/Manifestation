// Test Win Debug Module
// ======================
// This file exists as documentation for the two cheat codes available in game.
// The actual cheat logic is inline in game.js (setupControls > cheatBuffer listener).
//
// CHEAT CODES:
// ============
//
// 1. "testwin" - Instant Win Setup
//    - Gives you both functional keys (using correct server symbols)
//    - Marks cipher code as solved
//    - Fixes all circuit breakers
//    - Teleports you to the vault gate (4 units away)
//    - Shows the vault code in the notification
//    - Just walk forward and press E to win!
//
// 2. "spawnwin" - Spawn Items Nearby
//    - Teleports you to the vault gate area
//    - Moves ALL keys from the maze to right in front of you
//    - Moves ALL circuit breakers to right in front of you
//    - Moves ALL code clue notes to right in front of you
//    - Shows the vault code in the notification
//    - You still need to collect items and interact with the gate manually
//
// TO REMOVE TEST CHEATS:
// ======================
// 1. Delete this file (src/test_win.js)
// 2. In src/game.js, remove the import: import { spawnTestWinItems } from './test_win.js';
// 3. In src/game.js, in setupControls(), remove the cheatBuffer block
//    (search for "cheatBuffer.includes('spawnwin')" and "cheatBuffer.includes('testwin')")
