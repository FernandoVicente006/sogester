export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, code = 'BAD_REQUEST', details) => new HttpError(400, code, msg, details);
export const unauthorized = (msg = 'Autenticação necessária') => new HttpError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Sem permissão para esta ação') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Recurso não encontrado') => new HttpError(404, 'NOT_FOUND', msg);
export const conflict = (msg, code = 'CONFLICT') => new HttpError(409, code, msg);
