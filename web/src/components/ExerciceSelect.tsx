import { t } from '../lib/orgI18n';
import { currentExercice } from '../lib/useExercice';

// Selecteur d'exercice du dashboard (expert ET comptable).
// Filtre : table clients/dossiers, Nouvelles taches, A verifier, Mes heures.
// Les echeances fiscales restent calendaires (hors perimetre).
export default function ExerciceSelect({ value, options, onChange }: {
  value: number;
  options: number[];
  onChange: (y: number) => void;
}) {
  const years = Array.from(new Set([value, ...(options.length ? options : [currentExercice()])])).sort((a, b) => b - a);
  const cur = currentExercice();
  const isCurrent = value === cur;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t('dash.exercice')}</span>
      <select
        aria-label={t('dash.exercice')}
        data-testid="dash-exercice"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className={`px-2 py-1.5 border rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer ${
          isCurrent ? 'bg-white border-gray-200 text-gray-800' : 'bg-amber-50 border-amber-300 text-amber-800'
        }`}
      >
        {years.map(y => (
          <option key={y} value={y} data-testid={`dash-exercice-${y}`}>{y}</option>
        ))}
      </select>
      {!isCurrent && (
        <span data-testid="dash-exercice-badge" className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">
          {value > cur ? t('dash.exercice_next') : t('dash.exercice_previous')}
        </span>
      )}
    </div>
  );
}
