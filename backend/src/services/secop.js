/**
 * secop.js — Servicio de conexión a las APIs de Contratación Pública SECOP
 * Fuente: datos.gov.co (SODA2 REST API, sin autenticación)
 *
 * Entidades MinTic configuradas con NITs verificados:
 *  - MinTIC:  899999053
 *  - ANE:     900334265
 *  - CRC:     830002593
 *  - AND:     901144049
 *  - FUTIC:   800131648
 *  - RTVC:    900002583
 *  - 4-72:    900062917
 */

// ─── Fuentes de datos ────────────────────────────────────────────────────────
export const SECOP_SOURCES = {
  SECOP_II: {
    id: 'secop_ii',
    label: 'SECOP II — Contratos Electrónicos',
    baseUrl: 'https://www.datos.gov.co/resource/jbjy-vk9h.json',
    dateField: 'fecha_de_firma',
    nitField: 'nit_entidad',
    fields: [
      'id_contrato', 'referencia_del_contrato', 'nombre_entidad', 'nit_entidad',
      'objeto_del_contrato', 'tipo_de_contrato', 'modalidad_de_contratacion',
      'estado_contrato', 'fecha_de_firma', 'fecha_de_inicio_del_contrato',
      'fecha_de_fin_del_contrato', 'valor_del_contrato', 'valor_pagado',
      'valor_pendiente_de_pago', 'proveedor_adjudicado', 'documento_proveedor',
      'tipodocproveedor', 'nombre_supervisor', 'n_mero_de_documento_supervisor',
      'nombre_ordenador_del_gasto', 'n_mero_de_documento_ordenador_del_gasto',
      'departamento', 'ciudad', 'sector', 'proceso_de_compra',
      'duraci_n_del_contrato', 'urlproceso', 'es_pyme', 'dias_adicionados',
      'nombre_representante_legal', 'identificaci_n_representante_legal'
    ]
  },
  SECOP_I: {
    id: 'secop_i',
    label: 'SECOP I — Contratos',
    baseUrl: 'https://www.datos.gov.co/resource/xvdy-vvsk.json',
    dateField: 'fecha_de_firma_del_contrato',
    nitField: 'nit_de_la_entidad',
    fields: [
      'numero_del_contrato', 'nombre_entidad', 'nit_de_la_entidad',
      'objeto_del_contrato', 'tipo_de_contrato', 'modalidad_de_contratacion',
      'estado_del_contrato', 'fecha_de_firma_del_contrato',
      'fecha_de_inicio_del_contrato', 'fecha_fin_del_contrato',
      'valor_del_contrato', 'nombre_del_contratista',
      'documento_del_contratista', 'nombre_del_supervisor',
      'departamento_de_ejecucion', 'municipio_de_ejecucion'
    ]
  }
};

// ─── Entidades MinTic con sus NITs verificados ────────────────────────────────
export const ENTIDADES_MINTIC = [
  {
    id: 'mintic',
    nombre: 'MinTIC',
    nombreCompleto: 'Ministerio de Tecnologías de la Información y las Comunicaciones',
    nit: '899999053',
    color: '#FF6900',
    icono: '🏛️'
  },
  {
    id: 'ane',
    nombre: 'ANE',
    nombreCompleto: 'Agencia Nacional del Espectro',
    nit: '900334265',
    color: '#214E92',
    icono: '📡'
  },
  {
    id: 'crc',
    nombre: 'CRC',
    nombreCompleto: 'Comisión de Regulación de Comunicaciones',
    nit: '830002593',
    color: '#0D7C3D',
    icono: '⚖️'
  },
  {
    id: 'and',
    nombre: 'AND',
    nombreCompleto: 'Agencia Nacional Digital',
    nit: '901144049',
    color: '#7B2D8B',
    icono: '💻'
  },
  {
    id: 'futic',
    nombre: 'FUTIC',
    nombreCompleto: 'Fondo Único de Tecnologías de la Información y las Comunicaciones',
    nit: '800131648',
    color: '#C0392B',
    icono: '💰'
  },
  {
    id: 'rtvc',
    nombre: 'RTVC',
    nombreCompleto: 'Sistema de Medios Públicos — Radio Televisión Nacional de Colombia',
    nit: '900002583',
    color: '#E67E22',
    icono: '📺'
  },
  {
    id: '472',
    nombre: '4-72',
    nombreCompleto: 'Servicios Postales Nacionales (4-72)',
    nit: '900062917',
    color: '#16A085',
    icono: '📮'
  }
];

const FECHA_MINIMA = '2020-08-07T00:00:00.000';
const PAGE_SIZE = 200;

