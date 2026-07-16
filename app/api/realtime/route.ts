import { NextResponse } from 'next/server';
import { addRealtimeClient, removeRealtimeClient } from '@/lib/realtime';

export const runtime = 'edge';

export async function GET() {
  let interval: ReturnType<typeof setInterval>;
  let id: string;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      id = Math.random().toString(36).slice(2);
      addRealtimeClient(id, controller);

      // send initial connected event and keepalive
      controller.enqueue(new TextEncoder().encode('event: connected\ndata: {"message":"realtime connected"}\n\n'));
      controller.enqueue(new TextEncoder().encode('event: keep-alive\ndata: {}\n\n'));

      interval = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode('event: keep-alive\ndata: {}\n\n'));
        } catch {
          clearInterval(interval);
          removeRealtimeClient(id);
        }
      }, 20000);
    },
    cancel() {
      clearInterval(interval);
      if (id) {
        removeRealtimeClient(id);
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
