using UnityEngine;
using UnityEditor;

public class CheckPrefabs {
    public static void Check() {
        string[] prefabs = { "DungeonPillar", "DungeonWall", "DungeonFloor", "DungeonStatue" };
        foreach(var p in prefabs) {
            GameObject go = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/_Manifestation/Prefabs/" + p + ".prefab");
            if(go != null) {
                var mf = go.GetComponent<MeshFilter>();
                if(mf != null && mf.sharedMesh != null) {
                    Debug.Log(p + " has mesh: " + mf.sharedMesh.name);
                } else {
                    Debug.Log(p + " HAS NO MESH! Using primitive?");
                }
            } else {
                Debug.Log(p + " prefab DOES NOT EXIST! ");
            }
        }
        EditorApplication.Exit(0);
    }
}
