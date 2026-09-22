using UnityEngine;
using System;

namespace Manifestation.Interaction
{
    public class CircuitBreaker : MonoBehaviour, IInteractable
    {
        [Header("State")]
        [SerializeField] private bool isRepaired = false;

        [Header("Visuals & Audio")]
        [SerializeField] private Renderer switchRenderer;
        [SerializeField] private Material unpoweredMaterial;
        [SerializeField] private Material poweredMaterial;
        [SerializeField] private ParticleSystem sparkParticles;
        [SerializeField] private AudioSource audioSource;
        [SerializeField] private AudioClip switchThrowClip;

        public static event Action OnBreakerRepaired;
        public static int TotalRepairedBreakers { get; private set; } = 0;

        private void Start()
        {
            UpdateVisuals();
        }

        public string GetInteractionPrompt()
        {
            return isRepaired ? string.Empty : "Press [E] to Restore Power";
        }

        public bool CanInteract()
        {
            return !isRepaired;
        }

        public void Interact(GameObject instigator)
        {
            if (isRepaired) return;
            isRepaired = true;
            TotalRepairedBreakers++;

            UpdateVisuals();

            if (audioSource != null && switchThrowClip != null)
            {
                audioSource.PlayOneShot(switchThrowClip);
            }
            if (sparkParticles != null)
            {
                sparkParticles.Play();
            }

            OnBreakerRepaired?.Invoke();
        }

        private void UpdateVisuals()
        {
            if (switchRenderer != null)
            {
                switchRenderer.material = isRepaired ? poweredMaterial : unpoweredMaterial;
            }
        }
    }
}
