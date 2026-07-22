import { createFileRoute } from '@tanstack/react-router';
import { subscribe, type ArticleChange } from '../../server/watch';

export const Route = createFileRoute('/api/watch')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (c: ArticleChange) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
            // Initial comment + periodic heartbeat keep proxies/browsers from closing idle streams.
            controller.enqueue(encoder.encode(': connected\n\n'));
            const heartbeat = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 25_000);
            const unsubscribe = subscribe(send);
            request.signal.addEventListener('abort', () => {
              clearInterval(heartbeat);
              unsubscribe();
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            });
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
