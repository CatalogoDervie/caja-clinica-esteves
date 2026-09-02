import './styles.css';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  analyzeHistory,
  argentinaDate,
  argentinaMonth,
  buildMovement,
  buildStudyMovements,
  calculateTotals,
  CONCEPTS,
  expectedCash,
  filterMovements,
  formatDate,
  formatMoney,
  previousPeriodBounds,
  summarizeByClinic,
  summarizeDaily,
  validateMovement,
} from './logic.js';
import {
  closeCash,
  defaultHistoryBounds,
  deleteManualTestData,
  fetchAllForBackup,
  fetchPeriod,
  friendlyFirebaseError,
  importHistoricalMovements,
  loadCatalogs,
  loadProfile,
  monthBounds,
  reopenCash,
  saveMovements,
  subscribeClosure,
  subscribeDay,
  verifyHistoricalMovements,
  voidMovement,
} from './data-service.js';
import {
  auth,
  configureAuthPersistence,
  firebaseReady,
  usingFirebaseEmulators,
} from './firebase.js';
import { validateHistoricalMovements } from './historical.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  profile: null,
  catalogs: null,
  currentView: 'today',
  dayDate: argentinaDate(),
  dayScope: 'AMBAS',
  dayMovements: [],
  dayFromCache: false,
  closure: null,
  monthMovements: [],
  historySource: [],
  historyPrevious: [],
  historyResults: [],
  detailsSource: [],
  detailsResults: [],
  selectedHistorical: null,
  unsubDay: null,
  unsubClosure: null,
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character]);
}

function showOnly(view) {
  $('#loadingView').hidden = view !== 'loading';
  $('#setupView').hidden = view !== 'setup';
  $('#loginView').hidden = view !== 'login';
  $('#appView').hidden = view !== 'app';
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => element.classList.remove('show'), 2600);
}

function setBusy(button, busy, busyLabel = 'Procesando…') {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyLabel : button.dataset.label;
}

function clinicLabel(clinic) {
  if (clinic === 'CDU') return 'Concepción del Uruguay';
  if (clinic === 'GUA') return 'Gualeguaychú';
  return 'Ambas sedes';
}

function offsetIsoDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function adminReviewBounds() {
  const max = argentinaDate();
  return { min: offsetIsoDate(max, -7), max };
}

function isAdminReadOnlyDay() {
  return state.profile?.role === 'administrativo' && state.dayDate !== argentinaDate();
}

function canOperateSelectedDay() {
  return state.profile?.role === 'medico' || !isAdminReadOnlyDay();
}

function switchView(view) {
  if (state.profile?.role !== 'medico' && view !== 'today') return;
  state.currentView = view;
  $$('.view-section').forEach((section) => section.classList.toggle('active', section.dataset.section === view));
  $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'month') loadMonth();
  if (view === 'history' && !state.historySource.length) loadHistory();
  if (view === 'details' && !state.detailsSource.length) loadDetails();
}

function currencyPanel(currency, totals) {
  const label = currency === 'ARS' ? 'Pesos argentinos' : 'Dólares';
  return `
    <article class="currency-panel ${currency.toLowerCase()}">
      <div class="currency-title"><h2>${currency}</h2><span>${label}</span></div>
      <div class="metric-row">
        <div class="metric-cell net-highlight"><span>Neto</span><strong class="${totals.neto < 0 ? 'negative' : ''}">${formatMoney(totals.neto, currency)}</strong></div>
        <div class="metric-cell"><span>Ingresos</span><strong class="positive">${formatMoney(totals.ingresos, currency)}</strong></div>
        <div class="metric-cell"><span>Egresos</span><strong class="negative">${formatMoney(totals.egresos, currency)}</strong></div>
        <div class="metric-cell"><span>Efectivo</span><strong>${formatMoney(totals.efectivo, currency)}</strong></div>
        <div class="metric-cell"><span>Transferencias</span><strong>${formatMoney(totals.transferencias, currency)}</strong></div>
      </div>
    </article>`;
}

function renderMetricPanels(target, movements) {
  const totals = calculateTotals(movements);
  target.innerHTML = currencyPanel('ARS', totals.ARS) + currencyPanel('USD', totals.USD);
  return totals;
}

function movementTitle(movement) {
  return movement.pacienteDetalle || movement.estudio || movement.concepto || 'Sin detalle';
}

