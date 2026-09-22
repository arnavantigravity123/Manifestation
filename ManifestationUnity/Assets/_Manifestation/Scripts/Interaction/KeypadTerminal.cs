using System;
using UnityEngine;
using UnityEngine.UI;
using TMPro;

namespace Manifestation.Interaction
{
    /// <summary>
    /// 4-digit passcode keypad terminal.  
    /// The player walks up and presses E to open a UI overlay, then types
    /// the code on screen buttons (or physical number keys).  
    /// On correct code: OnCodeAccepted fires → VaultController listens.
    /// On wrong code:   screen flashes red and clears (max 5 attempts before lockout).
    /// </summary>
    public class KeypadTerminal : MonoBehaviour, IInteractable
    {
        // ── Inspector ─────────────────────────────────────────────────────
        [Header("Code")]
        [SerializeField] private string correctCode = "1234";
        [SerializeField] private int    maxAttempts  = 5;

        [Header("UI References")]
        [SerializeField] private GameObject keypadUIRoot;   // parent canvas panel
        [SerializeField] private TMP_Text   displayText;    // shows entered digits
        [SerializeField] private TMP_Text   statusText;     // "LOCKED" / "UNLOCKED"
        [SerializeField] private Button[]   digitButtons;   // 0–9 + Clear + Enter
        [SerializeField] private Image      screenBackground;

        [Header("Colors")]
        [SerializeField] private Color idleColor    = new Color(0.05f, 0.05f, 0.05f);
        [SerializeField] private Color errorColor   = new Color(0.6f,  0.05f, 0.05f);
        [SerializeField] private Color successColor = new Color(0.05f, 0.4f,  0.05f);

        [Header("Audio")]
        [SerializeField] private AudioClip beepClip;
        [SerializeField] private AudioClip errorClip;
        [SerializeField] private AudioClip unlockClip;

        // ── Static events ─────────────────────────────────────────────────
        /// <summary>Fired when the correct code is entered.</summary>
        public static event Action OnCodeAccepted;
        /// <summary>Fired when the terminal is locked out (too many attempts).</summary>
        public static event Action OnTerminalLockedOut;

        // ── Runtime ───────────────────────────────────────────────────────
        private string       _entered   = "";
        private int          _attempts;
        private bool         _solved;
        private bool         _lockedOut;
        private bool         _uiOpen;
        private AudioSource  _audio;

        // ── IInteractable ─────────────────────────────────────────────────
        public string GetInteractionPrompt()
        {
            if (_solved)    return "Terminal — UNLOCKED";
            if (_lockedOut) return "Terminal — LOCKED OUT";
            return "[E]  Use Keypad Terminal";
        }

        public bool CanInteract() => !_solved && !_lockedOut;

        public void Interact(GameObject interactor)
        {
            if (_uiOpen) CloseUI();
            else         OpenUI();
        }

        // ── Unity ─────────────────────────────────────────────────────────
        private void Awake()
        {
            _audio = GetComponent<AudioSource>();
            if (_audio == null) _audio = gameObject.AddComponent<AudioSource>();

            if (keypadUIRoot != null) keypadUIRoot.SetActive(false);
        }

        private void Update()
        {
            if (!_uiOpen) return;

            // Allow physical number keys 0-9
            for (int i = 0; i <= 9; i++)
            {
                if (Input.GetKeyDown(KeyCode.Alpha0 + i) ||
                    Input.GetKeyDown(KeyCode.Keypad0 + i))
                {
                    PressDigit(i.ToString());
                }
            }

            if (Input.GetKeyDown(KeyCode.Backspace))  PressBackspace();
            if (Input.GetKeyDown(KeyCode.Return) ||
                Input.GetKeyDown(KeyCode.KeypadEnter)) PressEnter();
            if (Input.GetKeyDown(KeyCode.Escape))      CloseUI();
        }

        // ── UI callbacks (wired in Inspector or via code) ─────────────────
        public void PressDigit(string digit)
        {
            if (_entered.Length >= 4) return;
            _entered += digit;
            RefreshDisplay();
            PlayClip(beepClip);
        }

        public void PressBackspace()
        {
            if (_entered.Length == 0) return;
            _entered = _entered[..^1];
            RefreshDisplay();
        }

        public void PressEnter()
        {
            if (_entered.Length < 4) return;
            ValidateCode();
        }

        // ── Private helpers ───────────────────────────────────────────────
        private void OpenUI()
        {
            _uiOpen = true;
            if (keypadUIRoot != null) keypadUIRoot.SetActive(true);
            SetScreenColor(idleColor);
            RefreshDisplay();

            // Lock player look/movement (cursor)
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible   = true;
        }

        private void CloseUI()
        {
            _uiOpen = false;
            if (keypadUIRoot != null) keypadUIRoot.SetActive(false);
            _entered = "";

            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible   = false;
        }

        private void ValidateCode()
        {
            if (_entered == correctCode)
            {
                // SUCCESS
                _solved = true;
                SetScreenColor(successColor);
                if (statusText != null) statusText.text = "UNLOCKED";
                PlayClip(unlockClip);
                CloseUI();
                OnCodeAccepted?.Invoke();
            }
            else
            {
                // FAILURE
                _attempts++;
                PlayClip(errorClip);
                StartCoroutine(FlashError());

                if (_attempts >= maxAttempts)
                {
                    _lockedOut = true;
                    if (statusText != null) statusText.text = "LOCKED OUT";
                    CloseUI();
                    OnTerminalLockedOut?.Invoke();
                }
                else
                {
                    _entered = "";
                    RefreshDisplay();
                }
            }
        }

        private System.Collections.IEnumerator FlashError()
        {
            SetScreenColor(errorColor);
            yield return new WaitForSeconds(0.6f);
            SetScreenColor(idleColor);
        }

        private void RefreshDisplay()
        {
            if (displayText == null) return;
            // Show entered digits as asterisks for tension, then reveal on success
            displayText.text = new string('*', _entered.Length).PadRight(4, '_');
        }

        private void SetScreenColor(Color c)
        {
            if (screenBackground != null) screenBackground.color = c;
        }

        private void PlayClip(AudioClip clip)
        {
            if (clip != null && _audio != null) _audio.PlayOneShot(clip);
        }
    }
}
