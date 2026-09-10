import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Esquema de validación y objeto tipado para las variables de entorno del sistema.
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

  ERPNEXT_URL: z.string().url().optional(),
  ERPNEXT_API_KEY: z.string().optional(),
  ERPNEXT_API_SECRET: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  GOOGLE_CALENDAR_TIMEZONE: z.string().default('UTC'),

  GOOGLE_DRIVE_PUBLIC_FOLDER_ID: z.string().optional(),
  GOOGLE_DRIVE_INTERNAL_FOLDER_ID: z.string().optional(),
  KNOWLEDGE_SYNC_INTERVAL_MINUTES: z.coerce.number().positive().default(180),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  INTERNAL_ALERT_EMAIL: z.string().email('INTERNAL_ALERT_EMAIL is required and must be a valid email'),
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
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
