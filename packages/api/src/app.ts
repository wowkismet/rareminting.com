/**
 * The application: a single `handle(Request) => Response` function.
 *
 * Nothing here knows about node:http, which is what makes the whole API
 * testable by calling one function.
 */

import type { Database } from './db.ts';
import { badRequest, notFound } from './errors.ts';
import type { Ctx } from './http.ts';
import { bearerToken, createRouter, errorResponse, json } from './http.ts';
import { resolveSession, type Session } from './sessions.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerSellerRoutes } from './routes/sellers.ts';
import { registerListingRoutes } from './routes/listings.ts';
import { registerAdminRoutes } from './routes/admin.ts';
import { registerMediaRoutes } from './routes/media.ts';

export interface App {
  handle(req: Request, socketIp?: string | null): Promise<Response>;
}

const MAX_BODY_BYTES = 1_000_000;

export function createApp(db: Database): App {
  const router = createRouter();

  router.add('GET', '/health', async () => json({ status: 'ok' }));
  registerAuthRoutes(router);
  registerSellerRoutes(router);
  registerListingRoutes(router, db);
  registerAdminRoutes(router);
  registerMediaRoutes(router);

  return {
    async handle(req, socketIp = null): Promise<Response> {
      try {
        const url = new URL(req.url);
        const matched = router.match(req.method, url.pathname);

        if (matched === null) {
          if (router.pathExists(url.pathname)) {
            return json(
              { error: 'method_not_allowed', message: `${req.method} is not allowed here.` },
              405,
            );
          }
          throw notFound(`No route for ${req.method} ${url.pathname}.`);
        }

        // Resolve the bearer token before dispatch so every handler can rely on
        // ctx.session being either a live session or null.
        let session: Session | null = null;
        const token = bearerToken(req);
        if (token !== null) session = await resolveSession(db, token);

        let cachedBody: unknown;
        let bodyRead = false;

        const ctx: Ctx = {
          req,
          url,
          params: matched.params,
          db,
          session,
          ip: socketIp,
          userAgent: req.headers.get('user-agent'),
          async body(): Promise<unknown> {
            if (bodyRead) return cachedBody;
            bodyRead = true;

            const declared = req.headers.get('content-length');
            if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
              throw badRequest('Request body is too large.');
            }

            const text = await req.text();
            if (text.length > MAX_BODY_BYTES) {
              throw badRequest('Request body is too large.');
            }
            if (text.trim().length === 0) {
              cachedBody = {};
              return cachedBody;
            }
            try {
              cachedBody = JSON.parse(text);
            } catch {
              throw badRequest('Request body must be valid JSON.');
            }
            return cachedBody;
          },
        };

        return await matched.handler(ctx);
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
