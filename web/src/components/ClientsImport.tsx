import { useState, useRef } from 'react';
import { orgApi, OrgComptable } from '../lib/orgApi';

type ParsedRow = {
  line: number;
  name: string;
  matricule_fiscal?: string;
  contact_email?: string;
  contact_phone?: string;
  assigned_comptable_id?: string;
  comptable_label?: string;
  export_status?: string;
  person_type?: string;
  parseError?: string;
};

const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

const FIELD_ALIASES: [keyof ParsedRow, string[]][] = [
  ['name', ['name', 'nom', 'client', 'nomclient', 'raisonsociale', 'societe', 'intitule']],
  ['matricule_fiscal', ['matriculefiscal', 'mf', 'matricule', 'if', 'identifiantfiscal']],
  ['contact_email', ['email', 'mail', 'contactemail', 'courriel']],
  ['contact_phone', ['telephone', 'tel', 'phone', 'portable', 'contacttelephone', 'numerotel']],
  ['assigned_comptable_id', ['comptable', 'affecte', 'assigne', 'collaborateur', 'assigned']],
  ['export_status', ['export', 'statutexport', 'exportstatus', 'statut']],
  ['person_type', ['type', 'typepersonne', 'personetype']],
];
const DEFAULT_COLUMNS: (keyof ParsedRow)[] = ['name', 'matricule_fiscal', 'contact_email', 'contact_phone', 'assigned_comptable_id', 'export_status'];

// Découpe une ligne CSV (guillemets, séparateur ; ou ,)
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// Analyse d'un CSV de clients : retourne les lignes + les erreurs d'en-tête éventuelles
export function parseClientsCsv(text: string, comptables: OrgComptable[]): { rows: ParsedRow[]; error?: string } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim().length);
  if (!lines.length) return { rows: [], error: 'Collez d\'abord votre fichier CSV' };
  const delim = (lines[0].split(';').length > lines[0].split(',').length) ? ';' : ',';
  const first = splitLine(lines[0], delim);
  const mapping: ((string | undefined))[] = first.map(cell => {
    const nc = norm(cell);
    const hit = FIELD_ALIASES.find(([, aliases]) => aliases.some(a => nc === a || nc.startsWith(a)));
    return hit ? String(hit[0]) : undefined;
  });
  const hasHeader = mapping.includes('name');
  const cols = hasHeader ? mapping : DEFAULT_COLUMNS;
  const startLine = hasHeader ? 1 : 0;
  const findComp = (v: string) => {
    const nv = norm(v);
    if (!nv) return null;
    return comptables.find(c => c.id === v || norm(c.email) === nv || norm(c.full_name) === nv) || null;
  };
  const rows: ParsedRow[] = [];
  for (let i = startLine; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const row: ParsedRow = { line: i + 1, name: '' };
    cols.forEach((col, idx) => {
      if (!col || col === 'parseError') return;
      const v = (cells[idx] || '').trim();
      if (!v) return;
      if (col === 'assigned_comptable_id') {
        const comp = findComp(v);
        if (comp) { row.assigned_comptable_id = comp.id; row.comptable_label = comp.full_name || comp.email; }
        else row.parseError = `Comptable introuvable : « ${v} »`;
      } else if (col === 'export_status') {
        const ev = norm(v);
        const st = ev === 'exportatrice' || ev.startsWith('export') ? 'exportatrice'
          : ev.startsWith('semi') ? 'semi_exportatrice'
          : ev.startsWith('non') || ev.startsWith('pas') ? 'non_exportatrice' : null;
        if (st) row.export_status = st; else row.parseError = `Statut export inconnu : « ${v} »`;
      } else if (col === 'person_type') {
        const pv = norm(v);
        if (pv.startsWith('morale') || pv.startsWith('societe')) row.person_type = 'morale';
        else if (pv.startsWith('physique') || pv.startsWith('pers')) row.person_type = 'physique';
      } else {
        (row as any)[col] = v;
      }
    });
    if (!row.name) row.parseError = row.parseError || 'Nom requis';
    rows.push(row);
  }
  if (!rows.length) return { rows: [], error: 'Aucune ligne de données détectée' };
  if (rows.length > 500) return { rows: [], error: 'Maximum 500 lignes par import (' + rows.length + ')' };
  return { rows };
}

const TEMPLATE = [
  'name;matricule_fiscal;contact_email;contact_phone;comptable;export_status',
  'Exemple SARL;12345678/A/M/000;contact@exemple.tn;+216 71 000 000;salim.ezzine@eurextunisie.com;exportatrice',
  'Exemple 2;99887766;info@exemple2.tn;;Salim;semi_exportatrice',
].join('\r\n');

