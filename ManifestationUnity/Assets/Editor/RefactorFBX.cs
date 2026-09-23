using UnityEngine;
using UnityEditor;
using System.Linq;

public class RefactorFBX {
    public static void DoRefactor() {
        string path = "Assets/_Manifestation/Dungeon/models/DungedonAssets.fbx";
        Object[] assets = AssetDatabase.LoadAllAssetsAtPath(path);
        
        string result = "Found meshes in FBX:\n";
        foreach(var a in assets.OfType<Mesh>()) {
            result += "- " + a.name + "\n";
        }
        System.IO.File.WriteAllText("C:/Antigravity agents/Manifestation/meshes_list.txt", result);
        EditorApplication.Exit(0);
    }
}
