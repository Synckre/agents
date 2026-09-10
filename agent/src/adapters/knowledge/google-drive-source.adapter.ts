import { GoogleAdapter } from '@adapters/google/google.adapter';
import {
  DriveFile,
  IKnowledgeSourceProvider,
  UnsupportedFileTypeError,
} from '@core/ports/knowledge-source.port';

/**
 * Adaptador de fuentes de Google Drive utilizando el cliente oficial de googleapis.
 * Reutiliza la misma autenticación OAuth2 de GoogleAdapter compartida con Google Calendar.
 */
export class GoogleDriveSourceAdapter implements IKnowledgeSourceProvider {
  constructor(private readonly google: GoogleAdapter) {}

  async listFiles(folderId: string): Promise<DriveFile[]> {
    const drive = this.google.getDriveClient();
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, modifiedTime)',
      pageSize: 1000,
    });

    const items = res.data.files ?? [];
    return items
      .filter((f) => f.id && f.name && f.mimeType)
      .map((f) => ({
        id: f.id as string,
        name: f.name as string,
        mimeType: f.mimeType as string,
        modifiedTime: f.modifiedTime ? new Date(f.modifiedTime) : new Date(),
      }));
  }

  async getTextContent(file: DriveFile): Promise<string> {
    const drive = this.google.getDriveClient();

    // 1. Google Docs nativo: exportación a texto plano
    if (file.mimeType === 'application/vnd.google-apps.document') {
      const res = await drive.files.export(
        { fileId: file.id, mimeType: 'text/plain' },
        { responseType: 'text' },
      );
      return typeof res.data === 'string' ? res.data : String(res.data ?? '');
    }

    // 2. Archivos PDF binarios: descarga en arraybuffer y extracción con pdf-parse
    if (file.mimeType === 'application/pdf') {
      const res = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'arraybuffer' },
      );
      return this.extractPdfText(Buffer.from(res.data as ArrayBuffer));
    }

    // 3. Archivos de texto o markdown planos
    if (
      file.mimeType.startsWith('text/') ||
      file.name.toLowerCase().endsWith('.txt') ||
      file.name.toLowerCase().endsWith('.md')
    ) {
      const res = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'text' },
      );
      return typeof res.data === 'string' ? res.data : String(res.data ?? '');
    }

    throw new UnsupportedFileTypeError(file.mimeType);
  }

  private async extractPdfText(buffer: Buffer): Promise<string> {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return parsed.text ?? '';
    } finally {
      await parser.destroy();
    }
  }
}
