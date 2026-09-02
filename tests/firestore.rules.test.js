import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { argentinaDate, dateKey } from '../src/logic.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectId = 'demo-caja-clinica';
let testEnv;

function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function movement(overrides = {}) {
  const fecha = overrides.fecha || argentinaDate();
  return {
    fecha,
    fechaKey: overrides.fechaKey || dateKey(fecha),
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
    source: 'manual',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

function closure(overrides = {}) {
  const fecha = overrides.fecha || argentinaDate();
  return {
    fecha,
    fechaKey: overrides.fechaKey || dateKey(fecha),
    clinica: 'CDU',
    saldoInicialARS: 0,
    saldoInicialUSD: 0,
    efectivoEsperadoARS: 60000,
    efectivoEsperadoUSD: 0,
    efectivoRealARS: 60000,
    efectivoRealUSD: 0,
    diferenciaARS: 0,
    diferenciaUSD: 0,
    cerradoAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedBaseData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, 'users/cdu'), { role: 'administrativo', clinica: 'CDU', active: true }),
      setDoc(doc(database, 'users/gua'), { role: 'administrativo', clinica: 'GUA', active: true }),
      setDoc(doc(database, 'users/medico'), { role: 'medico', clinica: 'AMBAS', active: true }),
      setDoc(doc(database, 'users/inactivo'), { role: 'administrativo', clinica: 'CDU', active: false }),
      setDoc(doc(database, 'movimientos/cdu-hoy'), movement()),
      setDoc(doc(database, 'movimientos/gua-hoy'), movement({ clinica: 'GUA' })),
      setDoc(doc(database, 'movimientos/cdu-reciente'), movement({
        fecha: shiftDate(argentinaDate(), -7),
        fechaKey: dateKey(shiftDate(argentinaDate(), -7)),
      })),
      setDoc(doc(database, 'movimientos/cdu-fuera-ventana'), movement({
        fecha: shiftDate(argentinaDate(), -8),
        fechaKey: dateKey(shiftDate(argentinaDate(), -8)),
      })),
      setDoc(doc(database, 'movimientos/historico-cdu-0001'), movement({
        fecha: '2026-01-10',
        fechaKey: 20260110,
        clinica: 'CDU',
        source: 'historico-cdu',
      })),
    ]);
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(path.join(projectRoot, 'firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedBaseData();
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('perfiles', () => {
  it('permite leer solo el perfil propio y rechaza usuarios inactivos', async () => {
    const cdu = testEnv.authenticatedContext('cdu').firestore();
    const inactive = testEnv.authenticatedContext('inactivo').firestore();
    await assertSucceeds(getDoc(doc(cdu, 'users/cdu')));
    await assertFails(getDoc(doc(cdu, 'users/gua')));
    await assertSucceeds(getDoc(doc(inactive, 'users/inactivo')));
    await assertFails(getDoc(doc(inactive, 'movimientos/cdu-hoy')));
  });
});

describe('separación real entre sedes', () => {
  it('CDU consulta su caja de hoy con filtros exigidos por las reglas', async () => {
    const cdu = testEnv.authenticatedContext('cdu').firestore();
    const dayQuery = query(
      collection(cdu, 'movimientos'),
      where('fechaKey', '==', dateKey(argentinaDate())),
      where('clinica', '==', 'CDU'),
    );
    const snapshot = await assertSucceeds(getDocs(dayQuery));
    expect(snapshot.size).toBe(1);
  });

  it('CDU puede revisar su propia sede hasta 7 días atrás', async () => {
    const cdu = testEnv.authenticatedContext('cdu').firestore();
    await assertSucceeds(getDoc(doc(cdu, 'movimientos/cdu-reciente')));

    const selectedDate = shiftDate(argentinaDate(), -7);
    const dayQuery = query(
      collection(cdu, 'movimientos'),
      where('fechaKey', '==', dateKey(selectedDate)),
      where('clinica', '==', 'CDU'),
    );
    const snapshot = await assertSucceeds(getDocs(dayQuery));
    expect(snapshot.size).toBe(1);
  });

  it('CDU no lee GUA ni fechas con más de 7 días, incluso por ID directo', async () => {
    const cdu = testEnv.authenticatedContext('cdu').firestore();
    await assertFails(getDoc(doc(cdu, 'movimientos/gua-hoy')));
    await assertFails(getDoc(doc(cdu, 'movimientos/cdu-fuera-ventana')));
    await assertFails(getDoc(doc(cdu, 'movimientos/historico-cdu-0001')));
  });

  it('GUA no lee CDU', async () => {
    const gua = testEnv.authenticatedContext('gua').firestore();
    await assertFails(getDoc(doc(gua, 'movimientos/cdu-hoy')));
  });

  it('el médico consulta ambas sedes e historial', async () => {
    const medico = testEnv.authenticatedContext('medico').firestore();
    const snapshot = await assertSucceeds(getDocs(collection(medico, 'movimientos')));
    expect(snapshot.size).toBe(5);
  });
});

describe('escrituras y validación', () => {
  it('CDU crea un movimiento válido propio del día actual', async () => {
    const cdu = testEnv.authenticatedContext('cdu').firestore();
    const data = movement({ createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await assertSucceeds(setDoc(doc(cdu, 'movimientos/nuevo-cdu'), data));
  });

  it('CDU no crea en GUA ni modifica la sede de un movimiento', async () => {
    const cdu = testEnv.authenticatedContext('cdu').firestore();
    await assertFails(setDoc(doc(cdu, 'movimientos/intento-gua'), movement({
      clinica: 'GUA', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })));
    await assertFails(updateDoc(doc(cdu, 'movimientos/cdu-hoy'), {
      clinica: 'GUA', updatedAt: serverTimestamp(),
    }));
  });

  it('CDU no crea movimientos históricos', async () => {
    const cdu = testEnv.authenticatedContext('cdu').firestore();
    await assertFails(setDoc(doc(cdu, 'movimientos/historico'), movement({
      fecha: '2026-01-10', fechaKey: 20260110,
      source: 'historico-cdu',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })));
  });

  it('el médico crea histórico CDU y una reimportación actualiza el mismo ID sin duplicarlo', async () => {
    const medico = testEnv.authenticatedContext('medico').firestore();
    const historicalRef = doc(medico, 'movimientos/historico-cdu-0002');

    await assertSucceeds(setDoc(historicalRef, movement({
      fecha: '2026-01-11',
      fechaKey: 20260111,
      source: 'historico-cdu',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })));

    const firstSnapshot = await getDoc(historicalRef);
    const originalCreatedAt = firstSnapshot.data().createdAt;

    await assertSucceeds(updateDoc(historicalRef, {
      notas: 'Reimportado',
      updatedAt: serverTimestamp(),
    }));

    const repeatedSnapshot = await getDoc(historicalRef);
    expect(repeatedSnapshot.data().createdAt.isEqual(originalCreatedAt)).toBe(true);
    expect(repeatedSnapshot.data().notas).toBe('Reimportado');

    const historicalQuery = query(
      collection(medico, 'movimientos'),
      where('source', '==', 'historico-cdu'),
    );
    const historical = await assertSucceeds(getDocs(historicalQuery));
    expect(historical.docs.map((item) => item.id).sort()).toEqual([
      'historico-cdu-0001',
      'historico-cdu-0002',
    ]);
  });

  it('el médico no puede crear histórico fuera de CDU', async () => {
    const medico = testEnv.authenticatedContext('medico').firestore();
    await assertFails(setDoc(doc(medico, 'movimientos/historico-gua'), movement({
      fecha: '2026-01-10',
      fechaKey: 20260110,
      clinica: 'GUA',
      source: 'historico-cdu',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })));
  });

  it('CDU puede leer pero no modificar un día anterior dentro de la semana', async () => {
    const cdu = testEnv.authenticatedContext('cdu').firestore();
    await assertSucceeds(getDoc(doc(cdu, 'movimientos/cdu-reciente')));
    await assertFails(updateDoc(doc(cdu, 'movimientos/cdu-reciente'), {
      notas: 'Intento de corrección pasada',
      updatedAt: serverTimestamp(),
    }));
  });

  it('rechaza fechas que no coinciden con la clave operativa', async () => {
    const cdu = testEnv.authenticatedContext('cdu').firestore();
    await assertFails(setDoc(doc(cdu, 'movimientos/fecha-inconsistente'), movement({
      fecha: '2020-01-01',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })));
  });

  it('rechaza Estudios sin estudio y cirugía de OS sin dato de coseguro', async () => {
    const medico = testEnv.authenticatedContext('medico').firestore();
    await assertFails(setDoc(doc(medico, 'movimientos/estudio-invalido'), movement({
      concepto: 'Estudios', estudio: '',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })));
    await assertFails(setDoc(doc(medico, 'movimientos/cirugia-invalida'), movement({
      concepto: 'Cirugía', coberturaTipo: 'Obra Social', obraSocial: 'PAMI', tieneCoseguro: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })));
  });

  it('permite anulación lógica; sólo el médico borra movimientos manuales', async () => {
    const cdu = testEnv.authenticatedContext('cdu').firestore();
    const medico = testEnv.authenticatedContext('medico').firestore();

    await assertSucceeds(updateDoc(doc(cdu, 'movimientos/cdu-hoy'), {
      anulado: true,
      updatedAt: serverTimestamp(),
    }));
    await assertFails(deleteDoc(doc(cdu, 'movimientos/cdu-hoy')));
    await assertSucceeds(deleteDoc(doc(medico, 'movimientos/gua-hoy')));
    await assertFails(deleteDoc(doc(medico, 'movimientos/historico-cdu-0001')));
  });
});

describe('cierres', () => {
  it('cada administrativa cierra únicamente su sede y no duplica el cierre', async () => {
    const cdu = testEnv.authenticatedContext('cdu').firestore();
    const id = `CDU_${dateKey(argentinaDate())}`;
    await assertSucceeds(setDoc(doc(cdu, `cierres/${id}`), closure()));
    await assertFails(setDoc(doc(cdu, `cierres/GUA_${dateKey(argentinaDate())}`), closure({ clinica: 'GUA' })));
    await assertFails(updateDoc(doc(cdu, `cierres/${id}`), { efectivoRealARS: 1 }));
  });

  it('la administrativa puede consultar un cierre de su sede hasta 7 días atrás', async () => {
    const past = shiftDate(argentinaDate(), -7);
    const id = `CDU_${dateKey(past)}`;

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `cierres/${id}`), {
        ...closure({ fecha: past, fechaKey: dateKey(past) }),
        cerradoAt: Timestamp.now(),
      });
    });

    const cdu = testEnv.authenticatedContext('cdu').firestore();
    await assertSucceeds(getDoc(doc(cdu, `cierres/${id}`)));
  });

  it('solo el médico puede reabrir un cierre', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `cierres/CDU_${dateKey(argentinaDate())}`), {
        ...closure(),
        cerradoAt: Timestamp.now(),
      });
    });
    const cdu = testEnv.authenticatedContext('cdu').firestore();
    const medico = testEnv.authenticatedContext('medico').firestore();
    await assertFails(deleteDoc(doc(cdu, `cierres/CDU_${dateKey(argentinaDate())}`)));
    await assertSucceeds(deleteDoc(doc(medico, `cierres/CDU_${dateKey(argentinaDate())}`)));
  });

  it('obliga al médico a reabrir antes de corregir un movimiento manual', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `cierres/CDU_${dateKey(argentinaDate())}`), {
        ...closure(),
        cerradoAt: Timestamp.now(),
      });
    });
    const medico = testEnv.authenticatedContext('medico').firestore();
    await assertFails(updateDoc(doc(medico, 'movimientos/cdu-hoy'), {
      notas: 'Corrección sin reapertura', updatedAt: serverTimestamp(),
    }));
  });
});

describe('concurrencia', () => {
  it('guarda dos sesiones CDU y una GUA sin sobrescribir documentos', async () => {
    const cduOne = testEnv.authenticatedContext('cdu').firestore();
    const cduTwo = testEnv.authenticatedContext('cdu').firestore();
    const gua = testEnv.authenticatedContext('gua').firestore();
    await Promise.all([
      assertSucceeds(setDoc(doc(cduOne, 'movimientos/concurrente-cdu-1'), movement({
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }))),
      assertSucceeds(setDoc(doc(cduTwo, 'movimientos/concurrente-cdu-2'), movement({
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }))),
      assertSucceeds(setDoc(doc(gua, 'movimientos/concurrente-gua-1'), movement({
        clinica: 'GUA', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }))),
    ]);
    const medico = testEnv.authenticatedContext('medico').firestore();
    const snapshot = await getDocs(collection(medico, 'movimientos'));
    expect(snapshot.docs.filter((item) => item.id.startsWith('concurrente-'))).toHaveLength(3);
  });
});
