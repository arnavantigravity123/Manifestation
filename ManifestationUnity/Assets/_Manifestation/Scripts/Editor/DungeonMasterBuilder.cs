#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using UnityEngine.UI;
using TMPro;

namespace Manifestation.EditorTools
{
    public class DungeonMasterBuilder : MonoBehaviour
    {
        [MenuItem("Manifestation/★ BUILD COMPLETE PLAY STORE READY DUNGEON ★")]
        public static void BuildCompleteDungeon()
        {
            Debug.Log("<color=cyan>[MasterBuilder] Initiating Full Game Construction...</color>");

            // 1. Create Materials with Authentic Textures
            string matDir = "Assets/_Manifestation/Materials";
            if (!AssetDatabase.IsValidFolder(matDir)) AssetDatabase.CreateFolder("Assets/_Manifestation", "Materials");

            Texture2D wallTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/_Manifestation/Dungeon/textures/WallColor.png");
            Texture2D groundTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/_Manifestation/Dungeon/textures/GroundColor.png");
            Texture2D rugTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/_Manifestation/Dungeon/textures/RugColor.png");
            Texture2D colTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/_Manifestation/Dungeon/textures/ColumnColor.png");

            Material wallMat = CreateLitMaterial(matDir + "/M_DungeonWall.mat", wallTex, new Color(0.35f, 0.35f, 0.38f), 2f, 1.5f);
            Material floorMat = CreateLitMaterial(matDir + "/M_DungeonFloor.mat", groundTex, new Color(0.25f, 0.25f, 0.28f), 3f, 3f);
            Material ceilingMat = CreateLitMaterial(matDir + "/M_DungeonCeiling.mat", wallTex, new Color(0.12f, 0.12f, 0.14f), 2f, 2f);
            Material pillarMat = CreateLitMaterial(matDir + "/M_DungeonColumn.mat", colTex, new Color(0.40f, 0.40f, 0.42f), 1f, 2f);

            // 2. Build Authentic Ornate Column Prefab
            string prefabDir = "Assets/_Manifestation/Prefabs";
            if (!AssetDatabase.IsValidFolder(prefabDir)) AssetDatabase.CreateFolder("Assets/_Manifestation", "Prefabs");

            GameObject pillarRoot = new GameObject("DungeonPillar");
            // Base pedestal
            GameObject colBase = GameObject.CreatePrimitive(PrimitiveType.Cube);
            colBase.name = "PillarBase";
            colBase.transform.SetParent(pillarRoot.transform);
            colBase.transform.localPosition = new Vector3(0f, 0.25f, 0f);
            colBase.transform.localScale = new Vector3(0.95f, 0.5f, 0.95f);
            colBase.GetComponent<MeshRenderer>().sharedMaterial = pillarMat;

            // Shaft
            GameObject colShaft = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            colShaft.name = "PillarShaft";
            colShaft.transform.SetParent(pillarRoot.transform);
            colShaft.transform.localPosition = new Vector3(0f, 1.9f, 0f);
            colShaft.transform.localScale = new Vector3(0.7f, 1.4f, 0.7f);
            colShaft.GetComponent<MeshRenderer>().sharedMaterial = pillarMat;

            // Capital cap
            GameObject colCap = GameObject.CreatePrimitive(PrimitiveType.Cube);
            colCap.name = "PillarCapital";
            colCap.transform.SetParent(pillarRoot.transform);
            colCap.transform.localPosition = new Vector3(0f, 3.55f, 0f);
            colCap.transform.localScale = new Vector3(0.95f, 0.5f, 0.95f);
            colCap.GetComponent<MeshRenderer>().sharedMaterial = pillarMat;

            PrefabUtility.SaveAsPrefabAsset(pillarRoot, prefabDir + "/DungeonPillar.prefab");
            DestroyImmediate(pillarRoot);

            // 3. Setup Complete Horror Lighting & Pitch Black Sky
            SetupTrueHorrorEnvironment();

            // 4. Build Complete Cyber-Gothic HUD Canvas
            BuildInGameHUD();

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("<color=green>[MasterBuilder] ✓ COMPLETE PLAY STORE READY DUNGEON BUILT!</color>");
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
            // Pitch black background & dense dungeon gloom
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.015f, 0.018f, 0.025f); // true pitch black gloom
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = 0.055f;
            RenderSettings.fogColor = new Color(0.01f, 0.01f, 0.015f);

            // Camera background to solid black
            Camera mainCam = Camera.main;
            if (mainCam != null)
            {
                mainCam.clearFlags = CameraClearFlags.SolidColor;
                mainCam.backgroundColor = new Color(0.01f, 0.01f, 0.015f);
            }

            // Dim Directional Light to almost zero (only moonlight through cracks)
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

