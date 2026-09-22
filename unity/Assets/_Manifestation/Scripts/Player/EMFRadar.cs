using UnityEngine;

namespace Manifestation.Player
{
    /// <summary>
    /// EMF Radar — a ghost-detection tool the player can equip.
    /// When active it pulses and increases beep frequency as the nearest
    /// ghost gets closer, just like a real paranormal investigation meter.
    ///
    /// Battery drains while radar is active (PlayerStats handles flashlight battery;
    /// EMF uses its own AA-battery gauge to keep them independent).
    /// </summary>
    public class EMFRadar : MonoBehaviour
    {
        // ── Inspector ─────────────────────────────────────────────────────
        [Header("Detection")]
        [SerializeField] private float maxDetectionRange = 20f;
        [SerializeField] private LayerMask ghostLayer;

        [Header("Audio")]
        [SerializeField] private AudioClip beepClip;
        [SerializeField] private float     minBeepInterval = 0.1f;
        [SerializeField] private float     maxBeepInterval = 2.0f;

        [Header("Battery")]
        [SerializeField] private float batteryCapacity  = 100f;
        [SerializeField] private float drainRate        = 3f;     // per second while active

        [Header("UI")]
        [SerializeField] private UnityEngine.UI.Slider emfBar;
        [SerializeField] private TMPro.TMP_Text        readingText;

        // ── Runtime ───────────────────────────────────────────────────────
        private AudioSource _audio;
        private float       _beepTimer;
        private float       _battery;
        private bool        _active;

        // ── Unity ─────────────────────────────────────────────────────────
        private void Awake()
        {
            _audio   = GetComponent<AudioSource>();
            if (_audio == null) _audio = gameObject.AddComponent<AudioSource>();
            _battery = batteryCapacity;
        }

        private void Update()
        {
            if (!_active) return;

            // Drain battery
            _battery -= drainRate * Time.deltaTime;
            _battery  = Mathf.Max(0f, _battery);

            if (emfBar   != null) emfBar.value     = _battery / batteryCapacity;
            if (_battery <= 0f) { Deactivate(); return; }

            // Find nearest ghost
            float nearestDist = FindNearestGhostDistance();
            float ratio = nearestDist < maxDetectionRange
                ? 1f - (nearestDist / maxDetectionRange) // 0=far, 1=close
                : 0f;

            // Update text reading (EMF level 1-5 like Phasmophobia)
            if (readingText != null)
                readingText.text = $"EMF {Mathf.RoundToInt(ratio * 5)}";

            // Schedule next beep
            _beepTimer -= Time.deltaTime;
            if (_beepTimer <= 0f)
            {
                float interval = Mathf.Lerp(maxBeepInterval, minBeepInterval, ratio);
                _beepTimer = interval;
                if (ratio > 0f) PlayBeep();
            }
        }

        // ── Public API ────────────────────────────────────────────────────
        public void Activate()
        {
            if (_battery <= 0f) return;
            _active = true;
            gameObject.SetActive(true);
        }

        public void Deactivate()
        {
            _active = false;
            if (readingText != null) readingText.text = "EMF --";
        }

        // ── Helpers ────────────────────────────────────────────────────────
        private float FindNearestGhostDistance()
        {
            Collider[] hits = Physics.OverlapSphere(transform.position, maxDetectionRange, ghostLayer);
            float nearest = float.MaxValue;
            foreach (var h in hits)
            {
                float d = Vector3.Distance(transform.position, h.transform.position);
                if (d < nearest) nearest = d;
            }
            return nearest < float.MaxValue ? nearest : maxDetectionRange + 1f;
        }

        private void PlayBeep()
        {
            if (beepClip != null && _audio != null) _audio.PlayOneShot(beepClip);
        }
    }
}
