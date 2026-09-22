using System;
using System.Collections;
using UnityEngine;
// Using NativeWebSocket for Unity WebSocket support:
// https://github.com/endel/NativeWebSocket
// Install via Package Manager → Add from git URL
using NativeWebSocket;

namespace Manifestation.Network
{
    /// <summary>
    /// Network Manager — WebSocket client that connects to the existing
    /// Node.js / Socket.IO server used by the Three.js version of Manifestation.
    ///
    /// Protocol:
    ///   • "join"    → send player join payload (room, displayName, skin)
    ///   • "move"    → send local player transform every tick
    ///   • "state"   → broadcast vault/escape state changes
    ///   • "chat"    → in-game text messages
    ///
    /// Think of this like a walkie-talkie: every frame we broadcast our
    /// position and listen for other players' positions on the same channel.
    /// </summary>
    public class NetworkManager : MonoBehaviour
    {
        // ── Singleton ─────────────────────────────────────────────────────
        public static NetworkManager Instance { get; private set; }

        // ── Inspector ─────────────────────────────────────────────────────
        [Header("Server")]
        [SerializeField] private string serverUrl   = "ws://localhost:3000";
        [SerializeField] private float  sendRate    = 20f;   // position updates per second
        [SerializeField] private float  reconnectDelay = 3f;

        [Header("Room")]
        [SerializeField] private string roomId = "dungeon_01";

        // ── Events ────────────────────────────────────────────────────────
        public static event Action              OnConnected;
        public static event Action              OnDisconnected;
        public static event Action<string>      OnRawMessage;          // for PlayerNetSync
        public static event Action<PlayerMovePayload> OnRemotePlayerMove;

        // ── Runtime ───────────────────────────────────────────────────────
        private WebSocket _socket;
        private float     _sendTimer;
        private bool      _intentionalDisconnect;

        public bool IsConnected => _socket?.State == WebSocketState.Open;

        // ── Unity ─────────────────────────────────────────────────────────
        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        private void Start()
        {
            Connect();
        }

        private void Update()
        {
#if !UNITY_WEBGL || UNITY_EDITOR
            // NativeWebSocket requires manual dispatch on non-WebGL
            _socket?.DispatchMessageQueue();
#endif

            _sendTimer += Time.deltaTime;
            if (_sendTimer >= 1f / sendRate)
            {
                _sendTimer = 0f;
                SendLocalPosition();
            }
        }

        private void OnDestroy()
        {
            _intentionalDisconnect = true;
            _socket?.Close();
        }

        // ── Connection ────────────────────────────────────────────────────
        public async void Connect()
        {
            _socket = new WebSocket(serverUrl);

            _socket.OnOpen += () =>
            {
                Debug.Log("[Network] Connected to server.");
                SendJoin();
                OnConnected?.Invoke();
            };

            _socket.OnMessage += (bytes) =>
            {
                string raw = System.Text.Encoding.UTF8.GetString(bytes);
                HandleIncomingMessage(raw);
                OnRawMessage?.Invoke(raw);
            };

            _socket.OnError += (e) => Debug.LogWarning($"[Network] WebSocket error: {e}");

            _socket.OnClose += (code) =>
            {
                Debug.Log($"[Network] Connection closed ({code}).");
                OnDisconnected?.Invoke();
                if (!_intentionalDisconnect)
                    StartCoroutine(Reconnect());
            };

            await _socket.Connect();
        }

        private IEnumerator Reconnect()
        {
            yield return new WaitForSeconds(reconnectDelay);
            Debug.Log("[Network] Attempting reconnect...");
            Connect();
        }

        // ── Send helpers ──────────────────────────────────────────────────
        private void SendJoin()
        {
            var payload = new JoinPayload
            {
                type        = "join",
                room        = roomId,
                displayName = Core.GameState.PlayerDisplayName,
                seed        = Core.GameState.DungeonSeed
            };
            SendJson(payload);
        }

        private void SendLocalPosition()
        {
            if (!IsConnected) return;
            var playerGO = GameObject.FindGameObjectWithTag("Player");
            if (playerGO == null) return;

            Transform t = playerGO.transform;
            var payload = new PlayerMovePayload
            {
                type     = "move",
                x        = t.position.x,
                y        = t.position.y,
                z        = t.position.z,
                rotY     = t.eulerAngles.y
            };
            SendJson(payload);
        }

        public void SendStateChange(string stateKey, bool value)
        {
            var payload = new StatePayload { type = "state", key = stateKey, value = value };
            SendJson(payload);
        }

        private async void SendJson<T>(T payload)
        {
            if (_socket?.State != WebSocketState.Open) return;
            string json = JsonUtility.ToJson(payload);
            await _socket.SendText(json);
        }

        // ── Receive ───────────────────────────────────────────────────────
        private void HandleIncomingMessage(string json)
        {
            try
            {
                var baseMsg = JsonUtility.FromJson<BaseMessage>(json);
                switch (baseMsg.type)
                {
                    case "move":
                        var move = JsonUtility.FromJson<PlayerMovePayload>(json);
                        OnRemotePlayerMove?.Invoke(move);
                        break;
                    case "state":
                        var state = JsonUtility.FromJson<StatePayload>(json);
                        ApplyRemoteState(state);
                        break;
                    default:
                        break;
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Network] Message parse error: {e.Message}");
            }
        }

        private void ApplyRemoteState(StatePayload s)
        {
            if (s.key == "vaultOpen" && s.value)
                Core.GameState.VaultDoorOpen = true;
        }
    }

    // ── Payload structs (JSON serialisable) ────────────────────────────────
    [Serializable] public class BaseMessage        { public string type; }
    [Serializable] public class JoinPayload        { public string type; public string room; public string displayName; public int seed; }
    [Serializable] public class PlayerMovePayload  { public string type; public float x, y, z, rotY; public string playerId; }
    [Serializable] public class StatePayload       { public string type; public string key; public bool value; }
}
