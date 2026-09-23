using UnityEditor;
using UnityEngine;
using System.IO;
using System.Linq;
public class ReadFBX {
    public static void Check() {
        string path = "Assets/_Manifestation/Dungeon/models/DungedonAssets.fbx";
        Object[] assets = AssetDatabase.LoadAllAssetsAtPath(path);
        string result = "FBX Contents:\n";
        foreach(var a in assets.OfType<Mesh>()) {
            result += "Mesh: " + a.name + "\n";
        }
        File.WriteAllText("C:/Antigravity agents/Manifestation/fbx_meshes.txt", result);
        EditorApplication.Exit(0);
    }
}
