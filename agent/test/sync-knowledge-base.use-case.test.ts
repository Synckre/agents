import { describe, expect, it, vi } from 'vitest';
import { IEmbeddingProvider } from '@core/ports/embedding-provider.port';
import { IKnowledgeBase, KnowledgeSourceRecord } from '@core/ports/knowledge-base.port';
import { DriveFile, IKnowledgeSourceProvider } from '@core/ports/knowledge-source.port';
import { SyncKnowledgeBaseUseCase } from '@core/use-cases/sync-knowledge-base.use-case';

describe('SyncKnowledgeBaseUseCase', () => {
  const createMockProvider = (files: DriveFile[] = [], text = 'Contenido de prueba'): IKnowledgeSourceProvider => ({
    listFiles: vi.fn().mockResolvedValue(files),
    getTextContent: vi.fn().mockResolvedValue(text),
  });

  const createMockKnowledgeBase = (sources: KnowledgeSourceRecord[] = []): IKnowledgeBase => ({
    search: vi.fn().mockResolvedValue([]),
    deleteBySourceId: vi.fn().mockResolvedValue(undefined),
    insertChunks: vi.fn().mockResolvedValue(undefined),
    getSource: vi.fn().mockImplementation(async (id: string) => sources.find((s) => s.sourceId === id) ?? null),
    listSources: vi.fn().mockResolvedValue(sources),
    saveSource: vi.fn().mockResolvedValue(undefined),
  });

  const createMockEmbeddings = (): IEmbeddingProvider => ({
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  });

  it('ingesta archivos nuevos en la base de conocimiento y registra la fuente', async () => {
    const file: DriveFile = {
      id: 'doc-new-1',
      name: 'FAQ Clientes.docx',
      mimeType: 'application/vnd.google-apps.document',
      modifiedTime: new Date('2026-09-01T10:00:00Z'),
    };

    const provider = createMockProvider([file], 'Preguntas frecuentes sobre Synckre');
    const knowledgeBase = createMockKnowledgeBase([]);
    const embeddings = createMockEmbeddings();

    const useCase = new SyncKnowledgeBaseUseCase(provider, knowledgeBase, embeddings);
    const result = await useCase.execute({
      folders: [{ folderId: 'folder-public', tag: 'public' }],
    });

    expect(result.newFiles).toBe(1);
    expect(result.updatedFiles).toBe(0);
    expect(result.deletedFiles).toBe(0);
    expect(result.unchangedFiles).toBe(0);
    expect(result.errors).toHaveLength(0);

    expect(provider.listFiles).toHaveBeenCalledWith('folder-public');
    expect(provider.getTextContent).toHaveBeenCalledWith(file);
    expect(embeddings.embed).toHaveBeenCalled();
    expect(knowledgeBase.insertChunks).toHaveBeenCalledWith('doc-new-1', [
      {
        content: 'Preguntas frecuentes sobre Synckre',
        embedding: [0.1, 0.2, 0.3],
        tags: ['public'],
      },
    ]);
    expect(knowledgeBase.saveSource).toHaveBeenCalledWith({
      sourceId: 'doc-new-1',
      name: 'FAQ Clientes.docx',
      tags: ['public'],
      driveModifiedTime: file.modifiedTime,
      status: 'active',
    });
  });

  it('actualiza archivos cuyo modifiedTime en Drive es posterior al registrado', async () => {
    const oldDate = new Date('2026-09-01T10:00:00Z');
    const newDate = new Date('2026-09-05T12:00:00Z');

    const file: DriveFile = {
      id: 'doc-updated-1',
      name: 'Manual.md',
      mimeType: 'text/markdown',
      modifiedTime: newDate,
    };

    const existingSource: KnowledgeSourceRecord = {
      sourceId: 'doc-updated-1',
      name: 'Manual.md',
      tags: ['internal'],
      driveModifiedTime: oldDate,
      status: 'active',
      createdAt: oldDate,
      updatedAt: oldDate,
    };

    const provider = createMockProvider([file], 'Nuevo manual actualizado');
    const knowledgeBase = createMockKnowledgeBase([existingSource]);
    const embeddings = createMockEmbeddings();

    const useCase = new SyncKnowledgeBaseUseCase(provider, knowledgeBase, embeddings);
    const result = await useCase.execute({
      folders: [{ folderId: 'folder-internal', tag: 'internal' }],
    });

    expect(result.newFiles).toBe(0);
    expect(result.updatedFiles).toBe(1);
    expect(result.deletedFiles).toBe(0);
    expect(result.unchangedFiles).toBe(0);

    expect(knowledgeBase.deleteBySourceId).toHaveBeenCalledWith('doc-updated-1');
    expect(knowledgeBase.insertChunks).toHaveBeenCalledWith('doc-updated-1', expect.any(Array));
    expect(knowledgeBase.saveSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'doc-updated-1',
        driveModifiedTime: newDate,
        status: 'active',
      }),
    );
  });

  it('omite archivos que no han sido modificados', async () => {
    const date = new Date('2026-09-01T10:00:00Z');

    const file: DriveFile = {
      id: 'doc-same-1',
      name: 'Precios.txt',
      mimeType: 'text/plain',
      modifiedTime: date,
    };

    const existingSource: KnowledgeSourceRecord = {
      sourceId: 'doc-same-1',
      name: 'Precios.txt',
      tags: ['public'],
      driveModifiedTime: date,
      status: 'active',
      createdAt: date,
      updatedAt: date,
    };

    const provider = createMockProvider([file], 'Precios fijos');
    const knowledgeBase = createMockKnowledgeBase([existingSource]);
    const embeddings = createMockEmbeddings();

    const useCase = new SyncKnowledgeBaseUseCase(provider, knowledgeBase, embeddings);
    const result = await useCase.execute({
      folders: [{ folderId: 'folder-public', tag: 'public' }],
    });

    expect(result.unchangedFiles).toBe(1);
    expect(result.newFiles).toBe(0);
    expect(result.updatedFiles).toBe(0);
    expect(result.deletedFiles).toBe(0);

    expect(provider.getTextContent).not.toHaveBeenCalled();
    expect(knowledgeBase.deleteBySourceId).not.toHaveBeenCalled();
    expect(knowledgeBase.insertChunks).not.toHaveBeenCalled();
  });

  it('limpia chunks y marca como deleted los archivos eliminados de Google Drive', async () => {
    const date = new Date('2026-08-20T10:00:00Z');

    const obsoleteSource: KnowledgeSourceRecord = {
      sourceId: 'doc-deleted-1',
      name: 'Promocion Agosto.pdf',
      tags: ['public'],
      driveModifiedTime: date,
      status: 'active',
      createdAt: date,
      updatedAt: date,
    };

    // Drive ya no retorna ningún archivo en la carpeta
    const provider = createMockProvider([], '');
    const knowledgeBase = createMockKnowledgeBase([obsoleteSource]);
    const embeddings = createMockEmbeddings();

    const useCase = new SyncKnowledgeBaseUseCase(provider, knowledgeBase, embeddings);
    const result = await useCase.execute({
      folders: [{ folderId: 'folder-public', tag: 'public' }],
    });

    expect(result.deletedFiles).toBe(1);
    expect(knowledgeBase.deleteBySourceId).toHaveBeenCalledWith('doc-deleted-1');
    expect(knowledgeBase.saveSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'doc-deleted-1',
        status: 'deleted',
      }),
    );
  });

  it('tolera fallos individuales por archivo y continúa con los restantes', async () => {
    const file1: DriveFile = {
      id: 'doc-bad',
      name: 'Corrupt.xyz',
      mimeType: 'application/octet-stream',
      modifiedTime: new Date(),
    };
    const file2: DriveFile = {
      id: 'doc-good',
      name: 'Guia.txt',
      mimeType: 'text/plain',
      modifiedTime: new Date(),
    };

    const provider: IKnowledgeSourceProvider = {
      listFiles: vi.fn().mockResolvedValue([file1, file2]),
      getTextContent: vi.fn().mockImplementation(async (f: DriveFile) => {
        if (f.id === 'doc-bad') throw new Error('Unsupported file type');
        return 'Contenido válido de la guía';
      }),
    };

    const knowledgeBase = createMockKnowledgeBase([]);
    const embeddings = createMockEmbeddings();

    const useCase = new SyncKnowledgeBaseUseCase(provider, knowledgeBase, embeddings);
    const result = await useCase.execute({
      folders: [{ folderId: 'folder-public', tag: 'public' }],
    });

    expect(result.newFiles).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      fileId: 'doc-bad',
      fileName: 'Corrupt.xyz',
      error: 'Unsupported file type',
    });
    expect(knowledgeBase.insertChunks).toHaveBeenCalledWith('doc-good', expect.any(Array));
  });

  it('registra error y continúa si listFiles falla para una carpeta específica', async () => {
    const provider: IKnowledgeSourceProvider = {
      listFiles: vi.fn().mockRejectedValueOnce(new Error('Google Drive API Rate Limit')),
      getTextContent: vi.fn(),
    };

    const knowledgeBase = createMockKnowledgeBase([]);
    const embeddings = createMockEmbeddings();

    const useCase = new SyncKnowledgeBaseUseCase(provider, knowledgeBase, embeddings);
    const result = await useCase.execute({
      folders: [{ folderId: 'folder-broken', tag: 'public' }],
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].fileId).toBe('folder-broken');
    expect(result.errors[0].error).toContain('Google Drive API Rate Limit');
  });
});
