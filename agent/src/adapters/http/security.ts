import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RateLimiter {
  allow(key: string): boolean;
}

export function createRateLimiter(options: { windowMs: number; max: number }): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return {
    allow(key: string): boolean {
      const now = Date.now();
      const current = hits.get(key);
      if (!current || now >= current.resetAt) {
        hits.set(key, { count: 1, resetAt: now + options.windowMs });
        if (hits.size > 10_000) {
          for (const [entryKey, entry] of hits) {
            if (now >= entry.resetAt) {
              hits.delete(entryKey);
            }
          }
        }
        return true;
      }
      if (current.count >= options.max) {
        return false;
      }
      current.count += 1;
      return true;
    },
  };
}

export function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function applyCors(req: IncomingMessage, res: ServerResponse, allowedOrigins: string[]): boolean {
  const origin = req.headers.origin;
  const allowAll = allowedOrigins.includes('*');
  const allowed = typeof origin === 'string' && (allowAll || allowedOrigins.includes(origin));

  if (allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, OpenAI-Beta, X-Session-Token, X-CopilotKit-Agent, x-api-key',
    );
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = allowed || !origin ? 204 : 403;
    res.end();
    return false;
  }

  if (origin && !allowed) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Origin not allowed' }));
    return false;
  }

  return true;
}

export function hashSessionToken(secret: string, token: string): string {
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

export function createSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function requestHeader(req: IncomingMessage, name: string): string {
  const header = req.headers[name.toLowerCase()];
  if (typeof header === 'string') return header.trim();
  if (Array.isArray(header) && typeof header[0] === 'string') {
    return header[0].trim();
  }
  return '';
}

export function verifySiteApiKey(
  expected: string | undefined,
  provided: string,
): 'ok' | 'missing_config' | 'invalid' {
  const key = expected?.trim() ?? '';
  if (!key) return 'missing_config';
  if (!provided || !timingSafeEqual(key, provided)) return 'invalid';
  return 'ok';
}

export function timingSafeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export async function readJsonBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new Error('Payload too large');
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw) as unknown;
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
