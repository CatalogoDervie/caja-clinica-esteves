import {
  buildMovement,
  dateKey,
  inferConcept,
  normalizeHealthPlan,
  normalizeStudy,
  normalizeText,
} from './logic.js';

export function convertHistoricalMovement(source, index = 0) {
  const prepared = source?.source === 'historico-cdu' && source?.clinica === 'CDU';
  if (prepared) {
    return {
      id: source.id || `historico-cdu-${String(index + 1).padStart(4, '0')}`,
      ...buildMovement({
        ...source,
        fecha: source.fecha,
        importe: source.importe,
        source: 'historico-cdu',
      }),
      fechaKey: dateKey(source.fecha),
      importe: Math.abs(Number(source.importe) || 0),
    };
  }
  const rawCoverage = String(source.coverage ?? '').trim();
  const normalizedCoverage = normalizeHealthPlan(rawCoverage);
  const type = normalizeText(source.type) === 'egreso' ? 'Egreso' : 'Ingreso';
  const concept = inferConcept(source.service, type);
  const coverageType = type === 'Egreso'
    ? 'Particular'
    : normalizedCoverage === 'Particular'
      ? 'Particular'
      : normalizedCoverage
        ? 'Obra Social'
        : 'Sin especificar';
  const charge = normalizeText(source.chargeType);
  const sourceNumber = String(source.id || '').match(/^excel-(\d+)$/i)?.[1];
  const deterministicNumber = sourceNumber || String(index + 1);
  const movement = buildMovement({
    fecha: source.date,
    clinica: 'CDU',
    pacienteDetalle: source.patient,
    coberturaTipo: coverageType,
    obraSocial: coverageType === 'Obra Social' ? normalizedCoverage : '',
    concepto: concept,
    estudio: concept === 'Estudios' ? normalizeStudy(source.service) : '',
    tieneCoseguro: concept === 'Cirugía' && coverageType === 'Obra Social'
      ? charge.includes('sin coseguro')
        ? false
        : charge.includes('coseguro')
          ? true
          : null
      : null,
    medioPago: normalizeText(source.payment) === 'transferencia' ? 'Transferencia' : 'Efectivo',
    moneda: source.currency === 'USD' ? 'USD' : 'ARS',
    importe: Number(source.amount),
    tipoMovimiento: type,
    notas: source.notes,
    anulado: false,
    source: 'historico-cdu',
  });
  return {
    id: `historico-cdu-${deterministicNumber.padStart(4, '0')}`,
    ...movement,
    fechaKey: dateKey(source.date),
    importe: Math.abs(Number(source.amount) || 0),
  };
}

export function validateHistoricalMovements(records) {
  const exceptions = [];
  const converted = [];
  const seen = new Set();
  for (const [index, record] of (records || []).entries()) {
    const item = convertHistoricalMovement(record, index);
    const rawAmount = record?.source === 'historico-cdu' ? record.importe : record.amount;
    if (!item.fechaKey) {
      exceptions.push({ index: index + 1, id: record.id, reason: 'Fecha inválida' });
      continue;
    }
    if (!Number.isFinite(Number(rawAmount)) || Number(rawAmount) < 0) {
      exceptions.push({ index: index + 1, id: record.id, reason: 'Importe inválido' });
      continue;
    }
    if (
      item.concepto === 'Cirugía'
      && item.coberturaTipo === 'Obra Social'
      && typeof item.tieneCoseguro !== 'boolean'
    ) {
      exceptions.push({
        index: index + 1,
        id: record.id,
        reason: 'Cirugía por obra social sin indicación de coseguro',
      });
      continue;
    }
    if (seen.has(item.id)) {
      exceptions.push({ index: index + 1, id: record.id, reason: 'ID duplicado' });
      continue;
    }
    seen.add(item.id);
    converted.push(item);
  }
  return {
    sourceCount: (records || []).length,
    validCount: converted.length,
    rejectedCount: exceptions.length,
    exceptions,
    movements: converted,
  };
}
