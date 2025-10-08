import http from 'node:http';
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import request from 'supertest';
import app, { __setDbPool } from '../rpc.js';

const execFile = promisify(_execFile);

function cliBin() {
  return path.join(process.cwd(), 'bin', 'db8.js');
}

describe('CLI verify submit/summary', () => {
  let server;
  let url;
  const room = '00000000-0000-0000-0000-00000000cf00';
  const round = '00000000-0000-0000-0000-00000000cf01';
  const author = '00000000-0000-0000-0000-00000000cf02';
  const reporter = '00000000-0000-0000-0000-00000000cf03';

  beforeAll(async () => {
    __setDbPool(null);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('records a verdict and prints summary lines', async () => {
    // Seed submission
    // Obtain a server-issued nonce in case enforcement is enabled
    const issued = await fetch(url + '/rpc/nonce.issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ round_id: round, author_id: author, ttl_sec: 60 })
    }).then((r) => r.json());

    const subRes = await request(url)
      .post('/rpc/submission.create')
      .send({
        room_id: room,
        round_id: round,
        author_id: author,
        phase: 'submit',
        deadline_unix: 0,
        content: 'CLI verify',
        claims: [{ id: 'c1', text: 'Abc', support: [{ kind: 'logic', ref: 'a' }] }],
        citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
        client_nonce: issued?.ok ? issued.nonce : 'nonce-cli-ver'
      })
      .expect(200);
    const submissionId = subRes.body.submission_id;

    const env = {
      ...process.env,
      DB8_API_URL: url,
      DB8_ROOM_ID: room,
      DB8_PARTICIPANT_ID: reporter
    };

    const submitOut = await execFile(
      'node',
      [
        cliBin(),
        'verify',
        'submit',
        '--round',
        round,
        '--submission',
        submissionId,
        '--verdict',
        'true'
      ],
      { env }
    );
    expect(submitOut.stdout.trim()).toMatch(/ok id=/);

    const summaryOut = await execFile('node', [cliBin(), 'verify', 'summary', '--round', round], {
      env
    });
    expect(summaryOut.stdout).toMatch(new RegExp(`${submissionId} .* Total:1`));
  });
});
