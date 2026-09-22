using UnityEngine;
using System;

namespace Manifestation.Interaction
{
    public class InteractionRaycaster : MonoBehaviour
    {
        [Header("Raycast Distance & Layers")]
        [SerializeField] private float interactDistance = 2.8f;
        [SerializeField] private LayerMask interactableLayers;
        [SerializeField] private Camera playerCamera;

        public event Action<string> OnPromptChanged;

        private IInteractable currentTarget;

        private void Update()
        {
            CheckForInteractable();

            if (Input.GetKeyDown(KeyCode.E) && currentTarget != null && currentTarget.CanInteract())
            {
                currentTarget.Interact(gameObject);
            }
        }

        private void CheckForInteractable()
        {
            Ray ray = playerCamera != null 
                ? playerCamera.ViewportPointToRay(new Vector3(0.5f, 0.5f, 0f))
                : new Ray(transform.position, transform.forward);

            if (Physics.Raycast(ray, out RaycastHit hit, interactDistance, interactableLayers))
            {
                if (hit.collider.TryGetComponent(out IInteractable interactable) && interactable.CanInteract())
                {
                    if (currentTarget != interactable)
                    {
                        currentTarget = interactable;
                        OnPromptChanged?.Invoke(currentTarget.GetInteractionPrompt());
                    }
                    return;
                }
            }

            if (currentTarget != null)
            {
                currentTarget = null;
                OnPromptChanged?.Invoke(string.Empty);
            }
        }
    }
}
