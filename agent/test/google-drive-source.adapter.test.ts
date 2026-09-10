import { describe, expect, it, vi } from 'vitest';
import { GoogleAdapter } from '@adapters/google/google.adapter';
import { GoogleDriveSourceAdapter } from '@adapters/knowledge/google-drive-source.adapter';
import { UnsupportedFileTypeError } from '@core/ports/knowledge-source.port';

vi.mock('pdf-parse', () => {
  return {
    PDFParse: class {
      async getText() {
        return { text: 'Texto extraído del documento PDF de prueba' };
      }
      async destroy() {}
    },
  };
});

describe('GoogleDriveSourceAdapter', () => {
  const createMockGoogleAdapter = (filesApiMock: any): GoogleAdapter => {
    return {
      getDriveClient: () => ({
        files: filesApiMock,
      }),
    } as unknown as GoogleAdapter;
  };

  describe('listFiles', () => {
    it('lista y mapea correctamente archivos dentro de una carpeta de Drive', async () => {
      const filesApiMock = {
        list: vi.fn().mockResolvedValue({
          data: {
            files: [
              {
                id: 'file-1',
                name: 'Doc1.gdoc',
                mimeType: 'application/vnd.google-apps.document',
                modifiedTime: '2026-09-01T10:00:00.000Z',
              },
              {
                id: 'file-2',
                name: 'Manual.pdf',
                mimeType: 'application/pdf',
                modifiedTime: '2026-09-02T12:00:00.000Z',
              },
              // Elemento incompleto o corrupto que debe ser filtrado
              {
                id: 'file-3',
              },
            ],
          },
        }),
      };

      const google = createMockGoogleAdapter(filesApiMock);
      const adapter = new GoogleDriveSourceAdapter(google);

      const files = await adapter.listFiles('folder-123');

      expect(filesApiMock.list).toHaveBeenCalledWith({
        q: "'folder-123' in parents and trashed = false",
        fields: 'files(id, name, mimeType, modifiedTime)',
        pageSize: 1000,
      });

      expect(files).toHaveLength(2);
      expect(files[0]).toEqual({
        id: 'file-1',
        name: 'Doc1.gdoc',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: new Date('2026-09-01T10:00:00.000Z'),
      });
      expect(files[1]).toEqual({
        id: 'file-2',
        name: 'Manual.pdf',
        mimeType: 'application/pdf',
        modifiedTime: new Date('2026-09-02T12:00:00.000Z'),
      });
    });
  });

  describe('getTextContent', () => {
    it('exporta Google Docs nativos a texto plano usando files.export', async () => {
      const filesApiMock = {
        export: vi.fn().mockResolvedValue({
          data: 'Contenido en texto plano exportado desde Google Doc',
        }),
      };

      const google = createMockGoogleAdapter(filesApiMock);
      const adapter = new GoogleDriveSourceAdapter(google);

      const text = await adapter.getTextContent({
        id: 'doc-1',
        name: 'Propuesta.gdoc',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: new Date(),
      });

      expect(filesApiMock.export).toHaveBeenCalledWith(
        { fileId: 'doc-1', mimeType: 'text/plain' },
        { responseType: 'text' },
      );
      expect(text).toBe('Contenido en texto plano exportado desde Google Doc');
    });

    it('descarga y parsea archivos PDF en binario arraybuffer', async () => {
      const fakeBuffer = Buffer.from('fake pdf data');
      const filesApiMock = {
        get: vi.fn().mockResolvedValue({
          data: fakeBuffer.buffer,
        }),
      };

      const google = createMockGoogleAdapter(filesApiMock);
      const adapter = new GoogleDriveSourceAdapter(google);

      const text = await adapter.getTextContent({
        id: 'pdf-1',
        name: 'Contrato.pdf',
        mimeType: 'application/pdf',
        modifiedTime: new Date(),
      });

      expect(filesApiMock.get).toHaveBeenCalledWith(
        { fileId: 'pdf-1', alt: 'media' },
        { responseType: 'arraybuffer' },
      );
      expect(text).toBe('Texto extraído del documento PDF de prueba');
    });

    it('descarga archivos de texto plano o markdown directamente', async () => {
      const filesApiMock = {
        get: vi.fn().mockResolvedValue({
          data: '# Título Markdown\nDetalles del servicio.',
        }),
      };

      const google = createMockGoogleAdapter(filesApiMock);
      const adapter = new GoogleDriveSourceAdapter(google);

      const text = await adapter.getTextContent({
        id: 'md-1',
        name: 'README.md',
        mimeType: 'text/markdown',
        modifiedTime: new Date(),
      });

      expect(filesApiMock.get).toHaveBeenCalledWith(
        { fileId: 'md-1', alt: 'media' },
        { responseType: 'text' },
      );
      expect(text).toBe('# Título Markdown\nDetalles del servicio.');
    });

    it('lanza UnsupportedFileTypeError para tipos no soportados', async () => {
      const google = createMockGoogleAdapter({});
      const adapter = new GoogleDriveSourceAdapter(google);

      await expect(
        adapter.getTextContent({
          id: 'img-1',
          name: 'foto.png',
          mimeType: 'image/png',
          modifiedTime: new Date(),
        }),
      ).rejects.toThrow(UnsupportedFileTypeError);
    });
  });
});
