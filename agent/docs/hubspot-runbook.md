# Runbook — CRM HubSpot para AgentSynckre

Guía operativa de la integración de HubSpot que reemplaza a ERPNext en el agent
conversacional. Cubre configuración, verificación, política de agendamiento,
alcance de la conversación y rollback.

- **Proveedor activo:** `CRM_PROVIDER=hubspot`
- **Autenticación:** Private App access token (sin usuario interactivo)
- **Fuente de verdad de la agenda:** Google Calendar
- **Espejo en el CRM:** objeto de citas de HubSpot (reporting, dedupe, disponibilidad)

---

## 1. Arquitectura de la integración

```
front_agent (LLM)
   └── tools: search_lead · save_lead · append_lead_note
              check_availability · schedule_/reschedule_/cancel_appointment
                    │
                    ▼
        Puertos del núcleo (hexagonal)
        ICrm · IAppointmentRepository · ISchedulingPolicyProvider
                    │
                    ▼
   HubspotCrmAdapter · HubspotSchedulingAdapter  (API REST)
                    │
                    ▼
        HubspotHttpClient
        Bearer token · timeout · token bucket · retry con backoff
                    │
                    ▼
             api.hubapi.com/crm/objects/{version}/...
```

Decisiones de diseño relevantes:

| Decisión | Motivo |
|---|---|
| La API REST es el camino del producto (no MCP) | El agent usa tools internos sobre `ICrm`; el MCP oficial de HubSpot exige OAuth 2.1 + PKCE y no acepta private-app tokens |
| La política de agenda vive en la base de datos | Se administra desde un panel; el entorno sólo es semilla y respaldo |
| Se identifica siempre al contacto por ID | El endpoint de búsqueda de HubSpot es eventualmente consistente tras una escritura |
| Reintento único sin propiedades personalizadas | Permite operar antes de ejecutar el bootstrap |
| `synckre_*` con prefijo propio | Evita colisiones con propiedades estándar y de otras apps |
| La cita se localiza por identidad externa si el id no es de HubSpot | El tool de agenda registra el id del evento de Google Calendar |
| Se verifican en cliente los resultados de búsquedas difusas | Una búsqueda por texto libre puede devolver otro contacto |

### 1.1 Detalles de comportamiento

- **Identidad del contacto.** Búsqueda en tres pasos: coincidencia exacta por email o
  teléfono; email secundario (`hs_additional_emails`); y, si el teléfono está
  normalizado, búsqueda por texto libre. Los dos últimos pasos **verifican en cliente**
  que el contacto contenga realmente el dato antes de vincularlo.
- **Duplicados.** Si HubSpot rechaza un alta por conflicto de unicidad (409 o un 400
  con código de duplicado), el adaptador **recupera el contacto existente**.
- **Citas canceladas.** Al leer se aceptan `CANCELED` y `CANCELLED`; al escribir se usa
  `CANCELED`.
- **Cancelación sin propiedad de estado.** El objeto nativo de citas no tiene propiedad
  de estado, así que vive en `synckre_status`. Si esa propiedad no existe, la
  cancelación **archiva** el registro espejo: un objeto archivado no aparece en las
  búsquedas, así que el hueco queda libre igualmente. Se pierde el rastro, no la
  corrección funcional.
- **Identificador de la cita en el CRM.** Al agendar se guarda el id del registro
  espejo en la conversación (`crmAppointmentId`), de modo que cancelar o reprogramar no
  dependan de traducir el id de Google Calendar.
- **Disponibilidad.** La ventana se amplía hacia atrás 4 h y el solape se decide en
  cliente (`inicio < fin_ventana && fin > inicio_ventana`), porque HubSpot no permite
  filtrar por la fecha de fin. Los resultados se paginan.
- **Fechas.** Las propiedades datetime se escriben en **ISO-8601** y se filtran en
  **epoch (ms)**. Confundir ambos formatos es un fallo silencioso: una fecha guardada
  como número no es interpretable por `new Date(...)`.