function movementTable(movements, { actions = false, includeDate = false } = {}) {
  if (!movements.length) return '<div class="empty-state">No hay movimientos para mostrar.</div>';
  const headers = [
    includeDate ? '<th>Fecha</th>' : '',
    '<th>Sede</th>', '<th>Paciente / detalle</th>', '<th>Concepto</th>',
    '<th>Cobertura</th>', '<th>Medio</th>', '<th>Moneda</th>', '<th>Importe</th>',
    actions ? '<th>Acciones</th>' : '',
  ].join('');
  const rows = movements.map((movement) => {
    const status = movement.anulado ? '<span class="badge danger">Anulado</span>' : '';
    const amountClass = movement.tipoMovimiento === 'Egreso' ? 'negative' : 'positive';
    const amountPrefix = movement.tipoMovimiento === 'Egreso' ? '− ' : '';
    const showActions = typeof actions === 'function' ? actions(movement) : actions;
    const actionButtons = showActions && !movement.anulado
      ? `<td><div class="row-actions"><button class="tiny-button" type="button" data-action="edit" data-id="${escapeHtml(movement.id)}">Editar</button><button class="tiny-button danger" type="button" data-action="delete" data-id="${escapeHtml(movement.id)}">Eliminar</button></div></td>`
      : actions ? '<td></td>' : '';
    return `<tr class="${movement.anulado ? 'voided' : ''}">
      ${includeDate ? `<td>${formatDate(movement.fecha)}</td>` : ''}
      <td><span class="badge">${escapeHtml(movement.clinica)}</span></td>
      <td><strong>${escapeHtml(movementTitle(movement))}</strong>${movement.notas ? `<span class="subcopy">${escapeHtml(movement.notas)}</span>` : ''}</td>
      <td>${escapeHtml(movement.concepto)}${movement.estudio ? `<span class="subcopy">${escapeHtml(movement.estudio)}</span>` : ''}</td>
      <td>${escapeHtml(movement.coberturaTipo)}${movement.obraSocial ? `<span class="subcopy">${escapeHtml(movement.obraSocial)}</span>` : ''}${status}</td>
      <td>${escapeHtml(movement.medioPago)}</td>
      <td><span class="badge ${movement.moneda === 'USD' ? 'warning' : ''}">${escapeHtml(movement.moneda)}</span></td>
      <td class="money ${amountClass}">${amountPrefix}${formatMoney(movement.importe, movement.moneda)}</td>
      ${actionButtons}
    </tr>`;
  }).join('');
  return `<div class="data-table-wrap"><table class="data-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function movementCards(movements, { actions = false, includeDate = false } = {}) {
  if (!movements.length) return '<div class="empty-state">No hay movimientos para mostrar.</div>';
  return movements.map((movement) => {
    const amountPrefix = movement.tipoMovimiento === 'Egreso' ? '− ' : '';
    const showActions = typeof actions === 'function' ? actions(movement) : actions;
    const actionButtons = showActions && !movement.anulado
      ? `<div class="row-actions"><button class="tiny-button" type="button" data-action="edit" data-id="${escapeHtml(movement.id)}">Editar</button><button class="tiny-button danger" type="button" data-action="delete" data-id="${escapeHtml(movement.id)}">Eliminar</button></div>`
      : '';
    return `<article class="movement-card ${movement.anulado ? 'voided' : ''}">
      <div class="movement-card-head"><div><h3>${escapeHtml(movementTitle(movement))}</h3><span class="subcopy">${includeDate ? `${formatDate(movement.fecha)} · ` : ''}${escapeHtml(movement.concepto)}${movement.estudio ? ` · ${escapeHtml(movement.estudio)}` : ''}</span></div><span class="badge">${escapeHtml(movement.clinica)}</span></div>
      <div class="movement-card-meta"><span class="badge">${escapeHtml(movement.coberturaTipo)}</span>${movement.obraSocial ? `<span class="badge">${escapeHtml(movement.obraSocial)}</span>` : ''}<span class="badge">${escapeHtml(movement.medioPago)}</span>${movement.anulado ? '<span class="badge danger">Anulado</span>' : ''}</div>
      <div class="movement-card-footer"><strong class="money">${amountPrefix}${formatMoney(movement.importe, movement.moneda)}</strong>${actionButtons}</div>
    </article>`;
  }).join('');
}

function visibleDayMovements() {
  const search = $('#daySearch').value;
  return filterMovements(state.dayMovements, { search })
    .sort((a, b) => String(b.createdAt?.seconds || '').localeCompare(String(a.createdAt?.seconds || '')));
}

function canManageMovement(movement) {
  if (!movement || movement.anulado || movement.source !== 'manual' || !canOperateSelectedDay()) return false;
  if (state.closure && state.dayScope !== 'AMBAS') return false;
  if (state.profile.role === 'medico') return true;
  return movement.fecha === argentinaDate()
    && movement.clinica === state.profile.clinica;
}

function renderToday() {
  const visible = visibleDayMovements();
  const active = state.dayMovements.filter((item) => !item.anulado);
  const readOnly = isAdminReadOnlyDay();

  $('#todayTitle').textContent = `Caja ${state.dayScope === 'AMBAS' ? 'de ambas sedes' : clinicLabel(state.dayScope)}`;
  $('#todaySubtitle').textContent = `${formatDate(state.dayDate)} · ${active.length} movimientos activos${readOnly ? ' · Solo consulta' : ''}`;
  $('#movementCount').textContent = `${visible.length} mostrados`;
  $('#newMovementButton').hidden = readOnly;
  $('#newMovementButton').disabled = readOnly;

  renderMetricPanels($('#todayMetrics'), active);

  const showActionColumn = canOperateSelectedDay();
  $('#todayTable').innerHTML = movementTable(visible, { actions: showActionColumn ? canManageMovement : false });
  $('#todayCards').innerHTML = movementCards(visible, { actions: showActionColumn ? canManageMovement : false });
  renderClosure();
}

function renderClosure() {
  const body = $('#closureBody');
  if (state.dayScope === 'AMBAS') {
    $('#closureBadge').textContent = 'Por sede';
    $('#closureBadge').className = 'badge';
    body.innerHTML = '<div class="closure-content"><p class="muted">Elegí CDU o Gualeguaychú para controlar el efectivo y realizar el cierre.</p></div>';
    return;
  }
  if (state.closure) {
    const closure = state.closure;
    const balanced = Math.abs(closure.diferenciaARS) < 0.01 && Math.abs(closure.diferenciaUSD) < 0.01;
    $('#closureBadge').textContent = 'Cerrada';
    $('#closureBadge').className = 'badge';
    body.innerHTML = `<div class="closure-content">
      <div class="summary-line"><span>Efectivo esperado ARS</span><strong>${formatMoney(closure.efectivoEsperadoARS, 'ARS')}</strong></div>
      <div class="summary-line"><span>Efectivo real ARS</span><strong>${formatMoney(closure.efectivoRealARS, 'ARS')}</strong></div>
      <div class="summary-line"><span>Efectivo esperado USD</span><strong>${formatMoney(closure.efectivoEsperadoUSD, 'USD')}</strong></div>
      <div class="summary-line"><span>Efectivo real USD</span><strong>${formatMoney(closure.efectivoRealUSD, 'USD')}</strong></div>
      <div class="difference-box ${balanced ? 'good' : 'bad'}">Diferencia ARS: ${formatMoney(closure.diferenciaARS, 'ARS')}<br>Diferencia USD: ${formatMoney(closure.diferenciaUSD, 'USD')}</div>
      ${state.profile.role === 'medico' ? '<button id="reopenButton" class="button secondary" type="button">Reabrir caja</button>' : ''}
    </div>`;
    $('#reopenButton')?.addEventListener('click', reopenSelectedCash);
    return;
  }
  if (isAdminReadOnlyDay()) {
    $('#closureBadge').textContent = 'Consulta';
    $('#closureBadge').className = 'badge';
    body.innerHTML = '<div class="closure-content"><p class="muted">No hay cierre registrado para este día. La fecha está disponible solo para revisión.</p></div>';
    return;
  }
  $('#closureBadge').textContent = 'Abierta';
  $('#closureBadge').className = 'badge success';
  body.innerHTML = `<div class="closure-content">
    <div class="closure-grid">
      <label class="field"><span>Saldo inicial ARS</span><input id="initialARS" type="number" min="0" step="0.01" value="0" /></label>
      <label class="field"><span>Saldo inicial USD</span><input id="initialUSD" type="number" min="0" step="0.01" value="0" /></label>
    </div>
    <div class="summary-line"><span>Esperado ARS</span><strong id="expectedARS">—</strong></div>
    <div class="summary-line"><span>Esperado USD</span><strong id="expectedUSD">—</strong></div>
    <div class="closure-grid">
      <label class="field"><span>Efectivo real ARS</span><input id="actualARS" type="number" min="0" step="0.01" /></label>
      <label class="field"><span>Efectivo real USD</span><input id="actualUSD" type="number" min="0" step="0.01" value="0" /></label>
    </div>
    <button id="closeCashButton" class="button primary full" type="button">Cerrar caja</button>
    <p class="muted">Las transferencias no forman parte del efectivo físico.</p>
  </div>`;
  const updateExpected = () => {
    const expected = expectedCash(state.dayMovements, {
      ARS: Number($('#initialARS').value) || 0,
      USD: Number($('#initialUSD').value) || 0,
    });
    $('#expectedARS').textContent = formatMoney(expected.ARS, 'ARS');
    $('#expectedUSD').textContent = formatMoney(expected.USD, 'USD');
  };
  $('#initialARS').addEventListener('input', updateExpected);
  $('#initialUSD').addEventListener('input', updateExpected);
  $('#closeCashButton').addEventListener('click', closeSelectedCash);
  updateExpected();
}

async function closeSelectedCash() {
  if (!canOperateSelectedDay()) {
    toast('Los días anteriores están disponibles solo para consulta.');
    return;
  }
  if ($('#actualARS').value === '' || $('#actualUSD').value === '') {
    toast('Completá el efectivo real en ARS y USD.');
    return;
  }
  const initial = { ARS: Number($('#initialARS').value) || 0, USD: Number($('#initialUSD').value) || 0 };
  const expected = expectedCash(state.dayMovements, initial);
  const actual = { ARS: Number($('#actualARS').value) || 0, USD: Number($('#actualUSD').value) || 0 };
  const button = $('#closeCashButton');
  setBusy(button, true, 'Cerrando…');
  try {
    await closeCash({
      fecha: state.dayDate,
      fechaKey: Number(state.dayDate.replaceAll('-', '')),
      clinica: state.dayScope,
      saldoInicialARS: initial.ARS,
      saldoInicialUSD: initial.USD,
      efectivoEsperadoARS: expected.ARS,
      efectivoEsperadoUSD: expected.USD,
      efectivoRealARS: actual.ARS,
      efectivoRealUSD: actual.USD,
      diferenciaARS: actual.ARS - expected.ARS,
      diferenciaUSD: actual.USD - expected.USD,
    });
    toast('Caja cerrada correctamente.');
  } catch (error) {
    toast(friendlyFirebaseError(error));
  } finally {
    setBusy(button, false);
  }
}

async function reopenSelectedCash() {
  const accepted = await confirmAction('Reabrir caja', 'La caja volverá a permitir correcciones y anulaciones.');
  if (!accepted) return;
  try {
    await reopenCash(state.closure.id);
    toast('Caja reabierta.');
  } catch (error) {
    toast(friendlyFirebaseError(error));
  }
}

function startDaySubscriptions() {
  state.unsubDay?.();
  state.unsubClosure?.();
  state.dayMovements = [];
  state.closure = null;
  renderToday();
  state.unsubDay = subscribeDay(
    state.profile,
    state.dayDate,
    state.dayScope,
    (movements, metadata) => {
      state.dayMovements = movements;
      state.dayFromCache = metadata.fromCache;
      $('#syncStatus').textContent = metadata.fromCache ? 'Datos locales' : 'Actualizado';
      renderToday();
    },
    (error) => toast(friendlyFirebaseError(error)),
  );
  state.unsubClosure = subscribeClosure(
    state.profile,
    state.dayDate,
    state.dayScope,
    (closure) => {
      state.closure = closure;
      renderClosure();
    },
    (error) => toast(friendlyFirebaseError(error)),
  );
}

function summaryList(rows) {
  if (!rows.length) return '<div class="empty-state">Sin datos para este período.</div>';
  return `<div class="summary-list">${rows.map((row) => `<div class="summary-item"><div><strong>${escapeHtml(row.label)}</strong><span class="subcopy">${row.count} movimientos</span></div><div class="values"><strong>${formatMoney(row.ars, 'ARS')}</strong><span class="subcopy">${formatMoney(row.usd, 'USD')}</span></div></div>`).join('')}</div>`;
}

function renderMonthDayHistory() {
  const selectedDate = $('#monthDayFilter').value;
  const metrics = $('#monthDayMetrics');

  if (selectedDate) {
    const movements = state.monthMovements.filter((item) => item.fecha === selectedDate);
    metrics.hidden = false;
    renderMetricPanels(metrics, movements);
    $('#monthDayTitle').textContent = `Movimientos del ${formatDate(selectedDate)} (${movements.length})`;
    $('#monthDays').innerHTML = movementTable(movements);
    $('#monthDayCards').innerHTML = movementCards(movements);
    return;
  }

  metrics.hidden = true;
  metrics.innerHTML = '';
  $('#monthDayTitle').textContent = 'Resumen de todos los días';
  const daily = summarizeDaily(state.monthMovements).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const tableRows = daily.map((row) => ({
    id: `${row.fecha}-${row.clinica}`,
    fecha: row.fecha,
    clinica: row.clinica,
    pacienteDetalle: `${row.cantidad} movimientos`,
    concepto: 'Resumen diario',
    coberturaTipo: '', obraSocial: '', estudio: '', medioPago: '', moneda: 'ARS',
    importe: row.ARS.neto,
    tipoMovimiento: row.ARS.neto < 0 ? 'Egreso' : 'Ingreso',
    notas: `USD neto ${formatMoney(row.USD.neto, 'USD')}`,
    anulado: false,
  }));
  $('#monthDays').innerHTML = movementTable(tableRows, { includeDate: true });
  $('#monthDayCards').innerHTML = movementCards(tableRows, { includeDate: true });
}

function renderMonth() {
  renderMetricPanels($('#monthMetrics'), state.monthMovements);
  const summaries = summarizeByClinic(state.monthMovements);
  const monthScope = $('#monthScope').value || 'AMBAS';
  const clinics = monthScope === 'AMBAS' ? ['CDU', 'GUA', 'AMBAS'] : [monthScope];
  $('#monthByClinic').innerHTML = summaryList(clinics.map((clinic) => ({
    label: clinicLabel(clinic),
    count: summaries[clinic].cantidad,
    ars: summaries[clinic].ARS.neto,
    usd: summaries[clinic].USD.neto,
  })));
  $('#monthByConcept').innerHTML = summaryList(CONCEPTS.map((concept) => {
    const items = state.monthMovements.filter((item) => item.concepto === concept && !item.anulado);
    const total = calculateTotals(items);
    return { label: concept, count: total.cantidad, ars: total.ARS.neto, usd: total.USD.neto };
  }));
  const currentSelection = $('#monthDayFilter').value;
  const dates = [...new Set(state.monthMovements.map((item) => item.fecha).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
  $('#monthDayFilter').innerHTML = '<option value="">Todos los días</option>'
    + dates.map((date) => `<option value="${date}">${formatDate(date)}</option>`).join('');
  $('#monthDayFilter').value = dates.includes(currentSelection) ? currentSelection : '';
  renderMonthDayHistory();
}

async function loadMonth() {
  const month = $('#monthDate').value || argentinaMonth();
  const scope = $('#monthScope').value || 'AMBAS';
  const { from, to } = monthBounds(month);
  $('#monthMetrics').innerHTML = '<div class="empty-state">Calculando resumen…</div>';
  try {
    state.monthMovements = await fetchPeriod(state.profile, from, to, scope);
    renderMonth();
  } catch (error) {
    toast(friendlyFirebaseError(error));
    $('#monthMetrics').innerHTML = '<div class="empty-state">No se pudo cargar el resumen.</div>';
  }
}

function historyFilters() {
  return {
    from: $('#historyFrom').value,
    to: $('#historyTo').value,
    clinica: $('#historyClinic').value,
  };
}

function detailsFilters() {
  return {
    from: $('#detailsFrom').value,
    to: $('#detailsTo').value,
    clinica: $('#detailsClinic').value,
    concepto: $('#detailsConcept').value,
    coberturaTipo: $('#detailsCoverage').value,
    obraSocial: $('#detailsPlan').value,
    medioPago: $('#detailsPayment').value,
    moneda: $('#detailsCurrency').value,
    tipoMovimiento: $('#detailsType').value,
    includeVoided: $('#detailsVoided').checked,
  };
}

function historyPeriodLabel(from, to) {
  if (from === '2000-01-01') return `Toda la historia hasta ${formatDate(to)}`;
  return `${formatDate(from)} al ${formatDate(to)}`;
}

function monthLabel(month) {
  const [year, monthNumber] = String(month).split('-').map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)))
    .replace('.', '');
}

function compactAmount(value, currency = 'ARS') {
  return new Intl.NumberFormat('es-AR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(value) || 0) + (currency === 'USD' ? ' USD' : '');
}

function variationValue(current, previous) {
  const currentValue = Number(current) || 0;
  const previousValue = Number(previous) || 0;
  if (previousValue === 0) return null;
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

function variationMarkup(current, previous, inverse = false) {
  const variation = variationValue(current, previous);
  if (variation === null) return '<span class="kpi-change neutral">Sin base comparable</span>';
  const improving = inverse ? variation <= 0 : variation >= 0;
  const arrow = variation > 0 ? '↑' : variation < 0 ? '↓' : '→';
  return `<span class="kpi-change ${improving ? 'good' : 'bad'}">${arrow} ${Math.abs(variation).toFixed(1)}% vs. período anterior</span>`;
}

function renderHistoryKpis(analysis) {
  const rows = [
    ['Ingresos ARS', analysis.totals.ARS.ingresos, 'ARS', analysis.previousTotals.ARS.ingresos, false],
    ['Egresos ARS', analysis.totals.ARS.egresos, 'ARS', analysis.previousTotals.ARS.egresos, true],
    ['Neto ARS', analysis.totals.ARS.neto, 'ARS', analysis.previousTotals.ARS.neto, false, true],
    ['Ingresos USD', analysis.totals.USD.ingresos, 'USD', analysis.previousTotals.USD.ingresos, false],
    ['Neto USD', analysis.totals.USD.neto, 'USD', analysis.previousTotals.USD.neto, false, true],
  ];
  $('#historyKpis').innerHTML = rows.map(([label, value, currency, previous, inverse, featured]) => `
    <article class="history-kpi ${featured ? 'featured' : ''}">
      <span>${label}</span>
      <strong class="${value < 0 ? 'negative' : ''}">${formatMoney(value, currency)}</strong>
      ${variationMarkup(value, previous, inverse)}
    </article>`).join('');
}

function verticalBarChart(rows, currency = 'ARS') {
  if (!rows.length) return '<div class="chart-empty">No hay datos para graficar.</div>';
  const width = Math.max(720, rows.length * 78 + 80);
  const height = 270;
  const left = 42;
  const right = 24;
  const top = 34;
  const bottom = 58;
  const plotHeight = height - top - bottom;
  const values = rows.map((row) => Number(row.value) || 0);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const y = (value) => top + ((max - value) / span) * plotHeight;
  const zeroY = y(0);
  const slot = (width - left - right) / rows.length;
  const barWidth = Math.min(44, slot * 0.58);
  const bars = rows.map((row, index) => {
    const value = Number(row.value) || 0;
    const valueY = y(value);
    const rectY = Math.min(valueY, zeroY);
    const rectHeight = Math.max(2, Math.abs(zeroY - valueY));
    const x = left + slot * index + (slot - barWidth) / 2;
    const fill = value < 0 ? 'var(--danger)' : row.highlight ? 'var(--brand)' : '#b8c2d0';
    const labelY = value >= 0 ? Math.max(18, rectY - 8) : Math.min(height - bottom + 18, rectY + rectHeight + 16);
    return `<g><rect x="${x}" y="${rectY}" width="${barWidth}" height="${rectHeight}" rx="7" fill="${fill}" />
      <text x="${x + barWidth / 2}" y="${labelY}" text-anchor="middle" class="chart-value">${escapeHtml(compactAmount(value, currency))}</text>
      <text x="${x + barWidth / 2}" y="${height - 22}" text-anchor="middle" class="chart-label">${escapeHtml(row.label)}</text></g>`;
  }).join('');
  return `<div class="svg-scroll"><svg class="story-chart" viewBox="0 0 ${width} ${height}" style="min-width:${width}px" role="img" aria-label="${escapeHtml(rows.map((row) => `${row.label}: ${formatMoney(row.value, currency)}`).join(', '))}">
    <line x1="${left}" x2="${width - right}" y1="${zeroY}" y2="${zeroY}" class="chart-axis" />${bars}</svg></div>`;
}

function horizontalBarChart(rows, currency = 'ARS') {
  if (!rows.length || rows.every((row) => !Number(row.value))) {
    return '<div class="chart-empty">No hay ingresos para esta selección.</div>';
  }
  const max = Math.max(...rows.map((row) => Math.abs(Number(row.value) || 0)), 1);
  return `<div class="horizontal-bars">${rows.map((row, index) => {
    const value = Number(row.value) || 0;
    const width = Math.max(value ? 4 : 0, (Math.abs(value) / max) * 100);
    return `<div class="horizontal-bar-row">
      <div class="horizontal-bar-label"><span>${escapeHtml(row.label)}</span><strong>${formatMoney(value, currency)}</strong></div>
      <div class="horizontal-bar-track"><span style="width:${width}%;background:${value < 0 ? 'var(--danger)' : index === 0 ? 'var(--brand)' : '#aeb9c8'}"></span></div>
    </div>`;
  }).join('')}</div>`;
}

function lineChart(rows, currency = 'ARS') {
  if (!rows.length) return '<div class="chart-empty">No hay datos para graficar.</div>';
  const width = Math.max(720, rows.length * 78 + 80);
  const height = 270;
  const left = 48;
  const right = 28;
  const top = 36;
  const bottom = 58;
  const values = rows.map((row) => Number(row.value) || 0);
  const rawMax = Math.max(...values, 0);
  const rawMin = Math.min(...values, 0);
  const padding = (rawMax - rawMin || 1) * 0.12;
  const max = rawMax + padding;
  const min = rawMin - padding;
  const x = (index) => rows.length === 1 ? width / 2 : left + ((width - left - right) * index) / (rows.length - 1);
  const y = (value) => top + ((max - value) / (max - min || 1)) * (height - top - bottom);
  const points = rows.map((row, index) => `${x(index)},${y(row.value)}`).join(' ');
  const marks = rows.map((row, index) => `<g><circle cx="${x(index)}" cy="${y(row.value)}" r="5" class="line-point" />
    <text x="${x(index)}" y="${height - 22}" text-anchor="middle" class="chart-label">${escapeHtml(row.label)}</text>
    ${(rows.length <= 6 || index === rows.length - 1) ? `<text x="${x(index)}" y="${Math.max(18, y(row.value) - 12)}" text-anchor="middle" class="chart-value">${escapeHtml(compactAmount(row.value, currency))}</text>` : ''}</g>`).join('');
  return `<div class="svg-scroll"><svg class="story-chart" viewBox="0 0 ${width} ${height}" style="min-width:${width}px" role="img"><line x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}" class="chart-axis" /><polyline points="${points}" class="line-series" />${marks}</svg></div>`;
}

