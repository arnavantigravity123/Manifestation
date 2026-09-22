using UnityEngine;
using UnityEngine.UI;
using UnityEngine.SceneManagement;
using TMPro;

namespace Manifestation.UI
{
    /// <summary>
    /// Displays the Game Over / Solo Death screen with retry and menu triggers.
    /// Replicates showSoloDeathEndScreen from Three.js game.js.
    /// </summary>
    public class GameOverUI : MonoBehaviour
    {
        [Header("UI Panels")]
        [SerializeField] private GameObject gameOverPanel;
        [SerializeField] private TMP_Text causeOfDeathText;
        [SerializeField] private Button retryButton;
        [SerializeField] private Button mainMenuButton;

        private void Start()
        {
            if (gameOverPanel != null) gameOverPanel.SetActive(false);

            if (retryButton != null) retryButton.onClick.AddListener(OnRetryClicked);
            if (mainMenuButton != null) mainMenuButton.onClick.AddListener(OnMainMenuClicked);

            // Subscribe to capture sequence
            AI.GhostCaptureSequence.OnCaptureCompleted += ShowGameOver;
        }

        private void OnDestroy()
        {
            AI.GhostCaptureSequence.OnCaptureCompleted -= ShowGameOver;
        }

        public void ShowGameOver()
        {
            if (gameOverPanel != null) gameOverPanel.SetActive(true);
            if (causeOfDeathText != null) causeOfDeathText.text = "Captured by the Entity";

            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
        }

        private void OnRetryClicked()
        {
            SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex);
        }

        private void OnMainMenuClicked()
        {
            SceneManager.LoadScene("MainMenu");
        }
    }
}
