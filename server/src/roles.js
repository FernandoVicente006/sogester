export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN', // administrador geral do sistema
  ADMIN_ENTIDADE: 'ADMIN_ENTIDADE', // diretor-geral / assistente de uma entidade
  LOJA: 'LOJA', // verificação / receção
  CADASTRO: 'CADASTRO', // cadastro de clientes
  FINANCAS: 'FINANCAS', // finanças de processos: valida o comprovativo e carrega a fatura recibo
  CHEFE_COMERCIAL: 'CHEFE_COMERCIAL', // emite a saída antecipada
  PORTARIA: 'PORTARIA', // verifica autorizações na portaria
  TRANSITARIO: 'TRANSITARIO',
};

export const STAFF_ROLES = [ROLES.ADMIN_ENTIDADE, ROLES.LOJA, ROLES.CADASTRO, ROLES.FINANCAS, ROLES.CHEFE_COMERCIAL, ROLES.PORTARIA];
/** Perfis que o administrador da entidade pode atribuir aos funcionários. */
export const ASSIGNABLE_ROLES = [ROLES.LOJA, ROLES.CADASTRO, ROLES.FINANCAS, ROLES.CHEFE_COMERCIAL, ROLES.PORTARIA];

export const isSuperAdmin = (user) => user.role === ROLES.SUPER_ADMIN;
export const isStaff = (user) => STAFF_ROLES.includes(user.role);
export const isForwarder = (user) => user.role === ROLES.TRANSITARIO;
