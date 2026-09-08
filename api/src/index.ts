export interface Env {
  DB: D1Database;
  AI: Ai;
  ENVIRONMENT: string;
}

function genId(): string {
  return crypto.randomUUID();
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function cors(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// --- EXCLUDED DAYS ---
const EXCLUDED_DAYS = new Set([
  '2026-06-05', '2026-06-07', '2026-06-09', '2026-06-13',
  '2026-06-14', '2026-06-23', '2026-06-27', '2026-06-29', '2026-06-30'
]);
const CLIENT_NAMES: Record<string, string> = { '99': 'CLTS PASSAGERS', '111': 'STE WEZIGN', '122': 'NESRINE BACCAR' };

function buildDayEcritures(date: string, dayFactures: any[], modes: any, defaultLibelle: string) {
  if (EXCLUDED_DAYS.has(date)) {
    return { lines: [], ecart: 0, excluded: true, anomaly: { date, error: 'Exclu: ecart > 3DT' } };
  }
  const totalHT0 = Math.round(dayFactures.reduce((s: number, f: any) => s + (f.total_ht_0 || 0), 0) * 1000) / 1000;
  const totalHT19 = Math.round(dayFactures.reduce((s: number, f: any) => s + (f.total_ht_19 || 0), 0) * 1000) / 1000;
  const tva19 = Math.round(dayFactures.reduce((s: number, f: any) => s + (f.tva_19 || 0), 0) * 1000) / 1000;
  const timbres = dayFactures.reduce((s: number, f: any) => s + (f.timbre || 1), 0);
  const avoir709 = (modes.bonsAchat || 0) + (modes.avoir || 0);
  const debitSum = (modes.especes || 0) + (modes.tpe || 0) + (modes.cheques || 0) + avoir709;
  const creditSum = tva19 + timbres + totalHT0 + totalHT19;
  const ecart = Math.round((debitSum - creditSum) * 1000) / 1000;

  const lines: any[] = [];
  if ((modes.especes || 0) > 0) lines.push({ compte: '411004', montant: Math.round(modes.especes * 1000) / 1000, sens: 'D' });
  if ((modes.tpe || 0) > 0) lines.push({ compte: '411005', montant: Math.round(modes.tpe * 1000) / 1000, sens: 'D' });
  if ((modes.cheques || 0) > 0) lines.push({ compte: '411003', montant: Math.round(modes.cheques * 1000) / 1000, sens: 'D' });

  const byClient: Record<string, { ht0: number; ht19: number }> = {};
  for (const f of dayFactures) {
    const c = String(f.client || '99');
    if (!byClient[c]) byClient[c] = { ht0: 0, ht19: 0 };
    byClient[c].ht0 += (f.total_ht_0 || 0);
    byClient[c].ht19 += (f.total_ht_19 || 0);
  }
  const tierKeys = Object.keys(byClient);
  for (const [cc, amt] of Object.entries(byClient)) {
    const rht0 = Math.round(amt.ht0 * 1000) / 1000;
    const rht19 = Math.round(amt.ht19 * 1000) / 1000;
    const lib = tierKeys.length > 1 ? (CLIENT_NAMES[cc] || cc) : defaultLibelle;
    if (rht0 > 0) lines.push({ compte: '707200', montant: rht0, sens: 'C', libelle: lib });
    if (rht19 > 0) lines.push({ compte: '707219', montant: rht19, sens: 'C', libelle: lib });
  }
  if (tva19 > 0) lines.push({ compte: '436711', montant: tva19, sens: 'C' });
  lines.push({ compte: '437500', montant: timbres, sens: 'C' });
  if (avoir709 > 0) lines.push({ compte: '709500', montant: Math.round(avoir709 * 1000) / 1000, sens: 'D' });
  if (ecart !== 0) lines.push({ compte: '634500', montant: Math.abs(ecart), sens: ecart > 0 ? 'C' : 'D' });

  let anomaly = null;
  if (Math.abs(ecart) > 3) {
    anomaly = { date, error: 'ECART ' + ecart.toFixed(3) + 'DT > 3DT' };
  }
  return { lines, ecart, excluded: false, anomaly, totalHT0, totalHT19, tva19, timbres };
}

function parseVTCLines(text: string) {
  const DEBIT_ACCOUNTS = new Set(['411004', '411003', '411005', '709500']);
  const CREDIT_ACCOUNTS = new Set(['707100', '707119', '436710', '437500']);
  const allAccounts = [...DEBIT_ACCOUNTS, ...CREDIT_ACCOUNTS, '634500'];
  const entries: any[] = [];
  let currentFacNum: string | null = null;

  for (const line of text.split('\n')) {
    const facMatch = line.match(/FAC\s*(?:N[°o]?\s*)?(\d+[-\/]\d+)/i);
    if (facMatch) currentFacNum = facMatch[1].replace('-', '/');

    const dateMatch = line.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (dateMatch) {
      const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
      for (const acct of allAccounts) {
        const acctRegex = new RegExp('\\b' + acct + '\\b\\s+(.+?)\\s+([\\d][\\d\\s]*[,\\.]\\d{1,3})\\s*$');
        const acctMatch = line.match(acctRegex);
        if (acctMatch) {
          const montant = parseFloat(acctMatch[2].replace(/\s/g, '').replace(',', '.'));
          if (isNaN(montant) || montant === 0) continue;
          const libelle = acctMatch[1].trim();
          entries.push({
            date, facNum: currentFacNum ? 'FAC ' + currentFacNum : null,
            compte: acct, compteLibelle: acct + ' ' + libelle, montant,
            libelle: libelle || 'CLIENTS PASSAGERS',
            sens: acct === '634500' ? 'D' : DEBIT_ACCOUNTS.has(acct) ? 'D' : 'C',
          });
        }
      }
    }
  }
  return entries;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return cors();

    try {
      // --- SEED DATA ---
      if (path === '/api/seed' && method === 'POST') {
        const existing = await env.DB.prepare('SELECT id FROM societes LIMIT 1').first();
        if (existing) return json({ ok: true, msg: 'Already seeded' });

        const sid = 'default_soc';
        await env.DB.prepare('INSERT INTO societes (id, raison_sociale) VALUES (?, ?)').bind(sid, 'Cabinet').run();
        const journaux = [['VE','Ventes'],['AC','Achats'],['BQ','Banque'],['CA','Caisse'],['OD','Operations Diverses'],['FISC','Declarations Fiscales']];
        for (const [c, l] of journaux) {
          await env.DB.prepare('INSERT INTO journaux (id, societe_id, code, libelle) VALUES (?, ?, ?, ?)').bind(genId(), sid, c, l).run();
        }
        const did = 'dossier_animal';
        await env.DB.prepare('INSERT INTO dossiers (id, societe_id, nom) VALUES (?, ?, ?)').bind(did, sid, 'ANIMAL').run();
        return json({ ok: true, msg: 'Seeded' });
      }

      // --- DASHBOARD ---
      if (path === '/api/dashboard' && method === 'GET') {
        const recent = await env.DB.prepare('SELECT d.*, s.raison_sociale FROM dossiers d LEFT JOIN societes s ON d.societe_id = s.id ORDER BY d.created_at DESC LIMIT 10').all();
        const animal = await env.DB.prepare('SELECT id FROM dossiers WHERE nom = ?').bind('ANIMAL').first() as any;
        // BAUD dossiers
        const baudSocs = await env.DB.prepare('SELECT * FROM societes_paie ORDER BY nom').all();
        const baudDossiers: any[] = [];
        for (const bs of baudSocs.results as any[]) {
          const ds = await env.DB.prepare('SELECT * FROM dossiers_paie WHERE societe_id = ? ORDER BY created_at DESC').bind(bs.id).all();
          for (const dd of ds.results as any[]) baudDossiers.push({ ...dd, raison_sociale: bs.nom, type: 'baud' });
        }
        // SCANFLASH dossiers
        const scanSocs = await env.DB.prepare('SELECT * FROM societes_scan ORDER BY raison_sociale').all();
        const scanDossiers: any[] = [];
        for (const ss of scanSocs.results as any[]) {
          const ds = await env.DB.prepare('SELECT * FROM dossiers_scan WHERE societe_id = ? ORDER BY created_at DESC').bind(ss.id).all();
          for (const dd of ds.results as any[]) scanDossiers.push({ ...dd, raison_sociale: ss.raison_sociale, type: 'scanflash' });
        }
        return json({ recentDossiers: recent.results, animalDossierId: animal?.id || null, baudDossiers, scanDossiers });
      }

      // --- SOCIETES ---
      if (path === '/api/societes' && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM societes ORDER BY raison_sociale').all();
        return json(r.results);
      }
      if (path === '/api/societes' && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO societes (id, raison_sociale, matricule_fiscal) VALUES (?, ?, ?)').bind(id, b.raison_sociale, b.matricule_fiscal || null).run();
        return json({ id, ...b });
      }
      const delSocMatch = path.match(/^\/api\/societes\/([^/]+)$/);
      if (delSocMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM societes WHERE id = ?').bind(delSocMatch[1]).run();
        return json({ ok: true });
      }

      // --- JOURNAUX ---
      const journauxMatch = path.match(/^\/api\/societes\/([^/]+)\/journaux$/);
      if (journauxMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM journaux WHERE societe_id = ?').bind(journauxMatch[1]).all();
        return json(r.results);
      }

      // --- DOSSIERS ---
      const dossiersListMatch = path.match(/^\/api\/societes\/([^/]+)\/dossiers$/);
      if (dossiersListMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM dossiers WHERE societe_id = ? ORDER BY created_at DESC').bind(dossiersListMatch[1]).all();
        return json(r.results);
      }
      if (dossiersListMatch && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO dossiers (id, societe_id, nom) VALUES (?, ?, ?)').bind(id, dossiersListMatch[1], b.nom).run();
        return json({ id, nom: b.nom, statut: 'brouillon' });
      }

      const dossierGetMatch = path.match(/^\/api\/dossiers\/([^/]+)$/);
      if (dossierGetMatch && method === 'GET') {
        const d = await env.DB.prepare('SELECT * FROM dossiers WHERE id = ?').bind(dossierGetMatch[1]).first();
        return d ? json(d) : json({ error: 'Non trouve' }, 404);
      }
      if (dossierGetMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM dossiers WHERE id = ?').bind(dossierGetMatch[1]).run();
        return json({ ok: true });
      }

      // --- PIECES ---
      const piecesMatch = path.match(/^\/api\/dossiers\/([^/]+)\/pieces$/);
      if (piecesMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM pieces WHERE dossier_id = ? ORDER BY created_at').bind(piecesMatch[1]).all();
        return json(r.results);
      }

      // --- FACTURES ---
      const facturesMatch = path.match(/^\/api\/dossiers\/([^/]+)\/factures$/);
      if (facturesMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM factures WHERE dossier_id = ? ORDER BY date_facture, numero_facture').bind(facturesMatch[1]).all();
        return json(r.results);
      }
      if (facturesMatch && method === 'POST') {
        const b = await request.json() as any;
        const did = facturesMatch[1];
        const d = await env.DB.prepare('SELECT societe_id FROM dossiers WHERE id = ?').bind(did).first() as any;
        if (!d) return json({ error: 'Dossier non trouve' }, 404);
        const id = genId();
        await env.DB.prepare('INSERT INTO factures (id, dossier_id, societe_id, date_facture, numero_facture, client, total_ht_0, total_ht_19, tva_19, timbre, total_ttc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, did, d.societe_id, b.date_facture, b.numero_facture, b.client || '', b.total_ht_0 || 0, b.total_ht_19 || 0, b.tva_19 || 0, b.timbre || 1, b.total_ttc || 0).run();
        return json({ id, ...b });
      }
      const delFactMatch = path.match(/^\/api\/factures\/([^/]+)$/);
      if (delFactMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM factures WHERE id = ?').bind(delFactMatch[1]).run();
        return json({ ok: true });
      }
      const delAllFactMatch = path.match(/^\/api\/dossiers\/([^/]+)\/factures$/);
      if (delAllFactMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM factures WHERE dossier_id = ?').bind(delAllFactMatch[1]).run();
        await env.DB.prepare("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = 'VT J.C'").bind(delAllFactMatch[1]).run();
        return json({ ok: true });
      }

      // --- RAPPORT ---
      const rapportMatch = path.match(/^\/api\/dossiers\/([^/]+)\/rapport$/);
      if (rapportMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM rapport_modes WHERE dossier_id = ? ORDER BY date_jour').bind(rapportMatch[1]).all();
        return json(r.results);
      }
      if (rapportMatch && method === 'POST') {
        const b = await request.json() as any;
        const did = rapportMatch[1];
        const d = await env.DB.prepare('SELECT societe_id FROM dossiers WHERE id = ?').bind(did).first() as any;
        if (!d) return json({ error: 'Dossier non trouve' }, 404);
        const rows = b.rows || b;
        if (!Array.isArray(rows) || !rows.length) return json({ error: 'rows[] requis' }, 400);
        for (const r of rows) {
          const date = r.date_jour || r.date;
          await env.DB.prepare('INSERT OR REPLACE INTO rapport_modes (id, dossier_id, date_jour, especes, cheques, tpe, bonsAchat, avoir, credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, date, r.especes || 0, r.cheques || 0, r.tpe || 0, r.bonsAchat || 0, r.avoir || 0, r.credit || 0).run();
        }
        return json({ ok: true, count: rows.length });
      }
      if (rapportMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM rapport_modes WHERE dossier_id = ?').bind(rapportMatch[1]).run();
        return json({ ok: true });
      }

      // --- ECRITURES ---
      const ecrituresMatch = path.match(/^\/api\/dossiers\/([^/]+)\/ecritures$/);
      if (ecrituresMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM ecritures WHERE dossier_id = ? ORDER BY date_operation, journal_code').bind(ecrituresMatch[1]).all();
        return json(r.results);
      }
      if (ecrituresMatch && method === 'POST') {
        const b = await request.json() as any;
        const did = ecrituresMatch[1];
        const id = genId();
        await env.DB.prepare('INSERT INTO ecritures (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte, sens, montant, tresorerie, piece_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, did, b.societe_id, b.journal_code, b.date_operation, b.date_piece || null, b.numero_doc || null, b.libelle, b.compte, b.sens, b.montant, b.tresorerie || null, b.piece_id || null).run();
        return json({ id, ...b });
      }
      if (ecrituresMatch && method === 'DELETE') {
        const journal = url.searchParams.get('journal');
        if (journal) {
          await env.DB.prepare("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = ?").bind(ecrituresMatch[1], journal).run();
        } else {
          await env.DB.prepare('DELETE FROM ecritures WHERE dossier_id = ?').bind(ecrituresMatch[1]).run();
        }
        return json({ ok: true });
      }

      const delEcritMatch = path.match(/^\/api\/ecritures\/([^/]+)$/);
      if (delEcritMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM ecritures WHERE id = ?').bind(delEcritMatch[1]).run();
        return json({ ok: true });
      }

      // --- GENERATE VT J.C ---
      const genMatch = path.match(/^\/api\/dossiers\/([^/]+)\/generate-vtjc$/);
      if (genMatch && method === 'POST') {
        const did = genMatch[1];
        const d = await env.DB.prepare('SELECT * FROM dossiers WHERE id = ?').bind(did).first() as any;
        if (!d) return json({ error: 'Dossier non trouve' }, 404);

        const facturesR = await env.DB.prepare('SELECT * FROM factures WHERE dossier_id = ? ORDER BY date_facture, numero_facture').bind(did).all();
        if (!facturesR.results.length) return json({ error: 'Aucune facture' }, 400);

        await env.DB.prepare("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = 'VT J.C'").bind(did).run();

        const byDay: Record<string, any[]> = {};
        for (const f of facturesR.results) {
          if (!byDay[f.date_facture as string]) byDay[f.date_facture as string] = [];
          byDay[f.date_facture as string].push(f);
        }

        const anomalies: any[] = [];
        const allEntries: any[] = [];

        for (const [date, dayFactures] of Object.entries(byDay)) {
          const nums = dayFactures.map((f: any) => f.numero_facture.replace(/[^0-9]/g, '')).sort((a: string, b: string) => a.localeCompare(b));
          const numPiece = nums.length === 1 ? 'FAC N' + nums[0] + '-26' : 'FAC N' + nums.join('-') + '-26';
          const clients = [...new Set(dayFactures.map((f: any) => f.client).filter(Boolean))];
          const defaultLibelle = clients.length > 0 ? 'CLTS PASSAGERS/' + clients.join('/') : 'CLTS PASSAGERS';

          const rapportR = await env.DB.prepare('SELECT especes, cheques, tpe, bonsAchat, avoir, credit FROM rapport_modes WHERE dossier_id = ? AND date_jour = ?').bind(did, date).first() as any;
          const modes = rapportR || { especes: 0, tpe: 0, cheques: 0, bonsAchat: 0, avoir: 0, credit: 0 };

          const result = buildDayEcritures(date, dayFactures, modes, defaultLibelle);
          if (result.excluded) {
            anomalies.push(result.anomaly);
            allEntries.push({ date, numPiece, excluded: true });
            continue;
          }
          if (result.anomaly) anomalies.push(result.anomaly);

          for (const l of result.lines) {
            await env.DB.prepare('INSERT INTO ecritures (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte, sens, montant, tresorerie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, d.societe_id, 'VT J.C', date, date, numPiece, l.libelle || defaultLibelle, l.compte, l.sens, l.montant, null).run();
          }
          allEntries.push({ date, numPiece, libelle: defaultLibelle, ecart: result.ecart, lignes: result.lines });
        }

        return json({ days: allEntries.length, entries: allEntries, anomalies });
      }

      // --- PROCESS VT C (text from browser) ---
      const vtcMatch = path.match(/^\/api\/dossiers\/([^/]+)\/process-vtc$/);
      if (vtcMatch && method === 'POST') {
        const did = vtcMatch[1];
        const d = await env.DB.prepare('SELECT * FROM dossiers WHERE id = ?').bind(did).first() as any;
        if (!d) return json({ error: 'Dossier non trouve' }, 404);

        const b = await request.json() as any;
        const text = b.text as string;
        if (!text) return json({ error: 'text requis' }, 400);

        await env.DB.prepare("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = 'VT C'").bind(did).run();

        const entries = parseVTCLines(text);
        for (const e of entries) {
          await env.DB.prepare('INSERT INTO ecritures (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte, sens, montant, tresorerie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, d.societe_id, 'VT C', e.date, e.date, e.facNum || '', e.compteLibelle || e.libelle, e.compte, e.sens, e.montant, null).run();
        }

        return json({ ok: true, totalEntries: entries.length });
      }

      // --- PROCESS FISC (text from browser) ---
      const fiscMatch = path.match(/^\/api\/dossiers\/([^/]+)\/process-fisc$/);
      if (fiscMatch && method === 'POST') {
        const did = fiscMatch[1];
        const d = await env.DB.prepare('SELECT * FROM dossiers WHERE id = ?').bind(did).first() as any;
        if (!d) return json({ error: 'Dossier non trouve' }, 404);

        const b = await request.json() as any;
        const dmi = b.dmi;
        if (!dmi) return json({ error: 'dmi requis' }, 400);

        // Delete existing FISC ecritures
        await env.DB.prepare("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = 'FISC'").bind(did).run();

        // Generate FISC ecritures from DMI data
        const fiscEntries = generateFISCecritures(dmi, did, d.societe_id);
        if (fiscEntries.error) return json({ error: fiscEntries.error }, 400);

        for (const e of fiscEntries.entries) {
          await env.DB.prepare('INSERT INTO ecritures (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte, sens, montant, tresorerie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), e.dossier_id, e.societe_id, e.journal_code, e.date_operation, e.date_piece, e.numero_doc, e.libelle, e.compte, e.sens, e.montant, e.tresorerie).run();
        }

        return json({ ok: true, entriesCount: fiscEntries.entries.length });
      }

      // --- EXPORT CSV ---
      const exportMatch = path.match(/^\/api\/dossiers\/([^/]+)\/export$/);
      if (exportMatch && method === 'GET') {
        const journal = url.searchParams.get('journal');
        let rows;
        if (journal) {
          rows = await env.DB.prepare('SELECT * FROM ecritures WHERE dossier_id = ? AND journal_code = ? ORDER BY date_operation, compte').bind(exportMatch[1], journal).all();
        } else {
          rows = await env.DB.prepare('SELECT * FROM ecritures WHERE dossier_id = ? ORDER BY date_operation, journal_code, compte').bind(exportMatch[1]).all();
        }
        const header = 'N° pièce;Date pièce;Journal;Libellé;N° compte;Libellé trésorerie;Débit;Crédit';
        const lines: string[] = [];
        let totalD = 0, totalC = 0;

        for (const e of rows.results) {
          const sens = e.sens || 'D';
          const montant = e.montant as number;
          if (!e.date_operation) continue;
          if (montant === 0) continue;
          if (sens === 'D') totalD += montant; else totalC += montant;

          const fmt = (d: string) => { if (d?.includes('-')) { const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; } return d || ''; };
          lines.push([
            e.numero_doc || '', fmt(e.date_operation as string), e.journal_code || '', e.libelle || '',
            e.compte || '', e.tresorerie || '',
            e.sens === 'D' ? montant.toFixed(3) : '0.000',
            e.sens === 'C' ? montant.toFixed(3) : '0.000'
          ].join(';'));
        }

        return new Response([header, ...lines].join('\n'), {
          headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ecritures_${exportMatch[1]}.csv"`, 'Access-Control-Allow-Origin': '*' },
        });
      }

      // --- EXCLUDED (analyse) ---
      const excludedMatch = path.match(/^\/api\/dossiers\/([^/]+)\/excluded$/);
      if (excludedMatch && method === 'GET') {
        const did = excludedMatch[1];
        const facturesR = await env.DB.prepare('SELECT * FROM factures WHERE dossier_id = ? ORDER BY date_facture').bind(did).all();
        const byDay: Record<string, any[]> = {};
        for (const f of facturesR.results) {
          if (!byDay[f.date_facture as string]) byDay[f.date_facture as string] = [];
          byDay[f.date_facture as string].push(f);
        }
        const results: any[] = [];
        for (const [date, dayFactures] of Object.entries(byDay)) {
          const rapportR = await env.DB.prepare('SELECT * FROM rapport_modes WHERE dossier_id = ? AND date_jour = ?').bind(did, date).first() as any;
          const modes = rapportR || { especes: 0, tpe: 0, cheques: 0, bonsAchat: 0, avoir: 0, credit: 0 };
          const r = buildDayEcritures(date, dayFactures, modes, 'CLTS PASSAGERS');
          const ht0 = dayFactures.reduce((s: number, f: any) => s + (f.total_ht_0 || 0), 0);
          const ht19 = dayFactures.reduce((s: number, f: any) => s + (f.total_ht_19 || 0), 0);
          const tva = dayFactures.reduce((s: number, f: any) => s + (f.tva_19 || 0), 0);
          const ttc = dayFactures.reduce((s: number, f: any) => s + (f.total_ttc || 0), 0);
          const timbres = dayFactures.reduce((s: number, f: any) => s + (f.timbre || 1), 0);
          const debitSum = (modes.especes || 0) + (modes.tpe || 0) + (modes.cheques || 0) + (modes.bonsAchat || 0) + (modes.avoir || 0);
          const creditSum = tva + timbres + ht0 + ht19;
          const ecart = Math.round((debitSum - creditSum) * 1000) / 1000;
          results.push({
            date, ecart, excluded: EXCLUDED_DAYS.has(date),
            totalFactures: ttc, totalModes: (modes.especes || 0) + (modes.tpe || 0) + (modes.cheques || 0) + (modes.bonsAchat || 0) + (modes.avoir || 0) + (modes.credit || 0),
            nbFactures: dayFactures.length,
            modes: { especes: modes.especes || 0, cheques: modes.cheques || 0, tpe: modes.tpe || 0, bonsAchat: modes.bonsAchat || 0, avoir: modes.avoir || 0, credit: modes.credit || 0 },
            factures: dayFactures.map((f: any) => ({ num: f.numero_facture, client: f.client, ht0: f.total_ht_0 || 0, ht19: f.total_ht_19 || 0, tva: f.tva_19 || 0, ttc: f.total_ttc || 0 })),
            proposedEcritures: r.excluded ? [] : r.lines.map((l: any) => ({ compte: l.compte, sens: l.sens, montant: l.montant, libelle: l.libelle })),
          });
        }
        return json(results);
      }

      // --- AI VERIFY ---
      const aiMatch = path.match(/^\/api\/dossiers\/([^/]+)\/verify-ai$/);
      if (aiMatch && method === 'POST') {
        const did = aiMatch[1];
        const ecrituresR = await env.DB.prepare('SELECT * FROM ecritures WHERE dossier_id = ? AND journal_code = ? ORDER BY numero_doc, compte').bind(did, 'FISC').all();
        if (!ecrituresR.results.length) return json({ error: 'Aucune ecriture FISC' }, 400);

        const ecrituresText = ecrituresR.results.map(e =>
          `${e.numero_doc} | ${e.date_piece} | ${e.journal_code} | ${e.libelle} | ${e.compte} | ${e.tresorerie || ''} | ${e.sens}=${e.montant}`
        ).join('\n');

        const prompt = `Tu es un expert-comptable tunisien. Verifie ces ecritures FISC.

REGLES:
- Piece A: 457100 D = total_general, tous autres = CREDIT
- Piece B: 661100 D = 437300 C
- Piece C: 661200 D = 437200 C
- Piece D: 661300 D = 437400 C
- Piece E: 436710 D = TVA collectee, 436660 C = TVA deductible, 436670 C = TVA report

ECRITURES:
${ecrituresText}

JSON: {"verdict":"OK/ERREUR","score":0-100,"checks":[{"name":"detail","status":"ok/error","detail":"..."}],"summary":"..."}`;

        let aiResponse: any;
        try {
          aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
            messages: [
              { role: 'system', content: 'Reponds toujours en JSON valide.' },
              { role: 'user', content: prompt }
            ],
            max_tokens: 2000,
            temperature: 0.1,
          });
        } catch (aiErr: any) {
          return json({ error: 'Workers AI error: ' + aiErr.message }, 500);
        }

        // Handle different response formats from Workers AI
        let report;
        try {
          const raw = aiResponse?.response || aiResponse?.result?.response || aiResponse;
          if (typeof raw === 'object' && raw?.verdict) {
            report = raw;
          } else if (typeof raw === 'string') {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            report = jsonMatch ? JSON.parse(jsonMatch[0]) : { verdict: 'ATTENTION', score: 0, checks: [], summary: raw };
          } else {
            report = { verdict: 'ATTENTION', score: 0, checks: [], summary: JSON.stringify(raw) };
          }
        } catch {
          report = { verdict: 'ATTENTION', score: 0, checks: [], summary: 'Parse error' };
        }

        return json({ ok: true, report, ecrituresCount: ecrituresR.results.length });
      }

      // --- AI VERIFY TVA 19% ---
      if (path === '/api/ai/verify' && method === 'POST') {
        const b = await request.json() as any;
        const { prompt } = b;
        if (!prompt) return json({ error: 'prompt requis' }, 400);
        try {
          const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1500,
            temperature: 0.2,
          });
          const response = aiResponse?.response || aiResponse?.result?.response || JSON.stringify(aiResponse);
          return json({ ok: true, response });
        } catch (e: any) {
          return json({ error: 'AI error: ' + e.message }, 500);
        }
      }

      // --- EF AI VERIFICATION ---
      if (path === '/api/ef/verify' && method === 'POST') {
        return handleEFVerify(request, env);
      }
      if (path === '/api/ef/tab-amt' && method === 'POST') {
        return handleEFTabAmt(request, env);
      }

      // --- FIX TVA 19% ---
      const fixTvaMatch = path.match(/^\/api\/dossiers\/([^/]+)\/fix-tva$/);
      if (fixTvaMatch && method === 'POST') {
        const did = fixTvaMatch[1];
        const b = await request.json() as any;
        const { numero_doc, journal_code, expected_tva } = b;
        if (!numero_doc || !journal_code || expected_tva === undefined) return json({ error: 'numero_doc, journal_code, expected_tva requis' }, 400);

        const tvaAccount = journal_code === 'VT J.C' ? '436711' : '436710';
        const ecrituresR = await env.DB.prepare('SELECT * FROM ecritures WHERE dossier_id = ? AND numero_doc = ? AND compte = ? AND sens = ?')
          .bind(did, numero_doc, tvaAccount, 'C').all();
        if (!ecrituresR.results.length) return json({ error: 'Aucune ecriture TVA trouvee' }, 404);

        // If multiple TVA lines, update proportionally; otherwise update the single one
        const lines = ecrituresR.results as any[];
        if (lines.length === 1) {
          const oldVal = lines[0].montant;
          await env.DB.prepare('UPDATE ecritures SET montant = ? WHERE id = ?').bind(expected_tva, lines[0].id).run();
          return json({ ok: true, updated: 1, old: oldVal, new: expected_tva });
        } else {
          // Multiple TVA lines: redistribute proportionally based on HT lines
          const htAccount = journal_code === 'VT J.C' ? '707219' : '707119';
          const htLines = await env.DB.prepare('SELECT * FROM ecritures WHERE dossier_id = ? AND numero_doc = ? AND compte = ? AND sens = ?')
            .bind(did, numero_doc, htAccount, 'C').all();
          const totalHT = (htLines.results as any[]).reduce((s, l) => s + (l.montant || 0), 0);
          const batch: D1PreparedStatement[] = [];
          let distributed = 0;
          for (let i = 0; i < lines.length; i++) {
            const htLine = (htLines.results as any[])[i];
            const ratio = htLine && totalHT > 0 ? htLine.montant / totalHT : 1 / lines.length;
            const newVal = i === lines.length - 1
              ? Math.round((expected_tva - distributed) * 1000) / 1000
              : Math.round(expected_tva * ratio * 1000) / 1000;
            distributed += newVal;
            batch.push(env.DB.prepare('UPDATE ecritures SET montant = ? WHERE id = ?').bind(newVal, lines[i].id));
          }
          for (const stmt of batch) { try { await stmt.run(); } catch {} }
          return json({ ok: true, updated: lines.length, new_total: expected_tva });
        }
      }

      // ============================================================
      // BAUD — PAYROLL AUTOMATION
      // ============================================================

      // --- BAUD: SOCIETES PAIE ---
      if (path === '/api/baud/societes' && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM societes_paie ORDER BY nom').all();
        return json(r.results);
      }
      if (path === '/api/baud/societes' && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO societes_paie (id, nom, matricule_fiscal, activite, forme_juridique) VALUES (?, ?, ?, ?, ?)').bind(id, b.nom, b.matricule_fiscal || null, b.activite || null, b.forme_juridique || null).run();
        return json({ id, ...b });
      }
      const delBaudSocMatch = path.match(/^\/api\/baud\/societes\/([^/]+)$/);
      if (delBaudSocMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM societes_paie WHERE id = ?').bind(delBaudSocMatch[1]).run();
        return json({ ok: true });
      }
      if (delBaudSocMatch && method === 'PUT') {
        const b = await request.json() as any;
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [k, v] of Object.entries(b)) {
          if (['nom', 'matricule_fiscal', 'activite', 'forme_juridique', 'sage_code_dossier', 'navette_format_notes'].includes(k)) {
            fields.push(`${k} = ?`);
            values.push(v);
          }
        }
        if (fields.length === 0) return json({ error: 'Aucun champ' });
        values.push(delBaudSocMatch[1]);
        await env.DB.prepare(`UPDATE societes_paie SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...values).run();
        return await env.DB.prepare('SELECT * FROM societes_paie WHERE id = ?').bind(delBaudSocMatch[1]).first();
      }

      // --- BAUD: SALARIES ---
      const baudSalMatch = path.match(/^\/api\/baud\/societes\/([^/]+)\/salaries$/);
      if (baudSalMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM salaries_paie WHERE societe_id = ? ORDER BY matricule').bind(baudSalMatch[1]).all();
        return json(r.results);
      }
      if (baudSalMatch && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO salaries_paie (id, societe_id, matricule, nom, prenom, civilite, date_naissance, date_embauche, poste, type_contrat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, baudSalMatch[1], b.matricule, b.nom, b.prenom || null, b.civilite || null, b.date_naissance || null, b.date_embauche || null, b.poste || null, b.type_contrat || null).run();
        return json({ id, ...b });
      }
      const baudSalUpdateMatch = path.match(/^\/api\/baud\/salaries\/([^/]+)$/);
      if (baudSalUpdateMatch && method === 'PUT') {
        const b = await request.json() as any;
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [k, v] of Object.entries(b)) {
          if (['matricule', 'nom', 'prenom', 'civilite', 'date_naissance', 'date_embauche', 'poste', 'type_contrat', 'statut'].includes(k)) {
            fields.push(`${k} = ?`);
            values.push(v);
          }
        }
        if (fields.length === 0) return json({ error: 'Aucun champ' });
        values.push(baudSalUpdateMatch[1]);
        await env.DB.prepare(`UPDATE salaries_paie SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...values).run();
        return await env.DB.prepare('SELECT * FROM salaries_paie WHERE id = ?').bind(baudSalUpdateMatch[1]).first();
      }

      // --- BAUD: RUBRIQUES ---
      const baudRubMatch = path.match(/^\/api\/baud\/societes\/([^/]+)\/rubriques$/);
      if (baudRubMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM rubriques_paie WHERE societe_id = ? AND actif = 1 ORDER BY ordre, code').bind(baudRubMatch[1]).all();
        return json(r.results);
      }
      if (baudRubMatch && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT OR REPLACE INTO rubriques_paie (id, societe_id, code, libelle, type, zone, navette_aliases, valeur_defaut, ordre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, baudRubMatch[1], b.code, b.libelle, b.type || 'rubrique', b.zone || '0', b.navette_aliases || null, b.valeur_defaut || null, b.ordre || 0).run();
        return json({ id, ...b });
      }

      // --- BAUD: DOSSIERS PAIE ---
      const baudDossiersListMatch = path.match(/^\/api\/baud\/societes\/([^/]+)\/dossiers$/);
      if (baudDossiersListMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM dossiers_paie WHERE societe_id = ? ORDER BY annee DESC, mois DESC').bind(baudDossiersListMatch[1]).all();
        return json(r.results);
      }
      if (baudDossiersListMatch && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO dossiers_paie (id, societe_id, mois, annee) VALUES (?, ?, ?, ?)').bind(id, baudDossiersListMatch[1], b.mois, b.annee).run();
        return json({ id, mois: b.mois, annee: b.annee, statut: 'brouillon' });
      }
      const baudDossierGetMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)$/);
      if (baudDossierGetMatch && method === 'GET') {
        const d = await env.DB.prepare('SELECT * FROM dossiers_paie WHERE id = ?').bind(baudDossierGetMatch[1]).first();
        return d ? json(d) : json({ error: 'Non trouve' }, 404);
      }
      if (baudDossierGetMatch && method === 'DELETE') {
        const did = baudDossierGetMatch[1];
        await env.DB.prepare('DELETE FROM lignes_extraites WHERE dossier_id = ?').bind(did).run();
        await env.DB.prepare('DELETE FROM exports_paie WHERE dossier_id = ?').bind(did).run();
        await env.DB.prepare('DELETE FROM dossiers_paie WHERE id = ?').bind(did).run();
        return json({ ok: true });
      }

      // --- BAUD: UPLOAD FICHE NAVETTE (auto-extract) ---
      const baudUploadMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/upload$/);
      if (baudUploadMatch && method === 'POST') {
        const did = baudUploadMatch[1];
        try {
          const dossier = await env.DB.prepare('SELECT * FROM dossiers_paie WHERE id = ?').bind(did).first() as any;
          if (!dossier) return json({ error: 'Dossier non trouve' }, 404);
          const b = await request.json() as any;
          const { filename, lignes } = b;
          if (!filename || !Array.isArray(lignes)) return json({ error: 'filename et lignes requis' }, 400);

          // Store raw data
          await env.DB.prepare("UPDATE dossiers_paie SET fichier_navette_nom = ?, extraction_json = ?, updated_at = datetime('now') WHERE id = ?").bind(filename, JSON.stringify({ lignes }), did).run();

          // Auto-extract
          await env.DB.prepare('DELETE FROM lignes_extraites WHERE dossier_id = ?').bind(did).run();
          const correctionsR = await env.DB.prepare('SELECT * FROM corrections WHERE societe_id = ? ORDER BY hit_count DESC').bind(dossier.societe_id).all();
          const corrList = correctionsR.results as any[];

          // Pass 1: extract matricules + noms from all rows, apply corrections
          const seenMatricules = new Map<string, string>(); // matricule -> nom_prenom
          const seenRubriques = new Set<string>();
          const corrHits: string[] = [];
          const preprocessed: any[] = [];
          for (const raw of lignes) {
            try {
              const cells = Array.isArray(raw?.champs) ? raw.champs : [];
              let matricule = '';
              let nomPrenom = '';
              for (const cell of cells) {
                const trimmed = String(cell ?? '').trim();
                if (/^\d{2,6}$/.test(trimmed) && !matricule) { matricule = trimmed; continue; }
                if (trimmed.length > 3 && /[a-zA-Z]/.test(trimmed) && !nomPrenom && !matricule) { nomPrenom = trimmed; }
              }

              let rubrique_code: string | null = null;
              let zone: string | null = null;
              let valeur: number | null = null;
              const rowKey = cells.join('|');
              for (const corr of corrList) {
                try {
                  if (corr.source_pattern && rowKey.includes(corr.source_pattern)) {
                    if (corr.field === 'rubrique_code') { rubrique_code = corr.new_value; corrHits.push(corr.id); }
                    if (corr.field === 'zone') { zone = corr.new_value; corrHits.push(corr.id); }
                    if (corr.field === 'valeur') { const v = parseFloat(corr.new_value); if (!isNaN(v)) { valeur = v; corrHits.push(corr.id); } }
                  }
                  if (corr.field === 'matricule' && corr.old_value && matricule === corr.old_value) {
                    matricule = corr.new_value; corrHits.push(corr.id);
                  }
                } catch { /* skip bad correction */ }
              }
              if (matricule && !seenMatricules.has(matricule)) seenMatricules.set(matricule, nomPrenom);
              if (rubrique_code) seenRubriques.add(rubrique_code);
              preprocessed.push({ cells, matricule, nomPrenom, rubrique_code, zone, valeur, raw });
            } catch { /* skip bad row */ }
          }

          // Auto-create missing salaries
          const existingSalR = await env.DB.prepare('SELECT matricule FROM salaries_paie WHERE societe_id = ?').bind(dossier.societe_id).all();
          const existingMatricules = new Set((existingSalR.results as any[]).map(s => s.matricule));
          const newSalaryBatch: D1PreparedStatement[] = [];
          for (const [mat, nom] of seenMatricules) {
            if (!existingMatricules.has(mat)) {
              newSalaryBatch.push(env.DB.prepare('INSERT OR IGNORE INTO salaries_paie (id, societe_id, matricule, nom) VALUES (?, ?, ?, ?)').bind(genId(), dossier.societe_id, mat, nom || ''));
              existingMatricules.add(mat);
            }
          }
          if (newSalaryBatch.length) {
            for (let i = 0; i < newSalaryBatch.length; i += 50) {
              try { await env.DB.batch(newSalaryBatch.slice(i, i + 50)); } catch {}
            }
          }

          // Auto-create missing rubriques
          const existingRubR = await env.DB.prepare('SELECT code FROM rubriques_paie WHERE societe_id = ?').bind(dossier.societe_id).all();
          const existingCodes = new Set((existingRubR.results as any[]).map(r => r.code));
          const newRubBatch: D1PreparedStatement[] = [];
          for (const code of seenRubriques) {
            if (!existingCodes.has(code)) {
              newRubBatch.push(env.DB.prepare('INSERT OR IGNORE INTO rubriques_paie (id, societe_id, code, libelle, type, zone) VALUES (?, ?, ?, ?, ?, ?)').bind(genId(), dossier.societe_id, code, code, 'rubrique', '0'));
              existingCodes.add(code);
            }
          }
          if (newRubBatch.length) {
            for (let i = 0; i < newRubBatch.length; i += 50) {
              try { await env.DB.batch(newRubBatch.slice(i, i + 50)); } catch {}
            }
          }

          // Re-fetch salaries for linking
          const salariesR = await env.DB.prepare('SELECT * FROM salaries_paie WHERE societe_id = ?').bind(dossier.societe_id).all();
          const insertLigne = env.DB.prepare('INSERT INTO lignes_extraites (id, dossier_id, salary_id, matricule, nom_prenom, type_ligne, champs, rubrique_code, zone, valeur, source_feuille, source_plage, confiance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
          const batch: D1PreparedStatement[] = [];

          for (const p of preprocessed) {
            const salaryMatch = p.matricule ? (salariesR.results as any[]).find(s => s.matricule === p.matricule) : null;
            batch.push(insertLigne.bind(genId(), did, salaryMatch?.id || null, p.matricule || null, p.nomPrenom || null, 'variable', JSON.stringify(p.cells), p.rubrique_code, p.zone, p.valeur, p.raw.source_feuille || null, p.raw.source_ligne ? String(p.raw.source_ligne) : null, null));
          }

          // Batch insert (chunks of 50)
          for (let i = 0; i < batch.length; i += 50) {
            try { await env.DB.batch(batch.slice(i, i + 50)); } catch { /* skip bad chunk */ }
          }

          // Update correction hit counts
          const uniqueHits = [...new Set(corrHits)];
          for (const cid of uniqueHits) {
            try { await env.DB.prepare('UPDATE corrections SET hit_count = hit_count + 1 WHERE id = ?').bind(cid).run(); } catch {}
          }

          await env.DB.prepare("UPDATE dossiers_paie SET statut = 'controle', extraction_confiance = 1, updated_at = datetime('now') WHERE id = ?").bind(did).run();
          return json({ ok: true, fichier_nom: filename, lignes_count: batch.length, corrections_applied: uniqueHits.length });
        } catch (e: any) {
          return json({ error: 'Upload echoue: ' + (e.message || e) }, 500);
        }
      }

      // --- BAUD: EXTRACT — stores raw uploaded rows as lignes ---
      const baudExtractMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/extract$/);
      if (baudExtractMatch && method === 'POST') {
        const did = baudExtractMatch[1];
        try {
          const dossier = await env.DB.prepare('SELECT * FROM dossiers_paie WHERE id = ?').bind(did).first() as any;
          if (!dossier) return json({ error: 'Dossier non trouve' }, 404);
          const extractionJson = dossier.extraction_json ? JSON.parse(dossier.extraction_json) : null;
          if (!extractionJson?.lignes) return json({ error: 'Upload d\'abord' }, 400);

          await env.DB.prepare('DELETE FROM lignes_extraites WHERE dossier_id = ?').bind(did).run();
          const rawLignes = extractionJson.lignes as any[];
          const salariesR = await env.DB.prepare('SELECT * FROM salaries_paie WHERE societe_id = ?').bind(dossier.societe_id).all();
          const correctionsR = await env.DB.prepare('SELECT * FROM corrections WHERE societe_id = ? ORDER BY hit_count DESC').bind(dossier.societe_id).all();
          const corrList = correctionsR.results as any[];
          const insertLigne = env.DB.prepare('INSERT INTO lignes_extraites (id, dossier_id, salary_id, matricule, nom_prenom, type_ligne, champs, rubrique_code, zone, valeur, source_feuille, source_plage, confiance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
          const batch: D1PreparedStatement[] = [];
          const corrHits: string[] = [];

          for (const raw of rawLignes) {
            try {
              const cells = Array.isArray(raw?.champs) ? raw.champs : [];
              let matricule = '';
              let nomPrenom = '';
              for (const cell of cells) {
                const trimmed = String(cell ?? '').trim();
                if (/^\d{2,6}$/.test(trimmed) && !matricule) { matricule = trimmed; continue; }
                if (trimmed.length > 3 && /[a-zA-Z]/.test(trimmed) && !nomPrenom && !matricule) { nomPrenom = trimmed; }
              }

              let rubrique_code: string | null = null;
              let zone: string | null = null;
              let valeur: number | null = null;
              const rowKey = cells.join('|');
              for (const corr of corrList) {
                try {
                  if (corr.source_pattern && rowKey.includes(corr.source_pattern)) {
                    if (corr.field === 'rubrique_code') { rubrique_code = corr.new_value; corrHits.push(corr.id); }
                    if (corr.field === 'zone') { zone = corr.new_value; corrHits.push(corr.id); }
                    if (corr.field === 'valeur') { const v = parseFloat(corr.new_value); if (!isNaN(v)) { valeur = v; corrHits.push(corr.id); } }
                  }
                  if (corr.field === 'matricule' && corr.old_value && matricule === corr.old_value) {
                    matricule = corr.new_value; corrHits.push(corr.id);
                  }
                } catch {}
              }

              const salaryMatch = matricule ? (salariesR.results as any[]).find(s => s.matricule === matricule) : null;
              batch.push(insertLigne.bind(genId(), did, salaryMatch?.id || null, matricule || null, nomPrenom || null, 'variable', JSON.stringify(cells), rubrique_code, zone, valeur, raw.source_feuille || null, raw.source_ligne ? String(raw.source_ligne) : null, null));
            } catch {}
          }

          for (let i = 0; i < batch.length; i += 50) {
            try { await env.DB.batch(batch.slice(i, i + 50)); } catch {}
          }

          const uniqueHits = [...new Set(corrHits)];
          for (const cid of uniqueHits) {
            try { await env.DB.prepare('UPDATE corrections SET hit_count = hit_count + 1 WHERE id = ?').bind(cid).run(); } catch {}
          }

          await env.DB.prepare("UPDATE dossiers_paie SET statut = 'controle', extraction_confiance = 1, updated_at = datetime('now') WHERE id = ?").bind(did).run();
          return json({ ok: true, lignes_count: batch.length, corrections_applied: uniqueHits.length });
        } catch (e: any) {
          return json({ error: 'Extract echoue: ' + (e.message || e) }, 500);
        }
      }

      // --- BAUD: PARSED DATA (store employees + pointage from intelligent parser) ---
      const baudParsedMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/parsed$/);
      if (baudParsedMatch && method === 'POST') {
        const did = baudParsedMatch[1];
        try {
          const b = await request.json() as any;
          await env.DB.prepare("UPDATE dossiers_paie SET extraction_json = ?, updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(b), did).run();
          return json({ ok: true });
        } catch (e: any) {
          return json({ error: 'Erreur: ' + (e.message || e) }, 500);
        }
      }

      // --- BAUD: AI VERIFICATION ---
      const baudAiMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/verify-ai$/);
      if (baudAiMatch && method === 'POST') {
        const did = baudAiMatch[1];
        try {
          const dossier = await env.DB.prepare('SELECT * FROM dossiers_paie WHERE id = ?').bind(did).first() as any;
          if (!dossier) return json({ error: 'Dossier non trouve' }, 404);

          const b = await request.json() as any;
          const { employees, pointage, salaryResults } = b;

          // Build summary for AI
          const empSummary = employees.map((emp: any) => {
            const r = salaryResults?.[emp.matricule];
            return `${emp.matricule} ${emp.nom} ${emp.prenom} | SF:${emp.situation_fam} NE:${emp.nombre_enfants} | Brut:${emp.salaire_brut} NouvBrut:${emp.nouveau_salaire_brut} | ${emp.type_contrat} ${emp.fonction} | CNSS:${r?.cnss_salariale||0} IRPP:${r?.irpp||0} Net:${r?.net_a_payer||0}`;
          }).join('\n');

          const ptgSummary = pointage?.map((p: any) => `${p.matricule} ${p.nom}: Abs=${p.absences} Av=${p.avances} CP=${p.conges_payes} HS=${p.heures_supplementaires}`).join('\n') || 'Aucun pointage';

          const prompt = `Tu es un expert comptable specialise en paie tunisienne. Verifie cette liste de salaries pour le mois ${dossier.mois}/${dossier.annee}.

SALARIES (${employees.length}):
${empSummary}

POINTAGE:
${ptgSummary}

VERIFICATIONS REQUISES:
1. Tous les salaries sont-ils calcules? (Y a-t-il des manquants?)
2. Les calculs CNSS (9.68%), IRPP (bareme 8 tranches), CSS (0.5%) sont-ils corrects?
3. Y a-t-il des salaries avec Brut different du mois precedent (nouveau_salaire_brut vs salaire_brut)?
4. Les situations familiales et nombre d'enfants semblent-ils coherents?
5. Y a-t-il des anomalies (salaire tres bas/eleve, absences excessives, etc.)?

Reponds en JSON:
{
  "ok": boolean,
  "verdict": "OK" | "ATTENTION" | "ERREUR",
  "checks": [
    { "name": "string", "status": "ok" | "warning" | "error", "detail": "string" }
  ],
  "missing": ["matricule des salaries non calcules"],
  "changes": ["modifications detectees par rapport au mois precedent"],
  "anomalies": ["anomalies detectees"]
}`;

          const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1024,
          });

          const responseText = (aiResponse as any)?.response || '';
          let result;
          try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            result = jsonMatch ? JSON.parse(jsonMatch[0]) : { ok: false, verdict: 'ERREUR', checks: [], error: 'Reponse IA non parseable' };
          } catch {
            result = { ok: false, verdict: 'ERREUR', checks: [], error: 'Erreur parsing IA', raw: responseText };
          }

          return json(result);
        } catch (e: any) {
          return json({ error: 'Verification IA echouee: ' + (e.message || e) }, 500);
        }
      }

      // --- BAUD: LIGNES ---
      const baudLignesMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/lignes$/);
      if (baudLignesMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM lignes_extraites WHERE dossier_id = ? ORDER BY created_at').bind(baudLignesMatch[1]).all();
        return json(r.results);
      }
      const baudLigneUpdateMatch = path.match(/^\/api\/baud\/lignes\/([^/]+)$/);
      if (baudLigneUpdateMatch && method === 'PUT') {
        const ligneId = baudLigneUpdateMatch[1];
        const oldLigne = await env.DB.prepare('SELECT * FROM lignes_extraites WHERE id = ?').bind(ligneId).first() as any;
        if (!oldLigne) return json({ error: 'Ligne non trouvee' }, 404);

        const b = await request.json() as any;
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [k, v] of Object.entries(b)) {
          if (['statut', 'matricule', 'rubrique_code', 'zone', 'valeur', 'champs'].includes(k)) {
            fields.push(`${k} = ?`);
            values.push(k === 'champs' ? JSON.stringify(v) : v);
          }
        }
        if (fields.length === 0) return json({ error: 'Aucun champ' });
        values.push(ligneId);
        await env.DB.prepare(`UPDATE lignes_extraites SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

        // Store corrections for AI learning
        const learnFields = ['matricule', 'rubrique_code', 'zone', 'valeur'];
        const dossier = await env.DB.prepare('SELECT societe_id FROM dossiers_paie WHERE id = ?').bind(oldLigne.dossier_id).first() as any;
        if (dossier) {
          for (const f of learnFields) {
            if (b[f] !== undefined && b[f] !== oldLigne[f] && b[f] !== '' && b[f] !== null) {
              const oldVal = String(oldLigne[f] || '');
              const newVal = String(b[f]);
              const cells = JSON.parse(oldLigne.champs || '[]');
              const sourcePattern = cells.length > 2 ? cells.slice(0, 3).join('|') : null;
              await env.DB.prepare('INSERT INTO corrections (id, societe_id, field, old_value, new_value, source_pattern) VALUES (?, ?, ?, ?, ?, ?)').bind(genId(), dossier.societe_id, f, oldVal, newVal, sourcePattern).run();
            }
          }
        }

        return await env.DB.prepare('SELECT * FROM lignes_extraites WHERE id = ?').bind(ligneId).first();
      }

      // --- BAUD: VALIDER ---
      const baudValiderMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/valider$/);
      if (baudValiderMatch && method === 'POST') {
        await env.DB.prepare("UPDATE dossiers_paie SET statut = 'valide', updated_at = datetime('now') WHERE id = ?").bind(baudValiderMatch[1]).run();
        return json({ ok: true });
      }

      // --- BAUD: CORRECTIONS (AI learning) ---
      const baudCorrMatch = path.match(/^\/api\/baud\/societes\/([^/]+)\/corrections$/);
      if (baudCorrMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM corrections WHERE societe_id = ? ORDER BY hit_count DESC').bind(baudCorrMatch[1]).all();
        return json(r.results);
      }
      const baudCorrDelMatch = path.match(/^\/api\/baud\/corrections\/([^/]+)$/);
      if (baudCorrDelMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM corrections WHERE id = ?').bind(baudCorrDelMatch[1]).run();
        return json({ ok: true });
      }

      // --- BAUD: EXPORT GA (generate XLSX as base64) ---
      const baudExportMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/export$/);
      if (baudExportMatch && method === 'POST') {
        const did = baudExportMatch[1];
        const dossier = await env.DB.prepare('SELECT * FROM dossiers_paie WHERE id = ?').bind(did).first() as any;
        if (!dossier) return json({ error: 'Dossier non trouve' }, 404);

        const lignesR = await env.DB.prepare('SELECT * FROM lignes_extraites WHERE dossier_id = ? AND statut != ? ORDER BY matricule, rubrique_code').bind(did, 'ignore').all();
        if (!lignesR.results.length) return json({ error: 'Aucune ligne valide' }, 400);

        const salariesR = await env.DB.prepare('SELECT * FROM salaries_paie WHERE societe_id = ?').bind(dossier.societe_id).all();
        const rubriquesR = await env.DB.prepare('SELECT * FROM rubriques_paie WHERE societe_id = ? AND actif = 1').bind(dossier.societe_id).all();
        const rubMap: Record<string, any> = {};
        for (const r of rubriquesR.results) rubMap[r.code as string] = r;

        // Build Import Salariés rows
        const salRows: any[][] = [['Matricule', 'Nom', 'Prénom', 'Civilité', 'Date de naissance', 'Date d\'embauche', 'Poste', 'Type de contrat']];
        const seen = new Set<string>();
        for (const l of lignesR.results) {
          const mat = l.matricule as string;
          if (!mat || seen.has(mat)) continue;
          seen.add(mat);
          const sal = (salariesR.results as any[]).find(s => s.matricule === mat);
          salRows.push([
            mat, sal?.nom || '', sal?.prenom || '', sal?.civilite || '',
            sal?.date_naissance || '', sal?.date_embauche || '', sal?.poste || '', sal?.type_contrat || ''
          ]);
        }

        // Build Import Variables rows
        const varRows: any[][] = [['Matricule', 'Rubrique ou Constante', 'Zone', 'Valeur']];
        for (const l of lignesR.results) {
          const rub = rubMap[l.rubrique_code as string];
          const zone = l.zone || rub?.zone || '0';
          varRows.push([l.matricule || '', l.rubrique_code || '', String(zone), l.valeur != null ? String(l.valeur) : '']);
        }

        // Generate XLSX as base64 using dynamic import
        let salB64 = '', varB64 = '';
        try {
          const XLSXMod = await import('xlsx');
          const XLSX = XLSXMod.default || XLSXMod;

          const salWb = XLSX.utils.book_new();
          const salWs = XLSX.utils.aoa_to_sheet(salRows);
          XLSX.utils.book_append_sheet(salWb, salWs, 'Salariés');
          salB64 = XLSX.write(salWb, { type: 'base64', bookType: 'xlsx' });

          const varWb = XLSX.utils.book_new();
          const varWs = XLSX.utils.aoa_to_sheet(varRows);
          XLSX.utils.book_append_sheet(varWb, varWs, 'Variables');
          varB64 = XLSX.write(varWb, { type: 'base64', bookType: 'xlsx' });
        } catch {
          return json({ error: 'xlsx non disponible' }, 500);
        }

        const moisStr = String(dossier.mois).padStart(2, '0');
        const annStr = String(dossier.annee).slice(-2);
        const salName = `ImportSalariés_${moisStr}-${annStr}.xlsx`;
        const varName = `ImportVariables_${moisStr}-${annStr}.xlsx`;

        // Store exports
        const salId = genId(), varId = genId();
        await env.DB.prepare('INSERT INTO imports_ga (id, dossier_id, type_import, fichier_nom, fichier_base64, nb_lignes) VALUES (?, ?, ?, ?, ?, ?)').bind(salId, did, 'salaries', salName, salB64, salRows.length - 1).run();
        await env.DB.prepare('INSERT INTO imports_ga (id, dossier_id, type_import, fichier_nom, fichier_base64, nb_lignes) VALUES (?, ?, ?, ?, ?, ?)').bind(varId, did, 'variables', varName, varB64, varRows.length - 1).run();

        return json({ ok: true, exports: [
          { id: salId, type: 'salaries', fichier_nom: salName, nb_lignes: salRows.length - 1 },
          { id: varId, type: 'variables', fichier_nom: varName, nb_lignes: varRows.length - 1 },
        ]});
      }

      // --- BAUD: LIST EXPORTS ---
      const baudExportsListMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/exports$/);
      if (baudExportsListMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT id, type_import, fichier_nom, nb_lignes, statut, created_at FROM imports_ga WHERE dossier_id = ? ORDER BY created_at').bind(baudExportsListMatch[1]).all();
        return json(r.results);
      }

      // --- BAUD: DOWNLOAD EXPORT ---
      const baudDownloadMatch = path.match(/^\/api\/baud\/exports\/([^/]+)\/download$/);
      if (baudDownloadMatch && method === 'GET') {
        const exp = await env.DB.prepare('SELECT * FROM imports_ga WHERE id = ?').bind(baudDownloadMatch[1]).first() as any;
        if (!exp) return json({ error: 'Export non trouve' }, 404);
        const b64 = exp.fichier_base64 as string;
        const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return new Response(bin, {
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${exp.fichier_nom}"`,
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // ============================================================
      // SCANFLASH — SCANNED INVOICE JOURNALS
      // ============================================================

      // --- SCANFLASH: SOCIETES ---
      if (path === '/api/scan/societes' && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM societes_scan ORDER BY raison_sociale').all();
        return json(r.results);
      }
      if (path === '/api/scan/societes' && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO societes_scan (id, raison_sociale, matricule_fiscal) VALUES (?, ?, ?)').bind(id, b.raison_sociale, b.matricule_fiscal || null).run();
        return json({ id, ...b });
      }
      const delScanSocMatch = path.match(/^\/api\/scan\/societes\/([^/]+)$/);
      if (delScanSocMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM societes_scan WHERE id = ?').bind(delScanSocMatch[1]).run();
        return json({ ok: true });
      }

      // --- SCANFLASH: DOSSIERS ---
      const scanDossiersListMatch = path.match(/^\/api\/scan\/societes\/([^/]+)\/dossiers$/);
      if (scanDossiersListMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM dossiers_scan WHERE societe_id = ? ORDER BY created_at DESC').bind(scanDossiersListMatch[1]).all();
        return json(r.results);
      }
      if (scanDossiersListMatch && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO dossiers_scan (id, societe_id, nom, mois, annee) VALUES (?, ?, ?, ?, ?)').bind(id, scanDossiersListMatch[1], b.nom || `SCAN ${b.mois}/${b.annee}`, b.mois, b.annee).run();
        return json({ id, nom: b.nom || `SCAN ${b.mois}/${b.annee}`, mois: b.mois, annee: b.annee, statut: 'brouillon' });
      }
      const scanDossierGetMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)$/);
      if (scanDossierGetMatch && method === 'GET') {
        const d = await env.DB.prepare('SELECT * FROM dossiers_scan WHERE id = ?').bind(scanDossierGetMatch[1]).first();
        return d ? json(d) : json({ error: 'Non trouve' }, 404);
      }
      if (scanDossierGetMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM factures_scan WHERE dossier_id = ?').bind(scanDossierGetMatch[1]).run();
        await env.DB.prepare('DELETE FROM ecritures_scan WHERE dossier_id = ?').bind(scanDossierGetMatch[1]).run();
        await env.DB.prepare('DELETE FROM dossiers_scan WHERE id = ?').bind(scanDossierGetMatch[1]).run();
        return json({ ok: true });
      }

      // --- SCANFLASH: FACTURES ---
      const scanFacturesMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/factures$/);
      if (scanFacturesMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM factures_scan WHERE dossier_id = ? ORDER BY date_facture, numero').bind(scanFacturesMatch[1]).all();
        return json(r.results);
      }
      if (scanFacturesMatch && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO factures_scan (id, dossier_id, numero, date_facture, client, code_client, compte_client, is_avoir, total_ht_0, total_ht_19, tva_19, fodec, timbre, total_ttc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, scanFacturesMatch[1], b.numero, b.date_facture, b.client, b.code_client || null, b.compte_client, b.is_avoir ? 1 : 0, b.total_ht_0 || 0, b.total_ht_19 || 0, b.tva_19 || 0, b.fodec || 0, b.timbre || 0, b.total_ttc || 0).run();
        return json({ id, ...b });
      }
      if (scanFacturesMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM factures_scan WHERE dossier_id = ?').bind(scanFacturesMatch[1]).run();
        return json({ ok: true });
      }

      // --- SCANFLASH: ECRITURES ---
      const scanEcrituresMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/ecritures$/);
      if (scanEcrituresMatch && method === 'GET') {
        const journal = new URL(url).searchParams.get('journal');
        let sql = 'SELECT * FROM ecritures_scan WHERE dossier_id = ?';
        const params: any[] = [scanEcrituresMatch[1]];
        if (journal) { sql += ' AND journal_code = ?'; params.push(journal); }
        sql += ' ORDER BY page, date_operation, numero_doc, compte';
        const r = await env.DB.prepare(sql).bind(...params).all();
        return json(r.results);
      }
      if (scanEcrituresMatch && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant, page) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, scanEcrituresMatch[1], b.numero_doc, b.date_operation, b.journal_code || 'VT', b.compte, b.libelle || null, b.sens, b.montant, b.page || null).run();
        return json({ id, ...b });
      }
      if (scanEcrituresMatch && method === 'DELETE') {
        const journal = new URL(url).searchParams.get('journal');
        let sql = 'DELETE FROM ecritures_scan WHERE dossier_id = ?';
        const params: any[] = [scanEcrituresMatch[1]];
        if (journal) { sql += ' AND journal_code = ?'; params.push(journal); }
        await env.DB.prepare(sql).bind(...params).run();
        return json({ ok: true });
      }
      const delScanEcrMatch = path.match(/^\/api\/scan\/ecritures\/([^/]+)$/);
      if (delScanEcrMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM ecritures_scan WHERE id = ?').bind(delScanEcrMatch[1]).run();
        return json({ ok: true });
      }

      // --- SCANFLASH: GENERATE VT from factures ---
      const scanGenerateMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/generate$/);
      if (scanGenerateMatch && method === 'POST') {
        const did = scanGenerateMatch[1];
        const dossier = await env.DB.prepare('SELECT * FROM dossiers_scan WHERE id = ?').bind(did).first() as any;
        if (!dossier) return json({ error: 'Dossier non trouve' }, 404);

        // Clear existing ecritures for this dossier
        await env.DB.prepare('DELETE FROM ecritures_scan WHERE dossier_id = ?').bind(did).run();

        const factures = await env.DB.prepare('SELECT * FROM factures_scan WHERE dossier_id = ? ORDER BY date_facture, numero').bind(did).all();
        const batch: D1PreparedStatement[] = [];
        let ecount = 0;

        for (const f of factures.results as any[]) {
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
          const ttc = ht0 + ht19 + tva + fodec + timbre;

          if (isAvoir) {
            // AVR: Client CREDIT, Sales/TVa/FODEC DEBIT (inverse of FAC)
            if (ttc > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', compteClient, lib, 'C', Math.round(ttc * 1000) / 1000));
              ecount++;
            }
            if (ht19 > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '707000', lib, 'D', Math.round(ht19 * 1000) / 1000));
              ecount++;
            }
            if (ht0 > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '707003', lib, 'D', Math.round(ht0 * 1000) / 1000));
              ecount++;
            }
            if (tva > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '436719', lib, 'D', Math.round(tva * 1000) / 1000));
              ecount++;
            }
            if (fodec > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '436780', lib, 'D', Math.round(fodec * 1000) / 1000));
              ecount++;
            }
          } else {
            // FAC: Client DEBIT, Sales/TVa/FODEC/Timbre CREDIT
            if (ttc > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', compteClient, lib, 'D', Math.round(ttc * 1000) / 1000));
              ecount++;
            }
            if (ht19 > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '707000', lib, 'C', Math.round(ht19 * 1000) / 1000));
              ecount++;
            }
            if (ht0 > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '707003', lib, 'C', Math.round(ht0 * 1000) / 1000));
              ecount++;
            }
            if (tva > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '436719', lib, 'C', Math.round(tva * 1000) / 1000));
              ecount++;
            }
            if (fodec > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '436780', lib, 'C', Math.round(fodec * 1000) / 1000));
              ecount++;
            }
            if (timbre > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '437600', lib, 'C', Math.round(timbre * 1000) / 1000));
              ecount++;
            }
          }
        }

        // Batch insert
        for (let i = 0; i < batch.length; i += 50) {
          await env.DB.batch(batch.slice(i, i + 50));
        }

        // Update dossier count
        await env.DB.prepare('UPDATE dossiers_scan SET nb_pieces = ?, nb_ecritures = ?, statut = ? WHERE id = ?').bind((factures.results as any[]).length, ecount, 'traite', did).run();

        return json({ ok: true, factures: (factures.results as any[]).length, ecritures: ecount });
      }

      // --- SCANFLASH: EXPORT CSV ---
      const scanExportMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/export$/);
      if (scanExportMatch && method === 'GET') {
        const did = scanExportMatch[1];
        const journal = new URL(url).searchParams.get('journal');
        let sql = 'SELECT * FROM ecritures_scan WHERE dossier_id = ?';
        const params: any[] = [did];
        if (journal) { sql += ' AND journal_code = ?'; params.push(journal); }
        sql += ' ORDER BY page, date_operation, numero_doc, compte';
        const r = await env.DB.prepare(sql).bind(...params).all();
        const lines: string[] = [];
        for (const e of r.results as any[]) {
          const date = e.date_operation; // YYYY-MM-DD
          const [y, m, d] = date.split('-');
          const dateFormatted = `${d}/${m}/${y}`;
          const montant = Math.round((e.montant || 0) * 1000) / 1000;
          const debit = e.sens === 'D' ? montant.toFixed(3) : '0.000';
          const credit = e.sens === 'C' ? montant.toFixed(3) : '0.000';
          lines.push(`${e.numero_doc || ''}\t${dateFormatted}\t${e.journal_code || 'VT'}\t${e.libelle || ''}\t${e.compte}\t\t${debit}\t${credit}`);
        }
        return new Response(lines.join('\n'), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="scan_export_${did}.csv"`,
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // --- SCANFLASH: EXPORT XLSX (Axeane template) ---
      const scanExportXlsxMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/export-xlsx$/);
      if (scanExportXlsxMatch && method === 'GET') {
        const did = scanExportXlsxMatch[1];
        const r = await env.DB.prepare('SELECT * FROM ecritures_scan WHERE dossier_id = ? ORDER BY page, date_operation, numero_doc, compte').bind(did).all();

        const XLSXMod = await import('xlsx');
        const XLSX = XLSXMod.default || XLSXMod;

        const header = ['N° pièce comptable', 'Date pièce comptable', 'Journal', 'Libellé', 'N° compte', 'Libellé trésorerie', 'Débit', 'Crédit'];
        const rows: any[][] = [header];

        for (const e of r.results as any[]) {
          const date = e.date_operation;
          const [y, m, d] = date.split('-');
          const dateFormatted = `${d}/${m}/${y}`;
          const montant = Math.round((e.montant || 0) * 1000) / 1000;
          const debit = e.sens === 'D' ? montant : 0;
          const credit = e.sens === 'C' ? montant : 0;
          rows.push([e.numero_doc || '', dateFormatted, e.journal_code || 'VT', e.libelle || '', e.compte, '', debit, credit]);
        }

        const ws = XLSX.utils.aoa_to_sheet(rows);

        // Style headers: Arial Bold, centered
        const headerStyle = { font: { name: 'Arial', bold: true }, alignment: { horizontal: 'center' } };
        if (!ws['!cols']) ws['!cols'] = [];
        ws['!cols'] = [
          { wch: 30 }, // N° pièce
          { wch: 27 }, // Date
          { wch: 10 }, // Journal
          { wch: 40 }, // Libellé
          { wch: 12 }, // N° compte
          { wch: 28 }, // Libellé trésorerie
          { wch: 15 }, // Débit
          { wch: 15 }, // Crédit
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Ecritures');
        const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

        return new Response(Uint8Array.from(atob(b64), c => c.charCodeAt(0)), {
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="scan_ecritures_${did}.xlsx"`,
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // --- SCANFLASH: AUTO-CLEANUP after export ---
      const scanCleanupMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/cleanup$/);
      if (scanCleanupMatch && method === 'POST') {
        const did = scanCleanupMatch[1];
        await env.DB.prepare('DELETE FROM ecritures_scan WHERE dossier_id = ?').bind(did).run();
        await env.DB.prepare('DELETE FROM factures_scan WHERE dossier_id = ?').bind(did).run();
        return json({ ok: true });
      }

      // --- SCANFLASH: VERIFY TVA 19% ---
      const scanVerifyMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/verify-ai$/);
      if (scanVerifyMatch && method === 'POST') {
        const did = scanVerifyMatch[1];
        const factures = await env.DB.prepare('SELECT * FROM factures_scan WHERE dossier_id = ? ORDER BY date_facture, numero').bind(did).all();
        if (!factures.results.length) return json({ error: 'Aucune facture' }, 400);

        const checks: any[] = [];
        let errors = 0;
        let totalHT = 0, totalTVA = 0, totalFODEC = 0, totalTimbre = 0, totalTTC = 0;

        for (const f of factures.results as any[]) {
          const ht19 = f.total_ht_19 || 0;
          const tvaExpected = Math.round(ht19 * 19) / 100;
          const tvaActual = f.tva_19 || 0;
          const tvaDiff = Math.abs(tvaActual - tvaExpected);
          const fodecExpected = Math.round(ht19 * 1) / 100;
          const fodecActual = f.fodec || 0;
          const fodecDiff = Math.abs(fodecActual - fodecExpected);
          const ttcComputed = (f.total_ht_0 || 0) + ht19 + tvaActual + fodecActual + (f.timbre || 0);
          const ttcDiff = Math.abs(f.total_ttc || 0) - ttcComputed;

          totalHT += (f.total_ht_0 || 0) + ht19;
          totalTVA += tvaActual;
          totalFODEC += fodecActual;
          totalTimbre += f.timbre || 0;
          totalTTC += f.total_ttc || 0;

          const pieceChecks: any[] = [];
          if (tvaDiff > 0.01) {
            pieceChecks.push({ name: 'TVA', status: 'error', detail: `TVA ${tvaActual} ≠ HT×19% = ${tvaExpected} (ecart ${tvaDiff.toFixed(3)})`, expected: tvaExpected, actual: tvaActual });
            errors++;
          } else {
            pieceChecks.push({ name: 'TVA', status: 'ok', detail: `TVA ${tvaActual} = HT×19% = ${tvaExpected}` });
          }
          if (fodecDiff > 0.01) {
            pieceChecks.push({ name: 'FODEC', status: 'error', detail: `FODEC ${fodecActual} ≠ HT×1% = ${fodecExpected} (ecart ${fodecDiff.toFixed(3)})`, expected: fodecExpected, actual: fodecActual });
            errors++;
          } else {
            pieceChecks.push({ name: 'FODEC', status: 'ok', detail: `FODEC ${fodecActual} = HT×1% = ${fodecExpected}` });
          }
          if (Math.abs(ttcDiff) > 0.01) {
            pieceChecks.push({ name: 'TTC', status: 'error', detail: `TTC declare ${f.total_ttc} ≠ calcule ${ttcComputed} (ecart ${ttcDiff.toFixed(3)})`, expected: ttcComputed, actual: f.total_ttc });
            errors++;
          } else {
            pieceChecks.push({ name: 'TTC', status: 'ok', detail: `TTC ${f.total_ttc} = somme lignes` });
          }
          checks.push({ piece: f.numero, type: f.is_avoir ? 'AVR' : 'FAC', client: f.client, checks: pieceChecks });
        }

        // Build prompt for AI
        const facturesText = (factures.results as any[]).map(f => {
          const ht19 = f.total_ht_19 || 0;
          const tvaExpected = Math.round(ht19 * 19) / 100;
          return `${f.numero} ${f.is_avoir ? 'AVR' : 'FAC'} ${f.client}: HT19=${ht19} TVA=${f.tva_19} (expected=${tvaExpected}) FODEC=${f.fodec} Timbre=${f.timbre} TTC=${f.total_ttc}`;
        }).join('\n');

        const prompt = `Tu es un expert-comptable tunisien. Verifie ces factures SCANFLASH.

REGLES:
- TVA 19% = HT × 19%
- FODEC 1% = HT × 1%
- Timbre fiscal = 1.000 DT (fixe, toujours present sur FAC)
- TTC = HT + TVA + FODEC + Timbre
- FAC: client DOIT (D), ventes/tva/fodec/timbre = CREDIT
- AVR: client CREDITE (C), ventes/tva/fodec/timbre = DEBIT

FACTURES:
${facturesText}

TOTAL: HT=${totalHT.toFixed(3)} TVA=${totalTVA.toFixed(3)} FODEC=${totalFODEC.toFixed(3)} Timbre=${totalTimbre.toFixed(3)} TTC=${totalTTC.toFixed(3)}

JSON: {"verdict":"OK/ERREUR","score":0-100,"checks":[{"piece":"...","type":"FAC/AVR","status":"ok/error","detail":"..."}],"summary":"..."}`;

        let aiReport: any;
        try {
          const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
            messages: [
              { role: 'system', content: 'Reponds toujours en JSON valide.' },
              { role: 'user', content: prompt }
            ],
            max_tokens: 2000,
            temperature: 0.1,
          });
          const raw = aiResponse?.response || aiResponse?.result?.response || aiResponse;
          if (typeof raw === 'string') {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            aiReport = jsonMatch ? JSON.parse(jsonMatch[0]) : { verdict: errors > 0 ? 'ERREUR' : 'OK', summary: raw };
          } else {
            aiReport = raw;
          }
        } catch (aiErr: any) {
          aiReport = { verdict: errors > 0 ? 'ERREUR' : 'OK', summary: 'AI error: ' + aiErr.message };
        }

        return json({
          ok: true,
          verdict: errors > 0 ? 'ERREUR' : 'OK',
          errors,
          totalFactures: factures.results.length,
          totals: { ht: totalHT, tva: totalTVA, fodec: totalFODEC, timbre: totalTimbre, ttc: totalTTC },
          checks,
          ai: aiReport,
        });
      }

      // --- SCANFLASH: FIX TVA ---
      const scanFixTvaMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/fix-tva$/);
      if (scanFixTvaMatch && method === 'POST') {
        const did = scanFixTvaMatch[1];
        const factures = await env.DB.prepare('SELECT * FROM factures_scan WHERE dossier_id = ? ORDER BY date_facture, numero').bind(did).all();
        if (!factures.results.length) return json({ error: 'Aucune facture' }, 400);

        let fixed = 0;
        const batch: D1PreparedStatement[] = [];

        for (const f of factures.results as any[]) {
          const ht19 = f.total_ht_19 || 0;
          const tvaExpected = Math.round(ht19 * 19) / 100;
          const tvaActual = f.tva_19 || 0;
          if (Math.abs(tvaActual - tvaExpected) > 0.01) {
            const diff = tvaExpected - tvaActual;
            const newTTC = (f.total_ttc || 0) + diff;
            batch.push(env.DB.prepare('UPDATE factures_scan SET tva_19 = ?, total_ttc = ? WHERE id = ?').bind(tvaExpected, newTTC, f.id));
            fixed++;
          }
        }

        if (batch.length > 0) {
          for (let i = 0; i < batch.length; i += 50) {
            await env.DB.batch(batch.slice(i, i + 50));
          }
        }

        // Also update ecritures: find 436719 lines and fix amounts
        const ecritures = await env.DB.prepare('SELECT * FROM ecritures_scan WHERE dossier_id = ? AND compte = ?').bind(did, '436719').all();
        const ecrBatch: D1PreparedStatement[] = [];
        for (const e of ecritures.results as any[]) {
          // Find the matching facture
          const fac = (factures.results as any[]).find(f => f.numero === e.numero_doc);
          if (fac) {
            const newTVA = Math.round((fac.total_ht_19 || 0) * 19) / 100;
            if (Math.abs(e.montant - newTVA) > 0.01) {
              ecrBatch.push(env.DB.prepare('UPDATE ecritures_scan SET montant = ? WHERE id = ?').bind(newTVA, e.id));
            }
          }
        }
        if (ecrBatch.length > 0) {
          for (let i = 0; i < ecrBatch.length; i += 50) {
            await env.DB.batch(ecrBatch.slice(i, i + 50));
          }
        }

        return json({ ok: true, fixed, ecrituresFixed: ecrBatch.length });
      }

      return json({ error: 'Not found: ' + path }, 404);
    } catch (e: any) {
      return json({ error: e.message || 'Internal error' }, 500);
    }
  },
};

