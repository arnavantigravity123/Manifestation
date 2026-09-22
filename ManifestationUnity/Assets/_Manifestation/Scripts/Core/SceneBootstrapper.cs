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
            // Apply dungeon ambient lighting
            RenderSettings.ambientLight     = dungeonAmbientColor;
            RenderSettings.ambientIntensity = ambientIntensity;

            if (ambientLight != null)
                ambientLight.intensity = ambientIntensity;
        }

        private void Start()
        {
            // Generate the maze first (NavMesh bake happens inside)
            if (mazeGenerator != null)
                mazeGenerator.GenerateNewMaze(GameState.DungeonSeed);

            // Spawn local player after maze is built
            SpawnPlayer();
        }

        // ── Helpers ────────────────────────────────────────────────────────
        private void SpawnPlayer()
        {
            if (playerPrefab == null)
            {
                Debug.LogError("[Bootstrapper] No player prefab assigned!");
                return;
            }

            Vector3 pos = spawnPoint != null ? spawnPoint.position : Vector3.zero;
            var player  = Instantiate(playerPrefab, pos, Quaternion.identity);
            player.name = "Player";
            player.tag  = "Player";

            Debug.Log($"[Bootstrapper] Player spawned at {pos}. Seed: {GameState.DungeonSeed}");
        }
    }
}
