using System.Collections;
using UnityEngine;
using Manifestation.Interaction;

namespace Manifestation.Core
{
    /// <summary>
    /// Master vault orchestrator.
    ///
    /// UNLOCK REQUIREMENTS (all must be true):
    ///   1. All circuit breakers repaired  (CircuitBreaker.TotalRepairedBreakers)
    ///   2. Correct keypad code entered    (KeypadTerminal.OnCodeAccepted)
    ///   3. Required key collected         (CollectibleKey.OnKeyCollected)
    ///
    /// When all three conditions are met → door animates open → collision
    /// blocker is disabled → escape trigger zone activates.
    ///
    /// Think of this script as the "control room" of a bank heist:
    /// it watches three separate alarm-disable panels and only opens the
    /// vault when ALL THREE go green.
    /// </summary>
    public class VaultController : MonoBehaviour
    {
        // ── Inspector ─────────────────────────────────────────────────────
        [Header("Requirements")]
        [SerializeField] private int    requiredBreakers = 3;
        [SerializeField] private string requiredKeyId    = "KEY_VAULT";

        [Header("Door")]
        [SerializeField] private Transform vaultDoor;          // the rotating door mesh
        [SerializeField] private float     doorOpenAngle = 90f; // Y-axis swing in degrees
        [SerializeField] private float     doorOpenTime  = 3.8f;

        [Header("Scene Objects")]
        [SerializeField] private Collider  collisionBlocker;   // invisible wall in doorway
        [SerializeField] private GameObject escapeTriggerZone; // collider zone the player walks into
        [SerializeField] private GameObject unlockedVFX;       // optional sparkle/light burst

        [Header("Audio")]
        [SerializeField] private AudioClip doorOpenClip;
        [SerializeField] private AudioClip unlockChimeClip;

        // ── Runtime state ─────────────────────────────────────────────────
        private bool _keyCollected;
        private bool _codeAccepted;
        private bool _isOpen;

        private AudioSource _audio;

        // Public read access (NetworkManager / cutscene triggers can check this)
        public bool IsOpen => _isOpen;

        // ── Unity ─────────────────────────────────────────────────────────
        private void Awake()
        {
            _audio = GetComponent<AudioSource>();
            if (_audio == null) _audio = gameObject.AddComponent<AudioSource>();

            // Ensure escape zone is off at start
            if (escapeTriggerZone != null) escapeTriggerZone.SetActive(false);
        }

        private void OnEnable()
        {
            CollectibleKey.OnKeyCollected   += HandleKeyCollected;
            KeypadTerminal.OnCodeAccepted   += HandleCodeAccepted;
            CircuitBreaker.OnBreakerRepaired += HandleBreakerRepaired;
        }

        private void OnDisable()
        {
            CollectibleKey.OnKeyCollected   -= HandleKeyCollected;
            KeypadTerminal.OnCodeAccepted   -= HandleCodeAccepted;
            CircuitBreaker.OnBreakerRepaired -= HandleBreakerRepaired;
        }

        // ── Event handlers ────────────────────────────────────────────────
        private void HandleKeyCollected(string keyId)
        {
            if (keyId == requiredKeyId)
            {
                _keyCollected = true;
                Debug.Log("[VaultController] Key collected ✓");
                TryUnlock();
            }
        }

        private void HandleCodeAccepted()
        {
            _codeAccepted = true;
            Debug.Log("[VaultController] Code accepted ✓");
            TryUnlock();
        }

        private void HandleBreakerRepaired()
        {
            Debug.Log($"[VaultController] Breakers: {CircuitBreaker.TotalRepairedBreakers}/{requiredBreakers}");
            TryUnlock();
        }

        // ── Unlock logic ──────────────────────────────────────────────────
        private void TryUnlock()
        {
            if (_isOpen) return;

            bool breakersOk = CircuitBreaker.TotalRepairedBreakers >= requiredBreakers;
            if (!breakersOk || !_keyCollected || !_codeAccepted) return;

            // ALL CONDITIONS MET — open the vault!
            Debug.Log("[VaultController] ALL CONDITIONS MET — opening vault!");
            StartCoroutine(OpenVaultSequence());
        }

        private IEnumerator OpenVaultSequence()
        {
            _isOpen = true;

            // Play unlock chime
            if (unlockChimeClip != null && _audio != null)
                _audio.PlayOneShot(unlockChimeClip);

            // Spawn VFX burst
            if (unlockedVFX != null) unlockedVFX.SetActive(true);

            yield return new WaitForSeconds(0.5f);

            // Start door audio
            if (doorOpenClip != null && _audio != null)
                _audio.PlayOneShot(doorOpenClip);

            // Animate the door swinging open
            if (vaultDoor != null)
                yield return StartCoroutine(RotateDoor());

            // Remove collision blocker
            if (collisionBlocker != null) collisionBlocker.enabled = false;

            // Activate escape trigger
            if (escapeTriggerZone != null) escapeTriggerZone.SetActive(true);

            // Global flag (mirrors Three.js window.vaultDoorOpen)
            GameState.VaultDoorOpen = true;

            Debug.Log("[VaultController] Vault open — escape route enabled.");
        }

        private IEnumerator RotateDoor()
        {
            float elapsed   = 0f;
            float startAngle = vaultDoor.localEulerAngles.y;
            float endAngle   = startAngle + doorOpenAngle;

            while (elapsed < doorOpenTime)
            {
                elapsed += Time.deltaTime;
                float t = Mathf.SmoothStep(0f, 1f, elapsed / doorOpenTime);
                float angle = Mathf.LerpAngle(startAngle, endAngle, t);
                vaultDoor.localEulerAngles = new Vector3(
                    vaultDoor.localEulerAngles.x,
                    angle,
                    vaultDoor.localEulerAngles.z);
                yield return null;
            }

            vaultDoor.localEulerAngles = new Vector3(
                vaultDoor.localEulerAngles.x,
                endAngle,
                vaultDoor.localEulerAngles.z);
        }

#if UNITY_EDITOR
        private void OnGUI()
        {
            if (!Application.isEditor) return;
            GUILayout.BeginArea(new Rect(10, 200, 280, 90));
            GUILayout.Label($"[Vault] Breakers: {CircuitBreaker.TotalRepairedBreakers}/{requiredBreakers}");
            GUILayout.Label($"[Vault] Key: {_keyCollected}  Code: {_codeAccepted}");
            GUILayout.Label($"[Vault] Open: {_isOpen}");
            GUILayout.EndArea();
        }
#endif
    }
}
