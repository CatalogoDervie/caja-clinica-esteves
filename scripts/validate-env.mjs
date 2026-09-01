const required = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
];

const missing = required.filter((name) => !String(process.env[name] || '').trim());
if (missing.length) {
  throw new Error(`Falta configurar en GitHub Actions: ${missing.join(', ')}`);
}

console.log(`Configuración Firebase validada para ${process.env.VITE_FIREBASE_PROJECT_ID}.`);