- **Sonda de propiedades.** Antes de escribir, el adaptador consulta qué propiedades
  admite el objeto y descarta las que no existen: evita un ciclo de "400 + reintento".
- **Uso preferente de campos nativos.** El mensaje del cliente va a `message` y la
  empresa a `company`: visibles en HubSpot **sin depender de los scopes de schema**.
- **Modo dry-run.** Los identificadores sintéticos (`dry-run-contact-N`) se resuelven en
  memoria y **nunca** se envían al CRM real.

---

## 2. Configuración

### 2.1 Private App en HubSpot

HubSpot → **Settings → Integrations → Private Apps → Create a private app**.

| Scope | Para qué |
|---|---|
| `crm.objects.contacts.read` | Buscar y leer contactos |
| `crm.objects.contacts.write` | Crear y actualizar contactos y notas |
| `crm.objects.notes.read` | Leer notas existentes |
| `crm.objects.appointments.read` | Leer citas (disponibilidad y dedupe) |
| `crm.objects.appointments.write` | Crear, reprogramar y cancelar citas |
| `crm.schemas.contacts.write` | Crear las propiedades `synckre_*` de contacto |
| `crm.schemas.appointments.write` | Crear propiedades del objeto de citas |
| `crm.schemas.custom.write` | Solo con objeto personalizado en vez del nativo (Enterprise) |

### 2.2 Variables de entorno

Sólo hay que configurar **cuatro**:

```bash
CRM_PROVIDER=hubspot
CRM_WRITE_MODE=live
HUBSPOT_PRIVATE_APP_TOKEN=pat-...
SCHEDULING_TIMEZONE=America/New_York   # + el resto de SCHEDULING_* si aplica
```

Todo lo demás (versión de API, objeto de citas, tipos de asociación, caudal, timeouts)
son **constantes verificadas contra el portal** en
[`src/config/hubspot.config.ts`](../src/config/hubspot.config.ts).

Bloque listo para copiar: [`docs/hubspot-env-block.env`](hubspot-env-block.env).

### 2.3 Valores verificados contra el portal (Synckre)

Comprobado con `npm run hubspot:verify` sobre el portal real:

| Dato | Valor real |
|---|---|
| Portal | `247595518` — Synckre, STANDARD, hosting `na2` (US) |
| Zona horaria de la cuenta | `US/Eastern` (coincide con `SCHEDULING_TIMEZONE`) |
| Objeto de citas | **nativo `appointments`, ACTIVO** |
| Propiedades nativas de la cita | **sólo** `hs_appointment_name`, `hs_appointment_start`, `hs_appointment_end` |
| Propiedad de estado de la cita | **no existe** → se usa `synckre_status` |
| Asociación cita → contacto | `typeId 906` |
| Asociación nota → contacto | `typeId 202` |
| Grupo de propiedades de citas | `appointment_information` |
| Versión de API | `2026-09` (también responde `2026-03` y `v3`) |
| `message` / `company` en contactos | nativas y **escribibles** |

### 2.4 Objeto de citas

Dos opciones, vía constante `HUBSPOT_APPOINTMENT_OBJECT`:

1. **Nativo `appointments`** (el actual, verificado). Propiedades `hs_appointment_*`.
2. **Objeto personalizado** (requiere Enterprise): su objectTypeId, p. ej. `2-12345678`.

---

## 2.5 Política de agendamiento en base de datos

La política (horarios, tipos de cita, festivos, capacidad) vive en la **base de datos**,
no en variables de entorno, para poder administrarse desde un panel.

| Tabla | Contenido | En un panel sería |
|---|---|---|
| `scheduling_settings` | Fila única: zona horaria, máximo/día, intervalo de slot | Un formulario |
| `scheduling_business_hours` | Una fila por día: abierto/cerrado y horas | Interruptor + 2 campos |
| `scheduling_appointment_types` | Un tipo por fila: nombre, duración, concurrencia, activo | Lista CRUD |
| `scheduling_holidays` | Una fila por festivo | Calendario |

