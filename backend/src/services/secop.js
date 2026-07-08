/**
 * secop.js — Servicio de conexión a las 3 APIs de Contratación Pública
 *
 * API 1: SECOP II - Contratos Electrónicos       jbjy-vk9h  ~5.6M filas
 * API 2: SECOP II - Procesos de Contratación     p6dx-8zbt  ~8.7M filas
 * API 3: Tienda Virtual del Estado Colombiano    rgxm-mmea  ~165K filas
 *
 * Entidades MinTic (NITs sin puntos ni guión):
 *   MinTIC  899999053  |  ANE  900334265  |  CRC  830002593
 *   AND     901144049  |  FUTIC 800131648 |  RTVC 900002583  |  4-72  900062917
 */

const FECHA_MINIMA = '2018-08-07T00:00:00.000';

// ─── Definición de las 3 fuentes ─────────────────────────────────────────────
export const SECOP_SOURCES = {

  SECOP_II_CONTRATOS: {
    id: 'secop_ii_contratos',
    label: 'SECOP II — Contratos Electrónicos',
    shortLabel: 'Contratos',
    baseUrl: 'https://www.datos.gov.co/resource/jbjy-vk9h.json',
    // Campos para filtrar como CONTRATANTE
    nitField: 'nit_entidad',
    dateField: 'fecha_de_firma',
    // Campos para filtrar como PROVEEDOR
    proveedorNitField: 'documento_proveedor',
    proveedorNombreField: null,   // tiene NIT → búsqueda exacta
    usarNombreProveedor: false,
    // Campos a seleccionar
    selectFields: [
      'id_contrato', 'referencia_del_contrato', 'proceso_de_compra',
      'nombre_entidad', 'nit_entidad',
      'objeto_del_contrato', 'descripcion_del_proceso',
      'tipo_de_contrato', 'modalidad_de_contratacion',
      'estado_contrato', 'fecha_de_firma',
      'fecha_de_inicio_del_contrato', 'fecha_de_fin_del_contrato',
      'valor_del_contrato', 'valor_pagado', 'valor_pendiente_de_pago',
      'proveedor_adjudicado', 'documento_proveedor', 'tipodocproveedor',
      'nombre_supervisor', 'n_mero_de_documento_supervisor',
      'nombre_ordenador_del_gasto', 'n_mero_de_documento_ordenador_del_gasto',
      'nombre_representante_legal', 'identificaci_n_representante_legal',
      'departamento', 'ciudad', 'sector',
      'duraci_n_del_contrato', 'es_pyme', 'dias_adicionados',
      'urlproceso'
    ]
  },

  SECOP_II_PROCESOS: {
    id: 'secop_ii_procesos',
    label: 'SECOP II — Procesos de Contratación',
    shortLabel: 'Procesos',
    baseUrl: 'https://www.datos.gov.co/resource/p6dx-8zbt.json',
    nitField: 'nit_entidad',
    dateField: 'fecha_de_publicacion_del',
    proveedorNitField: 'nit_del_proveedor_adjudicado',
    proveedorNombreField: null,
    usarNombreProveedor: false,
    selectFields: [
      'id_del_proceso', 'referencia_del_proceso', 'ppi',
      'entidad', 'nit_entidad',
      'nombre_del_procedimiento', 'descripci_n_del_procedimiento',
      'tipo_de_contrato', 'modalidad_de_contratacion',
      'estado_del_procedimiento', 'estado_resumen',
      'fecha_de_publicacion_del', 'fecha_de_ultima_publicaci',
      'precio_base', 'valor_total_adjudicacion',
      'nombre_del_proveedor', 'nit_del_proveedor_adjudicado',
      'nombre_del_adjudicador',
      'departamento_entidad', 'ciudad_entidad',
      'duracion', 'unidad_de_duracion',
      'adjudicado', 'proveedores_invitados',
      'codigo_principal_de_categoria',
      'urlproceso'
    ]
  },

  TIENDA_VIRTUAL: {
    id: 'tienda_virtual',
    label: 'Tienda Virtual del Estado Colombiano',
    shortLabel: 'Tienda Virtual',
    baseUrl: 'https://www.datos.gov.co/resource/rgxm-mmea.json',
    // ⚠️ nit_entidad es "No Definido" en este dataset → filtrar por nombre
    nitField: null,
    nombreEntidadField: 'entidad',
    dateField: 'fecha',
    // Como proveedor: buscar por nombre del proveedor
    proveedorNitField: null,
    proveedorNombreField: 'proveedor',
    usarNombreProveedor: true,
    selectFields: [
      'identificador_de_la_orden', 'solicitud', 'a_o',
      'entidad', 'nit_entidad', 'id_entidad',
      'solicitante', 'proveedor', 'nit_proveedor',
      'items', 'agregacion',
      'estado', 'fecha', 'fecha_vence',
      'total', 'ciudad',
      'sector_de_la_entidad', 'orden_de_la_entidad',
      'actividad_economica_proveedor', 'espostconflicto'
    ]
  }
};

