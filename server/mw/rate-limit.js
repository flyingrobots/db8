export function rateLimitStub(opts = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  return (req, res, next) => {
    res.setHeader('X-RateLimit-WindowMS', String(windowMs));
    // TODO: wire counters; for now just pass through
    return next();
  };
}

