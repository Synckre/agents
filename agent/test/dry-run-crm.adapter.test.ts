import { describe, expect, it, vi } from 'vitest';
import {
  DryRunAppointmentRepository,
  DryRunCrmAdapter,
  combineScheduling,
  isDryRunId,
} from '../src/adapters/crm/noop-crm.adapter';
import { ICrm, ILead } from '../src/core/ports/crm.port';
import { IAppointmentRepository } from '../src/core/ports/appointment-repository.port';
import { ISchedulingPolicyProvider } from '../src/core/ports/scheduling-policy.port';
import { DEFAULT_SCHEDULING_POLICY } from '../src/config/scheduling-policy';

function buildCrm() {
  const inner: ICrm = {
    findLead: vi.fn(async () => null),
    getLeadById: vi.fn(async () => null),
    createLead: vi.fn(async () => {
      throw new Error('el CRM real no debe usarse para crear en dry_run');
    }),
    updateLead: vi.fn(async () => {
      throw new Error('el CRM real no debe usarse para actualizar en dry_run');
    }),
    appendLeadNote: vi.fn(async () => undefined),
  };
  return { inner, crm: new DryRunCrmAdapter(inner, () => undefined) };
}

function buildAppointments() {
  const inner: IAppointmentRepository = {
    findAppointments: vi.fn(async () => []),
    createAppointment: vi.fn(async () => {
      throw new Error('el CRM real no debe usarse para crear citas en dry_run');
    }),
    cancelAppointment: vi.fn(async () => {
      throw new Error('el CRM real no debe usarse para cancelar en dry_run');
    }),
    rescheduleAppointment: vi.fn(async () => {
      throw new Error('el CRM real no debe usarse para reprogramar en dry_run');
    }),
  };
  return { inner, repo: new DryRunAppointmentRepository(inner, () => undefined) };
}

describe('DryRunCrmAdapter', () => {
  it('crea contactos sintéticos sin tocar el CRM real', async () => {
    const { inner, crm } = buildCrm();

    const lead = await crm.createLead({ name: 'Ana', email: 'ana@example.com' });

    expect(isDryRunId(lead.id)).toBe(true);
    expect(inner.createLead).not.toHaveBeenCalled();
  });

  it('resuelve por id un contacto sintético en lugar de enviarlo al CRM real', async () => {
    const { inner, crm } = buildCrm();
    const created = await crm.createLead({ name: 'Ana', email: 'ana@example.com' });

    const found = await crm.getLeadById(created.id);

    expect(found?.id).toBe(created.id);
    // Antes este id sintético se reenviaba a HubSpot y provocaba un 400.
    expect(inner.getLeadById).not.toHaveBeenCalled();
  });

  it('encuentra un contacto sintético por email y por teléfono', async () => {
    const { crm } = buildCrm();
    await crm.createLead({ name: 'Ana', email: 'ana@example.com', phone: '+1 555 123 4567' });

    await expect(crm.findLead({ email: 'ANA@example.com' })).resolves.toMatchObject({
      email: 'ana@example.com',
    });
    await expect(crm.findLead({ phone: '5551234567' })).resolves.toMatchObject({
      phone: '+1 555 123 4567',
    });
  });

  it('delega las lecturas de ids reales en el CRM subyacente', async () => {
    const { inner, crm } = buildCrm();
    const real: ILead = { id: '501', email: 'real@example.com' };
    (inner.getLeadById as ReturnType<typeof vi.fn>).mockResolvedValue(real);

    await expect(crm.getLeadById('501')).resolves.toEqual(real);
    expect(inner.getLeadById).toHaveBeenCalledWith('501');
  });

  it('conserva los datos previos al actualizar un contacto sintético', async () => {
    const { crm } = buildCrm();
    const created = await crm.createLead({ name: 'Ana', email: 'ana@example.com' });

    const updated = await crm.updateLead(created.id, { phone: '+1 555 000 1111' });

    expect(updated.id).toBe(created.id);
    // El nombre no se pierde cuando el draft solo trae el teléfono.
    expect(updated.name).toBe('Ana');
    expect(updated.phone).toBe('+1 555 000 1111');
  });

  it('no envía notas al CRM real en dry_run', async () => {
    const { inner, crm } = buildCrm();

    await crm.appendLeadNote('501', 'nota');

    expect(inner.appendLeadNote).not.toHaveBeenCalled();
  });
});

describe('DryRunAppointmentRepository', () => {
  it('crea citas sintéticas sin tocar el CRM real', async () => {
    const { inner, repo } = buildAppointments();

    const appointment = await repo.createAppointment({
      scheduledTime: '2026-11-10T15:00:00.000Z',
      customerName: 'Ana',
    });

    expect(isDryRunId(appointment.id)).toBe(true);
    expect(inner.createAppointment).not.toHaveBeenCalled();
  });

  it('resuelve cancelar y reprogramar sobre la cita sintética', async () => {
    const { inner, repo } = buildAppointments();
    const appointment = await repo.createAppointment({
      scheduledTime: '2026-11-10T15:00:00.000Z',
      customerName: 'Ana',
      email: 'ana@example.com',
    });

    await repo.cancelAppointment(appointment.id);
    const rescheduled = await repo.rescheduleAppointment(
      appointment.id,
      '2026-11-12T09:00:00.000Z',
    );

    expect(rescheduled.id).toBe(appointment.id);
    expect(rescheduled.scheduledTime).toBe('2026-11-12T09:00:00.000Z');
    expect(inner.cancelAppointment).not.toHaveBeenCalled();
    expect(inner.rescheduleAppointment).not.toHaveBeenCalled();
  });

  it('delega las lecturas de disponibilidad en el repositorio real', async () => {
    const { inner, repo } = buildAppointments();

    await repo.findAppointments(new Date('2026-11-10T00:00:00Z'), new Date('2026-11-11T00:00:00Z'));

    expect(inner.findAppointments).toHaveBeenCalled();
  });
});

describe('combineScheduling', () => {
  it('expone la política y delega las citas en el repositorio indicado', async () => {
    const policy: ISchedulingPolicyProvider = {
      getPolicy: vi.fn(async () => DEFAULT_SCHEDULING_POLICY),
    };
    const { inner, repo } = buildAppointments();

    const combined = combineScheduling(policy, repo);

    await expect(combined.getPolicy()).resolves.toEqual(DEFAULT_SCHEDULING_POLICY);
    await combined.findAppointments('2026-11-10T00:00:00Z', '2026-11-11T00:00:00Z');
    expect(inner.findAppointments).toHaveBeenCalled();
  });
});