// --- FISC ECRITURES GENERATOR ---
function generateFISCecritures(dmi: any, dossierId: string, societeId: string) {
  const { retenue_salaires, css, retenue_loyers, retenue_marches, tfp_du, foprolos_du, timbre_fiscal, tcl_du, total_general, tva_collectee, tva_deductible, tva_report_precedent, tva_resultat, tva_signe, mois, annee } = dmi;

  if (!total_general || total_general <= 0) return { error: 'total_general invalide' };

  const formatDate = (m: number, y: number) => `${y}-${String(m).padStart(2, '0')}-21`;
  const datePiece = formatDate(mois, annee);
  const numeroDoc = `DMI ${String(mois).padStart(2, '0')}-${String(annee).slice(-2)}`;

  const entries: any[] = [];
  const add = (compte: string, sens: string, montant: number, libelle: string, tresorerie?: string) => {
    if (Math.abs(montant) > 0.001) {
      entries.push({ dossier_id: dossierId, societe_id: societeId, journal_code: 'FISC', date_operation: datePiece, date_piece: datePiece, numero_doc: numeroDoc, libelle, compte, sens, montant: Math.round(montant * 1000) / 1000, tresorerie: tresorerie || null });
    }
  };

  // Piece A
  add('457100', 'D', total_general, 'Constatation oblig fiscales');
  if ((retenue_salaires || 0) > 0) add('432100', 'C', retenue_salaires, 'retenue salaires');
  if ((css || 0) > 0) add('432101', 'C', css, 'CSS');
  if ((retenue_loyers || 0) > 0) add('432300', 'C', retenue_loyers, 'retenue loyers');
  if ((retenue_marches || 0) > 0) add('432400', 'C', retenue_marches, 'retenue marches');
  if ((tfp_du || 0) > 0) add('437300', 'C', tfp_du, 'TFP');
  if ((foprolos_du || 0) > 0) add('437200', 'C', foprolos_du, 'FOPROLOS');
  if ((timbre_fiscal || 0) > 0) add('437500', 'C', timbre_fiscal, 'timbre fiscal');
  if ((tcl_du || 0) > 0) add('437400', 'C', tcl_du, 'TCL');
  if ((tva_resultat || 0) > 0) add('436510', 'C', tva_resultat, 'TVA resultat');

  // Piece B - TFP
  if ((tfp_du || 0) > 0) { add('661100', 'D', tfp_du, 'TFP'); add('437300', 'C', tfp_du, 'TFP'); }

  // Piece C - FOPROLOS
  if ((foprolos_du || 0) > 0) { add('661200', 'D', foprolos_du, 'FOPROLOS'); add('437200', 'C', foprolos_du, 'FOPROLOS'); }

  // Piece D - TCL
  if ((tcl_du || 0) > 0) { add('661300', 'D', tcl_du, 'TCL'); add('437400', 'C', tcl_du, 'TCL'); }

  // Piece E - RECLASS TVA
  if ((tva_collectee || 0) > 0) add('436710', 'D', tva_collectee, 'TVA collectee');
  if ((tva_deductible || 0) > 0) add('436660', 'C', tva_deductible, 'TVA deductible');
  if ((tva_report_precedent || 0) > 0) {
    if (tva_signe === 'ف') {
      add('436670', 'D', tva_report_precedent, 'TVA report precedent');
    } else {
      add('436670', 'C', tva_report_precedent, 'TVA report precedent');
    }
  }
  if ((tva_resultat || 0) > 0) {
    if (tva_signe === 'ب') {
      add('436510', 'C', tva_resultat, 'TVA resultat');
    } else {
      add('436510', 'D', tva_resultat, 'TVA resultat');
    }
  }

  return { entries, dmi };
}

