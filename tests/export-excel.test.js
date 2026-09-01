import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { createBackupWorkbook } from '../src/export-excel.js';

const movement = {
  fecha: '2026-09-01', clinica: 'CDU', pacienteDetalle: 'Paciente de prueba',
  coberturaTipo: 'Particular', obraSocial: '', concepto: 'Consulta', estudio: null,
  tieneCoseguro: null, medioPago: 'Efectivo', moneda: 'ARS', importe: 60000,
  tipoMovimiento: 'Ingreso', notas: '', anulado: false,
};

describe('respaldo Excel', () => {
  it('genera un xlsx real con hojas, estilos e importes numéricos', async () => {
    const workbook = createBackupWorkbook({ movements: [movement], closures: [] });
    const bytes = await workbook.xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(bytes);
    expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual([
      'MOVIMIENTOS', 'CIERRES', 'RESUMEN_DIARIO', 'RESUMEN_MENSUAL', 'INFO',
    ]);
    const movements = reopened.getWorksheet('MOVIMIENTOS');
    expect(movements.getCell('K2').value).toBe(60000);
    expect(movements.getCell('A1').font.bold).toBe(true);
    expect(movements.autoFilter).toBeTruthy();
    expect(movements.views[0].state).toBe('frozen');
  });
});
