export type RealtimeChannel =
  | 'products'
  | 'categories'
  | 'settings'
  | 'transactions'
  | 'utang'
  | 'expenses'
  | 'users'
  | 'itemlog'
  | 'lowstock'
  | 'reports'
  | 'restock'
  | 'connected'
  | 'keep-alive';

export interface RealtimeEvent<T = unknown> {
  channel: RealtimeChannel;
  payload: T;
}

declare global {
  var __SariSariPOSRealtime__: {
    clients: Map<string, ReadableStreamDefaultController<Uint8Array>>;
  } | undefined;
}

const globalAny = globalThis as unknown as typeof globalThis & {
  __SariSariPOSRealtime__?: {
    clients: Map<string, ReadableStreamDefaultController<Uint8Array>>;
  };
};

if (!globalAny.__SariSariPOSRealtime__) {
  globalAny.__SariSariPOSRealtime__ = { clients: new Map() };
}

const clients = globalAny.__SariSariPOSRealtime__!.clients;
const encoder = new TextEncoder();

function encodeEvent(event: RealtimeChannel, payload: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload ?? {})}\n\n`);
}

export function addRealtimeClient(id: string, controller: ReadableStreamDefaultController<Uint8Array>) {
  clients.set(id, controller);
}

export function removeRealtimeClient(id: string) {
  clients.delete(id);
}

export function broadcastRealtime<T = unknown>(channel: RealtimeChannel, payload: T = {} as T) {
  const encoded = encodeEvent(channel, payload);
  for (const [id, controller] of Array.from(clients.entries())) {
    try {
      controller.enqueue(encoded);
    } catch {
      clients.delete(id);
    }
  }
}