function historyConclusion(analysis) {
  const currency = $('#historyAnalysisCurrency').value || 'ARS';
  const net = analysis.totals[currency].neto;
  const variation = analysis.variations[currency === 'USD' ? 'usdNet' : 'arsNet'];
  if (net < 0) return `El período cerró con un neto negativo de ${formatMoney(Math.abs(net), currency)}`;
  if (variation !== null && variation > 5) return `El neto ${currency} creció ${variation.toFixed(1)}% frente al período anterior`;
  if (variation !== null && variation < -5) return `El neto ${currency} cayó ${Math.abs(variation).toFixed(1)}% frente al período anterior`;
  return `El período generó un neto de ${formatMoney(net, currency)}`;
}

function bestMonthForCurrency(analysis, currency) {
  return analysis.byMonth.reduce((best, item) => (
    !best || item[currency].neto > best[currency].neto ? item : best
  ), null);
}

function leadingClinicForCurrency(analysis, currency) {
  return analysis.byClinic.reduce((best, item) => (
    !best || item[currency].ingresos > best[currency].ingresos ? item : best
  ), null);
}

function renderHistory() {
  const filters = historyFilters();
  state.historyResults = filterMovements(state.historySource, filters)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const comparableFilters = { ...filters, from: '', to: '' };
  const previousResults = filterMovements(state.historyPrevious, comparableFilters);
  const analysis = analyzeHistory(state.historyResults, previousResults);
  const scopeLabel = clinicLabel(filters.clinica);
  const analysisCurrency = $('#historyAnalysisCurrency').value || 'ARS';
  const bestMonth = bestMonthForCurrency(analysis, analysisCurrency);
  const leadingClinic = leadingClinicForCurrency(analysis, analysisCurrency);
  const topConcept = analysis.byConcept.find((item) => item[analysisCurrency].ingresos > 0) || analysis.byConcept[0];
  const totalClinicIncome = analysis.byClinic.reduce((sum, item) => sum + item[analysisCurrency].ingresos, 0);
  const leadingClinicShare = leadingClinic && totalClinicIncome > 0
    ? (leadingClinic[analysisCurrency].ingresos / totalClinicIncome) * 100
    : 0;

  $('#historyNarrativeTitle').textContent = historyConclusion(analysis);
  $('#historyNarrativeSubtitle').textContent = `${historyPeriodLabel(filters.from, filters.to)} · ${scopeLabel} · análisis destacado en ${analysisCurrency}.`;
  $('#historyInsightChips').innerHTML = `
    <span>${analysis.totals.cantidad} movimientos analizados</span>
    <span>Principal: ${escapeHtml(topConcept?.concept || 'Sin datos')}</span>
    <span>Egresos: ${analysis.totals[analysisCurrency].ingresos > 0 ? ((analysis.totals[analysisCurrency].egresos / analysis.totals[analysisCurrency].ingresos) * 100).toFixed(1) : '0.0'}% de los ingresos ${analysisCurrency}</span>`;

  renderHistoryKpis(analysis);
  const monthlyRows = analysis.byMonth.map((row, index, all) => ({
    label: monthLabel(row.month), value: row[analysisCurrency].neto, highlight: index === all.length - 1,
  }));
  $('#historyTrendTitle').textContent = bestMonth
    ? `${monthLabel(bestMonth.month)} fue el mes de mayor neto ${analysisCurrency}`
    : `El neto ${analysisCurrency} a través del tiempo`;
  $('#historyNetTrend').innerHTML = verticalBarChart(monthlyRows);

  const conceptCurrency = analysisCurrency;
  $('#historyConceptComposition').innerHTML = horizontalBarChart(
    analysis.byConcept.map((row) => ({ label: row.concept, value: row[conceptCurrency].ingresos })),
    conceptCurrency,
  );

  const clinicCurrency = analysisCurrency;
  const clinicRows = analysis.byClinic
    .filter((row) => filters.clinica === 'AMBAS' || row.clinic === filters.clinica)
    .sort((a, b) => b[clinicCurrency].ingresos - a[clinicCurrency].ingresos)
    .map((row) => ({ label: clinicLabel(row.clinic), value: row[clinicCurrency].ingresos }));
  $('#historyClinicTitle').textContent = filters.clinica === 'AMBAS'
    ? 'Qué sede aporta más ingresos'
    : `Facturación de ${scopeLabel}`;
  $('#historyClinicComparison').innerHTML = horizontalBarChart(clinicRows, clinicCurrency);

  const selectedConcept = $('#historyTrendConcept').value || topConcept?.concept || 'Consulta';
  const conceptAnalysis = analyzeHistory(state.historyResults.filter((item) => item.concepto === selectedConcept));
  $('#historyConceptTrend').innerHTML = lineChart(conceptAnalysis.byMonth.map((row) => ({
    label: monthLabel(row.month), value: row[analysisCurrency].neto,
  })));

  const insights = [
    `<strong>${escapeHtml(topConcept?.concept || 'Sin actividad')}</strong> es el concepto con mayor facturación del período.`,
    bestMonth ? `<strong>${monthLabel(bestMonth.month)}</strong> registró el mayor neto ${analysisCurrency}: ${formatMoney(bestMonth[analysisCurrency].neto, analysisCurrency)}.` : 'No hay meses con actividad para comparar.',
    leadingClinic ? `<strong>${clinicLabel(leadingClinic.clinic)}</strong> concentra ${leadingClinicShare.toFixed(1)}% de los ingresos ${analysisCurrency} entre sedes.` : `No hay ingresos ${analysisCurrency} para calcular participación por sede.`,
    `Los egresos representan <strong>${analysis.totals[analysisCurrency].ingresos > 0 ? ((analysis.totals[analysisCurrency].egresos / analysis.totals[analysisCurrency].ingresos) * 100).toFixed(1) : '0.0'}%</strong> de los ingresos ${analysisCurrency}.`,
  ];
  $('#historyInsights').innerHTML = insights.map((text, index) => `<article><span>0${index + 1}</span><p>${text}</p></article>`).join('');
}

