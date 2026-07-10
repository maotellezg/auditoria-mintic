/**
 * analytics.js
 * Servicio de analítica comparativa Duque vs Petro para detección de corrupción.
 * Utiliza BigQuery sobre la tabla secop_ii_contratos del dataset secop_mintic.
 */

import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'auditoria-mintc';
const DATASET = 'secop_mintic';
const bq = new BigQuery({ projectId: PROJECT_ID });

// Periodos de gobierno
const DUQUE_DESDE = '2018-08-07';
const DUQUE_HASTA = '2022-08-06';
const PETRO_DESDE = '2022-08-07';

const TABLE = `\`${PROJECT_ID}.${DATASET}.secop_ii_contratos\``;

/**
 * Serializa resultados de BigQuery:
 * - BigInt → Number
 * - Date → string ISO
 * - Objetos {value: x} de BigQuery (BigQueryInt, BigQueryNumeric) → Number o String
 * - null/undefined → null
 */
function serializeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // BigQuery devuelve números grandes como objetos {value: "12345678.90"}
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && 'value' in v) {
    const n = Number(v.value);
    return isNaN(n) ? String(v.value) : n;
  }
  if (Array.isArray(v)) return v.map(serializeValue);
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = serializeValue(v[k]);
    return out;
  }
  return v;
}

function serialize(rows) {
  return rows.map(row => serializeValue(row));
}

async function runQuery(sql) {
  const [rows] = await bq.query({ query: sql, location: 'US' });
  return serialize(rows);
}

// Filtro base para entidad como contratante
const baseFilter = (entidadId) =>
  `'${entidadId}' IN UNNEST(entidades_mintic) AND 'contratante' IN UNNEST(roles_mintic)`;

// ─── KPIs comparativos Duque vs Petro ────────────────────────────────────────
export async function kpisComparativos(entidadId) {
  const f = baseFilter(entidadId);
  const sql = `
    SELECT
      -- DUQUE
      COUNTIF(fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}') AS duque_n_contratos,
      IFNULL(SUM(CASE WHEN fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}' THEN SAFE_CAST(valor_del_contrato AS FLOAT64) END), 0) AS duque_valor_total,
      COUNT(DISTINCT CASE WHEN fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}' THEN documento_proveedor END) AS duque_contratistas,
      SAFE_DIVIDE(
        SUM(CASE WHEN fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}' THEN SAFE_CAST(valor_del_contrato AS FLOAT64) END),
        NULLIF(COUNTIF(fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}'), 0)
      ) AS duque_ticket_promedio,
      SAFE_DIVIDE(
        COUNTIF(fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}' AND LOWER(modalidad_de_contratacion) LIKE '%directa%'),
        NULLIF(COUNTIF(fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}'), 0)
      ) * 100 AS duque_pct_directa,
      SAFE_DIVIDE(
        COUNTIF(fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}' AND LOWER(tipo_de_contrato) LIKE '%prestaci%'),
        NULLIF(COUNTIF(fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}'), 0)
      ) * 100 AS duque_pct_prestacion,
      SAFE_DIVIDE(
        COUNTIF(fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}' AND SAFE_CAST(dias_adicionados AS FLOAT64) > 0),
        NULLIF(COUNTIF(fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}'), 0)
      ) * 100 AS duque_pct_adicionados,

      -- PETRO
      COUNTIF(fecha_de_firma >= '${PETRO_DESDE}') AS petro_n_contratos,
      IFNULL(SUM(CASE WHEN fecha_de_firma >= '${PETRO_DESDE}' THEN SAFE_CAST(valor_del_contrato AS FLOAT64) END), 0) AS petro_valor_total,
      COUNT(DISTINCT CASE WHEN fecha_de_firma >= '${PETRO_DESDE}' THEN documento_proveedor END) AS petro_contratistas,
      SAFE_DIVIDE(
        SUM(CASE WHEN fecha_de_firma >= '${PETRO_DESDE}' THEN SAFE_CAST(valor_del_contrato AS FLOAT64) END),
        NULLIF(COUNTIF(fecha_de_firma >= '${PETRO_DESDE}'), 0)
      ) AS petro_ticket_promedio,
      SAFE_DIVIDE(
        COUNTIF(fecha_de_firma >= '${PETRO_DESDE}' AND LOWER(modalidad_de_contratacion) LIKE '%directa%'),
        NULLIF(COUNTIF(fecha_de_firma >= '${PETRO_DESDE}'), 0)
      ) * 100 AS petro_pct_directa,
      SAFE_DIVIDE(
        COUNTIF(fecha_de_firma >= '${PETRO_DESDE}' AND LOWER(tipo_de_contrato) LIKE '%prestaci%'),
        NULLIF(COUNTIF(fecha_de_firma >= '${PETRO_DESDE}'), 0)
      ) * 100 AS petro_pct_prestacion,
      SAFE_DIVIDE(
        COUNTIF(fecha_de_firma >= '${PETRO_DESDE}' AND SAFE_CAST(dias_adicionados AS FLOAT64) > 0),
        NULLIF(COUNTIF(fecha_de_firma >= '${PETRO_DESDE}'), 0)
      ) * 100 AS petro_pct_adicionados
    FROM ${TABLE}
    WHERE ${f}
      AND fecha_de_firma IS NOT NULL
  `;
  const rows = await runQuery(sql);
  return rows[0] || {};
}

