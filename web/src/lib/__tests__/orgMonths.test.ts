import { describe, it, expect } from 'vitest';
import {
  monthLabel, monthShort, currentMonth, groupTasksByMonth,
  filterTasksByMonth, taskStats, MONTH_LABELS_FR, MONTH_LABELS_AR,
  QUARTER_MONTHS, MonthFilter,
} from '../orgMonths';
import type { OrgTask } from '../orgApi';

function makeTask(id: string, month: number | null, status: OrgTask['status'] = 'a_faire'): OrgTask {
  return {
    id,
    dossier_id: 'd1',
    label: `Tâche ${id}`,
    status,
    blocked_reason: status === 'bloque_client' ? 'Raison' : null,
    requires_document: 0,
    order_index: 1,
    month,
    updated_at: '2026-09-25T00:00:00Z',
    total_time_seconds: 0,
    timer_started_at: null,
    timer_user_id: null,
    updated_by_name: null,
    assigned_comptable_id: null,
    assigned_comptable_name: null,
    due_date: null,
  };
}

describe('orgMonths — libellés', () => {
  it('donne les 12 mois en fr et ar', () => {
    expect(MONTH_LABELS_FR).toHaveLength(12);
    expect(MONTH_LABELS_AR).toHaveLength(12);
    expect(monthLabel(9)).toBe('Septembre');
    expect(monthLabel(9, 'ar')).toBe('سبتمبر');
    expect(monthLabel(1)).toBe('Janvier');
    expect(monthLabel(12)).toBe('Décembre');
  });

  it('mois hors bornes = chaîne vide', () => {
    expect(monthLabel(0)).toBe('');
    expect(monthLabel(13)).toBe('');
  });

  it('abréviations', () => {
    expect(monthShort(1)).toBe('Janv.');
    expect(monthShort(9)).toBe('Sept.');
    expect(monthShort(12)).toBe('Déc.');
  });

  it('currentMonth dans 1..12', () => {
    const m = currentMonth();
    expect(m).toBeGreaterThanOrEqual(1);
    expect(m).toBeLessThanOrEqual(12);
  });
});

describe('orgMonths — groupement par mois', () => {
  const tasks: OrgTask[] = [
    makeTask('a', 1, 'fait'),
    makeTask('b', 1, 'a_faire'),
    makeTask('c', 9, 'bloque_client'),
    makeTask('d', 9, 'fait'),
    makeTask('e', null, 'a_faire'),
    makeTask('f', null, 'fait'),
  ];

  it('produit 13 groupes (12 mois + annuel)', () => {
    const groups = groupTasksByMonth(tasks);
    expect(groups).toHaveLength(13);
    expect(groups[0].month).toBe(1);
    expect(groups[11].month).toBe(12);
    expect(groups[12].month).toBeNull();
  });

  it('les tâches sont réparties dans les bons groupes', () => {
    const groups = groupTasksByMonth(tasks);
    expect(groups[0].tasks.map(t => t.id)).toEqual(['a', 'b']);      // janvier
    expect(groups[8].tasks.map(t => t.id)).toEqual(['c', 'd']);      // septembre
    expect(groups[11].tasks).toHaveLength(0);                        // décembre vide
    expect(groups[12].tasks.map(t => t.id)).toEqual(['e', 'f']);     // annuel
  });

  it('stats par groupe', () => {
    const groups = groupTasksByMonth(tasks);
    expect(groups[0].stats).toEqual({ total: 2, fait: 1, enCours: 1, bloque: 0 });
    expect(groups[8].stats).toEqual({ total: 2, fait: 1, enCours: 0, bloque: 1 });
    expect(groups[12].stats).toEqual({ total: 2, fait: 1, enCours: 1, bloque: 0 });
  });

  it('tâches dupliquées par mois conservent leur order', () => {
    const monthly: OrgTask[] = [];
    for (let m = 1; m <= 12; m++) monthly.push(makeTask(`m${m}`, m));
    const groups = groupTasksByMonth(monthly);
    for (const g of groups) {
      if (g.month === null) expect(g.tasks).toHaveLength(0);
      else expect(g.tasks).toHaveLength(1);
    }
  });
});

describe('orgMonths — filtre', () => {
  const tasks: OrgTask[] = [
    makeTask('a', 1),
    makeTask('b', 9),
    makeTask('c', null),
    makeTask('d', undefined as unknown as number | null),
  ];

  it("'tous' retourne tout", () => {
    expect(filterTasksByMonth(tasks, 'tous')).toHaveLength(4);
  });

  it("'annuel' retourne month null/undefined", () => {
    const res = filterTasksByMonth(tasks, 'annuel');
    expect(res.map(t => t.id)).toEqual(['c', 'd']);
  });

  it('mois numérique filtre exactement', () => {
    expect(filterTasksByMonth(tasks, 1).map(t => t.id)).toEqual(['a']);
    expect(filterTasksByMonth(tasks, 9).map(t => t.id)).toEqual(['b']);
    expect(filterTasksByMonth(tasks, 5)).toHaveLength(0);
  });

  it('type MonthFilter accepte 1-12, annuel, tous', () => {
    const filters: MonthFilter[] = [1, 6, 12, 'annuel', 'tous'];
    expect(filters).toHaveLength(5);
  });
});

