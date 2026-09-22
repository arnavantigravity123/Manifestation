using UnityEngine;

namespace Manifestation.Inventory
{
    /// <summary>
    /// Deploys salt barriers and chalk navigation arrows onto the dungeon floor.
    /// Replicates deploySaltTrap and deployChalkDecal from Three.js game.js.
    /// </summary>
    public class DeployableTrap : MonoBehaviour
    {
        public enum TrapType { SaltCircle, ChalkArrow }

        [Header("Trap Settings")]
        [SerializeField] private TrapType trapType = TrapType.SaltCircle;
        [SerializeField] private float slowFactor = 0.4f; // Ghosts move at 40% speed
        [SerializeField] private float durationSeconds = 30f;

        private void Start()
        {
            Destroy(gameObject, durationSeconds);
        }

        private void OnTriggerEnter(Collider other)
        {
            if (trapType == TrapType.SaltCircle && other.CompareTag("Enemy"))
            {
                var agent = other.GetComponent<UnityEngine.AI.NavMeshAgent>();
                if (agent != null)
                {
                    agent.speed *= slowFactor;
                }
            }
        }

        private void OnTriggerExit(Collider other)
        {
            if (trapType == TrapType.SaltCircle && other.CompareTag("Enemy"))
            {
                var agent = other.GetComponent<UnityEngine.AI.NavMeshAgent>();
                if (agent != null)
                {
                    agent.speed /= slowFactor;
                }
            }
        }
    }
}
