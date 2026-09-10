import { describe, expect, it, vi } from 'vitest';
import { AppendLeadNoteTool } from '@adapters/tools/append-lead-note.tool';
import { InMemoryStore } from '@adapters/persistence/in-memory-store.adapter';
import { IToolContext } from '@adapters/tools/tool-context';
import { ICrm } from '@core/ports/crm.port';
import { Conversation } from '@core/domain/conversation.entity';

describe('AppendLeadNoteTool', () => {
  it('rechaza agregar nota si no hay lead vinculado a la conversación', async () => {
    const memory = new InMemoryStore();
    await memory.save(new Conversation({ id: 'c1', messages: [] }));

    const mockCrm: ICrm = {
      findLead: vi.fn(),
      getLeadById: vi.fn(),
      createLead: vi.fn(),
      updateLead: vi.fn(),
      appendLeadNote: vi.fn(),
    };

    const ctx: IToolContext = {
      conversationId: 'c1',
      maxAppointments: 3,
      memory,
      getState: () => ({ id: 'c1', messages: [] }),
    };

    const tool = new AppendLeadNoteTool(mockCrm, ctx);
    const res = await tool.execute({ note: 'Cliente interesado en agente conversacional' });

    expect(res).toMatchObject({ ok: false });
    expect(mockCrm.appendLeadNote).not.toHaveBeenCalled();
  });

  it('guarda la nota en ERPNext cuando hay un lead vinculado', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({ id: 'c1', messages: [] }).bindLead('CRM-LEAD-100');
    await memory.save(conv);

    const mockCrm: ICrm = {
      findLead: vi.fn(),
      getLeadById: vi.fn(),
      createLead: vi.fn(),
      updateLead: vi.fn(),
      appendLeadNote: vi.fn().mockResolvedValue(undefined),
    };

    const ctx: IToolContext = {
      conversationId: 'c1',
      maxAppointments: 3,
      memory,
      getState: () => ({ id: 'c1', messages: [] }),
    };

    const tool = new AppendLeadNoteTool(mockCrm, ctx);
    const res = await tool.execute({ note: 'Presupuesto estimado: $5,000 USD' });

    expect(res).toMatchObject({ ok: true, leadId: 'CRM-LEAD-100' });
    expect(mockCrm.appendLeadNote).toHaveBeenCalledWith('CRM-LEAD-100', 'Presupuesto estimado: $5,000 USD');
  });
});
