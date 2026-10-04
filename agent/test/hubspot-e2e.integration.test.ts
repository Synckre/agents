import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeHubspotServer } from './helpers/fake-hubspot-server';
import { HubspotHttpClient } from '@adapters/crm/hubspot/hubspot-http.client';
import { HubspotCrmAdapter } from '@adapters/crm/hubspot/hubspot-crm.adapter';
import { HubspotSchedulingAdapter } from '@adapters/crm/hubspot/hubspot-scheduling.adapter';
import { ConfigSchedulingPolicyProvider } from '@adapters/crm/config-scheduling-policy.provider';
import { InMemoryStore } from '@adapters/persistence/in-memory-store.adapter';
import { AppendLeadNoteTool } from '@adapters/tools/append-lead-note.tool';
import { CancelAppointmentTool } from '@adapters/tools/cancel-appointment.tool';
import { SaveLeadTool } from '@adapters/tools/save-lead.tool';
import { ScheduleAppointmentTool } from '@adapters/tools/schedule-appointment.tool';
import { SearchLeadTool } from '@adapters/tools/search-lead.tool';
import { IToolContext } from '@adapters/tools/tool-context';
import { CONVERSATION_META } from '@core/domain/conversation.entity';
import { ProcessWebsiteContactUseCase } from '@core/use-cases/process-website-contact.use-case';
import { ICalendar } from '@core/ports/calendar.port';
import { IEmailSender } from '@core/ports/email-sender.port';
import { IFollowupScheduler } from '@core/ports/followup-scheduler.port';

/**
 * Integración end-to-end SIN portal: los tools reales del agent hablan con los
 * adaptadores reales de HubSpot a través de un servidor que reproduce la API.
 *
 * Es la red de seguridad que faltaba: hasta ahora cada pieza se probaba con
 * fakes, así que un desajuste entre lo que el tool pide y lo que el adaptador
 * envía (o entre el id que se guarda y el que el CRM conoce) no se detectaba.
 */

const TIMEZONE = 'America/New_York';

function buildContext(memory: InMemoryStore, conversationId = 'conv-e2e'): IToolContext {
  return {
    conversationId,
    maxAppointments: 3,
    memory,
    getState: () => ({
      id: conversationId,
      messages: [{ role: 'user', content: 'Quiero agendar una reunión' }],
    }),
  };
}

function buildCalendar(overrides: Partial<ICalendar> = {}): ICalendar {
  return {
    findAvailability: vi.fn(),
    createAppointment: vi.fn(async (input: any) => ({
      id: 'gcal-event-777',
      start: input.start,
      end: input.end,
      title: input.title ?? 'Synckre Appointment',
      attendeeName: input.attendeeName,
      attendeeEmail: input.attendeeEmail,
      meetLink: 'https://meet.google.com/abc-defg-hij',
    })),
    rescheduleAppointment: vi.fn(),
    cancelAppointment: vi.fn(async () => undefined),
    listBusyBlocks: vi.fn(async () => []),
    ...overrides,
  };
}

