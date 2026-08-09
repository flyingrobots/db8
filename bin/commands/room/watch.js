export async function run(args, context) {
  const { printerr, apiUrl, room, EXIT } = context;
  if (!room) {
    printerr('No room configured. Set --room or DB8_ROOM_ID or config profile.');
    return EXIT.AUTH;
  }
  const quiet = Boolean(args.quiet);
  const maxEvents = Number(
    process.env.DB8_CLI_TEST_MAX_EVENTS || (process.env.DB8_CLI_TEST_ONCE === '1' ? 1 : 0)
  );
  const base = apiUrl.replace(/\/$/, '');
  const url = new URL(base + '/events');
  url.searchParams.set('room_id', room);
  const mod = url.protocol === 'https:' ? await import('node:https') : await import('node:http');
  let stopRequested = false;
  let eventsSeen = 0;
  let attempt = 0;
  let lastExit = EXIT.OK;

  const sleep = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));
  const onSigint = () => {
    stopRequested = true;
  };
  process.once('SIGINT', onSigint);

  const connect = () =>
    new Promise((resolve) => {
      const req = mod.request(
        url,
        { method: 'GET', headers: { accept: 'text/event-stream' } },
        (res) => {
          res.setEncoding('utf8');
          let buf = '';
          res.on('data', (chunk) => {
            buf += chunk;
            let idx;
            while ((idx = buf.indexOf('\n\n')) !== -1) {
              const frame = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
              if (dataLine) {
                const json = dataLine.slice(6);
                try {
                  const evt = JSON.parse(json);
                  process.stdout.write(JSON.stringify(evt) + '\n');
                  eventsSeen += 1;
                  attempt = 0; // reset backoff on successful event
                  if (maxEvents && eventsSeen >= maxEvents) {
                    stopRequested = true;
                    try {
                      req.destroy();
                    } catch {
                      /* ignore */
                    }
                    resolve(EXIT.OK);
                    return;
                  }
                } catch {
                  /* ignore malformed frames */
                }
              }
            }
          });
          res.on('end', () => resolve(EXIT.OK));
        }
      );
      req.on('error', (e) => {
        if (!quiet) printerr(e.message);
        resolve(EXIT.NETWORK);
      });
      req.end();
    });

  while (!stopRequested) {
    attempt += 1;
    lastExit = await connect();
    if (stopRequested || (maxEvents && eventsSeen >= maxEvents)) break;
    const delay = Math.min(500 * attempt, 5000);
    if (!quiet) printerr(`reconnecting in ${delay}ms...`);
    await sleep(delay);
  }

  process.removeListener('SIGINT', onSigint);
  return lastExit;
}
