using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Manifestation.Core
{
    /// <summary>
    /// Win Sequence Manager — orchestrates the escape cinematic and returns
    /// the player to the main menu after victory.
    ///
    /// Mirrors the Three.js playEscapeCinematic() function which walks the
    /// camera down the forest corridor on a tween before showing the end screen.
    /// </summary>
    public class WinSequenceManager : MonoBehaviour
    {
        // ── Singleton ─────────────────────────────────────────────────────
        public static WinSequenceManager Instance { get; private set; }

        // ── Inspector ─────────────────────────────────────────────────────
        [Header("Cutscene")]
        [SerializeField] private Animator  cutsceneAnimator;         // optional timeline animator
        [SerializeField] private float     cutsceneDuration  = 8f;
        [SerializeField] private string    mainMenuSceneName = "MainMenu";

        [Header("Victory UI")]
        [SerializeField] private GameObject victoryPanel;
        [SerializeField] private TMPro.TMP_Text victoryTimeText;

        [Header("Audio")]
        [SerializeField] private AudioClip victoryClip;

        // ── Runtime ───────────────────────────────────────────────────────
        private float _runStartTime;
        private AudioSource _audio;

        // ── Unity ─────────────────────────────────────────────────────────
        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;

            _audio = GetComponent<AudioSource>();
            if (_audio == null) _audio = gameObject.AddComponent<AudioSource>();
        }

        private void Start()
        {
            _runStartTime = Time.time;
        }

        // ── Public API ────────────────────────────────────────────────────
        public void PlayEscapeCutscene()
        {
            StartCoroutine(EscapeSequence());
        }

        // ── Coroutine ─────────────────────────────────────────────────────
        private IEnumerator EscapeSequence()
        {
            // Disable player controls
            var playerGO = GameObject.FindGameObjectWithTag("Player");
            if (playerGO != null)
            {
                var controller = playerGO.GetComponent<Player.PlayerController>();
                if (controller != null) controller.enabled = false;
            }

            // Play victory sound
            if (victoryClip != null && _audio != null)
                _audio.PlayOneShot(victoryClip);

            // Trigger cutscene animation (forest walk-through)
            if (cutsceneAnimator != null)
                cutsceneAnimator.SetTrigger("PlayEscape");

            // Wait for cutscene to finish
            yield return new WaitForSeconds(cutsceneDuration);

            // Show victory screen with time
            float elapsed = Time.time - _runStartTime;
            ShowVictoryPanel(elapsed);
        }

        private void ShowVictoryPanel(float timeElapsed)
        {
            if (victoryPanel != null) victoryPanel.SetActive(true);

            if (victoryTimeText != null)
            {
                int minutes = Mathf.FloorToInt(timeElapsed / 60f);
                int seconds = Mathf.FloorToInt(timeElapsed % 60f);
                victoryTimeText.text = $"Escaped in {minutes:00}:{seconds:00}";
            }

            Cursor.lockState = CursorLockMode.None;
            Cursor.visible   = true;

            // Auto-return to main menu after 10 seconds
            Invoke(nameof(ReturnToMenu), 10f);
        }

        private void ReturnToMenu()
        {
            GameState.ResetRunState();
            SceneManager.LoadScene(mainMenuSceneName);
        }
    }
}
