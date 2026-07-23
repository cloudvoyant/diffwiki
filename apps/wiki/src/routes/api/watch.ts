import { createFileRoute } from '@tanstack/react-router';
import { subscribe, type ArticleChange } from '../../server/watch';

export const Route = createFileRoute('/api/watch')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const encoder = new TextEncoder();
        // Hoisted so both `abort` and the stream's `cancel()` can tear the
        // subscription down.
        let closed = false;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let unsubscribe: () => void = () => {};
        const cleanup = () => {
          if (closed) return;
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          unsubscribe();
        };
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            // Guard every enqueue: once the stream is torn down (client gone, or a
            // dev HMR / SSR re-eval swaps the module), the controller is closed and
            // enqueue throws — swallow it and clean up instead of crashing the
            // process (ERR_INVALID_STATE: Controller is already closed).
            const safeEnqueue = (chunk: Uint8Array) => {
              if (closed) return;
              try {
                controller.enqueue(chunk);
              } catch {
                cleanup();
              }
            };
            // Initial comment + periodic heartbeat keep proxies/browsers from closing idle streams.
            safeEnqueue(encoder.encode(': connected\n\n'));
            heartbeat = setInterval(() => safeEnqueue(encoder.encode(': ping\n\n')), 25_000);
            unsubscribe = subscribe((c: ArticleChange) =>
              safeEnqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`)),
            );
            request.signal.addEventListener('abort', () => {
              cleanup();
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            });
          },
          cancel() {
            cleanup();
          },
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          },
        });
      },
    },
  },
});
