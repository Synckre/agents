import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubspotCrmAdapter } from '../src/adapters/crm/hubspot/hubspot-crm.adapter';
import { HubspotHttpClient } from '../src/adapters/crm/hubspot/hubspot-http.client';
import { CrmError } from '../src/core/ports/crm.port';
import { CONTACT_PROPERTIES, OPTIONAL_CONTACT_PROPERTIES } from '../src/adapters/crm/hubspot/hubspot-mapping';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * `contactProperties` controla qué responde la sonda de propiedades del objeto:
 *  - un array  -> el portal tiene esas propiedades (se filtran antes de escribir)
 *  - null      -> la sonda falla (p. ej. falta el scope de schema), así que el
 *                 adaptador escribe todo y se ejercita el reintento degradado
 */
function buildAdapter(
  overrides: { noteContactAssociationTypeId?: number; contactProperties?: string[] | null } = {},
) {
  const fetchImpl = vi.fn();

  const probeList =
    overrides.contactProperties === null
      ? null
      : (overrides.contactProperties ?? [...CONTACT_PROPERTIES, ...OPTIONAL_CONTACT_PROPERTIES]);

  // La sonda de propiedades se responde aparte para que no consuma los mocks de
  // cada test ni altere sus conteos de llamadas.
  const routedFetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('/crm/properties/')) {
      if (probeList === null) throw new Error('property probe unavailable');
      return new Response(
        JSON.stringify({ results: probeList.map((name) => ({ name, label: name, type: 'string', fieldType: 'text' })) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return fetchImpl(url, init);
  };

  const client = new HubspotHttpClient({
    baseUrl: 'https://api.hubapi.com',
    apiVersion: '2026-09',
    accessToken: 'test-token',
    maxRetries: 0,
    sleep: async () => undefined,
    fetchImpl: routedFetch as unknown as typeof fetch,
  });
  const adapter = new HubspotCrmAdapter({
    client,
    defaultSource: 'Synckre Agent',
    ...overrides,
  });
  return { adapter, fetchImpl, client };
}

function lastCall(fetchImpl: ReturnType<typeof vi.fn>) {
  const call = fetchImpl.mock.calls[fetchImpl.mock.calls.length - 1] as [string, RequestInit];
  return {
    url: call[0],
    method: call[1]?.method ?? 'GET',
    body: call[1]?.body ? JSON.parse(String(call[1].body)) : undefined,
  };
}

/**
 * Simula la fidelidad de la API: HubSpot devuelve ÚNICAMENTE las propiedades
 * solicitadas en `body.properties`. Los mocks que devuelven todo enmascaran
 * fallos como el de `recordMatchesEmail/Phone` leyendo propiedades no pedidas.
 */
function apiFaithfulRecord(
  record: { id: string; properties: Record<string, string> },
  requestBody: unknown,
): { id: string; properties: Record<string, string> } {
  const requested = ((requestBody as { properties?: string[] })?.properties ?? []) as string[];
  const properties: Record<string, string> = {};
  for (const key of requested) {
    const value = record.properties[key];
    if (value !== undefined) properties[key] = value;
  }
  return { id: record.id, properties };
}

const CONTACT_RECORD = {
  id: '501',
  properties: {
    firstname: 'Ana',
    lastname: 'Gómez',
    email: 'ana@example.com',
    phone: '+1 555 123 4567',
    company: 'Acme',
    jobtitle: 'CTO',
    lifecyclestage: 'lead',
    createdate: '2026-10-01T10:00:00.000Z',
  },
  createdAt: '2026-10-01T10:00:00.000Z',
};

describe('HubspotCrmAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findLead', () => {
    it('busca por email con EQ y devuelve el lead mapeado', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl.mockResolvedValue(json({ results: [CONTACT_RECORD] }));

      const lead = await adapter.findLead({ email: 'Ana@Example.com' });

      expect(lead).toMatchObject({
        id: '501',
        name: 'Ana Gómez',
        email: 'ana@example.com',
        phone: '+1 555 123 4567',
        companyName: 'Acme',
        jobTitle: 'CTO',
        status: 'lead',
      });

      const call = lastCall(fetchImpl);
      expect(call.url).toBe('https://api.hubapi.com/crm/objects/2026-09/contacts/search');
      expect(call.method).toBe('POST');
      const filterGroups = call.body.filterGroups as Array<{ filters: Array<Record<string, string>> }>;
      const filters = filterGroups.flatMap((g) => g.filters);
      expect(filters).toHaveLength(1);
      expect(filters[0]).toMatchObject({ propertyName: 'email', operator: 'EQ' });
      // La propiedad calculada de emails secundarios se consulta en un paso aparte,
      // para no arriesgar un 400 si el portal no la permite filtrar.
      expect(filters.map((f) => f.propertyName)).not.toContain('hs_additional_emails');
    });

    it('normaliza el teléfono a los últimos 10 dígitos (sin código de país)', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl.mockImplementation(async () => json({ results: [] }));

      await adapter.findLead({ phone: '+1 (555) 123-4567' });

      const call = lastCall(fetchImpl);
      const firstBody = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body)) as {
        filterGroups: Array<{ filters: Array<Record<string, string>> }>;
      };
      const phoneFilter = firstBody.filterGroups
        .flatMap((g) => g.filters)
        .find((f) => f.propertyName === 'phone');
      expect(phoneFilter?.value).toBe('5551234567');
      expect(call.body.query).toBe('5551234567');
    });

    it('usa la búsqueda por texto libre si el filtro por teléfono no encuentra nada', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl
        .mockResolvedValueOnce(json({ results: [] }))
        .mockResolvedValueOnce(json({ results: [CONTACT_RECORD] }));

      const lead = await adapter.findLead({ phone: '5551234567' });

      expect(lead?.id).toBe('501');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(lastCall(fetchImpl).body.query).toBe('5551234567');
    });

    it('encuentra el contacto aunque el email esté registrado como secundario', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl
        .mockImplementationOnce(async () => json({ results: [] })) // email principal: sin match
        .mockImplementationOnce(async () =>
          json({
            results: [
              {
                id: '777',
                properties: {
                  firstname: 'Luis',
                  email: 'otro@example.com',
                  hs_additional_emails: 'luis@example.com;luis.alt@example.com',
                },
              },
            ],
          }),
        );

      const lead = await adapter.findLead({ email: 'Luis@Example.com' });

      expect(lead?.id).toBe('777');
      // La segunda búsqueda usa el token de la propiedad calculada.
      const secondBody = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body));
      expect(secondBody.filterGroups[0].filters[0].propertyName).toBe('hs_additional_emails');
      expect(secondBody.filterGroups[0].filters[0].operator).toBe('CONTAINS_TOKEN');
    });

    it('degrada a "sin coincidencia" si el portal rechaza el filtro de emails secundarios', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl
        .mockImplementationOnce(async () => json({ results: [] })) // email principal: sin match
        .mockImplementationOnce(async () =>
          json({ status: 'error', category: 'VALIDATION_ERROR', message: 'invalid property' }, 400),
        );

      // No debe lanzar: el fallback de email secundario es opcional.
      await expect(adapter.findLead({ email: 'nadie@example.com' })).resolves.toBeNull();
    });

    it('encuentra por email secundario con un mock fiel a la API (solo propiedades pedidas)', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      const stored = {
        id: '777',
        properties: {
          firstname: 'Luis',
          email: 'otro@example.com',
          hs_additional_emails: 'luis@example.com',
        },
      };
      fetchImpl.mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const secondary = (body.filterGroups ?? []).some(
          (g: { filters: Array<{ propertyName: string }> }) =>
            g.filters.some((f) => f.propertyName === 'hs_additional_emails'),
        );
        // La API solo devuelve las propiedades solicitadas: si el adaptador no
        // pide hs_additional_emails, el verificador no puede confirmar el email.
        return json({ results: secondary ? [apiFaithfulRecord(stored, body)] : [] });
      });

      const lead = await adapter.findLead({ email: 'Luis@Example.com' });

      expect(lead?.id).toBe('777');
      expect(lead?.email).toBe('otro@example.com');
    });

    it('encuentra por teléfono normalizado con un mock fiel a la API', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      const stored = {
        id: '654',
        properties: {
          firstname: 'Ana',
          hs_searchable_calculated_phone_number: '5551234567',
        },
      };
      fetchImpl.mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const wantsCalculated = ((body.properties ?? []) as string[]).includes(
          'hs_searchable_calculated_phone_number',
        );
        // El EQ sobre `phone` no encuentra nada; el fallback por texto sí.
        if (body.query && wantsCalculated) {
          return json({ results: [apiFaithfulRecord(stored, body)] });
        }
        return json({ results: [] });
      });

      const lead = await adapter.findLead({ phone: '+1 (555) 123-4567' });

      expect(lead?.id).toBe('654');
    });

    it('NUNCA vincula un contacto cuyo email secundario no coincide con el consultado', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl
        .mockImplementationOnce(async () => json({ results: [] }))
        .mockImplementationOnce(async () =>
          json({
            results: [
              {
                id: '888',
                properties: {
                  firstname: 'Otra',
                  email: 'ajena@example.com',
                  // Contiene el token pero NO el email consultado.
                  hs_additional_emails: 'luis@otro-dominio.com',
                },
              },
            ],
          }),
        );

      await expect(adapter.findLead({ email: 'luis@example.com' })).resolves.toBeNull();
    });

    it('NUNCA vincula un contacto devuelto por la búsqueda difusa si el teléfono no coincide', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl
        .mockImplementationOnce(async () => json({ results: [] })) // EQ por phone: sin match
        .mockImplementationOnce(async () =>
          json({
            results: [
              {
                id: '999',
                properties: { firstname: 'Impostor', phone: '+1 555 999 8888' },
              },
            ],
          }),
        );

      await expect(adapter.findLead({ phone: '+1 555 123 4567' })).resolves.toBeNull();
    });

    it('acepta la búsqueda difusa cuando el teléfono sí coincide tras normalizar', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl
        .mockImplementationOnce(async () => json({ results: [] }))
        .mockImplementationOnce(async () =>
          json({
            results: [
              {
                id: '654',
                properties: {
                  firstname: 'Ana',
                  // Propiedad calculada de HubSpot, con formato distinto.
                  hs_searchable_calculated_phone_number: '5551234567',
                },
              },
            ],
          }),
        );

      const lead = await adapter.findLead({ phone: '+1 (555) 123-4567' });

      expect(lead?.id).toBe('654');
    });

    it('devuelve null sin llamar a la red si no hay email ni teléfono', async () => {
      const { adapter, fetchImpl } = buildAdapter();

      await expect(adapter.findLead({})).resolves.toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('cachea la búsqueda para no agotar el cupo de 5 req/s', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl.mockResolvedValue(json({ results: [CONTACT_RECORD] }));

      await adapter.findLead({ email: 'ana@example.com' });
      await adapter.findLead({ email: 'ana@example.com' });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('invalida el caché negativo tras crear, para que el contacto nuevo se encuentre', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      let created = false;
      fetchImpl.mockImplementation(async (url: string, init?: RequestInit) => {
        const path = String(url);
        const method = init?.method ?? 'GET';
        if (method === 'POST' && path.endsWith('/contacts')) {
          created = true;
          return json({ id: '900', properties: { email: 'x@y.com' } }, 201);
        }
        // Antes de crear no hay coincidencias; después sí.
        return created
          ? json({ results: [{ id: '900', properties: { email: 'x@y.com' } }] })
          : json({ results: [] });
      });

      // 1er findLead: cachea un negativo (EQ + fallback de secundarios).
      await expect(adapter.findLead({ email: 'x@y.com' })).resolves.toBeNull();
      await adapter.createLead({ email: 'x@y.com', name: 'X Y' });

      // Tras la escritura el negativo se descarta y el contacto aparece.
      const found = await adapter.findLead({ email: 'x@y.com' });
      expect(found?.id).toBe('900');
    });
  });

  describe('getLeadById', () => {
    it('lee el contacto por ID', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl.mockResolvedValue(json(CONTACT_RECORD));

      const lead = await adapter.getLeadById('501');

      expect(lead?.id).toBe('501');
      expect(lastCall(fetchImpl).url).toContain('/crm/objects/2026-09/contacts/501?properties=');
    });

    it('avisa cuando el id no tiene formato de HubSpot (p. ej. de otro CRM)', async () => {
      const logger = { warn: vi.fn() };
      const { adapter, fetchImpl } = buildAdapter();
      // Se reconstruye con logger para observar el aviso.
      const fetchImpl2 = fetchImpl as unknown as typeof fetch;
      const client = new HubspotHttpClient({
        baseUrl: 'https://api.hubapi.com',
        apiVersion: '2026-09',
        accessToken: 'test-token',
        maxRetries: 0,
        sleep: async () => undefined,
        fetchImpl: fetchImpl2,
      });
      const withLogger = new HubspotCrmAdapter({ client, logger });
      fetchImpl.mockResolvedValue(json({ message: 'not found' }, 404));

      // Un id de ERPNext no puede existir en HubSpot: se avisa y se devuelve null.
      await expect(withLogger.getLeadById('CRM-LEAD-0001')).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('not a HubSpot id'),
        expect.objectContaining({ id: 'CRM-LEAD-0001' }),
      );
      void adapter;
    });

    it('devuelve null ante un 404 en lugar de lanzar', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl.mockResolvedValue(json({ message: 'not found' }, 404));

      await expect(adapter.getLeadById('999')).resolves.toBeNull();
    });
  });

  describe('createLead / updateLead', () => {
    it('divide el nombre completo en firstname y lastname', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl.mockResolvedValue(json({ id: '1', properties: {} }, 201));

      await adapter.createLead({ name: 'Ana María Gómez Díaz', email: 'a@b.com' });

      const props = lastCall(fetchImpl).body.properties as Record<string, string>;
      expect(props.firstname).toBe('Ana María Gómez');
      expect(props.lastname).toBe('Díaz');
      expect(props.email).toBe('a@b.com');
      expect(lastCall(fetchImpl).method).toBe('POST');
    });

    it('usa PATCH con el ID para actualizar', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl.mockResolvedValue(json({ id: '501', properties: {} }));

      await adapter.updateLead('501', { name: 'Ana Gómez', phone: '555' });

      const call = lastCall(fetchImpl);
      expect(call.method).toBe('PATCH');
      expect(call.url).toBe('https://api.hubapi.com/crm/objects/2026-09/contacts/501');
    });

    it('persiste el nombre de empresa como propiedad y asocia la Company en segundo plano', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl
        .mockImplementationOnce(async () => json({ id: '1', properties: {} }, 201)) // create contact
        .mockImplementationOnce(async () => json({ results: [{ id: '55' }] })) // search company
        .mockImplementationOnce(async () => json({}, 200)); // associate

      await adapter.createLead({ name: 'Ana', email: 'a@b.com', companyName: 'Acme' });

      // La creación lleva la propiedad estándar y la personalizada.
      const createProps = JSON.parse(
        String((fetchImpl.mock.calls[0][1] as RequestInit).body),
      ).properties as Record<string, string>;
      expect(createProps.company).toBe('Acme');
      expect(createProps.synckre_company_name).toBe('Acme');

      // La asociación con la Company existente ocurre en segundo plano.
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
      const associationCall = fetchImpl.mock.calls[2] as [string, RequestInit];
      // Endpoint de asociación por defecto: no exige typeId ni reasigna la primaria.
      expect(associationCall[0]).toContain('/contacts/1/associations/default/company/55');
      expect(associationCall[1].method).toBe('PUT');
    });

    it('reintenta sin la propiedad personalizada que HubSpot señala como inexistente', async () => {
      // Sonda no disponible: se escribe todo y se ejercita el reintento degradado.
      const { adapter, fetchImpl } = buildAdapter({ contactProperties: null });
      fetchImpl
        .mockImplementationOnce(async () =>
          json(
            {
              status: 'error',
              category: 'VALIDATION_ERROR',
              message: 'Property does not exist',
              errors: [{ code: 'PROPERTY_DOESNT_EXIST', context: { propertyName: 'synckre_source' } }],
            },
            400,
          ),
        )
        .mockImplementationOnce(async () => json({ id: '1', properties: {} }, 201));

      const lead = await adapter.createLead({ name: 'Ana', email: 'a@b.com', source: 'Website' });

      expect(lead.id).toBe('1');
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      const firstProps = JSON.parse(
        String((fetchImpl.mock.calls[0][1] as RequestInit).body),
      ).properties as Record<string, string>;
      const secondProps = JSON.parse(
        String((fetchImpl.mock.calls[1][1] as RequestInit).body),
      ).properties as Record<string, string>;

      // El primer intento envía la propiedad personalizada…
      expect(firstProps.synckre_source).toBe('Website');
      // …y el reintento la elimina, conservando el resto de datos.
      expect(secondProps.synckre_source).toBeUndefined();
      expect(secondProps.email).toBe('a@b.com');
      expect(secondProps.firstname).toBe('Ana');
    });

    it('degrada con la forma REAL del error de HubSpot (context con arrays)', async () => {
      // Sonda no disponible: se escribe todo y se ejercita el reintento degradado.
      const { adapter, fetchImpl } = buildAdapter({ contactProperties: null });
      fetchImpl
        .mockImplementationOnce(async () =>
          json(
            {
              status: 'error',
              category: 'VALIDATION_ERROR',
              message: 'Property does not exist',
              // Forma documentada: context es un objeto cuyos valores son ARRAYS.
              errors: [
                {
                  code: 'PROPERTY_DOESNT_EXIST',
                  context: { propertyName: ['synckre_source'] },
                },
              ],
            },
            400,
          ),
        )
        .mockImplementationOnce(async () => json({ id: '1', properties: {} }, 201));

      const lead = await adapter.createLead({
        name: 'Ana',
        email: 'a@b.com',
        source: 'Website',
        data: { conversation_id: 'conv-42' },
      });
      expect(lead.id).toBe('1');
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      const firstProps = JSON.parse(
        String((fetchImpl.mock.calls[0][1] as RequestInit).body),
      ).properties as Record<string, string>;
      const secondProps = JSON.parse(
        String((fetchImpl.mock.calls[1][1] as RequestInit).body),
      ).properties as Record<string, string>;

      expect(firstProps.synckre_source).toBe('Website');
      expect(firstProps.synckre_conversation_id).toBe('conv-42');

      // Sin la corrección del contexto-array, este reintento era idéntico al
      // primero: se elimina la propiedad señalada y se conservan las demás.
      expect(secondProps.synckre_source).toBeUndefined();
      expect(secondProps.synckre_conversation_id).toBe('conv-42');
      expect(secondProps.email).toBe('a@b.com');
    });

    it('prescinde de TODAS las opcionales cuando el 400 no nombra ninguna propiedad', async () => {
      // Sonda no disponible: se escribe todo y se ejercita el reintento degradado.
      const { adapter, fetchImpl } = buildAdapter({ contactProperties: null });
      fetchImpl
        .mockImplementationOnce(async () =>
          json({ status: 'error', category: 'VALIDATION_ERROR', message: 'Invalid input' }, 400),
        )
        .mockImplementationOnce(async () => json({ id: '1', properties: {} }, 201));

      await adapter.createLead({ name: 'Ana', email: 'a@b.com', source: 'Website' });

      const secondProps = JSON.parse(
        String((fetchImpl.mock.calls[1][1] as RequestInit).body),
      ).properties as Record<string, string>;

      // El reintento no puede ser byte-idéntico al primer intento.
      for (const key of Object.values(OPTIONAL_CONTACT_PROPERTIES)) {
        expect(secondProps[key]).toBeUndefined();
      }
      expect(secondProps.email).toBe('a@b.com');
    });

    it('no entra en bucle si HubSpot rechaza sin señalar qué propiedad falla', async () => {
      // Sonda no disponible: se escribe todo y se ejercita el reintento degradado.
      const { adapter, fetchImpl } = buildAdapter({ contactProperties: null });
      fetchImpl.mockImplementation(async () =>
        json({ status: 'error', category: 'VALIDATION_ERROR', message: 'Invalid input' }, 400),
      );

      await expect(
        adapter.createLead({ name: 'Ana', email: 'a@b.com', source: 'Website' }),
      ).rejects.toMatchObject({ code: 'CRM_VALIDATION_ERROR' });

      // Exactamente un reintento: nunca más de una escritura adicional.
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('escribe una sola vez si la sonda dice que el portal no tiene las personalizadas', async () => {
      // Portal con sólo propiedades estándar: la sonda lo detecta y el adaptador
      // no intenta escribir las personalizadas, evitando un 400 y un reintento.
      const { adapter, fetchImpl } = buildAdapter({
        contactProperties: ['email', 'firstname', 'lastname', 'phone'],
      });
      fetchImpl.mockImplementation(async () => json({ id: '1', properties: {} }, 201));

      await adapter.createLead({ name: 'Ana', email: 'a@b.com', source: 'Website' });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body)) as {
        properties: Record<string, string>;
      };
      expect(body.properties.email).toBe('a@b.com');
      // Ninguna personalizada viaja en la única escritura.
      expect(body.properties.synckre_source).toBeUndefined();
      expect(body.properties.synckre_conversation_id).toBeUndefined();
    });

    it('sí escribe las personalizadas cuando el portal las tiene', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl.mockImplementation(async () => json({ id: '1', properties: {} }, 201));

      await adapter.createLead({ name: 'Ana', email: 'a@b.com', source: 'Website' });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body)) as {
        properties: Record<string, string>;
      };
      expect(body.properties.synckre_source).toBe('Website');
    });

    it('recupera el contacto existente cuando HubSpot señala un duplicado', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      let created = false;
      fetchImpl.mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'POST' && String(url).endsWith('/contacts')) {
          if (!created) {
            created = true;
            return json({ status: 'error', message: 'Contact already exists' }, 409);
          }
          return json({ id: 'nuevo', properties: {} }, 201);
        }
        // La recuperación busca por email y encuentra el registro previo.
        return json({ results: [{ id: '501', properties: { email: 'ana@example.com' } }] });
      });

      const lead = await adapter.createLead({ name: 'Ana', email: 'ana@example.com' });

      // En lugar de fallar o duplicar, se reutiliza el contacto existente.
      expect(lead.id).toBe('501');
    });

    it('propaga el error cuando el rechazo no se resuelve quitando propiedades personalizadas', async () => {
      // Sonda no disponible: se escribe todo y se ejercita el reintento degradado.
      const { adapter, fetchImpl } = buildAdapter({ contactProperties: null });
      fetchImpl.mockImplementation(async () =>
        json({ status: 'error', category: 'VALIDATION_ERROR', message: 'Invalid email address' }, 400),
      );

      await expect(
        adapter.createLead({ email: 'no-valido', name: 'Ana' }),
      ).rejects.toMatchObject({ code: 'CRM_VALIDATION_ERROR' });

      // Un único reintento y se rinde, sin bucles infinitos de escritura.
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const retryProps = JSON.parse(
        String((fetchImpl.mock.calls[1][1] as RequestInit).body),
      ).properties as Record<string, string>;
      // El dato esencial del usuario se conserva en el reintento.
      expect(retryProps.email).toBe('no-valido');
    });
  });

  describe('appendLeadNote', () => {
    it('crea una nota con hs_timestamp, cuerpo y asociación al contacto', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl.mockResolvedValue(json({ id: 'note-1' }, 201));

      await adapter.appendLeadNote('501', 'El cliente pide una demo de seguridad.');

      const call = lastCall(fetchImpl);
      expect(call.url).toBe('https://api.hubapi.com/crm/objects/2026-09/notes');
      expect(call.method).toBe('POST');
      expect(call.body.properties.hs_note_body).toContain('demo de seguridad');
      expect(Number(call.body.properties.hs_timestamp)).toBeGreaterThan(0);
      expect(call.body.associations[0].to.id).toBe('501');
      expect(call.body.associations[0].types[0].associationTypeId).toBe(202);
    });

    it('acepta el formato de objeto con threadId para agrupar la conversación', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl.mockResolvedValue(json({ id: 'note-1' }, 201));

      await adapter.appendLeadNote('501', { body: 'Resumen', threadId: 'conv-123' });

      expect(lastCall(fetchImpl).body.properties.hs_engagement_thread_id).toBe('conv-123');
    });

    it('reintenta sin el hilo si la cuenta no soporta engagement threads', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl
        .mockResolvedValueOnce(json({ message: 'hs_engagement_thread_id invalid property' }, 400))
        .mockResolvedValueOnce(json({ id: 'note-1' }, 201));

      await adapter.appendLeadNote('501', { body: 'Resumen', threadId: 'conv-123' });

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const retryProps = JSON.parse(
        String((fetchImpl.mock.calls[1][1] as RequestInit).body),
      ).properties as Record<string, string>;
      expect(retryProps.hs_engagement_thread_id).toBeUndefined();
      expect(retryProps.hs_note_body).toBe('Resumen');
    });

    it('trunca notas que exceden el límite de HubSpot', async () => {
      const { adapter, fetchImpl } = buildAdapter();
      fetchImpl.mockResolvedValue(json({ id: 'note-1' }, 201));

      await adapter.appendLeadNote('501', 'x'.repeat(70_000));

      const body = lastCall(fetchImpl).body.properties.hs_note_body as string;
      expect(body.length).toBeLessThanOrEqual(65_536);
      expect(body.endsWith('[truncated]')).toBe(true);
    });

    it('ignora notas vacías sin llamar a la red', async () => {
      const { adapter, fetchImpl } = buildAdapter();

      await adapter.appendLeadNote('501', '   ');

      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});
