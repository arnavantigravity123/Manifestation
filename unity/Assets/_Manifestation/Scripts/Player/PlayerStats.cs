using System;
using UnityEngine;

namespace Manifestation.Player
{
    public class PlayerStats : MonoBehaviour
    {
        [Header("Health")]
        [SerializeField] private float maxHealth = 100f;
        private float currentHealth;

        [Header("Sanity")]
        [SerializeField] private float maxSanity = 100f;
        [SerializeField] private float darknessDrainRate = 1.6f; // % per second
        [SerializeField] private float sanctuaryRegenRate = 5.0f; // % per second
        private float currentSanity;
        private bool isInSanctuary = false;

        [Header("Stamina")]
        [SerializeField] private float maxStamina = 100f;
        [SerializeField] private float sprintDrainRate = 22f; // units per second
        [SerializeField] private float staminaRegenRate = 18f;
        [SerializeField] private float staminaRegenDelay = 1.1f;
        private float currentStamina;
        private float staminaCooldownTimer = 0f;

        [Header("Flashlight Battery")]
        [SerializeField] private float maxBattery = 100f;
        [SerializeField] private float batteryDischargeRate = 0.35f; // Lasts ~4.7 minutes
        private float currentBattery;
        private bool isFlashlightActive = true;

        // Events for UI updating
        public event Action<float, float> OnHealthChanged;
        public event Action<float, float> OnSanityChanged;
        public event Action<float, float> OnStaminaChanged;
        public event Action<float, float> OnBatteryChanged;
        public event Action OnPlayerDied;

        private void Start()
        {
            currentHealth = maxHealth;
            currentSanity = maxSanity;
            currentStamina = maxStamina;
            currentBattery = maxBattery;

            NotifyAll();
        }

        private void Update()
        {
            float dt = Time.deltaTime;
            ProcessSanity(dt);
            ProcessStaminaRegen(dt);
            ProcessBattery(dt);
        }

        private void ProcessSanity(float dt)
        {
            if (isInSanctuary)
            {
                currentSanity = Mathf.Min(maxSanity, currentSanity + sanctuaryRegenRate * dt);
            }
            else
            {
                currentSanity = Mathf.Max(0f, currentSanity - darknessDrainRate * dt);
                if (currentSanity <= 0f)
                {
                    // Panic attacks drain health over time
                    TakeDamage(2.5f * dt);
                }
            }
            OnSanityChanged?.Invoke(currentSanity, maxSanity);
        }

        private void ProcessStaminaRegen(float dt)
        {
            if (staminaCooldownTimer > 0f)
            {
                staminaCooldownTimer -= dt;
                return;
            }

            if (currentStamina < maxStamina)
            {
                currentStamina = Mathf.Min(maxStamina, currentStamina + staminaRegenRate * dt);
                OnStaminaChanged?.Invoke(currentStamina, maxStamina);
            }
        }

        private void ProcessBattery(float dt)
        {
            if (isFlashlightActive && currentBattery > 0f)
            {
                currentBattery = Mathf.Max(0f, currentBattery - batteryDischargeRate * dt);
                OnBatteryChanged?.Invoke(currentBattery, maxBattery);
            }
        }

        public bool ConsumeStamina(float dt)
        {
            if (currentStamina <= 0f) return false;

            currentStamina = Mathf.Max(0f, currentStamina - sprintDrainRate * dt);
            staminaCooldownTimer = staminaRegenDelay;
            OnStaminaChanged?.Invoke(currentStamina, maxStamina);
            return currentStamina > 0f;
        }

        public void TakeDamage(float amount)
        {
            if (currentHealth <= 0f) return;

            currentHealth = Mathf.Max(0f, currentHealth - amount);
            OnHealthChanged?.Invoke(currentHealth, maxHealth);

            if (currentHealth <= 0f)
            {
                OnPlayerDied?.Invoke();
            }
        }

        public void RestoreHealth(float amount)
        {
            currentHealth = Mathf.Min(maxHealth, currentHealth + amount);
            OnHealthChanged?.Invoke(currentHealth, maxHealth);
        }

        public void RechargeBattery(float amount)
        {
            currentBattery = Mathf.Min(maxBattery, currentBattery + amount);
            OnBatteryChanged?.Invoke(currentBattery, maxBattery);
        }

        public void SetInSanctuary(bool inSanctuary)
        {
            isInSanctuary = inSanctuary;
        }

        public void SetFlashlightActive(bool active)
        {
            isFlashlightActive = active;
        }

        private void NotifyAll()
        {
            OnHealthChanged?.Invoke(currentHealth, maxHealth);
            OnSanityChanged?.Invoke(currentSanity, maxSanity);
            OnStaminaChanged?.Invoke(currentStamina, maxStamina);
            OnBatteryChanged?.Invoke(currentBattery, maxBattery);
        }

        public float HealthPercent => currentHealth / maxHealth;
        public float SanityPercent => currentSanity / maxSanity;
        public float StaminaPercent => currentStamina / maxStamina;
        public float BatteryPercent => currentBattery / maxBattery;
        public bool IsAlive => currentHealth > 0f;
    }
}
