import ExcelJS from 'exceljs';
import { summarizeDaily, summarizeMonthly } from './logic.js';

const movementHeaders = [
  'Fecha', 'Clínica', 'Paciente / Detalle', 'Cobertura', 'Obra Social',
  'Concepto', 'Estudio', 'Coseguro', 'Medio de Pago', 'Moneda', 'Importe',
  'Tipo de Movimiento', 'Estado', 'Observación',
];

function excelDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function timestampDate(value) {
  if (!value) return '';
  if (typeof value.toDate === 'function') return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  return Number(value) || 0;
}

function movementRows(movements) {
  return [...(movements || [])]
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.clinica.localeCompare(b.clinica))
    .map((item) => [
      excelDate(item.fecha), item.clinica, item.pacienteDetalle, item.coberturaTipo,
      item.obraSocial, item.concepto, item.estudio || '',
      typeof item.tieneCoseguro === 'boolean' ? (item.tieneCoseguro ? 'Sí' : 'No') : '',
      item.medioPago, item.moneda, Number(item.importe) || 0, item.tipoMovimiento,
      item.anulado ? 'Anulado' : 'Activo', item.notas,
    ]);
}

function closureRows(closures) {
  return [...(closures || [])]
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.clinica.localeCompare(b.clinica))
    .map((item) => [
      excelDate(item.fecha), item.clinica,
      Number(item.saldoInicialARS) || 0, Number(item.saldoInicialUSD) || 0,
      Number(item.efectivoEsperadoARS) || 0, Number(item.efectivoEsperadoUSD) || 0,
      Number(item.efectivoRealARS) || 0, Number(item.efectivoRealUSD) || 0,
      Number(item.diferenciaARS) || 0, Number(item.diferenciaUSD) || 0,
      optionalNumber(item.transferenciasEsperadasARS), optionalNumber(item.transferenciasEsperadasUSD),
      optionalNumber(item.transferenciasVerificadasARS), optionalNumber(item.transferenciasVerificadasUSD),
      optionalNumber(item.diferenciaTransferenciasARS), optionalNumber(item.diferenciaTransferenciasUSD),
      optionalNumber(item.diferenciaTotalARS), optionalNumber(item.diferenciaTotalUSD),
      timestampDate(item.cerradoAt),
    ]);
}

function summaryRows(rows, periodKey) {
  return rows.map((item) => [
    item[periodKey], item.clinica,
    item.ARS.ingresos, item.ARS.egresos, item.ARS.neto,
    item.ARS.efectivo, item.ARS.transferencias,
    item.USD.ingresos, item.USD.egresos, item.USD.neto,
    item.USD.efectivo, item.USD.transferencias, item.cantidad,
  ]);
}

function addSheet(workbook, name, headers, rows, widths, currencyColumns = [], dateColumns = []) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });
  sheet.addRow(headers);
  sheet.addRows(rows);
  sheet.columns.forEach((column, index) => {
    column.width = widths[index] || 14;
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: 'FF173F3B' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEFEA' } };
  header.alignment = { vertical: 'middle' };
  for (let row = 2; row <= rows.length + 1; row += 1) {
    for (const column of currencyColumns) sheet.getCell(row, column).numFmt = '#,##0.00';
    for (const column of dateColumns) sheet.getCell(row, column).numFmt = 'dd/mm/yyyy';
  }
  return sheet;
}

export function createBackupWorkbook({ movements = [], closures = [], generatedAt = new Date() } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Centro de Ojos Esteves';
  workbook.created = generatedAt;
  workbook.modified = generatedAt;

  addSheet(
    workbook, 'MOVIMIENTOS', movementHeaders, movementRows(movements),
    [12, 10, 32, 18, 24, 18, 22, 12, 18, 10, 15, 20, 12, 32], [11], [1],
  );

  const closureHeaders = [
    'Fecha', 'Clínica', 'Saldo Inicial ARS', 'Saldo Inicial USD',
    'Efectivo Esperado ARS', 'Efectivo Esperado USD',
    'Efectivo Real ARS', 'Efectivo Real USD',
    'Diferencia Efectivo ARS', 'Diferencia Efectivo USD',
    'Transferencias Esperadas ARS', 'Transferencias Esperadas USD',
    'Transferencias Verificadas ARS', 'Transferencias Verificadas USD',
    'Diferencia Transferencias ARS', 'Diferencia Transferencias USD',
    'Diferencia Total ARS', 'Diferencia Total USD', 'Fecha de Cierre',
  ];
  addSheet(
    workbook, 'CIERRES', closureHeaders, closureRows(closures),
    [12, 10, 18, 18, 22, 22, 18, 18, 22, 22, 25, 25, 26, 26, 27, 27, 20, 20, 22],
    [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], [1, 19],
  );

  const summaryHeaders = [
    'Período', 'Clínica', 'Ingresos ARS', 'Egresos ARS', 'Neto ARS',
    'Efectivo ARS', 'Transferencias ARS', 'Ingresos USD', 'Egresos USD',
    'Neto USD', 'Efectivo USD', 'Transferencias USD', 'Movimientos',
  ];
  const summaryWidths = [14, 10, 17, 17, 17, 17, 20, 17, 17, 17, 17, 20, 14];
  addSheet(
    workbook, 'RESUMEN_DIARIO', summaryHeaders,
    summaryRows(summarizeDaily(movements), 'fecha'), summaryWidths,
    [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  addSheet(
    workbook, 'RESUMEN_MENSUAL', summaryHeaders,
    summaryRows(summarizeMonthly(movements), 'mes'), summaryWidths,
    [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );

  const activeMovements = movements.filter((item) => !item.anulado);
  const sortedDates = activeMovements.map((item) => item.fecha).filter(Boolean).sort();
  const info = workbook.addWorksheet('INFO');
  info.columns = [{ width: 24 }, { width: 28 }];
  info.addRows([
    ['Caja Clínicas · Centro de Ojos Esteves', ''],
    ['Fecha de generación', generatedAt],
    ['Movimientos totales', movements.length],
    ['Movimientos activos', activeMovements.length],
    ['Cierres', closures.length],
    ['Período desde', sortedDates[0] || 'Sin datos'],
    ['Período hasta', sortedDates.at(-1) || 'Sin datos'],
    ['Versión', '1.1.0'],
  ]);
  info.mergeCells('A1:B1');
  info.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF173F3B' } };
  info.getCell('A2').font = { bold: true };
  info.getCell('B2').numFmt = 'dd/mm/yyyy hh:mm';
  return workbook;
}

export function backupFileName(date = new Date()) {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  return `Caja_Clinicas_Respaldo_${iso}.xlsx`;
}

export async function downloadBackup(data) {
  const bytes = await createBackupWorkbook(data).xlsx.writeBuffer();
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = backupFileName();
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
