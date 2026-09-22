using UnityEngine;
using UnityEngine.AI;

namespace Manifestation.AI
{
    /// <summary>
    /// Ghost enemy AI — uses Unity's NavMesh to stalk the player through the maze.
    ///
    /// Think of the NavMesh like a "floor map" baked into the maze — the ghost
    /// knows every valid walkable path and can route around walls.  The AI has
    /// three states (like a predator):
    ///   PATROL  → wanders random waypoints
    ///   CHASE   → sprints toward detected player
    ///   LUNGE   → close-range grab attempt
    ///
    /// On successful capture: PlayerStats.TakeDamage() is called and sanity drops.
    /// </summary>
    [RequireComponent(typeof(NavMeshAgent))]
    [RequireComponent(typeof(Animator))]
    public class GhostAI : MonoBehaviour
    {
        // ── Inspector ─────────────────────────────────────────────────────
        [Header("Detection")]
        [SerializeField] private float detectionRadius  = 12f;
        [SerializeField] private float losePlayerRadius = 20f;
        [SerializeField] private float lungeRadius      = 2.2f;
        [SerializeField] private LayerMask sightMask;   // walls that block line-of-sight

        [Header("Movement Speeds")]
        [SerializeField] private float patrolSpeed = 1.8f;
        [SerializeField] private float chaseSpeed  = 5.5f;
        [SerializeField] private float lungeSpeed  = 8.0f;

        [Header("Patrol")]
        [SerializeField] private float waypointRadius    = 8f;    // how far to pick random waypoints
        [SerializeField] private float waypointWaitTime  = 2.0f;

        [Header("Capture")]
        [SerializeField] private float captureDamage     = 25f;
        [SerializeField] private float captureKnockback  = 3.0f;
        [SerializeField] private float captureCooldown   = 4.0f;

        [Header("Audio")]
        [SerializeField] private AudioClip ambientMoanClip;
        [SerializeField] private AudioClip chaseBreathClip;
        [SerializeField] private AudioClip captureClip;

        [Header("VFX")]
        [SerializeField] private ParticleSystem hazeVFX;  // wispy particles around ghost

        // ── Animator hashes ───────────────────────────────────────────────
        private static readonly int AnimSpeed   = Animator.StringToHash("Speed");
        private static readonly int AnimChasing = Animator.StringToHash("IsChasing");
        private static readonly int AnimLunge   = Animator.StringToHash("Lunge");

        // ── Components ────────────────────────────────────────────────────
        private NavMeshAgent _agent;
        private Animator     _anim;
        private AudioSource  _audio;

        // ── Runtime state ─────────────────────────────────────────────────
        private enum GhostState { Patrol, Chase, Lunge }
        private GhostState  _state = GhostState.Patrol;

        private Transform   _playerTransform;
        private Player.PlayerStats _playerStats;

        private float _waypointTimer;
        private float _captureCooldownTimer;
        private Vector3 _patrolTarget;

        // ── Unity ─────────────────────────────────────────────────────────
        private void Awake()
        {
            _agent = GetComponent<NavMeshAgent>();
            _anim  = GetComponent<Animator>();
            _audio = GetComponent<AudioSource>();
            if (_audio == null) _audio = gameObject.AddComponent<AudioSource>();

            _agent.speed = patrolSpeed;
        }

        private void Start()
        {
            // Find the local player
            var playerGO = GameObject.FindGameObjectWithTag("Player");
            if (playerGO != null)
            {
                _playerTransform = playerGO.transform;
                _playerStats     = playerGO.GetComponent<Player.PlayerStats>();
            }

            PickNewPatrolPoint();

            if (hazeVFX != null) hazeVFX.Play();
            PlayAmbient();
        }

        private void Update()
        {
            if (_playerTransform == null) return;

            _captureCooldownTimer -= Time.deltaTime;

            float distToPlayer = Vector3.Distance(transform.position, _playerTransform.position);

            // ── State machine ──────────────────────────────────────────────
            switch (_state)
            {
                case GhostState.Patrol:
                    UpdatePatrol(distToPlayer);
                    break;
                case GhostState.Chase:
                    UpdateChase(distToPlayer);
                    break;
                case GhostState.Lunge:
                    // Lunge is animation-driven; transition back to Chase when done
                    if (_captureCooldownTimer <= 0f) TransitionTo(GhostState.Chase);
                    break;
            }

            // Update animator
            _anim.SetFloat(AnimSpeed,   _agent.velocity.magnitude);
            _anim.SetBool (AnimChasing, _state == GhostState.Chase);
        }

