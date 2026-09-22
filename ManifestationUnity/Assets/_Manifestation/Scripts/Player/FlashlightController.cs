using UnityEngine;

namespace Manifestation.Player
{
    public class FlashlightController : MonoBehaviour
    {
        [Header("Light & Audio")]
        [SerializeField] private Light flashlightSpotlight;
        [SerializeField] private AudioSource audioSource;
        [SerializeField] private AudioClip toggleOnSound;
        [SerializeField] private AudioClip toggleOffSound;

        [Header("Stats Connection")]
        [SerializeField] private PlayerStats playerStats;

        [Header("Flicker & Battery Alert")]
        [SerializeField] private float lowBatteryThreshold = 0.15f; // Below 15% battery
        [SerializeField] private float baseIntensity = 2.4f;

        private bool isOn = true;
        private float flickerTimer = 0f;

        private void Start()
        {
            if (playerStats == null) playerStats = GetComponentInParent<PlayerStats>();
            UpdateLightState(false);
        }

        private void Update()
        {
            if (Input.GetKeyDown(KeyCode.F))
            {
                ToggleFlashlight();
            }

            HandleLowBatteryFlicker();
        }

        public void ToggleFlashlight()
        {
            if (playerStats != null && playerStats.BatteryPercent <= 0f && !isOn)
            {
                // Cannot turn on depleted flashlight
                return;
            }

            isOn = !isOn;
            UpdateLightState(true);
        }

        private void UpdateLightState(bool playAudio)
        {
            if (flashlightSpotlight != null)
            {
                flashlightSpotlight.enabled = isOn;
                flashlightSpotlight.intensity = baseIntensity;
            }

            if (playerStats != null)
            {
                playerStats.SetFlashlightActive(isOn);
            }

            if (playAudio && audioSource != null)
            {
                AudioClip clip = isOn ? toggleOnSound : toggleOffSound;
                if (clip != null) audioSource.PlayOneShot(clip, 0.8f);
            }
        }

        private void HandleLowBatteryFlicker()
        {
            if (!isOn || flashlightSpotlight == null || playerStats == null) return;

            float battery = playerStats.BatteryPercent;
            if (battery <= 0f)
            {
                isOn = false;
                UpdateLightState(false);
                return;
            }

            if (battery <= lowBatteryThreshold)
            {
                flickerTimer -= Time.deltaTime;
                if (flickerTimer <= 0f)
                {
                    flashlightSpotlight.intensity = Random.value > 0.4f ? baseIntensity * 0.4f : baseIntensity;
                    flickerTimer = Random.Range(0.08f, 0.35f);
                }
            }
        }
    }
}
