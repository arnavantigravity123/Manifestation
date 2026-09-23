using UnityEngine;

namespace Manifestation.Core
{
    /// <summary>
    /// Scene Bootstrapper — sets up the scene's initial state, spawns the
    /// player at the correct maze entrance, and links all singletons.
    ///
    /// Attach this to an empty GameObject called "_Bootstrapper" in each scene.
    /// It acts like the "director" before the show starts: it wires up all the
    /// actors, sets the stage lighting, and then steps aside.
    /// </summary>
    public class SceneBootstrapper : MonoBehaviour
    {
        // ── Inspector ─────────────────────────────────────────────────────
        [Header("Player")]
        [SerializeField] private GameObject playerPrefab;
        [SerializeField] private Transform  spawnPoint;

        [Header("Lighting")]
        [SerializeField] private Light      ambientLight;
        [SerializeField] private Color      dungeonAmbientColor = new Color(0.02f, 0.02f, 0.04f);
        [SerializeField] private float      ambientIntensity    = 0.08f;

        [Header("Maze")]
        [SerializeField] private Maze.LabyrinthGenerator mazeGenerator;

        // ── Unity ─────────────────────────────────────────────────────────
        private void Awake()
        {
            // Apply authentic Three.js True Horror Lighting & Atmosphere (#06080c)
            Color horrorBlack = new Color(0.024f, 0.031f, 0.047f);
            RenderSettings.ambientMode      = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight     = horrorBlack;
            RenderSettings.ambientIntensity = 0.05f;
            RenderSettings.skybox           = null;
            RenderSettings.fog              = true;
            RenderSettings.fogMode          = FogMode.ExponentialSquared;
            RenderSettings.fogDensity       = 0.055f;
            RenderSettings.fogColor         = horrorBlack;

            if (Camera.main != null)
            {
                Camera.main.clearFlags      = CameraClearFlags.SolidColor;
                Camera.main.backgroundColor = horrorBlack;
            }

            if (ambientLight != null)
                ambientLight.intensity = ambientIntensity;
        }

        private void Start()
        {
            if (Camera.main != null)
            {
                Color horrorBlack = new Color(0.024f, 0.031f, 0.047f);
                Camera.main.clearFlags      = CameraClearFlags.SolidColor;
                Camera.main.backgroundColor = horrorBlack;
            }

            if (mazeGenerator == null)
            {
                mazeGenerator = FindObjectOfType<Maze.LabyrinthGenerator>();
                if (mazeGenerator == null)
                {
                    var mazeGO = new GameObject("ProceduralLabyrinth");
                    mazeGenerator = mazeGO.AddComponent<Maze.LabyrinthGenerator>();
                }
            }

            // Generate the maze
            mazeGenerator.GenerateNewMaze(GameState.DungeonSeed);

            // Spawn or place local player
            SpawnPlayer();
        }

        // ── Helpers ────────────────────────────────────────────────────────
        private void SpawnPlayer()
        {
            float blockSize = 6.0f;
            int gridWidth = 11;
            int gridHeight = 11;
            float halfWidth = (gridWidth * blockSize) / 2.0f;
            float halfHeight = (gridHeight * blockSize) / 2.0f;
            float spawnX = (1 * blockSize) - halfWidth + (blockSize / 2.0f);
            float spawnZ = (1 * blockSize) - halfHeight + (blockSize / 2.0f);
            Vector3 defaultSpawn = new Vector3(spawnX, 1.0f, spawnZ);

            var existingPlayer = GameObject.FindGameObjectWithTag("Player");
            if (existingPlayer != null)
            {
                // If the player is floating outside the maze or at weird height, teleport to entrance
                if (existingPlayer.transform.position.y < -0.5f || existingPlayer.transform.position.y > 6.0f ||
                    Mathf.Abs(existingPlayer.transform.position.x) > 40f || Mathf.Abs(existingPlayer.transform.position.z) > 40f)
                {
                    existingPlayer.transform.position = defaultSpawn;
                }

                // Hide primitive capsule mesh if attached
                var mr = existingPlayer.GetComponent<MeshRenderer>();
                if (mr != null) mr.enabled = false;

#if UNITY_EDITOR
                Transform vis = existingPlayer.transform.Find("PlayerVisuals");
                if (vis == null)
                {
                    GameObject model = UnityEditor.AssetDatabase.LoadAssetAtPath<GameObject>("Assets/_Manifestation/Animations/human_idle.fbx");
                    if (model == null) model = UnityEditor.AssetDatabase.LoadAssetAtPath<GameObject>("Assets/_Manifestation/Animations/Breathing Idle.fbx");
                    if (model != null)
                    {
                        GameObject spawnedVis = Instantiate(model, existingPlayer.transform);
                        spawnedVis.name = "PlayerVisuals";
                        spawnedVis.transform.localPosition = new Vector3(0, -1.0f, 0);
                        spawnedVis.transform.localRotation = Quaternion.identity;
                    }
                }
#endif
                Debug.Log($"[Bootstrapper] Using player at {existingPlayer.transform.position}.");
                return;
            }

            if (playerPrefab == null)
            {
                Debug.LogWarning("[Bootstrapper] No player prefab assigned and no Player found in scene.");
                return;
            }

            Vector3 pos = spawnPoint != null ? spawnPoint.position : defaultSpawn;
            var player  = Instantiate(playerPrefab, pos, Quaternion.identity);
            player.name = "Player";
            player.tag  = "Player";

            Debug.Log($"[Bootstrapper] Player spawned at {pos}. Seed: {GameState.DungeonSeed}");
        }
    }
}
