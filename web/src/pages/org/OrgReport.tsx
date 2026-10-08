import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { orgApi } from '../../lib/orgApi';
import ExerciceSelect from '../../components/ExerciceSelect';
import { currentExercice } from '../../lib/useExercice';

const MONTHS_SHORT = ['Janv.', 'Févr.', 'Mars', 'Avril', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
const p2 = (n: number) => String(n).padStart(2, '0');

export function fmtH(sec: number): string {
  if (!sec) return '0h';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}h${p2(m)}`;
}

const fmtDate = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const statusLabel: Record<string, string> = { en_cours: 'En cours', clos: 'Clos', archive: 'Archivé' };

export default function OrgReport() {
  const [exercice, setExercice] = useState<number>(currentExercice());
  const [exercices, setExercices] = useState<number[]>([]);
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    orgApi.getExercices().then((r: any) => setExercices(r.exercices || [])).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setErr('');
    orgApi.getMonthlyReport(exercice, month)
      .then(r => { if (alive) setData(r); })
      .catch(e => { if (alive) { setData(null); setErr(e.message); } })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [exercice, month]);

  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(exercice, month - 1 + delta, 1));
    setExercice(d.getUTCFullYear());
    setMonth(d.getUTCMonth() + 1);
  };

  const exportExcel = () => {
    if (!data) return;
    const t = data.totals;
    const aoa: any[][] = [
      [`Rapport mensuel — ${data.month_label}`],
      [`Généré le ${new Date(data.generated_at).toLocaleString('fr-FR')}`, '', `Périmètre : ${data.scope === 'cabinet' ? 'Cabinet' : 'Comptable'}`],
      [],
      ['Indicateur', 'Valeur'],
      ['Dossiers', t.dossiers],
      ['Dossiers clos', t.dossiers_clos],
      ['Avancement moyen (%)', t.progress],
      ['Tâches faites', `${t.tasks_done}/${t.tasks_total}`],
      ['Tâches en retard', t.tasks_late],
      ['Documents reçus', `${t.docs_received}/${t.docs_total}`],
      ['Heures pointées', fmtH(t.hours_seconds)],
      ['Échéances du mois', `${t.alerts_done}/${t.alerts_due}`],
      [],
      ['Dossiers', 'État', 'Avancement %', 'Tâches faites', 'Tâches total', 'Retards', 'Documents reçus', 'Documents total', 'Heures'],
      ...data.dossiers.map((d: any) => [d.client_name, statusLabel[d.status] || d.status, d.progress, d.tasks_done, d.tasks_total, d.tasks_late, d.docs_received, d.docs_total, fmtH(d.hours_seconds)]),
      [],
      ['Heures par collaborateur', 'Saisies', 'Heures'],
      ...data.hours_by_user.map((u: any) => [u.full_name, u.entries, fmtH(u.seconds)]),
      [],
      ['Échéances du mois', 'Date', 'Dossier', 'État'],
      ...data.alerts.map((a: any) => [a.title, fmtDate(a.due_date), a.dossier_label || 'Cabinet', a.done ? 'Fait' : 'À faire']),
      [],
      ['Tâches en retard', 'Échéance', 'Dossier', 'Statut'],
      ...data.late_tasks.map((l: any) => [l.label, fmtDate(l.due_date), l.dossier_label, l.status]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 46 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rapport');
    XLSX.writeFile(wb, `rapport-mensuel-${data.exercice}-${p2(data.month)}.xlsx`);
  };

  const t = data?.totals;
  const kpi = (key: string, label: string, value: string, sub?: string) => (
    <div key={key} data-testid={`report-kpi-${key}`} className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-xl font-extrabold text-gray-900 mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  );

  return (
    <div data-testid="report-page" className="pb-8">
      <style>{`@media print { .report-no-print { display: none !important; } }`}</style>

      <div className="flex flex-wrap items-center gap-3 mb-4 report-no-print">
        <h1 className="text-lg font-bold text-gray-900 mr-auto">📊 Rapport mensuel</h1>
        <ExerciceSelect value={exercice} options={exercices} onChange={setExercice} />
        <select
          data-testid="report-month"
          aria-label="Mois du rapport"
          value={month}
          onChange={e => setMonth(Number(e.target.value))}
          className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm font-semibold bg-white outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer"
        >
          {MONTHS_SHORT.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <button type="button" data-testid="report-prev" onClick={() => shiftMonth(-1)} title="Mois précédent" className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-600 hover:border-purple-300 hover:text-purple-700">‹</button>
        <button type="button" data-testid="report-today" onClick={() => { setExercice(currentExercice()); setMonth(new Date().getMonth() + 1); }} className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-600 hover:border-purple-300 hover:text-purple-700">Mois courant</button>
        <button type="button" data-testid="report-next" onClick={() => shiftMonth(1)} title="Mois suivant" className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-600 hover:border-purple-300 hover:text-purple-700">›</button>
        <button type="button" data-testid="report-excel" onClick={exportExcel} disabled={!data} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold">⬇ Excel</button>
        <button type="button" data-testid="report-print" onClick={() => window.print()} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-900 text-white text-sm font-semibold">🖨 PDF / Imprimer</button>
      </div>

      <div data-testid="report-title" className="text-sm font-bold text-purple-700 mb-3">
        {data ? data.month_label : (busy ? 'Chargement…' : '')}
        {data?.generated_at && <span className="ml-2 font-normal text-gray-400">généré le {new Date(data.generated_at).toLocaleString('fr-FR')}</span>}
      </div>
      {err && <div className="text-sm text-red-600 mb-3">Erreur : {err}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-5">
            {kpi('dossiers', 'Dossiers', String(t.dossiers), t.dossiers_clos ? `${t.dossiers_clos} clos` : undefined)}
            {kpi('progress', 'Avancement', `${t.progress}%`, 'moyen du cabinet')}
            {kpi('tasks', 'Tâches', `${t.tasks_done}/${t.tasks_total}`, 'faites')}
            {kpi('late', 'En retard', String(t.tasks_late))}
            {kpi('docs', 'Documents', `${t.docs_received}/${t.docs_total}`, 'reçus')}
            {kpi('hours', 'Heures', fmtH(t.hours_seconds), 'pointées sur le mois')}
            {kpi('alerts', 'Échéances', `${t.alerts_done}/${t.alerts_due}`, 'faites / du mois')}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5 shadow-sm">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-sm font-bold text-gray-700">📁 Dossiers de l'exercice</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100">
                    <th className="px-4 py-2">Client</th><th className="px-2 py-2">État</th><th className="px-2 py-2">Avancement</th>
                    <th className="px-2 py-2">Tâches</th><th className="px-2 py-2">Retards</th><th className="px-2 py-2">Documents</th><th className="px-2 py-2">Heures</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dossiers.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-4 text-gray-400 text-center">Aucun dossier pour cet exercice</td></tr>
                  )}
                  {data.dossiers.map((d: any) => (
                    <tr key={d.id} data-testid="report-dossier-row" className="border-b border-gray-50 last:border-0 hover:bg-purple-50/40">
                      <td className="px-4 py-2 font-semibold text-gray-900">{d.client_name}</td>
                      <td className="px-2 py-2">{d.status === 'clos' ? '🔒' : '🔵'} {statusLabel[d.status] || d.status}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-purple-500" style={{ width: `${Math.min(100, d.progress)}%` }} /></div>
                          <span className="text-xs font-bold text-gray-600">{d.progress}%</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-gray-700">{d.tasks_done}/{d.tasks_total}</td>
                      <td className="px-2 py-2">{d.tasks_late ? <span className="font-bold text-rose-600">{d.tasks_late}</span> : <span className="text-gray-400">0</span>}</td>
                      <td className="px-2 py-2 text-gray-700">{d.docs_received}/{d.docs_total}</td>
                      <td className="px-2 py-2 font-semibold text-gray-700">{fmtH(d.hours_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-sm font-bold text-gray-700">⏱ Heures par collaborateur</div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100"><th className="px-4 py-2">Collaborateur</th><th className="px-2 py-2">Saisies</th><th className="px-4 py-2 text-right">Heures</th></tr></thead>
                <tbody>
                  {data.hours_by_user.length === 0 && <tr><td colSpan={3} className="px-4 py-4 text-gray-400 text-center">Aucune heure pointée sur le mois</td></tr>}
                  {data.hours_by_user.map((u: any) => (
                    <tr key={u.user_id} data-testid="report-hours-row" className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-2 font-semibold text-gray-900">{u.full_name}</td>
                      <td className="px-2 py-2 text-gray-600">{u.entries}</td>
                      <td className="px-4 py-2 text-right font-bold text-gray-900">{fmtH(u.seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-sm font-bold text-gray-700">⏰ Échéances du mois</div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100"><th className="px-4 py-2">Date</th><th className="px-2 py-2">Échéance</th><th className="px-4 py-2">État</th></tr></thead>
                <tbody>
                  {data.alerts.length === 0 && <tr><td colSpan={3} className="px-4 py-4 text-gray-400 text-center">Aucune échéance ce mois-ci</td></tr>}
                  {data.alerts.map((a: any) => (
                    <tr key={a.id + a.due_date} data-testid="report-alert-row" className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-2 whitespace-nowrap text-gray-700">{fmtDate(a.due_date)}</td>
                      <td className="px-2 py-2"><span className="font-semibold text-gray-900">{a.title}</span>{a.dossier_label && <span className="block text-[11px] text-gray-400">{a.dossier_label}</span>}</td>
                      <td className="px-4 py-2">{a.done ? <span className="text-emerald-600 font-bold">✓ Fait</span> : <span className="text-amber-600 font-bold">À faire</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mt-5 shadow-sm">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-sm font-bold text-gray-700">🔴 Tâches en retard</div>
            <table className="w-full text-sm">
              <tbody>
                {data.late_tasks.length === 0 && <tr><td className="px-4 py-4 text-gray-400 text-center">Aucune tâche en retard 🎉</td></tr>}
                {data.late_tasks.map((l: any, i: number) => (
                  <tr key={i} data-testid="report-late-row" className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2 w-28 whitespace-nowrap text-rose-600 font-semibold">{fmtDate(l.due_date)}</td>
                    <td className="px-2 py-2 font-semibold text-gray-900">{l.label}</td>
                    <td className="px-4 py-2 text-gray-500">{l.dossier_label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
