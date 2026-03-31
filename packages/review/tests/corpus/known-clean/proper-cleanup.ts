// CLEAN: addEventListener paired with removeEventListener in cleanup
export class JsonStream {
  private socket: WebSocket;
  private handler: ((e: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.socket = new WebSocket(url);
  }

  start(onMessage: (data: unknown) => void): void {
    this.handler = (e: MessageEvent) => {
      onMessage(JSON.parse(e.data as string));
    };
    this.socket.addEventListener('message', this.handler);
  }

  stop(): void {
    if (this.handler) {
      this.socket.removeEventListener('message', this.handler);
      this.handler = null;
    }
  }
}
