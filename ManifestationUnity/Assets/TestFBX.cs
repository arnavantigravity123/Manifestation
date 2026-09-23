using UnityEditor;
using UnityEngine;
using System.IO;
public class TestFBX {
    public static void Check() {
        string path = "Assets/_Manifestation/Dungeon/models/DungedonAssets.fbx";
        Object[] assets = AssetDatabase.LoadAllAssetsAtPath(path);
        string result = "FBX Contents:\n";
        foreach(var a in assets) {
            if(a is Mesh) result += "Mesh: " + a.name + "\n";
            else if(a is GameObject) result += "GameObject: " + a.name + "\n";
        }
        File.WriteAllText("fbx_meshes.txt", result);
        EditorApplication.Exit(0);
    }
}
