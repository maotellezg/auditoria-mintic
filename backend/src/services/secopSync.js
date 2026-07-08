/**
 * secopSync.js — Sincronización completa de SECOP → BigQuery
 *
 * Descarga TODOS los registros de las 3 APIs para las 7 entidades MinTic
 * (como contratante Y como proveedor) y los guarda en BigQuery vía MERGE.
 *
 * Se puede llamar manualmente (botón en UI) o via Cloud Scheduler.
 */

import { fetchContratante, fetchProveedor, ENTIDADES_MINTIC, SECOP_SOURCES } from './secop.js';
import {
  initBigQuery, upsertRows,
  transformContrato, transformProceso, transformTienda
} from './bigquery.js';

const PAGE_SIZE    = 1000;  // máximo por llamada a la API
const DELAY_MS     = 300;   // pausa entre páginas para no saturar la API

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// ─── Función para obtener TODAS las páginas de una consulta ──────────────────
async function fetchAllPages(fetchFn, entidad, sourceKey, modo, onProgress) {
  const rows = [];
  let page   = 1;
  let hasMore = true;

  while (hasMore) {
    const batch = await fetchFn(entidad, sourceKey, PAGE_SIZE, (page - 1) * PAGE_SIZE, {});
    if (!Array.isArray(batch) || batch.length === 0) {
      hasMore = false;
    } else {
      rows.push(...batch);
      onProgress?.(`  📄 ${entidad.nombre} | ${sourceKey} | ${modo} | pág ${page} → +${batch.length} (total: ${rows.length})`);
      if (batch.length < PAGE_SIZE) {
        hasMore = false; // última página
      } else {
        page++;
        await sleep(DELAY_MS);
      }
    }
  }
  return rows;
}

// ─── Transformador por fuente ─────────────────────────────────────────────────
function transformRow(raw, sourceKey, entidadId, modo) {
  const entidades = [entidadId];
  const roles     = [modo];

  switch (sourceKey) {
    case 'SECOP_II_CONTRATOS': return transformContrato(raw, entidades, roles);
    case 'SECOP_II_PROCESOS':  return transformProceso(raw, entidades, roles);
    case 'TIENDA_VIRTUAL':     return transformTienda(raw, entidades, roles);
    default: return null;
  }
}

// ─── BQ table ID por fuente ───────────────────────────────────────────────────
const BQ_TABLE = {
  SECOP_II_CONTRATOS: 'secop_ii_contratos',
  SECOP_II_PROCESOS:  'secop_ii_procesos',
  TIENDA_VIRTUAL:     'tienda_virtual',
};