// ─── Serie mensual de gasto ───────────────────────────────────────────────────
export async function serieMensual(entidadId) {
  const f = baseFilter(entidadId);
  const sql = `
    SELECT
      FORMAT_DATE('%Y-%m', fecha_de_firma) AS mes,
      CASE
        WHEN fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}' THEN 'Duque'
        WHEN fecha_de_firma >= '${PETRO_DESDE}' THEN 'Petro'
        ELSE 'Otro'
      END AS gobierno,
      COUNT(*) AS n_contratos,
      SUM(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_total
    FROM ${TABLE}
    WHERE ${f}
      AND fecha_de_firma IS NOT NULL
      AND fecha_de_firma >= '${DUQUE_DESDE}'
    GROUP BY 1, 2
    ORDER BY 1
  `;
  return runQuery(sql);
}

// ─── Tipos de contrato por gobierno ──────────────────────────────────────────
export async function tiposContrato(entidadId) {
  const f = baseFilter(entidadId);
  const sql = `
    SELECT
      CASE
        WHEN fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}' THEN 'Duque'
        WHEN fecha_de_firma >= '${PETRO_DESDE}' THEN 'Petro'
        ELSE 'Otro'
      END AS gobierno,
      IFNULL(tipo_de_contrato, 'Sin clasificar') AS tipo,
      COUNT(*) AS n_contratos,
      SUM(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_total
    FROM ${TABLE}
    WHERE ${f}
      AND fecha_de_firma IS NOT NULL
      AND fecha_de_firma >= '${DUQUE_DESDE}'
    GROUP BY 1, 2
    ORDER BY 1, 3 DESC
  `;
  return runQuery(sql);
}

// ─── Modalidades de contratación por gobierno ─────────────────────────────────
export async function modalidades(entidadId) {
  const f = baseFilter(entidadId);
  const sql = `
    SELECT
      CASE
        WHEN fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}' THEN 'Duque'
        WHEN fecha_de_firma >= '${PETRO_DESDE}' THEN 'Petro'
        ELSE 'Otro'
      END AS gobierno,
      IFNULL(modalidad_de_contratacion, 'Sin clasificar') AS modalidad,
      COUNT(*) AS n_contratos,
      SUM(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_total
    FROM ${TABLE}
    WHERE ${f}
      AND fecha_de_firma IS NOT NULL
      AND fecha_de_firma >= '${DUQUE_DESDE}'
    GROUP BY 1, 2
    ORDER BY 1, 3 DESC
  `;
  return runQuery(sql);
}

