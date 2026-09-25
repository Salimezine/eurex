import { describe, it, expect } from 'vitest';
import { groupDocsByTask, docsForTask, countTaskDocs, docOpenKind, docIcon, formatFileSize } from '../orgDocs';
import { OrgDocument } from '../orgApi';

const doc = (id: string, task_id: string | null, received = 0, patch: Partial<OrgDocument> = {}): OrgDocument => ({
  id, dossier_id: 'd1', task_id, label: `Doc ${id}`, received,
  received_at: null, received_note: null, file_r2_key: null, url: null,
  file_name: null, file_type: null, file_size: null,
  ...patch,
});

describe('orgDocs — documents par tâche', () => {
  it('groupDocsByTask regroupe par task_id', () => {
    const docs = [doc('a', 't1'), doc('b', 't2'), doc('c', 't1')];
    const map = groupDocsByTask(docs);
    expect(map['t1'].map(d => d.id)).toEqual(['a', 'c']);
    expect(map['t2'].map(d => d.id)).toEqual(['b']);
  });

  it('documents sans task_id dans la clé "" (dossier)', () => {
    const map = groupDocsByTask([doc('x', null), doc('y', null)]);
    expect(map[''].map(d => d.id)).toEqual(['x', 'y']);
  });

  it('liste vide → map vide', () => {
    expect(groupDocsByTask([])).toEqual({});
  });

  it('docsForTask filtre une tâche précise', () => {
    const docs = [doc('a', 't1'), doc('b', 't2'), doc('c', null)];
    expect(docsForTask(docs, 't1').map(d => d.id)).toEqual(['a']);
    expect(docsForTask(docs, 'zz')).toEqual([]);
  });

  it('countTaskDocs = 0 quand aucune pièce', () => {
    const docs = [doc('a', 't1'), doc('b', null)];
    expect(countTaskDocs(docs, 't2')).toBe(0);
    expect(countTaskDocs(docs, 't1')).toBe(1);
    expect(countTaskDocs(docs, '')).toBe(1);
  });
});

describe('orgDocs — ouverture & icônes', () => {
  it('docOpenKind : fichier prioritaire sur lien', () => {
    expect(docOpenKind(doc('a', 't1', 0, { file_r2_key: 'k.pdf', url: 'https://x' }))).toBe('file');
    expect(docOpenKind(doc('b', 't1', 0, { url: 'https://x' }))).toBe('link');
    expect(docOpenKind(doc('c', 't1'))).toBeNull();
  });

  it('docIcon : image / pdf / lien / pièce', () => {
    expect(docIcon(doc('a', null, 0, { file_r2_key: 'k', file_type: 'image/png' }))).toBe('🖼️');
    expect(docIcon(doc('b', null, 0, { file_r2_key: 'k', file_type: 'application/pdf' }))).toBe('📄');
    expect(docIcon(doc('c', null, 0, { url: 'https://x' }))).toBe('🔗');
    expect(docIcon(doc('d', null))).toBe('📎');
  });

  it('formatFileSize : Mo / Ko', () => {
    expect(formatFileSize(1572864)).toBe('1,5 Mo');
    expect(formatFileSize(245760)).toBe('240 Ko');
    expect(formatFileSize(10)).toBe('1 Ko');
  });
});
