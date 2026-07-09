// backend/src/services/secop_bq.js
// Sincroniza datos de SECOP II (datos.gov.co) → BigQuery y expone consultas analíticas

import { BigQuery } from '@google-cloud/bigquery';
import fetch from 'node-fetch';

const projectId = process.env.GCP_PROJECT_ID || 'auditoria-mintc';
const DATASET   = 'secop_contratos';
const TABLE     = 'contratos_directos';

const bq = new BigQuery({ projectId });

// ─── Entidades por sector ─────────────────────────────────────────────────────
export const SECTORES = {
  mintic: {
    nombre: 'Sector MINTIC',
    entidades: [
      { nombre: 'MINISTERIO TIC',           nit: '830050660', sigla: 'MinTIC'      },
      { nombre: 'COMPUTADORES PARA EDUCAR', nit: '830079479', sigla: 'CPE'         },
    ]
  },
  ambiente: {
    nombre: 'Sector Ambiente',
    entidades: [
      { nombre: 'FONDO NACIONAL AMBIENTAL',                         nit: '830025267', sigla: 'FONAM'       },
      { nombre: 'MINISTERIO DE AMBIENTE Y DESARROLLO SOSTENIBLE',   nit: '830115395', sigla: 'MinAmbiente' },
      { nombre: 'AUTORIDAD NACIONAL DE LICENCIAS AMBIENTALES ANLA', nit: '900467239', sigla: 'ANLA'        },
    ]
  }
};

const SECOP_URL = 'https://www.datos.gov.co/resource/jbjy-vk9h.json';
const PAGE_SIZE = 5000;

// ─── Schema BigQuery ──────────────────────────────────────────────────────────
const SCHEMA = [
  { name: 'sector',                    type: 'STRING'    },
  { name: 'nit_entidad',               type: 'STRING'    },
  { name: 'nombre_entidad',            type: 'STRING'    },
  { name: 'fecha_de_firma',            type: 'DATE'      },
  { name: 'valor_del_contrato',        type: 'FLOAT64'   },
  { name: 'nombre_del_contratista',    type: 'STRING'    },
  { name: 'nit_del_contratista',       type: 'STRING'    },
  { name: 'objeto_del_contrato',       type: 'STRING'    },
  { name: 'tipo_de_contrato',          type: 'STRING'    },
  { name: 'modalidad_de_contratacion', type: 'STRING'    },
  { name: 'numero_del_contrato',       type: 'STRING'    },
  { name: 'ingested_at',               type: 'TIMESTAMP' },
];

// ─── Crear tabla si no existe ─────────────────────────────────────────────────
export async function ensureTable() {
  const dataset = bq.dataset(DATASET);
  const table   = dataset.table(TABLE);
  const [exists] = await table.exists();
  if (!exists) {
    await dataset.createTable(TABLE, {
      schema: SCHEMA,
      timePartitioning: { type: 'DAY', field: 'fecha_de_firma' },
    });
    console.log(`[BQ] Tabla ${DATASET}.${TABLE} creada.`);
  }
}

// ─── Fetch paginado desde SECOP II ───────────────────────────────────────────
async function fetchSECOP(nits, offset = 0) {
  const nitsStr = nits.map(n => `'${n}'`).join(',');
  const q = `$where=nit_entidad in(${nitsStr}) AND modalidad_de_contratacion='Contrataci%C3%B3n directa'&$limit=${PAGE_SIZE}&$offset=${offset}&$select=nit_entidad,nombre_entidad,fecha_de_firma,valor_del_contrato,nombre_del_contratista,nit_del_contratista,objeto_del_contrato,tipo_de_contrato,modalidad_de_contratacion,numero_del_contrato`;
  const res = await fetch(`${SECOP_URL}?${q}`);
  if (!res.ok) throw new Error(`SECOP HTTP ${res.status}`);
  return res.json();
}

// ─── Sincronizar sector → BigQuery ───────────────────────────────────────────
export async function syncSector(sectorKey) {
  const cfg  = SECTORES[sectorKey];
  if (!cfg)  throw new Error(`Sector desconocido: ${sectorKey}`);
  const nits = cfg.entidades.map(e => e.nit);

  await ensureTable();

  // 1. Borrar registros previos del sector para recargar limpio
  await bq.query(`DELETE FROM \`${projectId}.${DATASET}.${TABLE}\` WHERE sector = '${sectorKey}'`);
  console.log(`[BQ] Registros anteriores del sector '${sectorKey}' eliminados.`);

  // 2. Fetch paginado
  let offset = 0;
  let total  = 0;
  const ingestedAt = new Date().toISOString();

  while (true) {
    const batch = await fetchSECOP(nits, offset);
    if (!batch.length) break;

    const rows = batch.map(c => ({
      sector:                    sectorKey,
      nit_entidad:               c.nit_entidad               || null,
      nombre_entidad:            c.nombre_entidad             || null,
      fecha_de_firma:            c.fecha_de_firma             ? c.fecha_de_firma.slice(0, 10) : null,
      valor_del_contrato:        c.valor_del_contrato         ? parseFloat(c.valor_del_contrato) : null,
      nombre_del_contratista:    c.nombre_del_contratista     || null,
      nit_del_contratista:       c.nit_del_contratista        || null,
      objeto_del_contrato:       (c.objeto_del_contrato       || '').slice(0, 1024),
      tipo_de_contrato:          c.tipo_de_contrato           || null,
      modalidad_de_contratacion: c.modalidad_de_contratacion  || null,
      numero_del_contrato:       c.numero_del_contrato        || null,
      ingested_at:               ingestedAt,
    }));

    await bq.dataset(DATASET).table(TABLE).insert(rows, { skipInvalidRows: true, ignoreUnknownValues: true });
    total  += rows.length;
    offset += PAGE_SIZE;

    console.log(`[BQ] Sector '${sectorKey}': ${total} registros insertados...`);
    if (batch.length < PAGE_SIZE) break;
  }

  console.log(`[BQ] ✅ Sector '${sectorKey}' sincronizado. Total: ${total} contratos.`);
  return { total, sector: sectorKey, ingestedAt };
}

