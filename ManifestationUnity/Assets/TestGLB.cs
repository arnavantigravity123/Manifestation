using UnityEditor;
using UnityEngine;
public class TestGLB {
    [MenuItem("Test/Check GLB")]
    public static void Check() {
        var go = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/_Manifestation/Dungeon/models/dungeon.glb");
        Debug.Log("GLB GO: " + (go != null ? go.name : "NULL"));
    }
}
