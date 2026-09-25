import { OrgDocument } from './orgApi';

/** Regroupe les documents du dossier par task_id ('' = non rattaché à une tâche). */
export function groupDocsByTask(docs: OrgDocument[]): Record<string, OrgDocument[]> {
  const map: Record<string, OrgDocument[]> = {};
  for (const d of docs) {
    const key = d.task_id || '';
    if (!map[key]) map[key] = [];
    map[key].push(d);
  }
  return map;
}

/** Documents attachés à une tâche précise ('' → docs non rattachés). */
export function docsForTask(docs: OrgDocument[], taskId: string): OrgDocument[] {
  return docs.filter(d => (d.task_id || '') === taskId);
}

/** Nombre de documents d'une tâche (badge 📎). taskId = '' → docs non rattachés. */
export function countTaskDocs(docs: OrgDocument[], taskId: string): number {
  return docs.filter(d => (d.task_id || '') === taskId).length;
}