### Reglas de autoridad

- **Si existe la fila de `scheduling_settings`, manda la base de datos.**
- Si **no** existe, se usa la configuración del entorno (y si tampoco, los valores por
  defecto del código).
- Con la base de datos como autoridad, una lista de **festivos vacía = "sin festivos"**.
- Si las tablas de **horarios** o **tipos** estuvieran vacías se cae al respaldo **y se
  avisa en los logs**: sin esos datos el agendamiento no puede funcionar, y es más
  probable un borrado accidental que una intención real de no atender nunca.
- Si la base de datos falla, se opera con el respaldo y se registra el aviso.

### Comandos

```bash
npm run scheduling:show              # política vigente y de dónde sale
# (ver también la sección 3.7 sobre cómo subir estas secciones a la base de conocimiento)
npm run scheduling:seed              # volcar el entorno a la BD (solo si está vacía)
npm run scheduling:seed -- --force   # sobrescribir la política de la BD
npm run knowledge:faq                # regenerar el FAQ desde la política vigente
```

### Para el panel futuro

La escritura ya está resuelta en
[`PostgresSchedulingPolicyProvider.save()`](../src/adapters/persistence/postgres-scheduling-policy.adapter.ts):
acepta política total o parcial, es idempotente e invalida la caché al guardar, así que
el cambio se aplica sin reiniciar.

---

## 3. Cómo llega la política de agendamiento al LLM

Hay **dos mecanismos a propósito**, porque la recuperación del FAQ es probabilística y
los datos de agenda no se pueden adivinar:

| Mecanismo | Cuándo actúa | Garantía |
|---|---|---|
| **Inyección en el prompt** | En cada turno, antes de llamar al modelo | **Siempre.** No depende de la recuperación |
| **FAQ en la base de conocimiento** | Cuando `search_knowledge_base` recupera el fragmento | Best-effort, útil para detalle |

La inyección se construye con
[`renderSchedulingPolicyContext()`](../src/core/domain/scheduling-policy-description.ts)
y se añade al system prompt desde `FrontAgent` (opción `policyProvider`). Incluye zona
horaria, horario, duraciones, capacidad, intervalo y próximos festivos, **y recuerda al
modelo que la única fuente válida para ofrecer huecos sigue siendo
`check_availability`**. Si la lectura falla, el turno continúa sin ese bloque.

El FAQ (`knowledge/public/faq.md`) se genera desde la **misma** función, así que los dos
textos no pueden contradecirse. El bloque va delimitado por marcadores:

```
<!-- BEGIN:scheduling-policy (generado por `npm run knowledge:faq` — no editar a mano) -->
<!-- END:scheduling-policy -->
```

```bash
npm run knowledge:faq          # regenera la sección desde la política vigente
npm run knowledge:faq:check    # falla si el FAQ quedó desactualizado (para CI)
npm run ingest                 # indexa knowledge/ en la base de conocimiento
```

> [!WARNING]
> El FAQ **no llega al modelo hasta que se ingiera**, y la ingesta requiere Ollama para
> los embeddings. En producción el conocimiento se sincroniza desde **Google Drive**
> (`GOOGLE_DRIVE_PUBLIC_FOLDER_ID`), no desde `knowledge/`: si el FAQ de producción vive
> en Drive, hay que actualizar **ese** documento. La política de agendamiento, en cambio,
> llega siempre al modelo porque se inyecta en el prompt.

---

## 3.7 Subir la base de conocimiento

El agent responde sobre la empresa con `search_knowledge_base`, que consulta la tabla
`knowledge_chunks` (pgvector). Hay **dos vías** para llenarla.

### A) Sincronización desde Google Drive (producción, automática)

El worker sincroniza cada `KNOWLEDGE_SYNC_INTERVAL_MINUTES` (180 por defecto) desde las
carpetas configuradas. **No hay que ejecutar nada a mano**, pero requiere las variables:

