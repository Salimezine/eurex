import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Upload, Download, CheckCircle, FileSpreadsheet, Calculator, Users, ShieldCheck, AlertTriangle, Wand2, Save, Edit2, X, Plus, Trash2, Settings } from 'lucide-react';
import { api } from '../../lib/api';
import { parseFichePersonnel, Employee, PointageData } from '../../lib/baudParser';
import { calculateSalary, SalaryResult, buildSalaryKeys, generateSagePaieExport, SageExportResult, generateSageVariablesExport, SageVariablesExportResult, generateSageSalariesExport, SageSalariesExportResult } from '../../lib/baudCalculator';
import { verifySalaryCalculations, applyCorrections, applyAutoFixes, VerificationResult, CorrectionAction, AutoFixAction } from '../../lib/baudAI';
import * as XLSX from 'xlsx';

type Tab = 'navette' | 'employees' | 'controle' | 'calcul' | 'export';

export default function BaudDossierPage() {
  const { id } = useParams<{ id: string }>();
  const [dossier, setDossier] = useState<any>(null);
  const [lignes, setLignes] = useState<any[]>([]);
  const [exports, setExports] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('navette');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');
  const [generating, setGenerating] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);

  // Parsed data
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [pointage, setPointage] = useState<PointageData[]>([]);
  const [salaryResults, setSalaryResults] = useState<Map<string, SalaryResult>>(new Map());

  // Edit state
  const [editingEmployeeIdx, setEditingEmployeeIdx] = useState<number | null>(null);
  const [editingPointage, setEditingPointage] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<any>({});

  // TÂCHE 3 : Heures de nuit par employé, clé composite "${mois}-${matricule}"
  // Ne JAMAIS clécher par matricule seul → les H.Nuit de janvier fuiteraient sur février
  const [heuresNuit, setHeuresNuit] = useState<Record<string, number>>({});

  // Export control
  const [sageExportResult, setSageExportResult] = useState<SageExportResult | null>(null);
  const [sageVariablesResult, setSageVariablesResult] = useState<SageVariablesExportResult | null>(null);
  const [exportMode, setExportMode] = useState<'variables' | 'legacy'>('variables');
  const [showControlReport, setShowControlReport] = useState(false);

  // Ref to always have latest dossier in callbacks
  const dossierRef = useRef(dossier);
  dossierRef.current = dossier;

  const load = async () => {
    if (!id) return;
    try {
      const d = await api.baud.getDossier(id);
      setDossier(d);
      if (d.societe_id) {
        const l = await api.baud.getLignes(id);
        setLignes(l);
        const e = await api.baud.getExports(id);
        setExports(e);
      }
    } catch {}
  };

  useEffect(() => { load(); }, [id]);

  const uploadFile = async () => {
    if (!dossier || !file) return;
    setUploading(true); setMsg('');
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const parsed = parseFichePersonnel(wb, file.name);
      setEmployees(parsed.employees);
      setPointage(parsed.pointage);

      // Auto-detect mois/annee from filename
      if (parsed.mois && parsed.annee) {
        setDossier((d: any) => d ? { ...d, mois: parsed.mois, annee: parsed.annee } : d);
        if (parsed.mois !== dossier.mois || parsed.annee !== dossier.annee) {
          const BASE = import.meta.env.VITE_API_URL || 'https://eurex-api.ezzinesalim21.workers.dev/api';
          await fetch(`${BASE}/baud/dossiers/${dossier.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mois: parsed.mois, annee: parsed.annee }) }).catch(() => {});
        }
      }

      const extractionJson = { employees: parsed.employees, pointage: parsed.pointage, heures_nuit: {}, mois: parsed.mois, annee: parsed.annee, source_file: parsed.source_file };
      const lignesData = parsed.employees.map((emp, i) => ({ source_feuille: 'DP', source_ligne: i + 5, champs: [emp.matricule, emp.nom, emp.prenom, emp.cin, emp.date_naissance, emp.situation_fam, String(emp.nombre_enfants), emp.fonction, emp.type_contrat, emp.numero_cnss, emp.rib_ou_ccp, String(emp.salaire_brut), String(emp.nouveau_salaire_brut)] }));
      await api.baud.upload(dossier.id, file.name, lignesData);

      const BASE = import.meta.env.VITE_API_URL || 'https://eurex-api.ezzinesalim21.workers.dev/api';
      await fetch(`${BASE}/baud/dossiers/${dossier.id}/parsed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(extractionJson) }).catch(() => {});
      setMsg(`${parsed.employees.length} salaries extraits, ${parsed.pointage.length} pointages`);
      setTab('employees');
    } catch (e: any) { setMsg('Erreur: ' + e.message); }
    setUploading(false);
  };

  // TÂCHE 1 + 3 : calculateAll
  //
  // RÈGLE DE PRIORITÉ salaire_brut vs nouveau_salaire_brut :
  //   - Si salaire_manually_edited = true → utiliser nouveau_salaire_brut
  //     (l'utilisateur a explicitement édité le brut dans l'outil)
  //   - Sinon → utiliser salaire_brut du dernier import Excel
  //     (nouveau_salaire_brut peut venir de la colonne U de l'Excel et ne doit
  //     pas écraser salaire_brut par défaut — ex: un changement de poste prévu
  //     mais pas encore actif au mois en cours)
  //
  // TÂCHE 3 : heuresNuit cléché par "${mois}-${matricule}" pour isoler par mois.
  const calculateAll = () => {
    const mois = dossier?.mois || 1;
    const results = new Map<string, SalaryResult>();
    const keys = buildSalaryKeys(employees);
    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      const ptg = pointage.find(p => p.matricule === emp.matricule || (p.nom && emp.nom && p.nom === emp.nom));
      const absences = parseInt(ptg?.absences || '') || 0;
      const avances = ptg?.avances || 0;

      // Priorité : nouveau_salaire_brut uniquement si édition manuelle explicite
      const brut = emp.salaire_manually_edited && emp.nouveau_salaire_brut > 0
        ? emp.nouveau_salaire_brut
        : emp.salaire_brut;

      const hs = parseFloat(ptg?.heures_supplementaires || '') || 0;
      const nuitKey = `${mois}-${emp.matricule}`;
      const result = calculateSalary({
        salaire_brut: brut,
        situation_fam: emp.situation_fam,
        nombre_enfants: emp.nombre_enfants,
        sexe: emp.sexe,
        absences_jours: absences,
        heures_supplementaires: hs,
        avances,
        date_recrutement: emp.date_recrutement,
        mois,
        annee: dossier?.annee || 2026,
        heures_nuit: heuresNuit[nuitKey] || emp.heures_nuit || 0,
      });
      results.set(keys[i], result);
    }
    setSalaryResults(results);
    setTab('calcul');
    setMsg(`${results.size} salaires calculés`);
  };

  const generateSageExport = async () => {
    if (!dossier || salaryResults.size === 0) { setMsg('Calculez d\'abord les salaires'); return; }
    setGenerating(true); setMsg('');
    try {
      await saveBeforeExport();
      // Générer le rapport de contrôle et les lignes Sage
      const exportResult = generateSagePaieExport(
        employees,
        pointage,
        salaryResults,
        dossier.mois || 1,
        dossier.annee || 2026,
        false // prime_anciennete.enabled = false par défaut
      );
      setSageExportResult(exportResult);

      // Si des erreurs SMIG existent, bloquer l'export
      if (exportResult.smigViolations.length > 0) {
        setShowControlReport(true);
        setMsg(`ERREUR : ${exportResult.smigViolations.length} salaire(s) < SMIG — corriger avant export`);
        setGenerating(false);
        return;
      }

      // Générer le fichier Excel format Sage Paie 100 (format long)
      const moisStr = String(dossier.mois).padStart(2, '0');
      const annStr = String(dossier.annee).slice(-2);
      const periode = `${moisStr}/${dossier.annee}`;

      // En-tête : Matricule | Code Rubrique | Libellé | Valeur | Période
      const varRows: any[][] = [['Matricule', 'Code Rubrique', 'Libellé', 'Valeur', 'Période']];
      for (const row of exportResult.rows) {
        varRows.push([row.matricule, row.code_rubrique, row.libelle, row.valeur, row.periode]);
      }

      const varWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(varWb, XLSX.utils.aoa_to_sheet(varRows), 'Variables Paie');
      const varB64 = XLSX.write(varWb, { type: 'base64', bookType: 'xlsx' });

      const downloadB64 = (b64: string, filename: string) => {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      };

      downloadB64(varB64, `SagePaie100_${moisStr}-${annStr}.xlsx`);

      const msgLines = [
        `${exportResult.summary.totalRows} lignes exportées`,
        `${exportResult.summary.totalEmployees} salariés`,
        `Rubriques: ${exportResult.summary.rubriquesGenerated.join(', ')}`,
      ];
      if (exportResult.summary.warnings > 0) msgLines.push(`${exportResult.summary.warnings} avertissements`);
      setMsg(msgLines.join(' | '));
    } catch (e: any) { setMsg('Erreur: ' + e.message); }
    setGenerating(false);
  };

  const generateSageVariablesExportHandler = async () => {
    if (!dossier || employees.length === 0) { setMsg('Importez d\'abord le fichier personnel'); return; }

    const invalidEmps = employees.filter(e => !e.matricule || e.matricule.length < 3 || e.matricule_valid === false);

    setGenerating(true); setMsg('');
    try {
      await saveBeforeExport();
      const variablesResult = generateSageVariablesExport(
        employees,
        pointage,
        heuresNuit,
        dossier.mois || 1,
        dossier.annee || 2026
      );
      setSageVariablesResult(variablesResult);

      const moisStr = String(dossier.mois).padStart(2, '0');
      const annStr = String(dossier.annee).slice(-2);

      const varRows: any[][] = [['Matricule', 'Variable', 'Valeur', 'Période']];
      for (const row of variablesResult.rows) {
        varRows.push([row.matricule, row.variable, row.valeur, row.periode]);
      }

      const varWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(varWb, XLSX.utils.aoa_to_sheet(varRows), 'Variables');
      const varB64 = XLSX.write(varWb, { type: 'base64', bookType: 'xlsx' });

      const downloadB64 = (b64: string, filename: string) => {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      };

      downloadB64(varB64, `SageVariables_${moisStr}-${annStr}.xlsx`);

      const msgLines = [
        `${variablesResult.summary.totalRows} lignes exportées`,
        `${variablesResult.summary.totalEmployees} salariés`,
        `Variables: ${variablesResult.summary.variablesExported.join(', ')}`,
      ];
      setMsg(msgLines.join(' | '));
    } catch (e: any) { setMsg('Erreur: ' + e.message); }
    setGenerating(false);
  };

  const [sageSalariesResult, setSageSalariesResult] = useState<SageSalariesExportResult | null>(null);

  const generateSageSalariesExportHandler = async () => {
    if (!dossier || employees.length === 0) { setMsg('Importez d\'abord le fichier personnel'); return; }
    setGenerating(true); setMsg('');
    try {
      await saveBeforeExport();
      const res = generateSageSalariesExport(employees);
      setSageSalariesResult(res);
      const assigned = (res.assignedMatricules || []).length;
      const dups = (res.duplicateEmployees || []).length;
      const stacked = (res.stackedCnss || []).length;
      const cleared = (res.clearedCnss || []).length;
      const exported = res.lines.length;
      const parts: string[] = [];
      if (dups > 0) parts.push(`${dups} ligne(s) dupliquée(s) écartée(s)`);
      if (stacked > 0) parts.push(`${stacked} CNSS placeholder ignoré(s)`);
      if (cleared > 0) parts.push(`${cleared} doublon CNSS vidé(s)`);
      if (assigned > 0) parts.push(`${assigned} matricule(s) attribué(s)`);
      if (parts.length > 0) setMsg(`${exported} salarié(s) exporté(s) (${res.recordLength} car./ligne) — ${parts.join(', ')}.`);
      else setMsg(`${exported} salarié(s) exporté(s) en format fixe SAGE BTP (${res.recordLength} car./ligne)`);
    } catch (e: any) { setMsg('Erreur: ' + e.message); }
    setGenerating(false);
  };

  const downloadSageSalariesTxt = () => {
    if (!sageSalariesResult || sageSalariesResult.lines.length === 0) return;
    const cleared = (sageSalariesResult.clearedCnss || []).length;
    const dups = (sageSalariesResult.duplicateEmployees || []).length;
    if (cleared > 0) {
      setMsg(`Attention: ${cleared} NSS en double vidé(s) — saisir le bon numéro dans SAGE après import.`);
    }
    if (dups > 0) {
      setMsg(`Attention: ${dups} ligne(s) dupliquée(s) non exportée(s) — vérifier le fichier personnel.`);
    }
    const content = sageSalariesResult.lines.join('');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SageBTP_Salaries_${String(dossier?.mois || 1).padStart(2, '0')}-${dossier?.annee || 2026}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const download = async (eid: string, filename: string) => { try { const blob = await api.baud.downloadExport(eid); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); } catch (e: any) { setMsg(e.message); } };

  const handleVerifyAI = async () => {
    if (!dossier || employees.length === 0) return;
    setVerifying(true); setVerifyResult(null);
    try { const result = verifySalaryCalculations(employees, pointage, salaryResults); setVerifyResult(result); } catch (e: any) { setVerifyResult({ verdict: 'ERREUR', error: e.message, checks: [], missing: [], anomalies: [], corrections: [], autoFixes: [], summary: { totalEmployees: 0, verified: 0, warnings: 0, errors: 0, corrected: 0, autoFixed: 0 } }); }
    setVerifying(false);
  };

  const handleApplyCorrections = async () => {
    if (!verifyResult) return;
    try {
      let currentEmps = employees;
      let currentPtg = pointage;
      // Apply salary corrections
      if (verifyResult.corrections.length > 0) {
        const correctedResults = applyCorrections(currentEmps, currentPtg, salaryResults, verifyResult.corrections);
        setSalaryResults(correctedResults);
      }
      // Apply auto-fixes (pointage, matricules, SMIG)
      if (verifyResult.autoFixes && verifyResult.autoFixes.length > 0) {
        const fixed = applyAutoFixes(currentEmps, currentPtg, verifyResult.autoFixes);
        currentEmps = fixed.employees;
        currentPtg = fixed.pointage;
        setEmployees(currentEmps);
        setPointage(currentPtg);
      }
      const totalFixed = (verifyResult.corrections?.length || 0) + (verifyResult.autoFixes?.filter((f: AutoFixAction) => f.type !== 'fix_duplicate')?.length || 0);
      setMsg(`${totalFixed} corrections appliquées`);
      // Re-verify after corrections (avec les données fraîches, pas le closure stale)
      const newResult = verifySalaryCalculations(currentEmps, currentPtg, salaryResults);
      setVerifyResult(newResult);
      persistExtraction(currentEmps, currentPtg, heuresNuit);
    } catch (e: any) { setMsg('Erreur: ' + e.message); }
  };

  const handleApplySingleFix = (fix: AutoFixAction) => {
    const { employees: newEmps, pointage: newPtg } = applyAutoFixes(employees, pointage, [{ ...fix, applied: false }]);
    setEmployees(newEmps);
    setPointage(newPtg);
    setMsg(`Fix appliqué: ${fix.description}`);
    // Re-verify
    const newResult = verifySalaryCalculations(newEmps, newPtg, salaryResults);
    setVerifyResult(newResult);
    persistExtraction(newEmps, newPtg, heuresNuit);
  };

  // Save only when user explicitly edits
  const persistExtraction = (empSnap: Employee[], ptgSnap: PointageData[], nuitSnap: Record<string, number>) => {
    if (!id) return;
    const BASE = import.meta.env.VITE_API_URL || 'https://eurex-api.ezzinesalim21.workers.dev/api';
    const extractionJson = { employees: empSnap, pointage: ptgSnap, heures_nuit: nuitSnap, mois: dossier?.mois || 1, annee: dossier?.annee || 2026, source_file: dossier?.fichier_navette_nom || '' };
    console.log('[persist] saving', empSnap.length, 'employees to dossier', id);
    fetch(`${BASE}/baud/dossiers/${id}/parsed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(extractionJson) })
      .then(r => { console.log('[persist] response', r.status); return r.json(); })
      .then(d => console.log('[persist] ok', d))
      .catch(e => console.error('[persist] error', e));
  };

  // Save extraction only before export
  const saveBeforeExport = async () => {
    if (!dossier?.id) return;
    const BASE = import.meta.env.VITE_API_URL || 'https://eurex-api.ezzinesalim21.workers.dev/api';
    const extractionJson = { employees, pointage, heures_nuit: heuresNuit, mois: dossier.mois, annee: dossier.annee, source_file: dossier.fichier_navette_nom || '' };
    await fetch(`${BASE}/baud/dossiers/${dossier.id}/parsed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(extractionJson) }).catch(() => {});
  };

  const startEditEmployee = (idx: number) => {
    setEditingEmployeeIdx(idx);
    setEditValues({ ...employees[idx] });
  };

  // TÂCHE 1 : saveEditEmployee
  // nouveau_salaire_brut (col Excel U) est une vraie valeur d'import, PAS un artifact d'édition.
  // On NE l'écrase QUE si le champ édité est explicitement salaire_brut.
  // Les autres champs (SF, NE, fonction...) ne doivent PAS toucher nouveau_salaire_brut.
  const saveEditEmployee = () => {
    if (editingEmployeeIdx === null) return;
    const original = employees[editingEmployeeIdx];
    const updated = { ...editValues };

    // Si salaire_brut a été modifié (comparé à l'original), on sync nouveau_salaire_brut
    // et on marque salaire_manually_edited = true pour que calculateAll sache prioriser
    if (original && updated.salaire_brut !== original.salaire_brut) {
      updated.nouveau_salaire_brut = updated.salaire_brut;
      updated.salaire_manually_edited = true;
    }

    const newEmployees = employees.map((e, i) => i === editingEmployeeIdx ? { ...e, ...updated } : e);
    setEmployees(newEmployees);
    setEditingEmployeeIdx(null);
    setMsg('Employé mis à jour');
    persistExtraction(newEmployees, pointage, heuresNuit);
  };

  // Edit pointage
  const startEditPointage = (matricule: string) => {
    const ptg = pointage.find(p => p.matricule === matricule);
    setEditingPointage(matricule);
    setEditValues(ptg ? { ...ptg } : { matricule, nom: '', prenom: '', absences: '', avances: 0, conges_payes: '', heures_supplementaires: '' });
  };

  const saveEditPointage = () => {
    if (!editingPointage) return;
    const exists = pointage.find(p => p.matricule === editingPointage);
    let newPtg: PointageData[];
    if (exists) {
      newPtg = pointage.map(p => p.matricule === editingPointage ? { ...p, ...editValues } : p);
    } else {
      newPtg = [...pointage, editValues];
    }
    setPointage(newPtg);
    setEditingPointage(null);
    setMsg('Pointage mis à jour');
    persistExtraction(employees, newPtg, heuresNuit);
  };

  // Add new pointage entry
  const addPointageEntry = () => {
    const newPtg: PointageData = { matricule: '', nom: '', prenom: '', absences: '', avances: 0, conges_payes: '', heures_supplementaires: '' };
    setEditingPointage('new');
    setEditValues(newPtg);
  };

  // Delete pointage entry
  const deletePointageEntry = (matricule: string) => {
    const newPtg = pointage.filter(p => p.matricule !== matricule);
    setPointage(newPtg);
    setMsg('Pointage supprimé');
    persistExtraction(employees, newPtg, heuresNuit);
  };

  // Fix duplicate matricule
  const fixDuplicateMatricule = (oldMatricule: string, newMatricule: string) => {
    const newEmps = employees.map(e => e.matricule === oldMatricule ? { ...e, matricule: newMatricule } : e);
    setEmployees(newEmps);
    setMsg(`Matricule changé de ${oldMatricule} à ${newMatricule}`);
    persistExtraction(newEmps, pointage, heuresNuit);
  };

  if (!dossier) return <div className="mt-8 text-gray-400 text-sm">Chargement...</div>;

  const tabs = [
    { key: 'navette', label: 'Import', icon: Upload },
    { key: 'employees', label: `Salaries (${employees.length})`, icon: Users },
    { key: 'controle', label: `Controle IA`, icon: ShieldCheck },
    { key: 'calcul', label: `Calcul (${salaryResults.size})`, icon: Calculator },
    { key: 'export', label: `Export Sage (${exports.length})`, icon: FileSpreadsheet },
  ] as const;

  const totalBrut = Array.from(salaryResults.values()).reduce((s, r) => s + r.salaire_brut, 0);
  const totalNet = Array.from(salaryResults.values()).reduce((s, r) => s + r.net_a_payer, 0);
  const totalCNSS = Array.from(salaryResults.values()).reduce((s, r) => s + r.cnss_salariale, 0);
  const totalIRPP = Array.from(salaryResults.values()).reduce((s, r) => s + r.irpp, 0);

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-3">
        <Link to="/baud/societes" className="text-gray-400 hover:text-gray-600"><ArrowLeft className="w-5 h-5" /></Link>
        <h2 className="text-xl font-semibold">Dossier {employees.length > 0 ? `— ${employees.length} salaries` : ''}</h2>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${dossier.statut === 'valide' ? 'bg-green-100 text-green-700' : dossier.statut === 'controle' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{dossier.statut}</span>
        <Link to="/baud/parametres" className="ml-auto text-gray-400 hover:text-gray-600" title="Paramètres"><Settings size={18} /></Link>
      </div>

      <div className="flex gap-1 border-b">
        {tabs.map(t => { const Icon = t.icon; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><Icon size={16} />{t.label}</button>
        ); })}
      </div>

      {msg && <p className={`text-sm ${msg.includes('Erreur') || msg.includes('BLOQUÉ') ? 'text-red-600' : 'text-green-700'}`}>{msg}</p>}

      {/* TAB: IMPORT */}
      {tab === 'navette' && (
        <div className="bg-white border rounded-lg p-4 space-y-3">
          {dossier.fichier_navette_nom && <p className="text-sm text-green-600">Fichier: {dossier.fichier_navette_nom}</p>}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-500">Fichier "Liste du personnel" (.xls/.xlsx)</label>
              <input type="file" accept=".xlsx,.xls" onChange={e => setFile(e.target.files?.[0] || null)} className="w-full text-sm mt-1" />
            </div>
            <button onClick={uploadFile} disabled={!file || uploading} className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"><Upload size={14} />{uploading ? 'Analyse...' : 'Parser + Extraire'}</button>
          </div>
          <p className="text-xs text-gray-400">Extraction intelligente: detecte automatiquement les colonnes DP + Pointage</p>
        </div>
      )}

      {/* TAB: EMPLOYEES (EDITABLE) */}
      {tab === 'employees' && (
        <div className="space-y-4">
          {employees.length > 0 ? (
            <>
              <div className="flex gap-2">
                <button onClick={calculateAll} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 flex items-center gap-1"><Calculator size={14} />Calculer les salaires</button>
                <span className="text-xs text-gray-400 self-center">{employees.length} salaries</span>
              </div>
              <div className="bg-white border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                    <th className="p-2">Mat</th><th className="p-2">Nom</th><th className="p-2">Prenom</th>
                    <th className="p-2">CIN</th><th className="p-2">CNSS</th><th className="p-2">SF</th><th className="p-2">NE</th>
                    <th className="p-2">Embauche</th><th className="p-2">Fonction</th><th className="p-2">Contrat</th>
                    <th className="p-2 text-right">Brut</th><th className="p-2 text-right">H.Nuit</th><th className="p-2">Actions</th>
                  </tr></thead>
                  <tbody className="divide-y">
                    {employees.map((emp, idx) => (
                      <tr key={emp.matricule || `emp-${idx}`} className="hover:bg-gray-50">
                        {editingEmployeeIdx === idx ? (
                          <>
                            <td className="p-1"><input value={editValues.matricule} onChange={e => setEditValues({...editValues, matricule: e.target.value})} className="w-20 text-xs border rounded px-1" /></td>
                            <td className="p-1"><input value={editValues.nom} onChange={e => setEditValues({...editValues, nom: e.target.value})} className="w-24 text-xs border rounded px-1" /></td>
                            <td className="p-1"><input value={editValues.prenom} onChange={e => setEditValues({...editValues, prenom: e.target.value})} className="w-24 text-xs border rounded px-1" /></td>
                            <td className="p-1"><input value={editValues.cin} onChange={e => setEditValues({...editValues, cin: e.target.value})} className="w-20 text-xs border rounded px-1" /></td>
                            <td className="p-1"><input value={editValues.numero_cnss} onChange={e => setEditValues({...editValues, numero_cnss: e.target.value})} className="w-20 text-xs border rounded px-1" /></td>
                            <td className="p-1"><select value={editValues.situation_fam} onChange={e => setEditValues({...editValues, situation_fam: e.target.value})} className="text-xs border rounded px-1"><option value="C">C</option><option value="M">M</option><option value="D">D</option><option value="V">V</option></select></td>
                            <td className="p-1"><input type="number" value={editValues.nombre_enfants} onChange={e => setEditValues({...editValues, nombre_enfants: parseInt(e.target.value) || 0})} className="w-12 text-xs border rounded px-1" /></td>
                            <td className="p-1"><input value={editValues.fonction} onChange={e => setEditValues({...editValues, fonction: e.target.value})} className="w-24 text-xs border rounded px-1" /></td>
                            <td className="p-1"><input value={editValues.type_contrat} onChange={e => setEditValues({...editValues, type_contrat: e.target.value})} className="w-16 text-xs border rounded px-1" /></td>
                            <td className="p-1"><input value={editValues.date_recrutement || ''} onChange={e => setEditValues({...editValues, date_recrutement: e.target.value})} className="w-20 text-xs border rounded px-1" placeholder="YYYY-MM-DD" /></td>
                            <td className="p-1"><input type="number" step="0.001" value={editValues.salaire_brut} onChange={e => setEditValues({...editValues, salaire_brut: parseFloat(e.target.value) || 0})} className="w-24 text-xs border rounded px-1 text-right" /></td>
                            <td className="p-1 flex gap-1">
                              <button onClick={saveEditEmployee} className="p-1 text-green-600 hover:text-green-800"><Save size={14} /></button>
                              <button onClick={() => setEditingEmployeeIdx(null)} className="p-1 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="p-2 font-mono text-xs">{emp.matricule}</td>
                            <td className="p-2 text-xs">{emp.nom}</td>
                            <td className="p-2 text-xs">{emp.prenom}</td>
                            <td className="p-2 text-xs">{emp.cin}</td>
                            <td className="p-2 text-xs">{emp.numero_cnss || <span className="text-red-400">manquant</span>}</td>
                            <td className="p-2 text-xs">{emp.situation_fam}</td>
                            <td className="p-2 text-xs text-center">{emp.nombre_enfants}</td>
                            <td className="p-2 text-xs">{emp.fonction}</td>
                            <td className="p-2 text-xs">{emp.type_contrat}</td>
                            <td className="p-2 text-xs text-gray-500">{emp.date_recrutement || '-'}</td>
                            <td className="p-2 text-right font-mono text-xs">{emp.salaire_brut.toFixed(3)}</td>
                            <td className="p-1">
                              <input type="number" step="1" min="0"
                                value={heuresNuit[`${dossier.mois}-${emp.matricule}`] || emp.heures_nuit || ''}
                                onChange={e => {
                                  const val = parseFloat(e.target.value) || 0;
                                  const nuitKey = `${dossier.mois}-${emp.matricule}`;
                                  setHeuresNuit(prev => ({ ...prev, [nuitKey]: val }));
                                }}
                                placeholder="0"
                                className="w-16 text-xs border rounded px-1 text-right"
                                title="Heures de nuit (taux_horaire × 1.25)" />
                            </td>
                            <td className="p-1">
                              <button onClick={() => startEditEmployee(idx)} className="p-1 text-blue-600 hover:text-blue-800"><Edit2 size={14} /></button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">Aucun salary. Uploadez d'abord un fichier "Liste du personnel".</p>
          )}
        </div>
      )}

      {/* TAB: CONTROLE IA */}
      {tab === 'controle' && (
        <div className="space-y-4">
          <div className="bg-white border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3">
              <ShieldCheck size={20} className="text-blue-600" />
              <div>
                <h3 className="font-medium text-sm">Verification IA</h3>
                <p className="text-xs text-gray-400">Verifie, detecte et corrige automatiquement les anomalies</p>
              </div>
              <button onClick={handleVerifyAI} disabled={verifying || employees.length === 0} className="ml-auto px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                <ShieldCheck size={14} />{verifying ? 'Verification...' : 'Verifier avec IA'}
              </button>
            </div>
          </div>

          {verifyResult && !verifyResult.error && (
            <div className={`rounded-lg border p-4 ${verifyResult.verdict === 'OK' ? 'bg-green-50 border-green-200' : verifyResult.verdict === 'ATTENTION' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                {verifyResult.verdict === 'OK' ? <CheckCircle size={18} className="text-green-600" /> : <AlertTriangle size={18} className={verifyResult.verdict === 'ATTENTION' ? 'text-amber-600' : 'text-red-600'} />}
                <span className={`font-semibold ${verifyResult.verdict === 'OK' ? 'text-green-700' : verifyResult.verdict === 'ATTENTION' ? 'text-amber-700' : 'text-red-700'}`}>{verifyResult.verdict}</span>
                {verifyResult.summary && <span className="text-xs text-gray-500 ml-2">({verifyResult.summary.verified}/{verifyResult.summary.totalEmployees} verifiés, {verifyResult.summary.warnings} avertissements, {verifyResult.summary.errors} erreurs)</span>}
              </div>

              {verifyResult.checks?.length > 0 && (
                <div className="space-y-1 mb-3 max-h-64 overflow-y-auto">
                  {verifyResult.checks.map((c: any, i: number) => (
                    <div key={i} className={`flex items-start gap-2 text-xs ${c.status === 'error' ? 'text-red-600' : c.status === 'warning' ? 'text-amber-600' : 'text-green-600'}`}>
                      <span>{c.status === 'ok' ? '✓' : c.status === 'warning' ? '⚠' : '✗'}</span>
                      <span><strong>{c.name}:</strong> {c.detail}</span>
                    </div>
                  ))}
                </div>
              )}

              {verifyResult.anomalies?.length > 0 && (
                <div className="text-xs text-amber-600 mb-2">
                  <strong>Anomalies:</strong>
                  <ul className="list-disc list-inside">{verifyResult.anomalies.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>
                </div>
              )}

              {verifyResult.autoFixes && verifyResult.autoFixes.length > 0 && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-green-700"><Wand2 size={12} className="inline mr-1" />{verifyResult.autoFixes.length} corrections automatiques</span>
                    <button onClick={handleApplyCorrections} className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 flex items-center gap-1"><Wand2 size={12} />Tout appliquer</button>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {verifyResult.autoFixes.map((fix: AutoFixAction, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-white p-2 rounded border">
                        <div className="flex-1">
                          <span className={`inline-block w-2 h-2 rounded-full mr-2 ${fix.type === 'add_pointage' ? 'bg-blue-500' : fix.type === 'fix_duplicate' ? 'bg-red-500' : fix.type === 'fix_smig' ? 'bg-amber-500' : 'bg-gray-500'}`}></span>
                          <strong>{fix.type === 'add_pointage' ? 'Pointage' : fix.type === 'fix_duplicate' ? 'Matricule' : fix.type === 'fix_smig' ? 'SMIG' : 'CNSS'}:</strong> {fix.description}
                        </div>
                        <button onClick={() => handleApplySingleFix(fix)} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200">Appliquer</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {verifyResult.corrections?.length > 0 && (
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-blue-700"><Wand2 size={12} className="inline mr-1" />{verifyResult.corrections.length} corrections de calcul</span>
                    <button onClick={handleApplyCorrections} className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 flex items-center gap-1"><Wand2 size={12} />Appliquer</button>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {verifyResult.corrections.map((c: CorrectionAction, i: number) => (
                      <div key={i} className="text-xs text-blue-600"><strong>{c.nom}</strong>: {c.field} {c.oldValue} → {c.newValue} ({c.reason})</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {verifyResult?.error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{verifyResult.error}</div>}
          {employees.length > 0 && salaryResults.size === 0 && <p className="text-sm text-amber-600">Calculez d'abord les salaries avant de verifier.</p>}
        </div>
      )}

      {/* TAB: CALCUL */}
      {tab === 'calcul' && (
        <div className="space-y-4">
          {salaryResults.size > 0 ? (
            <>
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center"><div className="text-xs text-blue-600">Total Brut</div><div className="text-lg font-bold text-blue-800">{totalBrut.toFixed(3)}</div></div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center"><div className="text-xs text-red-600">CNSS + IRPP</div><div className="text-lg font-bold text-red-800">{(totalCNSS + totalIRPP).toFixed(3)}</div></div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center"><div className="text-xs text-green-600">Total Net</div><div className="text-lg font-bold text-green-800">{totalNet.toFixed(3)}</div></div>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-center"><div className="text-xs text-purple-600">Salaries</div><div className="text-lg font-bold text-purple-800">{salaryResults.size}</div></div>
              </div>
              <div className="bg-white border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                    <th className="p-2">Mat</th><th className="p-2">Nom</th><th className="p-2 text-right">Base</th>
                    <th className="p-2 text-right">Anc</th><th className="p-2 text-right">Transport</th><th className="p-2 text-right">Presence</th>
                    <th className="p-2 text-right">Brut</th><th className="p-2 text-right">CNSS</th><th className="p-2 text-right">IRPP</th><th className="p-2 text-right">CSS</th><th className="p-2 text-right">Net</th><th className="p-2 text-right">Net a payer</th>
                  </tr></thead>
                  <tbody className="divide-y">
                    {buildSalaryKeys(employees).map((key, idx) => { const r = salaryResults.get(key); const emp = employees[idx]; if (!r) return null; return (
                      <tr key={key} className="hover:bg-gray-50">
                        <td className="p-2 font-mono text-xs">{emp.matricule}</td><td className="p-2 text-xs">{emp.nom} {emp.prenom}</td>
                        <td className="p-2 text-right font-mono text-xs">{r.salaire_de_base.toFixed(3)}</td>
                        <td className="p-2 text-right font-mono text-xs text-purple-600">{r.prime_anciennete > 0 ? `${r.prime_anciennete.toFixed(3)} (${r.taux_anciennete}%)` : '-'}</td>
                        <td className="p-2 text-right font-mono text-xs text-blue-600">{r.ind_transport > 0 ? r.ind_transport.toFixed(3) : '-'}</td>
                        <td className="p-2 text-right font-mono text-xs text-blue-600">{r.prime_presence > 0 ? r.prime_presence.toFixed(3) : '-'}</td>
                        <td className="p-2 text-right font-mono text-xs">{r.salaire_brut.toFixed(3)}</td><td className="p-2 text-right font-mono text-xs text-red-600">{r.cnss_salariale.toFixed(3)}</td>
                        <td className="p-2 text-right font-mono text-xs text-red-600">{r.irpp.toFixed(3)}</td><td className="p-2 text-right font-mono text-xs text-red-600">{r.css_salariale.toFixed(3)}</td>
                        <td className="p-2 text-right font-mono text-xs">{r.salaire_net.toFixed(3)}</td><td className="p-2 text-right font-mono text-xs font-bold text-green-700">{r.net_a_payer.toFixed(3)}</td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            </>
          ) : <p className="text-sm text-gray-400">Aucun calcul. Allez dans "Salaries" et cliquez "Calculer les salaires".</p>}
        </div>
      )}

      {/* TAB: EXPORT */}
      {tab === 'export' && (
        <div className="space-y-4">
          {/* Toggle mode export */}
          <div className="bg-white border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3">
              <FileSpreadsheet size={20} className="text-purple-600" />
              <h3 className="font-medium text-sm">Export Sage Paie 100</h3>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setExportMode('variables')}
                className={`px-4 py-2 rounded text-sm font-medium transition ${exportMode === 'variables' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                Variables (Sage calcule)
              </button>
              <button
                onClick={() => setExportMode('legacy')}
                className={`px-4 py-2 rounded text-sm font-medium transition ${exportMode === 'legacy' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                Legacy (calcul interne)
              </button>
            </div>
          </div>

          {/* Mode: Variables — Sage fait le calcul */}
          {exportMode === 'variables' && (
            <div className="bg-white border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-xs text-gray-500">Prépare les variables d'entrée — Sage applique ses propres paramètres et barèmes</p>
                </div>
                <button onClick={generateSageVariablesExportHandler} disabled={generating || employees.length === 0} className="px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1">
                  {generating ? 'Generation...' : 'Generer + Exporter'}
                </button>
              </div>
              {employees.filter(e => !e.matricule || e.matricule.length < 3 || e.matricule_valid === false).length > 0 && (
                <div className="bg-amber-50 border border-amber-300 rounded p-3 text-xs">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle size={14} className="text-amber-600" />
                    <span className="font-semibold text-amber-700">
                      {employees.filter(e => !e.matricule || e.matricule.length < 3 || e.matricule_valid === false).length} salarié(s) sans matricule Sage — exportés avec matricule vide
                    </span>
                  </div>
                  <ul className="max-h-32 overflow-y-auto space-y-1 text-amber-600">
                    {employees.filter(e => !e.matricule || e.matricule.length < 3 || e.matricule_valid === false).map((e, i) => (
                      <li key={i}>• {e.nom} {e.prenom}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="text-xs text-gray-400 space-y-1">
                <p><strong>Variables mensuelles :</strong> Absences, Heures sup, Heures nuit, Avances</p>
                <p><strong>Sage gère (fiche employé) :</strong> Salaire de base, Situation familiale, Enfants, Catégorie, Fonction, Date embauche, CNSS, IRPP, CSS, Transport, Présence, Primes, MIT</p>
                <p className="text-amber-500">⚠ Un import Sage ne peut pas être annulé. Vérifiez le rapport de contrôle ci-dessous.</p>
              </div>
              {/* Garde-fou : détection désynchronisation Excel RH ↔ Sage */}
              {employees.some(e => e.categorie || e.fonction) && (
                <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-700">
                  ℹ L'Excel RH contient des données CATEGORIE/FONCTION pour {employees.filter(e => e.categorie || e.fonction).length} salarié(s).
                  Ces données ne sont pas exportées (elles vivent dans Sage), mais vérifiez qu'elles correspondent à la fiche employé Sage pour éviter des désynchronisations.
                </div>
              )}
            </div>
          )}

          {/* Export Salariés SAGE BTP — format fixe import */}
          <div className="bg-white border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3">
              <FileSpreadsheet size={20} className="text-green-600" />
              <h3 className="font-medium text-sm">Export Salariés SAGE BTP (format fixe)</h3>
            </div>
            <p className="text-xs text-gray-500">Génère le fichier d'import des fiches salariés au format SAGE BTP (657 car./ligne, 31 champs).</p>
            <div className="flex gap-2">
              <button onClick={generateSageSalariesExportHandler} disabled={generating || employees.length === 0} className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1">
                {generating ? 'Generation...' : 'Generer export salaries'}
              </button>
              {sageSalariesResult && sageSalariesResult.lines.length > 0 && (
                <button onClick={downloadSageSalariesTxt} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 flex items-center gap-1">
                  Telecharger .txt
                </button>
              )}
            </div>
            {sageSalariesResult && (
              <div className="bg-gray-50 rounded p-3 text-xs space-y-2">
                <div className="font-semibold text-green-700">
                  {sageSalariesResult.totalEmployees} salarié(s) | {sageSalariesResult.recordLength} caractères/ligne
                </div>
                {sageSalariesResult.invalidMatricules && sageSalariesResult.invalidMatricules.length > 0 && (
                  <div className="bg-amber-50 border border-amber-300 rounded p-2 text-amber-700">
                    <div className="font-semibold mb-1">
                      <AlertTriangle size={12} className="inline" /> {sageSalariesResult.invalidMatricules.length} matricule(s) invalide(s) :
                    </div>
                    <ul className="max-h-24 overflow-y-auto space-y-0.5">
                      {sageSalariesResult.invalidMatricules.map((m, i) => (
                        <li key={i}>• {m.nom} {m.prenom} (matricule: « {m.matricule || '(vide)'} »)</li>
                      ))}
                    </ul>
                  </div>
                )}
                {sageSalariesResult.duplicateEmployees && sageSalariesResult.duplicateEmployees.length > 0 && (
                  <div className="bg-red-50 border border-red-300 rounded p-2 text-red-700">
                    <div className="font-semibold mb-1">
                      <AlertTriangle size={12} className="inline" /> {sageSalariesResult.duplicateEmployees.length} ligne(s) salarié dupliquée(s) (même CIN) — non exportée(s) :
                    </div>
                    <ul className="max-h-24 overflow-y-auto space-y-0.5">
                      {sageSalariesResult.duplicateEmployees.map((d, i) => (
                        <li key={i}>• {d.nom} {d.prenom} (CIN {d.cin}, matricule {d.matricule}) — doublon de la ligne clé {d.matricule}</li>
                      ))}
                    </ul>
                    <div className="mt-1">Vérifier dans le fichier personnel (même personne saisie 2× ?).</div>
                  </div>
                )}
                {sageSalariesResult.stackedCnss && sageSalariesResult.stackedCnss.length > 0 && (
                  <div className="bg-amber-50 border border-amber-300 rounded p-2 text-amber-700">
                    <div className="font-semibold mb-1">
                      <AlertTriangle size={12} className="inline" /> {sageSalariesResult.stackedCnss.length} CNSS placeholder(s) ignoré(s) (non numériques — FIAP, SIAP, EN COURS…) :
                    </div>
                    <ul className="max-h-24 overflow-y-auto space-y-0.5">
                      {sageSalariesResult.stackedCnss.map((c, i) => (
                        <li key={i}>• « {c.cnss} » : {c.nom} {c.prenom} (matricule {c.matricule})</li>
                      ))}
                    </ul>
                    <div className="mt-1">Saisir le vrai NSS dans SAGE après import.</div>
                  </div>
                )}
                {sageSalariesResult.clearedCnss && sageSalariesResult.clearedCnss.length > 0 && (
                  <div className="bg-amber-50 border border-amber-300 rounded p-2 text-amber-700">
                    <div className="font-semibold mb-1">
                      <AlertTriangle size={12} className="inline" /> {sageSalariesResult.clearedCnss.length} NSS/CNSS en double — vidé(s) automatiquement (le 1er est conservé) :
                    </div>
                    <ul className="max-h-24 overflow-y-auto space-y-0.5">
                      {sageSalariesResult.clearedCnss.map((c, i) => (
                        <li key={i}>• CNSS « {c.cnss} » retiré : {c.nom} {c.prenom} (matricule {c.matricule})</li>
                      ))}
                    </ul>
                    <div className="mt-1">Saisir le NSS correct de ces salariés dans SAGE après import.</div>
                  </div>
                )}
                {sageSalariesResult.assignedMatricules && sageSalariesResult.assignedMatricules.length > 0 && (
                  <div className="bg-amber-50 border border-amber-300 rounded p-2 text-amber-700">
                    <div className="font-semibold mb-1">
                      <AlertTriangle size={12} className="inline" /> {sageSalariesResult.assignedMatricules.length} matricule(s) vide(s) attribué(s) automatiquement :
                    </div>
                    <ul className="max-h-24 overflow-y-auto space-y-0.5">
                      {sageSalariesResult.assignedMatricules.map((m, i) => (
                        <li key={i}>• {m.nom} {m.prenom} → matricule « {m.matricule} »</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="text-gray-400">
                  Champs remplis : Matricule, Nom, Prénom, Sexe, Naissance, Situation familiale, Adresse, CNSS, Banque/RIB, Dates embauche/sortie.<br/>
                  Les champs vides seront remplis dans Sage lors de l'import.
                </div>
              </div>
            )}
          </div>

          {/* Mode: Legacy — calcul interne */}
          {exportMode === 'legacy' && (
            <div className="bg-white border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-xs text-gray-500">Exporte les rubriques calculées par notre système — contrôle croisé avec Sage</p>
                </div>
                <button onClick={generateSageExport} disabled={generating || salaryResults.size === 0} className="px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1">
                  {generating ? 'Generation...' : 'Generer + Exporter'}
                </button>
              </div>
              <div className="text-xs text-gray-400 space-y-1">
                <p><strong>Rubriques :</strong> 1000 (Base), 2100 (Transport), 2200 (Présence), 4113 (HS), 3100 (CNSS), 3310 (IRPP), 3320 (CSS), 5100 (Alloc)</p>
                <p><strong>Prime ancienneté :</strong> désactivée par défaut (flag à activer dans config.json si besoin)</p>
                <p className="text-amber-500">⚠ Un import Sage ne peut pas être annulé. Vérifiez le rapport de contrôle ci-dessous.</p>
              </div>
            </div>
          )}

          {/* Rapport de contrôle — Variables */}
          {exportMode === 'variables' && sageVariablesResult && (
            <div className="rounded-lg border p-4 bg-green-50 border-green-200">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle size={18} className="text-green-600" />
                <span className="font-semibold text-sm text-green-700">
                  Rapport de contrôle
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                <div className="text-center"><div className="font-bold text-lg">{sageVariablesResult.summary.totalRows}</div><div className="text-gray-500">Lignes</div></div>
                <div className="text-center"><div className="font-bold text-lg">{sageVariablesResult.summary.totalEmployees}</div><div className="text-gray-500">Salariés</div></div>
              </div>
              <p className="text-xs text-gray-500">Variables exportées : {sageVariablesResult.summary.variablesExported.join(', ')}</p>
            </div>
          )}

          {/* Rapport de contrôle — Legacy */}
          {exportMode === 'legacy' && sageExportResult && (
            <div className={`rounded-lg border p-4 ${sageExportResult.smigViolations.length > 0 ? 'bg-red-50 border-red-200' : sageExportResult.summary.warnings > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
              <div className="flex items-center gap-2 mb-3">
                {sageExportResult.smigViolations.length > 0 ? <AlertTriangle size={18} className="text-red-600" /> : <CheckCircle size={18} className="text-green-600" />}
                <span className={`font-semibold text-sm ${sageExportResult.smigViolations.length > 0 ? 'text-red-700' : 'text-green-700'}`}>
                  Rapport de contrôle
                </span>
                <button onClick={() => setShowControlReport(!showControlReport)} className="ml-auto text-xs text-blue-600 hover:underline">
                  {showControlReport ? 'Masquer' : 'Détails'}
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2 mb-3 text-xs">
                <div className="text-center"><div className="font-bold text-lg">{sageExportResult.summary.totalRows}</div><div className="text-gray-500">Lignes</div></div>
                <div className="text-center"><div className="font-bold text-lg">{sageExportResult.summary.totalEmployees}</div><div className="text-gray-500">Salariés</div></div>
                <div className="text-center"><div className="font-bold text-lg text-green-600">{sageExportResult.summary.rubriquesGenerated.length}</div><div className="text-gray-500">Rubriques</div></div>
                <div className="text-center"><div className={`font-bold text-lg ${sageExportResult.smigViolations.length > 0 ? 'text-red-600' : 'text-green-600'}`}>{sageExportResult.smigViolations.length}</div><div className="text-gray-500">SMIG viol.</div></div>
              </div>
              {sageExportResult.smigViolations.length > 0 && (
                <div className="bg-red-100 border border-red-300 rounded p-3 mb-3">
                  <p className="text-xs font-bold text-red-700 mb-2">⚠ BLOQUANT : Salaires inférieurs au SMIG (Décret n°67/2026)</p>
                  {sageExportResult.smigViolations.map((v, i) => (
                    <p key={i} className="text-xs text-red-600">• {v.nom} ({v.matricule}) : Brut {v.brut.toFixed(3)} DT &lt; SMIG {v.smig} DT</p>
                  ))}
                </div>
              )}
              {showControlReport && sageExportResult.controlReport.length > 0 && (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {sageExportResult.controlReport.map((item, i) => (
                    <div key={i} className={`flex items-start gap-2 text-xs ${item.type === 'error' ? 'text-red-600' : item.type === 'warning' ? 'text-amber-600' : 'text-green-600'}`}>
                      <span>{item.type === 'error' ? '✗' : item.type === 'warning' ? '⚠' : '✓'}</span>
                      <span><strong>{item.nom} {item.prenom}:</strong> {item.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {exports.length > 0 && (
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-medium text-sm mb-3">Fichiers générés</h3>
              <div className="space-y-2">
                {exports.map((exp: any) => (
                  <div key={exp.id} className="flex items-center justify-between border-b pb-2 last:border-b-0">
                    <div><span className="text-sm font-medium">{exp.fichier_nom}</span><span className="text-xs text-gray-400 ml-2">{exp.nb_lignes} lignes</span></div>
                    <button onClick={() => download(exp.id, exp.fichier_nom)} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"><Download size={14} />Telecharger</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}