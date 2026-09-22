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
                        CreateVelvetCarpet(cellPos);
                    }
                    else if (cellType == 0)
                    {
                        // Walkable corridor: spawn velvet red carpet runner!
                        CreateVelvetCarpet(cellPos);
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

        private void CreateVelvetCarpet(Vector3 cellPos)
        {
            // Center velvet red runner (2.0m wide matching Three.js specification)
            GameObject carpet = GameObject.CreatePrimitive(PrimitiveType.Cube);
            carpet.name = "VelvetRedRunner";
            carpet.transform.SetParent(mazeContainer);
            carpet.transform.position = new Vector3(cellPos.x, 0.005f, cellPos.z);
            carpet.transform.localScale = new Vector3(2.0f, 0.01f, blockSize);

            var renderer = carpet.GetComponent<MeshRenderer>();
            if (renderer != null)
            {
                renderer.sharedMaterial = GetOrCreateVelvetMaterial();
            }

            // Gold border trims on left & right (+2mm elevation to prevent Z-fighting)
            CreateCarpetBorder(cellPos, -1.05f);
            CreateCarpetBorder(cellPos,  1.05f);
        }

        private void CreateCarpetBorder(Vector3 cellPos, float offsetX)
        {
            GameObject border = GameObject.CreatePrimitive(PrimitiveType.Cube);
            border.name = "GoldCarpetBorder";
            border.transform.SetParent(mazeContainer);
            border.transform.position = new Vector3(cellPos.x + offsetX, 0.007f, cellPos.z);
            border.transform.localScale = new Vector3(0.08f, 0.012f, blockSize);

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
            _cachedWallMat.color = new Color(0.28f, 0.28f, 0.30f); // authentic stone brick grey
            return _cachedWallMat;
        }

        private static Material _cachedFloorMat;
        private static Material GetOrCreateFloorMaterial()
        {
            if (_cachedFloorMat != null) return _cachedFloorMat;
            _cachedFloorMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            _cachedFloorMat.color = new Color(0.14f, 0.14f, 0.16f); // dark cobblestone
            return _cachedFloorMat;
        }

        private static Material _cachedVelvetMat;
        private static Material GetOrCreateVelvetMaterial()
        {
            if (_cachedVelvetMat != null) return _cachedVelvetMat;
            _cachedVelvetMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            // Vibrant crimson red velvet matching Three.js rug color (#9e1b24)
            _cachedVelvetMat.color = new Color(0.62f, 0.11f, 0.14f);
            _cachedVelvetMat.SetFloat("_Smoothness", 0.15f);
            return _cachedVelvetMat;
        }

        private static Material _cachedGoldMat;
        private static Material GetOrCreateGoldBorderMaterial()
        {
            if (_cachedGoldMat != null) return _cachedGoldMat;
            _cachedGoldMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            // Metallic gold border trim matching Three.js (#d4af37)
            _cachedGoldMat.color = new Color(0.83f, 0.68f, 0.21f);
            _cachedGoldMat.SetFloat("_Metallic", 0.7f);
            _cachedGoldMat.SetFloat("_Smoothness", 0.6f);
            return _cachedGoldMat;
        }

        public float BlockSize => blockSize;
        public int[,] Layout => layout;
        public Vector2Int VaultCoordinates => vaultCoord;
    }
}
