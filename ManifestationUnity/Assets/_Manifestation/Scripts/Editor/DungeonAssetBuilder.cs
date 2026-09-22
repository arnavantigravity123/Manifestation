#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;

namespace Manifestation.EditorTools
{
    public class DungeonAssetBuilder : MonoBehaviour
    {
        [MenuItem("Manifestation/1. Build Authentic Dungeon Prefabs & Lighting")]
        public static void BuildAuthenticDungeon()
        {
            Debug.Log("[DungeonBuilder] Building authentic dungeon materials and prefabs...");

            // 1. Ensure Prefabs directory exists
            string prefabDir = "Assets/_Manifestation/Prefabs";
            if (!AssetDatabase.IsValidFolder(prefabDir))
            {
                AssetDatabase.CreateFolder("Assets/_Manifestation", "Prefabs");
            }

            // 2. Load authentic textures
            Texture2D wallTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/_Manifestation/Dungeon/textures/WallColor.png");
            Texture2D groundTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/_Manifestation/Dungeon/textures/GroundColor.png");
            Texture2D rugTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/_Manifestation/Dungeon/textures/RugColor.png");
            Texture2D columnTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/_Manifestation/Dungeon/textures/ColumnColor.png");

            // 3. Create or load materials
            string matDir = "Assets/_Manifestation/Materials";
            if (!AssetDatabase.IsValidFolder(matDir))
            {
                AssetDatabase.CreateFolder("Assets/_Manifestation", "Materials");
            }

            Material wallMat = CreateOrGetMaterial(matDir + "/M_DungeonWall.mat", wallTex, new Color(0.45f, 0.45f, 0.48f));
            Material floorMat = CreateOrGetMaterial(matDir + "/M_DungeonFloor.mat", groundTex, new Color(0.35f, 0.35f, 0.38f));
            Material rugMat = CreateOrGetMaterial(matDir + "/M_DungeonRug.mat", rugTex, new Color(0.85f, 0.20f, 0.25f));
            Material colMat = CreateOrGetMaterial(matDir + "/M_DungeonColumn.mat", columnTex, new Color(0.50f, 0.50f, 0.52f));
            Material ceilingMat = CreateOrGetMaterial(matDir + "/M_DungeonCeiling.mat", wallTex, new Color(0.20f, 0.20f, 0.22f));

            // Set tile tiling for floor and wall
            if (wallMat != null) wallMat.mainTextureScale = new Vector2(3f, 2f);
            if (floorMat != null) floorMat.mainTextureScale = new Vector2(3f, 3f);

            // 4. Create authentic Wall Prefab (with brick texture + ceiling slab + stone pillars at corners)
            GameObject wallRoot = new GameObject("Prefab_DungeonWall");
            
            // Main stone brick wall
            GameObject wallBlock = GameObject.CreatePrimitive(PrimitiveType.Cube);
            wallBlock.name = "WallBlock";
            wallBlock.transform.SetParent(wallRoot.transform);
            wallBlock.transform.localPosition = new Vector3(0f, 1.9f, 0f);
            wallBlock.transform.localScale = new Vector3(6.0f, 3.8f, 6.0f);
            wallBlock.GetComponent<MeshRenderer>().sharedMaterial = wallMat;

            // Save Wall Prefab
            string wallPrefabPath = prefabDir + "/DungeonWall.prefab";
            PrefabUtility.SaveAsPrefabAsset(wallRoot, wallPrefabPath);
            DestroyImmediate(wallRoot);

            // 5. Create authentic Floor + Ceiling Tile Prefab
            GameObject floorRoot = new GameObject("Prefab_DungeonFloor");

            // Cobblestone floor
            GameObject floorBlock = GameObject.CreatePrimitive(PrimitiveType.Cube);
            floorBlock.name = "FloorBlock";
            floorBlock.transform.SetParent(floorRoot.transform);
            floorBlock.transform.localPosition = new Vector3(0f, -0.05f, 0f);
            floorBlock.transform.localScale = new Vector3(6.0f, 0.1f, 6.0f);
            floorBlock.GetComponent<MeshRenderer>().sharedMaterial = floorMat;

            // Gothic ceiling slab (3.8m above ground to enclose hallway in pitch darkness)
            GameObject ceilingBlock = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ceilingBlock.name = "CeilingBlock";
            ceilingBlock.transform.SetParent(floorRoot.transform);
            ceilingBlock.transform.localPosition = new Vector3(0f, 3.85f, 0f);
            ceilingBlock.transform.localScale = new Vector3(6.0f, 0.1f, 6.0f);
            ceilingBlock.GetComponent<MeshRenderer>().sharedMaterial = ceilingMat;

            // Save Floor Prefab
            string floorPrefabPath = prefabDir + "/DungeonFloor.prefab";
            PrefabUtility.SaveAsPrefabAsset(floorRoot, floorPrefabPath);
            DestroyImmediate(floorRoot);

            // 6. Setup Atmosphere & Horror Lighting
            SetupHorrorLighting();

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("<color=green>[DungeonBuilder] ✓ Authentic Dungeon Materials, Wall/Floor Prefabs & Horror Lighting built successfully!</color>");
        }

        private static Material CreateOrGetMaterial(string path, Texture2D texture, Color fallbackColor)
        {
            Material mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null)
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Lit");
                if (shader == null) shader = Shader.Find("Standard");
                mat = new Material(shader);
                AssetDatabase.CreateAsset(mat, path);
            }
            if (texture != null)
            {
                mat.mainTexture = texture;
                mat.color = Color.white;
            }
            else
            {
                mat.color = fallbackColor;
            }
            return mat;
        }

        private static void SetupHorrorLighting()
        {
            // Dim ambient light to deep gothic gloom
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.04f, 0.05f, 0.07f); // midnight dungeon blue
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = 0.04f;
            RenderSettings.fogColor = new Color(0.02f, 0.02f, 0.03f);

            // Find or create player flashlight
            GameObject player = GameObject.FindGameObjectWithTag("Player");
            if (player != null)
            {
                Camera cam = player.GetComponentInChildren<Camera>();
                Transform camTransform = cam != null ? cam.transform : player.transform;

                // Check for existing flashlight
                Light existingLight = camTransform.GetComponentInChildren<Light>();
                if (existingLight == null)
                {
                    GameObject flashGO = new GameObject("FlashlightBeam");
                    flashGO.transform.SetParent(camTransform);
                    flashGO.transform.localPosition = new Vector3(0.2f, -0.1f, 0.3f);
                    flashGO.transform.localRotation = Quaternion.identity;

                    Light spot = flashGO.AddComponent<Light>();
                    spot.type = LightType.Spot;
                    spot.range = 24f;
                    spot.spotAngle = 60f;
                    spot.innerSpotAngle = 35f;
                    spot.intensity = 2.8f;
                    spot.color = new Color(1.0f, 0.95f, 0.85f); // warm realistic incandescent beam
                    spot.shadows = LightShadows.Soft;
                }
            }

            // Turn off daylight Directional Light if present
            GameObject dirLight = GameObject.Find("Directional Light");
            if (dirLight != null)
            {
                var lightComp = dirLight.GetComponent<Light>();
                if (lightComp != null)
                {
                    lightComp.intensity = 0.05f; // barely a faint moonbeam through cracks
                    lightComp.color = new Color(0.15f, 0.2f, 0.35f);
                }
            }
        }
    }
}
#endif