// ─── Consultas analíticas ─────────────────────────────────────────────────────
const DUQUE_PERIODOS = [
  { key: 'duque_ult', label: 'Duque Último Año', desde: '2021-08-07', hasta: '2022-08-06' },
];
const PETRO_PERIODOS = [
  { key: 'petro_1', label: 'Petro Año 1', desde: '2022-08-07', hasta: '2023-08-06' },
  { key: 'petro_2', label: 'Petro Año 2', desde: '2023-08-07', hasta: '2024-08-06' },
  { key: 'petro_3', label: 'Petro Año 3', desde: '2024-08-07', hasta: '2025-08-06' },
  { key: 'petro_4', label: 'Petro Año 4', desde: '2025-08-07', hasta: '2026-07-09' },
];
export const TODOS_PERIODOS = [...DUQUE_PERIODOS, ...PETRO_PERIODOS];

// Contratos PS directos por período
export async function queryPSDirectos(sectorKey) {
  const q = `
    SELECT
      nit_del_contratista,
      nombre_del_contratista,
      nombre_entidad,
      nit_entidad,
      fecha_de_firma,
      valor_del_contrato,
      tipo_de_contrato,
      objeto_del_contrato,
      numero_del_contrato,
      CASE
        WHEN fecha_de_firma BETWEEN '2021-08-07' AND '2022-08-06' THEN 'duque_ult'
        WHEN fecha_de_firma BETWEEN '2022-08-07' AND '2023-08-06' THEN 'petro_1'
        WHEN fecha_de_firma BETWEEN '2023-08-07' AND '2024-08-06' THEN 'petro_2'
        WHEN fecha_de_firma BETWEEN '2024-08-07' AND '2025-08-06' THEN 'petro_3'
        WHEN fecha_de_firma BETWEEN '2025-08-07' AND '2026-07-09' THEN 'petro_4'
        ELSE 'fuera_rango'
      END AS periodo
    FROM \`${projectId}.${DATASET}.${TABLE}\`
    WHERE sector = '${sectorKey}'
      AND (
        LOWER(tipo_de_contrato) LIKE '%prestaci%'
        OR LOWER(objeto_del_contrato) LIKE '%prestaci%servicio%'
      )
      AND fecha_de_firma BETWEEN '2021-08-07' AND '2026-07-09'
    ORDER BY valor_del_contrato DESC
  `;
  const [rows] = await bq.query(q);
  return rows;
}

// Contratos directos NO PS por período
export async function queryOtrosDirectos(sectorKey) {
  const q = `
    SELECT
      nit_del_contratista,
      nombre_del_contratista,
      nombre_entidad,
      nit_entidad,
      fecha_de_firma,
      valor_del_contrato,
      tipo_de_contrato,
      objeto_del_contrato,
      numero_del_contrato,
      CASE
        WHEN fecha_de_firma BETWEEN '2021-08-07' AND '2022-08-06' THEN 'duque_ult'
        WHEN fecha_de_firma BETWEEN '2022-08-07' AND '2023-08-06' THEN 'petro_1'
        WHEN fecha_de_firma BETWEEN '2023-08-07' AND '2024-08-06' THEN 'petro_2'
        WHEN fecha_de_firma BETWEEN '2024-08-07' AND '2025-08-06' THEN 'petro_3'
        WHEN fecha_de_firma BETWEEN '2025-08-07' AND '2026-07-09' THEN 'petro_4'
        ELSE 'fuera_rango'
      END AS periodo
    FROM \`${projectId}.${DATASET}.${TABLE}\`
    WHERE sector = '${sectorKey}'
      AND NOT (
        LOWER(tipo_de_contrato) LIKE '%prestaci%'
        OR LOWER(objeto_del_contrato) LIKE '%prestaci%servicio%'
      )
      AND fecha_de_firma BETWEEN '2021-08-07' AND '2026-07-09'
    ORDER BY valor_del_contrato DESC
  `;
  const [rows] = await bq.query(q);
  return rows;
}

