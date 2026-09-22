using System.Collections;
using UnityEngine;

namespace Manifestation.AI
{
    /// <summary>
    /// Spawns phantom mirage loot and fleeting shadow silhouettes to induce paranoia.
    /// Replicates spawnMirageLoot and updateShadowDecoys from Three.js game.js.
    /// </summary>
    public class GhostTrickery : MonoBehaviour
    {
        [Header("Prefabs")]
        [SerializeField] private GameObject shadowDecoyPrefab;
        [SerializeField] private GameObject mirageKeyPrefab;

        [Header("Settings")]
        [SerializeField] private float mirageLifetime = 14f;
        [SerializeField] private float shadowFlashDuration = 0.8f;

        public void SpawnMirageKey(Vector3 position)
        {
            if (mirageKeyPrefab == null) return;
            GameObject mirage = Instantiate(mirageKeyPrefab, position, Quaternion.identity);
            StartCoroutine(DissolveMirageRoutine(mirage, mirageLifetime));
        }

        public void FlashShadowDecoy(Vector3 position, Vector3 lookDirection)
        {
            if (shadowDecoyPrefab == null) return;
            GameObject decoy = Instantiate(shadowDecoyPrefab, position, Quaternion.LookRotation(lookDirection));
            Destroy(decoy, shadowFlashDuration);
        }

        private IEnumerator DissolveMirageRoutine(GameObject mirageObj, float delay)
        {
            yield return new WaitForSeconds(delay);
            if (mirageObj != null)
            {
                Destroy(mirageObj);
            }
        }
    }
}
