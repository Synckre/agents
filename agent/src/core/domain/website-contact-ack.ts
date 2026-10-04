/**
 * Correo de acuse de recibo del formulario web.
 *
 * El objetivo no es sólo confirmar la recepción: es mostrar interés real por el
 * proyecto, invitar a una conversación y facilitar el siguiente paso, que es
 * agendar desde el asistente del sitio. Por eso el texto vive aquí como dominio
 * puro: se puede revisar y probar sin tocar el caso de uso ni el envío.
 */

/** Sitio donde vive el asistente con el que el cliente puede agendar. */
export const SYNCKRE_SITE_URL = 'https://www.synckre.com';

/** Correo de contacto que se muestra al cliente. */
export const SYNCKRE_CONTACT_EMAIL = 'customer@synckre.com';

export interface WebsiteContactAckInput {
  readonly name: string;
  readonly email?: string;
  readonly company?: string;
  readonly topic?: string;
}

export interface WebsiteContactAck {
  readonly subject: string;
  readonly title: string;
  readonly message: string;
  readonly ctaLink: string;
  readonly ctaText: string;
}

/** Primer nombre para un saludo cercano; si no hay, un saludo genérico. */
function greetingName(name: string, locale: 'es' | 'en'): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  if (first) return first;
  return locale === 'es' ? 'de nuevo' : 'there';
}

/** Menciona el asunto sólo si el cliente lo indicó, para que se note que se leyó. */
function topicClause(topic: string | undefined, locale: 'es' | 'en'): string {
  const clean = (topic ?? '').trim();
  if (!clean) return '';
  // Entrecomillado a propósito: el asunto lo escribe el cliente en el formulario y
  // puede venir en otro idioma que el del correo. Entre comillas se lee como su
  // propio texto citado, no como una frase rota.
  return locale === 'es' ? ` sobre "${clean}"` : ` about "${clean}"`;
}

/**
 * Construye el acuse de recibo. El texto invita a agendar y remite al asistente
 * del sitio, que es donde el cliente puede reservar por sí mismo.
 */
export function buildWebsiteContactAck(
  input: WebsiteContactAckInput,
  locale: 'es' | 'en' = 'es',
): WebsiteContactAck {
  const name = greetingName(input.name, locale);
  const about = topicClause(input.topic, locale);

  if (locale === 'en') {
    return {
      subject: "We'd like to help — Synckre",
      title: "We're interested in your project",
      message: [
        `Hi ${name},`,
        '',
        `Thanks for reaching out. We have read your message${about} and we are genuinely interested in your project: we want to understand what you need and help you solve it.`,
        '',
        'The most useful next step is a short conversation with our team, with no obligation at all. The quickest way to book it is through the assistant on our website: go to synckre.com and you will find the site chat, which shows the slots available right now and confirms the meeting for you on the spot.',
        '',
        'If you prefer, just reply to this email and we will get back to you.',
        '',
        'Best regards,',
        'The Synckre team',
      ].join('\n'),
      ctaLink: SYNCKRE_SITE_URL,
      ctaText: 'Book a meeting with the assistant',
    };
  }

  return {
    subject: 'Nos interesa tu proyecto — Synckre',
    title: 'Nos interesa tu proyecto',
    message: [
      `Hola ${name},`,
      '',
      `Gracias por escribirnos. Ya hemos leído tu mensaje${about} y nos interesa de verdad tu proyecto: queremos entender bien lo que necesitas y ayudarte a resolverlo.`,
      '',
      'El siguiente paso más útil es una conversación breve con nuestro equipo, sin ningún compromiso. La forma más rápida de agendarla es a través del asistente de nuestra web: entra en synckre.com y verás el chat del sitio, que te muestra los huecos disponibles en ese momento y te confirma la cita al instante.',
      '',
      'Si lo prefieres, responde a este correo y te escribimos nosotros.',
      '',
      'Un saludo,',
      'Equipo Synckre',
    ].join('\n'),
    ctaLink: SYNCKRE_SITE_URL,
    ctaText: 'Agendar una reunión con el asistente',
  };
}
