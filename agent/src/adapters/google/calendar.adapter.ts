import { randomUUID } from 'node:crypto';
import {
  IAppointment,
  ICalendar,
  ICreateAppointmentInput,
  ITimeRange,
  ITimeSlot,
} from '@core/ports/calendar.port';
import { GoogleAdapter } from './google.adapter';

export interface GoogleCalendarConfig {
  readonly calendarId?: string;
  readonly timeZone?: string;
}

function overlaps(a: ITimeRange, b: ITimeRange): boolean {
  return (
    new Date(a.start).getTime() < new Date(b.end).getTime() &&
    new Date(a.end).getTime() > new Date(b.start).getTime()
  );
}

/**
 * Implementación de ICalendar sobre el cliente Calendar de GoogleAdapter.
 */
export class GoogleCalendarAdapter implements ICalendar {
  constructor(
    private readonly google: GoogleAdapter,
    private readonly config: GoogleCalendarConfig,
  ) {}

  async listBusyBlocks(range: ITimeRange): Promise<ITimeRange[]> {
    const calendarId = this.requireCalendarId();
    const timeZone = this.config.timeZone ?? 'UTC';

    const response = await this.google.calendar().freebusy.query({
      requestBody: {
        timeMin: range.start,
        timeMax: range.end,
        timeZone,
        items: [{ id: calendarId }],
      },
    });

    return (response.data.calendars?.[calendarId]?.busy ?? [])
      .filter((block): block is { start: string; end: string } => Boolean(block.start && block.end))
      .map((block) => ({ start: block.start, end: block.end }));
  }

  async findAvailability(range: ITimeRange, slotMinutes = 30): Promise<ITimeSlot[]> {
    const busy = await this.listBusyBlocks(range);

    const slots: ITimeSlot[] = [];
    const step = slotMinutes * 60_000;
    const startMs = new Date(range.start).getTime();
    const endMs = new Date(range.end).getTime();
    const maxSlots = 48;

    for (let cursor = startMs; cursor + step <= endMs && slots.length < maxSlots; cursor += step) {
      const candidate: ITimeSlot = {
        start: new Date(cursor).toISOString(),
        end: new Date(cursor + step).toISOString(),
      };
      if (!busy.some((block) => overlaps(candidate, block))) {
        slots.push(candidate);
      }
    }

    return slots;
  }

  async createAppointment(input: ICreateAppointmentInput): Promise<IAppointment> {
    const calendarId = this.requireCalendarId();
    const timeZone = this.config.timeZone ?? 'UTC';
    const title = input.title ?? `Appointment with ${input.attendeeName}`;

    const requestId = randomUUID();
    const response = await this.google.calendar().events.insert({
      calendarId,
      sendUpdates: 'none',
      conferenceDataVersion: 1,
      requestBody: {
        summary: title,
        description: input.notes ?? '',
        start: { dateTime: input.start, timeZone },
        end: { dateTime: input.end, timeZone },
        attendees: input.attendeeEmail
          ? [{ email: input.attendeeEmail, displayName: input.attendeeName }]
          : undefined,
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      },
    });

    const meetLink =
      response.data.hangoutLink ??
      response.data.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === 'video')?.uri;

    return {
      id: response.data.id ?? 'unknown',
      start: response.data.start?.dateTime ?? input.start,
      end: response.data.end?.dateTime ?? input.end,
      attendeeName: input.attendeeName,
      attendeeEmail: input.attendeeEmail,
      title,
      meetLink: meetLink ?? undefined,
    };
  }

  async rescheduleAppointment(appointmentId: string, range: ITimeRange): Promise<IAppointment> {
    const calendarId = this.requireCalendarId();
    const timeZone = this.config.timeZone ?? 'UTC';

    const response = await this.google.calendar().events.patch({
      calendarId,
      eventId: appointmentId,
      sendUpdates: 'none',
      requestBody: {
        start: { dateTime: range.start, timeZone },
        end: { dateTime: range.end, timeZone },
      },
    });

    const attendee = response.data.attendees?.[0];
    const meetLink =
      response.data.hangoutLink ??
      response.data.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === 'video')?.uri;

    return {
      id: response.data.id ?? appointmentId,
      start: response.data.start?.dateTime ?? range.start,
      end: response.data.end?.dateTime ?? range.end,
      attendeeName: attendee?.displayName ?? 'Attendee',
      attendeeEmail: attendee?.email ?? undefined,
      title: response.data.summary ?? 'Appointment rescheduled',
      meetLink: meetLink ?? undefined,
    };
  }

  async cancelAppointment(appointmentId: string): Promise<void> {
    const calendarId = this.requireCalendarId();
    await this.google.calendar().events.delete({
      calendarId,
      eventId: appointmentId,
      sendUpdates: 'none',
    });
  }

  private requireCalendarId(): string {
    if (!this.config.calendarId) {
      throw new Error('GOOGLE_CALENDAR_ID is not configured');
    }
    return this.config.calendarId;
  }
}
