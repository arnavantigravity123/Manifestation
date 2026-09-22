using UnityEngine;

namespace Manifestation.Player
{
    public class PlayerCamera : MonoBehaviour
    {
        public enum CameraMode { FirstPerson, ThirdPerson }

        [Header("Camera Mode")]
        [SerializeField] private CameraMode currentMode = CameraMode.FirstPerson;
        [SerializeField] private KeyCode toggleModeKey = KeyCode.V;

        [Header("Sensitivity & Pitch Limits")]
        [SerializeField] private float mouseSensitivity = 2.4f;
        [SerializeField] private float minPitch = -75.0f;
        [SerializeField] private float maxPitch = 80.0f;

        [Header("First-Person Offsets")]
        [SerializeField] private Transform playerBody;
        [SerializeField] private Vector3 firstPersonEyeOffset = new Vector3(0f, 1.65f, 0.1f);

        [Header("Third-Person Orbit")]
        [SerializeField] private Vector3 thirdPersonTargetOffset = new Vector3(0f, 1.5f, 0f);
        [SerializeField] private float defaultDistance = 2.8f;
        [SerializeField] private float minDistance = 0.6f;
        [SerializeField] private LayerMask obstacleLayers;

        [Header("Mesh Visibility")]
        [SerializeField] private GameObject playerModelVisual;

        private float pitch = 0f;
        private float yaw = 0f;

        private void Start()
        {
            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible = false;
            yaw = playerBody != null ? playerBody.eulerAngles.y : transform.eulerAngles.y;
            UpdateModelVisibility();
        }

        private void LateUpdate()
        {
            if (Input.GetKeyDown(toggleModeKey))
            {
                currentMode = (currentMode == CameraMode.FirstPerson) ? CameraMode.ThirdPerson : CameraMode.FirstPerson;
                UpdateModelVisibility();
            }

            HandleRotation();
            HandlePositioning();
        }

        private void HandleRotation()
        {
            float mouseX = Input.GetAxis("Mouse X") * mouseSensitivity;
            float mouseY = Input.GetAxis("Mouse Y") * mouseSensitivity;

            yaw += mouseX;
            pitch -= mouseY;
            pitch = Mathf.Clamp(pitch, minPitch, maxPitch);

            if (playerBody != null)
            {
                playerBody.rotation = Quaternion.Euler(0f, yaw, 0f);
            }
        }

        private void HandlePositioning()
        {
            if (playerBody == null) return;

            if (currentMode == CameraMode.FirstPerson)
            {
                transform.position = playerBody.position + firstPersonEyeOffset;
                transform.rotation = Quaternion.Euler(pitch, yaw, 0f);
            }
            else
            {
                // Third-person orbit with collision sphere cast to prevent clipping through maze walls
                Vector3 targetCenter = playerBody.position + thirdPersonTargetOffset;
                Quaternion rotation = Quaternion.Euler(pitch, yaw, 0f);
                Vector3 desiredDirection = rotation * -Vector3.forward;

                float targetDist = defaultDistance;
                if (Physics.SphereCast(targetCenter, 0.22f, desiredDirection, out RaycastHit hit, defaultDistance, obstacleLayers))
                {
                    targetDist = Mathf.Clamp(hit.distance - 0.1f, minDistance, defaultDistance);
                }

                transform.position = targetCenter + (desiredDirection * targetDist);
                transform.rotation = rotation;
            }
        }

        private void UpdateModelVisibility()
        {
            if (playerModelVisual == null) return;
            // In first-person, hide player mesh to avoid eye clipping; show in third-person
            playerModelVisual.SetActive(currentMode == CameraMode.ThirdPerson);
        }

        public CameraMode CurrentMode => currentMode;
    }
}
