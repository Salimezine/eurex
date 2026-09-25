import { describe, it, expect } from 'vitest';
import { groupDocsByTask, docsForTask, countTaskDocs } from '../orgDocs';
import { OrgDocument } from '../orgApi';

const doc = (id: string, task_id: string | null, received = 0): OrgDocument => ({
  id, dossier_id: 'd1', task_id, label: `Doc ${id}`, received,
  received_at: null, received_note: null, file_r2_key: null, url: null,
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
