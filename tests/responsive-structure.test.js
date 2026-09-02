import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

describe('estructura responsive y separación de roles', () => {
  it('incluye viewport móvil y navegación específica para celular', () => {
    expect(html).toContain('name="viewport"');
    expect(html).toContain('id="mobileNav"');
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.desktop-data \{ display: none; \}/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.mobile-data \{ display: grid;/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.mobile-nav \{/);
  });

  it('adapta formularios, resúmenes y cierres a una columna', () => {
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.form-grid \{ grid-template-columns: 1fr; \}/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.summary-columns, \.backup-grid \{ grid-template-columns: 1fr; \}/);
    expect(css).toMatch(/@media \(max-width: 430px\)[\s\S]*\.history-filters, \.closure-grid \{ grid-template-columns: 1fr; \}/);
  });

  it('oculta todas las vistas de supervisor en modo administrativo', () => {
    expect(css).toContain('.admin-mode .doctor-only { display: none !important; }');
    for (const id of ['monthSection', 'historySection', 'backupSection']) {
      expect(html).toMatch(new RegExp(`id="${id}"[^>]*doctor-only`));
    }
  });

  it('mantiene ARS predeterminado y USD como opción manual', () => {
    expect(html).toContain('id="movementUsd" type="checkbox"');
    expect(html).toContain('Destildado = pesos argentinos');
  });

  it('presenta el historial como análisis y relega pacientes al detalle secundario', () => {
    expect(html).toContain('id="historyNarrativeTitle"');
    expect(html).toContain('id="historyNetTrend"');
    expect(html).toContain('id="historyConceptComposition"');
    expect(html).toContain('id="historyClinicComparison"');
    expect(html).toContain('id="historyConceptTrend"');
    expect(html).toMatch(/<details class="panel history-detail-panel">[\s\S]*id="historyTable"/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.history-story-grid \{ grid-template-columns: 1fr; \}/);
  });
});
