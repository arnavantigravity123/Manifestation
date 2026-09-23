using UnityEngine;
using UnityEditor;

public class ProbeFBX {
    [MenuItem("Tools/Probe FBX")]
    public static void Probe() {
        string path = "Assets/_Manifestation/Dungeon/models/DungedonAssets.fbx";
        GameObject fbx = AssetDatabase.LoadAssetAtPath<GameObject>(path);
        if (fbx != null) {
            Debug.Log("FBX Loaded: " + fbx.name);
            foreach (Transform t in fbx.transform) {
                Debug.Log("Child: " + t.name);
            }
        }
    }
}
