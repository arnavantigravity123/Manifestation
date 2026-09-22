using UnityEngine;

namespace Manifestation.AI
{
    /// <summary>
    /// Scales heartbeat and horror drone volumes dynamically based on player proximity.
    /// Replicates processGhostProximityAudio from Three.js game.js.
    /// </summary>
    public class GhostAudioProximity : MonoBehaviour
    {
        [Header("Audio Sources")]
        [SerializeField] private AudioSource heartbeatAudio;
        [SerializeField] private AudioSource droneAudio;

        [Header("Ranges")]
        [SerializeField] private float maxDetectionDistance = 18f;
        [SerializeField] private float panicDistance = 5f;

        [Header("Volume Curves")]
        [SerializeField] private float maxHeartbeatVolume = 0.9f;
        [SerializeField] private float maxDroneVolume = 0.75f;

        private Transform playerTransform;

        private void Start()
        {
            var player = GameObject.FindGameObjectWithTag("Player");
            if (player != null) playerTransform = player.transform;

            if (heartbeatAudio != null) { heartbeatAudio.loop = true; heartbeatAudio.volume = 0f; heartbeatAudio.Play(); }
            if (droneAudio != null) { droneAudio.loop = true; droneAudio.volume = 0f; droneAudio.Play(); }
        }

        private void Update()
        {
            if (playerTransform == null) return;

            float dist = Vector3.Distance(transform.position, playerTransform.position);
            if (dist > maxDetectionDistance)
            {
                if (heartbeatAudio) heartbeatAudio.volume = Mathf.MoveTowards(heartbeatAudio.volume, 0f, Time.deltaTime * 0.5f);
                if (droneAudio) droneAudio.volume = Mathf.MoveTowards(droneAudio.volume, 0f, Time.deltaTime * 0.5f);
                return;
            }

            float normalizedProximity = 1f - Mathf.Clamp01((dist - panicDistance) / (maxDetectionDistance - panicDistance));

            if (heartbeatAudio) heartbeatAudio.volume = Mathf.Lerp(0f, maxHeartbeatVolume, normalizedProximity);
            if (droneAudio) droneAudio.volume = Mathf.Lerp(0f, maxDroneVolume, normalizedProximity * 0.8f);
        }
    }
}
