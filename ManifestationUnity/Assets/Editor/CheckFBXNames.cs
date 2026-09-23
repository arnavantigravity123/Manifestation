using UnityEngine;
using UnityEditor;
using System.Linq;

public class CheckFBXNames {
    public static void Check() {
        string path = "Assets/_Manifestation/Dungeon/models/DungedonAssets.fbx";
        Object[] assets = AssetDatabase.LoadAllAssetsAtPath(path);
        string result = "Assets in FBX:\n";
        foreach(var a in assets) {
            result += a.GetType().Name + ": " + a.name + "\n";
        }
        System.IO.File.WriteAllText("C:/Antigravity agents/Manifestation/fbx_dump.txt", result);
        EditorApplication.Exit(0);
    }
}