```bash
GOOGLE_DRIVE_PUBLIC_FOLDER_ID=<id de la carpeta pública>
GOOGLE_DRIVE_INTERNAL_FOLDER_ID=<id de la carpeta interna>   # opcional
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
KNOWLEDGE_SYNC_INTERVAL_MINUTES=180
```

> [!IMPORTANT]
> Si `GOOGLE_DRIVE_PUBLIC_FOLDER_ID` e `GOOGLE_DRIVE_INTERNAL_FOLDER_ID` están **ambas
> ausentes**, el worker **no arranca el sincronizador de conocimiento** y la base de
> conocimiento se queda vacía en silencio. Esa era exactamente la situación de este
> proyecto antes de documentarlo.

Comprobar si hay contenido:

```sql
SELECT tags, COUNT(*) FROM knowledge_chunks GROUP BY tags;
SELECT COUNT(*) FROM knowledge_sources;
```

### B) Ingesta local desde `knowledge/` (manual)

```bash
npm run ingest                                  # indexa knowledge/ completo
npm run ingest -- --dir knowledge/public        # solo una carpeta
npm run ingest -- --tag public                  # forzar la etiqueta
npm run ingest -- --chunk-size 800 --overlap 150
```

Requisitos:

1. **`DATABASE_URL`** con la extensión `vector` (la crea `npm run db:init`).
2. **Ollama accesible** en `OLLAMA_BASE_URL` con el modelo ya descargado:

```bash
ollama pull nomic-embed-text     # 274 MB, una sola vez
ollama serve                     # o el servicio ollama del docker-compose
```

El script es **idempotente**: los identificadores de fragmento son un hash de
`fuente + índice + contenido`, así que volver a ingestarlo actualiza en lugar de
duplicar.

### Cuándo hay que volver a ingerir

- Tras cambiar el FAQ (`npm run knowledge:faq`).
- Si un fragmento devuelve información vieja: la búsqueda no tiene invalidación, así que
  el contenido anterior permanece hasta que se reindexe.

> El troceado por defecto (1200 caracteres, 200 de solape) es adecuado para documentos
> largos. Un FAQ corto queda repartido en pocos fragmentos; para preguntas muy concretas
> conviene `--chunk-size 800`.

## 3.6 Formulario web (ruta de contacto)

`POST /api/v1/public/contact` (también `/v1/public/contact`).

| Requisito | Detalle |
|---|---|
| Cabecera `x-api-key` | Debe coincidir con `SYNCKRE_API_KEY`. Sin ella: **401**. Si la variable no está configurada: **503** |
| `Content-Type: application/json` | Obligatorio |
| **CORS** | El `Origin` del sitio debe estar en `CORS_ORIGIN`, si no **403 `Origin not allowed`** |

### Qué ocurre al recibir un envío

1. Se valida la entrada (`name`, `email` válido y `message`). Si falla: **400** y no se toca el CRM.
2. Se busca el contacto por email/teléfono y se crea o actualiza en HubSpot.
3. Se registra el mensaje como nota asociada y en el campo nativo `message`.
4. Se envía al cliente un **acuse** que muestra interés por su proyecto, le invita a
   agendar una conversación y le sugiere hacerlo con el **asistente del sitio**
   (enlace a `synckre.com`). Va en el idioma del formulario (`locale`).
5. Se envía la **alerta interna** al equipo con los datos y el mensaje íntegro.

La respuesta incluye `crmPersisted`: si el CRM falla pero los correos salen, es `false`
y el llamador sabe que **no** quedó guardado. Ese caso no se reporta como alta correcta.

### CORS: el fallo más habitual

> [!IMPORTANT]
> `applyCors` **rechaza con 403** los orígenes que no estén en `CORS_ORIGIN`; no se
> limita a omitir cabeceras. Con el valor por defecto de desarrollo
> (`http://localhost:3000`), **el formulario publicado en el sitio recibe 403** y el
> preflight `OPTIONS` tampoco pasa.

En el despliegue debe incluir el sitio real:

