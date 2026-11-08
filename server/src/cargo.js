// Catálogo de carga do porto (ver especificação no Notion, "Tipos de carga / prioridade").

/** Prioridade base da fila: menor rank = sai primeiro. Perecível tem prioridade máxima. */
export const CARGO_PRIORITIES = {
  PERECIVEL: { rank: 1, label: 'Perecível' },
  CARGA_PERIGOSA: { rank: 2, label: 'Carga perigosa' },
  DESCARGA_DIRETA: { rank: 3, label: 'Descarga direta' },
  NAO_PRIORITARIO: { rank: 4, label: 'Não prioritário' },
};

const AUTO = [
  'Atrelados acompanhando o veículo',
  'Atrelados isolados',
  'Carga ro-ro',
  'Project cargo em movimentação vertical',
  'Project cargo ro-ro',
  'Veículos ligeiros em ro-ro',
  'Veículos ligeiros em movimentação vertical',
  'Veículos pesados vazios em ro-ro',
  'Veículos pesados vazios em movimentação vertical',
];

const GRANEL = [
  'Açúcar a granel',
  'Carvões, coques e outros produtos energéticos',
  'Cereais, rações e outros produtos alimentáres',
  'Cimentos, pozolanas e clinkers',
  'Derivados do petróleo',
  'Farinhas e farelos',
  'Gases liquefeitos',
  'Minerios com granulometria regular',
  'Minerios em bruto',
  'Outros granéis líquidos',
  'Outros granéis sólidos',
  'Pedra miúda, bruta, gravilha',
  'Petróleo bruto',
  'Sebos, melaços e outros produtos pré-aquecidos',
  'Trigo em grão',
  'Óleos alimentáres',
];

const GERAL = [
  'Animais vivos',
  'Blocos de pedra',
  'Farinha de trigo em saco',
  'Mercadoria fracionada',
  'Mercadoria unitizada',
  'Mercadoria frigorífica ou congelada',
  'Troncos e toros de madeira',
];

export const VOLUME_TYPES = {
  AUTO: { label: 'Auto', categories: AUTO },
  CARGA_GRANEL: { label: 'Carga granel', categories: GRANEL },
  CARGA_GERAL: { label: 'Carga geral', categories: GERAL },
  CONTENTOR: { label: 'Contentor', categories: [] }, // usa campos próprios de contentor
};

/** Veículos só precisam de marca e modelo. */
export const isVehicleCategory = (category) => typeof category === 'string' && category.startsWith('Veículos');

/** Operação do processo e o EP do porto que lhe corresponde. */
export const OPERATIONS = {
  DESEMBARQUE: { label: 'Desembarque', ep: 'EP17' },
  EMBARQUE: { label: 'Embarque', ep: 'EP15' },
};

export const DOCUMENT_KINDS = {
  BILHETE: 'Bilhete de identidade',
  ALVARA: 'Alvará comercial',
  GUIA_CABOTAGEM: 'Guia de cabotagem',
  BL: 'BL (Bill of Lading)',
  EP17: 'EP17 (retirada de carga)',
  EP15: 'EP15 (embarque de carga)',
  RECIBO_EP: 'Recibo do EP',
  DOCUMENTOS: 'Documentação (Guia, BL, Alvará…)',
  OUTRO: 'Outro',
  PROFORMA: 'Fatura proforma',
  COMPROVATIVO: 'Comprovativo de pagamento',
  FATURA_RECIBO: 'Fatura recibo',
};

/** Tipos que o transitário pode anexar livremente; os de faturação só entram pelos seus próprios passos. */
export const UPLOADABLE_KINDS = ['EP17', 'EP15', 'RECIBO_EP', 'DOCUMENTOS', 'BILHETE', 'ALVARA', 'GUIA_CABOTAGEM', 'BL', 'OUTRO'];

/** Regimes aduaneiros (como na nota de desalfandegamento da JUP). */
export const REGIMES = {
  31: 'Cabotagem Importação',
  32: 'Cabotagem Exportação',
  33: 'Fornecimento Embarcações',
  34: 'Outros',
  35: 'Importação Adicional',
  36: 'Exportação Adicional',
  EX1: 'Exportação Definitiva',
  EX2: 'Exportação Temporária',
  EX3: 'Reexportação',
  EXS1: 'Exportação Simplificada',
  IM4: 'Importação Definitiva',
  IM5: 'Importação Temporária',
  IM6: 'Reimportação',
  IM7: 'Armazenagem Aduaneira',
  IM8: 'Trânsito Aduaneiro',
  IMS4: 'Importação Simplificada',
};

export const DISCHARGE_TYPES = { DIRECTA: 'Directa', INDIRECTA: 'Indirecta' };
export const CONTAINER_SIZES = ['20', '40', '45'];
export const UNITS = ['Unidade', 'Quilograma', 'Tonelada', 'Caixa', 'Saco', 'Palete', 'Fardo', 'Bidon', 'Litro', 'Metro cúbico'];

export function cargoCatalog() {
  return {
    regimes: Object.entries(REGIMES).map(([value, label]) => ({ value, label: `${value} | ${label}` })),
    operations: Object.entries(OPERATIONS).map(([value, { label, ep }]) => ({ value, label, ep })),
    dischargeTypes: Object.entries(DISCHARGE_TYPES).map(([value, label]) => ({ value, label })),
    containerSizes: CONTAINER_SIZES,
    units: UNITS,
    priorities: Object.entries(CARGO_PRIORITIES).map(([value, { label, rank }]) => ({ value, label, rank })),
    volumeTypes: Object.entries(VOLUME_TYPES).map(([value, { label, categories }]) => ({ value, label, categories })),
    documentKinds: Object.entries(DOCUMENT_KINDS).map(([value, label]) => ({ value, label })),
  };
}
