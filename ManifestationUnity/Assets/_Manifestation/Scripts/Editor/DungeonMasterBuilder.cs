#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using UnityEngine.UI;
using TMPro;
using System.Linq;

namespace Manifestation.EditorTools
{
    public class DungeonMasterBuilder : MonoBehaviour
    {
        [MenuItem("Manifestation/1. BUILD COMPLETE PLAY STORE READY DUNGEON")]
        public static void BuildCompleteDungeon()
        {
            Debug.Log("<color=cyan>[MasterBuilder] Initiating Full Game Construction...</color>");

            string matDir = "Assets/_Manifestation/Materials";
            if (!AssetDatabase.IsValidFolder(matDir)) AssetDatabase.CreateFolder("Assets/_Manifestation", "Materials");

            Texture2D wallTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/_Manifestation/Dungeon/textures/WallColor.png");
            Texture2D groundTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/_Manifestation/Dungeon/textures/GroundColor.png");
            Texture2D rugTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/_Manifestation/Dungeon/textures/RugColor.png");
            Texture2D colTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/_Manifestation/Dungeon/textures/ColumnColor.png");
            Texture2D statueTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/_Manifestation/Dungeon/textures/StatueColor.png");

            Material wallMat = CreateLitMaterial(matDir + "/M_DungeonWall.mat", wallTex, new Color(0.35f, 0.35f, 0.38f), 2f, 1.5f);
            Material floorMat = CreateLitMaterial(matDir + "/M_DungeonFloor.mat", groundTex, new Color(0.25f, 0.25f, 0.28f), 3f, 3f);
            Material ceilingMat = CreateLitMaterial(matDir + "/M_DungeonCeiling.mat", wallTex, new Color(0.12f, 0.12f, 0.14f), 2f, 2f);
            Material pillarMat = CreateLitMaterial(matDir + "/M_DungeonColumn.mat", colTex, new Color(0.40f, 0.40f, 0.42f), 1f, 2f);
            Material rugMat = CreateLitMaterial(matDir + "/M_DungeonRug.mat", rugTex, new Color(0.66f, 0.12f, 0.15f), 1f, 1f);
            Material statueMat = CreateLitMaterial(matDir + "/M_DungeonStatue.mat", statueTex, new Color(0.45f, 0.45f, 0.48f), 1f, 1f);

            string prefabDir = "Assets/_Manifestation/Prefabs";
            if (!AssetDatabase.IsValidFolder(prefabDir)) AssetDatabase.CreateFolder("Assets/_Manifestation", "Prefabs");

            GameObject fbxRoot = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/_Manifestation/Dungeon/models/DungedonAssets.fbx");
            Transform[] allTransforms = fbxRoot != null ? fbxRoot.GetComponentsInChildren<Transform>(true) : new Transform[0];

            GameObject pillarGO = allTransforms.FirstOrDefault(t => t.name.ToLower().Contains("pillar"))?.gameObject;
            GameObject wallGO = allTransforms.FirstOrDefault(t => t.name.ToLower().Contains("wall"))?.gameObject;
            GameObject floorGO = allTransforms.FirstOrDefault(t => t.name.ToLower().Contains("floor"))?.gameObject;
            GameObject statueGO = allTransforms.FirstOrDefault(t => t.name.ToLower().Contains("statue"))?.gameObject;
            GameObject rugGO = allTransforms.FirstOrDefault(t => t.name.ToLower().Contains("rug"))?.gameObject;

            CreatePrefab("DungeonPillar", pillarGO, pillarMat, prefabDir, 0.463f, PrimitiveType.Cylinder);
            CreatePrefab("DungeonWall", wallGO, wallMat, prefabDir, 1.0f, PrimitiveType.Cube);
            CreatePrefab("DungeonFloor", floorGO, floorMat, prefabDir, 1.0f, PrimitiveType.Cube);
            CreatePrefab("DungeonStatue", statueGO, statueMat, prefabDir, 0.8095f, PrimitiveType.Capsule);
            CreatePrefab("DungeonRug", rugGO, rugMat, prefabDir, 1.0f, PrimitiveType.Cube);
            CreatePrefab("DungeonCeiling", floorGO, ceilingMat, prefabDir, 1.0f, PrimitiveType.Cube);

            SetupTrueHorrorEnvironment();
            BuildInGameHUD();

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("<color=green>[MasterBuilder] COMPLETE PLAY STORE READY DUNGEON BUILT!</color>");
        }

        private static void CreatePrefab(string name, GameObject sourceGO, Material mat, string prefabDir, float scale, PrimitiveType fallback)
        {
            GameObject go = new GameObject(name);
            MeshFilter sourceMf = sourceGO != null ? sourceGO.GetComponent<MeshFilter>() : null;
            if (sourceMf == null && sourceGO != null) sourceMf = sourceGO.GetComponentInChildren<MeshFilter>();

            if (sourceMf != null && sourceMf.sharedMesh != null)
            {
                go.AddComponent<MeshFilter>().sharedMesh = sourceMf.sharedMesh;
                go.AddComponent<MeshRenderer>().sharedMaterial = mat;
                go.AddComponent<BoxCollider>();
            }
            else
            {
                DestroyImmediate(go);
                go = GameObject.CreatePrimitive(fallback);
                go.name = name;
                go.GetComponent<MeshRenderer>().sharedMaterial = mat;
            }

            go.transform.localScale = new Vector3(scale, scale, scale);
            PrefabUtility.SaveAsPrefabAsset(go, prefabDir + "/" + name + ".prefab");
            DestroyImmediate(go);
        }

