using UnityEngine;
using UnityEngine.UI;

namespace Manifestation.UI
{
    /// <summary>
    /// Renders the tactical 2D compass / minimap with player pings and sanctuary markers.
    /// Replicates drawMinimap and drawTacticalMarker from Three.js game.js.
    /// </summary>
    public class MinimapController : MonoBehaviour
    {
        [Header("UI Elements")]
        [SerializeField] private RectTransform playerBlip;
        [SerializeField] private RectTransform minimapCompassRoot;

        [Header("Target Tracking")]
        [SerializeField] private Transform playerTransform;

        private void Start()
        {
            if (playerTransform == null)
            {
                var player = GameObject.FindGameObjectWithTag("Player");
                if (player != null) playerTransform = player.transform;
            }
        }

        private void Update()
        {
            if (playerTransform == null || minimapCompassRoot == null) return;

            // Rotate compass dial to match player forward facing angle
            float playerYaw = playerTransform.eulerAngles.y;
            minimapCompassRoot.localEulerAngles = new Vector3(0f, 0f, playerYaw);
        }
    }
}
