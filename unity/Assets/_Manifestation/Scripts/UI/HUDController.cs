using UnityEngine;
using UnityEngine.UI;
using TMPro;
using Manifestation.Player;

namespace Manifestation.UI
{
    /// <summary>
    /// HUD Controller — wires PlayerStats events to the on-screen UI bars and numbers.
    ///
    /// Think of it like a dashboard: PlayerStats is the car's engine sending
    /// RPM/speed signals; HUDController is the instrument cluster displaying them.
    /// They never directly touch each other — they communicate through C# events.
    /// </summary>
    public class HUDController : MonoBehaviour
    {
        // ── Inspector references ──────────────────────────────────────────
        [Header("Health")]
        [SerializeField] private Slider   healthBar;
        [SerializeField] private TMP_Text healthText;
        [SerializeField] private Image    healthFill;
        [SerializeField] private Color    healthFullColor   = new Color(0.18f, 0.80f, 0.18f);
        [SerializeField] private Color    healthLowColor    = Color.red;

        [Header("Sanity")]
        [SerializeField] private Slider   sanityBar;
        [SerializeField] private TMP_Text sanityText;
        [SerializeField] private Image    sanityFill;
        [SerializeField] private Color    sanityFullColor   = new Color(0.40f, 0.20f, 0.80f);
        [SerializeField] private Color    sanityLowColor    = new Color(0.15f, 0.05f, 0.25f);
        [SerializeField] private float    sanityLowThreshold = 30f;

        [Header("Stamina")]
        [SerializeField] private Slider   staminaBar;
        [SerializeField] private TMP_Text staminaText;

        [Header("Battery")]
        [SerializeField] private Slider   batteryBar;
        [SerializeField] private TMP_Text batteryText;
        [SerializeField] private Image    batteryFill;
        [SerializeField] private Color    batteryOkColor    = new Color(0.90f, 0.85f, 0.10f);
        [SerializeField] private Color    batteryDeadColor  = Color.red;
        [SerializeField] private float    batteryLowThreshold = 20f;

        [Header("Sanity Vignette")]
        [SerializeField] private Image vignetteOverlay;   // full-screen darkening image
        [SerializeField] private float vignetteMaxAlpha = 0.6f;

        // ── Cached PlayerStats ────────────────────────────────────────────
        private PlayerStats _stats;

        // ── Unity ─────────────────────────────────────────────────────────
        private void Start()
        {
            // Find the local player's stats component
            var playerGO = GameObject.FindGameObjectWithTag("Player");
            if (playerGO != null)
                _stats = playerGO.GetComponent<PlayerStats>();

            if (_stats == null)
            {
                Debug.LogError("[HUDController] PlayerStats not found on 'Player' tagged object!");
                return;
            }

            // Subscribe to live stat change events
            _stats.OnHealthChanged   += UpdateHealth;
            _stats.OnSanityChanged   += UpdateSanity;
            _stats.OnStaminaChanged  += UpdateStamina;
            _stats.OnBatteryChanged  += UpdateBattery;

            // Initialise bars to current values immediately
            UpdateHealth (_stats.CurrentHealth,  _stats.MaxHealth);
            UpdateSanity (_stats.CurrentSanity,  _stats.MaxSanity);
            UpdateStamina(_stats.CurrentStamina, _stats.MaxStamina);
            UpdateBattery(_stats.CurrentBattery, _stats.MaxBattery);
        }

        private void OnDestroy()
        {
            if (_stats == null) return;
            _stats.OnHealthChanged  -= UpdateHealth;
            _stats.OnSanityChanged  -= UpdateSanity;
            _stats.OnStaminaChanged -= UpdateStamina;
            _stats.OnBatteryChanged -= UpdateBattery;
        }

        // ── Event handlers ────────────────────────────────────────────────
        private void UpdateHealth(float current, float max)
        {
            float ratio = max > 0 ? current / max : 0f;
            SetSlider(healthBar, ratio);
            SetText(healthText, current, max);
            SetFillColor(healthFill, Color.Lerp(healthLowColor, healthFullColor, ratio));
        }

        private void UpdateSanity(float current, float max)
        {
            float ratio = max > 0 ? current / max : 0f;
            SetSlider(sanityBar, ratio);
            SetText(sanityText, current, max);
            SetFillColor(sanityFill, Color.Lerp(sanityLowColor, sanityFullColor, ratio));

            // Vignette darkens as sanity drops
            if (vignetteOverlay != null)
            {
                float alpha = (1f - ratio) * vignetteMaxAlpha;
                Color c = vignetteOverlay.color;
                c.a = alpha;
                vignetteOverlay.color = c;
            }
        }

        private void UpdateStamina(float current, float max)
        {
            float ratio = max > 0 ? current / max : 0f;
            SetSlider(staminaBar, ratio);
            SetText(staminaText, current, max);
        }

        private void UpdateBattery(float current, float max)
        {
            float ratio = max > 0 ? current / max : 0f;
            SetSlider(batteryBar, ratio);
            SetText(batteryText, current, max);
            SetFillColor(batteryFill, ratio < (batteryLowThreshold / max)
                ? batteryDeadColor : batteryOkColor);
        }

        // ── Utility ───────────────────────────────────────────────────────
        private static void SetSlider(Slider s, float normalizedValue)
        {
            if (s != null) s.value = Mathf.Clamp01(normalizedValue);
        }

        private static void SetText(TMP_Text t, float current, float max)
        {
            if (t != null) t.text = $"{Mathf.CeilToInt(current)}/{Mathf.CeilToInt(max)}";
        }

        private static void SetFillColor(Image img, Color c)
        {
            if (img != null) img.color = c;
        }
    }
}
