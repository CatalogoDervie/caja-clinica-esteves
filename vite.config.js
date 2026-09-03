import { defineConfig } from 'vite';

function replaceBlock(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`No se pudo aplicar la mejora de cierre: ${startMarker}`);
  }
  return `${source.slice(0, start)}${replacement}\n\n${source.slice(end)}`;
}

const renderClosureWithTransfers = String.raw`function renderClosure() {
  const body = $('#closureBody');
  if (state.dayScope === 'AMBAS') {
    $('#closureBadge').textContent = 'Por sede';
    $('#closureBadge').className = 'badge';
    body.innerHTML = '<div class="closure-content"><p class="muted">Elegí CDU o Gualeguaychú para controlar el efectivo y realizar el cierre.</p></div>';
    return;
  }
  if (state.closure) {
    const closure = state.closure;
    const transferFields = [
      'transferenciasEsperadasARS', 'transferenciasEsperadasUSD',
      'transferenciasVerificadasARS', 'transferenciasVerificadasUSD',
      'diferenciaTransferenciasARS', 'diferenciaTransferenciasUSD',
    ];
    const hasTransferControl = transferFields.every((key) => Number.isFinite(Number(closure[key])));
    const cashDiffARS = Number(closure.diferenciaARS) || 0;
    const cashDiffUSD = Number(closure.diferenciaUSD) || 0;
    const transferDiffARS = hasTransferControl ? Number(closure.diferenciaTransferenciasARS) || 0 : 0;
    const transferDiffUSD = hasTransferControl ? Number(closure.diferenciaTransferenciasUSD) || 0 : 0;
    const totalDiffARS = hasTransferControl
      ? Number(closure.diferenciaTotalARS ?? (cashDiffARS + transferDiffARS)) || 0
      : cashDiffARS;
    const totalDiffUSD = hasTransferControl
      ? Number(closure.diferenciaTotalUSD ?? (cashDiffUSD + transferDiffUSD)) || 0
      : cashDiffUSD;
    const balanced = Math.abs(totalDiffARS) < 0.01 && Math.abs(totalDiffUSD) < 0.01;
    $('#closureBadge').textContent = 'Cerrada';
    $('#closureBadge').className = 'badge';
    body.innerHTML = `<div class="closure-content">
      <p class="eyebrow">Efectivo</p>
      <div class="summary-line"><span>Efectivo esperado ARS</span><strong>${formatMoney(closure.efectivoEsperadoARS, 'ARS')}</strong></div>
      <div class="summary-line"><span>Efectivo real ARS</span><strong>${formatMoney(closure.efectivoRealARS, 'ARS')}</strong></div>
      <div class="summary-line"><span>Efectivo esperado USD</span><strong>${formatMoney(closure.efectivoEsperadoUSD, 'USD')}</strong></div>
      <div class="summary-line"><span>Efectivo real USD</span><strong>${formatMoney(closure.efectivoRealUSD, 'USD')}</strong></div>
      ${hasTransferControl ? `
        <p class="eyebrow">Transferencias</p>
        <div class="summary-line"><span>Esperadas ARS</span><strong>${formatMoney(closure.transferenciasEsperadasARS, 'ARS')}</strong></div>
        <div class="summary-line"><span>Verificadas ARS</span><strong>${formatMoney(closure.transferenciasVerificadasARS, 'ARS')}</strong></div>
        <div class="summary-line"><span>Esperadas USD</span><strong>${formatMoney(closure.transferenciasEsperadasUSD, 'USD')}</strong></div>
        <div class="summary-line"><span>Verificadas USD</span><strong>${formatMoney(closure.transferenciasVerificadasUSD, 'USD')}</strong></div>
      ` : '<p class="muted">Este cierre fue registrado con el formato anterior, sin detalle persistido de transferencias.</p>'}
      <div class="difference-box ${balanced ? 'good' : 'bad'}">
        Diferencia efectivo ARS: ${formatMoney(cashDiffARS, 'ARS')}<br>
        Diferencia efectivo USD: ${formatMoney(cashDiffUSD, 'USD')}
        ${hasTransferControl ? `<br>Diferencia transferencias ARS: ${formatMoney(transferDiffARS, 'ARS')}<br>Diferencia transferencias USD: ${formatMoney(transferDiffUSD, 'USD')}<br><strong>Diferencia total ARS: ${formatMoney(totalDiffARS, 'ARS')} · USD: ${formatMoney(totalDiffUSD, 'USD')}</strong>` : ''}
      </div>
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
    <p class="eyebrow">Efectivo físico</p>
    <div class="closure-grid">
      <label class="field"><span>Saldo inicial ARS</span><input id="initialARS" type="number" min="0" step="0.01" value="0" /></label>
      <label class="field"><span>Saldo inicial USD</span><input id="initialUSD" type="number" min="0" step="0.01" value="0" /></label>
    </div>
    <div class="summary-line"><span>Efectivo esperado ARS</span><strong id="expectedARS">—</strong></div>
    <div class="summary-line"><span>Efectivo esperado USD</span><strong id="expectedUSD">—</strong></div>
    <div class="closure-grid">
      <label class="field"><span>Efectivo real ARS</span><input id="actualARS" type="number" min="0" step="0.01" /></label>
      <label class="field"><span>Efectivo real USD</span><input id="actualUSD" type="number" min="0" step="0.01" value="0" /></label>
    </div>
    <p class="eyebrow">Transferencias</p>
    <div class="summary-line"><span>Transferencias esperadas ARS</span><strong id="expectedTransferARS">—</strong></div>
    <div class="summary-line"><span>Transferencias esperadas USD</span><strong id="expectedTransferUSD">—</strong></div>
    <div class="closure-grid">
      <label class="field"><span>Transferencias verificadas ARS</span><input id="verifiedTransferARS" type="number" step="0.01" /></label>
      <label class="field"><span>Transferencias verificadas USD</span><input id="verifiedTransferUSD" type="number" step="0.01" /></label>
    </div>
    <div id="closureDifferencePreview" class="difference-box">Completá los valores reales para ver las diferencias.</div>
    <button id="closeCashButton" class="button primary full" type="button">Cerrar caja</button>
    <p class="muted">El saldo inicial afecta solamente al efectivo. Las transferencias se controlan por separado.</p>
  </div>`;

  const readExpected = () => {
    const cash = expectedCash(state.dayMovements, {
      ARS: Number($('#initialARS').value) || 0,
      USD: Number($('#initialUSD').value) || 0,
    });
    const totals = calculateTotals(state.dayMovements);
    return {
      cash,
      transfers: { ARS: totals.ARS.transferencias, USD: totals.USD.transferencias },
    };
  };

  const updateDifferencePreview = () => {
    const ids = ['actualARS', 'actualUSD', 'verifiedTransferARS', 'verifiedTransferUSD'];
    const box = $('#closureDifferencePreview');
    if (ids.some((id) => $(`#${id}`).value === '')) {
      box.className = 'difference-box';
      box.textContent = 'Completá los valores reales para ver las diferencias.';
      return;
    }
    const expected = readExpected();
    const cashDiffARS = (Number($('#actualARS').value) || 0) - expected.cash.ARS;
    const cashDiffUSD = (Number($('#actualUSD').value) || 0) - expected.cash.USD;
    const transferDiffARS = (Number($('#verifiedTransferARS').value) || 0) - expected.transfers.ARS;
    const transferDiffUSD = (Number($('#verifiedTransferUSD').value) || 0) - expected.transfers.USD;
    const totalDiffARS = cashDiffARS + transferDiffARS;
    const totalDiffUSD = cashDiffUSD + transferDiffUSD;
    const balanced = Math.abs(totalDiffARS) < 0.01 && Math.abs(totalDiffUSD) < 0.01;
    box.className = `difference-box ${balanced ? 'good' : 'bad'}`;
    box.innerHTML = `Efectivo ARS: ${formatMoney(cashDiffARS, 'ARS')} · USD: ${formatMoney(cashDiffUSD, 'USD')}<br>Transferencias ARS: ${formatMoney(transferDiffARS, 'ARS')} · USD: ${formatMoney(transferDiffUSD, 'USD')}<br><strong>Total ARS: ${formatMoney(totalDiffARS, 'ARS')} · USD: ${formatMoney(totalDiffUSD, 'USD')}</strong>`;
  };

  const updateExpected = () => {
    const expected = readExpected();
    $('#expectedARS').textContent = formatMoney(expected.cash.ARS, 'ARS');
    $('#expectedUSD').textContent = formatMoney(expected.cash.USD, 'USD');
    $('#expectedTransferARS').textContent = formatMoney(expected.transfers.ARS, 'ARS');
    $('#expectedTransferUSD').textContent = formatMoney(expected.transfers.USD, 'USD');
    if ($('#verifiedTransferARS').value === '' && Math.abs(expected.transfers.ARS) < 0.01) $('#verifiedTransferARS').value = '0';
    if ($('#verifiedTransferUSD').value === '' && Math.abs(expected.transfers.USD) < 0.01) $('#verifiedTransferUSD').value = '0';
    updateDifferencePreview();
  };

  $('#initialARS').addEventListener('input', updateExpected);
  $('#initialUSD').addEventListener('input', updateExpected);
  ['#actualARS', '#actualUSD', '#verifiedTransferARS', '#verifiedTransferUSD']
    .forEach((selector) => $(selector).addEventListener('input', updateDifferencePreview));
  $('#closeCashButton').addEventListener('click', closeSelectedCash);
  updateExpected();
}`;

const closeSelectedCashWithTransfers = String.raw`async function closeSelectedCash() {
  if (!canOperateSelectedDay()) {
    toast('Los días anteriores están disponibles solo para consulta.');
    return;
  }
  const required = ['#actualARS', '#actualUSD', '#verifiedTransferARS', '#verifiedTransferUSD'];
  if (required.some((selector) => $(selector).value === '')) {
    toast('Completá el efectivo real y las transferencias verificadas en ARS y USD.');
    return;
  }
  const initial = { ARS: Number($('#initialARS').value) || 0, USD: Number($('#initialUSD').value) || 0 };
  const expected = expectedCash(state.dayMovements, initial);
  const actual = { ARS: Number($('#actualARS').value) || 0, USD: Number($('#actualUSD').value) || 0 };
  const totals = calculateTotals(state.dayMovements);
  const transfersExpected = { ARS: totals.ARS.transferencias, USD: totals.USD.transferencias };
  const transfersVerified = {
    ARS: Number($('#verifiedTransferARS').value) || 0,
    USD: Number($('#verifiedTransferUSD').value) || 0,
  };
  const cashDifference = { ARS: actual.ARS - expected.ARS, USD: actual.USD - expected.USD };
  const transferDifference = {
    ARS: transfersVerified.ARS - transfersExpected.ARS,
    USD: transfersVerified.USD - transfersExpected.USD,
  };
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
      diferenciaARS: cashDifference.ARS,
      diferenciaUSD: cashDifference.USD,
      transferenciasEsperadasARS: transfersExpected.ARS,
      transferenciasEsperadasUSD: transfersExpected.USD,
      transferenciasVerificadasARS: transfersVerified.ARS,
      transferenciasVerificadasUSD: transfersVerified.USD,
      diferenciaTransferenciasARS: transferDifference.ARS,
      diferenciaTransferenciasUSD: transferDifference.USD,
      diferenciaTotalARS: cashDifference.ARS + transferDifference.ARS,
      diferenciaTotalUSD: cashDifference.USD + transferDifference.USD,
    });
    toast('Caja cerrada correctamente.');
  } catch (error) {
    toast(friendlyFirebaseError(error));
  } finally {
    setBusy(button, false);
  }
}`;

const closeCashCompatibility = String.raw`export async function closeCash(closure) {
  const reference = doc(db, 'cierres', `${closure.clinica}_${closure.fechaKey}`);
  try {
    await setDoc(reference, { ...closure, cerradoAt: serverTimestamp() });
  } catch (error) {
    const hasTransferControl = Object.prototype.hasOwnProperty.call(closure, 'transferenciasEsperadasARS');
    const transferBalanced = Math.abs(Number(closure.diferenciaTransferenciasARS) || 0) < 0.01
      && Math.abs(Number(closure.diferenciaTransferenciasUSD) || 0) < 0.01;
    if (!isPermissionDenied(error) || !hasTransferControl || !transferBalanced) throw error;

    const {
      transferenciasEsperadasARS: _transferenciasEsperadasARS,
      transferenciasEsperadasUSD: _transferenciasEsperadasUSD,
      transferenciasVerificadasARS: _transferenciasVerificadasARS,
      transferenciasVerificadasUSD: _transferenciasVerificadasUSD,
      diferenciaTransferenciasARS: _diferenciaTransferenciasARS,
      diferenciaTransferenciasUSD: _diferenciaTransferenciasUSD,
      diferenciaTotalARS: _diferenciaTotalARS,
      diferenciaTotalUSD: _diferenciaTotalUSD,
      ...legacyClosure
    } = closure;
    await setDoc(reference, { ...legacyClosure, cerradoAt: serverTimestamp() });
  }
}`;

function closureTransferPlugin() {
  return {
    name: 'caja-closure-transfer-control',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.replaceAll('\\', '/');
      if (normalizedId.endsWith('/src/main.js')) {
        let next = replaceBlock(
          code,
          'function renderClosure() {',
          'async function closeSelectedCash() {',
          renderClosureWithTransfers,
        );
        next = replaceBlock(
          next,
          'async function closeSelectedCash() {',
          'async function reopenSelectedCash() {',
          closeSelectedCashWithTransfers,
        );
        return { code: next, map: null };
      }
      if (normalizedId.endsWith('/src/data-service.js')) {
        const next = replaceBlock(
          code,
          'export async function closeCash(closure) {',
          'export async function reopenCash(id) {',
          closeCashCompatibility,
        );
        return { code: next, map: null };
      }
      return null;
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [closureTransferPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
