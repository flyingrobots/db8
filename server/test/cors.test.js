import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../rpc.js';

// The browser app and the API are different origins.
//
// web/package.json serves on :3001, the API defaults to :3000, and apiBase()
// builds an absolute URL with no proxy in between. Without CORS headers the
// browser blocks every response, `state` never loads, and the room page renders
// a shell with no submission form. Confirmed in Chromium:
//
//   Access to fetch at 'http://localhost:3199/state?…' from origin
//   'http://localhost:3198' has been blocked by CORS policy: No
//   'Access-Control-Allow-Origin' header is present on the requested resource.
//
// Allow-listed rather than `*`: these endpoints take a bearer token, and an
// open policy would let any page a participant visits call them with it.

const DEV_ORIGIN = 'http://localhost:3001';
const ROOM = '00000000-0000-0000-0000-000000000000';

describe('cross-origin access for the browser app', () => {
  it('allows the configured web origin to read a response', async () => {
    const res = await request(app).get(`/state?room_id=${ROOM}`).set('Origin', DEV_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBe(DEV_ORIGIN);
  });

  it('answers a preflight with the methods and headers the app sends', async () => {
    const res = await request(app)
      .options('/rpc/submission.create')
      .set('Origin', DEV_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(DEV_ORIGIN);
    expect(res.headers['access-control-allow-methods']).toMatch(/POST/);
    // The room page sends all three on submission.create.
    for (const header of ['content-type', 'authorization', 'x-db8-client-nonce']) {
      expect(res.headers['access-control-allow-headers'].toLowerCase()).toContain(header);
    }
  });

  // The allow-list is the point. Reflecting any origin would hand a bearer
  // token to whatever page a participant happened to have open.
  it('does not allow an origin that is not configured', async () => {
    const res = await request(app)
      .get(`/state?room_id=${ROOM}`)
      .set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never answers with a wildcard', async () => {
    const res = await request(app).get(`/state?room_id=${ROOM}`).set('Origin', DEV_ORIGIN);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('leaves same-origin requests alone', async () => {
    const res = await request(app).get(`/state?room_id=${ROOM}`);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('varies on Origin, so a cache cannot serve one origin a header meant for another', async () => {
    const res = await request(app).get(`/state?room_id=${ROOM}`).set('Origin', DEV_ORIGIN);
    expect(String(res.headers.vary || '')).toMatch(/Origin/i);
  });
});

describe('the grant is no wider than the app needs', () => {
  // Allow-Credentials exists to permit cookie- and TLS-credential-bearing
  // cross-origin requests. The browser app never asks for it — there is no
  // `credentials: 'include'` anywhere in web/ — and it authenticates with an
  // explicit Authorization header, which Allow-Headers already covers. Granting
  // it anyway widens what an allow-listed origin may do for no gain.
  it('does not grant credentials', async () => {
    const res = await request(app).get(`/state?room_id=${ROOM}`).set('Origin', DEV_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBe(DEV_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('does not grant credentials on a preflight either', async () => {
    const res = await request(app)
      .options('/rpc/submission.create')
      .set('Origin', DEV_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('Vary composes with other middleware', () => {
  // setHeader REPLACES. Nothing else in server/ sets Vary today, so this is
  // latent rather than live — but adding compression or helmet would silently
  // discard theirs, and a shared cache could then serve one client a response
  // computed for another.
  it('appends Origin rather than replacing an existing Vary', async () => {
    const express = (await import('express')).default;
    const { cors } = await import('../cors.js');

    const probe = express();
    probe.use((req, res, next) => {
      res.setHeader('Vary', 'Accept-Encoding');
      next();
    });
    probe.use(cors({ origins: [DEV_ORIGIN] }));
    probe.get('/probe', (req, res) => res.json({ ok: true }));

    const res = await request(probe).get('/probe').set('Origin', DEV_ORIGIN);
    const vary = String(res.headers.vary || '');
    expect(vary).toMatch(/Accept-Encoding/i);
    expect(vary).toMatch(/Origin/i);
  });
});
