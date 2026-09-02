import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { convertHistoricalMovement, validateHistoricalMovements } from '../src/historical.js';

describe('migración histórica', () => {
  it('normaliza sede, moneda, cobertura y estudio sin inventar otra sede', () => {
    const result = convertHistoricalMovement({
      date: '2026-01-15', patient: 'Paciente de prueba', coverage: 'P.A.M.I.',
      chargeType: 'Coseguro', service: 'OCT+CVC', type: 'ingreso',
      amount: 62120, payment: 'Efectivo', notes: '', currency: 'ARS',
    }, 0);
    expect(result.id).toBe('historico-cdu-0001');
    expect(result.clinica).toBe('CDU');
    expect(result.moneda).toBe('ARS');
    expect(result.obraSocial).toBe('PAMI');
    expect(result.estudio).toContain('OCT');
    expect(result.estudio).toContain('Campimetría / CV');
  });

  it('reporta fechas o importes inválidos en lugar de inventarlos', () => {
    const report = validateHistoricalMovements([
      { date: 'fecha mala', amount: 100 },
      { date: '2026-01-01', amount: -1 },
    ]);
    expect(report.validCount).toBe(0);
    expect(report.rejectedCount).toBe(2);
  });

  it('acepta el archivo ya preparado sin convertirlo por segunda vez', () => {
    const prepared = convertHistoricalMovement({
      id: 'historico-cdu-0506',
      fecha: '2026-08-21',
      clinica: 'CDU',
      pacienteDetalle: 'Paciente de prueba',
      coberturaTipo: 'Particular',
      obraSocial: '',
      concepto: 'Consulta',
      estudio: null,
      tieneCoseguro: null,
      medioPago: 'Efectivo',
      moneda: 'ARS',
      importe: 60000,
      tipoMovimiento: 'Ingreso',
      notas: '',
      anulado: false,
      source: 'historico-cdu',
    });
    const report = validateHistoricalMovements([prepared]);
    expect(report.validCount).toBe(1);
    expect(report.movements[0].id).toBe('historico-cdu-0506');
  });

  it('verifica el histórico recuperado cuando está disponible localmente', () => {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const privateFile = path.join(projectRoot, 'private-data', 'historico-cdu.preparado.json');
    if (!fs.existsSync(privateFile)) return;
    const data = JSON.parse(fs.readFileSync(privateFile, 'utf8'));
    expect(data.movements).toHaveLength(506);
    expect(new Set(data.movements.map((item) => item.id)).size).toBe(506);
    expect(data.movements.every((item) => item.clinica === 'CDU')).toBe(true);
  });
});
