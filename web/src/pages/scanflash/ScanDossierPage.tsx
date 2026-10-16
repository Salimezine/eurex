import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Table2, Trash2, Download, Zap, Upload, CheckCircle, ShieldCheck, Wrench, Database } from 'lucide-react';
import { api } from '../../lib/api';
import { extractTextFromPDF } from '../../lib/pdf';

type Tab = 'factures' | 'ecritures' | 'export';

export default function ScanDossierPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [dossier, setDossier] = useState<any>(null);
  const [factures, setFactures] = useState<any[]>([]);
  const [ecritures, setEcritures] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('factures');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);

  // Client-side memory (no DB)
  const [localFactures, setLocalFactures] = useState<any[]>([]);
  const [localEcritures, setLocalEcritures] = useState<any[]>([]);

  // Manual add form
  const [form, setForm] = useState({ numero: '', date_facture: '', client: '', compte_client: '', total_ht_0: '0', total_ht_19: '0', tva_19: '0', fodec: '0', timbre: '0', total_ttc: '0' });

  const load = async (withEcritures = false) => {
    if (!id) return;
    setLoading(true);
    const d = await api.scan.getDossier(id);
    setDossier(d);
    const f = await api.scan.getFactures(id);
    setFactures(f);
    if (withEcritures) {
      const e = await api.scan.getEcritures(id);
      setEcritures(e);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const handleUploadPDF = async (files: FileList) => {
    if (!files.length) return;
    setUploading(true);
    const newFactures: any[] = [];
    try {
      for (const file of Array.from(files)) {
        const text = await extractTextFromPDF(file);
        const parsed = parseScanInvoice(text);
        if (parsed) {
          newFactures.push({ ...parsed, id: crypto.randomUUID() });
        }
      }
      setLocalFactures(prev => [...prev, ...newFactures]);
    } catch (e: any) {
      alert('Erreur extraction: ' + e.message);
    }
    setUploading(false);
  };

  // Client code → 411XXX account mapping (stored in localStorage)
  const [clientMap, setClientMap] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('scan_client_map') || '{}'); } catch { return {}; }
  });
  const [newClientCode, setNewClientCode] = useState('');
  const [newClientAccount, setNewClientAccount] = useState('');
  const [newClientName, setNewClientName] = useState('');

  const saveClientMap = (map: Record<string, string>) => {
    setClientMap(map);
    localStorage.setItem('scan_client_map', JSON.stringify(map));
  };

  const parseAmount = (s: string): number => {
    // "1 560,391" → 1560.391, "-299,438" → -299.438
    return parseFloat(s.replace(/\s/g, '').replace(',', '.')) || 0;
  };

  // Parse un montant depuis une ligne : "279,000" | "Total HT 279,000" | "Total HT -1 250,000" (espace=milliers)
  const parseLineAmount = (line: string): number => {
    // Extrait le dernier nombre de la ligne (avec signe, séparateur espace/virgule/point)
    // Gère "1 250,000" (espace = milliers) et "-1 250,000" (avoir)
    const m = line.match(/(-?\d[\d\s]*(?:[.,]\d{1,3})?)\s*(?:DT|TTC|HT)?\s*$/i);
    if (m) {
      // Enlever espaces (milliers) puis virgule→point
      const cleaned = m[1].replace(/\s/g, '').replace(',', '.');
      return parseFloat(cleaned) || 0;
    }
    return 0;
  };

  const parseScanInvoice = (text: string): any | null => {
    const lines = text.split('\n');
    let numero = '';
    let isAvoir = false;
    let date = '';
    let codeClient = '';
    let clientName = '';
    let totalHT = 0;
    let tva19 = 0;
    let fodec = 0;
    let timbre = 0;
    let totalTTC = 0;
    let afterAdressA = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Numéro : "Facture FAC2606-00001989", "FACTURE N° FAC...", "Facture avoir AVR...", "FAC2606-00001989" seul
      // Tolère espaces, n°, majuscules, préfixes variables
      if (!numero) {
        const facMatch = line.match(/(?:facture\s*(?:avoir)?\s*(?:n[°ºo]\s*)?:?\s*)((?:avoir\s+)?(?:FAC|AVR|FA|AV)\S{4,})/i);
        if (facMatch) {
          isAvoir = /avoir/i.test(facMatch[1]) || /avoir/i.test(line);
          numero = facMatch[1].replace(/\s+/g, '').trim();
        }
        // Fallback : numéro seul commençant par FAC/AVR sans mot "Facture"
        if (!numero) {
          const soloMatch = line.match(/^((?:AVR|FAC)\d[\w-]{4,})/i);
          if (soloMatch) {
            isAvoir = /^AVR/i.test(soloMatch[1]);
            numero = soloMatch[1].trim();
          }
        }
      }

      // Date : "Date facturation : 05/06/2026", "Date : 05/06/2026", "05/06/2026" près de "Date"
      if (!date) {
        const dateMatch = line.match(/(?:date\s*(?:facturation|facture|de\s*facturation)?)\s*:?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i);
        if (dateMatch) {
          const [, d, m, y] = dateMatch;
          date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
      }

      // Code client : "Code client : CLT0626-1187", "Code : CLT...", "Client : CLT..."
      if (!codeClient) {
        const codeMatch = line.match(/(?:code\s*client|code|client\s*code)\s*:?\s*(CLT[\w-]+)/i);
        if (codeMatch) codeClient = codeMatch[1];
      }

      // Client name: format "Émetteur Adressé à" puis ligne "EMETTEUR CLIENT"
      // Le client = partie APRÈS l'émetteur (ex: "SCANFLASH CAMCE" → "CAMCE")
      if (line.match(/(?:Adress[ée]\s+[àa]|attention\s+de)/i)) {
        afterAdressA = true;
        continue;
      }
      if (afterAdressA && line) {
        // Ligne "SCANFLASH CAMCE" → client = "CAMCE" (après le 1er mot qui est l'émetteur)
        // Ligne "SCANFLASH MAGHREB CORPORATE" → client = "MAGHREB CORPORATE"
        // Sauf si c'est une ligne d'adresse/tél/email (on continue)
        if (!line.match(/^(Num[ée]ro|N[°º]|T[ée]l|Email|Web|Adresse|BP|Code|Montants|D[ée]signation|Facture|Rectificatif)/i)) {
          // Séparer émetteur (gauche) et client (droite) : le 1er mot est souvent l'émetteur
          const parts = line.split(/\s{2,}/); // 2+ espaces = colonnes séparées par pdf.js
          if (parts.length >= 2) {
            clientName = parts[1].trim(); // colonne droite = client
          } else {
            // Même ligne fusionnée : enlever le nom de l'émetteur connu
            const cleaned = line.replace(/^SCANFLASH\s*/i, '').trim();
            if (cleaned && cleaned !== line) {
              clientName = cleaned;
            } else {
              clientName = line;
            }
          }
          afterAdressA = false;
        }
      }

      // Montants : accepte "Total HT" SEUL (valeur ligne suivante) OU "Total HT 279,000" (même ligne)
      // IMPORTANT : "Total HT" doit être au DÉBUT de la ligne (pas f header "Désignation... Total HT")
      const htLine = line.match(/^total\s*ht\b\s*:?\s*(-?[\d\s]*[.,]\d{1,3}|-?\d{2,})?\s*(DT|TTC)?\s*$/i);
      if (htLine && totalHT === 0) {
        if (htLine[1]) {
          totalHT = parseAmount(htLine[1]);
        } else {
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const v = parseAmount(lines[j].trim());
            if (v !== 0) { totalHT = v; break; }
          }
        }
      }

      const tvaLine = line.match(/^total\s*tva\s*19\s*%?\s*:?\s*(-?[\d\s]*[.,]\d{1,3}|-?\d{2,})?\s*$/i);
      if (tvaLine && tva19 === 0) {
        if (tvaLine[1]) {
          tva19 = parseAmount(tvaLine[1]);
        } else {
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const v = parseAmount(lines[j].trim());
            if (v !== 0) { tva19 = v; break; }
          }
        }
      }

      const fodecLine = line.match(/^fodec\s*1\s*%?\s*:?\s*(-?[\d\s]*[.,]\d{1,3}|-?\d{2,})?\s*$/i);
      if (fodecLine && fodec === 0) {
        if (fodecLine[1]) {
          fodec = parseAmount(fodecLine[1]);
        } else {
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const v = parseAmount(lines[j].trim());
            if (v !== 0) { fodec = v; break; }
          }
        }
      }

      const timbreLine = line.match(/^timbre\s*fiscal\s*:?\s*(-?[\d\s]*[.,]\d{1,3}|-?\d{1,2})?\s*$/i);
      if (timbreLine && timbre === 0) {
        if (timbreLine[1]) {
          timbre = parseAmount(timbreLine[1]);
        } else {
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const v = parseAmount(lines[j].trim());
            if (v !== 0) { timbre = v; break; }
          }
        }
      }

      const ttcLine = line.match(/^total\s*ttc\b\s*:?\s*(-?[\d\s]*[.,]\d{1,3}|-?\d{2,})?\s*(DT|TTC)?\s*$/i);
      if (ttcLine && totalTTC === 0) {
        if (ttcLine[1]) {
          totalTTC = parseAmount(ttcLine[1]);
        } else {
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const v = parseAmount(lines[j].trim());
            if (v !== 0) { totalTTC = v; break; }
          }
        }
      }
    }

    // Fallback : si TTC absent mais HT+TVA connus
    if (totalTTC === 0 && (totalHT !== 0 || tva19 !== 0)) {
      totalTTC = totalHT + tva19 + fodec + timbre;
    }

    if (!numero || !date) return null;

    // Detect 0% TVA invoices (no TVA line in PDF) → HT goes to 707003
    // AVR : TVA negative (-3.358) → on utilise Math.abs pour detecter
    const hasTVA = Math.abs(tva19) > 0;

    // Map code_client → 411XXX
    const compteClient = clientMap[codeClient] || '411000';

    return {
      numero, date_facture: date, client: clientName || codeClient, code_client: codeClient,
      compte_client: compteClient, is_avoir: isAvoir,
      total_ht_0: hasTVA ? 0 : Math.abs(totalHT),
      total_ht_19: hasTVA ? Math.abs(totalHT) : 0,
      tva_19: Math.abs(tva19), fodec: Math.abs(fodec),
      timbre: isAvoir ? 0 : Math.abs(timbre),
      total_ttc: Math.abs(totalTTC),
    };
  };

  const handleAddFacture = async () => {
    if (!id) return;
    const f = {
      ...form,
      total_ht_0: parseFloat(form.total_ht_0) || 0,
      total_ht_19: parseFloat(form.total_ht_19) || 0,
      tva_19: parseFloat(form.tva_19) || 0,
      fodec: parseFloat(form.fodec) || 0,
      timbre: parseFloat(form.timbre) || 0,
      total_ttc: parseFloat(form.total_ttc) || 0,
    };
    await api.scan.addFacture(id, f);
    setForm({ numero: '', date_facture: '', client: '', compte_client: '', total_ht_0: '0', total_ht_19: '0', tva_19: '0', fodec: '0', timbre: '0', total_ttc: '0' });
    await load();
  };

  const handleSaveToDB = async () => {
    if (!id || localFactures.length === 0) return;
    if (!confirm(`Sauvegarder ${localFactures.length} facture(s) en base?`)) return;
    let saved = 0, updated = 0;
    for (const f of localFactures) {
      try {
        const res = await api.scan.addFacture(id, {
          numero: f.numero, date_facture: f.date_facture, client: f.client,
          code_client: f.code_client, compte_client: f.compte_client, is_avoir: f.is_avoir,
          total_ht_0: f.total_ht_0, total_ht_19: f.total_ht_19, tva_19: f.tva_19,
          fodec: f.fodec, timbre: f.timbre, total_ttc: f.total_ttc,
        });
        if ((res as any)?.updated) updated++; else saved++;
      } catch { /* skip errors */ }
    }
    alert(`${saved} ajoutees, ${updated} mises a jour.`);
    setLocalFactures([]);
    await load();
  };

  const handleGenerate = async () => {
    if (localFactures.length === 0) return;
    const ecritures: any[] = [];
    for (const f of localFactures) {
      const date = f.date_facture;
      const facNum = f.numero || '';
      const clientName = f.client || '';
      const compteClient = f.compte_client || '411000';
      const ht0 = f.total_ht_0 || 0;
      const ht19 = f.total_ht_19 || 0;
      const tva = f.tva_19 || 0;
      const fodec = f.fodec || 0;
      const timbre = f.timbre || 0;
      const isAvoir = !!f.is_avoir;
      const prefix = isAvoir ? 'AVR' : 'FAC';
      const lib = `${prefix} ${facNum}/${clientName}`;
      // D = sum of all C amounts (ensures balance)
      const totalCredit = ht19 + ht0 + tva + fodec + timbre;
      const r = (v: number) => Math.round(v * 1000) / 1000;

      if (isAvoir) {
        if (totalCredit > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: compteClient, libelle: lib, sens: 'C', montant: r(totalCredit) });
        if (ht19 > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '707000', libelle: lib, sens: 'D', montant: r(ht19) });
        if (ht0 > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '707003', libelle: lib, sens: 'D', montant: r(ht0) });
        if (tva > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '436719', libelle: lib, sens: 'D', montant: r(tva) });
        if (fodec > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '436780', libelle: lib, sens: 'D', montant: r(fodec) });
      } else {
        if (totalCredit > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: compteClient, libelle: lib, sens: 'D', montant: r(totalCredit) });
        if (ht19 > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '707000', libelle: lib, sens: 'C', montant: r(ht19) });
        if (ht0 > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '707003', libelle: lib, sens: 'C', montant: r(ht0) });
        if (tva > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '436719', libelle: lib, sens: 'C', montant: r(tva) });
        if (fodec > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '436780', libelle: lib, sens: 'C', montant: r(fodec) });
        if (timbre > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '437600', libelle: lib, sens: 'C', montant: r(timbre) });
      }
    }
    setLocalEcritures(ecritures);
    setTab('ecritures');
  };

  const handleExportCSV = async () => {
    if (localEcritures.length === 0) { alert('Aucune écriture à exporter. Générer d\'abord le VT.'); return; }
    const lines: string[] = [];
    for (const e of localEcritures) {
      const date = e.date_operation;
      const [y, m, d] = date.split('-');
      const dateFormatted = `${d}/${m}/${y}`;
      const montant = Math.round((e.montant || 0) * 1000) / 1000;
      const debit = e.sens === 'D' ? montant.toFixed(3) : '0.000';
      const credit = e.sens === 'C' ? montant.toFixed(3) : '0.000';
      lines.push(`${e.numero_doc || ''}\t${dateFormatted}\t${e.journal_code || 'VT'}\t${e.libelle || ''}\t${e.compte}\t\t${debit}\t${credit}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `scan_ecritures.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const handleExportXLSX = async () => {
    if (localEcritures.length === 0) { alert('Aucune écriture à exporter. Générer d\'abord le VT.'); return; }
    const XLSXMod = await import('xlsx').catch(() => null);
    if (!XLSXMod) { alert('Erreur chargement bibliothèque XLSX.'); return; }
    const XLSX = XLSXMod.default || XLSXMod;
    const header = ['N° pièce comptable', 'Date pièce comptable', 'Journal', 'Libellé', 'N° compte', 'Libellé trésorerie', 'Débit', 'Crédit'];
    const rows: any[][] = [header];
    for (const e of localEcritures) {
      const date = e.date_operation;
      const [y, m, d] = date.split('-');
      const dateFormatted = `${d}/${m}/${y}`;
      const montant = Math.round((e.montant || 0) * 1000) / 1000;
      rows.push([e.numero_doc || '', dateFormatted, e.journal_code || 'VT', e.libelle || '', e.compte, '', e.sens === 'D' ? montant : 0, e.sens === 'C' ? montant : 0]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 30 }, { wch: 27 }, { wch: 10 }, { wch: 40 }, { wch: 12 }, { wch: 28 }, { wch: 15 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ecritures');
    const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `scan_ecritures.xlsx`;
    a.click(); URL.revokeObjectURL(url);
  };

  const handleDeleteFactures = () => {
    if (!confirm('Vider les factures?')) return;
    setLocalFactures([]);
    setLocalEcritures([]);
  };

  const handleDeleteEcritures = () => {
    if (!confirm('Vider les ecritures?')) return;
    setLocalEcritures([]);
  };

  const handleVerify = () => {
    if (localFactures.length === 0) return;
    const checks: any[] = [];
    let errors = 0;
    let totalHT = 0, totalTVA = 0, totalFODEC = 0, totalTimbre = 0, totalTTC = 0;
    for (const f of localFactures) {
      const ht19 = f.total_ht_19 || 0;
      const ht0 = f.total_ht_0 || 0;
      const htTotal = ht0 + ht19;
      const tvaActual = f.tva_19 || 0;
      const tvaExpected = ht19 > 0 ? Math.round(ht19 * 19) / 100 : 0;
      const tvaDiff = Math.abs(tvaActual - tvaExpected);
      const fodecActual = f.fodec || 0;
      const fodecExpected = ht19 > 0 ? Math.round(ht19 * 1) / 100 : 0;
      const fodecDiff = Math.abs(fodecActual - fodecExpected);
      const ttcComputed = htTotal + tvaActual + fodecActual + (f.timbre || 0);
      const ttcDeclared = f.total_ttc || ttcComputed;
      const ttcDiff = Math.abs(ttcDeclared - ttcComputed);
      totalHT += htTotal;
      totalTVA += tvaActual;
      totalFODEC += fodecActual;
      totalTimbre += f.timbre || 0;
      totalTTC += ttcDeclared;
      const pieceChecks: any[] = [];
      if (tvaDiff > 0.01) { pieceChecks.push({ name: 'TVA', status: 'error', detail: `TVA ${tvaActual} ≠ HT×19% = ${tvaExpected} (ecart ${tvaDiff.toFixed(3)})`, expected: tvaExpected, actual: tvaActual }); errors++; } else { pieceChecks.push({ name: 'TVA', status: 'ok', detail: `TVA ${tvaActual} = HT×19%` }); }
      if (fodecDiff > 0.01) { pieceChecks.push({ name: 'FODEC', status: 'error', detail: `FODEC ${fodecActual} ≠ HT×1% = ${fodecExpected}`, expected: fodecExpected, actual: fodecActual }); errors++; } else { pieceChecks.push({ name: 'FODEC', status: 'ok', detail: `FODEC ${fodecActual} = HT×1%` }); }
      if (Math.abs(ttcDiff) > 0.01) { pieceChecks.push({ name: 'TTC', status: 'error', detail: `TTC declare ${ttcDeclared} ≠ calcule ${ttcComputed}`, expected: ttcComputed, actual: ttcDeclared }); errors++; } else { pieceChecks.push({ name: 'TTC', status: 'ok', detail: `TTC ${ttcDeclared} = somme lignes` }); }
      checks.push({ piece: f.numero, type: f.is_avoir ? 'AVR' : 'FAC', client: f.client, checks: pieceChecks });
    }
    setVerifyResult({ verdict: errors > 0 ? 'ERREUR' : 'OK', errors, totalFactures: localFactures.length, totals: { ht: totalHT, tva: totalTVA, fodec: totalFODEC, timbre: totalTimbre, ttc: totalTTC }, checks });
  };

  const handleFixTVA = () => {
    const fixed = localFactures.map(f => {
      const ht19 = f.total_ht_19 || 0;
      const tvaExpected = ht19 > 0 ? Math.round(ht19 * 19) / 100 : 0;
      const tvaActual = f.tva_19 || 0;
      const fodecExpected = ht19 > 0 ? Math.round(ht19 * 1) / 100 : 0;
      const fodecActual = f.fodec || 0;
      let changed = false;
      let newTva = tvaActual;
      let newFodec = fodecActual;
      if (Math.abs(tvaActual - tvaExpected) > 0.01) { newTva = tvaExpected; changed = true; }
      if (Math.abs(fodecActual - fodecExpected) > 0.01) { newFodec = fodecExpected; changed = true; }
      if (changed) {
        const newTtc = (f.total_ht_0 || 0) + ht19 + newTva + newFodec + (f.timbre || 0);
        return { ...f, tva_19: newTva, fodec: newFodec, total_ttc: newTtc };
      }
      return f;
    });
    setLocalFactures(fixed);
    setVerifyResult(null);
    setLocalEcritures([]);
  };

  if (loading) return <div className="text-gray-400 py-10">Chargement...</div>;
  if (!dossier) return <div className="text-red-500 py-10">Dossier non trouve</div>;

  const tabs: { key: Tab; label: string; icon: any; count: number }[] = [
    { key: 'factures', label: 'Factures', icon: FileText, count: localFactures.length },
    { key: 'ecritures', label: 'Ecritures VT', icon: Table2, count: localEcritures.length },
    { key: 'export', label: 'Export', icon: Download, count: localEcritures.length },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/scanflash')} className="text-gray-400 hover:text-gray-700"><ArrowLeft size={20} /></button>
        <div>
          <h1 className="text-xl font-bold text-gray-800">{dossier.nom}</h1>
          <span className="text-xs text-gray-500">SCANFLASH</span>
        </div>
        <div className="ml-auto flex gap-2">
          {(localFactures.length > 0 || localEcritures.length > 0) && (
            <button onClick={() => { if (confirm('Tout vider?')) { setLocalFactures([]); setLocalEcritures([]); setVerifyResult(null); } }} className="text-sm text-red-500 hover:text-red-700">Tout vider</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1 px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t.key ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon size={15} />
            {t.label}
            {t.count > 0 && <span className="ml-1 bg-gray-200 text-gray-600 text-xs px-1.5 rounded-full">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Tab: Factures */}
      {tab === 'factures' && (
        <div className="space-y-4">
          {/* Upload */}
          <div className="bg-white rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <label className="bg-emerald-600 text-white px-4 py-2 rounded text-sm hover:bg-emerald-700 cursor-pointer">
                <Upload size={15} className="inline mr-1" />
                {uploading ? 'Extraction...' : 'Importer PDF(s)'}
                <input type="file" accept=".pdf" multiple className="hidden" onChange={e => e.target.files && handleUploadPDF(e.target.files)} />
              </label>
              {localFactures.length > 0 && (
                <button onClick={handleSaveToDB} className="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700">
                  <Database size={15} className="inline mr-1" /> Sauver en base
                </button>
              )}
              {localFactures.length > 0 && (
                <button onClick={handleGenerate} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">
                  <Zap size={15} className="inline mr-1" /> Generer VT
                </button>
              )}
              <span className="text-xs text-gray-400">{localFactures.length} factures importees</span>
              {localFactures.length > 0 && (
                <button onClick={handleDeleteFactures} className="text-red-400 hover:text-red-600 text-xs ml-auto"><Trash2 size={14} className="inline mr-1" /> Tout supprimer</button>
              )}
            </div>
          </div>

          {/* Client mapping */}
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold text-gray-700 mb-3 text-sm">Mapping Code Client → Compte 411XXX</h3>
            <div className="flex gap-2 items-end mb-2">
              <input placeholder="Code client (ex: CLT0626-1187)" value={newClientCode} onChange={e => setNewClientCode(e.target.value)} className="flex-1 border rounded px-2 py-1.5 text-sm" />
              <input placeholder="Compte 411XXX" value={newClientAccount} onChange={e => setNewClientAccount(e.target.value)} className="w-32 border rounded px-2 py-1.5 text-sm" />
              <input placeholder="Nom (optionnel)" value={newClientName} onChange={e => setNewClientName(e.target.value)} className="flex-1 border rounded px-2 py-1.5 text-sm" />
              <button onClick={() => {
                if (!newClientCode.trim() || !newClientAccount.trim()) return;
                saveClientMap({ ...clientMap, [newClientCode.trim()]: newClientAccount.trim() });
                setNewClientCode(''); setNewClientAccount(''); setNewClientName('');
              }} className="bg-emerald-500 text-white px-3 py-1.5 rounded text-sm hover:bg-emerald-600">+</button>
            </div>
            {Object.keys(clientMap).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {Object.entries(clientMap).map(([code, acct]) => (
                  <span key={code} className="inline-flex items-center gap-1 bg-gray-100 text-xs px-2 py-1 rounded">
                    {code} → {acct}
                    <button onClick={() => { const m = { ...clientMap }; delete m[code]; saveClientMap(m); }} className="text-red-400 hover:text-red-600">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Manual add */}
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold text-gray-700 mb-3 text-sm">Ajouter manuellement</h3>
            <div className="grid grid-cols-4 gap-2 text-sm">
              <input placeholder="N° FAC" value={form.numero} onChange={e => setForm({...form, numero: e.target.value})} className="border rounded px-2 py-1.5" />
              <input type="date" value={form.date_facture} onChange={e => setForm({...form, date_facture: e.target.value})} className="border rounded px-2 py-1.5" />
              <input placeholder="Client" value={form.client} onChange={e => setForm({...form, client: e.target.value})} className="border rounded px-2 py-1.5" />
              <input placeholder="Compte 411XXX" value={form.compte_client} onChange={e => setForm({...form, compte_client: e.target.value})} className="border rounded px-2 py-1.5" />
              <input placeholder="HT 0%" type="number" step="0.001" value={form.total_ht_0} onChange={e => setForm({...form, total_ht_0: e.target.value})} className="border rounded px-2 py-1.5" />
              <input placeholder="HT 19%" type="number" step="0.001" value={form.total_ht_19} onChange={e => setForm({...form, total_ht_19: e.target.value})} className="border rounded px-2 py-1.5" />
              <input placeholder="TVA 19%" type="number" step="0.001" value={form.tva_19} onChange={e => setForm({...form, tva_19: e.target.value})} className="border rounded px-2 py-1.5" />
              <input placeholder="FODEC" type="number" step="0.001" value={form.fodec} onChange={e => setForm({...form, fodec: e.target.value})} className="border rounded px-2 py-1.5" />
              <input placeholder="Timbre" type="number" step="0.001" value={form.timbre} onChange={e => setForm({...form, timbre: e.target.value})} className="border rounded px-2 py-1.5" />
              <input placeholder="TTC" type="number" step="0.001" value={form.total_ttc} onChange={e => setForm({...form, total_ttc: e.target.value})} className="border rounded px-2 py-1.5" />
              <button onClick={handleAddFacture} className="bg-emerald-500 text-white rounded px-3 py-1.5 hover:bg-emerald-600">+</button>
            </div>
          </div>

          {/* Factures table */}
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">N°</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Client</th>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Compte</th>
                  <th className="px-3 py-2 text-right">HT 19%</th>
                  <th className="px-3 py-2 text-right">TVA</th>
                  <th className="px-3 py-2 text-right">FODEC</th>
                  <th className="px-3 py-2 text-right">Timbre</th>
                  <th className="px-3 py-2 text-right">TTC</th>
                </tr>
              </thead>
              <tbody>
                {localFactures.map(f => (
                  <tr key={f.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-mono text-xs">
                      {f.is_avoir ? <span className="text-red-600 font-bold">AVR</span> : 'FAC'} {f.numero}
                    </td>
                    <td className="px-3 py-1.5 text-xs">{f.date_facture}</td>
                    <td className="px-3 py-1.5 text-xs">{f.client}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-gray-500">{f.code_client}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{f.compte_client}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{(f.total_ht_19 || 0).toFixed(3)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{(f.tva_19 || 0).toFixed(3)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{(f.fodec || 0).toFixed(3)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{(f.timbre || 0).toFixed(3)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold">{(f.total_ttc || 0).toFixed(3)}</td>
                  </tr>
                ))}
                {localFactures.length === 0 && <tr><td colSpan={10} className="text-center text-gray-400 py-6">Aucune facture</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Generate button */}
          {factures.length > 0 && (
            <div className="flex justify-center">
              <button onClick={handleGenerate} disabled={generating}
                className="bg-emerald-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2">
                <Zap size={18} />
                {generating ? 'Generation...' : `Generer VT (${factures.length} factures)`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab: Ecritures */}
      {tab === 'ecritures' && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => handleExportCSV()} className="bg-emerald-600 text-white px-3 py-1.5 rounded text-sm hover:bg-emerald-700">
              <Download size={14} className="inline mr-1" /> Export CSV VT
            </button>
            <button onClick={handleExportXLSX} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">
              <Download size={14} className="inline mr-1" /> Export XLSX VT
            </button>
            {localEcritures.length > 0 && (
              <button onClick={() => handleDeleteEcritures()} className="text-red-400 hover:text-red-600 text-sm border border-red-200 px-3 py-1.5 rounded">
                <Trash2 size={14} className="inline mr-1" /> Vider ecritures
              </button>
            )}
          </div>

          {/* Manual add ecriture */}
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold text-gray-700 mb-3 text-sm">Ajouter une ecriture</h3>
            <div className="grid grid-cols-6 gap-2 text-sm">
              <input type="date" id="ecr-date" className="border rounded px-2 py-1.5" defaultValue={dossier?.mois ? `${dossier.annee}-${String(dossier.mois).padStart(2,'0')}-01` : ''} />
              <input placeholder="N° Piece" id="ecr-piece" className="border rounded px-2 py-1.5" />
              <input placeholder="Compte" id="ecr-compte" className="border rounded px-2 py-1.5" />
              <input placeholder="Libelle" id="ecr-libelle" className="border rounded px-2 py-1.5" />
              <select id="ecr-sens" className="border rounded px-2 py-1.5">
                <option value="D">Debit</option>
                <option value="C">Credit</option>
              </select>
              <input placeholder="Montant" type="number" step="0.001" id="ecr-montant" className="border rounded px-2 py-1.5" />
              <button onClick={() => {
                const date = (document.getElementById('ecr-date') as HTMLInputElement).value;
                const piece = (document.getElementById('ecr-piece') as HTMLInputElement).value;
                const compte = (document.getElementById('ecr-compte') as HTMLInputElement).value;
                const libelle = (document.getElementById('ecr-libelle') as HTMLInputElement).value;
                const sens = (document.getElementById('ecr-sens') as HTMLSelectElement).value;
                const montant = parseFloat((document.getElementById('ecr-montant') as HTMLInputElement).value) || 0;
                if (!date || !compte || montant <= 0) return alert('Remplir tous les champs');
                setLocalEcritures(prev => [...prev, { id: crypto.randomUUID(), numero_doc: piece, date_operation: date, journal_code: 'VT', compte, libelle, sens, montant }]);
                (document.getElementById('ecr-montant') as HTMLInputElement).value = '';
              }} className="bg-emerald-500 text-white rounded px-3 py-1.5 hover:bg-emerald-600">+</button>
            </div>
          </div>

          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Journal</th>
                  <th className="px-3 py-2 text-left">N° Piece</th>
                  <th className="px-3 py-2 text-left">Compte</th>
                  <th className="px-3 py-2 text-left">Libelle</th>
                  <th className="px-3 py-2 text-center">D/C</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {localEcritures.map(e => (
                  <tr key={e.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-1.5 text-xs">{e.date_operation}</td>
                    <td className="px-3 py-1.5 text-xs font-mono">{e.journal_code}</td>
                    <td className="px-3 py-1.5 text-xs font-mono">{e.numero_doc}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{e.compte}</td>
                    <td className="px-3 py-1.5 text-xs">{e.libelle}</td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={`text-xs font-bold ${e.sens === 'D' ? 'text-blue-600' : 'text-emerald-600'}`}>{e.sens}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{e.sens === 'D' ? (e.montant || 0).toFixed(3) : ''}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{e.sens === 'C' ? (e.montant || 0).toFixed(3) : ''}</td>
                    <td className="px-1">
                      <button onClick={() => setLocalEcritures(prev => prev.filter(x => x.id !== e.id))} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
                {localEcritures.length === 0 && <tr><td colSpan={9} className="text-center text-gray-400 py-6">Aucune ecriture - cliquer "Generer VT" ou ajouter manuellement</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Export */}
      {tab === 'export' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-6 space-y-4">
            <h3 className="font-semibold text-gray-700">Export CSV / Axeane</h3>
            <p className="text-sm text-gray-500">Format: N° piece | Date | Journal | Libelle | Compte | Libelle tresorerie | Debit | Credit</p>
            <div className="flex gap-3 items-center flex-wrap">
              <button onClick={() => handleExportCSV()} disabled={localEcritures.length === 0} className="bg-emerald-600 text-white px-4 py-2 rounded text-sm hover:bg-emerald-700 disabled:opacity-50">
                <Download size={15} className="inline mr-1" /> Export CSV
              </button>
              <button onClick={handleExportXLSX} disabled={localEcritures.length === 0} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                <Download size={15} className="inline mr-1" /> Export XLSX
              </button>
              <button onClick={handleVerify} disabled={localFactures.length === 0} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                <ShieldCheck size={15} className="inline mr-1" /> Verifier TVA 19%
              </button>
              {verifyResult && verifyResult.errors > 0 && (
                <button onClick={handleFixTVA} className="bg-amber-600 text-white px-4 py-2 rounded text-sm hover:bg-amber-700">
                  <Wrench size={15} className="inline mr-1" /> Corriger TVA
                </button>
              )}
              <span className="text-sm text-gray-500">{localFactures.length} factures / {localEcritures.length} ecritures</span>
            </div>

            {verifyResult && !verifyResult.error && (
              <div className={`rounded-lg border p-4 ${verifyResult.verdict === 'OK' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {verifyResult.verdict === 'OK' ? <CheckCircle size={18} className="text-green-600" /> : <span className="text-red-600 font-bold">!</span>}
                  <span className={`font-semibold ${verifyResult.verdict === 'OK' ? 'text-green-700' : 'text-red-700'}`}>
                    {verifyResult.verdict} — {verifyResult.errors} erreur(s) sur {verifyResult.totalFactures} factures
                  </span>
                </div>
                {verifyResult.totals && (
                  <div className="text-xs text-gray-600 mb-2">
                    HT: {verifyResult.totals.ht?.toFixed(3)} | TVA: {verifyResult.totals.tva?.toFixed(3)} | FODEC: {verifyResult.totals.fodec?.toFixed(3)} | Timbre: {verifyResult.totals.timbre?.toFixed(3)} | TTC: {verifyResult.totals.ttc?.toFixed(3)}
                  </div>
                )}
                {verifyResult.checks && (
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="text-gray-500"><th className="text-left pr-2">Piece</th><th className="text-left pr-2">Type</th><th className="text-left pr-2">Client</th><th className="text-left">Check</th></tr></thead>
                      <tbody>
                        {verifyResult.checks.map((c: any, i: number) =>
                          c.checks?.map((ch: any, j: number) => (
                            <tr key={`${i}-${j}`} className={`border-t ${ch.status === 'error' ? 'bg-red-50' : ''}`}>
                              {j === 0 && <td rowSpan={c.checks.length} className="pr-2 font-mono">{c.piece}</td>}
                              {j === 0 && <td rowSpan={c.checks.length} className="pr-2">{c.type}</td>}
                              {j === 0 && <td rowSpan={c.checks.length} className="pr-2">{c.client}</td>}
                              <td className={ch.status === 'error' ? 'text-red-600 font-medium' : 'text-green-600'}>{ch.detail}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {verifyResult?.error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{verifyResult.error}</div>
            )}
            {localEcritures.length > 0 && (
              <div className="bg-gray-50 rounded p-3 text-xs text-gray-600 max-h-48 overflow-auto">
                <table className="w-full">
                  <thead><tr className="text-gray-500"><th className="text-left pr-3">Date</th><th className="text-left pr-3">Piece</th><th className="text-left pr-3">Compte</th><th className="text-right pr-3">D</th><th className="text-right">C</th></tr></thead>
                  <tbody>
                    {localEcritures.slice(0, 30).map(e => (
                      <tr key={e.id} className="border-t border-gray-200">
                        <td className="pr-3">{e.date_operation}</td>
                        <td className="pr-3 font-mono">{e.numero_doc}</td>
                        <td className="pr-3 font-mono">{e.compte}</td>
                        <td className="pr-3 text-right font-mono">{e.sens === 'D' ? (e.montant || 0).toFixed(3) : ''}</td>
                        <td className="text-right font-mono">{e.sens === 'C' ? (e.montant || 0).toFixed(3) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {localEcritures.length > 30 && <div className="text-gray-400 mt-1">... {localEcritures.length - 30} lignes de plus</div>}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border p-6">
            <h3 className="font-semibold text-gray-700 mb-2">Comptes utilises</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <h4 className="font-medium text-gray-600 mb-1">Clients (Debit)</h4>
                <ul className="text-xs text-gray-500 space-y-0.5">
                  <li><code>411XXX</code> — Compte client (par tiers)</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium text-gray-600 mb-1">Ventes (Credit)</h4>
                <ul className="text-xs text-gray-500 space-y-0.5">
                  <li><code>707000</code> — Ventes 19%</li>
                  <li><code>707003</code> — Vente suspension TVA</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium text-gray-600 mb-1">TVA & taxes (Credit)</h4>
                <ul className="text-xs text-gray-500 space-y-0.5">
                  <li><code>436719</code> — TVA collectee 19%</li>
                  <li><code>436780</code> — FODEC</li>
                  <li><code>437600</code> — Timbre fiscal</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
