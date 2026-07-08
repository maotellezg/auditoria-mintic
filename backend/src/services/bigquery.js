/**
 * bigquery.js — Servicio de carga de datos SECOP a BigQuery
 *
 * Dataset: secop_mintic (proyecto auditoria-mintc)
 * Tablas:
 *   - secop_ii_contratos   (jbjy-vk9h)
 *   - secop_ii_procesos    (p6dx-8zbt)
 *   - tienda_virtual       (rgxm-mmea)
 *
 * Estrategia: MERGE (upsert) para evitar duplicados.
 * Particionado por fecha de carga (_fecha_carga) para consultas eficientes.
 */

import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'auditoria-mintc';
const DATASET_ID  = 'secop_mintic';

const bq = new BigQuery({ projectId: PROJECT_ID });

// ─── Schemas ─────────────────────────────────────────────────────────────────

const SCHEMA_CONTRATOS = [
  { name: 'id_contrato',              type: 'STRING',    mode: 'NULLABLE' },
  { name: 'referencia_del_contrato',  type: 'STRING',    mode: 'NULLABLE' },
  { name: 'proceso_de_compra',        type: 'STRING',    mode: 'NULLABLE' },
  { name: 'nombre_entidad',           type: 'STRING',    mode: 'NULLABLE' },
  { name: 'nit_entidad',              type: 'STRING',    mode: 'NULLABLE' },
  { name: 'objeto_del_contrato',      type: 'STRING',    mode: 'NULLABLE' },
  { name: 'tipo_de_contrato',         type: 'STRING',    mode: 'NULLABLE' },
  { name: 'modalidad_de_contratacion',type: 'STRING',    mode: 'NULLABLE' },
  { name: 'estado_contrato',          type: 'STRING',    mode: 'NULLABLE' },
  { name: 'fecha_de_firma',           type: 'DATE',      mode: 'NULLABLE' },
  { name: 'fecha_inicio',             type: 'DATE',      mode: 'NULLABLE' },
  { name: 'fecha_fin',                type: 'DATE',      mode: 'NULLABLE' },
  { name: 'valor_del_contrato',       type: 'FLOAT64',   mode: 'NULLABLE' },
  { name: 'valor_pagado',             type: 'FLOAT64',   mode: 'NULLABLE' },
  { name: 'valor_pendiente',          type: 'FLOAT64',   mode: 'NULLABLE' },
  { name: 'proveedor_adjudicado',     type: 'STRING',    mode: 'NULLABLE' },
  { name: 'documento_proveedor',      type: 'STRING',    mode: 'NULLABLE' },
  { name: 'tipo_doc_proveedor',       type: 'STRING',    mode: 'NULLABLE' },
  { name: 'nombre_supervisor',        type: 'STRING',    mode: 'NULLABLE' },
  { name: 'nombre_ordenador',         type: 'STRING',    mode: 'NULLABLE' },
  { name: 'representante_legal',      type: 'STRING',    mode: 'NULLABLE' },
  { name: 'departamento',             type: 'STRING',    mode: 'NULLABLE' },
  { name: 'ciudad',                   type: 'STRING',    mode: 'NULLABLE' },
  { name: 'duracion',                 type: 'STRING',    mode: 'NULLABLE' },
  { name: 'es_pyme',                  type: 'STRING',    mode: 'NULLABLE' },
  { name: 'dias_adicionados',         type: 'INT64',     mode: 'NULLABLE' },
  { name: 'url_secop',                type: 'STRING',    mode: 'NULLABLE' },
  // Auditoría MinTic
  { name: 'entidades_mintic',         type: 'STRING',    mode: 'REPEATED' }, // IDs de entidades involucradas
  { name: 'roles_mintic',             type: 'STRING',    mode: 'REPEATED' }, // contratante / proveedor
  { name: '_fecha_carga',             type: 'TIMESTAMP', mode: 'REQUIRED' },
  { name: '_fuente',                  type: 'STRING',    mode: 'REQUIRED' },
];