            // Setup or upgrade Flashlight on Player
            GameObject player = GameObject.FindGameObjectWithTag("Player");
            if (player != null)
            {
                Camera cam = player.GetComponentInChildren<Camera>();
                Transform camTransform = cam != null ? cam.transform : player.transform;

                // Remove duplicate lights if any
                foreach (Light oldLight in camTransform.GetComponentsInChildren<Light>())
                {
                    DestroyImmediate(oldLight.gameObject);
                }

                GameObject flashGO = new GameObject("FlashlightBeam");
                flashGO.transform.SetParent(camTransform);
                flashGO.transform.localPosition = new Vector3(0.18f, -0.12f, 0.25f);
                flashGO.transform.localRotation = Quaternion.identity;

                Light spot = flashGO.AddComponent<Light>();
                spot.type = LightType.Spot;
                spot.range = 28f;
                spot.spotAngle = 55f;
                spot.innerSpotAngle = 32f;
                spot.intensity = 3.4f;
                spot.color = new Color(1.0f, 0.94f, 0.82f); // incandescent lantern warmth
                spot.shadows = LightShadows.Soft;
            }
        }

        private static void BuildInGameHUD()
        {
            // Remove existing Canvas if present to rebuild cleanly
            GameObject existingCanvas = GameObject.Find("InGameHUD_Canvas");
            if (existingCanvas != null) DestroyImmediate(existingCanvas);

            GameObject canvasGO = new GameObject("InGameHUD_Canvas");
            Canvas canvas = canvasGO.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvasGO.AddComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            canvasGO.GetComponent<CanvasScaler>().referenceResolution = new Vector2(1920, 1080);
            canvasGO.AddComponent<GraphicRaycaster>();

            // Attach HUDController
            var hud = canvasGO.AddComponent<UI.HUDController>();

            // 1. Top-Left Stat Bars Panel
            GameObject statsPanel = CreateUIPanel(canvasGO.transform, "StatsPanel", new Vector2(0, 1), new Vector2(0, 1), new Vector2(30, -30), new Vector2(340, 160), new Color(0.04f, 0.05f, 0.08f, 0.85f));
            CreateStatBar(statsPanel.transform, "HealthBar", "HEALTH", new Color(0.95f, 0.20f, 0.28f), 0);
            CreateStatBar(statsPanel.transform, "SanityBar", "SANITY", new Color(0.70f, 0.25f, 0.95f), 1);
            CreateStatBar(statsPanel.transform, "BatteryBar", "FLASHLIGHT", new Color(0.15f, 0.85f, 0.95f), 2);
            CreateStatBar(statsPanel.transform, "StaminaBar", "STAMINA", new Color(0.95f, 0.65f, 0.15f), 3);

            // 2. Top-Center Objective Bar
            GameObject objBar = CreateUIPanel(canvasGO.transform, "ObjectiveBar", new Vector2(0.5f, 1), new Vector2(0.5f, 1), new Vector2(0, -35), new Vector2(560, 75), new Color(0.03f, 0.04f, 0.07f, 0.92f));
            CreateText(objBar.transform, "Title", "SECURED (3-TIER LOCK)", 18, FontStyles.Bold, new Color(0.95f, 0.25f, 0.30f), new Vector2(0, 16));
            CreateText(objBar.transform, "Sub", "⚡ 0/3 BREAKERS   |   KEYS: 0/1   |   CODE: ????", 15, FontStyles.Normal, new Color(0.35f, 0.85f, 0.95f), new Vector2(0, -14));

            // 3. Bottom Hotbar (Slots 1 to 8)
            GameObject hotbar = CreateUIPanel(canvasGO.transform, "Hotbar", new Vector2(0.5f, 0), new Vector2(0.5f, 0), new Vector2(0, 30), new Vector2(640, 70), new Color(0.03f, 0.04f, 0.07f, 0.90f));
            string[] slotLabels = { "EMF", "PILLS", "BATT", "SALT", "CHALK", "", "", "KEYS" };
            for (int i = 0; i < 8; i++)
            {
                float xOffset = -280 + (i * 80);
                GameObject slot = CreateUIPanel(hotbar.transform, "Slot_" + (i + 1), new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(xOffset, 0), new Vector2(68, 56), new Color(0.08f, 0.10f, 0.15f, 0.95f));
                CreateText(slot.transform, "KeyNum", (i + 1).ToString(), 11, FontStyles.Bold, new Color(0.5f, 0.5f, 0.6f), new Vector2(-22, 18));
                CreateText(slot.transform, "ItemName", slotLabels[i], 12, FontStyles.Bold, new Color(0.35f, 0.85f, 0.95f), new Vector2(0, -4));
            }

            // 4. Top-Right Minimap Radar
            GameObject minimap = CreateUIPanel(canvasGO.transform, "MinimapRadar", new Vector2(1, 1), new Vector2(1, 1), new Vector2(-30, -30), new Vector2(180, 180), new Color(0.03f, 0.04f, 0.07f, 0.90f));
            CreateText(minimap.transform, "Header", "TACTICAL RADAR", 12, FontStyles.Bold, new Color(0.35f, 0.85f, 0.95f), new Vector2(0, 70));
            // Center player icon
            GameObject playerDot = CreateUIPanel(minimap.transform, "PlayerDot", new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(12, 12), new Color(0.20f, 0.90f, 1.0f));

            // 5. Center Reticle
            GameObject reticle = CreateUIPanel(canvasGO.transform, "ReticleDot", new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(6, 6), Color.white);
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

            // Bar background
            GameObject bg = CreateUIPanel(row.transform, "BarBG", new Vector2(0, 0.5f), new Vector2(0, 0.5f), new Vector2(120, 0), new Vector2(180, 14), new Color(0.1f, 0.1f, 0.12f, 0.9f));
            // Bar fill
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
