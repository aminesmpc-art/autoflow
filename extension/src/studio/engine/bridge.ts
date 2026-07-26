/* ============================================================
   Studio Bridge — Chrome messaging between Studio ↔ Background ↔ Flow
   Uses chrome.runtime.connect for persistent port communication.
   ============================================================ */

export type BridgeStatus = 'disconnected' | 'connecting' | 'connected';

export interface NodeExecutionConfig {
  prompt: string;
  model: string;
  mediaType: 'image' | 'video';
  aspectRatio: string;
  duration?: string;
  creationType: 'ingredients' | 'frames';
  referenceImageIds?: string[];
  referenceImageData?: string[]; // base64 fallback
  /** Target platform — the service worker routes by this. Default 'flow'. */
  platform?: 'flow' | 'chatgpt';
}

export interface NodeResult {
  tileId: string;
  imageUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  /** Self-contained data URL built by the content script — safe to render here */
  previewUrl?: string;
  /** Playable video as a data URL, when the clip was small enough to inline */
  previewVideoUrl?: string;
}

type MessageHandler = (msg: any) => void;

/**
 * Bridge manages the persistent port connection between
 * Studio window and the background service worker.
 */
export class StudioBridge {
  private port: chrome.runtime.Port | null = null;
  private status: BridgeStatus = 'disconnected';
  private handlers = new Map<string, MessageHandler[]>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Connect to the background service worker */
  connect(): void {
    if (this.port) return;
    this.status = 'connecting';

    try {
      this.port = chrome.runtime.connect({ name: 'studio' });

      this.port.onMessage.addListener((msg: any) => {
        this.handleMessage(msg);
      });

      this.port.onDisconnect.addListener(() => {
        console.log('[Studio Bridge] Port disconnected');
        this.port = null;
        this.status = 'disconnected';
        this.emit('status', { status: 'disconnected' });
        // Auto-reconnect after 2s
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      });

      this.status = 'connected';
      this.emit('status', { status: 'connected' });
      console.log('[Studio Bridge] Connected to background');
    } catch (err) {
      console.error('[Studio Bridge] Failed to connect:', err);
      this.status = 'disconnected';
    }
  }

  /** Disconnect */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }
    this.status = 'disconnected';
  }

  /** Send a message to background (which forwards to Flow content script) */
  send(type: string, payload?: any): void {
    if (!this.port) {
      console.warn('[Studio Bridge] Cannot send — not connected');
      return;
    }
    this.port.postMessage({ type, payload });
  }

  /** Send EXECUTE_NODE command */
  executeNode(nodeId: string, config: NodeExecutionConfig): void {
    this.send('STUDIO_EXECUTE_NODE', { nodeId, config });
  }

  /** Send STOP command */
  stopExecution(): void {
    this.send('STUDIO_STOP');
  }

  /** Send PAUSE command */
  pauseExecution(): void {
    this.send('STUDIO_PAUSE');
  }

  /** Send RESUME command */
  resumeExecution(): void {
    this.send('STUDIO_RESUME');
  }

  /** Register a message handler */
  on(type: string, handler: MessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
  }

  /** Remove a message handler */
  off(type: string, handler: MessageHandler): void {
    const list = this.handlers.get(type);
    if (list) {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  /** Get current connection status */
  getStatus(): BridgeStatus {
    return this.status;
  }

  /** Emit to registered handlers */
  private emit(type: string, payload: any): void {
    const list = this.handlers.get(type);
    if (list) {
      for (const handler of list) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[Studio Bridge] Handler error for ${type}:`, err);
        }
      }
    }
  }

  /** Handle incoming messages from background */
  private handleMessage(msg: any): void {
    if (!msg || !msg.type) return;
    this.emit(msg.type, msg.payload || msg);
  }

  /**
   * One-shot message via chrome.runtime.sendMessage (for simple request/response).
   * Used for things like "is Flow tab open?" checks.
   */
  static async sendMessage(type: string, payload?: any): Promise<any> {
    return chrome.runtime.sendMessage({ type, payload });
  }
}

/** Singleton bridge instance */
export const bridge = new StudioBridge();
