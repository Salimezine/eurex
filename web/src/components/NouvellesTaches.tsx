import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { orgApi, OrgRecentTask } from '../lib/orgApi';
import { t } from '../lib/orgI18n';

const parse = (s: string) => Date.parse(String(s).replace(' ', 'T') + 'Z');

// created_at (UTC) -> heure Tunisie (UTC+1, pas d'heure d'ete) : DD/MM/YYYY a HHhMM
const fmtCreatedAt = (s: string) => {
  const d = new Date(parse(s) + 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} à ${p(d.getUTCHours())}h${p(d.getUTCMinutes())}`;
};

// "nouvelle" = ajoutee dans les dernieres 24h
const isNew = (s: string) => Date.now() - parse(s) < 24 * 3600 * 1000;

const restBadge = (daysLeft: number | null) => {
  if (daysLeft === null) return { cls: 'bg-gray-100 text-gray-500', label: 'Sans échéance' };
  if (daysLeft < 0) return { cls: 'bg-red-100 text-red-700', label: `Retard +${-daysLeft} j` };
  if (daysLeft === 0) return { cls: 'bg-amber-100 text-amber-700', label: "Échéance aujourd'hui" };
  if (daysLeft === 1) return { cls: 'bg-amber-100 text-amber-700', label: 'Demain' };
  return { cls: 'bg-indigo-100 text-indigo-700', label: `J-${daysLeft}` };
};

// Nouvelles tâches — partagé par le dashboard comptable ET le dashboard expert.
// - badge rouge : nb de tâches créées dans les dernières 24h
// - toast rouge : notification dès qu'une tâche apparaît pendant la session (refresh 30s)
// - les liens pointent directement vers la tâche (?task=<id>) dans la page dossier
export default function NouvellesTaches() {
  const [tasks, setTasks] = useState<OrgRecentTask[]>([]);
  const [toast, setToast] = useState<OrgRecentTask | null>(null);
  const knownIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = () => {
      orgApi.getMyRecentTasks().then(r => {
        if (!alive) return;
        const list = r.tasks || [];
        if (knownIds.current === null) {
          // premier chargement : on enregistre sans notifier (pas de toasts au démarrage)
          knownIds.current = new Set(list.map(x => x.id));
        } else {
          const fresh = list.find(x => !knownIds.current!.has(x.id));
          list.forEach(x => knownIds.current!.add(x.id));
          if (fresh) setToast(fresh);
        }
        setTasks(list);
      }).catch(() => {});
    };
    pull();
    const iv = setInterval(pull, 30000);
    const onFocus = () => pull();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      alive = false;
      clearInterval(iv);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  // auto-masquage du toast
  useEffect(() => {
    if (!toast) return;
    const to = setTimeout(() => setToast(null), 15000);
    return () => clearTimeout(to);
  }, [toast]);

  if (tasks.length === 0) return null;
  const freshCount = tasks.filter(x => isNew(x.created_at)).length;

  return (
    <div data-testid="nouvelles-taches">
      <h3 className="text-[13px] font-semibold text-gray-700 flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="flex items-center gap-1.5">
          🆕 Nouvelles tâches
          <span className="text-gray-400 font-normal">— dernières tâches ajoutées à vos dossiers</span>
        </span>
        {freshCount > 0 && (
          <span
            data-testid="nouvelles-taches-badge"
            className="text-[10px] font-bold text-white bg-red-600 px-2 py-0.5 rounded-full animate-pulse"
          >
            🔴 {freshCount} nouvelle{freshCount > 1 ? 's' : ''}
          </span>
        )}
      </h3>
      {/* comme les Échéances fiscales : la zone grandit avec le contenu, plafonne a max-h-72 puis scroll */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
        {tasks.map(rt => {
          const rest = restBadge(rt.days_left);
          const fresh = isNew(rt.created_at);
          return (
            <Link
              key={rt.id}
              to={`/cabinet/dossier/${rt.dossier_id}?task=${rt.id}`}
              data-testid="recent-task-card"
              className={`bg-white border rounded-lg px-3 py-2 hover:shadow-md transition-all group ${
                fresh ? 'border-red-300 shadow-sm shadow-red-100' : 'border-indigo-200 hover:border-indigo-300'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-0.5">
                <h4 className="font-bold text-[13px] leading-tight text-gray-800 group-hover:text-indigo-700 truncate" data-testid="recent-task-label">{rt.label}</h4>
                <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${rest.cls}`} data-testid="recent-task-rest">{rest.label}</span>
              </div>
              <p className="text-[10px] text-gray-500 truncate" data-testid="recent-task-dossier">
                📁 {rt.client_name} · Exercice {rt.exercice}
                {fresh && (
                  <span
                    data-testid="recent-task-new"
                    className="ml-1.5 inline-block text-[9px] font-bold text-white bg-red-600 px-1.5 py-0.5 rounded-full align-middle animate-pulse"
                  >
                    NOUVEAU
                  </span>
                )}
              </p>
              <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                <span className="text-gray-500 flex items-center gap-1" data-testid="recent-task-created">🕒 Ajoutée le {fmtCreatedAt(rt.created_at)}</span>
                <span className="text-gray-400">{t(`status.${rt.status}`)}</span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Notification rouge : nouvelle tâche détectée pendant la session */}
      {toast && (
        <div
          data-testid="new-task-toast"
          className="fixed top-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] bg-white border-2 border-red-500 rounded-xl shadow-xl shadow-red-200/70 overflow-hidden"
        >
          <div className="bg-red-600 text-white text-xs font-bold px-3 py-1.5 flex items-center justify-between">
            <span>🔴 Nouvelle tâche</span>
            <button
              onClick={() => setToast(null)}
              data-testid="new-task-toast-close"
              aria-label="Fermer la notification"
              className="text-white/90 hover:text-white px-1"
            >
              ✕
            </button>
          </div>
          <div className="p-3">
            <p className="text-sm font-bold text-gray-800 mb-0.5" data-testid="new-task-toast-label">{toast.label}</p>
            <p className="text-[11px] text-gray-500 mb-2" data-testid="new-task-toast-dossier">📁 {toast.client_name} · Exercice {toast.exercice}</p>
            <Link
              to={`/cabinet/dossier/${toast.dossier_id}?task=${toast.id}`}
              data-testid="new-task-toast-link"
              className="inline-flex items-center gap-1 text-xs font-bold text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              Voir la tâche →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
