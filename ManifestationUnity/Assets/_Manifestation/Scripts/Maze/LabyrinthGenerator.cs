using System.Collections.Generic;
using UnityEngine;
using Unity.AI.Navigation;

namespace Manifestation.Maze
{
    public class LabyrinthGenerator : MonoBehaviour
    {
        [Header("Maze Dimensions")]
        [SerializeField] private int gridWidth = 11;
        [SerializeField] private int gridHeight = 11;
        [SerializeField] private float blockSize = 6.0f;
        [SerializeField] private int seed = 42;

        [Header("Prefabs")]
        [SerializeField] private GameObject wallPrefab;
        [SerializeField] private GameObject slidingDoorPrefab;
        [SerializeField] private GameObject vaultPortalPrefab;
        [SerializeField] private GameObject rugStraightPrefab;
        [SerializeField] private GameObject rugHubPrefab;
        [SerializeField] private GameObject lightSanctuaryPrefab;

        [Header("NavMesh AI Surface")]
        [SerializeField] private NavMeshSurface navMeshSurface;

        [Header("Containers")]
        [SerializeField] private Transform mazeContainer;

        private int[,] layout;
        private Vector2Int vaultCoord;

        public void GenerateNewMaze(int customSeed = -1)
        {
            if (customSeed != -1) seed = customSeed;
            Random.InitState(seed);

            ClearExistingMaze();
            BuildMazeData();
            InstantiateGeometry();

            if (navMeshSurface != null)
            {
                // Bake NavMesh for Ghost AI pathfinding
                navMeshSurface.BuildNavMesh();
            }
        }

        private void ClearExistingMaze()
        {
            if (mazeContainer == null) mazeContainer = transform;
            for (int i = mazeContainer.childCount - 1; i >= 0; i--)
            {
                DestroyImmediate(mazeContainer.GetChild(i).gameObject);
            }
        }

        private void BuildMazeData()
        {
            layout = new int[gridHeight, gridWidth];

            // 1: Solid wall, 0: Open corridor, 2: Sliding door
            for (int r = 0; r < gridHeight; r++)
            {
                for (int c = 0; c < gridWidth; c++)
                {
                    layout[r, c] = 1;
                }
            }

            // Recursive Backtracking Carve
            Stack<Vector2Int> stack = new Stack<Vector2Int>();
            Vector2Int start = new Vector2Int(1, 1);
            layout[start.y, start.x] = 0;
            stack.Push(start);

            Vector2Int[] directions = {
                new Vector2Int(0, -2), // North
                new Vector2Int(0, 2),  // South
                new Vector2Int(-2, 0), // West
                new Vector2Int(2, 0)   // East
            };

            while (stack.Count > 0)
            {
                Vector2Int current = stack.Peek();
                List<Vector2Int> unvisitedNeighbors = new List<Vector2Int>();

                foreach (var dir in directions)
                {
                    Vector2Int neighbor = current + dir;
                    if (neighbor.x > 0 && neighbor.x < gridWidth - 1 &&
                        neighbor.y > 0 && neighbor.y < gridHeight - 1 &&
                        layout[neighbor.y, neighbor.x] == 1)
                    {
                        unvisitedNeighbors.Add(dir);
                    }
                }

                if (unvisitedNeighbors.Count > 0)
                {
                    Vector2Int chosenDir = unvisitedNeighbors[Random.Range(0, unvisitedNeighbors.Count)];
                    Vector2Int wallBetween = current + (chosenDir / 2);
                    Vector2Int neighbor = current + chosenDir;

                    layout[wallBetween.y, wallBetween.x] = (Random.value < 0.15f) ? 2 : 0; // 15% sliding doors
                    layout[neighbor.y, neighbor.x] = 0;

                    stack.Push(neighbor);
                }
                else
                {
                    stack.Pop();
                }
            }

            // Place Master Vault on perimeter wall adjacent to an open corridor
            vaultCoord = new Vector2Int(gridWidth / 2, 0);
            layout[vaultCoord.y, vaultCoord.x] = 0; // Unblock vault threshold
        }

