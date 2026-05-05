export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (code: string, message: string): HttpError =>
  new HttpError(400, code, message);

export const unauthorized = (message = "Authentication required"): HttpError =>
  new HttpError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "Access denied"): HttpError =>
  new HttpError(403, "FORBIDDEN", message);

export const notFound = (code: string, message: string): HttpError =>
  new HttpError(404, code, message);

export const conflict = (code: string, message: string): HttpError =>
  new HttpError(409, code, message);

export const unprocessable = (code: string, message: string): HttpError =>
  new HttpError(422, code, message);
