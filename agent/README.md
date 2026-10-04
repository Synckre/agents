# Agent Synckre — Multi-Agent System Scaffold

Arquitectura base y configuración inicial para orquestación multi-agente en TypeScript utilizando **Arquitectura Hexagonal (Ports & Adapters)** y el **Patrón Supervisor** con **LangGraph.js**, completamente dockerizado.

---

## 🏛️ Arquitectura del Sistema

El proyecto combina dos patrones arquitectónicos fundamentales para mantener el sistema desacoplado, testeable y mantenible a escala:

### 1. Arquitectura Hexagonal (Puertos y Adaptadores)

Aísla la lógica de negocio y las reglas de orquestación de las tecnologías, librerías y proveedores externos (como LangGraph, SDKs de LLM, bases de datos, etc.).

```
                         +-----------------------------------+
                         |            adapters/              |
                         |  (LangGraph, OpenAI, Postgres...) |
                         +-----------------+-----------------+
                                           |
                                           v [Implementa puertos / depende de Core]
+------------------------------------------+------------------------------------------+
|                                        core/                                        |
|                                                                                     |
|   +--------------------------+       +-------------------+       +--------------+   |
|   |         domain/          | <---- |     use-cases/    | ----> |    ports/    |   |
|   | (IAgent, IConversation,  |       | (route-to-agent,  |       | (ILLMProvider|   |
|   |       IMessage)          |       |     execute)      |       |  ITool, etc.)|   |
|   +--------------------------+       +-------------------+       +--------------+   |
+-------------------------------------------------------------------------------------+
```

### 2. Patrón Supervisor (LangGraph.js)

Un agente central (`SupervisorAgent`) actúa como orquestador / enrutador del flujo de mensajes, analizando el contexto y derivando el turno al subagente especializado más adecuado (`customer-service`, `agenda`, `accounting`, `sales`, etc.) o finalizando la conversación.

---

## 📂 Organización de Capas

| Capa | Propósito | Regla de Dependencia |
| :--- | :--- | :--- |
| **`src/core/`** | Núcleo del dominio, entidades, contratos/puertos y casos de uso de negocio. | **Puro**. No importa nada de `adapters/`, ni frameworks/SDKs externos (`@langchain/*`). |
| **`src/adapters/`** | Implementaciones concretas y tecnológicas de los puertos (SDKs de LLM, runtime de LangGraph, persistencia). | Depende de `core/` e implementa sus puertos. |
| **`src/agents/`** | Definición de los agentes (Supervisor y agentes especializados) heredando de la abstracción de dominio. | Implementa contratos de `core/domain` y utiliza herramientas provistas por adaptadores. |
| **`src/config/`** | Configuración del sistema y validación de variables de entorno mediante **Zod**. | Independiente, provee configuración tipada a todo el sistema. |

> [!IMPORTANT]
> **Regla de oro de la Arquitectura Hexagonal**: La capa `core/` **NUNCA** debe importar de `adapters/`. Las dependencias apuntan siempre hacia el centro (`adapters` -> `ports` / `domain`).

---

## 📁 Estructura del Proyecto

```
agent/
├── src/
│   ├── core/                          # Núcleo — sin dependencias de LangGraph ni SDKs
│   │   ├── domain/
│   │   │   ├── agent.interface.ts         # Contrato IAgent
│   │   │   ├── conversation.entity.ts     # Entidad de conversación / estado
│   │   │   └── message.value-object.ts    # Value object de mensaje
│   │   ├── ports/
│   │   │   ├── llm-provider.port.ts       # Puerto ILLMProvider
│   │   │   ├── tool.port.ts               # Puerto ITool
│   │   │   └── memory-store.port.ts       # Puerto IMemoryStore
│   │   └── use-cases/
│   │       ├── route-to-agent.use-case.ts # Caso de uso de enrutamiento
│   │       └── execute-conversation.use-case.ts # Caso de uso de ejecución
│   │
│   ├── adapters/                      # Implementaciones concretas e intercambiables
│   │   ├── llm/                       # Adaptadores de LLMs (OpenAI, DeepSeek, Anthropic, etc.)
│   │   ├── graph/
│   │   │   ├── langgraph-runtime.adapter.ts # Wrapper que aísla LangGraph
│   │   │   └── graph-builder.ts             # Builder para StateGraph
│   │   ├── persistence/               # Adaptadores de almacenamiento (PostgreSQL, memoria)
│   │   └── tools/                     # Adaptadores de herramientas externas
│   │
│   ├── agents/
│   │   ├── base-agent.ts              # Clase base abstracta BaseAgent
│   │   ├── supervisor-agent.ts        # Clase SupervisorAgent
│   │   └── ...                        # Subagentes especializados futuros
│   │
│   ├── config/
│   │   └── env.ts                     # Validación de variables con Zod
│   │
│   ├── types/                         # Tipos auxiliares globales
│   └── index.ts                       # Punto de entrada de la aplicación
│
├── test/                              # Tests unitarios y de integración con Vitest
├── .env.example                       # Plantilla de variables de entorno
├── .eslintrc.json                     # Configuración de ESLint
├── .prettierrc                        # Configuración de Prettier
├── .gitignore                         # Exclusiones de Git
├── .dockerignore                      # Exclusiones del contexto Docker
├── Dockerfile                         # Multi-stage: base -> deps -> dev -> build -> prod
├── docker-compose.yml                 # Entorno de desarrollo local con hot-reload
├── docker-compose.prod.yml            # Configuración de producción
├── package.json                       # Dependencias y scripts del proyecto
├── tsconfig.json                      # Configuración de TypeScript con alias de rutas
└── README.md
```

