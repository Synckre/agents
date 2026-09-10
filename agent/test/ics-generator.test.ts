import { describe, expect, it } from 'vitest';
import { generateIcs } from '@adapters/email/ics-generator';

describe('generateIcs', () => {
  it('genera un archivo iCalendar RFC 5545 con organizador corporativo y asistente', () => {
    const start = new Date('2026-09-03T18:30:00.000Z');
    const end = new Date('2026-09-03T19:30:00.000Z');

    const ics = generateIcs({
      uid: 'evt-test-123',
      summary: 'Consulta inicial con Synckre',
      description: 'Reunión de demostración',
      start,
      end,
      organizerEmail: 'noreply@synckre.com',
      organizerName: 'Synckre',
      attendeeEmail: 'cliente@ejemplo.com',
      attendeeName: 'Carlos Pérez',
      meetLink: 'https://meet.google.com/xyz-abcd-uvw',
    });

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('UID:evt-test-123');
    expect(ics).toContain('SUMMARY:Consulta inicial con Synckre');
    expect(ics).toContain('ORGANIZER;CN=Synckre:mailto:noreply@synckre.com');
    expect(ics).toContain('ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Carlos Pérez:mailto:cliente@ejemplo.com');
    expect(ics).toContain('LOCATION:https://meet.google.com/xyz-abcd-uvw');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('utiliza noreply@synckre.com por defecto si no se especifica organizador', () => {
    const ics = generateIcs({
      uid: 'evt-default-org',
      summary: 'Cita Synckre',
      start: new Date('2026-09-04T14:00:00Z'),
      end: new Date('2026-09-04T15:00:00Z'),
    });

    expect(ics).toContain('ORGANIZER;CN=Synckre:mailto:noreply@synckre.com');
  });
});