const SCHEMA_PROCESOS = [
  { name: 'id_del_proceso',                  type: 'STRING',  mode: 'NULLABLE' },
  { name: 'referencia_del_proceso',          type: 'STRING',  mode: 'NULLABLE' },
  { name: 'ppi',                             type: 'STRING',  mode: 'NULLABLE' },
  { name: 'entidad',                         type: 'STRING',  mode: 'NULLABLE' },
  { name: 'nit_entidad',                     type: 'STRING',  mode: 'NULLABLE' },
  { name: 'nombre_del_procedimiento',        type: 'STRING',  mode: 'NULLABLE' },
  { name: 'descripcion_del_procedimiento',   type: 'STRING',  mode: 'NULLABLE' },
  { name: 'tipo_de_contrato',                type: 'STRING',  mode: 'NULLABLE' },
  { name: 'modalidad_de_contratacion',       type: 'STRING',  mode: 'NULLABLE' },
  { name: 'estado_del_procedimiento',        type: 'STRING',  mode: 'NULLABLE' },
  { name: 'estado_resumen',                  type: 'STRING',  mode: 'NULLABLE' },
  { name: 'fecha_de_publicacion',            type: 'DATE',    mode: 'NULLABLE' },
  { name: 'fecha_ultima_publicacion',        type: 'DATE',    mode: 'NULLABLE' },
  { name: 'precio_base',                     type: 'FLOAT64', mode: 'NULLABLE' },
  { name: 'valor_total_adjudicacion',        type: 'FLOAT64', mode: 'NULLABLE' },
  { name: 'nombre_del_proveedor',            type: 'STRING',  mode: 'NULLABLE' },
  { name: 'nit_del_proveedor_adjudicado',    type: 'STRING',  mode: 'NULLABLE' },
  { name: 'nombre_del_adjudicador',          type: 'STRING',  mode: 'NULLABLE' },
  { name: 'departamento_entidad',            type: 'STRING',  mode: 'NULLABLE' },
  { name: 'ciudad_entidad',                  type: 'STRING',  mode: 'NULLABLE' },
  { name: 'duracion',                        type: 'STRING',  mode: 'NULLABLE' },
  { name: 'adjudicado',                      type: 'STRING',  mode: 'NULLABLE' },
  { name: 'proveedores_invitados',           type: 'INT64',   mode: 'NULLABLE' },
  { name: 'url_secop',                       type: 'STRING',  mode: 'NULLABLE' },
  { name: 'entidades_mintic',                type: 'STRING',  mode: 'REPEATED' },
  { name: 'roles_mintic',                    type: 'STRING',  mode: 'REPEATED' },
  { name: '_fecha_carga',                    type: 'TIMESTAMP', mode: 'REQUIRED' },
  { name: '_fuente',                         type: 'STRING',  mode: 'REQUIRED' },
];

const SCHEMA_TIENDA = [
  { name: 'identificador_de_la_orden', type: 'STRING',  mode: 'NULLABLE' },
  { name: 'solicitud',                 type: 'STRING',  mode: 'NULLABLE' },
  { name: 'a_o',                       type: 'STRING',  mode: 'NULLABLE' },
  { name: 'entidad',                   type: 'STRING',  mode: 'NULLABLE' },
  { name: 'id_entidad',                type: 'STRING',  mode: 'NULLABLE' },
  { name: 'solicitante',               type: 'STRING',  mode: 'NULLABLE' },
  { name: 'proveedor',                 type: 'STRING',  mode: 'NULLABLE' },
  { name: 'nit_proveedor',             type: 'STRING',  mode: 'NULLABLE' },
  { name: 'items',                     type: 'STRING',  mode: 'NULLABLE' },
  { name: 'agregacion',                type: 'STRING',  mode: 'NULLABLE' },
  { name: 'estado',                    type: 'STRING',  mode: 'NULLABLE' },
  { name: 'fecha',                     type: 'DATE',    mode: 'NULLABLE' },
  { name: 'fecha_vence',               type: 'DATE',    mode: 'NULLABLE' },
  { name: 'total',                     type: 'FLOAT64', mode: 'NULLABLE' },
  { name: 'ciudad',                    type: 'STRING',  mode: 'NULLABLE' },
  { name: 'actividad_economica_proveedor', type: 'STRING', mode: 'NULLABLE' },
  { name: 'entidades_mintic',          type: 'STRING',  mode: 'REPEATED' },
  { name: 'roles_mintic',              type: 'STRING',  mode: 'REPEATED' },
  { name: '_fecha_carga',              type: 'TIMESTAMP', mode: 'REQUIRED' },
  { name: '_fuente',                   type: 'STRING',  mode: 'REQUIRED' },
];