---

## 🚀 Puesta en Marcha

> [!TIP]
> **Forma recomendada**: Ejecutar todo el entorno a través de **Docker** para garantizar consistencia entre desarrollo y producción, aislamiento de versiones de Node.js y hot-reload integrado.

### 1. Configurar Variables de Entorno

Copia el archivo de ejemplo y completa tus claves:

```bash
cp .env.example .env
```

#### CRM

El agent persiste leads y citas en **HubSpot** a través del puerto `ICrm`, usando
una Private App access token. Configuración mínima:

```bash
CRM_PROVIDER=hubspot          # 'erpnext' revierte al adaptador legacy
CRM_WRITE_MODE=live           # 'dry_run' registra las escrituras sin aplicarlas
HUBSPOT_PRIVATE_APP_TOKEN=pat-...
HUBSPOT_API_BASE_URL=https://api.hubapi.com
HUBSPOT_API_VERSION=2026-09
```

La **política de agendamiento** (horarios, tipos de cita, festivos y capacidad)
vive en la **base de datos**, para poder administrarse desde un panel:

```bash
npm run scheduling:show              # política vigente y de dónde sale
npm run scheduling:seed              # sembrar la BD desde el entorno
npm run scheduling:seed -- --force   # sobrescribir
```

Las variables `SCHEDULING_*` son solo la semilla inicial y el respaldo mientras la
base de datos no tenga política: una vez sembrada, **manda la base de datos**.

El agent recibe la política de agendamiento vigente **inyectada en el prompt en cada
turno**, así que no la adivina ni depende de que el buscador recupere el FAQ. El FAQ
se genera desde la misma fuente:

```bash
npm run knowledge:faq        # regenera la sección del FAQ desde la política
npm run ingest               # indexa knowledge/ en la base de conocimiento
```

El agent es un asistente **de la empresa**: rechaza peticiones ajenas al negocio
(ayuda de programación, deberes, trivia) con un guard determinista antes de llamar
al modelo. Ver la sección de alcance en el runbook.

Antes de operar, verifica y prepara el portal:

```bash
npm run hubspot:verify       # solo comprueba token, scopes, propiedades y asociaciones
npm run hubspot:bootstrap    # crea lo que falte (idempotente)
npm run hubspot:smoke        # smoke test real, sin pasar por el LLM
```

> [!IMPORTANT]
> La guía operativa completa (scopes, objeto de citas, límites de HubSpot, modo
> dry-run, diagnóstico y rollback) está en
> [`docs/hubspot-runbook.md`](docs/hubspot-runbook.md).

### 2. Ejecutar con Docker (Recomendado)

Inicia el entorno de desarrollo con **hot-reload**:

```bash
docker compose up --build
```

O utilizando el script de npm:

```bash
npm run docker:dev
```

Para detener los contenedores:

```bash
docker compose down
```

Para construir la imagen optimizada para producción:

```bash
npm run docker:build
```

---

### 3. Ejecución Local (Alternativa sin Docker)

Si prefieres ejecutar directamente en tu host:

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar en modo desarrollo con recarga en vivo
npm run dev

# 3. Compilar a JavaScript para producción
npm run build

# 4. Ejecutar tests
npm run test

# 5. Ejecutar linter
npm run lint
```

---

## 📦 Scripts Disponibles

- `npm run dev`: Inicia el runtime en desarrollo con `tsx watch`.
- `npm run build`: Compila los archivos TypeScript a `dist/`.
- `npm run test`: Ejecuta los tests unitarios con `Vitest`.
- `npm run lint`: Analiza el código con `ESLint`.
- `npm run lint:fix`: Corrige problemas de estilo y reglas automáticamente.
- `npm run docker:dev`: Construye e inicia los servicios de desarrollo con Docker Compose.
- `npm run docker:build`: Construye la imagen de producción con el target `prod` del Dockerfile.
