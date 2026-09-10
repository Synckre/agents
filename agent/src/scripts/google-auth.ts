import http from 'node:http';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const PORT = 3456;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('\n❌ ERROR: Faltan las variables GOOGLE_CLIENT_ID y/o GOOGLE_CLIENT_SECRET en tu archivo .env.\n');
  console.error('Por favor, configúralas en agent/.env antes de ejecutar este script.\n');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // Fuerza a Google a entregar un nuevo refresh_token
  scope: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/drive.readonly',
  ],
});

function openBrowser(url: string) {
  const start =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
      ? 'start'
      : 'xdg-open';
  exec(`${start} "${url}"`, () => {
    // Ignorar si falla abrir automáticamente; el enlace ya se muestra en consola
  });
}

function updateEnvFile(refreshToken: string) {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return false;
  }

  let envContent = fs.readFileSync(envPath, 'utf8');
  if (envContent.includes('GOOGLE_REFRESH_TOKEN=')) {
    envContent = envContent.replace(
      /GOOGLE_REFRESH_TOKEN=.*/,
      `GOOGLE_REFRESH_TOKEN=${refreshToken}`,
    );
  } else {
    envContent += `\nGOOGLE_REFRESH_TOKEN=${refreshToken}\n`;
  }
  fs.writeFileSync(envPath, envContent, 'utf8');
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return;
    const reqUrl = new URL(req.url, REDIRECT_URI);

    if (reqUrl.searchParams.has('error')) {
      const errorMsg = reqUrl.searchParams.get('error');
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h2>❌ Error en la autorización de Google: ${errorMsg}</h2>`);
      console.error(`\n❌ Error recibido de Google: ${errorMsg}\n`);
      server.close();
      process.exit(1);
    }

    const code = reqUrl.searchParams.get('code');
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No se recibió el parámetro "code".');
      return;
    }

    const { tokens } = await oauth2Client.getToken(code);
    const refreshToken = tokens.refresh_token;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Autenticación Exitosa</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
            .card { background: #1e293b; padding: 2rem 3rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); text-align: center; max-width: 500px; }
            h1 { color: #38bdf8; margin-bottom: 0.5rem; }
            p { color: #94a3b8; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>✅ ¡Autenticación Exitosa!</h1>
            <p>Se ha generado el <strong>Refresh Token</strong> correctamente.</p>
            <p>Ya puedes cerrar esta ventana y regresar a la terminal.</p>
          </div>
        </body>
      </html>
    `);

    console.log('\n========================================================================');
    console.log('🎉 ¡AUTENTICACIÓN CON GOOGLE COMPLETADA CON ÉXITO!');
    console.log('========================================================================\n');

    if (refreshToken) {
      const updated = updateEnvFile(refreshToken);
      console.log('Tu GOOGLE_REFRESH_TOKEN es:\n');
      console.log(`GOOGLE_REFRESH_TOKEN=${refreshToken}\n`);
      if (updated) {
        console.log('✨ Se ha guardado automáticamente en tu archivo .env.');
      } else {
        console.log('👉 Cópialo y agrégalo a tu archivo .env.');
      }
    } else {
      console.warn('⚠️ No se devolvió un nuevo refresh_token (la cuenta ya tenía consentimiento previo).');
      console.warn('Si necesitas un nuevo refresh_token, revoca el acceso en https://myaccount.google.com/permissions y vuelve a ejecutar.');
    }
    console.log('\n========================================================================\n');

    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 1000);
  } catch (err) {
    console.error('\n❌ Error al procesar el callback:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Error interno al obtener el token.');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n========================================================================');
  console.log('🔑 GOOGLE CALENDAR - OAUTH2 LOGIN (Aplicación de Escritorio)');
  console.log('========================================================================\n');
  console.log('Abriendo navegador para iniciar sesión con tu cuenta de Google Calendar...\n');
  console.log('Si el navegador no se abre automáticamente, abre este enlace:\n');
  console.log(`🔗 ${authUrl}\n`);
  console.log('Esperando autorización en http://127.0.0.1:' + PORT + ' ...\n');

  openBrowser(authUrl);
});