// ─── Configuración de tablas ─────────────────────────────────────────────────
const TABLES = {
  secop_ii_contratos: { id: 'secop_ii_contratos', schema: SCHEMA_CONTRATOS,  pk: 'id_contrato' },
  secop_ii_procesos:  { id: 'secop_ii_procesos',  schema: SCHEMA_PROCESOS,   pk: 'id_del_proceso' },
  tienda_virtual:     { id: 'tienda_virtual',      schema: SCHEMA_TIENDA,     pk: 'identificador_de_la_orden' },
};

// ─── Inicialización del dataset y tablas ─────────────────────────────────────
export async function initBigQuery() {
  console.log(`[BQ] Inicializando dataset ${DATASET_ID}...`);
  const dataset = bq.dataset(DATASET_ID);

  // Crear dataset si no existe
  try {
    const [exists] = await dataset.exists();
    if (!exists) {
      await dataset.create({ location: 'US' });
      console.log(`[BQ] Dataset '${DATASET_ID}' creado.`);
    }
  } catch (err) {
    console.warn(`[BQ] Dataset ya existe o error menor: ${err.message}`);
  }

  // Crear tablas si no existen
  for (const tbl of Object.values(TABLES)) {
    try {
      const table = dataset.table(tbl.id);
      const [exists] = await table.exists();
      if (!exists) {
        await table.create({
          schema: tbl.schema,
          timePartitioning: { type: 'DAY', field: '_fecha_carga' },
          friendlyName: `SECOP MinTic — ${tbl.id}`
        });
        console.log(`[BQ] Tabla '${tbl.id}' creada.`);
      } else {
        console.log(`[BQ] Tabla '${tbl.id}' ya existe.`);
      }
    } catch (err) {
      console.error(`[BQ] Error creando tabla ${tbl.id}: ${err.message}`);
    }
  }
}

