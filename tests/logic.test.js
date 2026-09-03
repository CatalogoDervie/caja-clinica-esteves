import { describe, expect, it } from 'vitest';
import {
  argentinaDate,
  analyzeHistory,
  buildMovement,
  buildStudyMovements,
  calculateTotals,
  expectedCash,
  filterMovements,
  previousPeriodBounds,
  STUDIES,
  inferConcept,
  normalizeStudy,
  validateMovement,
} from '../src/logic.js';

const movement = (overrides = {}) => ({
  fecha: '2026-09-01',
  fechaKey: 20260901,
  clinica: 'CDU',
  pacienteDetalle: 'Paciente de prueba',
  coberturaTipo: 'Particular',
  obraSocial: '',
  concepto: 'Consulta',
  estudio: null,
  tieneCoseguro: null,
  medioPago: 'Efectivo',
  moneda: 'ARS',
  importe: 100,
  tipoMovimiento: 'Ingreso',
  notas: '',
  anulado: false,
  source: 'manual',
  ...overrides,
});

describe('fecha operativa de Argentina', () => {
  it('mantiene el día argentino antes de las 03:00 UTC', () => {
    expect(argentinaDate(new Date('2026-09-02T02:30:00Z'))).toBe('2026-09-01');
  });
});

describe('totales', () => {
  it('separa ARS y USD y descuenta egresos sin mezclar monedas', () => {
    const totals = calculateTotals([
      movement({ importe: 1000 }),
      movement({ importe: 250, tipoMovimiento: 'Egreso' }),
      movement({ moneda: 'USD', importe: 50 }),
      movement({ moneda: 'USD', importe: 10, tipoMovimiento: 'Egreso' }),
    ]);
    expect(totals.ARS.neto).toBe(750);
    expect(totals.USD.neto).toBe(40);
    expect(totals.cantidad).toBe(4);
  });

  it('excluye anulados y no suma transferencias al efectivo', () => {
    const items = [
      movement({ importe: 1000, medioPago: 'Efectivo' }),
      movement({ importe: 500, medioPago: 'Transferencia' }),
      movement({ importe: 700, anulado: true }),
    ];
    expect(calculateTotals(items).ARS.efectivo).toBe(1000);
    expect(expectedCash(items, { ARS: 100, USD: 0 }).ARS).toBe(1100);
  });
});

describe('validaciones del formulario', () => {
  it('reconoce Recuento Endotelial e IOL como estudios disponibles', () => {
    expect(STUDIES).toEqual(expect.arrayContaining(['Recuento Endotelial', 'IOL']));
    expect(inferConcept('Recuento endotelial')).toBe('Estudios');
    expect(inferConcept('IOL')).toBe('Estudios');
    expect(normalizeStudy('Recuento endotelial + IOL')).toBe('Recuento Endotelial + IOL');
  });

  it('exige estudio para Estudios', () => {
    const result = validateMovement(movement({ concepto: 'Estudios', estudio: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.estudio).toBeTruthy();
  });

  it('exige coseguro sí/no en cirugía de obra social', () => {
    const result = validateMovement(movement({
      concepto: 'Cirugía',
      coberturaTipo: 'Obra Social',
      obraSocial: 'PAMI',
      tieneCoseguro: null,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.tieneCoseguro).toBeTruthy();
  });

  it('exige paciente o detalle en movimientos nuevos', () => {
    const result = validateMovement(movement({ pacienteDetalle: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors.pacienteDetalle).toBeTruthy();
  });

  it('construye ARS por defecto y convierte egresos a Otros / Gasto', () => {
    const result = buildMovement({
      fecha: '2026-09-01', clinica: 'GUA', tipoMovimiento: 'Egreso',
      concepto: 'Consulta', medioPago: 'Efectivo', importe: 50,
    });
    expect(result.moneda).toBe('ARS');
    expect(result.concepto).toBe('Otros / Gasto');
    expect(result.importe).toBe(50);
  });

  it('construye varios estudios con su propio importe sin alterar el formato del movimiento', () => {
    const result = buildStudyMovements(movement({ concepto: 'Estudios' }), [
      { estudio: 'OCT', importe: 120000 },
      { estudio: 'Campimetría / CV', importe: 80000 },
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((item) => [item.estudio, item.importe])).toEqual([
      ['OCT', 120000],
      ['Campimetría / CV', 80000],
    ]);
    expect(calculateTotals(result).ARS.ingresos).toBe(200000);
  });
});

describe('historial', () => {
  it('combina filtros sin perder separación por sede', () => {
    const items = [movement(), movement({ clinica: 'GUA', pacienteDetalle: 'Otro paciente' })];
    expect(filterMovements(items, { clinica: 'GUA', search: 'otro' })).toHaveLength(1);
  });

  it('busca personas y tipos de movimiento en toda la historia', () => {
    const items = [
      movement({ pacienteDetalle: 'María González', concepto: 'Cirugía', medioPago: 'Transferencia' }),
      movement({ pacienteDetalle: 'Pedro López', concepto: 'Lentes' }),
    ];
    expect(filterMovements(items, { search: 'gonzalez' })).toHaveLength(1);
    expect(filterMovements(items, { search: 'cirugia' })).toHaveLength(1);
    expect(filterMovements(items, { search: 'lente' })).toHaveLength(1);
    expect(filterMovements(items, { search: 'transferencia' })).toHaveLength(1);
  });

  it('calcula el período anterior con la misma cantidad de días', () => {
    expect(previousPeriodBounds('2026-08-01', '2026-08-31')).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });

  it('resume tendencias, conceptos y sedes sin exponer pacientes', () => {
    const items = [
      movement({ fecha: '2026-08-01', concepto: 'Consulta', importe: 1000 }),
      movement({ fecha: '2026-08-15', clinica: 'GUA', concepto: 'Estudios', importe: 600 }),
      movement({ fecha: '2026-09-01', concepto: 'Consulta', importe: 200 }),
      movement({ fecha: '2026-09-01', concepto: 'Otros / Gasto', tipoMovimiento: 'Egreso', importe: 100 }),
    ];
    const analysis = analyzeHistory(items, [movement({ fecha: '2026-07-01', importe: 800 })]);
    expect(analysis.totals.ARS.neto).toBe(1700);
    expect(analysis.byMonth).toHaveLength(2);
    expect(analysis.topConcept.concept).toBe('Consulta');
    expect(analysis.leadingClinic.clinic).toBe('CDU');
    expect(analysis).not.toHaveProperty('pacienteDetalle');
  });
});
