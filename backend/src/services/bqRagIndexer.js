/**
 * bqRagIndexer.js
 * Convierte los contratos almacenados en BigQuery en chunks de texto con embeddings,
 * y los guarda en Firestore (colección document_chunks) para que el chat RAG los encuentre.
 *
 * Cada contrato → 1 chunk de texto estructurado con metadatos.
 * Los chunks quedan disponibles en la misma capa semántica que los documentos subidos.
 *
 * Uso:
 *   import { indexarContratosEnRAG } from './bqRagIndexer.js';
 *   await indexarContratosEnRAG({ db, getEmbedding });
 */

import { BigQuery } from '@google-cloud/bigquery';
import { FieldValue } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'auditoria-mintc';
const DATASET    = 'secop_mintic';
const bq         = new BigQuery({ projectId: PROJECT_ID });

// Entidades del sector TIC
const ENTIDADES = ['mintic','ane','crc','and','futic','rtvc','472'];

const DUQUE_DESDE = '2018-08-07';
const DUQUE_HASTA = '2022-08-06';
const PETRO_DESDE = '2022-08-07';

/**
 * Serializa tipos especiales de BigQuery (Date, BigInt) a primitivos JS.
 */
const serializeRow = (row) => {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) { out[k] = null; continue; }
    if (typeof v === 'bigint') { out[k] = Number(v); continue; }
    if (typeof v === 'object' && !Array.isArray(v) && v.value !== undefined) {
      out[k] = String(v.value).slice(0, 10); continue;
    }
    out[k] = v;
  }
  return out;
};

/**
 * Convierte un contrato BQ a texto legible para el embedding.
 */
const contratoATexto = (c) => {
  const COP  = (v) => v ? `$${Number(v).toLocaleString('es-CO')}` : 'N/D';
  const fecha = c.fecha_de_firma || c.fecha_inicio || 'Sin fecha';
  const gobierno = fecha >= PETRO_DESDE ? 'Gobierno Petro (2022-2026)' :
                   fecha >= DUQUE_DESDE ? 'Gobierno Duque (2018-2022)' : 'Otro período';

  return [
    `[BQ-SECOP|${c._entidad_id}|${c.referencia_del_contrato || c.id_contrato || 'SIN-REF'}]`,
    `CONTRATO SECOP — ${gobierno}`,
    `Referencia: ${c.referencia_del_contrato || c.id_contrato || 'Sin referencia'}`,
    `Entidad contratante: ${c.nombre_entidad || c._entidad_id?.toUpperCase() || 'N/D'} (NIT: ${c.nit_entidad || 'N/D'})`,
    `Objeto: ${c.objeto_del_contrato || 'Sin objeto'}`,
    `Tipo de contrato: ${c.tipo_de_contrato || 'N/D'}`,
    `Modalidad: ${c.modalidad_de_contratacion || 'N/D'}`,
    `Estado: ${c.estado_contrato || 'N/D'}`,
    `Proveedor/Contratista: ${c.proveedor_adjudicado || 'N/D'} (NIT/Cédula: ${c.documento_proveedor || 'N/D'})`,
    `Valor del contrato: ${COP(c.valor_del_contrato)}`,
    c.valor_pagado ? `Valor pagado: ${COP(c.valor_pagado)}` : '',
    c.dias_adicionados ? `Días adicionados: ${c.dias_adicionados}` : '',
    `Fecha de firma: ${c.fecha_de_firma || 'N/D'}`,
    c.fecha_fin ? `Fecha fin: ${c.fecha_fin}` : '',
    c.nombre_supervisor ? `Supervisor: ${c.nombre_supervisor}` : '',
    c.nombre_ordenador  ? `Ordenador del gasto: ${c.nombre_ordenador}` : '',
    c.es_pyme === 'Si'  ? 'Contratista es PYME: Sí' : '',
    c.url_secop ? `URL SECOP: ${c.url_secop}` : '',
  ].filter(Boolean).join('\n');
};