// ─── Top 30 contratistas con scoring de riesgo ───────────────────────────────
export async function topContratistas(entidadId) {
  const f = baseFilter(entidadId);
  const sql = `
    WITH totales AS (
      SELECT
        SUM(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS gran_total
      FROM ${TABLE}
      WHERE ${f}
        AND fecha_de_firma >= '${DUQUE_DESDE}'
    ),
    por_proveedor AS (
      SELECT
        IFNULL(proveedor_adjudicado, 'Sin nombre') AS nombre,
        IFNULL(documento_proveedor, 'Sin NIT') AS nit,
        SUM(CASE WHEN fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}' THEN SAFE_CAST(valor_del_contrato AS FLOAT64) ELSE 0 END) AS valor_duque,
        SUM(CASE WHEN fecha_de_firma >= '${PETRO_DESDE}' THEN SAFE_CAST(valor_del_contrato AS FLOAT64) ELSE 0 END) AS valor_petro,
        COUNT(*) AS n_contratos,
        SUM(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_total
      FROM ${TABLE}
      WHERE ${f}
        AND fecha_de_firma >= '${DUQUE_DESDE}'
      GROUP BY 1, 2
    )
    SELECT
      p.*,
      SAFE_DIVIDE(p.valor_total, t.gran_total) * 100 AS pct_del_total,
      SAFE_DIVIDE(p.valor_petro - p.valor_duque, NULLIF(p.valor_duque, 0)) * 100 AS variacion_pct
    FROM por_proveedor p, totales t
    ORDER BY valor_total DESC
    LIMIT 30
  `;
  return runQuery(sql);
}

// ─── Prestación de servicios por año (nómina paralela) ───────────────────────
export async function prestacionServicios(entidadId) {
  const f = baseFilter(entidadId);
  const sql = `
    SELECT
      EXTRACT(YEAR FROM fecha_de_firma) AS anio,
      COUNT(*) AS n_total,
      COUNTIF(LOWER(tipo_de_contrato) LIKE '%prestaci%') AS n_prestacion,
      SUM(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_total,
      SUM(CASE WHEN LOWER(tipo_de_contrato) LIKE '%prestaci%' THEN SAFE_CAST(valor_del_contrato AS FLOAT64) ELSE 0 END) AS valor_prestacion,
      SAFE_DIVIDE(
        COUNTIF(LOWER(tipo_de_contrato) LIKE '%prestaci%'),
        COUNT(*)
      ) * 100 AS pct_prestacion
    FROM ${TABLE}
    WHERE ${f}
      AND fecha_de_firma IS NOT NULL
      AND fecha_de_firma >= '${DUQUE_DESDE}'
    GROUP BY 1
    ORDER BY 1
  `;
  return runQuery(sql);
}

// ─── Heatmap mensual (intensidad de contratación) ────────────────────────────
export async function heatmapMensual(entidadId) {
  const f = baseFilter(entidadId);
  const sql = `
    SELECT
      EXTRACT(YEAR FROM fecha_de_firma) AS anio,
      EXTRACT(MONTH FROM fecha_de_firma) AS mes,
      COUNT(*) AS n_contratos,
      SUM(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_total,
      CASE
        WHEN fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}' THEN 'Duque'
        WHEN fecha_de_firma >= '${PETRO_DESDE}' THEN 'Petro'
        ELSE 'Otro'
      END AS gobierno
    FROM ${TABLE}
    WHERE ${f}
      AND fecha_de_firma IS NOT NULL
      AND fecha_de_firma >= '${DUQUE_DESDE}'
    GROUP BY 1, 2, 5
    ORDER BY 1, 2
  `;
  return runQuery(sql);
}