        private static Material CreateLitMaterial(string path, Texture2D tex, Color tint, float tileX = 1f, float tileY = 1f)
        {
            Material mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null)
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Lit");
                if (shader == null) shader = Shader.Find("Standard");
                mat = new Material(shader);
                AssetDatabase.CreateAsset(mat, path);
            }
            mat.color = tint;
            if (tex != null)
            {
                mat.mainTexture = tex;
                mat.mainTextureScale = new Vector2(tileX, tileY);
            }
            return mat;
        }

        private static void SetupTrueHorrorEnvironment()
        {
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.015f, 0.018f, 0.025f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = 0.055f;
            RenderSettings.fogColor = new Color(0.01f, 0.01f, 0.015f);

            GameObject dirLight = GameObject.Find("Directional Light");
            if (dirLight != null)
            {
                var l = dirLight.GetComponent<Light>();
                if (l != null)
                {
                    l.intensity = 0.02f;
                    l.color = new Color(0.2f, 0.3f, 0.5f);
                }
            }
        }

        private static void BuildInGameHUD()
        {
            GameObject existingCanvas = GameObject.Find("InGameHUD_Canvas");
            if (existingCanvas != null) DestroyImmediate(existingCanvas);

            GameObject canvasGO = new GameObject("InGameHUD_Canvas");
            Canvas canvas = canvasGO.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvasGO.AddComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            canvasGO.GetComponent<CanvasScaler>().referenceResolution = new Vector2(1920, 1080);
            canvasGO.AddComponent<GraphicRaycaster>();

            var hud = canvasGO.AddComponent<UI.HUDController>();

            GameObject statsPanel = CreateUIPanel(canvasGO.transform, "StatsPanel", new Vector2(0, 1), new Vector2(0, 1), new Vector2(30, -30), new Vector2(340, 160), new Color(0.04f, 0.05f, 0.08f, 0.85f));
            CreateStatBar(statsPanel.transform, "HealthBar", "HEALTH", new Color(0.95f, 0.20f, 0.28f), 0);
            CreateStatBar(statsPanel.transform, "SanityBar", "SANITY", new Color(0.70f, 0.25f, 0.95f), 1);
            CreateStatBar(statsPanel.transform, "BatteryBar", "FLASHLIGHT", new Color(0.15f, 0.85f, 0.95f), 2);
            CreateStatBar(statsPanel.transform, "StaminaBar", "STAMINA", new Color(0.95f, 0.65f, 0.15f), 3);

            GameObject objBar = CreateUIPanel(canvasGO.transform, "ObjectiveBar", new Vector2(0.5f, 1), new Vector2(0.5f, 1), new Vector2(0, -35), new Vector2(560, 75), new Color(0.03f, 0.04f, 0.07f, 0.92f));
            CreateText(objBar.transform, "Title", "SECURED (3-TIER LOCK)", 18, FontStyles.Bold, new Color(0.95f, 0.25f, 0.30f), new Vector2(0, 16));
            CreateText(objBar.transform, "Sub", "BREAKERS 0/3   |   KEYS: 0/1   |   CODE: ????", 15, FontStyles.Normal, new Color(0.35f, 0.85f, 0.95f), new Vector2(0, -14));
        }

        private static GameObject CreateUIPanel(Transform parent, string name, Vector2 anchorMin, Vector2 anchorMax, Vector2 anchoredPos, Vector2 size, Color color)
        {
            GameObject go = new GameObject(name);
            go.transform.SetParent(parent, false);
            RectTransform rect = go.AddComponent<RectTransform>();
            rect.anchorMin = anchorMin;
            rect.anchorMax = anchorMax;
            rect.pivot = anchorMin;
            rect.anchoredPosition = anchoredPos;
            rect.sizeDelta = size;

            Image img = go.AddComponent<Image>();
            img.color = color;
            return go;
        }

        private static void CreateStatBar(Transform parent, string name, string label, Color barColor, int index)
        {
            float yPos = -22 - (index * 32);
            GameObject row = new GameObject(name + "_Row");
            row.transform.SetParent(parent, false);
            RectTransform r = row.AddComponent<RectTransform>();
            r.anchoredPosition = new Vector2(16, yPos);
            r.sizeDelta = new Vector2(310, 24);

            CreateText(row.transform, "Label", label, 12, FontStyles.Bold, Color.white, new Vector2(0, 0));

            GameObject bg = CreateUIPanel(row.transform, "BarBG", new Vector2(0, 0.5f), new Vector2(0, 0.5f), new Vector2(120, 0), new Vector2(180, 14), new Color(0.1f, 0.1f, 0.12f, 0.9f));
            GameObject fill = CreateUIPanel(bg.transform, "Fill", new Vector2(0, 0), new Vector2(1, 1), Vector2.zero, Vector2.zero, barColor);
        }

        private static void CreateText(Transform parent, string name, string content, float size, FontStyles style, Color color, Vector2 pos)
        {
            GameObject go = new GameObject(name);
            go.transform.SetParent(parent, false);
            RectTransform rect = go.AddComponent<RectTransform>();
            rect.anchoredPosition = pos;
            rect.sizeDelta = new Vector2(400, 30);

            TextMeshProUGUI tmp = go.AddComponent<TextMeshProUGUI>();
            tmp.text = content;
            tmp.fontSize = size;
            tmp.fontStyle = style;
            tmp.color = color;
            tmp.alignment = TextAlignmentOptions.Center;
        }
    }
}
#endif
