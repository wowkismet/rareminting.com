/**
 * Errors that map cleanly onto HTTP responses.
 *
 * Messages here are shown to the caller, so they say what is wrong and how to
 * fix it, and they never leak whether a given account exists.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Readonly<Record<string, string>> | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Readonly<Record<string, string>> | null = null,
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(
  message: string,
  details: Readonly<Record<string, string>> | null = null,
): HttpError {
  return new HttpError(400, 'bad_request', message, details);
}

export function unauthorized(message = 'Sign in to continue.'): HttpError {
  return new HttpError(401, 'unauthorized', message);
}

export function forbidden(message = 'You do not have access to this.'): HttpError {
  return new HttpError(403, 'forbidden', message);
}

export function notFound(message = 'Not found.'): HttpError {
  return new HttpError(404, 'not_found', message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, 'conflict', message);
}

export function tooManyRequests(message: string): HttpError {
  return new HttpError(429, 'too_many_requests', message);
}