// ─── Alertas de riesgo automáticas ───────────────────────────────────────────
export async function alertasRiesgo(entidadId) {
  const f = baseFilter(entidadId);

  // Datos para calcular alertas
  const [kpis, topC] = await Promise.all([
    kpisComparativos(entidadId),
    topContratistas(entidadId),
  ]);

  const alertas = [];

  // Verificar período activo (Petro)
  const totalPetro = kpis.petro_valor_total || 0;
  const nPetro = kpis.petro_n_contratos || 0;

  // 1. Alta concentración (top 3 > 50% del presupuesto)
  if (topC.length >= 3) {
    const top3pct = topC.slice(0, 3).reduce((s, r) => s + (r.pct_del_total || 0), 0);
    alertas.push({
      nivel: top3pct > 50 ? 'ROJO' : top3pct > 30 ? 'AMARILLO' : 'VERDE',
      tipo: 'CONCENTRACION',
      titulo: 'Concentración en Contratistas',
      descripcion: `Los 3 principales contratistas recibieron el ${top3pct.toFixed(1)}% del presupuesto total (umbral crítico: 50%).`,
      valor: parseFloat(top3pct.toFixed(2)),
      umbral: 50,
    });
  }

  // 2. Alta contratación directa (> 60% por valor — período Petro)
  const pctDirectaPetro = kpis.petro_pct_directa || 0;
  alertas.push({
    nivel: pctDirectaPetro > 60 ? 'ROJO' : pctDirectaPetro > 40 ? 'AMARILLO' : 'VERDE',
    tipo: 'CONTRATACION_DIRECTA',
    titulo: 'Alta Contratación Directa (Petro)',
    descripcion: `El ${pctDirectaPetro.toFixed(1)}% de los contratos en el gobierno Petro se adjudicaron por contratación directa (umbral crítico: 60%).`,
    valor: parseFloat(pctDirectaPetro.toFixed(2)),
    umbral: 60,
  });

  // 3. Alta contratación directa (Duque comparativo)
  const pctDirectaDuque = kpis.duque_pct_directa || 0;
  alertas.push({
    nivel: pctDirectaDuque > 60 ? 'ROJO' : pctDirectaDuque > 40 ? 'AMARILLO' : 'VERDE',
    tipo: 'CONTRATACION_DIRECTA_DUQUE',
    titulo: 'Alta Contratación Directa (Duque)',
    descripcion: `El ${pctDirectaDuque.toFixed(1)}% de los contratos en el gobierno Duque se adjudicaron por contratación directa (umbral crítico: 60%).`,
    valor: parseFloat(pctDirectaDuque.toFixed(2)),
    umbral: 60,
  });

  // 4. Alta frecuencia de adiciones (> 15%)
  const pctAdicionadosPetro = kpis.petro_pct_adicionados || 0;
  alertas.push({
    nivel: pctAdicionadosPetro > 25 ? 'ROJO' : pctAdicionadosPetro > 15 ? 'AMARILLO' : 'VERDE',
    tipo: 'ADICIONES',
    titulo: 'Contratos con Adiciones Frecuentes (Petro)',
    descripcion: `El ${pctAdicionadosPetro.toFixed(1)}% de los contratos del gobierno Petro tienen adiciones de tiempo/valor (umbral: 15%).`,
    valor: parseFloat(pctAdicionadosPetro.toFixed(2)),
    umbral: 15,
  });

  // 5. Alta prestación de servicios (> 40%) — nómina paralela
  const pctPrestacionPetro = kpis.petro_pct_prestacion || 0;
  alertas.push({
    nivel: pctPrestacionPetro > 40 ? 'ROJO' : pctPrestacionPetro > 25 ? 'AMARILLO' : 'VERDE',
    tipo: 'NOMINA_PARALELA',
    titulo: 'Riesgo de Nómina Paralela (Petro)',
    descripcion: `El ${pctPrestacionPetro.toFixed(1)}% de los contratos Petro son de prestación de servicios, indicador de posible nómina paralela (umbral crítico: 40%).`,
    valor: parseFloat(pctPrestacionPetro.toFixed(2)),
    umbral: 40,
  });

  const pctPrestacionDuque = kpis.duque_pct_prestacion || 0;
  alertas.push({
    nivel: pctPrestacionDuque > 40 ? 'ROJO' : pctPrestacionDuque > 25 ? 'AMARILLO' : 'VERDE',
    tipo: 'NOMINA_PARALELA_DUQUE',
    titulo: 'Riesgo de Nómina Paralela (Duque)',
    descripcion: `El ${pctPrestacionDuque.toFixed(1)}% de los contratos Duque son de prestación de servicios (umbral crítico: 40%).`,
    valor: parseFloat(pctPrestacionDuque.toFixed(2)),
    umbral: 40,
  });

  // Ordenar: ROJO primero, luego AMARILLO, luego VERDE
  const nivelOrder = { ROJO: 0, AMARILLO: 1, VERDE: 2 };
  alertas.sort((a, b) => (nivelOrder[a.nivel] || 0) - (nivelOrder[b.nivel] || 0));

  return alertas;
}