/**
 * Obtiene contratos de una entidad desde una fuente SECOP con paginación.
 * @param {string} nit - NIT de la entidad (sin puntos ni guión)
 * @param {object} source - Fuente SECOP (SECOP_II o SECOP_I)
 * @param {number} limit - Límite de filas (máx recomendado: 1000)
 * @param {number} offset - Offset para paginación
 * @param {object} filters - Filtros adicionales {tipoContrato, estado, valorMin, valorMax, search}
 */
export async function fetchContratosByNit(nit, source, limit = 200, offset = 0, filters = {}) {
  const { baseUrl, dateField, nitField, fields } = source;

  let whereClause = `${nitField}='${nit}' AND ${dateField} >= '${FECHA_MINIMA}'`;

  if (filters.tipoContrato && filters.tipoContrato !== 'Todos') {
    whereClause += ` AND tipo_de_contrato='${filters.tipoContrato}'`;
  }
  if (filters.estado && filters.estado !== 'Todos') {
    whereClause += ` AND estado_contrato='${filters.estado}'`;
  }
  if (filters.valorMin) {
    whereClause += ` AND valor_del_contrato >= '${filters.valorMin}'`;
  }
  if (filters.valorMax) {
    whereClause += ` AND valor_del_contrato <= '${filters.valorMax}'`;
  }
  if (filters.search) {
    const q = filters.search.replace(/'/g, "''");
    whereClause += ` AND (upper(objeto_del_contrato) LIKE upper('%${q}%') OR upper(proveedor_adjudicado) LIKE upper('%${q}%'))`;
  }

  const selectCols = fields.join(',');
  const params = new URLSearchParams({
    '$where': whereClause,
    '$select': selectCols,
    '$order': `${dateField} DESC`,
    '$limit': String(limit),
    '$offset': String(offset)
  });

  const url = `${baseUrl}?${params.toString()}`;
  console.log(`[SECOP] Consultando: ${url.slice(0, 200)}...`);

  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(30000)
  });

  if (!resp.ok) {
    throw new Error(`Error HTTP ${resp.status} al consultar SECOP: ${await resp.text()}`);
  }

  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Obtiene el total de contratos de una entidad COMO CONTRATANTE.
 */
