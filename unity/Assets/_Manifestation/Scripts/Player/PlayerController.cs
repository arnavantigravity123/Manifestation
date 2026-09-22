using UnityEngine;

namespace Manifestation.Player
{
    [RequireComponent(typeof(CharacterController))]
    public class PlayerController : MonoBehaviour
    {
        [Header("Locomotion Speeds")]
        [SerializeField] private float walkSpeed = 3.6f;
        [SerializeField] private float sprintSpeed = 6.2f;
        [SerializeField] private float gravity = -18.0f;
        [SerializeField] private float jumpHeight = 1.1f;

        [Header("Component References")]
        [SerializeField] private CharacterController characterController;
        [SerializeField] private Animator animator;
        [SerializeField] private PlayerStats playerStats;
        [SerializeField] private AudioSource footstepAudioSource;
        [SerializeField] private AudioClip[] footstepClips;

        [Header("Footstep Cadence")]
        [SerializeField] private float walkStepInterval = 0.52f;
        [SerializeField] private float sprintStepInterval = 0.34f;

        private Vector3 velocity;
        private bool isGrounded;
        private float stepTimer;

        // Animator Parameter Hashes (Cache for zero garbage allocations)
        private static readonly int MoveXHash = Animator.StringToHash("MoveX");
        private static readonly int MoveZHash = Animator.StringToHash("MoveZ");
        private static readonly int SpeedHash = Animator.StringToHash("Speed");
        private static readonly int IsGroundedHash = Animator.StringToHash("IsGrounded");

        private void Awake()
        {
            if (characterController == null) characterController = GetComponent<CharacterController>();
            if (playerStats == null) playerStats = GetComponent<PlayerStats>();
            if (animator == null) animator = GetComponentInChildren<Animator>();
        }

        private void Update()
        {
            HandleGroundedState();
            HandleMovement();
        }

        private void HandleGroundedState()
        {
            isGrounded = characterController.isGrounded;
            if (isGrounded && velocity.y < 0)
            {
                velocity.y = -2.0f; // Firm grounding check
            }
            if (animator != null)
            {
                animator.SetBool(IsGroundedHash, isGrounded);
            }
        }

        private void HandleMovement()
        {
            float horizontal = Input.GetAxisRaw("Horizontal");
            float vertical = Input.GetAxisRaw("Vertical");

            Vector3 inputDirection = new Vector3(horizontal, 0f, vertical).normalized;

            bool isSprinting = Input.GetKey(KeyCode.LeftShift) && inputDirection.magnitude > 0.1f;
            if (isSprinting && playerStats != null)
            {
                if (!playerStats.ConsumeStamina(Time.deltaTime))
                {
                    isSprinting = false; // Out of stamina
                }
            }

            float currentSpeed = isSprinting ? sprintSpeed : walkSpeed;
            Vector3 move = (transform.right * horizontal + transform.forward * vertical).normalized * currentSpeed;

            characterController.Move(move * Time.deltaTime);

            // Jump & Gravity
            if (Input.GetButtonDown("Jump") && isGrounded)
            {
                velocity.y = Mathf.Sqrt(jumpHeight * -2.0f * gravity);
            }

            velocity.y += gravity * Time.deltaTime;
            characterController.Move(velocity * Time.deltaTime);

            // Update Mecanim 2D Blend Tree Parameters
            if (animator != null)
            {
                float targetSpeed = inputDirection.magnitude * (isSprinting ? 2.0f : 1.0f);
                animator.SetFloat(MoveXHash, horizontal, 0.1f, Time.deltaTime);
                animator.SetFloat(MoveZHash, vertical, 0.1f, Time.deltaTime);
                animator.SetFloat(SpeedHash, targetSpeed, 0.1f, Time.deltaTime);
            }

            // Footstep audio processing
            HandleFootsteps(inputDirection.magnitude > 0.1f && isGrounded, isSprinting);
        }

        private void HandleFootsteps(bool isMoving, bool isSprinting)
        {
            if (!isMoving)
            {
                stepTimer = 0f;
                return;
            }

            float interval = isSprinting ? sprintStepInterval : walkStepInterval;
            stepTimer += Time.deltaTime;

            if (stepTimer >= interval)
            {
                stepTimer = 0f;
                PlayFootstepSound();
            }
        }

        private void PlayFootstepSound()
        {
            if (footstepAudioSource == null || footstepClips == null || footstepClips.Length == 0) return;
            AudioClip clip = footstepClips[Random.Range(0, footstepClips.Length)];
            footstepAudioSource.pitch = Random.Range(0.92f, 1.08f);
            footstepAudioSource.PlayOneShot(clip, 0.7f);
        }
    }
}
