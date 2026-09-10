export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: Date;
}

export interface IKnowledgeSourceProvider {
  listFiles(folderId: string): Promise<DriveFile[]>;
  getTextContent(file: DriveFile): Promise<string>;
}

export class UnsupportedFileTypeError extends Error {
  constructor(public readonly mimeType: string) {
    super(`Unsupported file type for knowledge extraction: ${mimeType}`);
    this.name = 'UnsupportedFileTypeError';
  }
}
