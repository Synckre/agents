import { EMAIL_REGEX, PHONE_REGEX } from './conversation.entity';

/**
 * Calcula la distancia de Levenshtein entre dos cadenas para detectar
 * transposiciones de caracteres, omisiones o inserciones leves.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) {
    row[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    let prev = i;
    for (let j = 1; j <= b.length; j += 1) {
      let val: number;
      if (a[i - 1] === b[j - 1]) {
        val = row[j - 1];
      } else {
        val = Math.min(row[j - 1], prev, row[j]) + 1;
      }
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }

  return row[b.length];
}

function areEmailsSimilar(candidate: string, confirmed: string): boolean {
  const normCand = candidate.trim().toLowerCase();
  const normConf = confirmed.trim().toLowerCase();
  if (normCand === normConf) return true;

  const [localCand, domainCand] = normCand.split('@');
  const [localConf, domainConf] = normConf.split('@');

  if (!domainCand || !domainConf) return false;

  // Si el dominio coincide
  if (domainCand === domainConf && localCand && localConf) {
    if (localCand.includes(localConf) || localConf.includes(localCand)) return true;
    if (levenshteinDistance(localCand, localConf) <= 3) return true;
  }

  // O si los dominios difieren por un error tipográfico mínimo (ej: gmail.com vs gmai.com)
  if (levenshteinDistance(normCand, normConf) <= 3) return true;

  return false;
}

function arePhonesSimilar(candidate: string, confirmed: string): boolean {
  const digitsCand = candidate.replace(/\D/g, '');
  const digitsConf = confirmed.replace(/\D/g, '');

  if (digitsCand.length < 5 || digitsConf.length < 5) return false;
  if (digitsCand === digitsConf) return true;
  if (digitsCand.endsWith(digitsConf) || digitsConf.endsWith(digitsCand)) return true;

  const candSuffix = digitsCand.slice(-8);
  const confSuffix = digitsConf.slice(-8);
  if (levenshteinDistance(candSuffix, confSuffix) <= 2) return true;

  return levenshteinDistance(digitsCand, digitsConf) <= 2;
}

export interface ConfirmedStructuredData {
  readonly email?: string;
  readonly phone?: string;
  readonly meetLink?: string;
  readonly date?: string;
  readonly time?: string;
  readonly name?: string;
}

/**
 * Extrae objetos estructurados `confirmed` desde los payloads devueltos por las herramientas ejecutadas.
 */
export function extractConfirmedData(toolPayloads: unknown[]): ConfirmedStructuredData[] {
  const results: ConfirmedStructuredData[] = [];

  for (const payload of toolPayloads) {
    if (!payload || typeof payload !== 'object') continue;
    const p = payload as Record<string, unknown>;

    // 1. Bloque `confirmed` explícito
    if (p.confirmed && typeof p.confirmed === 'object') {
      const c = p.confirmed as Record<string, unknown>;
      results.push({
        email: typeof c.email === 'string' ? c.email : typeof c.to === 'string' ? c.to : undefined,
        phone: typeof c.phone === 'string' ? c.phone : undefined,
        meetLink: typeof c.meetLink === 'string' ? c.meetLink : undefined,
        date: typeof c.date === 'string' ? c.date : undefined,
        time: typeof c.time === 'string' ? c.time : undefined,
        name: typeof c.name === 'string' ? c.name : typeof c.attendeeName === 'string' ? c.attendeeName : undefined,
      });
    }

    // 2. Fallbacks de compatibilidad hacia propiedades de entidad
    if (p.appointment && typeof p.appointment === 'object') {
      const appt = p.appointment as Record<string, unknown>;
      results.push({
        email: typeof appt.attendeeEmail === 'string' ? appt.attendeeEmail : undefined,
        meetLink: typeof appt.meetLink === 'string' ? appt.meetLink : undefined,
        name: typeof appt.attendeeName === 'string' ? appt.attendeeName : undefined,
      });
    }

    if (p.lead && typeof p.lead === 'object') {
      const lead = p.lead as Record<string, unknown>;
      results.push({
        email: typeof lead.email === 'string' ? lead.email : undefined,
        phone: typeof lead.phone === 'string' ? lead.phone : undefined,
        name: typeof lead.name === 'string' ? lead.name : undefined,
      });
    }
  }

  return results;
}

/**
 * Interpola literalmente los valores confirmados por las herramientas (email, teléfono, meetLink)
 * dentro de la respuesta en prosa del asistente, corrigiendo cualquier transposición, omisión
 * o error de redacción generado de memoria por el LLM.
 */
export function interpolateConfirmedValues(content: string, toolPayloads: unknown[]): string {
  if (!content || typeof content !== 'string') {
    return content;
  }

  const confirmedList = extractConfirmedData(toolPayloads);
  if (confirmedList.length === 0) {
    return content;
  }

  let result = content;

  // 1. Interpolación y corrección de Emails
  const confirmedEmails = confirmedList
    .map((c) => c.email)
    .filter((e): e is string => typeof e === 'string' && e.trim().length > 0);

  for (const confirmedEmail of confirmedEmails) {
    // Reemplazar marcadores de posición si existen
    result = result.replace(/\{\{\s*email\s*\}\}/gi, confirmedEmail);
    result = result.replace(/\{\s*email\s*\}/gi, confirmedEmail);

    // Buscar cualquier email en el texto generado por el LLM
    const foundInText = result.match(EMAIL_REGEX);
    if (foundInText) {
      for (const found of foundInText) {
        if (areEmailsSimilar(found, confirmedEmail)) {
          // Reemplazo literal por el valor exacto confirmado
          result = result.replace(found, confirmedEmail);
        }
      }
    }
  }

  // 2. Interpolación y corrección de Teléfonos
  const confirmedPhones = confirmedList
    .map((c) => c.phone)
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0);

  for (const confirmedPhone of confirmedPhones) {
    result = result.replace(/\{\{\s*phone\s*\}\}/gi, confirmedPhone);
    result = result.replace(/\{\s*phone\s*\}/gi, confirmedPhone);

    const foundInText = result.match(PHONE_REGEX);
    if (foundInText) {
      for (const found of foundInText) {
        if (arePhonesSimilar(found, confirmedPhone)) {
          result = result.replace(found, confirmedPhone);
        }
      }
    }
  }

  // 3. Interpolación y corrección de Google Meet Link
  const confirmedMeetLinks = confirmedList
    .map((c) => c.meetLink)
    .filter((m): m is string => typeof m === 'string' && m.trim().length > 0);

  for (const confirmedMeet of confirmedMeetLinks) {
    result = result.replace(/\{\{\s*meetLink\s*\}\}/gi, confirmedMeet);
    result = result.replace(/\{\s*meetLink\s*\}/gi, confirmedMeet);

    const meetRegex = /https:\/\/meet\.google\.com\/[a-zA-Z0-9_-]+/g;
    const foundInText = result.match(meetRegex);
    if (foundInText) {
      for (const found of foundInText) {
        if (found !== confirmedMeet) {
          result = result.replace(found, confirmedMeet);
        }
      }
    }
  }

  return result;
}
