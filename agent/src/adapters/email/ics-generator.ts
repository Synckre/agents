export interface IcsEventOptions {
  readonly uid: string;
  readonly summary: string;
  readonly description?: string;
  readonly start: Date;
  readonly end: Date;
  readonly organizerEmail?: string;
  readonly organizerName?: string;
  readonly attendeeEmail?: string;
  readonly attendeeName?: string;
  readonly meetLink?: string;
  readonly method?: 'REQUEST' | 'CANCEL';
  readonly status?: 'CONFIRMED' | 'CANCELLED';
  readonly sequence?: number;
}

function formatIcsDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Genera un archivo iCalendar (.ics, RFC 5545) interactivo para adjuntar en correos de Resend.
 * Permite que clientes de correo (Gmail, Apple Mail, Outlook) muestren el botón de confirmación
 * y añadan el evento automáticamente al calendario del usuario, o lo cancelen/actualicen.
 */
export function generateIcs(options: IcsEventOptions): string {
  const organizerEmail = options.organizerEmail ?? 'noreply@synckre.com';
  const organizerName = options.organizerName ?? 'Synckre';
  const dtStamp = formatIcsDate(new Date());
  const dtStart = formatIcsDate(options.start);
  const dtEnd = formatIcsDate(options.end);
  const method = options.method ?? 'REQUEST';
  const status = options.status ?? 'CONFIRMED';
  const sequence = options.sequence ?? 0;

  let desc = options.description ?? '';
  if (options.meetLink) {
    desc = desc ? `${desc}\n\nGoogle Meet: ${options.meetLink}` : `Google Meet: ${options.meetLink}`;
  }
  const cleanDesc = desc.replace(/\n/g, '\\n');
  const location = options.meetLink ?? 'Google Meet';

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Synckre//AgentSynckre//ES',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${options.uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${options.summary}`,
    `DESCRIPTION:${cleanDesc}`,
    `LOCATION:${location}`,
    `ORGANIZER;CN=${organizerName}:mailto:${organizerEmail}`,
  ];

  if (options.attendeeEmail) {
    const attendeeName = options.attendeeName ?? options.attendeeEmail;
    lines.push(
      `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${attendeeName}:mailto:${options.attendeeEmail}`,
    );
  }

  lines.push(`STATUS:${status}`, `SEQUENCE:${sequence}`, 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR');

  return lines.join('\r\n');
}
