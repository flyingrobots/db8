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

describe('CLI flag submission', () => {
  let server;
  let url;
  const room = '00000000-0000-0000-0000-00000000f100';
  const round = '00000000-0000-0000-0000-00000000f101';
  const author = '00000000-0000-0000-0000-00000000f102';
  const participant = '00000000-0000-0000-0000-00000000f103';

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

  test('flags a submission and reports flag count', async () => {
    const submissionPayload = {
      room_id: room,
      round_id: round,
      author_id: author,
      phase: 'OPENING',
      deadline_unix: 0,
      content: 'CLI flag content',
      claims: [
        {
          id: 'c1',
          text: 'Claim',
          support: [{ kind: 'logic', ref: 'a' }]
        }
      ],
      citations: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      client_nonce: 'nonce-cli-flag'
    };

    const createRes = await request(url)
      .post('/rpc/submission.create')
      .send(submissionPayload)
      .expect(200);
    const submissionId = createRes.body.submission_id;

    const env = {
      ...process.env,
      DB8_API_URL: url,
      DB8_ROOM_ID: room,
      DB8_PARTICIPANT_ID: participant,
      DB8_CLI_TEST_MAX_EVENTS: '0'
    };

    const { stdout } = await execFile(
      'node',
      [cliBin(), 'flag', 'submission', '--submission', submissionId, '--reason', 'offensive'],
      { env }
    );

    expect(stdout.trim()).toMatch(/flag recorded/);
  });
});
