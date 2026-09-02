import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase.js';
import { argentinaDate, dateFromKey, dateKey } from './logic.js';

export const DEFAULT_CATALOGS = Object.freeze({
  estudios: ['OCT', 'Paquimetría', 'Topografía', 'HRT', 'YAG', 'Campimetría / CV'],
  obrasSociales: ['PAMI', 'OSER', 'IOSPER', 'SANCOR SALUD', 'OSPE'],
  mediosPago: ['Efectivo', 'Transferencia', 'Otro'],
});

function snapshotRows(snapshot) {
  return snapshot.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      ...data,
      fecha: dateFromKey(data.fechaKey) || data.fecha,
    };
  });
}

export function normalizeProfile(uid, data = {}) {
  const role = data.role === 'medico' ? 'medico' : 'administrativo';
  const clinica = role === 'medico' ? 'AMBAS' : data.clinica;
  return {
    uid,
    role,
    clinica,
    active: data.active === true,
    label: role === 'medico'
      ? 'Médico / Supervisor'
      : clinica === 'GUA'
        ? 'Administrativa Gualeguaychú'
        : 'Administrativa CDU',
  };
}

export async function loadProfile(uid) {
  const snapshot = await getDoc(doc(db, 'users', uid));
  if (!snapshot.exists()) throw new Error('profile-not-found');
  return normalizeProfile(uid, snapshot.data());
}

function scopedClinic(profile, scope) {
  if (profile.role === 'administrativo') return profile.clinica;
  return scope && scope !== 'AMBAS' ? scope : null;
}

export function subscribeDay(profile, date, scope, onData, onError) {
  const conditions = [where('fechaKey', '==', dateKey(date))];
  const clinic = scopedClinic(profile, scope);
  if (clinic) conditions.push(where('clinica', '==', clinic));
  const dayQuery = query(collection(db, 'movimientos'), ...conditions);
  return onSnapshot(dayQuery, { includeMetadataChanges: true }, (snapshot) => {
    onData(snapshotRows(snapshot), { fromCache: snapshot.metadata.fromCache });
  }, onError);
}

export function subscribeClosure(profile, date, clinic, onData, onError) {
  if (!clinic || clinic === 'AMBAS') {
    onData(null);
    return () => {};
  }
  const allowedClinic = scopedClinic(profile, clinic);
  if (!allowedClinic) {
    onData(null);
    return () => {};
  }
  const closureRef = doc(db, 'cierres', `${allowedClinic}_${dateKey(date)}`);
  return onSnapshot(closureRef, (snapshot) => {
    onData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
  }, onError);
}

