using UnityEngine;
using TMPro;
using Manifestation.Interaction;

namespace Manifestation.UI
{
    /// <summary>
    /// Displays and hides the "Press [E] to …" interaction prompt.
    ///
    /// InteractionRaycaster broadcasts OnInteractableFound / OnInteractableLost events;
    /// this script listens and updates the on-screen text accordingly.
    /// </summary>
    public class InteractionPromptUI : MonoBehaviour
    {
        // ── Inspector ─────────────────────────────────────────────────────
        [SerializeField] private GameObject promptRoot;   // parent panel to show/hide
        [SerializeField] private TMP_Text   promptLabel;  // the actual text element

        // ── Unity ─────────────────────────────────────────────────────────
        private void Awake()
        {
            HidePrompt();
        }

        private void OnEnable()
        {
            InteractionRaycaster.OnInteractableFound += ShowPrompt;
            InteractionRaycaster.OnInteractableLost  += HidePrompt;
        }

        private void OnDisable()
        {
            InteractionRaycaster.OnInteractableFound -= ShowPrompt;
            InteractionRaycaster.OnInteractableLost  -= HidePrompt;
        }

        // ── Handlers ──────────────────────────────────────────────────────
        private void ShowPrompt(string text)
        {
            if (promptRoot  != null) promptRoot.SetActive(true);
            if (promptLabel != null) promptLabel.text = text;
        }

        private void HidePrompt()
        {
            if (promptRoot != null) promptRoot.SetActive(false);
            if (promptLabel != null) promptLabel.text = "";
        }
    }
}
