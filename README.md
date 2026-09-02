# Caja · Centro de Ojos Esteves

Sistema de caja online para Concepción del Uruguay (CDU) y Gualeguaychú (GUA). La aplicación es estática y se publica en GitHub Pages; la autenticación y los datos viven en un proyecto Firebase exclusivo de Caja.

## Qué incluye

- Cuenta administrativa CDU: opera la caja de hoy de CDU y puede revisar, en modo solo lectura, cada uno de los 7 días anteriores.
- Cuenta administrativa GUA: opera la caja de hoy de GUA y puede revisar, en modo solo lectura, cada uno de los 7 días anteriores.
- Médico / Supervisor: ve ambas sedes, resumen diario y mensual, historial, cierres y respaldo Excel.
- ARS por defecto y selector manual USD.
- Consulta, Estudios, Cirugía, Lentes y Otros / Gasto.
- Estudio obligatorio para el concepto Estudios.
- Coseguro Sí/No obligatorio para Cirugía + Obra Social.
- Cierre de efectivo por sede.
- Sincronización en tiempo real y documentos independientes para trabajar desde varias computadoras.
- Anulación lógica para la operatoria normal. El Médico dispone de un reinicio controlado que elimina solo movimientos manuales y cierres de prueba; el histórico CDU queda protegido.
- Exportación `.xlsx` con las hojas MOVIMIENTOS, CIERRES, RESUMEN_DIARIO, RESUMEN_MENSUAL e INFO.
- Reglas de Firestore y una suite de pruebas para impedir accesos entre sedes.

## Arquitectura

```text
GitHub Pages (Vite)
  ├─ Firebase Authentication (email + contraseña)
  ├─ Cloud Firestore
  │   ├─ users/{uid}
  │   ├─ movimientos/{id}
  │   ├─ cierres/{CDU|GUA_YYYYMMDD}
  │   └─ configuracion/catalogos
  └─ ExcelJS para generar el respaldo Excel en el navegador
```

No se usan Cloud Functions, servidores pagos ni facturación. El proyecto está preparado para Firebase Spark.

## Configuración Firebase

El proyecto productivo definitivo es **`caja-clinicas-online`**. La configuración Web pública está fijada en `src/firebase.js`; no se necesitan secretos de GitHub Actions para compilar GitHub Pages.

1. Usar el proyecto Firebase `caja-clinicas-online`.
2. Mantener Authentication con proveedor Email/Password.
3. Usar Cloud Firestore en modo producción.
4. Publicar `firestore.rules` y `firestore.indexes.json`:

```bash
npx firebase-tools use --add
npx firebase-tools deploy --only firestore:rules,firestore:indexes
```

La configuración Web de Firebase identifica la aplicación pero no concede acceso por sí sola. La seguridad real está en Authentication y `firestore.rules`. Nunca guardar contraseñas, claves privadas ni archivos de cuenta de servicio en el repositorio.

## Crear los tres accesos

Crear los usuarios en Firebase Authentication y luego crear un documento en `users/{uid}` para cada uno.

Administrativa CDU:

```json
{ "role": "administrativo", "clinica": "CDU", "active": true }
```

Administrativa GUA:

```json
{ "role": "administrativo", "clinica": "GUA", "active": true }
```

Médico / Supervisor:

```json
{ "role": "medico", "clinica": "AMBAS", "active": true }
```

Las cuentas administrativas pueden permanecer abiertas en varias computadoras. No se guarda quién operó cada movimiento; solo la sede.

Para cambiar una contraseña, usar Firebase Console → Authentication → Users. Las contraseñas nunca forman parte del código.

## Catálogos

El documento opcional `configuracion/catalogos` puede contener:

```json
{
  "estudios": ["OCT", "Paquimetría", "Topografía", "HRT", "YAG", "Campimetría / CV"],
  "obrasSociales": ["PAMI", "OSER", "IOSPER", "SANCOR SALUD", "OSPE"],
  "mediosPago": ["Efectivo", "Transferencia", "Otro"]
}
```

Si el documento no existe, la aplicación usa esos valores predeterminados. Solo el Médico puede modificar este documento según las reglas.

## Histórico CDU

El histórico preparado actual contiene 506 movimientos de CDU. Los datos personales quedan fuera del repositorio y de GitHub Pages.

Preparar el archivo privado:

```bash
npm run prepare:historical -- ../reconstructed/Caja_Clinicas_CDU_Gualeguaychu_v2.html
```

Esto crea `private-data/historico-cdu.preparado.json`, una ruta excluida por `.gitignore`. Desde Respaldo, el Médico selecciona ese archivo y ejecuta la importación. Los IDs `historico-cdu-0001` a `historico-cdu-0506` son determinísticos. La importación consulta primero cada ID: si ya existe, conserva `createdAt` y actualiza el mismo documento; si no existe, lo crea. Al finalizar se verifica que Firestore contenga exactamente los IDs seleccionados, sin duplicados.

## Desarrollo y pruebas

```bash
npm install
npm test
npm run test:rules
npm run build
```

`npm run test:rules` usa exclusivamente el emulador local de Firestore. Comprueba CDU, GUA, Médico, accesos cruzados, escritura, anulación, cierres y concurrencia.

Para una prueba visual con cuentas y movimientos ficticios:

```bash
npx firebase-tools emulators:start --only auth,firestore
npm run seed:emulator
VITE_USE_EMULATORS=true npm run dev
```

## Respaldo Excel

El botón Respaldo solo aparece para el Médico. Descarga `Caja_Clinicas_Respaldo_YYYY-MM-DD.xlsx`. Los importes se guardan como números, las fechas como fechas de Excel, los encabezados tienen filtros y ARS/USD permanecen separados.

## Publicación

El flujo `.github/workflows/deploy-pages.yml` ejecuta pruebas de lógica, pruebas de reglas de Firestore, compila cada cambio en `main` y publica `dist` en GitHub Pages.

No se requieren secretos de Firebase en GitHub Actions: la configuración Web del proyecto es pública y no concede permisos por sí sola. La seguridad real permanece en Authentication y `firestore.rules`.

Requisitos:
1. Elegir GitHub Actions como origen de Pages en Settings → Pages.
2. Mantener `catalogodervie.github.io` dentro de Firebase Authentication → Settings → Authorized domains.

La compilación nunca incorpora archivos con datos históricos.

## Seguridad operativa

- Las administrativas leen exclusivamente su propia sede y solo un día por vez.
- Pueden consultar hoy y los 7 días anteriores; únicamente hoy admite altas, ediciones, anulaciones y cierre.
- Las consultas incluyen los filtros que exigen las reglas; Firestore Rules no se usa como filtro visual.
- Clínica, fecha y fuente no se pueden alterar luego de guardar.
- Un cierre usa la clave operativa argentina (`CDU_YYYYMMDD` o `GUA_YYYYMMDD`) y bloquea correcciones hasta que el Médico lo reabre.
- Solo el Médico puede reabrir cierres y ejecutar el reinicio de pruebas.
- El reinicio físico elimina solo movimientos con `source: manual` y cierres; nunca elimina `source: historico-cdu`.
- Los datos históricos no se incluyen en el código ni en la publicación.
- La fecha operativa usa `America/Argentina/Cordoba` para evitar el salto de día por UTC.
