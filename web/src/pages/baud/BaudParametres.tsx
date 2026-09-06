import { useState, useEffect } from 'react';
import { ShieldCheck, Save, RotateCcw, Eye, EyeOff } from 'lucide-react';
import { getConfig, saveConfig, resetConfig, verifyAccessCode, getDefaults, BaudConfig } from '../../lib/baudConfig';

export default function BaudParametres() {
  const [authenticated, setAuthenticated] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [config, setConfig] = useState<BaudConfig>(getConfig());
  const [msg, setMsg] = useState('');
  const [defaults, setDefaults] = useState<BaudConfig>(getDefaults());

  useEffect(() => {
    setDefaults(getDefaults());
  }, []);

  const handleAuth = () => {
    if (verifyAccessCode(codeInput)) {
      setAuthenticated(true);
      setMsg('');
    } else {
      setMsg('Code incorrect');
    }
  };

  const handleSave = () => {
    if (saveConfig(config)) {
      setMsg('Paramètres sauvegardés');
    } else {
      setMsg('Erreur de sauvegarde');
    }
  };

  const handleReset = () => {
    const d = resetConfig();
    setConfig(d);
    setDefaults(d);
    setMsg('Paramètres réinitialisés');
  };

  const update = (field: keyof BaudConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    setMsg('');
  };

  const updateBareme = (field: 'anciennete_bareme' | 'irpp_barème', idx: number, key: string, value: any) => {
    setConfig(prev => {
      const arr = [...prev[field]];
      arr[idx] = { ...arr[idx], [key]: key === 'max' && value === 'Infinity' ? Infinity : Number(value) };
      return { ...prev, [field]: arr };
    });
    setMsg('');
  };

  if (!authenticated) {
    return (
      <div className="max-w-md mx-auto mt-20 space-y-4">
        <div className="bg-white rounded-lg border p-6 text-center">
          <ShieldCheck size={40} className="mx-auto text-purple-500 mb-3" />
          <h2 className="text-lg font-bold mb-2">Paramètres BAUD</h2>
          <p className="text-sm text-gray-500 mb-4">Entrez le code d'accès</p>
          <div className="flex gap-2">
            <input
              type={showPassword ? 'text' : 'password'}
              value={codeInput}
              onChange={e => setCodeInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAuth()}
              className="flex-1 px-3 py-2 border rounded text-sm"
              placeholder="Code d'accès"
              autoFocus
            />
            <button onClick={() => setShowPassword(!showPassword)} className="p-2 border rounded hover:bg-gray-50">
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button onClick={handleAuth} className="px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700">
              Accéder
            </button>
          </div>
          {msg && <p className="text-red-600 text-sm mt-2">{msg}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Paramètres BAUD</h1>
        <div className="flex gap-2">
          <button onClick={handleReset} className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50 flex items-center gap-1">
            <RotateCcw size={14} /> Réinitialiser
          </button>
          <button onClick={handleSave} className="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 flex items-center gap-1">
            <Save size={14} /> Sauvegarder
          </button>
        </div>
      </div>

      {msg && (
        <div className={`p-3 rounded text-sm ${msg.includes('Erreur') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {msg}
        </div>
      )}

      {/* Taux de cotisations */}
      <Section title="Taux de cotisations">
        <Field label="CNSS salarié" value={config.cnss_salarial} onChange={v => update('cnss_salarial', v)} suffix="%" step={0.01} defaultVal={defaults.cnss_salarial} />
        <Field label="CNSS patronal" value={config.cnss_patronal} onChange={v => update('cnss_patronal', v)} suffix="%" step={0.01} defaultVal={defaults.cnss_patronal} />
        <Field label="AT/MP" value={config.at_mp} onChange={v => update('at_mp', v)} suffix="%" step={0.01} defaultVal={defaults.at_mp} />
        <Field label="TFP (BTP/industriel)" value={config.tfp} onChange={v => update('tfp', v)} suffix="%" step={0.01} defaultVal={defaults.tfp} />
        <Field label="FOPROLOS" value={config.foprolos} onChange={v => update('foprolos', v)} suffix="%" step={0.01} defaultVal={defaults.foprolos} />
        <Field label="CSS" value={config.css} onChange={v => update('css', v)} suffix="%" step={0.01} defaultVal={defaults.css} />
      </Section>

      {/* SMIG */}
      <Section title="SMIG">
        <Field label="SMIG régime 40h" value={config.smig_40h} onChange={v => update('smig_40h', v)} suffix="DT/mois" step={0.001} defaultVal={defaults.smig_40h} />
      </Section>

      {/* Frais professionnels */}
      <Section title="Frais professionnels">
        <Field label="Taux" value={config.frais_pro_taux} onChange={v => update('frais_pro_taux', v)} suffix="%" step={0.01} defaultVal={defaults.frais_pro_taux} />
        <Field label="Plafond annuel" value={config.frais_pro_plafond} onChange={v => update('frais_pro_plafond', v)} suffix="DT" step={100} defaultVal={defaults.frais_pro_plafond} />
      </Section>

      {/* Primes légales */}
      <Section title="Primes légales (montants pleins mensuels)">
        <Field label="Panier (2330)" value={config.prime_panier} onChange={v => update('prime_panier', v)} suffix="DT" step={0.001} defaultVal={defaults.prime_panier} />
        <Field label="Douche (3210)" value={config.prime_douche} onChange={v => update('prime_douche', v)} suffix="DT" step={0.001} defaultVal={defaults.prime_douche} />
        <Field label="Savon (3801, excl CNSS)" value={config.prime_savon} onChange={v => update('prime_savon', v)} suffix="DT" step={0.001} defaultVal={defaults.prime_savon} />
        <Field label="Lait (4385, excl CNSS)" value={config.prime_lait} onChange={v => update('prime_lait', v)} suffix="DT" step={0.001} defaultVal={defaults.prime_lait} />
        <Field label="Logement (4383)" value={config.prime_logement} onChange={v => update('prime_logement', v)} suffix="DT" step={0.001} defaultVal={defaults.prime_logement} />
        <Field label="Présence (avant juin)" value={config.presence_plein_avant_juin} onChange={v => update('presence_plein_avant_juin', v)} suffix="DT" step={0.001} defaultVal={defaults.presence_plein_avant_juin} />
        <Field label="Présence (depuis juin)" value={config.presence_plein_juin} onChange={v => update('presence_plein_juin', v)} suffix="DT" step={0.001} defaultVal={defaults.presence_plein_juin} />
        <Field label="MIT (fixe, PAS un %)" value={config.mit_plein} onChange={v => update('mit_plein', v)} suffix="DT" step={1} defaultVal={defaults.mit_plein} />
      </Section>

      {/* Transport */}
      <Section title="Indemnité de transport">
        <Field label="Ouvrier" value={config.transport_ouvrier} onChange={v => update('transport_ouvrier', v)} suffix="DT" step={0.001} defaultVal={defaults.transport_ouvrier} />
        <Field label="Chef d'équipe" value={config.transport_chef} onChange={v => update('transport_chef', v)} suffix="DT" step={0.001} defaultVal={defaults.transport_chef} />
      </Section>

      {/* Revalorisation */}
      <Section title="Revalorisation légale (décret 68/2026)">
        <Field label="Taux annuel" value={config.revalorisation_taux} onChange={v => update('revalorisation_taux', v)} suffix="%" step={0.01} defaultVal={defaults.revalorisation_taux} />
        <div className="flex items-center gap-2 mb-1">
          <label className="text-xs text-gray-500 w-48">Début d'application</label>
          <select value={config.revalorisation_debut_mois} onChange={e => update('revalorisation_debut_mois', Number(e.target.value))} className="px-2 py-1 border rounded text-sm">
            <option value={1}>Janvier</option><option value={2}>Février</option><option value={3}>Mars</option>
            <option value={4}>Avril</option><option value={5}>Mai</option><option value={6}>Juin</option>
            <option value={7}>Juillet</option><option value={8}>Août</option><option value={9}>Septembre</option>
            <option value={10}>Octobre</option><option value={11}>Novembre</option><option value={12}>Décembre</option>
          </select>
          <input type="number" value={config.revalorisation_debut_annee} onChange={e => update('revalorisation_debut_annee', Number(e.target.value))} className="w-20 px-2 py-1 border rounded text-sm" step={1} />
        </div>
      </Section>

      {/* Heures supplémentaires */}
      <Section title="Heures supplémentaires (Art. 90 Code du Travail)">
        <Field label="Seuil taux 25% (h/sem)" value={config.hs_seuil_25h_sem} onChange={v => update('hs_seuil_25h_sem', v)} suffix="h" step={0.5} defaultVal={defaults.hs_seuil_25h_sem} />
        <Field label="Majoration 25% (≤ seuil)" value={config.hs_majoration_25 * 100} onChange={v => update('hs_majoration_25', v / 100)} suffix="%" step={1} defaultVal={defaults.hs_majoration_25 * 100} />
        <Field label="Majoration 50% (> seuil)" value={config.hs_majoration_50 * 100} onChange={v => update('hs_majoration_50', v / 100)} suffix="%" step={1} defaultVal={defaults.hs_majoration_50 * 100} />
      </Section>

      {/* Nuit */}
      <Section title="Heures de nuit (3802)">
        <Field label="Majoration légale" value={config.nuit_majoration * 100} onChange={v => update('nuit_majoration', v / 100)} suffix="%" step={1} defaultVal={defaults.nuit_majoration * 100} />
      </Section>

      {/* Allocations familiales */}
      <Section title="Allocations familiales">
        <Field label="Chef de famille" value={config.alloc_chef_famille} onChange={v => update('alloc_chef_famille', v)} suffix="DT/mois" step={0.01} defaultVal={defaults.alloc_chef_famille} />
        <Field label="Par enfant" value={config.alloc_enfant} onChange={v => update('alloc_enfant', v)} suffix="DT/mois" step={0.001} defaultVal={defaults.alloc_enfant} />
        <Field label="Max enfants" value={config.alloc_enfants_max} onChange={v => update('alloc_enfants_max', v)} suffix="" step={1} defaultVal={defaults.alloc_enfants_max} />
      </Section>

      {/* Jours ouvrables */}
      <Section title="Jours ouvrables">
        <div className="flex items-center gap-2 mb-2">
          <label className="text-xs text-gray-500 w-48">Mode</label>
          <button onClick={() => update('jours_ouvrables_fixe', !config.jours_ouvrables_fixe)} className={`px-3 py-1 rounded text-sm font-medium ${config.jours_ouvrables_fixe ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
            {config.jours_ouvrables_fixe ? 'FIXE' : 'CALCULÉ'}
          </button>
          <span className="text-xs text-gray-400">défaut: {defaults.jours_ouvrables_fixe ? 'FIXE' : 'CALCULÉ'}</span>
        </div>
        <Field label="Nombre de jours" value={config.jours_ouvrables_defaut} onChange={v => update('jours_ouvrables_defaut', v)} suffix="jours" step={1} defaultVal={defaults.jours_ouvrables_defaut} />
      </Section>

      {/* Barème ancienneté */}
      <Section title="Prime d'ancienneté">
        <div className="flex items-center gap-2 mb-3">
          <label className="text-xs text-gray-500 w-48">Activée</label>
          <button onClick={() => update('anciennete_active', !config.anciennete_active)} className={`px-3 py-1 rounded text-sm font-medium ${config.anciennete_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {config.anciennete_active ? 'OUI' : 'NON'}
          </button>
          <span className="text-xs text-gray-400">défaut: {defaults.anciennete_active ? 'OUI' : 'NON'}</span>
        </div>
        {config.anciennete_bareme.map((b, i) => (
          <div key={i} className="flex items-center gap-2 mb-1">
            <span className="text-xs text-gray-500 w-32">≥ {b.min_years} ans</span>
            <input type="number" value={b.taux} onChange={e => updateBareme('anciennete_bareme', i, 'taux', e.target.value)} className="w-20 px-2 py-1 border rounded text-sm" step={1} />
            <span className="text-xs text-gray-400">% (défaut: {defaults.anciennete_bareme[i]?.taux})</span>
          </div>
        ))}
      </Section>

      {/* IRPP barème */}
      <Section title="Barème IRPP annuel (LF 2025 art. 36)">
        {config.irpp_barème.map((b, i) => (
          <div key={i} className="flex items-center gap-2 mb-1">
            <input type="number" value={b.min} onChange={e => updateBareme('irpp_barème', i, 'min', e.target.value)} className="w-20 px-2 py-1 border rounded text-sm" step={1000} />
            <span className="text-xs text-gray-400">→</span>
            <input type="text" value={b.max === Infinity ? '∞' : b.max} onChange={e => updateBareme('irpp_barème', i, 'max', e.target.value)} className="w-20 px-2 py-1 border rounded text-sm" disabled={b.max === Infinity} />
            <span className="text-xs text-gray-400">:</span>
            <input type="number" value={b.taux * 100} onChange={e => updateBareme('irpp_barème', i, 'taux', Number(e.target.value) / 100)} className="w-16 px-2 py-1 border rounded text-sm" step={1} />
            <span className="text-xs text-gray-400">% (défaut: {(defaults.irpp_barème[i]?.taux ?? 0) * 100}%)</span>
          </div>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <h3 className="font-semibold text-sm mb-3 text-gray-700">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, suffix, step, defaultVal }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix: string;
  step: number;
  defaultVal: number;
}) {
  const changed = value !== defaultVal;
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-500 w-48">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className={`w-28 px-2 py-1 border rounded text-sm ${changed ? 'border-amber-400 bg-amber-50' : ''}`}
        step={step}
      />
      <span className="text-xs text-gray-400 w-20">{suffix}</span>
      {changed && <span className="text-xs text-amber-600">modifié</span>}
      <span className="text-xs text-gray-300">défaut: {defaultVal}</span>
    </div>
  );
}
