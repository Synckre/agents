import { describe, expect, it } from 'vitest';
import {
  interpolateConfirmedValues,
  levenshteinDistance,
} from '@core/domain/interpolate-confirmed-values';

describe('interpolateConfirmedValues (Domain Utility)', () => {
  describe('levenshteinDistance', () => {
    it('calcula distancias exactas para cadenas idénticas y con transposiciones/omisiones', () => {
      expect(levenshteinDistance('', '')).toBe(0);
      expect(levenshteinDistance('abc', 'abc')).toBe(0);
      expect(levenshteinDistance('ebrahim', 'ebrahm')).toBe(1); // Omisión de 'i'
      expect(levenshteinDistance('123', '132')).toBe(2); // Transposición
    });
  });

  describe('Interpolación de Email en Prosa', () => {
    it('corrige la transposición/omisión de caracteres en emails redactados de memoria por el LLM', () => {
      const llmGeneratedText =
        '¡Perfecto! Tu cita ha sido agendada con éxito para el 15 de septiembre. Te hemos enviado un correo de confirmación a ebrahmgonzalezb@gmail.com con los detalles.';

      const toolPayloads = [
        {
          ok: true,
          confirmed: {
            email: 'ebrahimgonzalezb@gmail.com',
            name: 'Ebrahim Gonzalez',
            date: '2026-09-15',
          },
        },
      ];

      const result = interpolateConfirmedValues(llmGeneratedText, toolPayloads);

      expect(result).not.toContain('ebrahmgonzalezb@gmail.com');
      expect(result).toContain('ebrahimgonzalezb@gmail.com');
      expect(result).toBe(
        '¡Perfecto! Tu cita ha sido agendada con éxito para el 15 de septiembre. Te hemos enviado un correo de confirmación a ebrahimgonzalezb@gmail.com con los detalles.',
      );
    });

    it('reemplaza marcadores de posición {{email}} con el valor literal confirmado', () => {
      const textWithPlaceholder = 'Confirmación enviada a {{email}}. ¡Nos vemos pronto!';
      const toolPayloads = [
        {
          ok: true,
          confirmed: {
            email: 'cliente@synckre.com',
          },
        },
      ];

      const result = interpolateConfirmedValues(textWithPlaceholder, toolPayloads);
      expect(result).toBe('Confirmación enviada a cliente@synckre.com. ¡Nos vemos pronto!');
    });

    it('preserva correos no relacionados que no correspondan al confirmado', () => {
      const text =
        'Hemos confirmado tu cita a ebrahmgonzalezb@gmail.com. Para cualquier consulta escribe a support@synckre.com.';
      const toolPayloads = [
        {
          ok: true,
          confirmed: {
            email: 'ebrahimgonzalezb@gmail.com',
          },
        },
      ];

      const result = interpolateConfirmedValues(text, toolPayloads);
      expect(result).toContain('ebrahimgonzalezb@gmail.com');
      expect(result).toContain('support@synckre.com');
    });
  });

  describe('Interpolación de Teléfono en Prosa', () => {
    it('corrige dígitos traspuestos en números de teléfono generados por el LLM', () => {
      const llmGeneratedText =
        'He guardado tu contacto con el número 555-132-4567. Te contactaremos pronto.';

      const toolPayloads = [
        {
          ok: true,
          confirmed: {
            name: 'Carlos',
            phone: '+1 555-123-4567',
          },
        },
      ];

      const result = interpolateConfirmedValues(llmGeneratedText, toolPayloads);

      expect(result).not.toContain('555-132-4567');
      expect(result).toContain('+1 555-123-4567');
    });

    it('reemplaza marcadores de posición {{phone}}', () => {
      const text = 'Te llamaremos al {{phone}}.';
      const toolPayloads = [
        {
          ok: true,
          confirmed: {
            phone: '+34 600 123 456',
          },
        },
      ];

      const result = interpolateConfirmedValues(text, toolPayloads);
      expect(result).toBe('Te llamaremos al +34 600 123 456.');
    });
  });

  describe('Interpolación de Enlaces Meet y Fallbacks', () => {
    it('reemplaza enlaces de Google Meet alterados por el enlace real', () => {
      const llmGeneratedText =
        'Puedes unirte a la videollamada aquí: https://meet.google.com/abc-hallucinated-code';

      const toolPayloads = [
        {
          ok: true,
          confirmed: {
            meetLink: 'https://meet.google.com/xyz-real-link',
          },
        },
      ];

      const result = interpolateConfirmedValues(llmGeneratedText, toolPayloads);

      expect(result).not.toContain('https://meet.google.com/abc-hallucinated-code');
      expect(result).toContain('https://meet.google.com/xyz-real-link');
    });

    it('extrae datos confirmados de propiedades estándar de appointment y lead si confirmed no está presente', () => {
      const llmText = 'Cita agendada para ebrahm@test.com';
      const toolPayloads = [
        {
          ok: true,
          appointment: {
            attendeeEmail: 'ebrahim@test.com',
            attendeeName: 'Ebrahim',
            start: '2026-09-15T14:00:00Z',
          },
        },
      ];

      const result = interpolateConfirmedValues(llmText, toolPayloads);
      expect(result).toBe('Cita agendada para ebrahim@test.com');
    });

    it('no modifica el texto cuando no hay payloads o no hay datos confirmados', () => {
      const text = 'Hola, ¿en qué puedo ayudarte hoy?';
      expect(interpolateConfirmedValues(text, [])).toBe(text);
      expect(interpolateConfirmedValues(text, [{ ok: false }])).toBe(text);
    });
  });
});