// ===== EF AI VERIFICATION =====
async function handleEFVerify(request: Request, env: Env): Promise<Response> {
  const b = await request.json() as any;
  const { actif, passif, resultat, sig, flux, nomSociete, anneeN, balanceN, balanceN1 } = b;

  const actifTotal = ((actif?.immoIncorpBrut || 0) - (actif?.immoIncorpAmort || 0)) +
    ((actif?.immoCorpBrut || 0) - (actif?.immoCorpAmort || 0)) +
    ((actif?.immoFinancBrut || 0) - (actif?.immoFinancProv || 0)) +
    (actif?.autresActifsNonCourants || 0) +
    ((actif?.stocks || 0) - (actif?.stocksProv || 0)) +
    ((actif?.clients || 0) - (actif?.clientsProv || 0)) +
    (actif?.autresActifsCourants || 0) + (actif?.tresorerie || 0);

  const passifTotal = (passif?.capitalSocial || 0) + (passif?.reserves || 0) +
    (passif?.resultatsReportes || 0) + (passif?.resultatExercice || 0) +
    (passif?.emprunts || 0) + (passif?.autresPassifsFinanciers || 0) +
    (passif?.provisions || 0) + (passif?.fournisseurs || 0) +
    (passif?.autresPassifsCourants || 0) + (passif?.concoursBancaires || 0);

  // Fix sign convention: products (70x) are negative in balance (credit), charges (60x) are positive (debit)
  // AI expects: products positive, charges positive, result = products - charges
  const totalProdAbs = Math.abs((resultat?.revenus || 0)) + Math.abs((resultat?.autresProduitsExploit || 0));
  const totalChargesAbs = Math.abs((resultat?.achatsConsommes || 0)) + Math.abs((resultat?.chargesPersonnel || 0)) +
    Math.abs((resultat?.dotationsAmort || 0)) + Math.abs((resultat?.autresChargesExploit || 0));
  const totalProd = totalProdAbs;
  const totalCharges = totalChargesAbs;
  const resExploit = totalProd - totalCharges;
  const chargesFinNettes = Math.abs((resultat?.chargesFinancieres || 0)) - Math.abs((resultat?.produitsPlacements || 0));
  const resAvantImpot = resExploit - chargesFinNettes + Math.abs((resultat?.autresGainsOrdinaires || 0)) - Math.abs((resultat?.autresPertesOrdinaires || 0));
  const resNet = resAvantImpot - Math.abs((resultat?.impotBenefices || 0)) + (resultat?.elementsExtraordinaires || 0);

  const margeComm = Math.abs((sig?.ventesMarchandises || 0)) - Math.abs((sig?.cAchatMarchandises || 0));
  const prodExercice = Math.abs((sig?.revenus || 0)) + Math.abs((sig?.productionStockee || 0));
  const margeBrute = margeComm + prodExercice - Math.abs((sig?.achatsConsommes || 0));
  const VABrute = margeBrute + Math.abs((sig?.subventionExploit || 0)) + Math.abs((sig?.autresChargesExternes || 0));
  const EBE = VABrute - Math.abs((sig?.impotsTaxes || 0)) - Math.abs((sig?.chargesPersonnel || 0));

  // Build balance summary for AI context
  const buildBalanceSummary = (bal: any[], label: string) => {
    if (!bal || bal.length === 0) return '';
    const top = bal.filter((l: any) => Math.abs(l.solde || 0) > 100)
      .sort((a: any, b: any) => Math.abs(b.solde || 0) - Math.abs(a.solde || 0))
      .slice(0, 40);
    return `\nBALANCE ${label} (top comptes):\n${top.map((l: any) => `  ${l.compte} ${l.libelle || ''}: D=${l.debit || 0} C=${l.credit || 0} solde=${l.solde || 0}`).join('\n')}`;
  };

  const prompt = `Expert comptable tunisien PCG. Verifie ces EF de "${nomSociete || '?'}" exercice ${anneeN || 2025}.

BILAN: Actif=${Math.round(actifTotal*1000)/1000}, Passif+CP=${Math.round(passifTotal*1000)/1000}, Ecart=${Math.round((actifTotal - passifTotal)*1000)/1000}
PASSIF: Capital=${passif?.capitalSocial||0}, Reserves=${passif?.reserves||0}, ResExercice=${passif?.resultatExercice||0}
RESULTAT: Produits=${totalProd}, Charges=${totalCharges}, ResExploit=${resExploit}, ResNet=${resNet}
SIG: MargeComm=${margeComm}, MargeBrute=${margeBrute}, VA=${VABrute}, EBE=${EBE}
${buildBalanceSummary(balanceN, `${anneeN}`)}
${buildBalanceSummary(balanceN1, `${(anneeN || 2025) - 1}`)}

Verifie UNIQUEMENT ces regles:
1) Actif ≈ Passif+CP (ecart max 1 dinar)
2) Non-compensation: pas de compensation charges/produits
3) Classification: immo 2x=non-courant, stocks 3x/clients 41/fournisseurs 40=courant
4) Verifie que les totaux des bilans correspondent aux comptes de la balance
5) Verifie que les produits et charges correspondent aux comptes 70x/60x de la balance

IMPORTANT: Ne verifie PAS les formules de calcul (MargeComm, MargeBrute, etc). Verifie UNIQUEMENT la coherence interne avec la balance. Si tout est OK, mets errors=[].
Reponds JSON: {"ok":bool,"errors":[],"summary":"2-3 lignes"} UNIQUEMENT JSON.`;

  try {
    const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
      messages: [
        { role: 'system', content: 'Tu es un expert comptable tunisien PCG. Tu réponds UNIQUEMENT en JSON valide, jamais de texte ni de code.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1000,
      temperature: 0.1,
    });
    const rawResponse = aiResponse?.response || aiResponse?.result?.response || '';
    let responseStr = typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse);
    let parsed;
    try {
      parsed = JSON.parse(responseStr);
      if (!parsed.errors) throw new Error('no errors');
    } catch {
      try {
        const jsonMatch = responseStr.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { ok: false, summary: responseStr.substring(0, 200), errors: [], suggestions: [] };
      } catch {
        parsed = { ok: false, summary: responseStr.substring(0, 200), errors: [], suggestions: [] };
      }
    }
    return json({ ok: true, ...parsed });
  } catch (e: any) {
    return json({ error: 'AI error: ' + e.message }, 500);
  }
}