// Import de clients en masse depuis un CSV (collé ou chargé en fichier).
// Colonnes reconnues (en-tête facultatif, séparateur ; ou ,) :
// name, matricule_fiscal, contact_email, contact_phone, comptable (id/email/nom), export_status, person_type
export default function ClientsImport({ comptables, onImported }: { comptables: OrgComptable[]; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [parseError, setParseError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [createDossier, setCreateDossier] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const close = () => { setOpen(false); setRows(null); setParseError(''); setResult(null); setText(''); };

  const analyze = () => {
    setResult(null);
    const r = parseClientsCsv(text, comptables);
    setParseError(r.error || '');
    setRows(r.error ? null : r.rows);
  };

  const onFile = (f: File) => {
    const rd = new FileReader();
    rd.onload = () => { setText(String(rd.result || '')); setResult(null); setTimeout(analyze, 0); };
    rd.readAsText(f, 'utf-8');
  };

  const runImport = async () => {
    if (!rows) return;
    setBusy(true);
    setResult(null);
    try {
      const payloadRows = rows.map(r => ({
        line: r.line,
        name: r.name,
        matricule_fiscal: r.matricule_fiscal,
        contact_email: r.contact_email,
        contact_phone: r.contact_phone,
        assigned_comptable_id: r.assigned_comptable_id,
        export_status: r.export_status,
        person_type: r.person_type,
      }));
      const res = await orgApi.importClients({ clients: payloadRows, create_dossier: createDossier });
      setResult(res);
      if (res.counts.created > 0) onImported();
    } catch (e: any) {
      setParseError(e.message);
    }
    setBusy(false);
  };

  const okRows = rows ? rows.filter(r => !r.parseError) : [];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        data-testid="import-clients"
        title="Importer une liste de clients depuis un fichier CSV"
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-purple-300 hover:text-purple-700 transition-all"
      >
        📄 Importer CSV
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" data-testid="import-modal">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">Importer des clients (CSV)</h3>
              <button onClick={close} data-testid="import-close" className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">✕</button>
            </div>

            <p className="text-xs text-gray-500">
              Colonnes reconnues (séparateur <b>;</b> ou <b>,</b>) : <code>name</code>, <code>matricule_fiscal</code>, <code>contact_email</code>,
              <code> contact_phone</code>, <code>comptable</code> (id, email ou nom), <code>export_status</code>, <code>person_type</code>.
              L'en-tête est facultatif (sinon : nom, MF, email, tel, comptable, statut export).
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => orgApi.downloadCsv(TEMPLATE, 'modele-import-clients.csv')}
                data-testid="import-template"
                className="text-xs font-medium text-purple-600 hover:text-purple-800 underline"
              >
                ⬇ Télécharger le modèle CSV
              </button>
              <button onClick={() => fileRef.current?.click()} className="text-xs font-medium text-gray-600 hover:text-gray-800 underline">
                📂 Charger un fichier…
              </button>
              <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
            </div>

            <textarea
              value={text}
              onChange={e => { setText(e.target.value); setResult(null); }}
              data-testid="import-textarea"
              rows={6}
              placeholder={'name;matricule_fiscal;comptable;export_status\nSARL Alpha;12345678/A/M/000;salim.ezzine@eurextunisie.com;exportatrice'}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-purple-500 outline-none"
            />

            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={createDossier} onChange={e => setCreateDossier(e.target.checked)} className="rounded" />
                Créer aussi le dossier {new Date(Date.now() + 3600000).getUTCFullYear()} (avec les tâches du modèle)
              </label>
              <button
                onClick={analyze}
                data-testid="import-analyze"
                disabled={!text.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
              >
                Analyser
              </button>
            </div>

            {parseError && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" data-testid="import-parse-error">{parseError}</div>}

            {rows && rows.length > 0 && (
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-600 flex justify-between">
                  <span>{rows.length} ligne(s) détectée(s)</span>
                  <span>{okRows.length} valide(s) · {rows.length - okRows.length} erreur(s)</span>
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-gray-100">
                  {rows.map(r => (
                    <div key={r.line} data-testid="import-preview-row" className={`px-3 py-1.5 text-xs flex items-center gap-2 ${r.parseError ? 'bg-rose-50 text-rose-700' : 'text-gray-700'}`}>
                      <span className="w-8 shrink-0 text-gray-400">L{r.line}</span>
                      <span className="font-medium truncate">{r.name || '—'}</span>
                      {r.matricule_fiscal && <span className="text-gray-400">· {r.matricule_fiscal}</span>}
                      {r.comptable_label && <span className="text-gray-400">· 👤 {r.comptable_label}</span>}
                      {r.export_status && <span className="text-gray-400">· {r.export_status}</span>}
                      {r.parseError && <span className="ml-auto text-rose-600 font-medium">{r.parseError}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rows && (
              <button
                onClick={runImport}
                disabled={busy || okRows.length === 0}
                data-testid="import-confirm"
                className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                {busy ? 'Import en cours…' : `Importer ${okRows.length} client(s)${createDossier ? ' + dossiers' : ''}`}
              </button>
            )}

            {result && (
              <div className="border border-emerald-200 bg-emerald-50 rounded-xl px-3 py-2 space-y-1 text-sm" data-testid="import-result">
                <div className="font-semibold text-emerald-800">
                  ✓ {result.counts.created} client(s) créé(s){result.counts.dossiers ? ` · ${result.counts.dossiers} dossier(s) ${result.exercice}` : ''}{result.counts.skipped ? ` · ${result.counts.skipped} ignoré(s)` : ''}
                </div>
                {result.skipped.map((s: any, i: number) => <div key={i} className="text-xs text-gray-600">L{s.line} · {s.name} — {s.reason}</div>)}
                {result.errors.map((s: any, i: number) => <div key={i} className="text-xs text-rose-600">L{s.line} · {s.name || '?'} — {s.error}</div>)}
                {result.warnings.map((s: any, i: number) => <div key={i} className="text-xs text-amber-600">L{s.line} · {s.name} — {s.error}</div>)}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
