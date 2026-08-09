import crypto from 'node:crypto';
import { createInterface } from 'node:readline/promises';

export async function run(args, context) {
  const { printerr, print, writeJson, sessPath, apiUrl, room, participant, jwt, EXIT } = context;

  const uuidRe = /^[0-9a-fA-F-]{8,}$/;
  const useDeviceCode = Boolean(args['device-code']);
  const nonInteractive = Boolean(args['non-interactive']);

  const resolveExpires = () => {
    const v = args.expires || '';
    const n = Number(v);
    if (v && Number.isFinite(n) && n > 0) return n;
    return Math.floor(Date.now() / 1000) + 3600;
  };

  async function persistSession(roomId, participantId, token, expiresAt, extra = {}) {
    const sess = {
      room_id: roomId,
      participant_id: participantId,
      jwt: token,
      expires_at: expiresAt,
      ...extra
    };
    await writeJson(sessPath, sess);
    const payload = {
      ok: true,
      room_id: roomId,
      participant_id: participantId,
      expires_at: expiresAt
    };
    if (extra.device_code) payload.device_code = extra.device_code;
    if (args.json) print(JSON.stringify(payload));
    else print('ok');
    return EXIT.OK;
  }

  if (useDeviceCode) {
    const roomId = room;
    if (!roomId) {
      printerr('device-code login requires --room or configured room');
      return EXIT.VALIDATION;
    }
    if (!uuidRe.test(roomId)) printerr('--room looks non-standard (expecting uuid-like string)');

    let participantId = participant;
    let token = jwt;

    if ((!participantId || !token) && nonInteractive) {
      printerr('Provide --participant and --jwt when using --device-code with --non-interactive.');
      return EXIT.AUTH;
    }

    const deviceCode = crypto.randomBytes(3).toString('hex').slice(0, 6).toUpperCase();
    print(`Device code: ${deviceCode}`);
    print(`Visit ${apiUrl.replace(/\/$/, '')}/activate to continue.`);

    if (!participantId || !token) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        if (!participantId) participantId = (await rl.question('Participant ID (uuid): ')).trim();
        if (!token) token = (await rl.question('Paste JWT (Bearer token): ')).trim();
      } finally {
        rl.close();
      }
    }

    if (!participantId) {
      printerr('Device-code login cancelled: missing participant id.');
      return EXIT.VALIDATION;
    }
    if (!uuidRe.test(participantId))
      printerr('--participant looks non-standard (expecting uuid-like string)');
    if (!token) {
      printerr('Device-code login cancelled: JWT required to finish.');
      return EXIT.AUTH;
    }

    const expiresAt = resolveExpires();
    return await persistSession(roomId, participantId, token, expiresAt, {
      login_via: 'device_code',
      device_code: deviceCode
    });
  }

  // direct login path
  if (!room) {
    printerr('login requires --room or DB8_ROOM_ID');
    return EXIT.VALIDATION;
  }
  if (!participant) {
    printerr('login requires --participant or DB8_PARTICIPANT_ID');
    return EXIT.VALIDATION;
  }
  if (!jwt) {
    printerr('login requires --jwt or DB8_JWT');
    return EXIT.AUTH;
  }
  if (!uuidRe.test(room)) printerr('--room looks non-standard (expecting uuid-like string)');
  if (!uuidRe.test(participant))
    printerr('--participant looks non-standard (expecting uuid-like string)');

  const expiresAt = resolveExpires();
  return await persistSession(room, participant, jwt, expiresAt, { login_via: 'manual' });
}