// ============================================================
// EF — AI TAB AMT GENERATION
// ============================================================
async function handleEFTabAmt(request: Request, env: Env): Promise<Response> {
  const b = await request.json() as any;
  const { balanceN, balanceN1, immob, nomSociete, anneeN } = b;

  const immoLines = (balanceN || []).filter((l: any) => l.compte?.startsWith('22') && Math.abs(l.solde || 0) > 0);
  const amortLines = (balanceN || []).filter((l: any) => l.compte?.startsWith('28') && Math.abs(l.solde || 0) > 0);
  const immoIncorp = (balanceN || []).filter((l: any) => l.compte?.startsWith('21') && Math.abs(l.solde || 0) > 0);
  const amortIncorp = (balanceN || []).filter((l: any) => l.compte?.startsWith('281') && Math.abs(l.solde || 0) > 0);

  const immoLinesN1 = (balanceN1 || []).filter((l: any) => l.compte?.startsWith('22') && Math.abs(l.solde || 0) > 0);
  const amortLinesN1 = (balanceN1 || []).filter((l: any) => l.compte?.startsWith('28') && Math.abs(l.solde || 0) > 0);

  const immoDetail = immoLines.map((l: any) => {
    const code = l.compte;
    const trySwap = '28' + code.slice(2);
    const amort = amortLines.find((a: any) => a.compte === trySwap);
    const n1 = immoLinesN1.find((n: any) => n.compte === code);
    const amortN1 = amortLinesN1.find((a: any) => a.compte === trySwap);
    return {
      code, libelle: l.libelle || l.compte, vbN: Math.abs(l.solde),
      amortN: amort ? Math.abs(amort.solde) : 0,
      vbN1: n1 ? Math.abs(n1.solde) : 0,
      amortN1: amortN1 ? Math.abs(amortN1.solde) : 0,
    };
  });

  const immoIncorpDetail = immoIncorp.map((l: any) => {
    const amort = amortIncorp.find((a: any) => a.compte === '28' + l.compte.slice(2));
    const n1 = (balanceN1 || []).find((n: any) => n.compte === l.compte);
    const amortN1 = (balanceN1 || []).filter((a: any) => a.compte?.startsWith('281')).find((a: any) => a.compte === '28' + l.compte.slice(2));
    return {
      code: l.compte, libelle: l.libelle || l.compte, vbN: Math.abs(l.solde),
      amortN: amort ? Math.abs(amort.solde) : 0,
      vbN1: n1 ? Math.abs(n1.solde) : 0,
      amortN1: amortN1 ? Math.abs(amortN1.solde) : 0,
    };
  });

  const prompt = `Tu es un expert comptable tunisien PCG. Genere le TABLEAU DES IMMOBILISATIONS ET AMORTISSEMENTS pour "${nomSociete || '?'}" exercice ${anneeN || 2025}.

DONNEES EXACTES DE LA BALANCE (applique les regles PCG):
${immoIncorpDetail.length > 0 ? immoIncorpDetail.map((l: any) => `Compte ${l.code} "${l.libelle}": VBouverture_N1=${l.vbN1}, Amort_N1=${l.amortN1}, VBcloture_N=${l.vbN}, Amort_N=${l.amortN}`).join('\n') : 'Aucune immo incorporelle'}
${immoDetail.length > 0 ? immoDetail.map((l: any) => `Compte ${l.code} "${l.libelle}": VBouverture_N1=${l.vbN1}, Amort_N1=${l.amortN1}, VBcloture_N=${l.vbN}, Amort_N=${l.amortN}`).join('\n') : 'Aucune immo corporelle'}
${(balanceN || []).filter((l: any) => l.compte?.startsWith('25') && Math.abs(l.solde || 0) > 0).map((l: any) => `Compte ${l.compte} "${l.libelle}": VBcloture_N=${Math.abs(l.solde)}`).join('\n') || 'Aucune immo financiere'}

REGLES PCG ( applique exactement):
- VB_N (cloture) = valeur brute a la fin de l'exercice (compte 22x debit)
- VB_N1 (ouverture) = valeur brute N-1 (compte 22x N-1)
- Amort_N (cloture) = amortissements cumules fin N (compte 28x credit)
- Amort_N1 (ouverture) = amortissements cumules N-1 (compte 28x N-1)
- Acquisitions = VB_N - VB_N1 + Cessions (si pas de cessions, acq = VB_N - VB_N1)
- Dotations = Amort_N - Amort_N1 + Regul (si pas de regul, dot = Amort_N - Amort_N1)
- VCN = VB_N - Amort_N
- Les immobilisations incorporelles (21x): vbN1, amortN1, vbN, amortN viennent des comptes 21x et 281x
- Les immobilisations corporelles (22x): vbN1, amortN1, vbN, amortN viennent des comptes 22x et 282x/284x/292x/293x/294x
- Les immobilisations financieres (25x-26x): vbN des comptes 25x/26x, amort des 295x/296x/297x

IMPORTANT: Utilise les MONTANTS EXACTS donnes ci-dessus. Ne calcule pas, ne cherche pas, ne guess pas. Copie les valeurs exactes de la balance.

Reponds UNIQUEMENT en JSON. Format:
{"lignes":[{"cat":"nom du compte","vbN":montant,"acq":0,"ces":0,"dot":0,"reg":0,"vbN1":montant,"amortN1":montant}],"summary":"description"}
Chaque ligne = 1 compte 22x individuel. Ajoute les lignes totaux: "Immobilisations incorporelles", "Immobilisations corporelles (total)", "Immobilisations financieres", "GRAND TOTAL".
Pour les totaux: somme les lignes individuelles.
Reponds UNIQUEMENT avec le JSON, rien d'autre.`;

  try {
    const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
      messages: [
        { role: 'system', content: 'Tu es un expert comptable. Tu réponds UNIQUEMENT en JSON valide, jamais de texte ni de code.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2000,
      temperature: 0.1,
    });
    const rawResponse = aiResponse?.response || aiResponse?.result?.response || '';
    let responseStr = typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse);
    let parsed;
    try {
      parsed = JSON.parse(responseStr);
      if (!parsed.lignes) throw new Error('no lignes');
    } catch {
      try {
        const jsonMatch = responseStr.match(/\{[\s\S]*"lignes"[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { lignes: [], summary: responseStr.substring(0, 200) };
      } catch {
        parsed = { lignes: [], summary: responseStr.substring(0, 200) };
      }
    }
    return json({ ok: true, ...parsed });
  } catch (e: any) {
    return json({ error: 'AI error: ' + e.message }, 500);
  }
}
