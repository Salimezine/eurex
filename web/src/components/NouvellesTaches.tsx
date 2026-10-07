import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { orgApi, OrgRecentTask } from '../lib/orgApi';
import { t } from '../lib/orgI18n';

// created_at (UTC) -> heure Tunisie (UTC+1, pas d'heure d'ete) : DD/MM/YYYY a HHhMM
const fmtCreatedAt = (s: string) => {
  const d = new Date(Date.parse(String(s).replace(' ', 'T') + 'Z') + 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} à ${p(d.getUTCHours())}h${p(d.getUTCMinutes())}`;
};

const restBadge = (daysLeft: number | null) => {
  if (daysLeft === null) return { cls: 'bg-gray-100 text-gray-500', label: 'Sans échéance' };
  if (daysLeft < 0) return { cls: 'bg-red-100 text-red-700', label: `Retard +${-daysLeft} j` };
  if (daysLeft === 0) return { cls: 'bg-amber-100 text-amber-700', label: "Échéance aujourd'hui" };
  if (daysLeft === 1) return { cls: 'bg-amber-100 text-amber-700', label: 'Demain' };
  return { cls: 'bg-indigo-100 text-indigo-700', label: `J-${daysLeft}` };
};

// Nouvelles tâches — partagé par le dashboard comptable ET le dashboard expert
export default function NouvellesTaches() {
  const [tasks, setTasks] = useState<OrgRecentTask[]>([]);

  useEffect(() => {
    let alive = true;
    orgApi.getMyRecentTasks().then(r => { if (alive) setTasks(r.tasks || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (tasks.length === 0) return null;

  return (
    <div data-testid="nouvelles-taches">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-2">
        🆕 Nouvelles tâches
        <span className="text-gray-400 font-normal">— dernières tâches ajoutées à vos dossiers</span>
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {tasks.map(rt => {
          const rest = restBadge(rt.days_left);
          return (
            <Link
              key={rt.id}
              to={`/cabinet/dossier/${rt.dossier_id}`}
              data-testid="recent-task-card"
              className="bg-white border border-indigo-200 rounded-xl p-4 hover:shadow-md hover:border-indigo-300 transition-all group"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <h4 className="font-bold text-sm text-gray-800 group-hover:text-indigo-700 truncate" data-testid="recent-task-label">{rt.label}</h4>
                <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${rest.cls}`} data-testid="recent-task-rest">{rest.label}</span>
              </div>
              <p className="text-[11px] text-gray-500 truncate" data-testid="recent-task-dossier">📁 {rt.client_name} · Exercice {rt.exercice}</p>
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                <span className="text-gray-500 flex items-center gap-1" data-testid="recent-task-created">🕒 Ajoutée le {fmtCreatedAt(rt.created_at)}</span>
                <span className="text-gray-400">{t(`status.${rt.status}`)}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
