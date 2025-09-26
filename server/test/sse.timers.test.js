import { describe, it } from 'vitest';
import http from 'node:http';
import app from '../rpc.js';

describe('GET /events (SSE timers)', () => {
  it('returns text/event-stream', async () => {
    // Bind app to a random port for a real HTTP request
    const server = app.listen(0);
    const port = server.address().port;
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/events?room_id=test',
          method: 'GET',
          headers: { accept: 'text/event-stream' }
        },
        (res) => {
          try {
            if (!String(res.headers['content-type'] || '').match(/text\/event-stream/))
              throw new Error('bad content-type');
            res.destroy();
            server.close(() => resolve());
          } catch (e) {
            server.close(() => reject(e));
          }
        }
      );
      req.on('error', (e) => {
        server.close(() => reject(e));
      });
      req.end();
    });
  }, 5000);
});