        // ── State updates ──────────────────────────────────────────────────
        private void UpdatePatrol(float distToPlayer)
        {
            // Check if player is in range AND has line-of-sight
            if (distToPlayer <= detectionRadius && HasLineOfSight())
            {
                TransitionTo(GhostState.Chase);
                return;
            }

            // Walk toward patrol waypoint
            _waypointTimer -= Time.deltaTime;
            if (_waypointTimer <= 0f || _agent.remainingDistance < 0.5f)
            {
                _waypointTimer = waypointWaitTime;
                PickNewPatrolPoint();
            }
        }

        private void UpdateChase(float distToPlayer)
        {
            if (distToPlayer > losePlayerRadius)
            {
                // Player escaped — go back to patrol
                TransitionTo(GhostState.Patrol);
                return;
            }

            if (distToPlayer <= lungeRadius && _captureCooldownTimer <= 0f)
            {
                TransitionTo(GhostState.Lunge);
                return;
            }

            // Keep chasing
            _agent.SetDestination(_playerTransform.position);
        }

        // ── State transitions ──────────────────────────────────────────────
        private void TransitionTo(GhostState newState)
        {
            _state = newState;
            switch (newState)
            {
                case GhostState.Patrol:
                    _agent.speed = patrolSpeed;
                    PickNewPatrolPoint();
                    break;

                case GhostState.Chase:
                    _agent.speed = chaseSpeed;
                    PlayLoop(chaseBreathClip);
                    break;

                case GhostState.Lunge:
                    _agent.speed = lungeSpeed;
                    _agent.SetDestination(_playerTransform.position);
                    _anim.SetTrigger(AnimLunge);
                    _captureCooldownTimer = captureCooldown;
                    Invoke(nameof(AttemptCapture), 0.35f); // hit window mid-animation
                    break;
            }
        }

        // ── Capture ────────────────────────────────────────────────────────
        private void AttemptCapture()
        {
            if (_playerTransform == null) return;
            float dist = Vector3.Distance(transform.position, _playerTransform.position);
            if (dist > lungeRadius * 1.5f) return; // player dodged

            // Deal damage
            _playerStats?.TakeDamage(captureDamage);

            // Knockback — push player away from ghost
            Vector3 dir = (_playerTransform.position - transform.position).normalized;
            var cc = _playerTransform.GetComponent<CharacterController>();
            if (cc != null)
                StartCoroutine(ApplyKnockback(cc, dir * captureKnockback));

            PlayOneShot(captureClip);
        }

        private System.Collections.IEnumerator ApplyKnockback(CharacterController cc, Vector3 force)
        {
            float t = 0f;
            while (t < 0.3f)
            {
                cc.Move(force * Time.deltaTime);
                t += Time.deltaTime;
                yield return null;
            }
        }

        // ── Helpers ────────────────────────────────────────────────────────
        private bool HasLineOfSight()
        {
            Vector3 origin = transform.position + Vector3.up * 1.5f;
            Vector3 target = _playerTransform.position + Vector3.up * 1.0f;
            Vector3 dir    = target - origin;
            return !Physics.Raycast(origin, dir.normalized, dir.magnitude, sightMask);
        }

        private void PickNewPatrolPoint()
        {
            Vector3 randomDir = Random.insideUnitSphere * waypointRadius;
            randomDir += transform.position;
            randomDir.y = transform.position.y;

            if (NavMesh.SamplePosition(randomDir, out NavMeshHit hit, waypointRadius, NavMesh.AllAreas))
            {
                _patrolTarget = hit.position;
                _agent.SetDestination(_patrolTarget);
            }
        }

        private void PlayAmbient()
        {
            if (ambientMoanClip != null && _audio != null)
            {
                _audio.clip = ambientMoanClip;
                _audio.loop = true;
                _audio.Play();
            }
        }

        private void PlayLoop(AudioClip clip)
        {
            if (clip == null || _audio == null) return;
            if (_audio.clip == clip) return;
            _audio.clip = clip;
            _audio.loop = true;
            _audio.Play();
        }

        private void PlayOneShot(AudioClip clip)
        {
            if (clip != null && _audio != null) _audio.PlayOneShot(clip);
        }

#if UNITY_EDITOR
        private void OnDrawGizmosSelected()
        {
            Gizmos.color = Color.red;
            Gizmos.DrawWireSphere(transform.position, detectionRadius);
            Gizmos.color = Color.yellow;
            Gizmos.DrawWireSphere(transform.position, lungeRadius);
            Gizmos.color = Color.grey;
            Gizmos.DrawWireSphere(transform.position, losePlayerRadius);
        }
#endif
    }
}
