using System;
using System.Collections;
using UnityEngine;

namespace Manifestation.AI
{
    /// <summary>
    /// Executes the jumpscare capture sequence when the ghost kills the player.
    /// Replicates playGhostCaptureAnimation from Three.js game.js.
    /// </summary>
    public class GhostCaptureSequence : MonoBehaviour
    {
        public static event Action OnCaptureCompleted;

        [Header("Cinematic Elements")]
        [SerializeField] private float zoomDuration = 0.45f;
        [SerializeField] private AudioClip jumpscareScream;
        [SerializeField] private AudioSource audioSource;

        private bool isCapturing = false;

        public void TriggerCapture(Transform ghostTransform, Transform playerCameraTransform)
        {
            if (isCapturing) return;
            isCapturing = true;

            StartCoroutine(CaptureRoutine(ghostTransform, playerCameraTransform));
        }

        private IEnumerator CaptureRoutine(Transform ghostTransform, Transform playerCameraTransform)
        {
            if (jumpscareScream != null && audioSource != null)
            {
                audioSource.PlayOneShot(jumpscareScream);
            }

            if (playerCameraTransform != null && ghostTransform != null)
            {
                Vector3 startPos = playerCameraTransform.position;
                Vector3 targetPos = ghostTransform.position + Vector3.up * 1.5f + ghostTransform.forward * 0.4f;

                float elapsed = 0f;
                while (elapsed < zoomDuration)
                {
                    elapsed += Time.deltaTime;
                    float t = elapsed / zoomDuration;
                    playerCameraTransform.position = Vector3.Lerp(startPos, targetPos, t);
                    playerCameraTransform.LookAt(ghostTransform.position + Vector3.up * 1.5f);
                    yield return null;
                }
            }

            yield return new WaitForSeconds(1.2f);
            OnCaptureCompleted?.Invoke();
        }
    }
}
