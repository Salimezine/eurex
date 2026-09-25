import type { OrgTask } from './orgApi';

export const MONTH_LABELS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export const MONTH_LABELS_AR = [
  'جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان',
  'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export const MONTH_SHORT_FR = [
  'Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin',
  'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.',
];

export function monthLabel(month: number, lang: 'fr' | 'ar' = 'fr'): string {
  if (month < 1 || month > 12) return '';
  return (lang === 'ar' ? MONTH_LABELS_AR : MONTH_LABELS_FR)[month - 1];
}

export function monthShort(month: number): string {
  if (month < 1 || month > 12) return '';
  return MONTH_SHORT_FR[month - 1];
}

export function currentMonth(): number {
  return new Date().getMonth() + 1;
}

export interface MonthGroup {
  month: number | null; // null = annuel
  tasks: OrgTask[];
  stats: { total: number; fait: number; enCours: number; bloque: number };
}

export function taskStats(tasks: OrgTask[]) {
  const s = { total: tasks.length, fait: 0, enCours: 0, bloque: 0 };
  for (const t of tasks) {
    if (t.status === 'fait') s.fait++;
    else if (t.status === 'bloque_client') s.bloque++;
    else s.enCours++;
  }
  return s;
}

/** Groupe les tâches par mois (Janv..Déc) + un groupe annuel (month null) à la fin. */
export function groupTasksByMonth(tasks: OrgTask[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (let m = 1; m <= 12; m++) {
    const list = tasks.filter(t => t.month === m);
    groups.push({ month: m, tasks: list, stats: taskStats(list) });
  }
  const annual = tasks.filter(t => t.month === null || t.month === undefined);
  groups.push({ month: null, tasks: annual, stats: taskStats(annual) });
  return groups;
}

/** Filtre selon la sélection : un nombre (1-12), 'annuel' ou 'tous'. */
export type MonthFilter = number | 'annuel' | 'tous';

export function filterTasksByMonth(tasks: OrgTask[], filter: MonthFilter): OrgTask[] {
  if (filter === 'tous') return tasks;
  if (filter === 'annuel') return tasks.filter(t => t.month === null || t.month === undefined);
  return tasks.filter(t => t.month === filter);
}
