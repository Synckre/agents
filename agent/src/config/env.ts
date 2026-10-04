import dotenv from 'dotenv';
import { z } from 'zod';
import { parseAppointmentTypes, parseBusinessHours } from './scheduling-env';

dotenv.config();

/**
 * Esquema de validación y objeto tipado para las variables de entorno del sistema.
 *
 * Deliberadamente pequeño en lo que respecta a HubSpot y a la agenda: los valores
 * ya verificados contra el portal viven como constantes en `@config/hubspot.config`
 * y la política de agendamiento en la base de datos. Lo que queda aquí es lo que de
 * verdad hay que configurar por entorno.
 *
 * Criterio de fallo: solo interrumpen el arranque las variables **esenciales**
 * (credenciales del CRM, de las que depende todo). Las que son semilla o respaldo
 * se avisan y se degradan, porque tumbar el servicio por ellas deja a la empresa
 * sin chat ni formulario.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  LLM_PROVIDER: z.enum(['openai', 'deepseek', 'anthropic']).default('openai'),
  LLM_API_KEY: z.string().min(1, 'LLM_API_KEY is required'),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_MODEL: z.string().default('gpt-4o'),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  DATABASE_URL: z.string().optional(),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(1).default('dev-session-secret-change-me'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  MAX_TOOL_ITERATIONS: z.coerce.number().int().positive().default(8),

  // ---------------------------------------------------------------------------
  // CRM
  // ---------------------------------------------------------------------------
  /**
   * Proveedor activo. OJO: por defecto es `hubspot`; con el token vacío el
   * proceso NO arranca (fail-fast deliberado). Antes del corte define
   * explícitamente `erpnext`.
   */
  CRM_PROVIDER: z.enum(['hubspot', 'erpnext']).default('hubspot'),
  /** `dry_run` registra las escrituras sin tocar el CRM. */
  CRM_WRITE_MODE: z.enum(['live', 'dry_run']).default('live'),

  /** Única credencial de HubSpot que hay que configurar (Private App token). */
  HUBSPOT_PRIVATE_APP_TOKEN: z.string().optional(),
  /**
   * Host de la API. Se deja configurable porque el data residency EU usa
   * `https://api.hubapi.eu`; para el resto de portales el valor por defecto vale.
   */
  HUBSPOT_API_BASE_URL: z.string().url().default('https://api.hubapi.com'),

  // --- ERPNext (legacy: solo se usa si CRM_PROVIDER=erpnext) ---
  ERPNEXT_URL: z.string().url().optional(),
  ERPNEXT_API_KEY: z.string().optional(),
  ERPNEXT_API_SECRET: z.string().optional(),

  // ---------------------------------------------------------------------------
  // Política de agendamiento: SEMILLA y RESPALDO, no la fuente de verdad.
  // La fuente de verdad son las tablas `scheduling_*` de la base de datos.
  // ---------------------------------------------------------------------------
  SCHEDULING_TIMEZONE: z.string().default('America/New_York'),
  /**
   * Formato compacto (recomendado, sobrevive a cualquier panel de despliegue):
   *   mon=09:00-18:00,tue=09:00-18:00,sat=closed
   * También se acepta JSON, por compatibilidad.
   * Un valor mal formado NO interrumpe el arranque.
   */
  SCHEDULING_BUSINESS_HOURS: z
    .string()
    .optional()
    .transform((raw) => parseBusinessHours(raw)),
  /**
   * Formato compacto (recomendado):
   *   general=30,demo=30:Demostración,consultation=45:Consultoría
   * También se acepta JSON, por compatibilidad.
   */
  SCHEDULING_APPOINTMENT_TYPES: z
    .string()
    .optional()
    .transform((raw) => parseAppointmentTypes(raw)),
  SCHEDULING_HOLIDAYS: z
    .string()
    .optional()
    .transform((raw) =>
      (raw ?? '')
        .split(',')
        .map((d) => d.trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ),
  SCHEDULING_MAX_APPOINTMENTS_PER_DAY: z.coerce.number().int().positive().default(8),
  SCHEDULING_SLOT_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  SCHEDULING_POLICY_CACHE_TTL_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  GOOGLE_CALENDAR_TIMEZONE: z.string().default('UTC'),

  GOOGLE_DRIVE_PUBLIC_FOLDER_ID: z.string().optional(),
  GOOGLE_DRIVE_INTERNAL_FOLDER_ID: z.string().optional(),
  KNOWLEDGE_SYNC_INTERVAL_MINUTES: z.coerce.number().positive().default(180),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Synckre <customer@synckre.com>'),
  INTERNAL_ALERT_EMAIL: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.string().email('INTERNAL_ALERT_EMAIL must be a valid email').optional()
  ),
  SYNCKRE_API_KEY: z.string().optional(),

  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),

  FOLLOWUP_CHECK_INTERVAL_MINUTES: z.coerce.number().positive().default(60),
  FOLLOWUP_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  FOLLOWUP_MAX_RETRIES: z.coerce.number().int().positive().default(3),
  FOLLOWUP_STALE_PROCESSING_MINUTES: z.coerce.number().positive().default(15),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production' && !data.SYNCKRE_API_KEY?.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['SYNCKRE_API_KEY'],
      message: 'SYNCKRE_API_KEY is required in production',
    });
  }

  if (data.NODE_ENV !== 'production') return;

  // En producción el proveedor seleccionado debe estar completamente configurado.
  if (data.CRM_PROVIDER === 'hubspot' && !data.HUBSPOT_PRIVATE_APP_TOKEN?.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['HUBSPOT_PRIVATE_APP_TOKEN'],
      message:
        'HUBSPOT_PRIVATE_APP_TOKEN is required when CRM_PROVIDER=hubspot. ' +
        'Si todavía no has hecho el corte, define CRM_PROVIDER=erpnext.',
    });
  }

  if (
    data.CRM_PROVIDER === 'erpnext' &&
    !(data.ERPNEXT_URL?.trim() && data.ERPNEXT_API_KEY?.trim() && data.ERPNEXT_API_SECRET?.trim())
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['ERPNEXT_URL'],
      message: 'ERPNEXT_URL / ERPNEXT_API_KEY / ERPNEXT_API_SECRET are required when CRM_PROVIDER=erpnext',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[env] invalid configuration:');
  for (const issue of parsed.error.issues) {
    const field = issue.path.join('.') || '(root)';
    console.error(`  - ${field}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