// ─── Conversor de fecha a BQ DATE ────────────────────────────────────────────
const toDate = (v) => {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

const toFloat = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

const toInt = (v) => {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
};

// ─── Transformadores de raw → fila BQ ────────────────────────────────────────
export function transformContrato(raw, entidadesMintic, rolesMintic) {
  const fechaCarga = new Date().toISOString();
  return {
    id_contrato:              raw.id_contrato || raw.proceso_de_compra || '',
    referencia_del_contrato:  raw.referencia_del_contrato || '',
    proceso_de_compra:        raw.proceso_de_compra || '',
    nombre_entidad:           raw.nombre_entidad || '',
    nit_entidad:              raw.nit_entidad || '',
    objeto_del_contrato:      raw.objeto_del_contrato || raw.descripcion_del_proceso || '',
    tipo_de_contrato:         raw.tipo_de_contrato || '',
    modalidad_de_contratacion:raw.modalidad_de_contratacion || '',
    estado_contrato:          raw.estado_contrato || '',
    fecha_de_firma:           toDate(raw.fecha_de_firma),
    fecha_inicio:             toDate(raw.fecha_de_inicio_del_contrato),
    fecha_fin:                toDate(raw.fecha_de_fin_del_contrato),
    valor_del_contrato:       toFloat(raw.valor_del_contrato),
    valor_pagado:             toFloat(raw.valor_pagado),
    valor_pendiente:          toFloat(raw.valor_pendiente_de_pago),
    proveedor_adjudicado:     raw.proveedor_adjudicado || '',
    documento_proveedor:      raw.documento_proveedor || '',
    tipo_doc_proveedor:       raw.tipodocproveedor || '',
    nombre_supervisor:        raw.nombre_supervisor || '',
    nombre_ordenador:         raw.nombre_ordenador_del_gasto || '',
    representante_legal:      raw.nombre_representante_legal || '',
    departamento:             raw.departamento || '',
    ciudad:                   raw.ciudad || '',
    duracion:                 raw.duraci_n_del_contrato || '',
    es_pyme:                  raw.es_pyme || '',
    dias_adicionados:         toInt(raw.dias_adicionados),
    url_secop:                raw.urlproceso?.url || '',
    entidades_mintic:         entidadesMintic,
    roles_mintic:             rolesMintic,
    _fecha_carga:             fechaCarga,
    _fuente:                  'secop_ii_contratos',
  };
}

export function transformProceso(raw, entidadesMintic, rolesMintic) {
  const fechaCarga = new Date().toISOString();
  return {
    id_del_proceso:                 raw.id_del_proceso || '',
    referencia_del_proceso:         raw.referencia_del_proceso || '',
    ppi:                            raw.ppi || '',
    entidad:                        raw.entidad || '',
    nit_entidad:                    raw.nit_entidad || '',
    nombre_del_procedimiento:       raw.nombre_del_procedimiento || '',
    descripcion_del_procedimiento:  raw.descripci_n_del_procedimiento || '',
    tipo_de_contrato:               raw.tipo_de_contrato || '',
    modalidad_de_contratacion:      raw.modalidad_de_contratacion || '',
    estado_del_procedimiento:       raw.estado_del_procedimiento || '',
    estado_resumen:                 raw.estado_resumen || '',
    fecha_de_publicacion:           toDate(raw.fecha_de_publicacion_del),
    fecha_ultima_publicacion:       toDate(raw.fecha_de_ultima_publicaci),
    precio_base:                    toFloat(raw.precio_base),
    valor_total_adjudicacion:       toFloat(raw.valor_total_adjudicacion),
    nombre_del_proveedor:           raw.nombre_del_proveedor || '',
    nit_del_proveedor_adjudicado:   raw.nit_del_proveedor_adjudicado || '',
    nombre_del_adjudicador:         raw.nombre_del_adjudicador || '',
    departamento_entidad:           raw.departamento_entidad || '',
    ciudad_entidad:                 raw.ciudad_entidad || '',
    duracion:                       raw.duracion ? `${raw.duracion} ${raw.unidad_de_duracion || ''}`.trim() : '',
    adjudicado:                     raw.adjudicado || '',
    proveedores_invitados:          toInt(raw.proveedores_invitados),
    url_secop:                      raw.urlproceso?.url || '',
    entidades_mintic:               entidadesMintic,
    roles_mintic:                   rolesMintic,
    _fecha_carga:                   fechaCarga,
    _fuente:                        'secop_ii_procesos',
  };
}

export function transformTienda(raw, entidadesMintic, rolesMintic) {
  const fechaCarga = new Date().toISOString();
  return {
    identificador_de_la_orden:      raw.identificador_de_la_orden || '',
    solicitud:                      raw.solicitud || '',
    a_o:                            raw.a_o || '',
    entidad:                        raw.entidad || '',
    id_entidad:                     raw.id_entidad || '',
    solicitante:                    raw.solicitante || '',
    proveedor:                      raw.proveedor || '',
    nit_proveedor:                  raw.nit_proveedor || '',
    items:                          (raw.items || '').slice(0, 1000), // limitar longitud
    agregacion:                     raw.agregacion || '',
    estado:                         raw.estado || '',
    fecha:                          toDate(raw.fecha),
    fecha_vence:                    toDate(raw.fecha_vence),
    total:                          toFloat(raw.total),
    ciudad:                         raw.ciudad || '',
    actividad_economica_proveedor:  raw.actividad_economica_proveedor || '',
    entidades_mintic:               entidadesMintic,
    roles_mintic:                   rolesMintic,
    _fecha_carga:                   fechaCarga,
    _fuente:                        'tienda_virtual',
  };
}

// ─── Inserción por lotes con deduplicación vía MERGE ─────────────────────────
export async function upsertRows(tableId, rows) {
  if (!rows || rows.length === 0) return { inserted: 0, updated: 0 };

  const tbl    = TABLES[tableId];
  const pk     = tbl.pk;
  const tmpId  = `_tmp_${tableId}_${Date.now()}`;
  const dataset = bq.dataset(DATASET_ID);

  try {
    // 1. Crear tabla temporal con los datos nuevos
    const tmpTable = dataset.table(tmpId);
    await tmpTable.create({ schema: tbl.schema });

    // 2. Insertar en tabla temporal por lotes de 500
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      await tmpTable.insert(batch, { skipInvalidRows: true, ignoreUnknownValues: true });
    }

    // 3. MERGE: actualiza si ya existe, inserta si es nuevo
    const cols = tbl.schema
      .filter(f => f.name !== pk && f.name !== '_fecha_carga')
      .map(f => f.name);

    const setClause    = cols.map(c => `T.${c} = S.${c}`).join(',\n      ');
    const insertCols   = [pk, ...cols, '_fecha_carga'].join(', ');
    const insertVals   = [pk, ...cols, '_fecha_carga'].map(c => `S.${c}`).join(', ');

    const mergeSQL = `
      MERGE \`${PROJECT_ID}.${DATASET_ID}.${tableId}\` T
      USING \`${PROJECT_ID}.${DATASET_ID}.${tmpId}\` S
        ON T.${pk} = S.${pk} AND T.${pk} != ''
      WHEN MATCHED THEN UPDATE SET
        ${setClause}
      WHEN NOT MATCHED THEN INSERT (${insertCols})
        VALUES (${insertVals})
    `;

    const [job] = await bq.createQueryJob({ query: mergeSQL });
    await job.getQueryResults();

    // 4. Eliminar tabla temporal
    await tmpTable.delete();

    console.log(`[BQ] MERGE en ${tableId}: ${rows.length} filas procesadas.`);
    return { processed: rows.length };

  } catch (err) {
    // Intentar limpiar la tabla temporal
    try { await dataset.table(tmpId).delete(); } catch {}
    throw err;
  }
}

