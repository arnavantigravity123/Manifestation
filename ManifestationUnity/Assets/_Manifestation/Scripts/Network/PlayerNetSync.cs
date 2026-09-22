using System.Collections.Generic;
using UnityEngine;
using Manifestation.Network;

namespace Manifestation.Network
{
    /// <summary>
    /// Player Net Sync — spawns and updates remote player avatars.
    ///
    /// For every "move" packet that arrives from the server (for a player
    /// that ISN'T us), this script finds or creates a remote avatar and
    /// smoothly interpolates it toward the received position.
    ///
    /// Think of it like a puppet controller: NetworkManager hands us the
    /// puppet's target pose, and we smoothly move the puppet to match.
    /// </summary>
    public class PlayerNetSync : MonoBehaviour
    {
        // ── Inspector ─────────────────────────────────────────────────────
        [SerializeField] private GameObject remotePlayerPrefab;  // simple ghost avatar
        [SerializeField] private float      lerpSpeed = 12f;     // interpolation speed
        [SerializeField] private float      timeoutSeconds = 10f; // remove stale players

        // ── Runtime ───────────────────────────────────────────────────────
        private readonly Dictionary<string, RemotePlayerState> _remotePlayers = new();

        private string _localPlayerId;  // set from GameState / auth

        // ── Unity ─────────────────────────────────────────────────────────
        private void OnEnable()
        {
            NetworkManager.OnRemotePlayerMove += HandleRemoteMove;
            NetworkManager.OnDisconnected     += ClearAllRemote;
        }

        private void OnDisable()
        {
            NetworkManager.OnRemotePlayerMove -= HandleRemoteMove;
            NetworkManager.OnDisconnected     -= ClearAllRemote;
        }

        private void Start()
        {
            // Use display name as a simple ID (server should assign UUID in production)
            _localPlayerId = Core.GameState.PlayerDisplayName;
        }

        private void Update()
        {
            float now = Time.time;
            var toRemove = new List<string>();

            foreach (var kvp in _remotePlayers)
            {
                var rp = kvp.Value;

                // Smooth interpolation toward last known position
                rp.avatar.transform.position = Vector3.Lerp(
                    rp.avatar.transform.position, rp.targetPosition, lerpSpeed * Time.deltaTime);

                rp.avatar.transform.rotation = Quaternion.Slerp(
                    rp.avatar.transform.rotation, rp.targetRotation, lerpSpeed * Time.deltaTime);

                // Prune stale connections
                if (now - rp.lastUpdateTime > timeoutSeconds)
                    toRemove.Add(kvp.Key);
            }

            foreach (var id in toRemove)
                RemoveRemotePlayer(id);
        }

        // ── Handlers ──────────────────────────────────────────────────────
        private void HandleRemoteMove(PlayerMovePayload payload)
        {
            // Ignore our own echoed messages
            if (payload.playerId == _localPlayerId) return;
            if (string.IsNullOrEmpty(payload.playerId)) return;

            if (!_remotePlayers.TryGetValue(payload.playerId, out var rp))
                rp = SpawnRemotePlayer(payload.playerId);

            rp.targetPosition   = new Vector3(payload.x, payload.y, payload.z);
            rp.targetRotation   = Quaternion.Euler(0f, payload.rotY, 0f);
            rp.lastUpdateTime   = Time.time;
        }

        private void ClearAllRemote()
        {
            foreach (var rp in _remotePlayers.Values)
                if (rp.avatar != null) Destroy(rp.avatar);
            _remotePlayers.Clear();
        }

        // ── Helpers ────────────────────────────────────────────────────────
        private RemotePlayerState SpawnRemotePlayer(string playerId)
        {
            var go = remotePlayerPrefab != null
                ? Instantiate(remotePlayerPrefab)
                : GameObject.CreatePrimitive(PrimitiveType.Capsule); // fallback

            go.name = $"RemotePlayer_{playerId}";

            // Remove any colliders so remote players don't block physics
            foreach (var col in go.GetComponents<Collider>())
                col.enabled = false;

            var rp = new RemotePlayerState { avatar = go, lastUpdateTime = Time.time };
            _remotePlayers[playerId] = rp;
            return rp;
        }

        private void RemoveRemotePlayer(string playerId)
        {
            if (_remotePlayers.TryGetValue(playerId, out var rp))
            {
                if (rp.avatar != null) Destroy(rp.avatar);
                _remotePlayers.Remove(playerId);
                Debug.Log($"[NetSync] Removed stale player: {playerId}");
            }
        }

        // ── Inner class ────────────────────────────────────────────────────
        private class RemotePlayerState
        {
            public GameObject avatar;
            public Vector3    targetPosition;
            public Quaternion targetRotation;
            public float      lastUpdateTime;
        }
    }
}
