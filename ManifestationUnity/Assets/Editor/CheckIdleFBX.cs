using UnityEngine;
using UnityEditor;

public class CheckIdleFBX {
    public static void Check() {
        string path = "Assets/_Manifestation/Animations/human_idle.fbx";
        GameObject fbx = AssetDatabase.LoadAssetAtPath<GameObject>(path);
        if (fbx != null) {
            bool hasMesh = fbx.GetComponentInChildren<SkinnedMeshRenderer>() != null || fbx.GetComponentInChildren<MeshRenderer>() != null;
            System.IO.File.WriteAllText("C:/Antigravity agents/Manifestation/fbx_mesh_check.txt", "Has mesh: " + hasMesh);
        } else {
            System.IO.File.WriteAllText("C:/Antigravity agents/Manifestation/fbx_mesh_check.txt", "Not found");
        }
        EditorApplication.Exit(0);
    }
}
