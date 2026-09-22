using System;
using UnityEngine;

namespace Manifestation.Interaction
{
    /// <summary>
    /// Gemstone vault key. Implements IInteractable so the player can pick it
    /// up by pressing E. Once collected it is destroyed from the world and the
    /// KeyCollected event is broadcast so VaultController can track progress.
    /// </summary>
    public class CollectibleKey : MonoBehaviour, IInteractable
    {
        // ── Inspector ────────────────────────────────────────────────────────
        [Header("Key Settings")]
        [SerializeField] private string keyId = "KEY_A";      // unique ID per key
        [SerializeField] private string displayName = "Gemstone Key";
        [SerializeField] private float bobAmplitude = 0.15f;
        [SerializeField] private float bobFrequency  = 1.2f;
        [SerializeField] private float rotateSpeed   = 90f;   // degrees per second

        [Header("VFX")]
        [SerializeField] private ParticleSystem collectVFX;   // burst on pickup (optional)
        [SerializeField] private Light           glowLight;   // optional ambient glow

        // ── Static event ──────────────────────────────────────────────────────
        /// <summary>Fires when any key is collected, passes the keyId string.</summary>
        public static event Action<string> OnKeyCollected;

        // ── Runtime ────────────────────────────────────────────────────────
        private Vector3 _startPosition;
        private bool    _collected;

        // ── IInteractable ──────────────────────────────────────────────────
        public string GetInteractionPrompt() => $"[E]  Pick up {displayName}";
        public bool   CanInteract()          => !_collected;

        public void Interact(GameObject interactor)
        {
            if (_collected) return;
            Collect();
        }

        // ── Unity ──────────────────────────────────────────────────────────
        private void Start()
        {
            _startPosition = transform.position;
        }

        private void Update()
        {
            if (_collected) return;

            // Floating bob (sine wave on Y axis, like an item in Zelda)
            float newY = _startPosition.y + Mathf.Sin(Time.time * bobFrequency) * bobAmplitude;
            transform.position = new Vector3(transform.position.x, newY, transform.position.z);

            // Constant Y-axis spin
            transform.Rotate(Vector3.up, rotateSpeed * Time.deltaTime, Space.World);
        }

        // ── Private helpers ────────────────────────────────────────────────
        private void Collect()
        {
            _collected = true;

            // Play burst VFX at world position before destroying parent
            if (collectVFX != null)
            {
                collectVFX.transform.SetParent(null); // detach so it survives destruction
                collectVFX.Play();
                Destroy(collectVFX.gameObject, 3f);
            }

            // Turn off glow immediately
            if (glowLight != null)
                glowLight.enabled = false;

            // Notify listeners (VaultController, Inventory, etc.)
            OnKeyCollected?.Invoke(keyId);

            // Remove the physical key from the world
            Destroy(gameObject);
        }

#if UNITY_EDITOR
        private void OnDrawGizmosSelected()
        {
            // Show the bob range as a vertical line in the editor
            Gizmos.color = Color.yellow;
            Vector3 p = Application.isPlaying ? _startPosition : transform.position;
            Gizmos.DrawLine(p + Vector3.up * bobAmplitude, p - Vector3.up * bobAmplitude);
        }
#endif
    }
}
