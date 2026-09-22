using UnityEngine;

namespace Manifestation.Maze
{
    /// <summary>
    /// Builds modular 2m x 2m rug hubs, straight hallway runners, and winged crest emblems
    /// matching the exact Three.js geometry architecture without Z-fighting.
    /// </summary>
    public class DungeonTileBuilder : MonoBehaviour
    {
        [Header("Prefabs & Geometry")]
        [SerializeField] private GameObject straightRunnerPrefab;
        [SerializeField] private GameObject crestRunnerPrefab;
        [SerializeField] private GameObject cornerHubPrefab;
        [SerializeField] private GameObject tjunctionHubPrefab;
        [SerializeField] private GameObject crossroadHubPrefab;

        [Header("Elevations (prevents Z-fighting)")]
        [SerializeField] private float rugBaseHeight = 0.01f;
        [SerializeField] private float borderHeight = 0.012f;

        /// <summary>
        /// Instantiates the appropriate modular rug runner or hub at the specified world cell.
        /// </summary>
        public GameObject SpawnCorridorRug(Vector3 worldPos, bool isCrestTile, float rotationY = 0f)
        {
            GameObject prefab = isCrestTile ? crestRunnerPrefab : straightRunnerPrefab;
            if (prefab == null) return null;

            Vector3 spawnPos = new Vector3(worldPos.x, worldPos.y + rugBaseHeight, worldPos.z);
            GameObject rug = Instantiate(prefab, spawnPos, Quaternion.Euler(0f, rotationY, 0f), transform);
            rug.name = isCrestTile ? "Rug_WingedCrest" : "Rug_Straight";
            return rug;
        }

        public GameObject SpawnIntersectionHub(Vector3 worldPos, int connectedPassages, float rotationY = 0f)
        {
            GameObject prefab = connectedPassages switch
            {
                2 => cornerHubPrefab,
                3 => tjunctionHubPrefab,
                4 => crossroadHubPrefab,
                _ => straightRunnerPrefab
            };

            if (prefab == null) return null;

            Vector3 spawnPos = new Vector3(worldPos.x, worldPos.y + rugBaseHeight, worldPos.z);
            return Instantiate(prefab, spawnPos, Quaternion.Euler(0f, rotationY, 0f), transform);
        }
    }
}
