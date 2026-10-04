import { describe, expect, it } from 'vitest';
import {
  buildScopeRefusal,
  classifyMessageScope,
  detectLocale,
} from '../src/core/domain/conversation-scope';

describe('classifyMessageScope', () => {
  describe('rechaza peticiones ajenas al negocio', () => {
    const offTopic = [
      'como se centra un div',
      '¿Cómo se centra un div en CSS?',
      'how do I center a div with flexbox',
      'escríbeme un script en python para ordenar una lista',
      'write me a function that reverses a string',
      '¿por qué me da este stack trace?',
      'ayúdame a depurar mi consulta SQL',
      'SELECT * FROM users JOIN orders ON users.id = orders.user_id',
      '<div class="container"></div>',
      'resuelve esta ecuación de segundo grado',
      '¿quién ganó el partido de ayer?',
      'qué clima hace en Madrid',
      '¿cuál es la capital de Australia?',
      'explain quantum entanglement to me',
      'npm install no me funciona',
      'docker compose up falla con un error de puerto',
    ];

    it.each(offTopic)('%s', (message) => {
      expect(classifyMessageScope(message).scope).toBe('out_of_scope');
    });

    it('reporta la señal que disparó el rechazo', () => {
      const decision = classifyMessageScope('como se centra un div');
      expect(decision.scope).toBe('out_of_scope');
      expect(decision.signal).toBeTruthy();
    });
  });

  describe('acepta preguntas sobre la empresa', () => {
    const inScope = [
      'Hola, ¿qué servicios ofrecen?',
      '¿Cuánto cuesta una integración con HubSpot?',
      'Quiero agendar una reunión',
      '¿Tienen disponibilidad la próxima semana?',
      'Necesito automatizar mi atención al cliente',
      '¿Hacen desarrollo de software a medida?',
      'me interesa una demo del producto',
      '¿Trabajan con CRM?',
      'mi correo es ana@empresa.com',
      '¿Puedo hablar con un comercial?',
    ];

    it.each(inScope)('%s', (message) => {
      expect(classifyMessageScope(message).scope).toBe('in_scope');
    });
  });

  describe('la ambigüedad se resuelve a favor del negocio', () => {
    it('una pregunta técnica que menciona a Synckre no se bloquea', () => {
      // Aunque contiene lenguaje técnico, es una pregunta legítima de negocio.
      const decision = classifyMessageScope('¿Synckre puede integrarse con nuestro CRM?');
      expect(decision.scope).toBe('in_scope');
      expect(decision.signal).toContain('business:');
    });

    it('una palabra técnica dentro de una consulta de servicios no la bloquea', () => {
      expect(classifyMessageScope('¿Ofrecen servicios de integración con API?').scope).toBe(
        'in_scope',
      );
    });

    it('no bloquea preguntas legítimas que mencionan tecnología', () => {
      // Falso positivo clásico: mencionar un lenguaje no convierte la pregunta
      // en una petición de ayuda de programación.
      const legit = [
        '¿Hacen desarrollo en Python?',
        '¿Trabajan con React y Node?',
        '¿Ofrecen servicios en la nube?',
        '¿Desarrollan aplicaciones móviles?',
        '¿Pueden integrarse con nuestra base de datos?',
        '¿Usan Docker para los despliegues?',
        'We need a Python integration for our CRM',
      ];
      for (const message of legit) {
        expect(classifyMessageScope(message).scope, message).toBe('in_scope');
      }
    });

    it('sí bloquea la petición de ayuda de programación en sí', () => {
      // La misma tecnología, pero pidiendo que resuelva el problema técnico.
      const blocked = [
        '¿cómo hago un bucle en Python?',
        'mi código de React no compila, ayúdame',
        'write me a Python script to parse this CSV',
      ];
      for (const message of blocked) {
        expect(classifyMessageScope(message).scope, message).toBe('out_of_scope');
      }
    });

    it('un mensaje sin señales no se bloquea: decide el modelo', () => {
      expect(classifyMessageScope('buenos días').scope).toBe('in_scope');
      expect(classifyMessageScope('').scope).toBe('in_scope');
    });
  });
});

describe('buildScopeRefusal', () => {
  it('ofrece alternativas en lugar de responder lo ajeno', () => {
    const es = buildScopeRefusal('es');
    const en = buildScopeRefusal('en');
    expect(es).toMatch(/servicios/i);
    expect(en).toMatch(/services/i);
    // No debe contener una respuesta a la pregunta ajena.
    expect(es.toLowerCase()).not.toContain('div');
    expect(en.toLowerCase()).not.toContain('div');
  });
});

describe('detectLocale', () => {
  it('reconoce español e inglés', () => {
    expect(detectLocale('como se centra un div')).toBe('es');
    expect(detectLocale('¿qué servicios tienen?')).toBe('es');
    expect(detectLocale('how do I center a div')).toBe('en');
    expect(detectLocale('what services do you offer')).toBe('en');
  });
});