// ─── Entidades MinTic con metadatos ──────────────────────────────────────────
export const ENTIDADES_MINTIC = [
  {
    id: 'mintic', nombre: 'MinTIC', nit: '899999053', color: '#FF6900',
    nombreCompleto: 'Ministerio de Tecnologías de la Información y las Comunicaciones',
    nombreCorto: 'MINISTERIO DE TECNOLOG',   // para búsqueda LIKE en Tienda Virtual
    icono: '🏛️'
  },
  {
    id: 'ane', nombre: 'ANE', nit: '900334265', color: '#214E92',
    nombreCompleto: 'Agencia Nacional del Espectro',
    nombreCorto: 'AGENCIA NACIONAL DEL ESPECTRO',
    icono: '📡'
  },
  {
    id: 'crc', nombre: 'CRC', nit: '830002593', color: '#0D7C3D',
    nombreCompleto: 'Comisión de Regulación de Comunicaciones',
    nombreCorto: 'COMISION DE REGULACION DE COMUNICACIONES',
    icono: '⚖️'
  },
  {
    id: 'and', nombre: 'AND', nit: '901144049', color: '#7B2D8B',
    nombreCompleto: 'Agencia Nacional Digital',
    nombreCorto: 'AGENCIA NACIONAL DIGITAL',
    icono: '💻'
  },
  {
    id: 'futic', nombre: 'FUTIC', nit: '800131648', color: '#C0392B',
    nombreCompleto: 'Fondo Único de Tecnologías de la Información y las Comunicaciones',
    nombreCorto: 'FONDO UNICO DE TECNOLOGIAS',
    icono: '💰'
  },
  {
    id: 'rtvc', nombre: 'RTVC', nit: '900002583', color: '#E67E22',
    nombreCompleto: 'Sistema de Medios Públicos',
    nombreCorto: 'RTVC',
    icono: '📺'
  },
  {
    id: '472', nombre: '4-72', nit: '900062917', color: '#16A085',
    nombreCompleto: 'Servicios Postales Nacionales (4-72)',
    nombreCorto: 'SERVICIOS POSTALES NACIONALES',
    icono: '📮'
  }
];

// ─── Helpers de construcción de cláusulas WHERE ──────────────────────────────

