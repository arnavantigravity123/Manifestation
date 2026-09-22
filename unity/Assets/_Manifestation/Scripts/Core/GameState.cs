using UnityEngine;

namespace Manifestation.Core
{
    /// <summary>
    /// Central singleton for global game-state flags shared across scenes.
    ///
    /// This is the Unity equivalent of the Three.js game's global window.*
    /// variables (e.g. window.vaultDoorOpen, window.hasEscaped).
    ///
    /// Because it uses DontDestroyOnLoad it survives scene loads, just like
    /// a JS global lives for the whole browser tab session.
    /// </summary>
    public class GameState : MonoBehaviour
    {
        // ── Singleton ─────────────────────────────────────────────────────
        private static GameState _instance;
        public static  GameState Instance => _instance;

        // ── Global state flags ────────────────────────────────────────────
        /// <summary>True after the vault door has fully swung open.</summary>
        public static bool VaultDoorOpen { get; set; }

        /// <summary>True after the player has walked through the vault threshold.</summary>
        public static bool HasEscaped { get; set; }

        /// <summary>Current dungeon run seed (for reproducible maze on all clients).</summary>
        public static int  DungeonSeed { get; set; }

        /// <summary>Local player's display name (set by auth / RevenueCat).</summary>
        public static string PlayerDisplayName { get; set; } = "Player";

        /// <summary>True while RevenueCat VIP entitlement is active.</summary>
        public static bool IsVIP { get; set; }

        /// <summary>Coin balance synced from RevenueCat / backend.</summary>
        public static int  CoinBalance { get; set; }

        // ── Unity ─────────────────────────────────────────────────────────
        private void Awake()
        {
            if (_instance != null && _instance != this)
            {
                Destroy(gameObject);
                return;
            }
            _instance = this;
            DontDestroyOnLoad(gameObject);

            ResetRunState();
        }

        // ── Public API ────────────────────────────────────────────────────
        /// <summary>
        /// Reset all per-run (dungeon session) state while preserving
        /// account-level state (VIP, coins, name).
        /// Call this at the start of every new maze run.
        /// </summary>
        public static void ResetRunState()
        {
            VaultDoorOpen = false;
            HasEscaped    = false;
            DungeonSeed   = Random.Range(0, int.MaxValue);
        }
    }
}