// ─── Inserción simple (para registros sin PK único confiable) ────────────────
export async function insertRows(tableId, rows) {
  if (!rows || rows.length === 0) return;
  const dataset = bq.dataset(DATASET_ID);
  const table   = dataset.table(tableId);
  const BATCH   = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await table.insert(batch, { skipInvalidRows: true, ignoreUnknownValues: true });
    total += batch.length;
  }
  return total;
}

// ─── Consulta de estadísticas en BQ ─────────────────────────────────────────
export async function queryBQ(sql) {
  const [rows] = await bq.query({ query: sql, location: 'US' });
  return rows;
}

// ─── Configuración de tablas para consulta ───────────────────────────────────
const BQ_TABLE_CONFIG = {
  secop_ii_contratos: {
    table: 'secop_ii_contratos',
    dateField: 'fecha_de_firma',
    valueField: 'valor_del_contrato',
    searchFields: ['objeto_del_contrato', 'nombre_entidad', 'proveedor_adjudicado', 'referencia_del_contrato'],
    tipoField:       'tipo_de_contrato',
    modalidadField:  'modalidad_de_contratacion',
    estadoField:     'estado_contrato',
    proveedorField:  'proveedor_adjudicado',
    docProvField:    'documento_proveedor',
  },
  secop_ii_procesos: {
    table: 'secop_ii_procesos',
    dateField: 'fecha_de_publicacion',
    valueField: 'precio_base',
    searchFields: ['descripcion_del_procedimiento', 'entidad', 'nombre_del_proveedor', 'referencia_del_proceso'],
    tipoField:       'tipo_de_contrato',
    modalidadField:  'modalidad_de_contratacion',
    estadoField:     'estado_del_procedimiento',
    proveedorField:  'nombre_del_proveedor',
    docProvField:    'nit_del_proveedor_adjudicado',
  },
  tienda_virtual: {
    table: 'tienda_virtual',
    dateField: 'fecha',
    valueField: 'total',
    searchFields: ['items', 'entidad', 'proveedor'],
    tipoField:    'agregacion',
    estadoField:  'estado',
    // Sin filtros extra en Tienda Virtual
  },
};

/**
 * Consulta datos SECOP desde BigQuery con filtros, paginación y búsqueda.
 * @param {string} tabla      - 'secop_ii_contratos' | 'secop_ii_procesos' | 'tienda_virtual'
 * @param {string} entidadId  - ID de la entidad ('mintic', 'ane', etc.)
 * @param {string} modo       - 'contratante' | 'proveedor'
 * @param {object} opts       - { limit, offset, search, tipo, estado, fechaDesde, fechaHasta }
 */
