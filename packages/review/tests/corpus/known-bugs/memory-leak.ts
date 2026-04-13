// BUG: addEventListener without removeEventListener — memory leak
export class JsonStream {
  private socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
  }

  start(onMessage: (data: unknown) => void): void {
    this.socket.addEventListener('message', (e) => {
      onMessage(JSON.parse(e.data as string));
    });
    // never removed — leaks when instance is discarded
  }
}
