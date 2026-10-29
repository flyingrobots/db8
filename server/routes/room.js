import express from 'express';
import { RoomCreate, RoomGet } from '../schemas.js';
import { sendIfDatabaseUnavailable } from '../database-unavailable.js';

export function createRoomRouter({ roomService, requireDbInProduction }) {
  const router = express.Router();

  // state
  router.get('/state', async (req, res) => {
    const roomId = String(req.query.room_id || 'local');
    const result = await roomService.getRoomState(roomId);
    return res.json(result);
  });

  // room.get: topic, status, config and seats
  router.get('/rpc/room.get', async (req, res) => {
    const parsed = RoomGet.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'invalid_room_id' });
    }
    try {
      const room = await roomService.getRoom(parsed.data.room_id);
      if (!room) return res.status(404).json({ ok: false, error: 'room_not_found' });
      return res.json({ ok: true, ...room });
    } catch (err) {
      if (err?.message === 'database_unavailable') {
        return res.status(503).json({ ok: false, error: 'database_unavailable' });
      }
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // room.create
  router.post('/rpc/room.create', requireDbInProduction, async (req, res) => {
    try {
      const input = RoomCreate.parse(req.body);
      const result = await roomService.createRoom(input);
      return res.json({ ok: true, ...result });
    } catch (err) {
      if (sendIfDatabaseUnavailable(res, err)) return;
      return res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  return router;
}
