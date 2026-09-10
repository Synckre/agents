import { splitIntoChunks } from '@core/domain/split-into-chunks';
import { IEmbeddingProvider } from '@core/ports/embedding-provider.port';
import { IKnowledgeBase, KnowledgeSourceRecord } from '@core/ports/knowledge-base.port';
import { DriveFile, IKnowledgeSourceProvider } from '@core/ports/knowledge-source.port';

export interface SyncFolderConfig {
  readonly folderId: string;
  readonly tag: string;
}

export interface SyncKnowledgeBaseOptions {
  readonly folders: SyncFolderConfig[];
  readonly chunkSize?: number;
  readonly overlap?: number;
}

export interface SyncFileError {
  readonly fileId: string;
  readonly fileName: string;
  readonly error: string;
}

export interface SyncResult {
  readonly newFiles: number;
  readonly updatedFiles: number;
  readonly deletedFiles: number;
  readonly unchangedFiles: number;
  readonly errors: SyncFileError[];
}

/**
 * Caso de uso: Sincronización automática de la base de conocimiento desde Google Drive.
 *
 * Mantiene la base de conocimiento en pgvector sincronizada con los archivos en Drive:
 * 1. Inserta nuevos archivos vectorizados.
 * 2. Actualiza archivos cuyo modifiedTime sea posterior al registrado.
 * 3. Omite archivos sin modificaciones.
 * 4. Limpia chunks de archivos eliminados en Drive y marca su estado como 'deleted'.
 * 5. Tolera fallos individuales por archivo sin abortar la sincronización global.
 */
export class SyncKnowledgeBaseUseCase {
  constructor(
    private readonly provider: IKnowledgeSourceProvider,
    private readonly knowledgeBase: IKnowledgeBase,
    private readonly embeddings: IEmbeddingProvider,
  ) {}

  async execute(options: SyncKnowledgeBaseOptions): Promise<SyncResult> {
    let newFiles = 0;
    let updatedFiles = 0;
    let deletedFiles = 0;
    let unchangedFiles = 0;
    const errors: SyncFileError[] = [];

    for (const folder of options.folders) {
      if (!folder.folderId) continue;

      let driveFiles: DriveFile[] = [];
      try {
        driveFiles = await this.provider.listFiles(folder.folderId);
      } catch (error) {
        errors.push({
          fileId: folder.folderId,
          fileName: `Folder:${folder.tag}`,
          error: error instanceof Error ? error.message : 'Failed to list files from folder',
        });
        continue;
      }

      const existingSources: KnowledgeSourceRecord[] = this.knowledgeBase.listSources
        ? await this.knowledgeBase.listSources(folder.tag)
        : [];

      const existingMap = new Map<string, KnowledgeSourceRecord>(
        existingSources.map((s) => [s.sourceId, s]),
      );
      const currentDriveIds = new Set<string>(driveFiles.map((f) => f.id));

      // 1. Procesar archivos presentes en Drive
      for (const file of driveFiles) {
        try {
          const existing = existingMap.get(file.id);

          // Caso 4: Archivo sin cambios (mismo modifiedTime o anterior)
          if (
            existing &&
            existing.status === 'active' &&
            file.modifiedTime.getTime() <= existing.driveModifiedTime.getTime()
          ) {
            unchangedFiles += 1;
            continue;
          }

          // Caso 3: Archivo modificado
          if (existing && existing.status === 'active') {
            await this.knowledgeBase.deleteBySourceId(file.id);
            await this.ingestFile(file, folder.tag, options);
            updatedFiles += 1;
            continue;
          }

          // Caso 2: Archivo nuevo (o previamente marcado como deleted)
          await this.ingestFile(file, folder.tag, options);
          newFiles += 1;
        } catch (error) {
          errors.push({
            fileId: file.id,
            fileName: file.name,
            error: error instanceof Error ? error.message : 'Failed to process file',
          });
        }
      }

      // 2. Caso 5: Archivos eliminados de Drive pero activos en base de datos
      for (const source of existingSources) {
        if (source.status === 'active' && !currentDriveIds.has(source.sourceId)) {
          try {
            await this.knowledgeBase.deleteBySourceId(source.sourceId);
            if (this.knowledgeBase.saveSource) {
              await this.knowledgeBase.saveSource({
                sourceId: source.sourceId,
                name: source.name,
                tags: source.tags,
                driveModifiedTime: source.driveModifiedTime,
                status: 'deleted',
              });
            }
            deletedFiles += 1;
          } catch (error) {
            errors.push({
              fileId: source.sourceId,
              fileName: source.name,
              error: error instanceof Error ? error.message : 'Failed to delete obsolete source',
            });
          }
        }
      }
    }

    return {
      newFiles,
      updatedFiles,
      deletedFiles,
      unchangedFiles,
      errors,
    };
  }

  private async ingestFile(
    file: DriveFile,
    tag: string,
    options: SyncKnowledgeBaseOptions,
  ): Promise<void> {
    const text = await this.provider.getTextContent(file);
    const chunks = splitIntoChunks(text, {
      chunkSize: options.chunkSize,
      overlap: options.overlap,
    });

    if (chunks.length > 0) {
      const chunkData = await Promise.all(
        chunks.map(async (content) => ({
          content,
          embedding: await this.embeddings.embed(content),
          tags: [tag],
        })),
      );
      await this.knowledgeBase.insertChunks(file.id, chunkData);
    }

    if (this.knowledgeBase.saveSource) {
      await this.knowledgeBase.saveSource({
        sourceId: file.id,
        name: file.name,
        tags: [tag],
        driveModifiedTime: file.modifiedTime,
        status: 'active',
      });
    }
  }
}
