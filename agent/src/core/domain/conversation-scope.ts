/**
 * Alcance conversacional del agent de la empresa.
 *
 * El system prompt ya instruye al modelo para no responder fuera de tema, pero eso
 * es probabilístico. Esta capa es determinista y barata: detecta peticiones
 * claramente ajenas al negocio (ayuda de programación, deberes, trivia, consejos
 * personales) y las rechaza sin llegar a llamar al modelo.
 *
 * Es deliberadamente CONSERVADOR. Un falso positivo (callar una pregunta legítima
 * sobre la empresa) es mucho peor que un falso negativo (dejar pasar algo que el
 * prompt rechazará igualmente), así que basta con que aparezca una señal de
 * negocio para considerarlo dentro de alcance.
 */

export type MessageScope = 'in_scope' | 'out_of_scope';

export interface ScopeDecision {
  readonly scope: MessageScope;
  /** Señal que disparó la decisión; útil para logs y tests. */
  readonly signal?: string;
}

/**
 * Señales de petición claramente ajena al negocio. Cada una es un patrón
 * inequívoco: fragmentos de código, peticiones explícitas de programar, deberes,
 * o consultas de cultura general.
 */
const OUT_OF_SCOPE_SIGNALS: Array<{ label: string; pattern: RegExp }> = [
  // Código pegado o delimitado.
  { label: 'code-fence', pattern: /```|\bconsole\.log\s*\(|\bdef\s+\w+\s*\(|\bfunction\s+\w*\s*\(|\bimport\s+[\w{*]/ },
  { label: 'html-tag', pattern: /<\/?(div|span|html|body|head|script|style|table|ul|li|a|p)\b[^>]*>/i },
  { label: 'sql', pattern: /\bselect\s+.+\s+from\s+\w|\bjoin\s+\w+\s+on\b/i },
  { label: 'css', pattern: /\b(display\s*:\s*flex|margin\s*:\s*0\s+auto|text-align\s*:|flexbox|grid-template|z-index|padding\s*:)/i },

  // Tecnologías y tareas de programación.
  { label: 'tech-stack', pattern: /\b(css|html|javascript|typescript|python|java\b|php|ruby|rust|golang|react|vue|angular|node\.?js|sql|regex|regexp|bash|powershell)\b/i },
  { label: 'programming-task', pattern: /\b(centrar?\s+un\s+div|center\s+a\s+div|escr[ií]beme?\s+(un\s+)?(script|c[oó]digo|funci[oó]n|programa)|write\s+(me\s+)?(a\s+)?(script|code|function|program)|genera\s+c[oó]digo|generate\s+code|depura|debug\s+(my|this)|stack\s?trace|error\s+de\s+compilaci[oó]n|compile\s+error|refactoriza|refactor\s+this)\b/i },
  { label: 'dev-ops', pattern: /\b(docker|kubernetes|git\s+(commit|push|pull|merge)|npm\s+install|pip\s+install|webpack|vite|nginx)\b/i },

  // Deberes y academia.
  { label: 'homework', pattern: /\b(resuelve|solve)\b.{0,30}\b(ecuaci[oó]n|equation|problema|problem|ejercicio|exercise|tarea|homework)\b|\b(homework|deberes|tarea\s+de\s+mate)\b/i },

  // Cultura general y trivia.
  { label: 'trivia', pattern: /\b(clima|weather)\b.{0,20}\b(en|in)\b|\bqui[eé]n\s+(gan[oó]|es\s+el\s+presidente)|who\s+won\b|\bcapital\s+(de|of)\b|\bcu[aá]l\s+es\s+la\s+capital\b/i },
  {
    // "explain X to me", "explícame X", "explain how/why/what ...": formas típicas
    // de pedir cultura general. Una consulta de negocio ("explain how your pricing
    // works") queda protegida por la señal de negocio, que tiene prioridad.
    label: 'general-knowledge',
    pattern:
      /\bexpl[ií]came\b|\bexplain\b[^?]{0,60}\b(to\s+me|for\s+me)\b|\bexplain\s+(me|how|why|what)\b|\bqu[eé]\s+es\s+(la\s+)?(fotos[ií]ntesis|gravedad|relatividad|entrop[ií]a)\b/i,
  },

  // Consejo personal o profesional regulado.
  { label: 'personal-advice', pattern: /\b(dieta|diet)\b.{0,30}\b(para|to)\b|\bdiagn[oó]stico\s+m[eé]dico|medical\s+advice|\bdeclaraci[oó]n\s+de\s+impuestos|tax\s+advice|invertir\s+en\s+(acciones|cripto)|should\s+i\s+invest\b/i },
];

/**
 * Señales de que la conversación SÍ trata sobre la empresa. Cualquiera de ellas
 * anula las señales de fuera de alcance (regla de ambigüedad a favor del negocio).
 */
const IN_SCOPE_SIGNALS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'company-name', pattern: /\bsynckre\b/i },
  {
    label: 'business-vocabulary',
    pattern:
      /\b(servicios?|services?|productos?|products?|precios?|prices?|pricing|coste|costo|tarifas?|cotizaci[oó]n|quote|presupuesto|planes?|plans?|demo|demostraci[oó]n|soluciones?|solutions?)\b/i,
  },
  {
    label: 'scheduling',
    pattern:
      /\b(cita|citas|reuni[oó]n|reuniones|agenda|agendar|reservar|disponibilidad|meeting|meetings|schedule|scheduling|availability|book\s+a|llamada|call)\b/i,
  },
  {
    label: 'business-domain',
    pattern:
      /\b(agentes?\s+conversacionales?|chatbot|automatizaci[oó]n|automation|integraci[oó]n|integrations?|crm|hubspot|erp|erpnext|inteligencia\s+artificial|\bia\b|\bai\b|consultor[ií]a|consulting|implementaci[oó]n|onboarding|soporte|support|clientes?|customers?|empresa|company|negocio|business|proyecto|project)\b/i,
  },
  {
    // Capacidades técnicas propias de la empresa. Sin esto, una pregunta legítima
    // como "¿hacen desarrollo en Python?" se bloquearía por mencionar un lenguaje,
    // que es justo el falso positivo a evitar.
    label: 'business-capability',
    pattern:
      /\b(desarrollo|development|software|tecnolog[ií]a|technology|sistemas?|systems?|ingenier[ií]a|engineering|datos|data|nube|cloud|aplicaciones?|applications?|api|apis|plataforma|platform|web|m[oó]vil|mobile|backend|frontend|base\s+de\s+datos|database)\b/i,
  },
  {
    // Formas de preguntar por lo que la empresa hace. Es intención de negocio
    // aunque el resto del mensaje contenga vocabulario técnico.
    label: 'business-intent',
    pattern:
      /\b(hacen|hac[eé]is|ofrecen|ofrec[eé]is|trabajan\s+con|desarrollan|implementan|usan|utilizan|manejan|prestan)\b|\b(do\s+you|can\s+you|are\s+you\s+able\s+to|would\s+you)\b[^?]{0,50}\b(offer|provide|build|develop|integrate|support|work\s+with|use|handle)\b/i,
  },
  {
    label: 'contact-intent',
    pattern: /\b(contacto|contact|correo|email|tel[eé]fono|phone|hablar\s+con|speak\s+with|comercial|sales)\b/i,
  },
  // Un correo o un teléfono indican intención comercial.
  { label: 'contact-data', pattern: /[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{7,}\d/ },
];

/**
 * Clasifica un mensaje del usuario. Sólo devuelve `out_of_scope` cuando hay una
 * señal inequívoca de otro tema Y ninguna señal de negocio.
 */
export function classifyMessageScope(text: string): ScopeDecision {
  const message = (text ?? '').trim();
  if (message.length === 0) {
    return { scope: 'in_scope' };
  }

  const business = IN_SCOPE_SIGNALS.find((signal) => signal.pattern.test(message));
  if (business) {
    return { scope: 'in_scope', signal: `business:${business.label}` };
  }

  const offTopic = OUT_OF_SCOPE_SIGNALS.find((signal) => signal.pattern.test(message));
  if (offTopic) {
    return { scope: 'out_of_scope', signal: offTopic.label };
  }

  // Sin señales de ningún tipo no se bloquea nada: decide el modelo.
  return { scope: 'in_scope' };
}

/**
 * Respuesta de rechazo, breve y con redirección. No responde nada de la pregunta
 * ajena: sólo indica el alcance y ofrece lo que sí se puede hacer.
 */
export function buildScopeRefusal(locale: 'es' | 'en' = 'es'): string {
  return locale === 'en'
    ? "I'm Synckre's assistant, so I can only help with our services, products and scheduling a call with the team. Would you like to know what we do, or book a meeting?"
    : 'Soy el asistente de Synckre, así que solo puedo ayudarte con nuestros servicios, productos y agendar una conversación con el equipo. ¿Te gustaría saber qué hacemos o reservar una reunión?';
}

/**
 * Detecta el idioma de forma heurística y suficiente para elegir el rechazo.
 * Es sólo para el mensaje prefabricado: la respuesta del modelo sigue el prompt.
 */
export function detectLocale(text: string): 'es' | 'en' {
  const message = (text ?? '').toLowerCase();
  if (/[¿¡ñáéíóú]/.test(message)) return 'es';
  const spanish = /\b(hola|qué|que|cómo|como|gracias|por\s+favor|puedo|quiero|necesito|tienen|hacen|precio|servicio|cita|reunión)\b/.test(
    message,
  );
  const english = /\b(hello|hi|what|how|thanks|please|can|want|need|have|do|you|price|service|meeting|call)\b/.test(
    message,
  );
  if (spanish && !english) return 'es';
  if (english && !spanish) return 'en';
  return 'es';
}
