import { CrmError } from '@core/ports/crm.port';

/**
 * Cliente HTTP de bajo nivel para la API REST de HubSpot.
 *
 * Responsabilidades:
 * - Autenticación con Private App access token.
 * - Timeout por petición.
 * - Control de caudal (token bucket) con presupuesto separado para búsquedas,
 *   porque el endpoint de search tiene un techo propio de 5 req/s por cuenta.
 * - Reintentos con backoff exponencial + jitter para 429, 423 y 5xx.
 * - Normalización de errores a `CrmError` con el `correlationId` que devuelve HubSpot.
 *
 * No conoce el modelo de CRM: solo habla HTTP.
 */

export interface HubspotErrorBody {
  status?: string;
  message?: string;
  category?: string;
  errorType?: string;
  policyName?: string;
  correlationId?: string;
  requestId?: string;
  errors?: Array<{ message?: string; code?: string; context?: Record<string, unknown> }>;
  [key: string]: unknown;
}

export interface HubspotHttpClientConfig {
  readonly baseUrl: string;
  readonly apiVersion: string;
  readonly accessToken?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly maxRequestsPerTenSeconds?: number;
  readonly maxSearchRequestsPerSecond?: number;
  /** Inyectable para tests; por defecto `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Inyectable para tests; por defecto `Date.now`. */
  readonly now?: () => number;
  /** Inyectable para tests; por defecto un `setTimeout` real. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly logger?: HubspotLogger;
}

export interface HubspotLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Tope de espera cuando HubSpot envía `Retry-After`. Un 429 de política diaria
 * puede pedir horas: dormir ese tiempo bloquearía la conversación.
 */
const MAX_RETRY_AFTER_MS = 60_000;

/** Vueltas máximas esperando cupo antes de ceder, para no bloquearse si el reloj no avanza. */
const MAX_RATE_LIMIT_SPINS = 1_000;

const defaultLogger: HubspotLogger = {
  debug: () => undefined,
  warn: (message, meta) => console.warn(message, meta ?? ''),
  error: (message, meta) => console.error(message, meta ?? ''),
};

export interface HubspotRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  /** Usa el presupuesto reducido del endpoint de búsqueda. */
  readonly search?: boolean;
  /** Clave de idempotencia lógica para los logs. */
  readonly operation?: string;
}

/**
 * Token bucket de ventana deslizante. Limita el número de peticiones concurrentes
 * sin necesidad de dependencias externas.
 */
export class RateLimiter {
  private readonly timestamps: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async acquire(): Promise<void> {
    // Serializamos la comprobación para que el cupo sea exacto bajo concurrencia.
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      let guard = 0;
      for (;;) {
        const now = this.now();
        while (this.timestamps.length > 0 && now - this.timestamps[0] >= this.windowMs) {
          this.timestamps.shift();
        }
        if (this.timestamps.length < this.maxRequests) {
          this.timestamps.push(now);
          return;
        }
        const waitMs = Math.max(1, this.windowMs - (now - this.timestamps[0]));
        await this.sleep(waitMs);

        // Si el reloj inyectado no avanza (o `sleep` no espera), el bucle no
        // progresaría nunca. Tras suficientes vueltas se cede el paso.
        guard += 1;
        if (guard > MAX_RATE_LIMIT_SPINS) {
          this.timestamps.shift();
          this.timestamps.push(this.now());
          return;
        }
      }
    } finally {
      release();
    }
  }

  /** Solo para diagnósticos y tests. */
  get pending(): number {
    return this.timestamps.length;
  }
}

function isRetryableStatus(status: number): boolean {
  // 409 no se reintenta: reintentar una escritura duplicada no la resuelve.
  return status === 429 || status === 423 || status >= 500;
}

function parseRetryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - now);
  }
  return null;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export class HubspotHttpClient {
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger: HubspotLogger;
  private readonly generalLimiter: RateLimiter;
  private readonly searchLimiter: RateLimiter;

  constructor(private readonly config: HubspotHttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken?.trim();
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.now = config.now ?? Date.now;
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.logger = config.logger ?? defaultLogger;
    this.generalLimiter = new RateLimiter(
      config.maxRequestsPerTenSeconds ?? 90,
      10_000,
      this.now,
      this.sleep,
    );
    this.searchLimiter = new RateLimiter(
      config.maxSearchRequestsPerSecond ?? 4,
      1_000,
      this.now,
      this.sleep,
    );
  }

  /** Versión de API activa, usada por los adaptadores para construir sus rutas. */
  get apiVersion(): string {
    return this.config.apiVersion;
  }

  /**
   * Verifica la configuración sin hacer red. Se invoca al construir los
   * adaptadores para que un despliegue mal configurado falle al arrancar y no
   * en la primera conversación real.
   */
  assertReady(): void {
    this.assertConfigured();
  }

  /**
   * Ejecuta una petición contra la API y devuelve el JSON ya parseado.
   * Lanza `CrmError` normalizado ante cualquier fallo definitivo.
   */
  async request<T>(path: string, options: HubspotRequestOptions = {}): Promise<T> {
    this.assertConfigured();

    const method = options.method ?? 'GET';
    const operation = options.operation ?? `${method} ${path}`;
    const limiter = options.search ? this.searchLimiter : this.generalLimiter;

    let lastError: CrmError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      // Una búsqueda consume también el cupo general: el techo de la cuenta es
      // único (~100 req/10 s), no dos presupuestos independientes.
      if (options.search) {
        await this.generalLimiter.acquire();
      }
      await limiter.acquire();

      const startedAt = this.now();
      let response: Response;
      try {
        response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
          method,
          headers: this.buildHeaders(),
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const isTimeout = error instanceof Error && error.name === 'TimeoutError';
        const crmError = new CrmError({
          code: isTimeout ? 'CRM_TIMEOUT' : 'CRM_NETWORK_ERROR',
          message: isTimeout
            ? `CRM request timed out after ${this.timeoutMs}ms (${operation})`
            : `CRM network error (${operation}): ${error instanceof Error ? error.message : String(error)}`,
          retryable: true,
        });
        if (attempt < this.maxRetries) {
          lastError = crmError;
          await this.backoff(attempt, null, operation);
          continue;
        }
        throw crmError;
      }

      const durationMs = this.now() - startedAt;

      if (response.status === 204) {
        this.logger.debug('[hubspot] request ok (no content)', { operation, durationMs });
        return undefined as T;
      }

      if (response.ok) {
        try {
          const payload = (await response.json()) as T;
          this.logger.debug('[hubspot] request ok', { operation, durationMs, attempt });
          return payload;
        } catch (error) {
          // Un 200 con cuerpo vacío o no-JSON no debe escapar como SyntaxError
          // sin normalizar: el llamador solo sabe manejar CrmError.
          throw new CrmError({
            code: 'CRM_INVALID_RESPONSE',
            message: `CRM returned an unparseable body (${operation}): ${
              error instanceof Error ? error.message : String(error)
            }`,
            status: response.status,
            retryable: false,
          });
        }
      }

      const bodyText = await response.text();
      const parsed = this.safeJson(bodyText);
      const crmError = this.toCrmError(response, parsed, bodyText, operation);

      if (isRetryableStatus(response.status) && attempt < this.maxRetries) {
        lastError = crmError;
        const retryAfter = parseRetryAfterMs(response.headers.get('Retry-After'), this.now());
        this.logger.warn('[hubspot] retryable error, backing off', {
          operation,
          status: response.status,
          attempt: attempt + 1,
          policyName: parsed?.policyName,
          retryAfterMs: retryAfter,
        });
        await this.backoff(attempt, retryAfter, operation);
        continue;
      }

      throw crmError;
    }

    throw (
      lastError ??
      new CrmError({
        code: 'CRM_UNKNOWN',
        message: `CRM request failed after ${this.maxRetries + 1} attempts (${operation})`,
        retryable: false,
      })
    );
  }

  get<T>(path: string, options: Omit<HubspotRequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, body: unknown, options: Omit<HubspotRequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  patch<T>(path: string, body: unknown, options: Omit<HubspotRequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  put<T>(path: string, body: unknown, options: Omit<HubspotRequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  delete<T>(path: string, options: Omit<HubspotRequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async backoff(attempt: number, retryAfterMs: number | null, operation: string): Promise<void> {
    // No confiamos en `Retry-After` para dormir indefinidamente: un 429 de
    // política diaria puede pedir horas, y el agent conversacional no puede
    // quedarse colgado. Se acota y se deja que el error aflore.
    const effectiveRetryAfter =
      retryAfterMs === null ? null : Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);

    const base = effectiveRetryAfter ?? Math.min(30_000, 500 * 2 ** attempt);
    // Full jitter para evitar tormentas de reintentos sincronizados.
    const waitMs =
      effectiveRetryAfter !== null ? base : Math.round(base / 2 + Math.random() * (base / 2));
    this.logger.debug('[hubspot] sleeping before retry', {
      operation,
      attempt,
      waitMs,
      retryAfterCapped: retryAfterMs !== null && retryAfterMs > MAX_RETRY_AFTER_MS,
    });
    await this.sleep(waitMs);
  }

  private safeJson(text: string): HubspotErrorBody | null {
    if (!text) return null;
    try {
      return JSON.parse(text) as HubspotErrorBody;
    } catch {
      return null;
    }
  }

  private toCrmError(
    response: Response,
    parsed: HubspotErrorBody | null,
    bodyText: string,
    operation: string,
  ): CrmError {
    const correlationId =
      parsed?.correlationId ?? response.headers.get('X-HubSpot-Correlation-Id') ?? undefined;
    const status = response.status;

    let code = 'CRM_HTTP_ERROR';
    let message = `CRM request failed (${status}) on ${operation}`;

    if (status === 401) {
      code = 'CRM_UNAUTHORIZED';
      message =
        'CRM authentication failed (401). Verify the HubSpot Private App token and that it was not revoked.';
    } else if (status === 403) {
      code = 'CRM_FORBIDDEN';
      const missing = this.extractMissingScopes(parsed);
      message = `CRM access forbidden (403) on ${operation}. The Private App is missing required scopes${
        missing.length > 0 ? `: ${missing.join(', ')}` : ''
      }.`;
    } else if (status === 404) {
      code = 'CRM_NOT_FOUND';
      message = `CRM object not found (404) on ${operation}`;
    } else if (status === 429) {
      code = 'CRM_RATE_LIMITED';
      message = `CRM rate limit exceeded (429${parsed?.policyName ? `, policy ${parsed.policyName}` : ''}) on ${operation}`;
    } else if (status === 409 || this.looksLikeConflict(parsed)) {
      code = 'CRM_CONFLICT';
      message = `CRM rejected the write as a duplicate/conflict (${status}) on ${operation}`;
    } else if (status === 423) {
      code = 'CRM_LOCKED';
      message = `CRM record locked (423) on ${operation}. Retry after the sync completes.`;
    } else if (status >= 500) {
      code = 'CRM_SERVER_ERROR';
      message = `CRM server error (${status}) on ${operation}`;
    } else if (status >= 400) {
      code = 'CRM_VALIDATION_ERROR';
      message =
        parsed?.message ??
        parsed?.errors?.[0]?.message ??
        `CRM rejected the request (${status}) on ${operation}`;
    }

    if (parsed?.message && status !== 401 && status !== 403) {
      message = `${message}: ${parsed.message}`;
    }

    return new CrmError(
      {
        code,
        message: bodyText && code === 'CRM_VALIDATION_ERROR' && !parsed?.message
          ? `${message}: ${bodyText.slice(0, 500)}`
          : message,
        status,
        category: parsed?.category,
        correlationId,
        retryable: isRetryableStatus(status),
      },
      parsed ?? bodyText,
    );
  }

  /**
   * HubSpot puede señalar un duplicado con 400 en lugar de 409, usando códigos
   * como `CONTACT_EXISTS` o `DUPLICATE_...`. Se detectan para poder recuperar el
   * registro existente en vez de fallar la escritura.
   */
  private looksLikeConflict(parsed: HubspotErrorBody | null): boolean {
    const haystack = [
      parsed?.errorType ?? '',
      parsed?.category ?? '',
      parsed?.message ?? '',
      ...(parsed?.errors ?? []).map((e) => `${e.code ?? ''} ${e.message ?? ''}`),
    ]
      .join(' ')
      .toUpperCase();
    return /\bDUPLICATE\b|ALREADY_EXISTS|CONTACT_EXISTS|CONFLICT/.test(haystack);
  }

  private extractMissingScopes(parsed: HubspotErrorBody | null): string[] {
    const scopes = new Set<string>();
    for (const error of parsed?.errors ?? []) {
      const value = error.context?.missingScopes;
      if (Array.isArray(value)) {
        for (const scope of value) {
          if (typeof scope === 'string') scopes.add(scope);
        }
      }
    }
    return [...scopes];
  }

  private assertConfigured(): void {
    if (!this.accessToken) {
      throw new CrmError({
        code: 'CRM_NOT_CONFIGURED',
        message: 'CRM is not configured: HUBSPOT_PRIVATE_APP_TOKEN is missing.',
        retryable: false,
      });
    }
  }
}
