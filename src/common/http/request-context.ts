import type { Request } from 'express';

export function getRequestContext(req: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const ip =
    (typeof req.ip === 'string' && req.ip.length > 0 && req.ip) ||
    req.socket?.remoteAddress ||
    null;
  const ua = req.headers['user-agent'];
  return {
    ipAddress: ip ?? null,
    userAgent: typeof ua === 'string' && ua.length > 0 ? ua : null,
  };
}