        private void InstantiateGeometry()
        {
            float halfWidth = (gridWidth * blockSize) / 2.0f;
            float halfHeight = (gridHeight * blockSize) / 2.0f;

            for (int r = 0; r < gridHeight; r++)
            {
                for (int c = 0; c < gridWidth; c++)
                {
                    float worldX = (c * blockSize) - halfWidth + (blockSize / 2.0f);
                    float worldZ = (r * blockSize) - halfHeight + (blockSize / 2.0f);
                    Vector3 cellPos = new Vector3(worldX, 0f, worldZ);

                    int cellType = layout[r, c];

                    // 1. ALWAYS lay base cobblestone floor for EVERY cell so there are ZERO holes!
                    CreateProceduralDungeonFloor(cellPos);

                    if (r == vaultCoord.y && c == vaultCoord.x)
                    {
                        if (vaultPortalPrefab != null)
                        {
                            Instantiate(vaultPortalPrefab, cellPos, Quaternion.identity, mazeContainer);
                        }
                        continue;
                    }

                    if (cellType == 1)
                    {
                        if (wallPrefab != null)
                        {
                            Instantiate(wallPrefab, cellPos, Quaternion.identity, mazeContainer);
                        }
                        else
                        {
                            CreateProceduralDungeonWall(cellPos);
                        }
                    }
                    else if (cellType == 2 && slidingDoorPrefab != null)
                    {
                        Instantiate(slidingDoorPrefab, cellPos, Quaternion.identity, mazeContainer);
                        CreateVelvetCarpet(cellPos, r, c);
                    }
                    else if (cellType == 0)
                    {
                        // Walkable corridor: spawn velvet red carpet runner!
                        CreateVelvetCarpet(cellPos, r, c);
                    }
                }
            }
        }

        private void CreateProceduralDungeonWall(Vector3 cellPos)
        {
            GameObject wall = GameObject.CreatePrimitive(PrimitiveType.Cube);
            wall.name = "DungeonWall";
            wall.transform.SetParent(mazeContainer);
            wall.transform.position = new Vector3(cellPos.x, 1.9f, cellPos.z);
            wall.transform.localScale = new Vector3(blockSize, 3.8f, blockSize);

            var renderer = wall.GetComponent<MeshRenderer>();
            if (renderer != null)
            {
                renderer.sharedMaterial = GetOrCreateWallMaterial();
            }
        }

        private void CreateProceduralDungeonFloor(Vector3 cellPos)
        {
            GameObject floor = GameObject.CreatePrimitive(PrimitiveType.Cube);
            floor.name = "DungeonFloor";
            floor.transform.SetParent(mazeContainer);
            floor.transform.position = new Vector3(cellPos.x, -0.05f, cellPos.z);
            floor.transform.localScale = new Vector3(blockSize, 0.1f, blockSize);

            var renderer = floor.GetComponent<MeshRenderer>();
            if (renderer != null)
            {
                renderer.sharedMaterial = GetOrCreateFloorMaterial();
            }
        }

        private void CreateVelvetCarpet(Vector3 cellPos, int r, int c)
        {
            // Check connectivity to adjacent cells
            bool hasNorth = r > 0 && layout[r - 1, c] != 1;
            bool hasSouth = r < gridHeight - 1 && layout[r + 1, c] != 1;
            bool hasWest  = c > 0 && layout[r, c - 1] != 1;
            bool hasEast  = c < gridWidth - 1 && layout[r, c + 1] != 1;

            bool isPureHorizontal = (hasWest || hasEast) && !hasNorth && !hasSouth;
            bool isPureVertical   = (hasNorth || hasSouth) && !hasWest && !hasEast;

            if (isPureHorizontal)
            {
                // East-West corridor: carpet spans along X (width=blockSize, depth=2.0m)
                SpawnCarpetQuad(cellPos, new Vector3(blockSize, 0.01f, 2.0f));
                // Gold borders on North & South edges
                CreateCarpetBorder(new Vector3(cellPos.x, 0.007f, cellPos.z + 1.04f), new Vector3(blockSize, 0.012f, 0.08f));
                CreateCarpetBorder(new Vector3(cellPos.x, 0.007f, cellPos.z - 1.04f), new Vector3(blockSize, 0.012f, 0.08f));
            }
            else if (isPureVertical)
            {
                // North-South corridor: carpet spans along Z (width=2.0m, depth=blockSize)
                SpawnCarpetQuad(cellPos, new Vector3(2.0f, 0.01f, blockSize));
                // Gold borders on West & East edges
                CreateCarpetBorder(new Vector3(cellPos.x - 1.04f, 0.007f, cellPos.z), new Vector3(0.08f, 0.012f, blockSize));
                CreateCarpetBorder(new Vector3(cellPos.x + 1.04f, 0.007f, cellPos.z), new Vector3(0.08f, 0.012f, blockSize));
            }
            else
            {
                // Corner, T-Junction or 4-way Crossroads: Modular 2m x 2m Center Hub Tile
                SpawnCarpetQuad(cellPos, new Vector3(2.0f, 0.01f, 2.0f));

                // Extension arms into each open passage (2m long)
                if (hasNorth) SpawnCarpetQuad(new Vector3(cellPos.x, 0.005f, cellPos.z + 2.0f), new Vector3(2.0f, 0.01f, 2.0f));
                if (hasSouth) SpawnCarpetQuad(new Vector3(cellPos.x, 0.005f, cellPos.z - 2.0f), new Vector3(2.0f, 0.01f, 2.0f));
                if (hasEast)  SpawnCarpetQuad(new Vector3(cellPos.x + 2.0f, 0.005f, cellPos.z), new Vector3(2.0f, 0.01f, 2.0f));
                if (hasWest)  SpawnCarpetQuad(new Vector3(cellPos.x - 2.0f, 0.005f, cellPos.z), new Vector3(2.0f, 0.01f, 2.0f));
            }
        }