describe('E2E: tools reales contra la API de HubSpot simulada', () => {
  let server: FakeHubspotServer;
  let restoreFetch: () => void;
  let memory: InMemoryStore;
  let crm: HubspotCrmAdapter;
  let scheduling: HubspotSchedulingAdapter;

  function buildAdapters(options: { knownContactProperties?: string[] } = {}) {
    const client = new HubspotHttpClient({
      baseUrl: 'https://api.hubapi.com',
      apiVersion: '2026-09',
      accessToken: 'fake-token',
      maxRetries: 0,
      sleep: async () => undefined,
      fetchImpl: globalThis.fetch,
    });
    crm = new HubspotCrmAdapter({
      client,
      defaultSource: 'Synckre Agent',
      noteContactAssociationTypeId: 202,
      searchCacheTtlMs: 0, // Sin caché: el E2E debe pegarle al servidor siempre.
      ...(options.knownContactProperties ? {} : {}),
    });
    scheduling = new HubspotSchedulingAdapter({
      client,
      appointmentObjectType: 'appointments',
      appointmentContactAssociationTypeId: 906,
    });
  }

  beforeEach(() => {
    server = new FakeHubspotServer();
    restoreFetch = server.install();
    memory = new InMemoryStore();
    void memory.save({ id: 'conv-e2e', messages: [] } as never);
  });

  afterEach(() => {
    restoreFetch();
    vi.restoreAllMocks();
  });

  it('flujo completo: buscar → guardar → notar → agendar → cancelar contra HubSpot', async () => {
    buildAdapters();
    const ctx = buildContext(memory);

    // ---------- 1. search_lead: no existe todavía ----------
    const searchTool = new SearchLeadTool(crm, ctx);
    const searchMiss = (await searchTool.execute({ email: 'ana@example.com' })) as {
      ok: boolean;
      lead: unknown;
    };
    expect(searchMiss.ok).toBe(true);
    expect(searchMiss.lead).toBeNull();

    // ---------- 2. save_lead: crea el contacto en HubSpot ----------
    const saveTool = new SaveLeadTool(crm, ctx);
    const saved = (await saveTool.execute({
      name: 'Ana Gómez',
      email: 'ana@example.com',
      phone: '+1 555 123 4567',
      company: 'Analytical Engines',
      notes: 'Interesada en el plan enterprise',
    })) as { ok: boolean; action: string; lead: { id: string; email?: string } };

    expect(saved.ok).toBe(true);
    expect(saved.action).toBe('created');

    // El contacto existe de verdad en el CRM simulado.
    const stored = server.recordsOfType('contacts');
    expect(stored).toHaveLength(1);
    expect(stored[0].properties.firstname).toBe('Ana');
    expect(stored[0].properties.lastname).toBe('Gómez');
    expect(stored[0].properties.email).toBe('ana@example.com');
    // Los datos que no tienen propiedad estándar van a las personalizadas.
    expect(stored[0].properties.synckre_company_name).toBe('Analytical Engines');
    expect(stored[0].properties.synckre_conversation_id).toBe('conv-e2e');

    // La conversación quedó vinculada al contacto del CRM.
    const conversation = await memory.getById('conv-e2e');
    expect(conversation?.metadata?.[CONVERSATION_META.leadId]).toBe(saved.lead.id);

    // ---------- 3. search_lead: ahora lo encuentra ----------
    const searchHit = (await searchTool.execute({ email: 'ana@example.com' })) as {
      ok: boolean;
      lead: { id: string } | null;
      bound?: boolean;
    };
    expect(searchHit.lead?.id).toBe(saved.lead.id);

    // ---------- 4. append_lead_note ----------
    const noteTool = new AppendLeadNoteTool(crm, ctx);
    const noted = (await noteTool.execute({ note: 'Pide demo de seguridad' })) as { ok: boolean };
    expect(noted.ok).toBe(true);

    // Dos notas: la que el alta del contacto llevó en `notes` y la que añade
    // después el tool de notas. Ninguna debe perderse.
    const notes = server.recordsOfType('notes');
    expect(notes).toHaveLength(2);
    const bodies = notes.map((n) => n.properties.hs_note_body);
    expect(bodies.some((b) => b.includes('Interesada en el plan enterprise'))).toBe(true);
    expect(bodies.some((b) => b.includes('demo de seguridad'))).toBe(true);
    // Todas las notas quedan asociadas al contacto de la conversación.
    for (const note of notes) {
      expect(note.associations[0].toId).toBe(saved.lead.id);
    }
    // El tool de notas agrupa la actividad por conversación.
    const appended = notes.find((n) => n.properties.hs_note_body.includes('demo de seguridad'));
    expect(appended?.properties.hs_engagement_thread_id).toBe('conv-e2e');

    // ---------- 5. schedule_appointment ----------
    const email: IEmailSender = { send: vi.fn(async () => ({ id: 'msg-1' })) };
    const followupScheduler: IFollowupScheduler = {
      schedule: vi.fn(async () => 'followup-1'),
      findDue: vi.fn(async () => []),
      claimForProcessing: vi.fn(async () => null),
      markAsSent: vi.fn(async () => undefined),
      markAsFailed: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      cancelByAppointmentId: vi.fn(async () => undefined),
    };
    const calendar = buildCalendar();

    const scheduleTool = new ScheduleAppointmentTool(
      calendar,
      ctx,
      followupScheduler,
      email,
      'ops@synckre.com',
      scheduling,
    );

    const scheduled = (await scheduleTool.execute({
      start: '2027-03-15T14:00:00',
      end: '2027-03-15T14:30:00',
      attendeeName: 'Ana Gómez',
      attendeeEmail: 'ana@example.com',
      appointmentType: 'demo',
      notes: 'Demo de seguridad',
    })) as { ok: boolean; appointmentCount: number };

    expect(scheduled.ok).toBe(true);
    expect(calendar.createAppointment).toHaveBeenCalledTimes(1);

    // La conversación guarda el id del registro espejo, para no depender de
    // traducir el id del calendario al cancelar o reprogramar.
    const afterSchedule = await memory.getById('conv-e2e');
    const recorded = (afterSchedule?.metadata?.[CONVERSATION_META.bookedAppointments] ?? []) as Array<{
      id: string;
      crmAppointmentId?: string;
    }>;
    expect(recorded).toHaveLength(1);
    expect(recorded[0].crmAppointmentId).toBeTruthy();

    // El evento de Google Calendar se espeja en el objeto de citas de HubSpot.
    const appointments = server.recordsOfType('appointments');
    expect(appointments).toHaveLength(1);
    expect(appointments[0].properties.synckre_status).toBe('SCHEDULED');
    expect(appointments[0].properties.synckre_calendar_event_id).toBe('gcal-event-777');
    expect(appointments[0].properties.synckre_customer_email).toBe('ana@example.com');
    // Queda asociada al contacto del CRM.
    expect(appointments[0].associations[0].toId).toBe(saved.lead.id);
    // El id guardado en la conversación es el del CRM, no el de Google Calendar.
    expect(recorded[0].crmAppointmentId).toBe(appointments[0].id);
    expect(recorded[0].id).toBe('gcal-event-777');
    // Y es visible para el cálculo de disponibilidad. La ventana se abre en
    // UTC porque la hora se resolvió en la zona de la empresa (America/New_York).
    const busy = await scheduling.findAppointments(
      new Date('2027-03-15T00:00:00Z'),
      new Date('2027-03-16T12:00:00Z'),
    );
    expect(busy.map((b) => b.id)).toContain(appointments[0].id);

    // ---------- 6. cancel_appointment ----------
    const cancelTool = new CancelAppointmentTool(
      calendar,
      ctx,
      email,
      'ops@synckre.com',
      scheduling,
      followupScheduler,
    );
    const cancelled = (await cancelTool.execute({ reason: 'El cliente reprograma' })) as {
      ok: boolean;
    };

    expect(cancelled.ok).toBe(true);
    expect(calendar.cancelAppointment).toHaveBeenCalledWith('gcal-event-777');

    // Este es el punto crítico: el tool sólo conoce el id del evento de Google,
    // así que el adaptador debe traducirlo al registro real de HubSpot.
    const afterCancel = server.recordsOfType('appointments');
    expect(afterCancel).toHaveLength(1);
    expect(afterCancel[0].properties.synckre_status).toBe('CANCELED');

    // Una cita cancelada ya no ocupa hueco.
    const busyAfter = await scheduling.findAppointments(
      new Date('2027-03-15T00:00:00Z'),
      new Date('2027-03-16T12:00:00Z'),
    );
    expect(busyAfter).toHaveLength(0);
  });

  it('no duplica el contacto si HubSpot rechaza el alta por duplicado', async () => {
    // Portal mínimo: sólo propiedades estándar. El reintento sin propiedades
    // personalizadas choca con el email único y ejercita la recuperación de
    // duplicados de punta a punta.
    const sparse = new FakeHubspotServer({
      knownContactProperties: ['email', 'firstname', 'lastname', 'phone'],
    });
    restoreFetch();
    restoreFetch = sparse.install();

    const client = new HubspotHttpClient({
      baseUrl: 'https://api.hubapi.com',
      apiVersion: '2026-09',
      accessToken: 'fake-token',
      maxRetries: 0,
      sleep: async () => undefined,
      fetchImpl: globalThis.fetch,
    });
    const sparseCrm = new HubspotCrmAdapter({ client, defaultSource: 'Synckre Agent' });

    // Primer contacto: se guarda sin las propiedades personalizadas.
    const first = (await new SaveLeadTool(sparseCrm, buildContext(memory)).execute({
      name: 'Ana',
      email: 'ana@example.com',
    })) as { ok: boolean; lead: { id: string } };
    expect(first.ok).toBe(true);

    // El primer contacto ya está indexado (en producción habría pasado tiempo).
    sparse.flushSearchIndex();

    // En otra conversación llega la misma persona: la búsqueda lo encuentra y
    // actualiza en lugar de crear un duplicado.
    const otherMemory = new InMemoryStore();
    void otherMemory.save({ id: 'conv-2', messages: [] } as never);

    const second = (await new SaveLeadTool(sparseCrm, buildContext(otherMemory, 'conv-2')).execute({
      name: 'Ana',
      email: 'ana@example.com',
    })) as { ok: boolean; lead: { id: string } };

    expect(second.ok).toBe(true);
    const contacts = sparse.recordsOfType('contacts');
    expect(contacts).toHaveLength(1);
    expect(second.lead.id).toBe(first.lead.id);
    // Hubo más de una creación: la segunda chocó y se recuperó el contacto.
    expect(sparse.requestCount('POST', '/contacts')).toBeGreaterThan(1);
  });

  it('el formulario web persiste el contacto, la nota y el asunto', async () => {
    buildAdapters();
    const email: IEmailSender = { send: vi.fn(async () => ({ id: 'msg-1' })) };

    const useCase = new ProcessWebsiteContactUseCase(crm, email, 'ops@synckre.com');
    const result = await useCase.execute({
      name: 'Luis Pérez',
      email: 'luis@example.com',
      company: 'Acme Corp',
      phone: '+1 555 999 8888',
      topic: 'Integraciones',
      message: 'Necesito conectar mi CRM con el chat.',
    });

    expect(result.crmPersisted).toBe(true);
    expect(result.action).toBe('created');

    const contacts = server.recordsOfType('contacts');
    expect(contacts).toHaveLength(1);
    // El mensaje del cliente va a un campo NATIVO, visible en la vista estándar
    // de HubSpot y sin depender de propiedades personalizadas.
    expect(contacts[0].properties.message).toContain('Necesito conectar mi CRM');
    expect(contacts[0].properties.synckre_topic).toBe('Integraciones');
    expect(contacts[0].properties.synckre_source).toBe('Website');
    expect(contacts[0].properties.company).toBe('Acme Corp');

    // El mensaje íntegro queda como nota asociada.
    const notes = server.recordsOfType('notes');
    expect(notes).toHaveLength(1);
    expect(notes[0].properties.hs_note_body).toContain('Necesito conectar mi CRM');
    expect(notes[0].associations[0].toId).toBe(contacts[0].id);
  });

  it('encuentra y actualiza un contacto cuyo email está sólo como secundario', async () => {
    server = new FakeHubspotServer({
      seedContacts: [{ additionalEmails: ['ana@example.com'] }],
    });
    restoreFetch();
    restoreFetch = server.install();
    server.flushSearchIndex();
    buildAdapters();

    const ctx = buildContext(memory);

    // La búsqueda por email principal no encuentra nada (el email es secundario),
    // así que entra el camino de `hs_additional_emails` con verificación.
    const found = (await new SearchLeadTool(crm, ctx).execute({
      email: 'ana@example.com',
    })) as { ok: boolean; lead: { id: string } | null };

    expect(found.lead).not.toBeNull();

    const updated = (await new SaveLeadTool(crm, ctx).execute({
      name: 'Ana',
      email: 'ana@example.com',
    })) as { ok: boolean; action: string };

    expect(updated.action).toBe('updated');
    // No debe haber creado un duplicado.
    expect(server.recordsOfType('contacts')).toHaveLength(1);
  });

  it('sigue operando antes del bootstrap de propiedades, degradando la escritura', async () => {
    // Portal sin las propiedades personalizadas: HubSpot rechaza el alta.
    buildAdapters();
    const limitedServer = new FakeHubspotServer({
      knownContactProperties: ['email', 'firstname', 'lastname', 'phone'],
    });
    restoreFetch();
    restoreFetch = limitedServer.install();

    const client = new HubspotHttpClient({
      baseUrl: 'https://api.hubapi.com',
      apiVersion: '2026-09',
      accessToken: 'fake-token',
      maxRetries: 0,
      sleep: async () => undefined,
      fetchImpl: globalThis.fetch,
    });
    const degradedCrm = new HubspotCrmAdapter({ client, defaultSource: 'Synckre Agent' });
    const ctx = buildContext(memory);

    const saved = (await new SaveLeadTool(degradedCrm, ctx).execute({
      name: 'Ana',
      email: 'ana@example.com',
    })) as { ok: boolean; lead: { id: string } };

    // El reintento sin propiedades personalizadas salva el lead en lugar de fallar.
    expect(saved.ok).toBe(true);
    const contacts = limitedServer.recordsOfType('contacts');
    expect(contacts).toHaveLength(1);
    expect(contacts[0].properties.email).toBe('ana@example.com');
    expect(contacts[0].properties.synckre_source).toBeUndefined();
  });

  it('cancela liberando el hueco aunque el portal no tenga propiedades personalizadas', async () => {
    // Reproduce el portal tal como está hoy: el objeto de citas sólo admite las
    // tres propiedades nativas, así que no hay dónde guardar el estado.
    const bare = new FakeHubspotServer({ knownAppointmentProperties: [] });
    restoreFetch();
    restoreFetch = bare.install();

    const client = new HubspotHttpClient({
      baseUrl: 'https://api.hubapi.com',
      apiVersion: '2026-09',
      accessToken: 'fake-token',
      maxRetries: 0,
      sleep: async () => undefined,
      fetchImpl: globalThis.fetch,
    });
    const bareCrm = new HubspotCrmAdapter({ client, searchCacheTtlMs: 0 });
    const bareScheduling = new HubspotSchedulingAdapter({ client });

    const memory = new InMemoryStore();
    void memory.save({ id: 'conv-bare', messages: [] } as never);
    const ctx = buildContext(memory, 'conv-bare');

    await new SaveLeadTool(bareCrm, ctx).execute({ name: 'Ana', email: 'ana@example.com' });

    const calendar = buildCalendar();
    const scheduleTool = new ScheduleAppointmentTool(
      calendar,
      ctx,
      undefined,
      undefined,
      undefined,
      bareScheduling,
    );

    const scheduled = (await scheduleTool.execute({
      start: '2027-04-20T14:00:00',
      end: '2027-04-20T14:30:00',
      attendeeName: 'Ana Gómez',
    })) as { ok: boolean };
    expect(scheduled.ok).toBe(true);

    const created = bare.recordsOfType('appointments');
    expect(created).toHaveLength(1);

    // Con la propiedad de estado ausente, HubSpot rechaza el PATCH…
    const before = await bareScheduling.findAppointments(
      new Date('2027-04-20T00:00:00Z'),
      new Date('2027-04-21T12:00:00Z'),
    );
    expect(before).toHaveLength(1);

    const cancelTool = new CancelAppointmentTool(
      calendar,
      ctx,
      undefined,
      undefined,
      bareScheduling,
    );
    const cancelled = (await cancelTool.execute({})) as { ok: boolean };

    // …y la cancelación se degrada a archivado en lugar de fallar.
    expect(cancelled.ok).toBe(true);
    expect(bare.getRecord(created[0].id)?.archived).toBe(true);

    // Lo importante: el hueco queda libre.
    const after = await bareScheduling.findAppointments(
      new Date('2027-04-20T00:00:00Z'),
      new Date('2027-04-21T12:00:00Z'),
    );
    expect(after).toHaveLength(0);
  });

  it('la política configurada se aplica sin tocar la red', async () => {
    buildAdapters();
    const provider = new ConfigSchedulingPolicyProvider({
      timezone: TIMEZONE,
      businessHours: { mon: { open: '10:00', close: '16:00' }, sat: null },
      appointmentTypes: { demo: { name: 'Demo', durationMinutes: 20 } },
    });

    const policy = await provider.getPolicy();

    expect(policy.timezone).toBe(TIMEZONE);
    expect(policy.hoursByWeekday.mon).toEqual({ open: '10:00', close: '16:00' });
    expect(policy.hoursByWeekday.sat).toBeNull();
    expect(policy.appointmentTypes.demo.durationMinutes).toBe(20);
    // Ninguna variable del servidor simulado se ha usado para la política.
    expect(server.requests).toHaveLength(0);
  });
});
