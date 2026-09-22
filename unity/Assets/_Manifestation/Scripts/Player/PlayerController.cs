using UnityEngine;
// Unity 6 ships the new Input System as default.
// We use the legacy Input class wrapper below so no code changes are needed.
// In Unity 6: Edit → Project Settings → Player → Active Input Handling → "Both"

namespace Manifestation.Player
{
    /// <summary>
    /// Player Controller — CharacterController-based locomotion.
    /// Drives the Animator 2D blend tree (MoveX / MoveZ params).
    ///
    /// Unity 6 note: uses legacy Input class (enable "Both" input handlers
    /// in Player Settings so old Input.GetKey calls still work alongside
    /// the new Input System).
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public class PlayerController : MonoBehaviour
    {
        [Header("Locomotion Speeds")]
        [SerializeField] private float walkSpeed   = 3.6f;
        [SerializeField] private float sprintSpeed = 6.2f;
        [SerializeField] private float gravity     = -18.0f;
        [SerializeField] private float jumpHeight  = 1.1f;

        [Header("Component References")]
        [SerializeField] private CharacterController characterController;
        [SerializeField] private Animator            animator;
        [SerializeField] private PlayerStats         playerStats;
        [SerializeField] private AudioSource         footstepAudioSource;
        [SerializeField] private AudioClip[]         footstepClips;

        [Header("Footsteps")]
        [SerializeField] private float footstepInterval = 0.45f;

        // ── Animator parameter hashes (cached — avoids GC every frame) ────
        private static readonly int HashMoveX   = Animator.StringToHash("MoveX");
        private static readonly int HashMoveZ   = Animator.StringToHash("MoveZ");
        private static readonly int HashGrounded = Animator.StringToHash("IsGrounded");
        private static readonly int HashSprint  = Animator.StringToHash("IsSprinting");

        // ── Runtime state ─────────────────────────────────────────────────
        private Vector3 _velocity;          // gravity accumulator
        private float   _footstepTimer;
        private bool    _isGrounded;

        // ── Unity ─────────────────────────────────────────────────────────
        private void Awake()
        {
            if (characterController == null)
                characterController = GetComponent<CharacterController>();
        }

        private void Update()
        {
            HandleGravity();
            HandleMovement();
            HandleFootsteps();
        }

        // ── Private methods ────────────────────────────────────────────────
        private void HandleGravity()
        {
            _isGrounded = characterController.isGrounded;

            if (_isGrounded && _velocity.y < 0f)
                _velocity.y = -2f;  // stick to ground

            // Jump
            if (_isGrounded && Input.GetKeyDown(KeyCode.Space))
                _velocity.y = Mathf.Sqrt(jumpHeight * -2f * gravity);

            _velocity.y += gravity * Time.deltaTime;
            characterController.Move(_velocity * Time.deltaTime);

            if (animator != null)
                animator.SetBool(HashGrounded, _isGrounded);
        }

        private void HandleMovement()
        {
            float h = Input.GetAxis("Horizontal");
            float v = Input.GetAxis("Vertical");

            bool isSprinting = Input.GetKey(KeyCode.LeftShift)
                               && playerStats != null
                               && playerStats.CurrentStamina > 0f;

            // Consume stamina when sprinting
            if (isSprinting && playerStats != null)
                playerStats.DrainStamina();

            float speed = isSprinting ? sprintSpeed : walkSpeed;

            // Move relative to the player's facing direction
            Vector3 move = transform.right * h + transform.forward * v;
            characterController.Move(move * (speed * Time.deltaTime));

            // Feed blend tree
            if (animator != null)
            {
                animator.SetFloat(HashMoveX, h,  0.1f, Time.deltaTime);
                animator.SetFloat(HashMoveZ, v,  0.1f, Time.deltaTime);
                animator.SetBool (HashSprint, isSprinting);
            }
        }

        private void HandleFootsteps()
        {
            if (!_isGrounded) return;

            bool isMoving = Mathf.Abs(Input.GetAxis("Horizontal")) > 0.1f
                         || Mathf.Abs(Input.GetAxis("Vertical"))   > 0.1f;
            if (!isMoving) return;

            _footstepTimer -= Time.deltaTime;
            if (_footstepTimer > 0f) return;

            _footstepTimer = footstepInterval;
            PlayFootstep();
        }

        private void PlayFootstep()
        {
            if (footstepClips == null || footstepClips.Length == 0) return;
            if (footstepAudioSource == null) return;
            var clip = footstepClips[Random.Range(0, footstepClips.Length)];
            footstepAudioSource.PlayOneShot(clip);
        }
    }
}
