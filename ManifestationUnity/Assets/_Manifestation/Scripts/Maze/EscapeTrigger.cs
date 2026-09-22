using UnityEngine;
using Manifestation.Core;

namespace Manifestation.Maze
{
    /// <summary>
    /// Escape Trigger Zone — an invisible box the player walks into after the
    /// vault door opens to trigger the escape cutscene / win condition.
    ///
    /// This mirrors the Three.js doorway threshold check that fires
    /// triggerHumanEscape() when localPlayer.Z <= 0.8 and Z >= -4.5.
    /// </summary>
    public class EscapeTrigger : MonoBehaviour
    {
        [Header("Requirements")]
        [SerializeField] private bool requireVaultOpen = true;

        [Header("Cutscene")]
        [SerializeField] private float  cutsceneDelay = 0.5f; // seconds before cutscene plays

        // ── Unity ─────────────────────────────────────────────────────────
        private void OnTriggerEnter(Collider other)
        {
            if (!other.CompareTag("Player")) return;
            if (requireVaultOpen && !GameState.VaultDoorOpen) return;
            if (GameState.HasEscaped) return;

            GameState.HasEscaped = true;
            Debug.Log("[EscapeTrigger] Player escaped! Starting win sequence...");
            Invoke(nameof(TriggerWinSequence), cutsceneDelay);
        }

        private void TriggerWinSequence()
        {
            // Broadcast to any listeners (cutscene manager, leaderboard, etc.)
            WinSequenceManager.Instance?.PlayEscapeCutscene();
        }
    }
}