```bash
CORS_ORIGIN=https://www.synckre.com,https://synckre.com
```

Al arrancar, el servidor imprime los orígenes permitidos, así que un 403 se diagnostica
de inmediato:

```
CORS (formulario web): https://www.synckre.com, https://synckre.com
```

Y avisa si en producción no hay ningún origen `https` configurado.

Verificado en vivo: `POST` desde `https://www.synckre.com` → 400 (pasa CORS y llega a
validar), preflight → 204, origen ajeno → 403.

## 4. Alcance de la conversación (qué NO responde el agent)

El agent es un asistente **de la empresa**, no un asistente general. Se aplica en dos capas:

1. **Prompt** (`src/agents/front-agent.prompt.ts`, sección `SCOPE`): instruye al modelo
   para rechazar en una frase y redirigir, con regla de ambigüedad a favor del negocio.
2. **Guard determinista** (`src/core/domain/conversation-scope.ts`): clasifica el último
   mensaje **antes de llamar al modelo**. Si es claramente ajeno y no contiene ninguna
   señal de negocio, responde un rechazo localizado **sin gastar una llamada al LLM ni
   ejecutar herramientas**.

Se rechazan: `como se centra un div`, `escríbeme un script en python`, `resuelve esta
ecuación`, `qué clima hace en Madrid`, `explain quantum entanglement to me`,
`npm install no me funciona`.

Sí se atienden: servicios, productos, precios, integraciones, CRM, automatización,
soporte o agendar una reunión — **incluso si mencionan tecnología** (`¿Hacen desarrollo
en Python?`, `¿Trabajan con React?`).

La clasificación es **conservadora a propósito**: callar una pregunta legítima es peor
que dejar pasar algo que el prompt rechazará igualmente. Se puede desactivar con
`enforceScope: false`.

---

## 5. Puesta en marcha

```bash
npm run hubspot:verify       # verifica token, scopes, propiedades y asociaciones
npm run hubspot:bootstrap    # crea las propiedades synckre_* (idempotente)
npm run hubspot:smoke        # smoke real, sin LLM
npm run hubspot:smoke -- --appointments   # incluye crear/reprogramar/cancelar
```

Códigos de salida: `0` correcto, `1` pendientes o fallos, `2` falta el token.

### 5.1 Qué se degrada si faltan los scopes de schema

Los scopes `crm.schemas.*` sólo hacen falta para **crear propiedades**. Sin ellos el
sistema **opera igualmente**:

| Función | Sin scopes de schema |
|---|---|
| Buscar, crear y actualizar contactos | Funciona |
| Notas asociadas al contacto | Funciona |
| Asociar la empresa al contacto | Funciona (endpoint de asociación por defecto) |
| **Mensaje del cliente** | **Funciona**: campo nativo `message` |
| Empresa | Funciona: `company` es nativa escribible |
| Asunto / origen / id de conversación como propiedades | No se guardan; el asunto queda en la nota y el mensaje en `message` |
| Agendar y reprogramar citas | Funciona |
| Cancelar citas | Funciona, **archivando** el registro espejo |
| Metadatos de la cita (cliente, email, teléfono) | No se guardan como propiedades |
| Resolver una cita por id de Google Calendar | No (se evita guardando el id del CRM en la conversación) |

---

## 6. Límites de HubSpot y cómo los respeta el agent

| Límite | Valor | Mitigación |
|---|---|---|
| Peticiones generales | 100 req/10s (Free/Starter), 190 (Pro/Ent) | Token bucket (`HUBSPOT_MAX_RPS`, 90) |
| Endpoint de búsqueda | **5 req/s por cuenta** | Bucket dedicado (`HUBSPOT_SEARCH_MAX_RPS`, 4) + caché de 30 s |
| Resultados por búsqueda | 10.000 máximo | Búsquedas de 1 en 1 con `limit: 5` |
| Cuerpo de nota | 65.536 caracteres | Truncado con marca `[truncated]` |
| Límite diario | 250k–1M según tier | Buckets acotan el caudal |