// ─── Top 50 contratos por valor ───────────────────────────────────────────────
export async function topContratosValor(entidadId) {
  const f = baseFilter(entidadId);
  const sql = `
    SELECT
      referencia_del_contrato,
      objeto_del_contrato,
      proveedor_adjudicado,
      documento_proveedor,
      tipo_de_contrato,
      modalidad_de_contratacion,
      estado_contrato,
      fecha_de_firma,
      SAFE_CAST(valor_del_contrato AS FLOAT64) AS valor_del_contrato,
      SAFE_CAST(dias_adicionados AS FLOAT64) AS dias_adicionados,
      url_secop,
      CASE
        WHEN fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}' THEN 'Duque'
        WHEN fecha_de_firma >= '${PETRO_DESDE}' THEN 'Petro'
        ELSE 'Otro'
      END AS gobierno
    FROM ${TABLE}
    WHERE ${f}
      AND fecha_de_firma IS NOT NULL
      AND fecha_de_firma >= '${DUQUE_DESDE}'
    ORDER BY SAFE_CAST(valor_del_contrato AS FLOAT64) DESC
    LIMIT 50
  `;
  return runQuery(sql);
}

// ─── PRESTACIÓN DE SERVICIOS — análisis detallado ────────────────────────────
export async function prestacionServiciosDetalle(entidadId) {
  const f = baseFilter(entidadId);
  const PS_FILTER = `(LOWER(tipo_de_contrato) LIKE '%prestaci%' OR LOWER(tipo_de_contrato) LIKE '%servicios%')
                     AND LOWER(modalidad_de_contratacion) LIKE '%directa%'`;
  const NIT_F   = `UPPER(IFNULL(tipo_doc_proveedor,'')) = 'NIT'`;
  const NONIT_F = `UPPER(IFNULL(tipo_doc_proveedor,'')) != 'NIT'`;

  // Genera SQL anual con filtro de tipo-doc opcional
  const mkAnual = (docF = '') => `
    SELECT
      EXTRACT(YEAR FROM fecha_de_firma) AS anio,
      CASE WHEN fecha_de_firma < '${PETRO_DESDE}' THEN 'Duque' ELSE 'Petro' END AS gobierno,
      COUNT(*) AS n_contratos,
      IFNULL(SUM(SAFE_CAST(valor_del_contrato AS FLOAT64)), 0) AS valor_total,
      COUNT(DISTINCT documento_proveedor) AS personas_unicas,
      AVG(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_promedio
    FROM ${TABLE}
    WHERE ${f} AND ${PS_FILTER}
      ${docF ? `AND ${docF}` : ''}
      AND fecha_de_firma IS NOT NULL
      AND fecha_de_firma >= '2021-08-07'
    GROUP BY anio, gobierno
    ORDER BY anio
  `;

  // Genera SQL top-ganadores con filtro de tipo-doc opcional
  const mkTop = (docF = '') => `
    SELECT
      documento_proveedor,
      MAX(proveedor_adjudicado) AS nombre,
      MAX(IFNULL(tipo_doc_proveedor, '—')) AS tipo_doc,
      COUNT(*) AS n_contratos,
      SUM(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_total,
      AVG(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_promedio,
      MIN(EXTRACT(YEAR FROM fecha_de_firma)) AS primer_anio,
      MAX(EXTRACT(YEAR FROM fecha_de_firma)) AS ultimo_anio
    FROM ${TABLE}
    WHERE ${f} AND ${PS_FILTER}
      ${docF ? `AND ${docF}` : ''}
      AND fecha_de_firma >= '${PETRO_DESDE}'
      AND documento_proveedor IS NOT NULL
    GROUP BY documento_proveedor
    ORDER BY valor_total DESC
    LIMIT 50
  `;

  const ENTIDADES_MINTIC = "('mintic','ane','crc','and','futic','rtvc','472','cpe')";
  const sqlRepetidos = `
    SELECT
      t.documento_proveedor,
      MAX(t.proveedor_adjudicado) AS nombre,
      MAX(IFNULL(t.tipo_doc_proveedor,'—')) AS tipo_doc,
      COUNT(DISTINCT ent) AS n_entidades,
      COUNT(*) AS n_contratos,
      SUM(SAFE_CAST(t.valor_del_contrato AS FLOAT64)) AS valor_total,
      STRING_AGG(DISTINCT ent ORDER BY ent LIMIT 10) AS entidades
    FROM ${TABLE} t, UNNEST(t.entidades_mintic) AS ent
    WHERE ${PS_FILTER}
      AND t.fecha_de_firma >= '${PETRO_DESDE}'
      AND t.documento_proveedor IS NOT NULL
      AND 'contratante' IN UNNEST(t.roles_mintic)
      AND ent IN ${ENTIDADES_MINTIC}
    GROUP BY t.documento_proveedor
    HAVING COUNT(DISTINCT ent) > 1
    ORDER BY valor_total DESC
    LIMIT 100
  `;

  const sqlContinuanDuque = `
    SELECT
      documento_proveedor,
      MAX(proveedor_adjudicado) AS nombre,
      MAX(IFNULL(tipo_doc_proveedor,'—')) AS tipo_doc,
      COUNT(*) AS n_contratos_duque,
      SUM(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_duque,
      MAX(fecha_de_firma) AS ultima_firma_duque,
      estado_contrato
    FROM ${TABLE}
    WHERE ${f} AND ${PS_FILTER}
      AND fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}'
      AND documento_proveedor IN (
        SELECT DISTINCT documento_proveedor FROM ${TABLE}
        WHERE ${f} AND ${PS_FILTER}
          AND EXTRACT(YEAR FROM fecha_de_firma) = 2026
      )
    GROUP BY documento_proveedor, estado_contrato
    ORDER BY valor_duque DESC
    LIMIT 200
  `;

  const sqlTotalPetro = `
    SELECT
      EXTRACT(YEAR FROM fecha_de_firma) AS anio,
      COUNT(*) AS n_contratos,
      SUM(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_total,
      COUNT(DISTINCT documento_proveedor) AS personas
    FROM ${TABLE}
    WHERE ${f} AND ${PS_FILTER}
      AND fecha_de_firma >= '${PETRO_DESDE}'
    GROUP BY anio ORDER BY anio
  `;

  const [
    porAnio, porAnioNIT, porAnioNoNIT,
    topGanadores, topGanadoresNIT, topGanadoresNoNIT,
    repetidos, continuanDuque, totalPetro
  ] = await Promise.all([
    runQuery(mkAnual()),
    runQuery(mkAnual(NIT_F)),
    runQuery(mkAnual(NONIT_F)),
    runQuery(mkTop()),
    runQuery(mkTop(NIT_F)),
    runQuery(mkTop(NONIT_F)),
    runQuery(sqlRepetidos),
    runQuery(sqlContinuanDuque),
    runQuery(sqlTotalPetro),
  ]);

  return { porAnio, porAnioNIT, porAnioNoNIT, topGanadores, topGanadoresNIT, topGanadoresNoNIT, repetidos, continuanDuque, totalPetro };
}

