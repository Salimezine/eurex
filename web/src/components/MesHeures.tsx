import { useState, useEffect } from 'react';
import { orgApi, OrgMyHours } from '../lib/orgApi';

const DAY_LABELS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

// Mes heures : 7 derniers jours realises vs norme 8h30 (lun-ven), repos sam-dim.
// Depassement (+XhYY, y compris heures faites le weekend) et solde net de semaine
// (rattrapage : le depassement d'un jour compense le ghyeb d'un autre).
// Auto-suffisant : fetch au montage + rafraichissement 15s (chrono en cours).
export default function MesHeures() {
  const [hours, setHours] = useState<OrgMyHours | null>(null);

  useEffect(() => { orgApi.getMyHours().then(setHours).catch(() => {}); }, []);

  useEffect(() => {
    const iv = setInterval(() => { orgApi.getMyHours().then(setHours).catch(() => {}); }, 15000);
    return () => clearInterval(iv);
  }, []);

  const fmtHm = (sec?: number) => {
    const s = Math.max(0, Math.floor(sec || 0));
    return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  };

  if (!hours) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4" data-testid="mes-heures">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
        ⏱ Mes heures
        <span className="text-gray-400 font-normal">— norme 8h30 du lundi au vendredi · repos sam-dim</span>
      </h3>

      {/* Aujourd'hui */}
      <div className="flex items-center justify-between flex-wrap gap-2 text-sm">
        <span className="text-gray-500">
          Aujourd'hui ({DAY_LABELS[hours.today.dow]} {hours.today.date.slice(8, 10)}/{hours.today.date.slice(5, 7)}) :{' '}
          <b className="text-gray-800">
            {fmtHm(hours.today.worked_seconds)} / {hours.today.rest ? 'Repos' : '8h30'}
          </b>
          {hours.today.overtime_seconds > 0 && (
            <span className="text-green-600 font-semibold ml-1">· +{fmtHm(hours.today.overtime_seconds)}</span>
          )}
        </span>
        <span className="text-xs text-gray-500">
          Semaine (7 jours) : <b className="text-gray-700">{fmtHm(hours.totals.worked_seconds)} / {fmtHm(hours.totals.norm_seconds)}</b>
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

      {/* Detail par jour */}
      <table className="w-full text-xs mt-3" data-testid="heures-table">
        <thead>
          <tr className="text-gray-400 text-left border-b border-gray-100">
            <th className="py-1.5 font-medium">Jour</th>
            <th className="py-1.5 font-medium text-right">Réalisé</th>
            <th className="py-1.5 font-medium text-right">Norme</th>
            <th className="py-1.5 font-medium text-right">Écart norme</th>
          </tr>
        </thead>
        <tbody>
          {hours.days.map(d => (
            <tr key={d.date} className={`border-b border-gray-50 ${d.is_today ? 'bg-purple-50/50 font-semibold' : ''}`}>
              <td className="py-1.5 text-gray-600">
                {DAY_LABELS[d.dow]} {d.date.slice(8, 10)}/{d.date.slice(5, 7)}
                {d.is_today && <span className="text-purple-500 ml-1">· aujourd'hui</span>}
              </td>
              <td className="py-1.5 text-right text-gray-700">{fmtHm(d.worked_seconds)}</td>
              <td className="py-1.5 text-right">
                {d.rest ? <span className="text-gray-400 italic">Repos</span> : <span className="text-gray-600">8h30</span>}
              </td>
              <td className="py-1.5 text-right">
                {d.overtime_seconds > 0 ? <span className="text-green-600 font-semibold">+{fmtHm(d.overtime_seconds)}</span>
                  : d.rest ? <span className="text-gray-300">—</span>
                  : d.missing_seconds > 0 ? <span className="text-rose-500 font-semibold">{fmtHm(d.missing_seconds)}</span>
                  : <span className="text-green-600 font-semibold">✓ atteint</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
