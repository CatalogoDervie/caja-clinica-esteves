export const CLINICS = Object.freeze(['CDU', 'GUA']);
export const CURRENCIES = Object.freeze(['ARS', 'USD']);
export const CONCEPTS = Object.freeze([
  'Consulta',
  'Estudios',
  'Cirugía',
  'Lentes',
  'Otros / Gasto',
]);
export const STUDIES = Object.freeze([
  'OCT',
  'Paquimetría',
  'Topografía',
  'HRT',
  'YAG',
  'Campimetría / CV',
]);
export const PAYMENT_METHODS = Object.freeze(['Efectivo', 'Transferencia', 'Otro']);
export const ARGENTINA_TIME_ZONE = 'America/Argentina/Cordoba';

const argentinaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ARGENTINA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function argentinaDate(date = new Date()) {
  const parts = Object.fromEntries(
    argentinaDateFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function argentinaMonth(date = new Date()) {
  return argentinaDate(date).slice(0, 7);
}

export function dateKey(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return 0;
  return Number(String(date).replaceAll('-', ''));
}

export function dateFromKey(value) {
  const key = String(value ?? '');
  if (!/^\d{8}$/.test(key)) return '';
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

export function formatDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return '—';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

export function formatMoney(value, currency = 'ARS') {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: currency === 'USD' ? 'USD' : 'ARS',
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format(Number(value) || 0);
}

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeHealthPlan(value) {
  const source = String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalized = normalizeText(source).replaceAll('.', '');
  if (!source) return '';
  if (normalized === 'particular') return 'Particular';
  if (normalized === 'pami' || normalized.includes('programa de atencion medica integral')) return 'PAMI';
  if (normalized === 'iosper') return 'IOSPER';
  if (normalized === 'oser') return 'OSER';
  if (normalized === 'sancor' || normalized === 'sancor salud') return 'SANCOR SALUD';
  return source.toUpperCase();
}

export function inferConcept(service, movementType = 'Ingreso') {
  if (movementType === 'Egreso') return 'Otros / Gasto';
  const text = normalizeText(service);
  if (/gasto|envio|cambio/.test(text)) return 'Otros / Gasto';
  if (/oct|paquim|topograf|hrt|yag|campo visual|campim|cvc|estudio/.test(text)) return 'Estudios';
  if (/cirug|catarat|faco|facó|vitrect/.test(text)) return 'Cirugía';
  if (/lente|lio|multifocal/.test(text)) return 'Lentes';
  return 'Consulta';
}

export function normalizeStudy(service) {
  const text = normalizeText(service);
  if (!text) return '';
  const studies = [];
  if (text.includes('oct')) studies.push('OCT');
  if (text.includes('paquim')) studies.push('Paquimetría');
  if (text.includes('topograf')) studies.push('Topografía');
  if (text.includes('hrt')) studies.push('HRT');
  if (text.includes('yag')) studies.push('YAG');
  if (/campo visual|campim|cvc|\bcv\b/.test(text)) studies.push('Campimetría / CV');
  return studies.length ? studies.join(' + ') : String(service ?? '').trim();
}

export function blankTotals() {
  return {
    ARS: { ingresos: 0, egresos: 0, neto: 0, efectivo: 0, transferencias: 0 },
    USD: { ingresos: 0, egresos: 0, neto: 0, efectivo: 0, transferencias: 0 },
    cantidad: 0,
  };
}

export function calculateTotals(movements, { includeVoided = false } = {}) {
  const result = blankTotals();
  for (const movement of movements || []) {
    if (!includeVoided && movement.anulado) continue;
    const currency = movement.moneda === 'USD' ? 'USD' : 'ARS';
    const amount = Math.abs(Number(movement.importe) || 0);
    const isExpense = movement.tipoMovimiento === 'Egreso';
    if (isExpense) result[currency].egresos += amount;
    else result[currency].ingresos += amount;
    if (movement.medioPago === 'Efectivo') {
      result[currency].efectivo += isExpense ? -amount : amount;
    }
    if (movement.medioPago === 'Transferencia') {
      result[currency].transferencias += isExpense ? -amount : amount;
    }
    result.cantidad += 1;
  }
  for (const currency of CURRENCIES) {
    result[currency].neto = result[currency].ingresos - result[currency].egresos;
  }
  return result;
}

export function summarizeByClinic(movements) {
  const cdu = calculateTotals((movements || []).filter((item) => item.clinica === 'CDU'));
  const gua = calculateTotals((movements || []).filter((item) => item.clinica === 'GUA'));
  return { CDU: cdu, GUA: gua, AMBAS: calculateTotals(movements || []) };
}

export function summarizeDaily(movements) {
  const groups = new Map();
  for (const movement of movements || []) {
    if (movement.anulado) continue;
    const key = `${movement.fecha}|${movement.clinica}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(movement);
  }
  return [...groups.entries()]
    .map(([key, items]) => {
      const [fecha, clinica] = key.split('|');
      return { fecha, clinica, ...calculateTotals(items) };
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.clinica.localeCompare(b.clinica));
}

export function summarizeMonthly(movements) {
  const groups = new Map();
  for (const movement of movements || []) {
    if (movement.anulado) continue;
    const key = `${String(movement.fecha).slice(0, 7)}|${movement.clinica}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(movement);
  }
  const branchRows = [...groups.entries()].map(([key, items]) => {
    const [mes, clinica] = key.split('|');
    return { mes, clinica, ...calculateTotals(items) };
  });
  const monthGroups = new Map();
  for (const movement of movements || []) {
    if (movement.anulado) continue;
    const month = String(movement.fecha).slice(0, 7);
    if (!monthGroups.has(month)) monthGroups.set(month, []);
    monthGroups.get(month).push(movement);
  }
  const consolidatedRows = [...monthGroups.entries()].map(([mes, items]) => ({
    mes,
    clinica: 'AMBAS',
    ...calculateTotals(items),
  }));
  return [...branchRows, ...consolidatedRows]
    .sort((a, b) => a.mes.localeCompare(b.mes) || a.clinica.localeCompare(b.clinica));
}

export function percentageChange(current, previous) {
  const currentValue = Number(current) || 0;
  const previousValue = Number(previous) || 0;
  if (previousValue === 0) return null;
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

export function previousPeriodBounds(from, to) {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return null;
  const days = Math.round((end - start) / 86400000) + 1;
  const previousTo = new Date(start);
  previousTo.setUTCDate(previousTo.getUTCDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - days + 1);
  return {
    from: previousFrom.toISOString().slice(0, 10),
    to: previousTo.toISOString().slice(0, 10),
  };
}

export function analyzeHistory(movements, previousMovements = []) {
  const active = (movements || []).filter((item) => !item.anulado);
  const previousActive = (previousMovements || []).filter((item) => !item.anulado);
  const totals = calculateTotals(active);
  const previousTotals = calculateTotals(previousActive);

  const months = new Map();
  for (const movement of active) {
    const month = String(movement.fecha || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(movement);
  }

  const byMonth = [...months.entries()]
    .map(([month, items]) => ({ month, ...calculateTotals(items) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const byConcept = CONCEPTS.map((concept) => ({
    concept,
    ...calculateTotals(active.filter((item) => item.concepto === concept)),
  })).sort((a, b) => b.ARS.ingresos - a.ARS.ingresos || b.USD.ingresos - a.USD.ingresos);

  const byClinic = CLINICS.map((clinic) => ({
    clinic,
    ...calculateTotals(active.filter((item) => item.clinica === clinic)),
  }));

  const topConcept = byConcept.find((item) => item.ARS.ingresos > 0 || item.USD.ingresos > 0) || byConcept[0];
  const bestMonth = byMonth.reduce((best, item) => (
    !best || item.ARS.neto > best.ARS.neto ? item : best
  ), null);
  const leadingClinic = byClinic.reduce((best, item) => (
    !best || item.ARS.ingresos > best.ARS.ingresos ? item : best
  ), null);
  const totalClinicIncome = byClinic.reduce((sum, item) => sum + item.ARS.ingresos, 0);

  return {
    totals,
    previousTotals,
    variations: {
      arsIncome: percentageChange(totals.ARS.ingresos, previousTotals.ARS.ingresos),
      arsNet: percentageChange(totals.ARS.neto, previousTotals.ARS.neto),
      usdIncome: percentageChange(totals.USD.ingresos, previousTotals.USD.ingresos),
      usdNet: percentageChange(totals.USD.neto, previousTotals.USD.neto),
    },
    byMonth,
    byConcept,
    byClinic,
    topConcept,
    bestMonth,
    leadingClinic,
    leadingClinicShare: leadingClinic && totalClinicIncome > 0
      ? (leadingClinic.ARS.ingresos / totalClinicIncome) * 100
      : 0,
    expenseWeight: totals.ARS.ingresos > 0
      ? (totals.ARS.egresos / totals.ARS.ingresos) * 100
      : 0,
  };
}

export function filterMovements(movements, filters = {}) {
  const search = normalizeText(filters.search);
  return (movements || []).filter((movement) => {
    if (!filters.includeVoided && movement.anulado) return false;
    if (filters.from && movement.fecha < filters.from) return false;
    if (filters.to && movement.fecha > filters.to) return false;
    if (filters.clinica && filters.clinica !== 'AMBAS' && movement.clinica !== filters.clinica) return false;
    if (filters.concepto && movement.concepto !== filters.concepto) return false;
    if (filters.coberturaTipo && movement.coberturaTipo !== filters.coberturaTipo) return false;
    if (filters.obraSocial && normalizeText(movement.obraSocial) !== normalizeText(filters.obraSocial)) return false;
    if (filters.medioPago && movement.medioPago !== filters.medioPago) return false;
    if (filters.moneda && movement.moneda !== filters.moneda) return false;
    if (filters.tipoMovimiento && movement.tipoMovimiento !== filters.tipoMovimiento) return false;
    if (search) {
      const haystack = normalizeText([
        movement.pacienteDetalle,
        movement.obraSocial,
        movement.concepto,
        movement.estudio,
        movement.clinica,
        movement.medioPago,
        movement.tipoMovimiento,
        movement.notas,
      ].join(' '));
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

export function validateMovement(input) {
  const errors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.fecha || ''))) errors.fecha = 'Elegí una fecha válida.';
  if (!CLINICS.includes(input.clinica)) errors.clinica = 'La sede no es válida.';
  if (!['Ingreso', 'Egreso'].includes(input.tipoMovimiento)) errors.tipoMovimiento = 'Elegí ingreso o egreso.';
  if (!CONCEPTS.includes(input.concepto)) errors.concepto = 'El concepto no es válido.';
  if (!CURRENCIES.includes(input.moneda)) errors.moneda = 'La moneda no es válida.';
  if (!PAYMENT_METHODS.includes(input.medioPago)) errors.medioPago = 'El medio de pago no es válido.';
  const amount = Number(input.importe);
  if (!Number.isFinite(amount) || amount <= 0) errors.importe = 'El importe debe ser mayor que cero.';
  if (!String(input.pacienteDetalle || '').trim()) errors.pacienteDetalle = 'Indicá el paciente o detalle.';
  if (input.coberturaTipo === 'Obra Social' && !String(input.obraSocial || '').trim()) {
    errors.obraSocial = 'Indicá la obra social.';
  }
  if (input.concepto === 'Estudios' && !String(input.estudio || '').trim()) {
    errors.estudio = 'Indicá el estudio realizado.';
  }
  if (
    input.concepto === 'Cirugía'
    && input.coberturaTipo === 'Obra Social'
    && typeof input.tieneCoseguro !== 'boolean'
  ) {
    errors.tieneCoseguro = 'Indicá si la cirugía tiene coseguro.';
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function buildMovement(input) {
  const movementType = input.tipoMovimiento === 'Egreso' ? 'Egreso' : 'Ingreso';
  const concept = movementType === 'Egreso' ? 'Otros / Gasto' : input.concepto;
  const coverageType = movementType === 'Egreso' ? 'Particular' : input.coberturaTipo;
  return {
    fecha: String(input.fecha || ''),
    fechaKey: dateKey(input.fecha),
    clinica: input.clinica,
    pacienteDetalle: String(input.pacienteDetalle || '').trim(),
    coberturaTipo: coverageType,
    obraSocial: coverageType === 'Obra Social' ? normalizeHealthPlan(input.obraSocial) : '',
    concepto: concept,
    estudio: concept === 'Estudios' ? String(input.estudio || '').trim() : null,
    tieneCoseguro: concept === 'Cirugía' && coverageType === 'Obra Social'
      ? input.tieneCoseguro
      : null,
    medioPago: PAYMENT_METHODS.includes(input.medioPago) ? input.medioPago : 'Efectivo',
    moneda: input.moneda === 'USD' ? 'USD' : 'ARS',
    importe: Math.abs(Number(input.importe) || 0),
    tipoMovimiento: movementType,
    notas: String(input.notas || '').trim(),
    anulado: Boolean(input.anulado),
    source: input.source === 'historico-cdu' ? 'historico-cdu' : 'manual',
  };
}

export function buildStudyMovements(input, studies = []) {
  if (input.tipoMovimiento === 'Egreso' || input.concepto !== 'Estudios') {
    return [buildMovement(input)];
  }
  return studies.map((study) => buildMovement({
    ...input,
    estudio: study.estudio,
    importe: study.importe,
  }));
}

export function expectedCash(movements, initial = { ARS: 0, USD: 0 }) {
  const totals = calculateTotals((movements || []).filter((item) => item.medioPago === 'Efectivo'));
  return {
    ARS: (Number(initial.ARS) || 0) + totals.ARS.neto,
    USD: (Number(initial.USD) || 0) + totals.USD.neto,
  };
}
