import { argentinaDate, dateKey } from '../src/logic.js';

const projectId = 'demo-caja-clinica';
const authBase = `http://127.0.0.1:9099/emulator/v1/projects/${projectId}`;
const identityBase = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const firestoreBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${body}`);
  return body ? JSON.parse(body) : {};
}

function encodeValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  return { stringValue: String(value) };
}

function fields(data) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, encodeValue(value)]),
  );
}

async function putDocument(path, data) {
  await request(`${firestoreBase}/${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fields: fields(data) }),
  });
}

await request(`${authBase}/accounts`, { method: 'DELETE' }).catch(() => {});
await request(`http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' }).catch(() => {});

const users = [
  { email: 'cdu@example.test', password: 'test1234', role: 'administrativo', clinica: 'CDU' },
  { email: 'gua@example.test', password: 'test1234', role: 'administrativo', clinica: 'GUA' },
  { email: 'medico@example.test', password: 'test1234', role: 'medico', clinica: 'AMBAS' },
];

for (const user of users) {
  const authUser = await request(`${identityBase}/accounts:signUp?key=demo-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password, returnSecureToken: true }),
  });
  await putDocument(`users/${authUser.localId}`, {
    role: user.role,
    clinica: user.clinica,
    active: true,
  });
}

await putDocument('configuracion/catalogos', {
  estudios: ['OCT', 'Paquimetría', 'Topografía', 'HRT', 'YAG', 'Campimetría / CV'],
  obrasSociales: ['PAMI', 'OSER', 'IOSPER', 'SANCOR SALUD', 'OSPE'],
  mediosPago: ['Efectivo', 'Transferencia', 'Otro'],
});

const today = argentinaDate();
const now = new Date();
const examples = [
  ['CDU', 'Paciente de prueba A', 'Consulta', '', 'Particular', '', 'Efectivo', 'ARS', 60000, 'Ingreso'],
  ['CDU', 'Paciente de prueba B', 'Estudios', 'OCT', 'Obra Social', 'OSER', 'Transferencia', 'ARS', 54000, 'Ingreso'],
  ['CDU', 'Envío de prueba', 'Otros / Gasto', '', 'Particular', '', 'Efectivo', 'ARS', 14000, 'Egreso'],
  ['GUA', 'Paciente de prueba C', 'Consulta', '', 'Particular', '', 'Efectivo', 'ARS', 60000, 'Ingreso'],
  ['GUA', 'Cirugía de prueba', 'Cirugía', '', 'Obra Social', 'PAMI', 'Transferencia', 'ARS', 120000, 'Ingreso'],
  ['GUA', 'Lente de prueba', 'Lentes', '', 'Particular', '', 'Efectivo', 'USD', 250, 'Ingreso'],
];

for (const [index, item] of examples.entries()) {
  const [clinica, pacienteDetalle, concepto, estudio, coberturaTipo, obraSocial, medioPago, moneda, importe, tipoMovimiento] = item;
  await putDocument(`movimientos/demo-${index + 1}`, {
    fecha: today,
    fechaKey: dateKey(today),
    clinica,
    pacienteDetalle,
    coberturaTipo,
    obraSocial,
    concepto,
    estudio: estudio || null,
    tieneCoseguro: concepto === 'Cirugía' && coberturaTipo === 'Obra Social' ? false : null,
    medioPago,
    moneda,
    importe,
    tipoMovimiento,
    notas: '',
    anulado: false,
    source: 'manual',
    createdAt: new Date(now.getTime() + index * 1000),
    updatedAt: new Date(now.getTime() + index * 1000),
  });
}

console.log(`Emuladores preparados con ${users.length} cuentas y ${examples.length} movimientos sintéticos.`);
