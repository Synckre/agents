import { describe, expect, it, vi } from 'vitest';
import { HubspotCrmAdapter } from '../src/adapters/crm/hubspot/hubspot-crm.adapter';
import { HubspotHttpClient } from '../src/adapters/crm/hubspot/hubspot-http.client';
import { ErpNextAdapter } from '../src/adapters/crm/erpnext.adapter';
import { ICrm } from '../src/core/ports/crm.port';

/**
 * Suite de conformidad del puerto `ICrm`.
 *
 * Ejecuta los mismos casos contra todas las implementaciones para garantizar que
 * el rollback (`CRM_PROVIDER=erpnext`) siga siendo una vía real y no un camino
 * sin cobertura. Cada implementación aporta su propio `fetch` simulado porque los
 * formatos de payload difieren; lo que se verifica es el comportamiento del puerto.
 */
interface CrmContract {
  readonly name: string;
  /** Construye la implementación con el fetch simulado ya instalado. */
  build(fetchImpl: ReturnType<typeof vi.fn>): ICrm;
  /** Respuesta para una búsqueda que devuelve un lead. */
  searchHit(): Response;
  /** Respuesta para una búsqueda sin resultados. */
  searchMiss(): Response;
  /** Respuesta de una creación de lead. */
  createOk(): Response;
  /** Respuesta de una lectura de lead por ID. */
  getOk(): Response;
  /** Respuesta 404 al leer un lead inexistente. */
  getNotFound(): Response;
}

const hubspotContract: CrmContract = {
  name: 'HubspotCrmAdapter',
  build(fetchImpl) {
    const client = new HubspotHttpClient({
      baseUrl: 'https://api.hubapi.com',
      apiVersion: '2026-09',
      accessToken: 'test-token',
      maxRetries: 0,
      sleep: async () => undefined,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    return new HubspotCrmAdapter({ client });
  },
  searchHit: () =>
    new Response(
      JSON.stringify({
        results: [
          {
            id: '501',
            properties: {
              firstname: 'Ana',
              lastname: 'Gómez',
              email: 'ana@example.com',
              phone: '+15551234567',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  searchMiss: () =>
    new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  createOk: () =>
    new Response(JSON.stringify({ id: '900', properties: { email: 'nuevo@example.com' } }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }),
  getOk: () =>
    new Response(
      JSON.stringify({
        id: '501',
        properties: { firstname: 'Ana', lastname: 'Gómez', email: 'ana@example.com' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  getNotFound: () =>
    new Response(JSON.stringify({ message: 'not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }),
};

const erpNextContract: CrmContract = {
  name: 'ErpNextAdapter',
  build() {
    return new ErpNextAdapter({
      baseUrl: 'https://erp.example.com',
      apiKey: 'key',
      apiSecret: 'secret',
    });
  },
  searchHit: () =>
    new Response(
      JSON.stringify({
        data: [
          {
            name: 'CRM-LEAD-0001',
            lead_name: 'Ana Gómez',
            email_id: 'ana@example.com',
            mobile_no: '+15551234567',
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  searchMiss: () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  createOk: () =>
    new Response(
      JSON.stringify({ data: { name: 'CRM-LEAD-0002', email_id: 'nuevo@example.com' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  getOk: () =>
    new Response(
      JSON.stringify({
        data: { name: 'CRM-LEAD-0001', lead_name: 'Ana Gómez', email_id: 'ana@example.com' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  getNotFound: () =>
    new Response(JSON.stringify({ exc_type: 'DoesNotExistError' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }),
};

const contracts = [hubspotContract, erpNextContract];

describe.each(contracts)('Contrato ICrm — $name', (contract) => {
  const originalFetch = globalThis.fetch;

  function setup() {
    const fetchImpl = vi.fn();
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    return { fetchImpl, crm: contract.build(fetchImpl) };
  }

  function restore() {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  }

  it('devuelve null sin consultar la red si la búsqueda no tiene criterios', async () => {
    const { fetchImpl, crm } = setup();
    try {
      await expect(crm.findLead({})).resolves.toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('encuentra un lead existente por email y expone id/email normalizados', async () => {
    const { fetchImpl, crm } = setup();
    fetchImpl.mockImplementation(async () => contract.searchHit());
    try {
      const lead = await crm.findLead({ email: 'ana@example.com' });

      expect(lead).not.toBeNull();
      expect(typeof lead?.id).toBe('string');
      expect(lead?.id.length).toBeGreaterThan(0);
      expect(lead?.email).toBe('ana@example.com');
      expect(lead?.name).toContain('Ana');
    } finally {
      restore();
    }
  });

  it('devuelve null cuando no hay coincidencias', async () => {
    const { fetchImpl, crm } = setup();
    fetchImpl.mockImplementation(async () => contract.searchMiss());
    try {
      await expect(crm.findLead({ email: 'nadie@example.com' })).resolves.toBeNull();
    } finally {
      restore();
    }
  });

  it('crea un lead y devuelve un registro con id no vacío', async () => {
    const { fetchImpl, crm } = setup();
    fetchImpl.mockImplementation(async () => contract.createOk());
    try {
      const lead = await crm.createLead({
        name: 'Nuevo Cliente',
        email: 'nuevo@example.com',
        phone: '+15559876543',
      });

      expect(lead.id).toBeTruthy();
      expect(lead.email).toBe('nuevo@example.com');
    } finally {
      restore();
    }
  });

  it('recupera un lead por id', async () => {
    const { fetchImpl, crm } = setup();
    fetchImpl.mockImplementation(async () => contract.getOk());
    try {
      const lead = await crm.getLeadById('501');
      expect(lead?.id).toBeTruthy();
      expect(lead?.email).toBe('ana@example.com');
    } finally {
      restore();
    }
  });

  it('devuelve null en lugar de lanzar cuando el id no existe', async () => {
    const { fetchImpl, crm } = setup();
    fetchImpl.mockImplementation(async () => contract.getNotFound());
    try {
      await expect(crm.getLeadById('inexistente')).resolves.toBeNull();
    } finally {
      restore();
    }
  });

  it('actualiza un lead existente sin exigir criterios de búsqueda', async () => {
    const { fetchImpl, crm } = setup();
    fetchImpl.mockImplementation(async () => contract.getOk());
    try {
      const lead = await crm.updateLead('501', { phone: '+15550001111' });
      expect(lead.id).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('propaga un error accionable cuando el proveedor rechaza la autenticación', async () => {
    const { fetchImpl, crm } = setup();
    fetchImpl.mockImplementation(
      async () =>
        new Response(JSON.stringify({ message: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    try {
      await expect(crm.findLead({ email: 'ana@example.com' })).rejects.toThrowError();
    } finally {
      restore();
    }
  });

  it('no lanza al añadir una nota vacía', async () => {
    const { crm } = setup();
    try {
      await expect(crm.appendLeadNote('501', '   ')).resolves.toBeUndefined();
    } finally {
      restore();
    }
  });
});