export async function countContratosByNit(nit, source) {
  const { baseUrl, dateField, nitField } = source;
  const whereClause = `${nitField}='${nit}' AND ${dateField} >= '${FECHA_MINIMA}'`;

  const params = new URLSearchParams({
    '$where': whereClause,
    '$select': 'count(*) AS total',
    '$limit': '1'
  });

  const resp = await fetch(`${baseUrl}?${params.toString()}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000)
  });

  if (!resp.ok) return 0;
  const data = await resp.json();
  return parseInt(data?.[0]?.total || '0', 10);
}

/**
 * Obtiene contratos donde la entidad aparece COMO PROVEEDOR/CONTRATISTA.
 * Busca por NIT en documento_proveedor O por nombre en proveedor_adjudicado.
 */
export async function fetchContratosByProveedor(entidad, source, limit = 200, offset = 0, filters = {}) {
  const { baseUrl, dateField, fields } = source;
  // Busca EXACTAMENTE por NIT en el campo documento_proveedor
  let whereClause = `documento_proveedor='${entidad.nit}' AND ${dateField} >= '${FECHA_MINIMA}'`;

  if (filters.tipoContrato && filters.tipoContrato !== 'Todos') {
    whereClause += ` AND tipo_de_contrato='${filters.tipoContrato}'`;
  }
  if (filters.estado && filters.estado !== 'Todos') {
    whereClause += ` AND estado_contrato='${filters.estado}'`;
  }
  if (filters.valorMin) whereClause += ` AND valor_del_contrato >= '${filters.valorMin}'`;
  if (filters.valorMax) whereClause += ` AND valor_del_contrato <= '${filters.valorMax}'`;
  if (filters.search) {
    const q = filters.search.replace(/'/g, "''");
    // En modo proveedor: busca en objeto o en nombre de la entidad que contrató
    whereClause += ` AND (upper(objeto_del_contrato) LIKE upper('%${q}%') OR upper(nombre_entidad) LIKE upper('%${q}%'))`;
  }

  // Incluir nombre_entidad para saber quién les contrató
  const extraFields = [...fields, 'nombre_entidad', 'nit_entidad'].filter((v, i, a) => a.indexOf(v) === i);
  const params = new URLSearchParams({
    '$where': whereClause,
    '$select': extraFields.join(','),
    '$order': `${dateField} DESC`,
    '$limit': String(limit),
    '$offset': String(offset)
  });

  const url = `${baseUrl}?${params.toString()}`;
  console.log(`[SECOP-PROV] Consultando como proveedor: ${url.slice(0, 200)}...`);

  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(30000)
  });

  if (!resp.ok) throw new Error(`Error HTTP ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Cuenta contratos donde la entidad aparece COMO PROVEEDOR.
 */
export async function countContratosByProveedor(entidad, source) {
  const { baseUrl, dateField } = source;
  // Solo por NIT exacto en documento_proveedor
  const whereClause = `documento_proveedor='${entidad.nit}' AND ${dateField} >= '${FECHA_MINIMA}'`;

  const params = new URLSearchParams({
    '$where': whereClause,
    '$select': 'count(*) AS total',
    '$limit': '1'
  });

  const resp = await fetch(`${baseUrl}?${params.toString()}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000)
  });

  if (!resp.ok) return 0;
  const data = await resp.json();
  return parseInt(data?.[0]?.total || '0', 10);
}


/**
 * Normaliza un contrato de cualquier fuente a un esquema unificado.
 */
export function normalizarContrato(raw, sourceId) {
  if (sourceId === 'secop_ii') {
    return {
      _fuente: 'SECOP II',
      id: raw.id_contrato || raw.proceso_de_compra || '',
      referencia: raw.referencia_del_contrato || '',
      entidad: raw.nombre_entidad || '',
      nit: raw.nit_entidad || '',
      objeto: raw.objeto_del_contrato || raw.descripcion_del_proceso || '',
      tipo: raw.tipo_de_contrato || '',
      modalidad: raw.modalidad_de_contratacion || '',
      estado: raw.estado_contrato || '',
      fechaFirma: raw.fecha_de_firma?.slice(0, 10) || '',
      fechaInicio: raw.fecha_de_inicio_del_contrato?.slice(0, 10) || '',
      fechaFin: raw.fecha_de_fin_del_contrato?.slice(0, 10) || '',
      valor: parseFloat(raw.valor_del_contrato || '0'),
      valorPagado: parseFloat(raw.valor_pagado || '0'),
      valorPendiente: parseFloat(raw.valor_pendiente_de_pago || '0'),
      contratista: raw.proveedor_adjudicado || '',
      docContratista: raw.documento_proveedor || '',
      tipoDocContratista: raw.tipodocproveedor || '',
      supervisor: raw.nombre_supervisor || '',
      docSupervisor: raw.n_mero_de_documento_supervisor || '',
      ordenador: raw.nombre_ordenador_del_gasto || '',
      docOrdenador: raw.n_mero_de_documento_ordenador_del_gasto || '',
      representante: raw.nombre_representante_legal || '',
      docRepresentante: raw.identificaci_n_representante_legal || '',
      departamento: raw.departamento || '',
      ciudad: raw.ciudad || '',
      sector: raw.sector || '',
      duracion: raw.duraci_n_del_contrato || '',
      esPyme: raw.es_pyme || '',
      diasAdicionados: parseInt(raw.dias_adicionados || '0', 10),
      urlSecop: raw.urlproceso?.url || '',
      proceso: raw.proceso_de_compra || ''
    };
  }
  // SECOP I
  return {
    _fuente: 'SECOP I',
    id: raw.numero_del_contrato || '',
    referencia: raw.numero_del_contrato || '',
    entidad: raw.nombre_entidad || '',
    nit: raw.nit_de_la_entidad || '',
    objeto: raw.objeto_del_contrato || '',
    tipo: raw.tipo_de_contrato || '',
    modalidad: raw.modalidad_de_contratacion || '',
    estado: raw.estado_del_contrato || '',
    fechaFirma: raw.fecha_de_firma_del_contrato?.slice(0, 10) || '',
    fechaInicio: raw.fecha_de_inicio_del_contrato?.slice(0, 10) || '',
    fechaFin: raw.fecha_fin_del_contrato?.slice(0, 10) || '',
    valor: parseFloat(raw.valor_del_contrato || '0'),
    valorPagado: 0,
    valorPendiente: 0,
    contratista: raw.nombre_del_contratista || '',
    docContratista: raw.documento_del_contratista || '',
    tipoDocContratista: '',
    supervisor: raw.nombre_del_supervisor || '',
    docSupervisor: '',
    ordenador: '',
    docOrdenador: '',
    representante: '',
    docRepresentante: '',
    departamento: raw.departamento_de_ejecucion || '',
    ciudad: raw.municipio_de_ejecucion || '',
    sector: '',
    duracion: '',
    esPyme: '',
    diasAdicionados: 0,
    urlSecop: '',
    proceso: ''
  };
}