// ─── DIRECTOS NO PRESTACIÓN — análisis completo ───────────────────────────────
export async function directosNoPrestacion(entidadId) {
  const f = baseFilter(entidadId);
  const NPS_FILTER = `LOWER(modalidad_de_contratacion) LIKE '%directa%'
                      AND NOT (LOWER(tipo_de_contrato) LIKE '%prestaci%' OR LOWER(tipo_de_contrato) LIKE '%servicios%')`;

  // 1. Por año y gobierno
  const sqlAnual = `
    SELECT
      EXTRACT(YEAR FROM fecha_de_firma) AS anio,
      CASE WHEN fecha_de_firma < '${PETRO_DESDE}' THEN 'Duque' ELSE 'Petro' END AS gobierno,
      tipo_de_contrato,
      COUNT(*) AS n_contratos,
      SUM(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_total,
      COUNT(DISTINCT documento_proveedor) AS proveedores_unicos
    FROM ${TABLE}
    WHERE ${f} AND ${NPS_FILTER}
      AND fecha_de_firma IS NOT NULL
      AND fecha_de_firma >= '${DUQUE_DESDE}'
    GROUP BY anio, gobierno, tipo_de_contrato
    ORDER BY anio, valor_total DESC
  `;

  // 2. Top tipos de contrato por valor
  const sqlTipos = `
    SELECT
      tipo_de_contrato,
      CASE WHEN fecha_de_firma < '${PETRO_DESDE}' THEN 'Duque' ELSE 'Petro' END AS gobierno,
      COUNT(*) AS n_contratos,
      SUM(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_total,
      AVG(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_promedio
    FROM ${TABLE}
    WHERE ${f} AND ${NPS_FILTER}
      AND fecha_de_firma >= '${DUQUE_DESDE}'
    GROUP BY tipo_de_contrato, gobierno
    ORDER BY valor_total DESC
    LIMIT 40
  `;

  // 3. Top proveedores directos no-PS gobierno Petro
  const sqlTopProveedores = `
    SELECT
      documento_proveedor,
      MAX(proveedor_adjudicado) AS nombre,
      MAX(tipo_de_contrato) AS tipo_principal,
      COUNT(*) AS n_contratos,
      SUM(SAFE_CAST(valor_del_contrato AS FLOAT64)) AS valor_total,
      COUNT(DISTINCT tipo_de_contrato) AS tipos_distintos,
      1 AS n_entidades
    FROM ${TABLE}
    WHERE ${f} AND ${NPS_FILTER}
      AND fecha_de_firma >= '${PETRO_DESDE}'
      AND documento_proveedor IS NOT NULL
    GROUP BY documento_proveedor
    ORDER BY valor_total DESC
    LIMIT 50
  `;

  // 4. Contratos de mayor valor directos no-PS (top 30)
  const sqlTopContratos = `
    SELECT
      referencia_del_contrato,
      objeto_del_contrato,
      proveedor_adjudicado,
      tipo_de_contrato,
      estado_contrato,
      fecha_de_firma,
      SAFE_CAST(valor_del_contrato AS FLOAT64) AS valor_del_contrato,
      CASE WHEN fecha_de_firma < '${PETRO_DESDE}' THEN 'Duque' ELSE 'Petro' END AS gobierno,
      url_secop
    FROM ${TABLE}
    WHERE ${f} AND ${NPS_FILTER}
      AND fecha_de_firma >= '${DUQUE_DESDE}'
    ORDER BY SAFE_CAST(valor_del_contrato AS FLOAT64) DESC
    LIMIT 30
  `;

  // 5. Comparativo Duque vs Petro KPIs
  const sqlKpis = `
    SELECT
      COUNTIF(fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}') AS duque_n,
      SUM(CASE WHEN fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}' THEN SAFE_CAST(valor_del_contrato AS FLOAT64) END) AS duque_valor,
      COUNT(DISTINCT CASE WHEN fecha_de_firma BETWEEN '${DUQUE_DESDE}' AND '${DUQUE_HASTA}' THEN documento_proveedor END) AS duque_proveedores,
      COUNTIF(fecha_de_firma >= '${PETRO_DESDE}') AS petro_n,
      SUM(CASE WHEN fecha_de_firma >= '${PETRO_DESDE}' THEN SAFE_CAST(valor_del_contrato AS FLOAT64) END) AS petro_valor,
      COUNT(DISTINCT CASE WHEN fecha_de_firma >= '${PETRO_DESDE}' THEN documento_proveedor END) AS petro_proveedores
    FROM ${TABLE}
    WHERE ${f} AND ${NPS_FILTER}
      AND fecha_de_firma >= '${DUQUE_DESDE}'
  `;

  const [porAnio, porTipo, topProveedores, topContratos, kpis] = await Promise.all([
    runQuery(sqlAnual),
    runQuery(sqlTipos),
    runQuery(sqlTopProveedores),
    runQuery(sqlTopContratos),
    runQuery(sqlKpis),
  ]);

  return { porAnio, porTipo, topProveedores, topContratos, kpis: kpis[0] || {} };
}
