/**
 * A very small router over the web-standard Request/Response pair.
 *
 * Handlers take a Request and return a Response, so the whole API can be
 * exercised in tests by calling one function — no port to bind, no server to
 * start, no flaky teardown. `server.ts` adapts node:http to this.
 */

import { HttpError } from './errors.ts';
import type { Db } from './db.ts';
import type { Session } from './sessions.ts';

export interface Ctx {
  readonly req: Request;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly db: Db;
  /** Populated when the request carried a valid bearer token. */
  readonly session: Session | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** Parsed JSON body; throws a 400 if the body is not valid JSON. */
  body(): Promise<unknown>;
  /**
   * The body exactly as it arrived.
   *
   * Gateway webhooks sign the bytes they sent. Re-serialising the parsed object
   * would reorder keys and change spacing, and the signature would never match,
   * so signature checks must read this rather than body().
   */
  rawBody(): Promise<string>;
}

export type Handler = (ctx: Ctx) => Promise<Response>;

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface Route {
  readonly method: Method;
  readonly segments: readonly string[];
  readonly handler: Handler;
}

export interface Router {
  add(method: Method, path: string, handler: Handler): void;
  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null;
  /** True when the path exists under some other method — a 405 rather than 404. */
  pathExists(pathname: string): boolean;
}

export function createRouter(): Router {
  const routes: Route[] = [];

  const split = (path: string): string[] => path.split('/').filter((s) => s.length > 0);

  const matchSegments = (
    route: readonly string[],
    actual: readonly string[],
  ): Record<string, string> | null => {
    if (route.length !== actual.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < route.length; i += 1) {
      const expected = route[i];
      const got = actual[i];
      if (expected === undefined || got === undefined) return null;
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(got);
      } else if (expected !== got) {
        return null;
      }
    }
    return params;
  };

  return {
    add(method, path, handler) {
      routes.push({ method, segments: split(path), handler });
    },
    match(method, pathname) {
      const actual = split(pathname);
      for (const route of routes) {
        if (route.method !== method) continue;
        const params = matchSegments(route.segments, actual);
        if (params !== null) return { handler: route.handler, params };
      }
      return null;
    },
    pathExists(pathname) {
      const actual = split(pathname);
      return routes.some((route) => matchSegments(route.segments, actual) !== null);
    },
  };
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** Convert any thrown value into a response, without leaking internals. */
export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json(
      {
        error: error.code,
        message: error.message,
        ...(error.details === null ? {} : { details: error.details }),
      },
      error.status,
    );
  }

  // Unexpected. Log it server-side; tell the caller nothing about it.
  console.error('[api] unhandled error:', error);
  return json({ error: 'internal_error', message: 'Something went wrong.' }, 500);
}

/**
 * Client IP.
 *
 * Only trusts `x-forwarded-for` when TRUST_PROXY is set, because behind no proxy
 * that header is attacker-controlled and would poison rate limiting.
 */
export function clientIp(req: Request, socketIp: string | null): string | null {
  if (process.env['TRUST_PROXY'] === '1') {
    const forwarded = req.headers.get('x-forwarded-for');
    const first = forwarded?.split(',')[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }
  return socketIp;
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (header === null) return null;
  const [scheme, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}
