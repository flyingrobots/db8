import express from 'express';
import { RoomCreate } from '../schemas.js';

export function createRoomRouter({ roomService, requireDbInProduction }) {
  const router = express.Router();

  // state
  router.get('/state', async (req, res) => {
    const roomId = String(req.query.room_id || 'local');
    const result = await roomService.getRoomState(roomId);
    return res.json(result);
  });

  // room.create
  router.post('/rpc/room.create', requireDbInProduction, async (req, res) => {
    try {
      const input = RoomCreate.parse(req.body);
      const result = await roomService.createRoom(input);
      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  return router;
}