export async function saveMovement(movement, id = null) {
  if (id) {
    const { createdAt: _createdAt, id: _id, ...editable } = movement;
    await updateDoc(doc(db, 'movimientos', id), {
      ...editable,
      updatedAt: serverTimestamp(),
    });
    return id;
  }
  const movementRef = doc(collection(db, 'movimientos'));
  await setDoc(movementRef, {
    ...movement,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return movementRef.id;
}

export async function voidMovement(id) {
  await updateDoc(doc(db, 'movimientos', id), {
    anulado: true,
    updatedAt: serverTimestamp(),
  });
}

export async function closeCash(closure) {
  const reference = doc(db, 'cierres', `${closure.clinica}_${closure.fechaKey}`);
  await setDoc(reference, { ...closure, cerradoAt: serverTimestamp() });
}

export async function reopenCash(id) {
  await deleteDoc(doc(db, 'cierres', id));
}

function validCatalog(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value.map((item) => String(item).trim()).filter(Boolean);
  return cleaned.length ? [...new Set(cleaned)] : fallback;
}

export async function loadCatalogs() {
  const snapshot = await getDoc(doc(db, 'configuracion', 'catalogos'));
  if (!snapshot.exists()) return DEFAULT_CATALOGS;
  const data = snapshot.data();
  return {
    estudios: validCatalog(data.estudios, DEFAULT_CATALOGS.estudios),
    obrasSociales: validCatalog(data.obrasSociales, DEFAULT_CATALOGS.obrasSociales),
    mediosPago: validCatalog(data.mediosPago, DEFAULT_CATALOGS.mediosPago),
  };
}

export async function fetchPeriod(profile, from, to, scope = 'AMBAS') {
  if (profile.role !== 'medico') throw new Error('permission-denied');
  const conditions = [where('fechaKey', '>=', dateKey(from)), where('fechaKey', '<=', dateKey(to))];
  const clinic = scopedClinic(profile, scope);
  if (clinic) conditions.push(where('clinica', '==', clinic));
  const snapshot = await getDocs(query(collection(db, 'movimientos'), ...conditions));
  return snapshotRows(snapshot);
}

export async function fetchAllForBackup(profile) {
  if (profile.role !== 'medico') throw new Error('permission-denied');
  const [movements, closures] = await Promise.all([
    getDocs(collection(db, 'movimientos')),
    getDocs(collection(db, 'cierres')),
  ]);
  return {
    movements: snapshotRows(movements),
    closures: snapshotRows(closures),
    generatedAt: new Date(),
  };
}

export async function importHistoricalMovements(profile, movements, onProgress = () => {}) {
  if (profile.role !== 'medico') throw new Error('permission-denied');

  let processed = 0;
  let created = 0;
  let updated = 0;

  // Se usa un lote moderado porque antes de escribir verificamos si cada ID
  // ya existe. Así una segunda importación conserva createdAt y no choca
  // con las reglas de seguridad.
  for (let offset = 0; offset < movements.length; offset += 150) {
    const chunk = movements.slice(offset, offset + 150);
    const refs = chunk.map((movement) => doc(db, 'movimientos', movement.id));
    const snapshots = await Promise.all(refs.map((reference) => getDoc(reference)));
    const batch = writeBatch(db);

    chunk.forEach((movement, index) => {
      const { id, ...data } = movement;
      const reference = refs[index];
      const snapshot = snapshots[index];

      if (snapshot.exists()) {
        const existing = snapshot.data();
        if (existing.source !== 'historico-cdu') {
          throw new Error(`historical-id-conflict:${id}`);
        }
        batch.update(reference, {
          ...data,
          updatedAt: serverTimestamp(),
        });
        updated += 1;
      } else {
        batch.set(reference, {
          ...data,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        created += 1;
      }
    });

    await batch.commit();
    processed += chunk.length;
    onProgress(processed, movements.length);
  }

  return { processed, created, updated };
}

export async function verifyHistoricalMovements(profile, expectedIds = []) {
  if (profile.role !== 'medico') throw new Error('permission-denied');

  const snapshot = await getDocs(query(
    collection(db, 'movimientos'),
    where('source', '==', 'historico-cdu'),
  ));

  const ids = new Set(snapshot.docs
    .filter((item) => item.data().clinica === 'CDU')
    .map((item) => item.id));
  const missing = expectedIds.filter((id) => !ids.has(id));
  const unexpected = [...ids].filter((id) => expectedIds.length && !expectedIds.includes(id));

  return {
    count: ids.size,
    expected: expectedIds.length,
    missing,
    unexpected,
    ok: expectedIds.length
      ? ids.size === expectedIds.length && missing.length === 0 && unexpected.length === 0
      : true,
  };
}

export async function deleteManualTestData(profile, onProgress = () => {}) {
  if (profile.role !== 'medico') throw new Error('permission-denied');

  const [manualMovements, closures] = await Promise.all([
    getDocs(query(collection(db, 'movimientos'), where('source', '==', 'manual'))),
    getDocs(collection(db, 'cierres')),
  ]);

  const targets = [
    ...manualMovements.docs.map((item) => ({ kind: 'movement', ref: item.ref })),
    ...closures.docs.map((item) => ({ kind: 'closure', ref: item.ref })),
  ];

  let done = 0;
  for (let offset = 0; offset < targets.length; offset += 400) {
    const chunk = targets.slice(offset, offset + 400);
    const batch = writeBatch(db);
    chunk.forEach((item) => batch.delete(item.ref));
    await batch.commit();
    done += chunk.length;
    onProgress(done, targets.length);
  }

  return {
    movementsDeleted: manualMovements.size,
    closuresDeleted: closures.size,
    totalDeleted: targets.length,
  };
}

export function monthBounds(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    from: `${year}-${String(monthNumber).padStart(2, '0')}-01`,
    to: `${year}-${String(monthNumber).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function defaultHistoryBounds() {
  const to = argentinaDate();
  const date = new Date(`${to}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 2);
  return { from: date.toISOString().slice(0, 10), to };
}

export function friendlyFirebaseError(error) {
  const code = String(error?.code || error?.message || error || '');
  if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password')) {
    return 'Correo o contraseña incorrectos.';
  }
  if (code.includes('auth/too-many-requests')) return 'Demasiados intentos. Esperá unos minutos.';
  if (code.includes('auth/network-request-failed')) return 'No hay conexión. Revisá Internet e intentá nuevamente.';
  if (code.includes('permission-denied')) return 'No tenés permiso para realizar esta acción.';
  if (code.includes('failed-precondition')) return 'Esta operación requiere una configuración pendiente en Firebase.';
  if (code.includes('profile-not-found')) return 'La cuenta no tiene un perfil habilitado para la Caja.';
  if (code.includes('historical-id-conflict')) return 'Hay un ID histórico ocupado por un movimiento manual. No se modificó ese registro.';
  if (code.includes('historical-verification-failed')) return 'La importación terminó, pero la verificación final no coincide con el archivo seleccionado.';
  if (code.includes('unavailable')) return 'El servicio no está disponible en este momento.';
  return 'No se pudo completar la operación. Intentá nuevamente.';
}