Reintentos: sólo en `429`, `423` y `5xx`, con backoff exponencial y jitter. Se respeta
`Retry-After` si existe (acotado a 60 s), pero **no se asume su presencia**.

### 6.1 Errores normalizados

| Código | Significado | Acción |
|---|---|---|
| `CRM_NOT_CONFIGURED` | Falta el token | Configurar `HUBSPOT_PRIVATE_APP_TOKEN` |
| `CRM_UNAUTHORIZED` | Token inválido o revocado | Regenerar el token |
| `CRM_FORBIDDEN` | Falta un scope | Añadir el scope indicado |
| `CRM_NOT_FOUND` | Objeto inexistente | Normal: el adaptador devuelve `null` |
| `CRM_CONFLICT` | Duplicado | Automático: se reutiliza el contacto existente |
| `CRM_RATE_LIMITED` | 429 | Automático: reintento con backoff |
| `CRM_VALIDATION_ERROR` | Payload rechazado | Revisar mensaje; reintento sin personalizadas |
| `CRM_TIMEOUT` | Sin respuesta en el timeout | Revisar latencia |

El `correlationId` permite cruzar el error con el log de HubSpot.

---

## 7. Rollback a ERPNext

```bash
CRM_PROVIDER=erpnext
ERPNEXT_URL=https://erp.example.com
ERPNEXT_API_KEY=...
ERPNEXT_API_SECRET=...
```

- **Los contactos y citas creados en HubSpot no se migran de vuelta.**
- La **política de agenda se mantiene** desde la base de datos en ambos modos.
- Los tests del adaptador legacy siguen en
  `test/erpnext-scheduling.legacy.test.ts`, y el contrato de `ICrm` se verifica contra
  ambas implementaciones en `test/crm.port.contract.test.ts`.

---

## 8. Cutover (checklist)

> [!WARNING]
> **`CRM_PROVIDER` debe estar definido explícitamente en el despliegue.** Si se omite,
> su valor por defecto es `hubspot`; con el token vacío el proceso **no arranca**
> (fail-fast deliberado). Es el error de despliegue más probable de la migración.

### Seguimientos ya programados

Los seguimientos guardados en `scheduled_followups` antes del corte referencian el
`lead_id` del CRM **anterior** (los `CRM-LEAD-0001` de ERPNext). En HubSpot ese id no
existe, así que el worker no puede resolver el correo: lanza error y agota los reintentos.

```bash
npm run followups:audit            # informa: resolubles, huérfanos y sin email
npm run followups:audit -- --mark  # marca los huérfanos como fallidos
```

El adaptador además deja un aviso en los logs (`contact id is not a HubSpot id`).

Antes de activar en producción:

- [ ] **`CRM_PROVIDER` definido explícitamente en Coolify**.
- [ ] `npm run build`, `npm run lint` y `npm test` en verde.
- [ ] `npm run hubspot:verify` sin hallazgos pendientes.
- [ ] Objeto de citas confirmado y propiedades presentes (si se añadieron los scopes).
- [ ] Google Calendar con credenciales válidas (`GOOGLE_*`).
- [ ] `npm run scheduling:show` refleja el horario y los festivos reales.
- [ ] `npm run knowledge:faq:check` en verde.
- [ ] `npm run followups:audit` y decisión sobre los huérfanos.
- [ ] Prueba en `CRM_WRITE_MODE=dry_run` y revisión de los logs `[crm:dry_run]`.
- [ ] Cambio a `CRM_WRITE_MODE=live` y pruebas de la sección 5.
- [ ] Confirmar que el worker arranca con `[Worker] CRM provider: hubspot`.

Después del cutover:

- [ ] Verificar que el worker resuelve leads por ID de HubSpot.
- [ ] Confirmar recordatorios de 24 h programados tras agendar una cita.
- [ ] Revisar en HubSpot que las notas se agrupan por conversación.

---

## 9. Seguridad

Auditoría de fugas realizada sobre el proyecto. Lo que **está bien** y lo que se corrigió.