        private void SpawnCarpetQuad(Vector3 pos, Vector3 scale)
        {
            GameObject carpet = GameObject.CreatePrimitive(PrimitiveType.Cube);
            carpet.name = "VelvetRedRunner";
            carpet.transform.SetParent(mazeContainer);
            carpet.transform.position = new Vector3(pos.x, 0.005f, pos.z);
            carpet.transform.localScale = scale;

            var renderer = carpet.GetComponent<MeshRenderer>();
            if (renderer != null)
            {
                renderer.sharedMaterial = GetOrCreateVelvetMaterial();
            }
        }

        private void CreateCarpetBorder(Vector3 worldPos, Vector3 scale)
        {
            GameObject border = GameObject.CreatePrimitive(PrimitiveType.Cube);
            border.name = "GoldCarpetBorder";
            border.transform.SetParent(mazeContainer);
            border.transform.position = worldPos;
            border.transform.localScale = scale;

            var renderer = border.GetComponent<MeshRenderer>();
            if (renderer != null)
            {
                renderer.sharedMaterial = GetOrCreateGoldBorderMaterial();
            }
        }

        private static Material _cachedWallMat;
        private static Material GetOrCreateWallMaterial()
        {
            if (_cachedWallMat != null) return _cachedWallMat;
            _cachedWallMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            _cachedWallMat.color = new Color(0.38f, 0.38f, 0.40f);
            Texture2D tex = Resources.Load<Texture2D>("WallColor");
            if (tex != null) _cachedWallMat.mainTexture = tex;
            return _cachedWallMat;
        }

        private static Material _cachedFloorMat;
        private static Material GetOrCreateFloorMaterial()
        {
            if (_cachedFloorMat != null) return _cachedFloorMat;
            _cachedFloorMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            _cachedFloorMat.color = new Color(0.18f, 0.18f, 0.20f);
            Texture2D tex = Resources.Load<Texture2D>("GroundColor");
            if (tex != null) _cachedFloorMat.mainTexture = tex;
            return _cachedFloorMat;
        }

        private static Material _cachedVelvetMat;
        private static Material GetOrCreateVelvetMaterial()
        {
            if (_cachedVelvetMat != null) return _cachedVelvetMat;
            _cachedVelvetMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            _cachedVelvetMat.color = new Color(0.66f, 0.12f, 0.15f); // authentic crimson velvet red
            _cachedVelvetMat.SetFloat("_Smoothness", 0.2f);
            return _cachedVelvetMat;
        }

        private static Material _cachedGoldMat;
        private static Material GetOrCreateGoldBorderMaterial()
        {
            if (_cachedGoldMat != null) return _cachedGoldMat;
            _cachedGoldMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            _cachedGoldMat.color = new Color(0.88f, 0.72f, 0.24f); // metallic gold
            _cachedGoldMat.SetFloat("_Metallic", 0.75f);
            _cachedGoldMat.SetFloat("_Smoothness", 0.65f);
            return _cachedGoldMat;
        }

        public float BlockSize => blockSize;
        public int[,] Layout => layout;
        public Vector2Int VaultCoordinates => vaultCoord;
    }
}