async function loadHistory() {
  const filters = historyFilters();
  if (!filters.from || !filters.to || filters.from > filters.to) {
    toast('Revisá el rango de fechas.');
    return;
  }
  setBusy($('#applyHistoryButton'), true, 'Buscando…');
  try {
    const allHistory = filters.from === '2000-01-01';
    const previous = allHistory ? null : previousPeriodBounds(filters.from, filters.to);
    [state.historySource, state.historyPrevious] = await Promise.all([
      fetchPeriod(state.profile, filters.from, filters.to, filters.clinica),
      previous ? fetchPeriod(state.profile, previous.from, previous.to, filters.clinica) : Promise.resolve([]),
    ]);
    renderHistory();
  } catch (error) {
    toast(friendlyFirebaseError(error));
  } finally {
    setBusy($('#applyHistoryButton'), false);
  }
}

function renderDetails() {
  const filters = detailsFilters();
  state.detailsResults = filterMovements(state.detailsSource, filters)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  renderMetricPanels($('#detailsMetrics'), state.detailsResults);
  $('#detailsResultTitle').textContent = `Movimientos encontrados (${state.detailsResults.length})`;
  $('#detailsTable').innerHTML = movementTable(state.detailsResults, { includeDate: true });
  $('#detailsCards').innerHTML = movementCards(state.detailsResults, { includeDate: true });
}

