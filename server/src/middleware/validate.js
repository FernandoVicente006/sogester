import { badRequest } from '../errors.js';

/** Valida `body`, `query` e `params` com schemas zod e substitui-os pelos valores já normalizados. */
export const validate =
  ({ body, query, params }) =>
  (req, _res, next) => {
    for (const [key, schema] of Object.entries({ body, query, params })) {
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
        throw badRequest('Dados inválidos', 'VALIDATION_ERROR', details);
      }
      // `req.query` é só de leitura no Express 5; guardamos o valor validado em `req.valid`.
      req.valid = { ...req.valid, [key]: result.data };
    }
    next();
  };
