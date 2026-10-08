import { useState, useEffect } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { orgApi, OrgMyHours } from '../lib/orgApi';
import { t } from '../lib/orgI18n';
import { useCardMin } from '../lib/useCardMin';

const DAY_LABELS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MONTH_LABELS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
type View = 'days' | 'month' | 'year';

// Mes heures : realise vs norme 8h30 (lun-ven), repos sam-dim, depassement (+XhYY)
// et solde net de semaine (rattrapage : le depassement d'un jour compense le ghyeb d'un autre).
// 3 vues de periode : Jours (7 derniers) / Mois (jour par jour) / Annee (mois par mois).
// Sans props : mes heures (/me/hours). Avec userId : heures d'un comptable (/comptables/{id}/hours).
// exercice optionnel : filtre sur l'exercice choisi au dashboard (l'API force alors la vue annee).
// Auto-suffisant : fetch au montage + rafraichissement 60s (pausé si onglet cache).
export default function MesHeures({ userId, title, exercice }: { userId?: string; title?: string; exercice?: number | null } = {}) {
  const [view, setView] = useState<View>('days');
  const [hours, setHours] = useState<OrgMyHours | null>(null);
  const { min, toggleMin } = useCardMin('eurex_heures_min');

  const fetchHours = (v: View) =>
    (userId ? orgApi.getComptableHours(userId, v, exercice) : orgApi.getMyHours(v, exercice)).then(h => {
      // l'API impose la vue "annee" sur un exercice passe : on aligne les onglets
      if (h && h.view && h.view !== v) setView(h.view as View);
      setHours(h);
    }).catch(() => {});

  useEffect(() => { fetchHours(view); }, [view, userId, exercice]);

  useEffect(() => {
    const tick = () => { if (!document.hidden) fetchHours(view); };
    const iv = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', tick); };
  }, [view, userId, exercice]);

  const fmtHm = (sec?: number) => {
    const s = Math.max(0, Math.floor(sec || 0));
    return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  };

  const totalsLabel = !hours ? ''
    : view === 'days' ? 'Semaine (7 jours)'
    : view === 'month' ? `Mois (au ${hours.today.date.slice(8, 10)}/${hours.today.date.slice(5, 7)})`
    : `Année ${hours.today.date.slice(0, 4)}`;

  const fmtDay = (d: { date: string; dow: number }) =>
    `${DAY_LABELS[d.dow]} ${d.date.slice(8, 10)}/${d.date.slice(5, 7)}`;

  const ecartCell = (overtime: number, rest: boolean, missing: number) =>
    overtime > 0 ? <span className="text-green-600 font-semibold">+{fmtHm(overtime)}</span>
      : rest ? <span className="text-gray-300">—</span>
      : missing > 0 ? <span className="text-rose-500 font-semibold">{fmtHm(missing)}</span>
      : <span className="text-green-600 font-semibold">✓ atteint</span>;

  if (!hours) return null;

  return (
    <div className={`bg-white border border-gray-200 rounded-2xl ${min ? 'px-3 py-1.5' : 'p-4'}`} data-testid="mes-heures">
      <div className={`flex items-center justify-between flex-wrap gap-2 ${min ? '' : 'mb-3'}`}>
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          ⏱ {title || 'Mes heures'}
          {!min && (
            <span className="text-gray-400 font-normal">— norme 8h30 du lundi au vendredi · repos sam-dim</span>
          )}
        </h3>
        {/* En carte minimale : le resume du jour tient dans l'entete */}
        {min && (
          <span data-testid="heures-today-chip" className="ml-auto text-[10px] font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
            Aujourd'hui {fmtHm(hours.today.worked_seconds)}{hours.today.rest ? ' · repos' : ' / 8h30'}
          </span>
        )}
        {/* Onglets de periode : jours / mois / annee */}
        {!min && (
        <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-lg p-1" role="tablist">
          {([
            { key: 'days' as View, label: 'Jours (7j)' },
            { key: 'month' as View, label: 'Mois' },
            { key: 'year' as View, label: 'Année' },
          ]).map(tab => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={view === tab.key}
              onClick={() => setView(tab.key)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                view === tab.key ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        )}
        <button
          onClick={toggleMin}
          title={t(min ? 'card.expand' : 'card.minimize')}
          data-testid="heures-minimize"
          className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          {min ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {!min && (
      <>
      {/* Aujourd'hui */}
      <div className="flex items-center justify-between flex-wrap gap-2 text-sm">
        <span className="text-gray-500">
          Aujourd'hui ({fmtDay(hours.today)}) :{' '}
          <b className="text-gray-800">
            {fmtHm(hours.today.worked_seconds)} / {hours.today.rest ? 'Repos' : '8h30'}
          </b>
          {hours.today.overtime_seconds > 0 && (
            <span className="text-green-600 font-semibold ml-1">· +{fmtHm(hours.today.overtime_seconds)}</span>
          )}
        </span>
        <span className="text-xs text-gray-500">
          {totalsLabel} : <b className="text-gray-700">{fmtHm(hours.totals.worked_seconds)} / {fmtHm(hours.totals.norm_seconds)}</b>
          {hours.totals.net_missing_seconds > 0
            ? <span className="text-rose-500 font-semibold"> · manque {fmtHm(hours.totals.net_missing_seconds)} (solde net)</span>
            : hours.totals.surplus_seconds > 0
              ? <span className="text-green-600 font-semibold"> · +{fmtHm(hours.totals.surplus_seconds)} au-delà de la norme</span>
              : <span className="text-green-600 font-semibold"> · à jour</span>}
        </span>
      </div>

      {/* Barre du jour */}
      <div className="h-2 bg-gray-100 rounded-full mt-2 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${hours.today.rest ? 100 : Math.min(100, Math.round((hours.today.worked_seconds / (hours.today.norm_seconds || 1)) * 100))}%`,
            background: hours.today.rest ? '#e5e7eb'
              : hours.today.worked_seconds >= hours.today.norm_seconds ? '#22c55e'
              : hours.today.worked_seconds >= hours.today.norm_seconds / 2 ? '#f59e0b'
              : '#f43f5e',
          }}
        />
      </div>

      {/* Detail : jours (vues jours/mois) ou mois (vue annee) */}
      <table className="w-full text-xs mt-3" data-testid="heures-table">
        <thead>
          <tr className="text-gray-400 text-left border-b border-gray-100">
            <th className="py-1.5 font-medium">{view === 'year' ? 'Mois' : 'Jour'}</th>
            <th className="py-1.5 font-medium text-right">Réalisé</th>
            <th className="py-1.5 font-medium text-right">Norme</th>
            <th className="py-1.5 font-medium text-right">Écart norme</th>
          </tr>
        </thead>
        <tbody>
          {view === 'year'
            ? (hours.months || []).map(m => (
                <tr key={m.month} className={`border-b border-gray-50 ${m.is_current ? 'bg-purple-50/50 font-semibold' : ''}`}>
                  <td className="py-1.5 text-gray-600">
                    {MONTH_LABELS[m.month - 1]}
                    {m.is_current && <span className="text-purple-500 ml-1">· en cours</span>}
                  </td>
                  <td className="py-1.5 text-right text-gray-700">{fmtHm(m.worked_seconds)}</td>
                  <td className="py-1.5 text-right text-gray-600">{fmtHm(m.norm_seconds)}</td>
                  <td className="py-1.5 text-right">{ecartCell(m.overtime_seconds, false, m.missing_seconds)}</td>
                </tr>
              ))
            : hours.days.map(d => (
                <tr key={d.date} className={`border-b border-gray-50 ${d.is_today ? 'bg-purple-50/50 font-semibold' : ''}`}>
                  <td className="py-1.5 text-gray-600">
                    {fmtDay(d)}
                    {d.is_today && <span className="text-purple-500 ml-1">· aujourd'hui</span>}
                  </td>
                  <td className="py-1.5 text-right text-gray-700">{fmtHm(d.worked_seconds)}</td>
                  <td className="py-1.5 text-right">
                    {d.rest ? <span className="text-gray-400 italic">Repos</span> : <span className="text-gray-600">8h30</span>}
                  </td>
                  <td className="py-1.5 text-right">{ecartCell(d.overtime_seconds, d.rest, d.missing_seconds)}</td>
                </tr>
              ))}
        </tbody>
      </table>
      </>
      )}
    </div>
  );
}