// Contratistas en más de una entidad
export async function queryCruceEntidades(sectorKey) {
  const q = `
    SELECT
      COALESCE(nit_del_contratista, nombre_del_contratista) AS key_contratista,
      MAX(nombre_del_contratista) AS nombre_del_contratista,
      MAX(nit_del_contratista)    AS nit_del_contratista,
      COUNT(DISTINCT nombre_entidad) AS num_entidades,
      ARRAY_AGG(DISTINCT nombre_entidad IGNORE NULLS) AS entidades,
      COUNT(*) AS total_contratos,
      SUM(valor_del_contrato) AS total_valor
    FROM \`${projectId}.${DATASET}.${TABLE}\`
    WHERE sector = '${sectorKey}'
      AND COALESCE(nit_del_contratista, nombre_del_contratista) IS NOT NULL
    GROUP BY key_contratista
    HAVING COUNT(DISTINCT nombre_entidad) > 1
    ORDER BY total_valor DESC
    LIMIT 500
  `;
  const [rows] = await bq.query(q);
  return rows;
}

// Contratistas del gobierno Duque que continúan en 2026
export async function queryContinuaciones2026(sectorKey) {
  const q = `
    WITH duque AS (
      SELECT DISTINCT COALESCE(nit_del_contratista, nombre_del_contratista) AS key_cont
      FROM \`${projectId}.${DATASET}.${TABLE}\`
      WHERE sector = '${sectorKey}'
        AND fecha_de_firma BETWEEN '2018-08-07' AND '2022-08-06'
        AND COALESCE(nit_del_contratista, nombre_del_contratista) IS NOT NULL
    ),
    en_2026 AS (
      SELECT
        COALESCE(nit_del_contratista, nombre_del_contratista) AS key_cont,
        MAX(nombre_del_contratista)    AS nombre_del_contratista,
        MAX(nit_del_contratista)       AS nit_del_contratista,
        ARRAY_AGG(DISTINCT nombre_entidad IGNORE NULLS) AS entidades,
        COUNT(*) AS contratos_2026,
        SUM(valor_del_contrato) AS valor_2026
      FROM \`${projectId}.${DATASET}.${TABLE}\`
      WHERE sector = '${sectorKey}'
        AND fecha_de_firma >= '2026-01-01'
        AND COALESCE(nit_del_contratista, nombre_del_contratista) IS NOT NULL
      GROUP BY key_cont
    )
    SELECT e.*
    FROM en_2026 e
    INNER JOIN duque d ON e.key_cont = d.key_cont
    ORDER BY e.valor_2026 DESC
    LIMIT 500
  `;
  const [rows] = await bq.query(q);
  return rows;
}

// Resumen ejecutivo por período
export async function queryResumenPeriodos(sectorKey) {
  const q = `
    SELECT
      CASE
        WHEN fecha_de_firma BETWEEN '2021-08-07' AND '2022-08-06' THEN 'duque_ult'
        WHEN fecha_de_firma BETWEEN '2022-08-07' AND '2023-08-06' THEN 'petro_1'
        WHEN fecha_de_firma BETWEEN '2023-08-07' AND '2024-08-06' THEN 'petro_2'
        WHEN fecha_de_firma BETWEEN '2024-08-07' AND '2025-08-06' THEN 'petro_3'
        WHEN fecha_de_firma BETWEEN '2025-08-07' AND '2026-07-09' THEN 'petro_4'
        ELSE 'fuera_rango'
      END AS periodo,
      COUNT(*) AS total_contratos,
      SUM(valor_del_contrato) AS total_valor,
      COUNT(DISTINCT COALESCE(nit_del_contratista, nombre_del_contratista)) AS contratistas_unicos,
      COUNTIF(LOWER(tipo_de_contrato) LIKE '%prestaci%' OR LOWER(objeto_del_contrato) LIKE '%prestaci%servicio%') AS contratos_ps,
      SUM(CASE WHEN LOWER(tipo_de_contrato) LIKE '%prestaci%' OR LOWER(objeto_del_contrato) LIKE '%prestaci%servicio%' THEN valor_del_contrato ELSE 0 END) AS valor_ps
    FROM \`${projectId}.${DATASET}.${TABLE}\`
    WHERE sector = '${sectorKey}'
      AND fecha_de_firma BETWEEN '2021-08-07' AND '2026-07-09'
      AND periodo != 'fuera_rango'
    GROUP BY periodo
    ORDER BY periodo
  `;
  const [rows] = await bq.query(q);
  return rows;
}

// Último ingesta del sector
export async function queryUltimaIngesta(sectorKey) {
  const q = `
    SELECT MAX(ingested_at) AS ultima_ingesta, COUNT(*) AS total
    FROM \`${projectId}.${DATASET}.${TABLE}\`
    WHERE sector = '${sectorKey}'
  `;
  const [rows] = await bq.query(q);
  return rows[0] || {};
}
