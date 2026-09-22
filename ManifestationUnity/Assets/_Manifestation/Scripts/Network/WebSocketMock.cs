using System;
using System.Threading.Tasks;

namespace NativeWebSocket
{
    public enum WebSocketState
    {
        Connecting,
        Open,
        Closing,
        Closed
    }

    public class WebSocket
    {
        public WebSocketState State { get; private set; } = WebSocketState.Closed;

        public event Action OnOpen;
        public event Action<byte[]> OnMessage;
        public event Action<string> OnError;
        public event Action<WebSocketCloseCode> OnClose;

        public WebSocket(string url) { }

        public Task Connect()
        {
            State = WebSocketState.Open;
            OnOpen?.Invoke();
            return Task.CompletedTask;
        }

        public Task Close()
        {
            State = WebSocketState.Closed;
            OnClose?.Invoke(WebSocketCloseCode.Normal);
            return Task.CompletedTask;
        }

        public Task SendText(string text)
        {
            return Task.CompletedTask;
        }

        public void DispatchMessageQueue() { }
    }

    public enum WebSocketCloseCode
    {
        Normal = 1000
    }
}