async function loadDetails() {
  const filters = detailsFilters();
  if (!filters.from || !filters.to || filters.from > filters.to) {
    toast('Revisá el rango de fechas.');
    return;
  }
  setBusy($('#applyDetailsButton'), true, 'Buscando…');
  try {
    state.detailsSource = await fetchPeriod(state.profile, filters.from, filters.to, filters.clinica);
    renderDetails();
  } catch (error) {
    toast(friendlyFirebaseError(error));
  } finally {
    setBusy($('#applyDetailsButton'), false);
  }
}

function syncMovementForm() {
  const isExpense = $('#movementType').value === 'Egreso';
  const isHealthPlan = $('#movementCoverage').value === 'Obra Social';
  const concept = $('#movementConcept').value;
  $('#movementCoverageField').hidden = isExpense;
  $('#movementHealthPlanField').hidden = isExpense || !isHealthPlan;
  $('#movementConceptField').hidden = isExpense;
  const isStudies = !isExpense && concept === 'Estudios';
  $('#movementStudiesField').hidden = !isStudies;
  $('#movementAmountField').hidden = isStudies;
  $('#movementAmount').required = !isStudies;
  $('#movementCopayField').hidden = isExpense || concept !== 'Cirugía' || !isHealthPlan;
}

function studyOptions(selected = '') {
  return '<option value="">Seleccionar estudio…</option>'
    + state.catalogs.estudios.map((value) => `<option${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');
}

function updateStudyRows() {
  const rows = $$('.study-row', $('#movementStudies'));
  rows.forEach((row) => {
    row.querySelector('.remove-study-button').disabled = rows.length === 1;
  });
  const total = rows.reduce((sum, row) => sum + (Number(row.querySelector('.study-amount').value) || 0), 0);
  $('#movementStudiesTotal').textContent = `Total: ${formatMoney(total, $('#movementUsd').checked ? 'USD' : 'ARS')}`;
}

function addStudyRow(study = {}) {
  const row = document.createElement('div');
  row.className = 'study-row';
  row.innerHTML = `
    <label class="field"><span>Estudio</span><select class="study-name">${studyOptions(study.estudio || '')}</select></label>
    <label class="field"><span>Importe</span><input class="study-amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0" value="${escapeHtml(study.importe ?? '')}" /></label>
    <button class="icon-button remove-study-button" type="button" aria-label="Quitar estudio" title="Quitar estudio">×</button>`;
  $('#movementStudies').append(row);
  updateStudyRows();
}

function resetStudyRows(movement = null) {
  $('#movementStudies').innerHTML = '';
  addStudyRow({ estudio: movement?.estudio || '', importe: movement?.importe ?? '' });
}

function resetMovementForm(movement = null) {
  $('#movementForm').reset();
  $('#movementId').value = movement?.id || '';
  $('#movementDialogTitle').textContent = movement ? 'Editar movimiento' : 'Nuevo movimiento';
  const selectedClinic = state.profile.role === 'administrativo'
    ? state.profile.clinica
    : (state.dayScope === 'AMBAS' ? 'CDU' : state.dayScope);
  $('#movementClinic').value = movement?.clinica || selectedClinic;
  $('#movementClinic').disabled = state.profile.role === 'administrativo' || Boolean(movement);
  $('#movementDate').value = movement?.fecha || state.dayDate;
  $('#movementDate').disabled = state.profile.role === 'administrativo' || Boolean(movement);
  $('#movementType').value = movement?.tipoMovimiento || 'Ingreso';
  $('#movementPayment').value = movement?.medioPago || 'Efectivo';
  $('#movementDetail').value = movement?.pacienteDetalle || '';
  $('#movementCoverage').value = movement?.coberturaTipo === 'Obra Social' ? 'Obra Social' : 'Particular';
  $('#movementHealthPlan').value = movement?.obraSocial || '';
  $('#movementConcept').value = movement?.concepto || 'Consulta';
  $('#movementAmount').value = movement?.importe ?? '';
  $('#movementUsd').checked = movement?.moneda === 'USD';
  $('#movementNotes').value = movement?.notas || '';
  $$('input[name="movementCopay"]').forEach((radio) => {
    radio.checked = typeof movement?.tieneCoseguro === 'boolean'
      && radio.value === (movement.tieneCoseguro ? 'yes' : 'no');
  });
  $('#movementError').hidden = true;
  resetStudyRows(movement);
  syncMovementForm();
}

function openMovement(movement = null) {
  if (!canOperateSelectedDay()) {
    toast('Los días anteriores están disponibles solo para consulta.');
    return;
  }
  if (state.closure && movement?.fecha === state.dayDate && movement?.clinica === state.dayScope) {
    toast('La caja está cerrada. El médico debe reabrirla para corregir.');
    return;
  }
  resetMovementForm(movement);
  $('#movementDialog').showModal();
  setTimeout(() => $('#movementDetail').focus(), 40);
}

function movementsFromForm() {
  const copay = $('input[name="movementCopay"]:checked');
  const input = {
    fecha: $('#movementDate').value,
    clinica: $('#movementClinic').value,
    pacienteDetalle: $('#movementDetail').value,
    coberturaTipo: $('#movementCoverage').value,
    obraSocial: $('#movementHealthPlan').value,
    concepto: $('#movementConcept').value,
    tieneCoseguro: copay ? copay.value === 'yes' : null,
    medioPago: $('#movementPayment').value,
    moneda: $('#movementUsd').checked ? 'USD' : 'ARS',
    importe: $('#movementAmount').value,
    tipoMovimiento: $('#movementType').value,
    notas: $('#movementNotes').value,
    source: 'manual',
  };
  const studies = $$('.study-row', $('#movementStudies')).map((row) => ({
    estudio: row.querySelector('.study-name').value,
    importe: row.querySelector('.study-amount').value,
  }));
  return buildStudyMovements(input, studies);
}

async function submitMovement(event) {
  event.preventDefault();
  if (!canOperateSelectedDay()) {
    $('#movementError').textContent = 'Los días anteriores están disponibles solo para consulta.';
    $('#movementError').hidden = false;
    return;
  }
  const movements = movementsFromForm();
  if (!movements.length) {
    $('#movementError').textContent = 'Agregá al menos un estudio.';
    $('#movementError').hidden = false;
    return;
  }
  const invalid = movements.map(validateMovement).find((result) => !result.valid);
  if (invalid) {
    $('#movementError').textContent = Object.values(invalid.errors)[0];
    $('#movementError').hidden = false;
    return;
  }
  const button = $('#saveMovementButton');
  setBusy(button, true, 'Guardando…');
  try {
    await saveMovements(movements, $('#movementId').value || null);
    $('#movementDialog').close();
    const created = movements.length;
    toast($('#movementId').value
      ? (created > 1 ? `Movimiento actualizado y ${created - 1} estudio adicional registrado.` : 'Movimiento actualizado.')
      : (created > 1 ? `${created} estudios registrados correctamente.` : 'Movimiento registrado.'));
  } catch (error) {
    $('#movementError').textContent = friendlyFirebaseError(error);
    $('#movementError').hidden = false;
  } finally {
    setBusy(button, false);
  }
}

async function handleMovementAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const movement = state.dayMovements.find((item) => item.id === button.dataset.id);
  if (!movement) return;
  if (button.dataset.action === 'edit') openMovement(movement);
  if (button.dataset.action === 'delete') {
    if (!canManageMovement(movement)) {
      toast('Sólo podés eliminar movimientos propios permitidos para esta fecha.');
      return;
    }
    const accepted = await confirmAction('Eliminar movimiento', `¿Seguro que querés eliminar definitivamente ${formatMoney(movement.importe, movement.moneda)}?`);
    if (!accepted) return;
    try {
      await voidMovement(movement.id);
      toast('Movimiento eliminado.');
    } catch (error) {
      toast(friendlyFirebaseError(error));
    }
  }
}

function confirmAction(title, message) {
  const dialog = $('#confirmDialog');
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  dialog.showModal();
  return new Promise((resolve) => {
    const finish = () => {
      dialog.removeEventListener('close', finish);
      resolve(dialog.returnValue === 'confirm');
    };
    dialog.addEventListener('close', finish);
  });
}

async function downloadFullBackup() {
  const button = $('#backupButton');
  setBusy(button, true, 'Preparando Excel…');
  $('#backupStatus').textContent = '';
  try {
    const data = await fetchAllForBackup(state.profile);
    const { downloadBackup } = await import('./export-excel.js');
    await downloadBackup(data);
    $('#backupStatus').textContent = `${data.movements.length} movimientos y ${data.closures.length} cierres incluidos.`;
    toast('Respaldo Excel generado.');
  } catch (error) {
    $('#backupStatus').textContent = friendlyFirebaseError(error);
  } finally {
    setBusy(button, false);
  }
}

async function selectHistoricalFile(event) {
  const file = event.target.files?.[0];
  state.selectedHistorical = null;
  $('#importHistoricalButton').disabled = true;
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const records = Array.isArray(parsed) ? parsed : parsed.movements;
    const report = validateHistoricalMovements(records);
    if (report.rejectedCount) throw new Error(`${report.rejectedCount} filas requieren revisión.`);
    state.selectedHistorical = report.movements;
    $('#migrationStatus').textContent = `${report.validCount} movimientos válidos. Listos para importar sin duplicar.`;
    $('#importHistoricalButton').disabled = false;
  } catch (error) {
    $('#migrationStatus').textContent = `Archivo no válido: ${error.message}`;
  }
}

async function importSelectedHistorical() {
  if (!state.selectedHistorical?.length) return;
  const accepted = await confirmAction(
    'Importar histórico CDU',
    `Se procesarán ${state.selectedHistorical.length} movimientos con identificadores estables. Los existentes conservarán su fecha de creación y no se duplicarán.`,
  );
  if (!accepted) return;

  const button = $('#importHistoricalButton');
  setBusy(button, true, 'Importando…');

  try {
    const result = await importHistoricalMovements(state.profile, state.selectedHistorical, (done, total) => {
      $('#migrationStatus').textContent = `Importando ${done} de ${total}…`;
    });

    $('#migrationStatus').textContent = 'Verificando histórico en Firestore…';
    const verification = await verifyHistoricalMovements(
      state.profile,
      state.selectedHistorical.map((item) => item.id),
    );

    if (!verification.ok) {
      throw new Error('historical-verification-failed');
    }

    const verificationMessage = `Histórico verificado: ${verification.count}/${verification.expected} movimientos CDU.`;
    $('#migrationStatus').textContent = `${verificationMessage} ${result.created} nuevos · ${result.updated} existentes actualizados.`;
    toast(verificationMessage);
  } catch (error) {
    $('#migrationStatus').textContent = friendlyFirebaseError(error);
  } finally {
    setBusy(button, false);
  }
}

async function resetTestData() {
  const accepted = await confirmAction(
    'Reiniciar datos de prueba',
    'Se eliminarán todos los movimientos MANUALES y todos los cierres de ambas sedes. El histórico CDU no se borra. Esta acción no se puede deshacer.',
  );
  if (!accepted) return;

  const button = $('#resetTestDataButton');
  setBusy(button, true, 'Reiniciando…');
  $('#resetTestStatus').textContent = '';

  try {
    const result = await deleteManualTestData(state.profile, (done, total) => {
      $('#resetTestStatus').textContent = total ? `Eliminando ${done} de ${total}…` : 'No hay datos manuales para eliminar.';
    });

    const successMessage = 'Datos manuales y cierres eliminados correctamente. El histórico CDU fue conservado.';
    $('#resetTestStatus').textContent = `${successMessage} ${result.movementsDeleted} movimientos manuales y ${result.closuresDeleted} cierres eliminados.`;
    toast(successMessage);
  } catch (error) {
    $('#resetTestStatus').textContent = friendlyFirebaseError(error);
  } finally {
    setBusy(button, false);
  }
}

function populateCatalogs() {
  $('#movementPayment').innerHTML = state.catalogs.mediosPago.map((value) => `<option>${escapeHtml(value)}</option>`).join('');
  $('#healthPlanSuggestions').innerHTML = state.catalogs.obrasSociales.map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
}

function applyProfile() {
  const admin = state.profile.role === 'administrativo';
  $('#appView').classList.toggle('admin-mode', admin);
  $('#profileLabel').textContent = state.profile.label;
  $('#headerContext').textContent = admin ? clinicLabel(state.profile.clinica) : 'Control de ambas sedes';

  state.dayScope = admin ? state.profile.clinica : 'AMBAS';
  state.dayDate = argentinaDate();

  $('#dayScope').value = state.dayScope;
  $('#dayDate').value = state.dayDate;

  if (admin) {
    const bounds = adminReviewBounds();
    $('#dayDate').min = bounds.min;
    $('#dayDate').max = bounds.max;
    $('#dayDateHint').textContent = 'Hoy y hasta 7 días atrás';
  } else {
    $('#dayDate').removeAttribute('min');
    $('#dayDate').removeAttribute('max');
    $('#dayDateHint').textContent = '';
  }

  $('#monthScope').value = 'AMBAS';
  $('#monthDate').value = argentinaMonth();

  const historyBounds = defaultHistoryBounds();
  $('#historyFrom').value = historyBounds.from;
  $('#historyTo').value = historyBounds.to;
  $('#historyClinic').value = 'AMBAS';
  $('#historyAnalysisCurrency').value = 'ARS';
  $('#detailsFrom').value = historyBounds.from;
  $('#detailsTo').value = historyBounds.to;
  $('#detailsClinic').value = 'AMBAS';

  populateCatalogs();
  switchView('today');
  startDaySubscriptions();
}

async function handleAuthenticatedUser(user) {
  try {
    const profile = await loadProfile(user.uid);
    if (!profile.active) throw new Error('profile-inactive');
    state.profile = profile;
    state.catalogs = await loadCatalogs();
    showOnly('app');
    applyProfile();
  } catch (error) {
    await signOut(auth);
    showOnly('login');
    $('#loginError').textContent = error.message === 'profile-inactive'
      ? 'La cuenta está desactivada.'
      : friendlyFirebaseError(error);
    $('#loginError').hidden = false;
  }
}

async function login(event) {
  event.preventDefault();
  const button = $('#loginButton');
  $('#loginError').hidden = true;
  setBusy(button, true, 'Ingresando…');
  try {
    await signInWithEmailAndPassword(auth, $('#loginEmail').value.trim(), $('#loginPassword').value);
  } catch (error) {
    $('#loginError').textContent = friendlyFirebaseError(error);
    $('#loginError').hidden = false;
  } finally {
    setBusy(button, false);
  }
}

async function logout() {
  state.unsubDay?.();
  state.unsubClosure?.();
  await signOut(auth);
}

function bindEvents() {
  $('#loginForm').addEventListener('submit', login);
  $('#logoutButton').addEventListener('click', logout);
  $$('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $('#newMovementButton').addEventListener('click', () => openMovement());
  $('#closeMovementButton').addEventListener('click', () => $('#movementDialog').close());
  $('#cancelMovementButton').addEventListener('click', () => $('#movementDialog').close());
  $('#movementForm').addEventListener('submit', submitMovement);
  ['#movementType', '#movementCoverage', '#movementConcept'].forEach((selector) => $(selector).addEventListener('change', syncMovementForm));
  $('#addStudyButton').addEventListener('click', () => addStudyRow());
  $('#movementStudies').addEventListener('input', updateStudyRows);
  $('#movementStudies').addEventListener('click', (event) => {
    const button = event.target.closest('.remove-study-button');
    if (!button || button.disabled) return;
    button.closest('.study-row').remove();
    updateStudyRows();
  });
  $('#movementUsd').addEventListener('change', updateStudyRows);
  $('#todayTable').addEventListener('click', handleMovementAction);
  $('#todayCards').addEventListener('click', handleMovementAction);
  $('#daySearch').addEventListener('input', renderToday);
  $('#dayScope').addEventListener('change', () => {
    state.dayScope = $('#dayScope').value;
    startDaySubscriptions();
  });
  $('#dayDate').addEventListener('change', () => {
    const selected = $('#dayDate').value || argentinaDate();

    if (state.profile?.role === 'administrativo') {
      const bounds = adminReviewBounds();
      if (selected < bounds.min || selected > bounds.max) {
        toast('Podés revisar desde hoy hasta 7 días atrás.');
        $('#dayDate').value = state.dayDate;
        return;
      }
    }

    state.dayDate = selected;
    startDaySubscriptions();
  });
  $('#monthScope').addEventListener('change', loadMonth);
  $('#monthDate').addEventListener('change', loadMonth);
  $('#monthDayFilter').addEventListener('change', renderMonthDayHistory);
  $('#applyHistoryButton').addEventListener('click', loadHistory);
  $('#historyTrendConcept').addEventListener('change', () => state.historySource.length && renderHistory());
  $('#historyAnalysisCurrency').addEventListener('change', () => state.historySource.length && renderHistory());
  $('#applyDetailsButton').addEventListener('click', loadDetails);
  $('#backupButton').addEventListener('click', downloadFullBackup);
  $('#historicalFile').addEventListener('change', selectHistoricalFile);
  $('#importHistoricalButton').addEventListener('click', importSelectedHistorical);
  $('#resetTestDataButton').addEventListener('click', resetTestData);
  window.addEventListener('online', () => { $('#offlineBanner').hidden = true; $('#syncStatus').textContent = 'Actualizando…'; });
  window.addEventListener('offline', () => { $('#offlineBanner').hidden = false; $('#syncStatus').textContent = 'Sin conexión'; });
}

async function boot() {
  bindEvents();
  if (!firebaseReady) {
    showOnly('setup');
    return;
  }
  if (usingFirebaseEmulators) {
    $('#emulatorLogins').hidden = false;
    $$('[data-dev-login]').forEach((button) => button.addEventListener('click', async () => {
      const credentials = {
        CDU: ['cdu@example.test', 'test1234'],
        GUA: ['gua@example.test', 'test1234'],
        MEDICO: ['medico@example.test', 'test1234'],
      }[button.dataset.devLogin];
      await signInWithEmailAndPassword(auth, ...credentials);
    }));
  }
  // La persistencia mejora la experiencia, pero nunca debe impedir que la app
  // llegue a la pantalla de login si el navegador bloquea IndexedDB o la
  // sesión local quedó dañada.
  configureAuthPersistence().catch((error) => {
    console.warn('No se pudo activar la persistencia local de sesión:', error);
  });
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      state.profile = null;
      showOnly('login');
      return;
    }
    showOnly('loading');
    handleAuthenticatedUser(user);
  });
}

boot();
