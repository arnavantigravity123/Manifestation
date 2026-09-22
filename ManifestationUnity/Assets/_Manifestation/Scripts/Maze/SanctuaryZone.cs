using UnityEngine;
using Manifestation.Player;

namespace Manifestation.Maze
{
    [RequireComponent(typeof(SphereCollider))]
    public class SanctuaryZone : MonoBehaviour
    {
        [Header("Sanctuary Parameters")]
        [SerializeField] private float sanctuaryRadius = 6.5f;
        [SerializeField] private Light sanctuaryLight;
        [SerializeField] private ParticleSystem sanctuaryDustMotes;

        private void Awake()
        {
            SphereCollider col = GetComponent<SphereCollider>();
            col.isTrigger = true;
            col.radius = sanctuaryRadius;
        }

        private void OnTriggerEnter(Collider other)
        {
            if (other.TryGetComponent(out PlayerStats stats))
            {
                stats.SetInSanctuary(true);
            }
        }

        private void OnTriggerExit(Collider other)
        {
            if (other.TryGetComponent(out PlayerStats stats))
            {
                stats.SetInSanctuary(false);
            }
        }
    }
}
