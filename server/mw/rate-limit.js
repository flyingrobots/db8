// Simple in-memory rate limiter (opt-in enforcement)
const buckets = new Map();

export function rateLimitStub(opts = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const limit = process.env.NODE_ENV === 'test' ? 10 : (opts.limit ?? 60); // requests per window
  const enforce = opts.enforce ?? false; // off by default
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.headers['x-room-id'] || 'room'}:${req.headers['x-participant-id'] || req.ip}`;
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    const remaining = Math.max(0, limit - b.count);
    res.setHeader('X-RateLimit-WindowMS', String(windowMs));
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)));
    const doEnforce =
      enforce || process.env.ENFORCE_RATELIMIT === '1' || process.env.NODE_ENV === 'test';
    if (doEnforce && b.count > limit) {
      return res.status(429).json({ ok: false, error: 'rate_limited' });
    }
    return next();
  };
}
