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

/** Ce qui s'ouvre quand on clique : fichier R2, lien URL, ou rien. */
export function docOpenKind(doc: OrgDocument): 'file' | 'link' | null {
  if (doc.file_r2_key) return 'file';
  if (doc.url) return 'link';
  return null;
}

/** Icône du document : 📄 PDF, 🖼️ image, 🔗 lien, 📎 pièce. */
export function docIcon(doc: OrgDocument): string {
  if (doc.file_r2_key) return doc.file_type?.startsWith('image/') ? '🖼️' : '📄';
  if (doc.url) return '🔗';
  return '📎';
}

/** Taille humaine (1,5 Mo / 240 Ko). */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}
