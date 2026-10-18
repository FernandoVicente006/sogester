// Catálogo de carga do porto (ver especificação no Notion, "Tipos de carga / prioridade").

/** Prioridade base da fila: menor rank = sai primeiro. Perecível tem prioridade máxima. */
export const CARGO_PRIORITIES = {
  PERECIVEL: { rank: 1, label: 'Perecível' },
  CARGA_PERIGOSA: { rank: 2, label: 'Carga perigosa' },
  DESCARGA_DIRETA: { rank: 3, label: 'Descarga direta' },
  NAO_PRIORITARIO: { rank: 4, label: 'Não prioritário' },
};

const ALTO = [
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
  ALTO: { label: 'Alto', categories: ALTO },
  CARGA_GRANEL: { label: 'Carga granel', categories: GRANEL },
  CARGA_GERAL: { label: 'Carga geral', categories: GERAL },
  CONTENTOR: { label: 'Contentor', categories: [] }, // usa campos próprios de contentor
};

/** Veículos só precisam de marca e modelo. */
export const isVehicleCategory = (category) => typeof category === 'string' && category.startsWith('Veículos');

export const DOCUMENT_KINDS = {
  BILHETE: 'Bilhete de identidade',
  ALVARA: 'Alvará comercial',
  GUIA_CABOTAGEM: 'Guia de cabotagem',
  BL: 'BL (Bill of Lading)',
  EP17: 'EP17 (retirada de carga)',
  EP15: 'EP15 (embarque de carga)',
  OUTRO: 'Outro',
};

export function cargoCatalog() {
  return {
    priorities: Object.entries(CARGO_PRIORITIES).map(([value, { label, rank }]) => ({ value, label, rank })),
    volumeTypes: Object.entries(VOLUME_TYPES).map(([value, { label, categories }]) => ({ value, label, categories })),
    documentKinds: Object.entries(DOCUMENT_KINDS).map(([value, label]) => ({ value, label })),
  };
}