describe('orgMonths — taskStats', () => {
  it('compte les statuts', () => {
    const tasks = [
      makeTask('a', 1, 'fait'),
      makeTask('b', 1, 'fait'),
      makeTask('c', 1, 'en_cours'),
      makeTask('d', 1, 'a_faire'),
      makeTask('e', 1, 'bloque_client'),
    ];
    expect(taskStats(tasks)).toEqual({ total: 5, fait: 2, enCours: 2, bloque: 1 });
  });

  it('liste vide = zéros', () => {
    expect(taskStats([])).toEqual({ total: 0, fait: 0, enCours: 0, bloque: 0 });
  });
});

describe('orgMonths — scénario dossier 12 mois (exercice complet)', () => {
  it('6 tâches mensuelles ×12 + 3 annuelles = 75 tâches', () => {
    const tasks: OrgTask[] = [];
    const monthlyLabels = ['Relevés', 'Achats', 'Ventes', 'Rapprochement', 'TVA', 'CNSS'];
    for (let m = 1; m <= 12; m++) {
      for (const l of monthlyLabels) tasks.push(makeTask(`${l}-${m}`, m));
    }
    for (const l of ['Balance', 'États', 'Liasse']) tasks.push(makeTask(l, null));

    expect(tasks).toHaveLength(75);

    const groups = groupTasksByMonth(tasks);
    for (let i = 0; i < 12; i++) expect(groups[i].tasks).toHaveLength(6);
    expect(groups[12].tasks).toHaveLength(3);
    expect(taskStats(tasks).total).toBe(75);

    // progression : 75 fait → 100%
    const done = tasks.map(t => ({ ...t, status: 'fait' as const }));
    expect(taskStats(done)).toEqual({ total: 75, fait: 75, enCours: 0, bloque: 0 });
  });
});

describe('orgMonths — fréquence trimestrielle', () => {
  it('QUARTER_MONTHS = Janv, Avr, Juil, Oct', () => {
    expect([...QUARTER_MONTHS]).toEqual([1, 4, 7, 10]);
  });

  it('tâche trimestrielle ×4 mois', () => {
    const tasks: OrgTask[] = QUARTER_MONTHS.map(m => makeTask(`tva-${m}`, m));
    expect(tasks).toHaveLength(4);
    const groups = groupTasksByMonth(tasks);
    for (const g of groups) {
      if (g.month !== null && QUARTER_MONTHS.includes(g.month as 1 | 4 | 7 | 10)) {
        expect(g.tasks).toHaveLength(1);
      } else {
        expect(g.tasks).toHaveLength(0);
      }
    }
  });

  it('groupe mixte mensuel + trimestriel + annuel', () => {
    const tasks: OrgTask[] = [
      makeTask('m1-1', 1, 'fait'),           // mensuelle (janv)
      makeTask('m1-9', 9),                    // mensuelle (sept)
      makeTask('tq-1', 1),                    // trimestrielle (janv)
      makeTask('tq-4', 4),                    // trimestrielle (avr)
      makeTask('an-1', null),                 // annuelle
    ];
    const groups = groupTasksByMonth(tasks);
    expect(groups[0].tasks.map(t => t.id)).toEqual(['m1-1', 'tq-1']); // janv
    expect(groups[3].tasks.map(t => t.id)).toEqual(['tq-4']);          // avr
    expect(groups[8].tasks.map(t => t.id)).toEqual(['m1-9']);          // sept
    expect(groups[12].tasks.map(t => t.id)).toEqual(['an-1']);         // annuel
    expect(taskStats(tasks)).toEqual({ total: 5, fait: 1, enCours: 4, bloque: 0 });
  });

  it('exercice complet avec les 3 fréquences', () => {
    const tasks: OrgTask[] = [];
    // 6 mensuelles ×12 = 72
    for (let m = 1; m <= 12; m++) for (let i = 0; i < 6; i++) tasks.push(makeTask(`men-${m}-${i}`, m));
    // 3 trimestrielles ×4 = 12
    for (const m of QUARTER_MONTHS) for (let i = 0; i < 3; i++) tasks.push(makeTask(`tri-${m}-${i}`, m));
    // 9 annuelles
    for (let i = 0; i < 9; i++) tasks.push(makeTask(`ann-${i}`, null));

    expect(tasks).toHaveLength(93);

    const groups = groupTasksByMonth(tasks);
    for (let i = 0; i < 12; i++) {
      const m = i + 1;
      const expected = 6 + (QUARTER_MONTHS.includes(m as 1 | 4 | 7 | 10) ? 3 : 0);
      expect(groups[i].tasks).toHaveLength(expected);
    }
    expect(groups[12].tasks).toHaveLength(9);
    expect(taskStats(tasks).total).toBe(93);
  });

  it("filtre 'annuel' isole les tâches sans mois ( trimestrielle exclue )", () => {
    const tasks: OrgTask[] = [
      ...QUARTER_MONTHS.map(m => makeTask(`q${m}`, m)),
      makeTask('annual', null),
    ];
    expect(filterTasksByMonth(tasks, 'annuel').map(t => t.id)).toEqual(['annual']);
    expect(filterTasksByMonth(tasks, 1).map(t => t.id)).toEqual(['q1']);
  });
});
