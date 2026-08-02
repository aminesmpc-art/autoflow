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
  /**
   * The result captured as a reference-grade data URL the moment it was
   * produced. Downstream nodes use this instead of looking the tile up in the
   * Flow DOM later, which failed once the grid had recycled it.
   */
  referenceUrl?: string;
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

  /** Send a message to background. Returns false if it could not be sent. */
  send(type: string, payload?: any): boolean {
    if (!this.port) {
      console.warn('[Studio Bridge] Cannot send — not connected');
      return false;
    }
    try {
      this.port.postMessage({ type, payload });
      return true;
    } catch (err) {
      // Port died between the null check and the post (SW recycled)
      console.warn('[Studio Bridge] postMessage failed:', err);
      this.port = null;
      this.status = 'disconnected';
      return false;
    }
  }

  /**
   * Send EXECUTE_NODE. Returns false when the message never left — the caller
   * must fail fast, because a dropped command produces no reply and the node
   * would otherwise sit until its 10-minute timeout.
   */
  executeNode(nodeId: string, config: NodeExecutionConfig): boolean {
    return this.send('STUDIO_EXECUTE_NODE', { nodeId, config });
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
