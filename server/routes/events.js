import express from 'express';
import { log } from '../utils.js';

export function createEventsRouter({ db, roomService }) {
  const router = express.Router();

  router.get('/events', async (req, res) => {
    const roomId = String(req.query.room_id || 'local');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let closed = false;
    let listenerClient = null;

    const sendTimer = async () => {
      if (closed) return;
      try {
        const state = await roomService.getRoomState(roomId);
        if (state.ok && state.round) {
          const payload = {
            t: 'timer',
            room_id: roomId,
            phase: state.round.phase,
            deadline_unix:
              state.round.submit_deadline_unix || state.round.continue_vote_close_unix || 0
          };
          res.write(`data: ${JSON.stringify(payload)}

`);
        }
      } catch {
        /* ignore */
      }
    };

    const iv = setInterval(sendTimer, 5000);

    if (db) {
      try {
        listenerClient = await db.connect();
        await listenerClient.query(`LISTEN db8_rounds`);
        await listenerClient.query(`LISTEN db8_journal`);
        await listenerClient.query(`LISTEN db8_verdict`);
        await listenerClient.query(`LISTEN db8_final_vote`);

        const onNotification = (msg) => {
          if (closed) return;
          try {
            const payload = JSON.parse(msg.payload);
            if (payload.room_id !== roomId && roomId !== 'all') return;

            if (msg.channel === 'db8_rounds') {
              res.write(`event: phase\n`);
              res.write(`data: ${JSON.stringify(payload)}

`);
            } else if (msg.channel === 'db8_journal') {
              res.write(`event: journal\n`);
              res.write(`data: ${JSON.stringify({ t: 'journal', ...payload })}

`);
            } else if (msg.channel === 'db8_verdict') {
              res.write(`event: verdict\n`);
              res.write(`data: ${JSON.stringify(payload)}

`);
            } else if (msg.channel === 'db8_final_vote') {
              res.write(`event: vote\n`);
              res.write(`data: ${JSON.stringify({ kind: 'final', ...payload })}

`);
            }
          } catch {
            /* ignore */
          }
        };

        listenerClient.on('notification', onNotification);
      } catch (err) {
        log.error('SSE listener failed', { error: err.message });
      }
    }

    req.on('close', async () => {
      closed = true;
      clearInterval(iv);
      if (listenerClient) {
        try {
          await listenerClient.query('UNLISTEN db8_rounds');
          await listenerClient.query('UNLISTEN db8_journal');
          await listenerClient.query('UNLISTEN db8_verdict');
          await listenerClient.query('UNLISTEN db8_final_vote');
        } catch {
          /* ignore */
        }
        listenerClient.release();
      }
      res.end();
    });

    sendTimer();
  });

  return router;
}
