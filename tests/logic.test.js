import { describe, expect, it } from 'vitest';
import {
  argentinaDate,
  buildMovement,
  calculateTotals,
  expectedCash,
  filterMovements,
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
});

describe('historial', () => {
  it('combina filtros sin perder separación por sede', () => {
    const items = [movement(), movement({ clinica: 'GUA', pacienteDetalle: 'Otro paciente' })];
    expect(filterMovements(items, { clinica: 'GUA', search: 'otro' })).toHaveLength(1);
  });
});