function whereContratante(entidad, source, filters = {}) {
  const { nitField, nombreEntidadField, dateField } = source;
  let where;

  if (source.id === 'tienda_virtual') {
    // Filtro por nombre (LIKE) porque nit_entidad = "No Definido"
    const q = entidad.nombreCorto.replace(/'/g, "''");
    where = `upper(${nombreEntidadField}) LIKE upper('%${q}%') AND ${dateField} >= '${FECHA_MINIMA}'`;
  } else {
    where = `${nitField}='${entidad.nit}' AND ${dateField} >= '${FECHA_MINIMA}'`;
  }

  if (filters.tipoContrato && source.id !== 'tienda_virtual') {
    where += ` AND tipo_de_contrato='${filters.tipoContrato.replace(/'/g, "''")}'`;
  }
  if (filters.estado) {
    const estadoField = source.id === 'secop_ii_procesos' ? 'estado_del_procedimiento' : 'estado';
    where += ` AND ${estadoField}='${filters.estado.replace(/'/g, "''")}'`;
  }
  if (filters.search) {
    const q = filters.search.replace(/'/g, "''");
    if (source.id === 'secop_ii_contratos') {
      where += ` AND (upper(objeto_del_contrato) LIKE upper('%${q}%') OR upper(proveedor_adjudicado) LIKE upper('%${q}%'))`;
    } else if (source.id === 'secop_ii_procesos') {
      where += ` AND (upper(descripci_n_del_procedimiento) LIKE upper('%${q}%') OR upper(nombre_del_proveedor) LIKE upper('%${q}%'))`;
    } else {
      where += ` AND (upper(items) LIKE upper('%${q}%') OR upper(proveedor) LIKE upper('%${q}%'))`;
    }
  }
  return where;
}

function whereProveedor(entidad, source, filters = {}) {
  const { proveedorNitField, proveedorNombreField, dateField, usarNombreProveedor } = source;
  let where;

  if (usarNombreProveedor || !proveedorNitField) {
    // Tienda Virtual: busca por nombre del proveedor
    const q = entidad.nombreCorto.replace(/'/g, "''");
    where = `upper(${proveedorNombreField}) LIKE upper('%${q}%') AND ${dateField} >= '${FECHA_MINIMA}'`;
  } else {
    // SECOP I y II: búsqueda exacta por NIT
    where = `${proveedorNitField}='${entidad.nit}' AND ${dateField} >= '${FECHA_MINIMA}'`;
  }

  if (filters.tipoContrato && source.id !== 'tienda_virtual') {
    where += ` AND tipo_de_contrato='${filters.tipoContrato.replace(/'/g, "''")}'`;
  }
  if (filters.search) {
    const q = filters.search.replace(/'/g, "''");
    if (source.id === 'secop_ii_contratos') {
      where += ` AND (upper(objeto_del_contrato) LIKE upper('%${q}%') OR upper(nombre_entidad) LIKE upper('%${q}%'))`;
    } else if (source.id === 'secop_ii_procesos') {
      where += ` AND (upper(descripci_n_del_procedimiento) LIKE upper('%${q}%') OR upper(entidad) LIKE upper('%${q}%'))`;
    } else {
      where += ` AND (upper(items) LIKE upper('%${q}%') OR upper(entidad) LIKE upper('%${q}%'))`;
    }
  }
  return where;
}

// ─── Función genérica de consulta ────────────────────────────────────────────
async function querySecop(source, whereClause, limit = 100, offset = 0) {
  const params = new URLSearchParams({
    '$where':  whereClause,
    '$select': source.selectFields.join(','),
    '$order':  `${source.dateField} DESC`,
    '$limit':  String(limit),
    '$offset': String(offset)
  });

  const url = `${source.baseUrl}?${params.toString()}`;
  console.log(`[SECOP:${source.id}] ${url.slice(0, 180)}...`);

  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} en ${source.label}: ${await resp.text()}`);
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

async function countSecop(source, whereClause) {
  const params = new URLSearchParams({
    '$where': whereClause,
    '$select': 'count(*) AS total',
    '$limit': '1'
  });
  try {
    const resp = await fetch(`${source.baseUrl}?${params.toString()}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) return 0;
    const data = await resp.json();
    return parseInt(data?.[0]?.total || '0', 10);
  } catch { return 0; }
}

// ─── API pública para el backend ─────────────────────────────────────────────

export async function fetchContratante(entidad, sourceId, limit = 100, offset = 0, filters = {}) {
  const source = SECOP_SOURCES[sourceId] || SECOP_SOURCES.SECOP_II_CONTRATOS;
  const where  = whereContratante(entidad, source, filters);
  return querySecop(source, where, limit, offset);
}

export async function countContratante(entidad, sourceId) {
  const source = SECOP_SOURCES[sourceId] || SECOP_SOURCES.SECOP_II_CONTRATOS;
  return countSecop(source, whereContratante(entidad, source, {}));
}

export async function fetchProveedor(entidad, sourceId, limit = 100, offset = 0, filters = {}) {
  const source = SECOP_SOURCES[sourceId] || SECOP_SOURCES.SECOP_II_CONTRATOS;
  // Añadir campos de entidad contratante según la fuente (cada API tiene nombres distintos)
  // - secop_ii_contratos: nombre_entidad, nit_entidad
  // - secop_ii_procesos:  entidad (no nombre_entidad), nit_entidad
  // - tienda_virtual:     entidad, id_entidad
  const entityNameField = source.id === 'secop_ii_contratos' ? 'nombre_entidad' : 'entidad';
  const entityIdField   = source.id === 'tienda_virtual'     ? 'id_entidad'     : 'nit_entidad';
  const extraSource = {
    ...source,
    selectFields: [...new Set([...source.selectFields, entityNameField, entityIdField])]
  };
  const where = whereProveedor(entidad, source, filters);
  return querySecop(extraSource, where, limit, offset);
}

export async function countProveedor(entidad, sourceId) {
  const source = SECOP_SOURCES[sourceId] || SECOP_SOURCES.SECOP_II_CONTRATOS;
  return countSecop(source, whereProveedor(entidad, source, {}));
}

// ─── Normalización de contratos a esquema unificado ─────────────────────────
export function normalizarContrato(raw, sourceId, modo = 'contratante') {
  if (sourceId === 'secop_ii_contratos') {
    return {
      _fuente: 'SECOP II Contratos', _sourceId: sourceId,
      id:               raw.id_contrato || raw.proceso_de_compra || '',
      referencia:       raw.referencia_del_contrato || '',
      entidad:          raw.nombre_entidad || '',
      nit:              raw.nit_entidad || '',
      objeto:           raw.objeto_del_contrato || raw.descripcion_del_proceso || '',
      tipo:             raw.tipo_de_contrato || '',
      modalidad:        raw.modalidad_de_contratacion || '',
      estado:           raw.estado_contrato || '',
      fechaFirma:       raw.fecha_de_firma?.slice(0, 10) || '',
      fechaInicio:      raw.fecha_de_inicio_del_contrato?.slice(0, 10) || '',
      fechaFin:         raw.fecha_de_fin_del_contrato?.slice(0, 10) || '',
      valor:            parseFloat(raw.valor_del_contrato || '0'),
      valorPagado:      parseFloat(raw.valor_pagado || '0'),
      valorPendiente:   parseFloat(raw.valor_pendiente_de_pago || '0'),
      contratista:      raw.proveedor_adjudicado || '',
      docContratista:   raw.documento_proveedor || '',
      tipoDocContratista: raw.tipodocproveedor || '',
      supervisor:       raw.nombre_supervisor || '',
      docSupervisor:    raw.n_mero_de_documento_supervisor || '',
      ordenador:        raw.nombre_ordenador_del_gasto || '',
      docOrdenador:     raw.n_mero_de_documento_ordenador_del_gasto || '',
      representante:    raw.nombre_representante_legal || '',
      docRepresentante: raw.identificaci_n_representante_legal || '',
      departamento:     raw.departamento || '',
      ciudad:           raw.ciudad || '',
      duracion:         raw.duraci_n_del_contrato || '',
      esPyme:           raw.es_pyme || '',
      diasAdicionados:  parseInt(raw.dias_adicionados || '0', 10),
      urlSecop:         raw.urlproceso?.url || '',
      // Proveedor
      _contratante:    modo === 'proveedor' ? (raw.nombre_entidad || '') : '',
      _nitContratante: modo === 'proveedor' ? (raw.nit_entidad || '') : ''
    };
  }

  if (sourceId === 'secop_ii_procesos') {
    const valor = parseFloat(raw.valor_total_adjudicacion || raw.precio_base || '0');
    return {
      _fuente: 'SECOP II Procesos', _sourceId: sourceId,
      id:               raw.id_del_proceso || '',
      referencia:       raw.referencia_del_proceso || raw.id_del_proceso || '',
      entidad:          raw.entidad || '',
      nit:              raw.nit_entidad || '',
      objeto:           raw.descripci_n_del_procedimiento || raw.nombre_del_procedimiento || '',
      tipo:             raw.tipo_de_contrato || '',
      modalidad:        raw.modalidad_de_contratacion || '',
      estado:           raw.estado_resumen || raw.estado_del_procedimiento || '',
      fechaFirma:       raw.fecha_de_publicacion_del?.slice(0, 10) || '',
      fechaInicio:      raw.fecha_de_publicacion_del?.slice(0, 10) || '',
      fechaFin:         raw.fecha_de_ultima_publicaci?.slice(0, 10) || '',
      valor:            valor,
      valorPagado:      0,
      valorPendiente:   valor,
      contratista:      raw.nombre_del_proveedor || 'No adjudicado',
      docContratista:   raw.nit_del_proveedor_adjudicado || '',
      tipoDocContratista: 'NIT',
      supervisor:       '',
      docSupervisor:    '',
      ordenador:        raw.nombre_del_adjudicador || '',
      docOrdenador:     '',
      representante:    '',
      docRepresentante: '',
      departamento:     raw.departamento_entidad || '',
      ciudad:           raw.ciudad_entidad || '',
      duracion:         raw.duracion ? `${raw.duracion} ${raw.unidad_de_duracion || ''}` : '',
      esPyme:           '',
      diasAdicionados:  0,
      urlSecop:         raw.urlproceso?.url || '',
      adjudicado:       raw.adjudicado || '',
      proveedoresInvitados: raw.proveedores_invitados || '0',
      _contratante:    modo === 'proveedor' ? (raw.entidad || '') : '',
      _nitContratante: modo === 'proveedor' ? (raw.nit_entidad || '') : ''
    };
  }

  if (sourceId === 'tienda_virtual') {
    return {
      _fuente: 'Tienda Virtual', _sourceId: sourceId,
      id:               raw.identificador_de_la_orden || raw.solicitud || '',
      referencia:       `Orden ${raw.identificador_de_la_orden || ''} · Sol. ${raw.solicitud || ''}`,
      entidad:          raw.entidad || '',
      nit:              raw.nit_entidad || '',
      objeto:           raw.items || raw.agregacion || '',
      tipo:             raw.agregacion || 'Tienda Virtual',
      modalidad:        'Acuerdo Marco de Precios',
      estado:           raw.estado || '',
      fechaFirma:       raw.fecha?.slice(0, 10) || '',
      fechaInicio:      raw.fecha?.slice(0, 10) || '',
      fechaFin:         raw.fecha_vence?.slice(0, 10) || '',
      valor:            parseFloat(raw.total || '0'),
      valorPagado:      0,
      valorPendiente:   parseFloat(raw.total || '0'),
      contratista:      raw.proveedor || '',
      docContratista:   raw.nit_proveedor || '',
      tipoDocContratista: 'NIT',
      supervisor:       raw.solicitante || '',
      docSupervisor:    '',
      ordenador:        raw.solicitante || '',
      docOrdenador:     '',
      representante:    '',
      docRepresentante: '',
      departamento:     '',
      ciudad:           raw.ciudad || '',
      duracion:         '',
      esPyme:           '',
      diasAdicionados:  0,
      urlSecop:         '',
      año:              raw.a_o || '',
      actividadEconomica: raw.actividad_economica_proveedor || '',
      _contratante:    modo === 'proveedor' ? (raw.entidad || '') : '',
      _nitContratante: modo === 'proveedor' ? (raw.id_entidad || '') : ''
    };
  }

  return { _fuente: 'Desconocida', id: '', valor: 0 };
}