### Controles verificados

| Control | Estado |
|---|---|
| `.env` versionado en git | **No**, e ignorado. Nunca ha estado en el historial |
| Credenciales en el historial de git | Ninguna |
| `.env` dentro de la imagen de producción | **No**: la etapa final sólo copia `dist`, `node_modules` y `package.json` |
| Tokens de sesión | HMAC-SHA256 con `SESSION_SECRET` + 32 bytes aleatorios, comparados con `timingSafeEqual` |
| `SESSION_SECRET` por defecto en producción | **Bloquea el arranque** en `index.ts` y `copilotkit-server.ts` |
| Rutas con efectos | Todas exigen credencial y tienen límite por IP y por sesión |
| Detalles de error al cliente HTTP | Genéricos en producción (`exposeErrorDetails` sólo fuera de producción) |
| Documentos internos en el chat público | El tool fija la etiqueta `public` y el esquema sólo acepta `query` |
| Inyección de prompt | Prompt con reglas explícitas + guard determinista de alcance |

### Fugas corregidas

| # | Fuga | Impacto | Arreglo |
|---|---|---|---|
| 1 | `npm run ingest -- --tag public` reclasificaba `internal/` como público, y al no cambiar el `id` del fragmento **sobrescribía** la etiqueta | Documentos internos visibles en el chat del sitio | Un fichero bajo `internal/` es **siempre** interno, sin importar `--tag` |
| 2 | El filtro `tags @> ARRAY['public']` dejaba pasar un fragmento con `['public','internal']` | Defensa en profundidad | La búsqueda excluye `internal` salvo que se pida expresamente |
| 3 | `.dockerignore` usaba patrones sin comodín, que sólo casan en la raíz: `chainlit/.env` entraba en la imagen | Un futuro secreto ahí se publicaría con la imagen | Patrones `**/.env`, `**/.env.*`, `**/node_modules`, `**/.venv` |
| 4 | Los tools devolvían el mensaje de error interno, y el modelo lo explicaba al usuario (p. ej. «Verify the HubSpot Private App token») | Detalles de implementación y de diagnóstico expuestos a visitantes | `safeToolError()`: sólo los `UserFacingError` se propagan; el resto se sustituye por un texto neutro y el detalle queda en los logs |
| 5 | El adaptador legacy registraba 4 caracteres de `ERPNEXT_API_KEY` | Fragmento de credencial en los logs | Sólo se registran longitudes |
| 6 | `/ready` consultaba la base de datos sin credencial ni límite | Saturación barata del pool | Limitado por IP (`/health` se deja libre a propósito: lo usan los healthchecks) |

Cada arreglo tiene su prueba de regresión en `test/security-leaks.test.ts`.

### Pendiente

- **34 vulnerabilidades en dependencias de producción** (12 altas, 22 moderadas, 0 críticas) según
  `npm audit --omit=dev`, casi todas transitivas de `@copilotkit/runtime` y del SDK de IA
  (incluida una denegación de servicio en `qs` vía `express`/`body-parser`).
  **No se aplicó `npm audit fix --force`**: implicaría cambios de versión mayores en
  `@copilotkit/runtime` y conviene revisarlo aparte con pruebas.
- `npm run google-auth` imprime el `GOOGLE_REFRESH_TOKEN` por consola. Es intencionado
  (hay que copiarlo), pero queda en el historial de la terminal.

## 10. Referencias

- [API de objetos de CRM](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/contacts/guide)
- [Búsqueda en el CRM](https://developers.hubspot.com/docs/api-reference/latest/crm/search-the-crm)
- [Notas](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/notes/guide)
- [Objeto de citas](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/appointments/guide)
- [Propiedades](https://developers.hubspot.com/docs/api-reference/latest/crm/properties/guide)
- [Límites de uso](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines)
- [Scopes](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes)
- [Migración de versiones legacy](https://developers.hubspot.com/docs/api-reference/legacy/migration-guide)
