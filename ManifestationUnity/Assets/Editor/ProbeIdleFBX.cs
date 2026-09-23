using UnityEngine;
using UnityEditor;
using System.Linq;

public class ProbeIdleFBX {
    public static void Check() {
        string path = "Assets/_Manifestation/Animations/human_idle.fbx";
        GameObject fbx = AssetDatabase.LoadAssetAtPath<GameObject>(path);
        if (fbx != null) {
            System.IO.File.WriteAllText("C:/Antigravity agents/Manifestation/human_mesh.txt", "Root: " + fbx.name + "\n");
            foreach (var mf in fbx.GetComponentsInChildren<SkinnedMeshRenderer>()) {
                System.IO.File.AppendAllText("C:/Antigravity agents/Manifestation/human_mesh.txt", "SkinnedMesh: " + mf.name + "\n");
            }
        }
        EditorApplication.Exit(0);
    }
}
