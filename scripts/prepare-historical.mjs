import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { validateHistoricalMovements } from '../src/historical.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const sourcePath = path.resolve(
  process.argv[2]
    || path.join(projectDirectory, '..', 'reconstructed', 'Caja_Clinicas_CDU_Gualeguaychu_v2.html'),
);
const outputDirectory = path.join(projectDirectory, 'private-data');
const outputPath = path.join(outputDirectory, 'historico-cdu.preparado.json');
const reportPath = path.join(outputDirectory, 'historico-cdu.reporte.json');

if (!fs.existsSync(sourcePath)) {
  throw new Error(`No se encontró el HTML histórico en: ${sourcePath}`);
}

const html = fs.readFileSync(sourcePath, 'utf8');
const marker = 'const SEED_MOVEMENTS=';
const start = html.indexOf(marker);
if (start === -1) throw new Error('No se encontró SEED_MOVEMENTS en el HTML.');
const arrayStart = start + marker.length;
const arrayEnd = html.indexOf('];', arrayStart);
if (arrayEnd === -1) throw new Error('No se pudo delimitar SEED_MOVEMENTS.');

const sourceMovements = JSON.parse(html.slice(arrayStart, arrayEnd + 1));
const report = validateHistoricalMovements(sourceMovements);
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({ movements: report.movements }, null, 2)}\n`, 'utf8');
fs.writeFileSync(reportPath, `${JSON.stringify({
  source: path.basename(sourcePath),
  sourceCount: report.sourceCount,
  validCount: report.validCount,
  rejectedCount: report.rejectedCount,
  exceptions: report.exceptions,
}, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  source: sourcePath,
  output: outputPath,
  report: reportPath,
  sourceCount: report.sourceCount,
  validCount: report.validCount,
  rejectedCount: report.rejectedCount,
}, null, 2));

