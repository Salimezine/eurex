import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { orgApi, OrgMyTask } from '../../lib/orgApi';

type FilterKey = 'toutes' | 'a_verifier' | 'en_cours' | 'a_faire' | 'bloque_client' | 'retard' | 'fait';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'toutes', label: 'Toutes' },
  { key: 'a_verifier', label: 'À vérifier' },
  { key: 'en_cours', label: 'En cours' },
  { key: 'a_faire', label: 'À faire' },
  { key: 'bloque_client', label: 'Bloquées' },
  { key: 'retard', label: 'En retard' },
  { key: 'fait', label: 'Faites' },
];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  a_faire: { label: 'À faire', cls: 'bg-gray-100 text-gray-600' },
  en_cours: { label: 'En cours', cls: 'bg-blue-100 text-blue-700' },
  a_verifier: { label: 'À vérifier', cls: 'bg-amber-100 text-amber-700' },
  fait: { label: 'Fait', cls: 'bg-green-100 text-green-700' },
  bloque_client: { label: 'Bloqué client', cls: 'bg-red-100 text-red-700' },
};

export default function OrgMesTaches() {
  // Filtres persistes dans l'URL (?status=&mine=&q=) : partageables + survit au refresh
  const [searchParams, setSearchParams] = useSearchParams();
  const [tasks, setTasks] = useState<OrgMyTask[]>([]);
  const [filter, setFilter] = useState<FilterKey>(
    (FILTERS.map(f => f.key) as string[]).includes(searchParams.get('status') || '') ? (searchParams.get('status') as FilterKey) : 'toutes'
  );
  const [mine, setMine] = useState(searchParams.get('mine') === '1');
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Persistance : ecrit les filtres dans l'URL (sans boucle : compare avant d'ecrire)
  useEffect(() => {
    const p = new URLSearchParams();
    if (filter !== 'toutes') p.set('status', filter);
    if (mine) p.set('mine', '1');
    if (q) p.set('q', q);
    const next = p.toString();
    if (next !== searchParams.toString()) setSearchParams(p, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, mine, q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Parameters<typeof orgApi.getMyTasks>[0] = { limit: 200 };
      if (filter === 'retard') params.overdue = true;
      else if (filter !== 'toutes') params.status = filter;
      if (mine) params.mine = true;
      if (q.trim()) params.q = q.trim();
      setTasks((await orgApi.getMyTasks(params)).tasks);
    } catch (e: any) {
      setError(e.message || 'Chargement impossible');
      setTasks([]);
    }
    setLoading(false);
  }, [filter, mine, q]);

  useEffect(() => {
    const h = setTimeout(load, 250);
    return () => clearTimeout(h);
  }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-900">✅ Mes tâches</h1>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Rechercher tâche ou client…"
          data-testid="mes-taches-search"
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-56 focus:ring-2 focus:ring-purple-500 outline-none"
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-4">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            data-testid={`mes-taches-filter-${f.key}`}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${filter === f.key
              ? 'bg-purple-600 border-purple-600 text-white'
              : 'bg-white border-gray-200 text-gray-600 hover:border-purple-300'}`}
          >
            {f.label}
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-gray-500 ml-2 cursor-pointer select-none">
          <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} className="rounded border-gray-300" />
          Assignées à moi seulement
        </label>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : tasks.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
          Aucune tâche pour ce filtre.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {tasks.map(t => {
            const meta = STATUS_META[t.status] || { label: t.status, cls: 'bg-gray-100 text-gray-600' };
            const late = t.days_left !== null && t.days_left < 0 && t.status !== 'fait';
            return (
              <Link
                key={t.id}
                to={`/cabinet/dossier/${t.dossier_id}?tab=checklist`}
                data-testid="mes-taches-row"
                className="flex items-center gap-3 px-4 py-3 hover:bg-purple-50/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900 truncate">{t.label}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.cls}`}>{meta.label}</span>
                    {late && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 animate-pulse" data-testid="mes-taches-late">
                        Retard {t.days_left}j
                      </span>
                    )}
                    {t.status !== 'fait' && !late && t.days_left !== null && t.days_left <= 3 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700">
                        J-{t.days_left}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {t.client_name} · Dossier {t.exercice}
                    {t.assigned_comptable_name && t.assigned_comptable_name !== '' ? ` · ${t.assigned_comptable_name}` : ''}
                    {t.blocked_reason ? ` · ⛔ ${t.blocked_reason}` : ''}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {t.due_date && (
                    <div className={`text-xs font-medium ${late ? 'text-red-600' : 'text-gray-500'}`}>
                      Échéance {t.due_date.split('-').reverse().join('/')}
                    </div>
                  )}
                  <div className="text-[10px] text-gray-400">MAJ {t.updated_at ? t.updated_at.slice(0, 10) : ''}</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <p className="text-xs text-gray-400 mt-3">{tasks.length} tâche(s) affichée(s) (max 200 — affinez le filtre pour en voir plus)</p>
      )}
    </div>
  );
}
