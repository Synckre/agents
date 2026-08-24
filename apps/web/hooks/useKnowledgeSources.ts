'use client';

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/error-message';
import type { KnowledgeSource } from '@/lib/types';

export const KNOWLEDGE_DOMAINS = [
  { value: 'public', label: 'Público' },
  { value: 'internal', label: 'Interno' },
  { value: 'customer', label: 'Cliente específico' },
  { value: 'department', label: 'Departamento' },
  { value: 'project', label: 'Proyecto' },
];

export function useKnowledgeSources(initialSources: KnowledgeSource[]) {
  const [sources, setSources] = useState<KnowledgeSource[]>(initialSources);
  const [loading, setLoading] = useState(false);

  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState('public');
  const [content, setContent] = useState('');
  const [ingesting, setIngesting] = useState(false);

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfTitle, setPdfTitle] = useState('');
  const [pdfDomain, setPdfDomain] = useState('public');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    try {
      const data = await api.listKnowledge();
      setSources(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const ingestText = async (e: FormEvent) => {
    e.preventDefault();
    if (!title || !content || ingesting) return;

    setIngesting(true);
    try {
      await api.ingestDocument(title, domain, content, `${title.toLowerCase().replace(/\s+/g, '_')}.txt`);
      setTitle('');
      setContent('');
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setIngesting(false);
    }
  };

  const selectPdf = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setPdfFile(file);
    setUploadMsg(null);
    if (file && !pdfTitle) {
      setPdfTitle(file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '));
    }
  };

  const uploadPdf = async (e: FormEvent) => {
    e.preventDefault();
    if (!pdfFile || uploading) return;

    setUploading(true);
    setUploadMsg(null);
    const formData = new FormData();
    formData.append('file', pdfFile);
    if (pdfTitle.trim()) formData.append('title', pdfTitle.trim());
    formData.append('domain', pdfDomain);

    try {
      const res = (await api.uploadKnowledgePdf(formData)) as { message?: string };
      setUploadMsg({ ok: true, text: res.message || 'PDF ingerido correctamente.' });
      setPdfFile(null);
      setPdfTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadData();
    } catch (err) {
      console.error(err);
      setUploadMsg({ ok: false, text: errorMessage(err, 'No se pudo subir el PDF.') });
    } finally {
      setUploading(false);
    }
  };

  return {
    sources,
    loading,
    title,
    setTitle,
    domain,
    setDomain,
    content,
    setContent,
    ingesting,
    pdfFile,
    pdfTitle,
    setPdfTitle,
    pdfDomain,
    setPdfDomain,
    uploading,
    uploadMsg,
    fileInputRef,
    ingestText,
    selectPdf,
    uploadPdf,
  };
}