/**
 * Indexa los contratos BQ en Firestore para que el chat RAG los encuentre.
 *
 * @param {object} opts
 * @param {FirebaseFirestore.Firestore} opts.db         Instancia de Firestore
 * @param {Function}                   opts.getEmbedding Función de embedding (text → vector)
 * @param {string}                     [opts.entidadId] Solo indexar esta entidad (opcional)
 * @param {number}                     [opts.limite]    Máx contratos por entidad (default 300)
 * @returns {{ indexed: number, skipped: number, errors: number }}
 */
export async function indexarContratosEnRAG({ db, getEmbedding, entidadId, limite = 300 }) {
  const entidades = entidadId ? [entidadId] : ENTIDADES;
  let indexed = 0, skipped = 0, errors = 0;

  console.log(`[BQ-RAG] Iniciando indexación de ${entidades.length} entidades, límite ${limite} c/u`);

  for (const eid of entidades) {
    try {
      // Obtener los contratos de mayor valor primero (más relevantes para auditoría)
      const sql = `
        SELECT
          id_contrato, referencia_del_contrato, nombre_entidad, nit_entidad,
          objeto_del_contrato, tipo_de_contrato, modalidad_de_contratacion,
          estado_contrato, fecha_de_firma, fecha_inicio, fecha_fin,
          valor_del_contrato, valor_pagado, dias_adicionados,
          proveedor_adjudicado, documento_proveedor, tipo_doc_proveedor,
          nombre_supervisor, nombre_ordenador, es_pyme, url_secop
        FROM \`${PROJECT_ID}.${DATASET}.secop_ii_contratos\`
        WHERE '${eid}' IN UNNEST(entidades_mintic)
          AND 'contratante' IN UNNEST(roles_mintic)
          AND fecha_de_firma >= '${DUQUE_DESDE}'
        ORDER BY valor_del_contrato DESC NULLS LAST
        LIMIT ${parseInt(limite)}
      `;

      const [rows] = await bq.query({ query: sql, location: 'US' });
      console.log(`[BQ-RAG] ${eid}: ${rows.length} contratos obtenidos de BQ`);

      // Procesar en lotes de 10 para no saturar Vertex AI Embeddings
      const LOTE = 10;
      for (let i = 0; i < rows.length; i += LOTE) {
        const lote = rows.slice(i, i + LOTE).map(r => ({ ...serializeRow(r), _entidad_id: eid }));

        await Promise.all(lote.map(async (contrato) => {
          try {
            const docId  = `bq_secop_${eid}_${contrato.referencia_del_contrato || contrato.id_contrato || i}`;
            const texto  = contratoATexto(contrato);
            const vector = await getEmbedding(texto);

            await db.collection('document_chunks').doc(docId).set({
              docId:     `bq_secop_${eid}`,
              fileName:  `SECOP_BQ_${eid.toUpperCase()}_contratos`,
              text:      texto,
              embedding: FieldValue.vector(vector),
              // Metadatos para enriquecimiento del contexto
              fuente:    'bigquery',
              tabla:     'secop_ii_contratos',
              entidad:   eid,
              referencia: contrato.referencia_del_contrato || contrato.id_contrato,
              valor:     contrato.valor_del_contrato,
              proveedor: contrato.proveedor_adjudicado,
              nit_proveedor: contrato.documento_proveedor,
              fecha:     contrato.fecha_de_firma,
              tipo:      contrato.tipo_de_contrato,
              estado:    contrato.estado_contrato,
              _indexado: new Date().toISOString(),
            }, { merge: false }); // Sobreescribir para mantener fresco

            indexed++;
          } catch (chunkErr) {
            console.warn(`[BQ-RAG] Error en chunk ${contrato.referencia_del_contrato}:`, chunkErr.message);
            errors++;
          }
        }));

        // Pausa entre lotes para respetar rate limits de Vertex AI
        if (i + LOTE < rows.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      console.log(`[BQ-RAG] ${eid}: indexados ${Math.min(rows.length, limite)} contratos`);

    } catch (entityErr) {
      console.error(`[BQ-RAG] Error procesando entidad ${eid}:`, entityErr.message);
      skipped += limite;
    }
  }

  const resumen = { indexed, skipped, errors, entidades: entidades.length };
  console.log('[BQ-RAG] Indexación completa:', resumen);
  return resumen;
}