export async function querySecopBQ(tabla, entidadId, modo, opts = {}) {
  const cfg = BQ_TABLE_CONFIG[tabla];
  if (!cfg) throw new Error(`Tabla desconocida: ${tabla}`);

  const {
    limit = 50, offset = 0, search = '',
    tipo = '', modalidad = '', estado = '',
    proveedor_nombre = '', doc_proveedor = '',
    fechaDesde = '', fechaHasta = '',
  } = opts;
  const fullTable = `\`${PROJECT_ID}.${DATASET_ID}.${cfg.table}\``;

  const esc = (s) => s.replace(/'/g, "''").replace(/%/g, '\\%');

  const conditions = [
    `'${entidadId}' IN UNNEST(entidades_mintic)`,
    `'${modo}' IN UNNEST(roles_mintic)`,
  ];

  if (search) {
    const q = esc(search);
    const searchCond = cfg.searchFields
      .map(f => `UPPER(IFNULL(${f},'')) LIKE UPPER('%${q}%')`)
      .join(' OR ');
    conditions.push(`(${searchCond})`);
  }
  if (tipo)             conditions.push(`UPPER(IFNULL(${cfg.tipoField},''))      = UPPER('${esc(tipo)}')`);
  if (modalidad && cfg.modalidadField)
                        conditions.push(`UPPER(IFNULL(${cfg.modalidadField},'')) = UPPER('${esc(modalidad)}')`);
  if (estado)           conditions.push(`UPPER(IFNULL(${cfg.estadoField},''))    = UPPER('${esc(estado)}')`);
  if (proveedor_nombre && cfg.proveedorField)
                        conditions.push(`UPPER(IFNULL(${cfg.proveedorField},'')) LIKE UPPER('%${esc(proveedor_nombre)}%')`);
  if (doc_proveedor && cfg.docProvField)
                        conditions.push(`UPPER(IFNULL(${cfg.docProvField},''))   LIKE UPPER('%${esc(doc_proveedor)}%')`);
  if (fechaDesde)       conditions.push(`${cfg.dateField} >= '${fechaDesde}'`);
  if (fechaHasta)       conditions.push(`${cfg.dateField} <= '${fechaHasta}'`);

  const where = conditions.join(' AND ');

  // Consulta de datos
  const dataSQL = `
    SELECT * EXCEPT(entidades_mintic, roles_mintic),
           ARRAY_TO_STRING(entidades_mintic, ',') AS entidades_mintic_str,
           ARRAY_TO_STRING(roles_mintic, ',')     AS roles_mintic_str
    FROM ${fullTable}
    WHERE ${where}
    ORDER BY ${cfg.dateField} DESC NULLS LAST
    LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
  `;

  // Consulta de conteo y valor total
  const countSQL = `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CAST(${cfg.valueField} AS FLOAT64)), 0) AS valor_total,
      COUNTIF(UPPER(IFNULL(${cfg.estadoField},'')) LIKE '%EJECUCION%') AS en_ejecucion,
      COUNTIF(UPPER(IFNULL(${cfg.estadoField},'')) LIKE '%ADICION%' 
           OR UPPER(IFNULL(${cfg.estadoField},'')) LIKE '%MODIFICACION%') AS con_adicion
    FROM ${fullTable}
    WHERE ${where}
  `;

  const [[dataRows], [countRows]] = await Promise.all([
    bq.query({ query: dataSQL, location: 'US' }),
    bq.query({ query: countSQL, location: 'US' }),
  ]);

  const count = countRows[0] || { total: 0, valor_total: 0, en_ejecucion: 0, con_adicion: 0 };

  return {
    total:        Number(count.total),
    valor_total:  Number(count.valor_total),
    en_ejecucion: Number(count.en_ejecucion),
    con_adicion:  Number(count.con_adicion),
    limit:        parseInt(limit),
    offset:       parseInt(offset),
    data:         dataRows,
    fuente:       'bigquery',
    tabla,
  };
}

/**
 * Resumen consolidado de las 3 tablas para una entidad.
 */
export async function resumenEntidadBQ(entidadId) {
  const tablas = ['secop_ii_contratos', 'secop_ii_procesos', 'tienda_virtual'];
  const modos  = ['contratante', 'proveedor'];

  const consultas = tablas.flatMap(tabla =>
    modos.map(modo => ({ tabla, modo }))
  );

  const resultados = await Promise.allSettled(
    consultas.map(({ tabla, modo }) => querySecopBQ(tabla, entidadId, modo, { limit: 1, offset: 0 }))
  );

  const resumen = {};
  consultas.forEach(({ tabla, modo }, i) => {
    if (!resumen[tabla]) resumen[tabla] = {};
    resumen[tabla][modo] = resultados[i].status === 'fulfilled'
      ? { total: resultados[i].value.total, valor_total: resultados[i].value.valor_total }
      : { total: 0, valor_total: 0 };
  });

  return resumen;
}

export { bq, DATASET_ID, PROJECT_ID, TABLES };

