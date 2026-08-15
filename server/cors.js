// Cross-origin access for the browser app.
//
// The web app and the API are separate origins by design — web/package.json
// serves on :3001, the API defaults to :3000, and apiBase() builds an absolute
// URL with no proxy between them. Without these headers a browser blocks every
// response, `state` never loads, and the room page renders a shell with no
// submission form.
//
// Allow-listed, never `*`. These endpoints accept a bearer token, and an open
// policy would let any page a participant happens to have open call them with
// that participant's credentials.

const DEFAULT_DEV_ORIGINS = ['http://localhost:3001', 'http://127.0.0.1:3001'];

// Everything the room page actually sends. Kept explicit so widening it is a
// visible decision rather than a side effect.
const ALLOWED_HEADERS = ['content-type', 'authorization', 'x-db8-client-nonce'];
const ALLOWED_METHODS = ['GET', 'POST', 'OPTIONS'];

/**
 * @param {string} raw comma-separated origin list
 * @returns {string[]}
 */
export function parseOrigins(raw) {
  return String(raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Express middleware granting cross-origin access to configured origins only.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.origins] allow-list. Defaults to DB8_ALLOWED_ORIGINS,
 *   and to the local dev web origins when that is unset — development is the
 *   case that is broken without this, and a deployment serving the app from
 *   another host must say so explicitly rather than inherit a permissive default.
 */
export function cors({ origins } = {}) {
  const configured = origins ?? parseOrigins(process.env.DB8_ALLOWED_ORIGINS);
  const allowed = new Set(configured.length > 0 ? configured : DEFAULT_DEV_ORIGINS);

  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;

    // A response that carries an origin-specific header must not be cached and
    // replayed for a different origin.
    res.setHeader('Vary', 'Origin');

    // No Origin means same-origin or a non-browser client; nothing to grant.
    if (!origin) return next();

    if (!allowed.has(origin)) {
      // Preflight still gets a terse answer; the browser refuses either way,
      // and leaving it to the router would surface as a confusing 404.
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      return next();
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', '));
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '));
      res.setHeader('Access-Control-Max-Age', '600');
      return res.sendStatus(204);
    }

    return next();
  };
}

export const CORS_ALLOWED_HEADERS = ALLOWED_HEADERS;
export const CORS_DEFAULT_DEV_ORIGINS = DEFAULT_DEV_ORIGINS;