// ─── Sincronización principal ─────────────────────────────────────────────────
export async function sincronizarTodo(onProgress) {
  const log = (msg) => {
    console.log(msg);
    onProgress?.(msg);
  };

  const resumen = {
    inicio:     new Date().toISOString(),
    entidades:  ENTIDADES_MINTIC.length,
    fuentes:    Object.keys(SECOP_SOURCES).length,
    totalFilas: 0,
    detalles:   [],
    errores:    []
  };

  log('🚀 Iniciando sincronización SECOP → BigQuery');
  log(`📋 Entidades: ${ENTIDADES_MINTIC.map(e => e.nombre).join(', ')}`);
  log(`🗄️ Fuentes: ${Object.values(SECOP_SOURCES).map(s => s.shortLabel).join(', ')}`);

  // Inicializar dataset y tablas en BigQuery
  log('\n⚙️ Inicializando BigQuery...');
  await initBigQuery();
  log('✅ BigQuery listo.\n');

  // Para cada fuente: acumular todas las filas y hacer un solo MERGE al final
  const acumulado = {
    SECOP_II_CONTRATOS: new Map(), // key=pk, value=row
    SECOP_II_PROCESOS:  new Map(),
    TIENDA_VIRTUAL:     new Map(),
  };

  for (const sourceKey of Object.keys(SECOP_SOURCES)) {
    const source = SECOP_SOURCES[sourceKey];
    log(`\n━━━ Fuente: ${source.label} ━━━`);

    for (const entidad of ENTIDADES_MINTIC) {
      // ── Como CONTRATANTE ─────────────────────────────────────────────
      try {
        log(`\n🏛️ ${entidad.nombre} — Como CONTRATANTE [${source.shortLabel}]`);
        const rawCont = await fetchAllPages(fetchContratante, entidad, sourceKey, 'contratante', log);
        log(`  ✅ ${rawCont.length} registros obtenidos`);

        for (const raw of rawCont) {
          const row = transformRow(raw, sourceKey, entidad.id, 'contratante');
          if (!row) continue;
          const pk = row[getPK(sourceKey)];
          if (!pk) continue;

          // Si ya existe (de otra entidad o modo), merge roles
          if (acumulado[sourceKey].has(pk)) {
            const existing = acumulado[sourceKey].get(pk);
            if (!existing.entidades_mintic.includes(entidad.id)) existing.entidades_mintic.push(entidad.id);
            if (!existing.roles_mintic.includes('contratante')) existing.roles_mintic.push('contratante');
          } else {
            acumulado[sourceKey].set(pk, row);
          }
        }
        resumen.totalFilas += rawCont.length;
        resumen.detalles.push({ entidad: entidad.nombre, fuente: source.shortLabel, modo: 'contratante', filas: rawCont.length });
      } catch (err) {
        const msg = `❌ Error ${entidad.nombre} contratante [${source.shortLabel}]: ${err.message}`;
        log(msg); resumen.errores.push(msg);
      }

      await sleep(DELAY_MS);

      // ── Como PROVEEDOR ───────────────────────────────────────────────
      try {
        log(`\n🤝 ${entidad.nombre} — Como PROVEEDOR [${source.shortLabel}]`);
        const rawProv = await fetchAllPages(fetchProveedor, entidad, sourceKey, 'proveedor', log);
        log(`  ✅ ${rawProv.length} registros obtenidos`);

        for (const raw of rawProv) {
          const row = transformRow(raw, sourceKey, entidad.id, 'proveedor');
          if (!row) continue;
          const pk = row[getPK(sourceKey)];
          if (!pk) continue;

          if (acumulado[sourceKey].has(pk)) {
            const existing = acumulado[sourceKey].get(pk);
            if (!existing.entidades_mintic.includes(entidad.id)) existing.entidades_mintic.push(entidad.id);
            if (!existing.roles_mintic.includes('proveedor')) existing.roles_mintic.push('proveedor');
          } else {
            acumulado[sourceKey].set(pk, row);
          }
        }
        resumen.totalFilas += rawProv.length;
        resumen.detalles.push({ entidad: entidad.nombre, fuente: source.shortLabel, modo: 'proveedor', filas: rawProv.length });
      } catch (err) {
        const msg = `❌ Error ${entidad.nombre} proveedor [${source.shortLabel}]: ${err.message}`;
        log(msg); resumen.errores.push(msg);
      }

      await sleep(DELAY_MS);
    }

    // ── Guardar en BigQuery ───────────────────────────────────────────────
    const filas = Array.from(acumulado[sourceKey].values());
    if (filas.length > 0) {
      const tableId = BQ_TABLE[sourceKey];
      log(`\n💾 Guardando ${filas.length} filas únicas en BigQuery tabla '${tableId}'...`);
      try {
        await upsertRows(tableId, filas);
        log(`✅ ${filas.length} filas guardadas en '${tableId}'`);
      } catch (err) {
        const msg = `❌ Error BQ ${tableId}: ${err.message}`;
        log(msg); resumen.errores.push(msg);
      }
    } else {
      log(`ℹ️ Sin filas para guardar en ${BQ_TABLE[sourceKey]}`);
    }
  }

  resumen.fin = new Date().toISOString();
  resumen.duracionSeg = Math.round((new Date(resumen.fin) - new Date(resumen.inicio)) / 1000);
  resumen.filasUnicas = Object.values(acumulado).reduce((s, m) => s + m.size, 0);

  log(`\n✅ Sincronización completa en ${resumen.duracionSeg}s`);
  log(`📊 Total filas procesadas: ${resumen.totalFilas} | Únicas en BQ: ${resumen.filasUnicas}`);
  if (resumen.errores.length) log(`⚠️ Errores: ${resumen.errores.length}`);

  return resumen;
}

// ─── Sincronización incremental (solo últimos N días) ────────────────────────
export async function sincronizarIncremental(diasAtras = 2, onProgress) {
  // La función sincronizarTodo ya usa fechas desde 2018 y hace MERGE,
  // por lo que es idempotente. Para mayor velocidad podemos filtrar por fecha
  // reciente, pero por ahora usamos la sync completa (los MERGE manejan duplicados).
  return sincronizarTodo(onProgress);
}

const getPK = (sourceKey) => {
  if (sourceKey === 'SECOP_II_CONTRATOS') return 'id_contrato';
  if (sourceKey === 'SECOP_II_PROCESOS')  return 'id_del_proceso';
  return 'identificador_de_la_orden';
};
