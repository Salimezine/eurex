const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Keep-alive: self-ping every 10 minutes to prevent Render free tier from sleeping
if (process.env.RENDER_EXTERNAL_URL) {
  const url = process.env.RENDER_EXTERNAL_URL;
  setInterval(() => {
    fetch(url).catch(() => {});
  }, 10 * 60 * 1000);
  console.log('Keep-alive enabled for:', url);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'web/dist')));

const db = new Database(path.join(__dirname, 'comptaflow.db'));
db.pragma('journal_mode = WAL');

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

function genId() { return crypto.randomBytes(8).toString('hex'); }

// --- EXCLUDED DAYS (ecart > 3DT, a verifier manuellement) ---
const EXCLUDED_DAYS = new Set([
  '2026-06-05', '2026-06-07', '2026-06-09', '2026-06-13',
  '2026-06-14', '2026-06-23', '2026-06-27', '2026-06-29', '2026-06-30'
]);
const CLIENT_NAMES = { '99': 'CLTS PASSAGERS', '111': 'STE WEZIGN', '122': 'NESRINE BACCAR' };

function buildDayEcritures(date, dayFactures, modes, defaultLibelle, journal = 'VT J.C') {
  const isJC = journal !== 'VT C';
  const COMPTE_VENTE0 = isJC ? '707200' : '707100';
  const COMPTE_VENTE19 = isJC ? '707219' : '707119';
  const COMPTE_TVA = isJC ? '436711' : '436710';
  if (EXCLUDED_DAYS.has(date)) {
    const factureDetails = dayFactures.map(f => {
      const num = f.numero_facture || f.num || '?';
      const client = f.client || '?';
      const ht0 = f.total_ht_0 || f.ht0 || 0;
      const ht19 = f.total_ht_19 || f.ht19 || 0;
      const tva = f.tva_19 || f.tva || 0;
      const ttc = f.total_ttc || f.ttc || 0;
      return `  ${num} | client=${client} | HT0=${ht0} HT19=${ht19} TVA=${tva} TTC=${ttc}`;
    }).join('\n');
    return { lines: [], ecart: 0, excluded: true, anomaly: { date, error: 'Exclu: ecart > 3DT, a verifier manuellement', factures: factureDetails } };
  }
  const get = (f, key) => f[key] || f[key.replace('total_ht_0','ht0').replace('total_ht_19','ht19').replace('tva_19','tva')] || 0;
  const totalHT0 = Math.round(dayFactures.reduce((s, f) => s + (f.ht0 || f.total_ht_0 || 0), 0) * 1000) / 1000;
  const totalHT19 = Math.round(dayFactures.reduce((s, f) => s + (f.ht19 || f.total_ht_19 || 0), 0) * 1000) / 1000;
  const tva19 = Math.round(dayFactures.reduce((s, f) => s + (f.tva || f.tva_19 || 0), 0) * 1000) / 1000;
  const timbres = dayFactures.reduce((s, f) => s + (f.timbre || 1), 0);

  const avoir709 = (modes.bonsAchat || 0) + (modes.avoir || 0);
  const debitSum = (modes.especes || 0) + (modes.tpe || 0) + (modes.cheques || 0) + avoir709;
  const creditSum = tva19 + timbres + totalHT0 + totalHT19;
  const ecart = Math.round((debitSum - creditSum) * 1000) / 1000;

  const lines = [];
  if ((modes.especes || 0) > 0) lines.push({ compte: '411004', montant: Math.round(modes.especes * 1000) / 1000, sens: 'D' });
  if ((modes.tpe || 0) > 0) lines.push({ compte: '411005', montant: Math.round(modes.tpe * 1000) / 1000, sens: 'D' });
  if ((modes.cheques || 0) > 0) lines.push({ compte: '411003', montant: Math.round(modes.cheques * 1000) / 1000, sens: 'D' });

  const byClient = {};
  for (const f of dayFactures) {
    const c = String(f.client || '99');
    if (!byClient[c]) byClient[c] = { ht0: 0, ht19: 0 };
    byClient[c].ht0 += (f.ht0 || f.total_ht_0 || 0);
    byClient[c].ht19 += (f.ht19 || f.total_ht_19 || 0);
  }
  const tierKeys = Object.keys(byClient);
  for (const [cc, amt] of Object.entries(byClient)) {
    const rht0 = Math.round(amt.ht0 * 1000) / 1000;
    const rht19 = Math.round(amt.ht19 * 1000) / 1000;
    const lib = tierKeys.length > 1 ? (CLIENT_NAMES[cc] || cc) : defaultLibelle;
    if (rht0 > 0) lines.push({ compte: COMPTE_VENTE0, montant: rht0, sens: 'C', libelle: lib });
    if (rht19 > 0) lines.push({ compte: COMPTE_VENTE19, montant: rht19, sens: 'C', libelle: lib });
  }
  if (tva19 > 0) lines.push({ compte: COMPTE_TVA, montant: tva19, sens: 'C' });
  lines.push({ compte: '437500', montant: timbres, sens: 'C' });
  if (avoir709 > 0) lines.push({ compte: '709500', montant: Math.round(avoir709 * 1000) / 1000, sens: 'D' });
  if (ecart !== 0) lines.push({ compte: '634500', montant: Math.abs(ecart), sens: ecart > 0 ? 'C' : 'D' });

  let anomaly = null;
  if (Math.abs(ecart) > 3) {
    anomaly = { date, error: 'ECART ' + ecart.toFixed(3) + 'DT > 3DT, a verifier manuellement' };
  }
  return { lines, ecart, excluded: false, anomaly, totalHT0, totalHT19, tva19, timbres };
}

// --- PDF TEXT EXTRACTION (server-side) ---
let pdfjsLib = null;
async function extractTextFromPDF(filePath) {
  if (!pdfjsLib) pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  let fullText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Reconstruct lines using y-positions
    const items = content.items.filter(item => item.str.trim());
    if (items.length === 0) continue;
    // Sort by y (top to bottom), then x (left to right)
    items.sort((a, b) => {
      const ay = a.transform[5], by = b.transform[5];
      if (Math.abs(ay - by) > 2) return by - ay; // different lines: top first
      return a.transform[4] - b.transform[4]; // same line: left first
    });
    let lines = [];
    let currentLine = [items[0]];
    for (let j = 1; j < items.length; j++) {
      const prev = currentLine[currentLine.length - 1];
      const dy = Math.abs(items[j].transform[5] - prev.transform[5]);
      if (dy > 2) {
        lines.push(currentLine.map(x => x.str).join(' '));
        currentLine = [items[j]];
      } else {
        currentLine.push(items[j]);
      }
    }
    lines.push(currentLine.map(x => x.str).join(' '));
    fullText += lines.join('\n') + '\n';
  }
  return fullText;
}

async function extractTextItemsFromPDF(filePath) {
  if (!pdfjsLib) pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const allItems = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (item.str.trim()) {
        allItems.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          page: i,
        });
      }
    }
  }
  return allItems;
}

const { parseDMIItems, generateFISCecritures } = require('./server-fisc');

function parseRapport(text) {
  const modes = {};
  const p = s => parseFloat(s.replace(/ /g, '').replace(',', '.')) || 0;
  const num = '\\d[\\d ]*\\d,\\d+|\\d,\\d+';
  const sep = '\\s*[|]?\\s*';
  const re = new RegExp('(\\d{2})\\/(\\d{2})\\/(\\d{4})' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')');
  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const date = m[3] + '-' + m[2] + '-' + m[1];
    modes[date] = {
      especes: p(m[4]),
      cheques: p(m[5]),
      tpe: p(m[6]),
      bonsAchat: p(m[7]),
      avoir: p(m[8]),
      credit: p(m[9])
    };
  }
  return modes;
}

function parseInvoice(text) {
  let numero = '';
  let m = text.match(/FACTURE\s*N[�??]?\s*:\s*(\d{4})\s*\/\s*(\d+)/);
  if (m) numero = m[1] + '/' + m[2];

  let date = '';
  m = text.match(/LE\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) date = m[3] + '-' + m[2] + '-' + m[1];

  let client = '';
  m = text.match(/(?<!Code )Client\s*:\s*(.+?)(?:\n|$)/);
  if (m) {
    const c = m[1].trim();
    client = c.toUpperCase().includes('PASSAGERS') ? 'CLIENTS PASSAGERS' : c;
  }

  let ht0 = 0, ht19 = 0, tva19 = 0, ttc = 0, timbre = 1.0;
  const lines = text.split('\n');

  for (const line of lines) {
    if (ht0 === 0) {
      m = line.match(/^([\d][\d ,.]+?)\s+0%\s/);
      if (m) { try { ht0 = parseFloat(m[1].trim().replace(/ /g, '').replace(',', '.')); } catch(e) {} }
    }
    if (ht19 === 0) {
      m = line.match(/^([\d][\d ,.]+?)\s+19%\s+([\d ,.]+)/);
      if (m) {
        try { ht19 = parseFloat(m[1].trim().replace(/ /g, '').replace(',', '.')); } catch(e) {}
        try { tva19 = parseFloat(m[2].trim().replace(/ /g, '').replace(',', '.')); } catch(e) {}
      }
    }
    if (timbre === 1.0) {
      m = line.match(/TIMBRE\s+FIS\.\s*:\s*([\d ,.]+)/);
      if (m) { try { timbre = parseFloat(m[1].trim().replace(/ /g, '').replace(',', '.')); } catch(e) {} }
    }
    if (ttc === 0) {
      m = line.match(/NET\s+T\.T\.C\.\s*([\d ,.]+)/);
      if (m) { try { ttc = parseFloat(m[1].trim().replace(/ /g, '').replace(',', '.')); } catch(e) {} }
    }
  }

  return { date, numero, client, ht0, ht19, tva19, timbre, ttc };
}

db.exec(`
  CREATE TABLE IF NOT EXISTS societes (
    id TEXT PRIMARY KEY, raison_sociale TEXT NOT NULL, matricule_fiscal TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS journaux (
    id TEXT PRIMARY KEY, societe_id TEXT NOT NULL, code TEXT NOT NULL, libelle TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dossiers (
    id TEXT PRIMARY KEY, societe_id TEXT NOT NULL, nom TEXT NOT NULL, statut TEXT DEFAULT 'brouillon',
    nb_pieces INTEGER DEFAULT 0, nb_ecritures INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS pieces (
    id TEXT PRIMARY KEY, dossier_id TEXT NOT NULL, societe_id TEXT NOT NULL, nom_fichier TEXT NOT NULL,
    chemin TEXT NOT NULL, date_document TEXT, numero_facture TEXT, tiers TEXT,
    montant_ht REAL DEFAULT 0, montant_tva REAL DEFAULT 0, montant_ttc REAL DEFAULT 0,
    mode_reglement TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS ecritures (
    id TEXT PRIMARY KEY, dossier_id TEXT NOT NULL, societe_id TEXT NOT NULL, journal_code TEXT NOT NULL,
    date_operation TEXT NOT NULL, date_piece TEXT, numero_doc TEXT, libelle TEXT NOT NULL,
    compte TEXT NOT NULL, sens TEXT NOT NULL, montant REAL NOT NULL,
    tresorerie TEXT, statut TEXT DEFAULT 'brouillon', piece_id TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS factures (
    id TEXT PRIMARY KEY, dossier_id TEXT NOT NULL, societe_id TEXT NOT NULL,
    date_facture TEXT NOT NULL, numero_facture TEXT NOT NULL, client TEXT,
    total_ht_0 REAL DEFAULT 0, total_ht_19 REAL DEFAULT 0, tva_19 REAL DEFAULT 0,
    timbre REAL DEFAULT 1, total_ttc REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS rapport_modes (
    id TEXT PRIMARY KEY, dossier_id TEXT NOT NULL, date_jour TEXT NOT NULL,
    especes REAL DEFAULT 0, cheques REAL DEFAULT 0, tpe REAL DEFAULT 0, bonsAchat REAL DEFAULT 0, avoir REAL DEFAULT 0, credit REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(dossier_id, date_jour)
  );
`);

// --- AUTO CREATE DEFAULT DATA ---
const defaultSoc = db.prepare('SELECT id FROM societes LIMIT 1').get();
if (!defaultSoc) {
  const sid = 'default_soc';
  db.prepare('INSERT INTO societes (id, raison_sociale) VALUES (?, ?)').run(sid, 'Cabinet');
  const journaux = [['VE','Ventes'],['AC','Achats'],['BQ','Banque'],['CA','Caisse'],['OD','Operations Diverses'],['FISC','Declarations Fiscales']];
  for (const [c, l] of journaux) db.prepare('INSERT INTO journaux (id, societe_id, code, libelle) VALUES (?, ?, ?, ?)').run(genId(), sid, c, l);
}

const defaultDossier = db.prepare('SELECT id FROM dossiers WHERE nom = ?').get('ANIMAL');
if (!defaultDossier) {
  const soc = db.prepare('SELECT id FROM societes LIMIT 1').get();
  const did = 'dossier_animal';
  db.prepare('INSERT INTO dossiers (id, societe_id, nom) VALUES (?, ?, ?)').run(did, soc.id, 'ANIMAL');
}

// --- MIGRATE ecritures schema if needed ---
const ecols = db.prepare("PRAGMA table_info(ecritures)").all().map(c => c.name);
if (!ecols.includes('compte') && ecols.includes('compte_debit')) {
  db.exec("ALTER TABLE ecritures ADD COLUMN compte TEXT");
  db.exec("ALTER TABLE ecritures ADD COLUMN sens TEXT");
  db.exec("UPDATE ecritures SET compte = compte_debit, sens = 'D' WHERE compte_debit IS NOT NULL");
}
const rcols = db.prepare("PRAGMA table_info(rapport_modes)").all().map(c => c.name);
if (!rcols.includes('credit')) {
  db.exec("ALTER TABLE rapport_modes ADD COLUMN credit REAL DEFAULT 0");
}

// --- MIGRATE journaux: add FISC if missing ---
const allSocs = db.prepare('SELECT id FROM societes').all();
for (const soc of allSocs) {
  const hasFisc = db.prepare('SELECT id FROM journaux WHERE societe_id = ? AND code = ?').get(soc.id, 'FISC');
  if (!hasFisc) {
    db.prepare('INSERT INTO journaux (id, societe_id, code, libelle) VALUES (?, ?, ?, ?)').run(genId(), soc.id, 'FISC', 'Declarations Fiscales');
  }
}

// --- SOCIETES ---
app.get('/api/societes', (req, res) => {
  res.json(db.prepare('SELECT * FROM societes ORDER BY raison_sociale').all());
});

app.post('/api/societes', (req, res) => {
  const { raison_sociale, matricule_fiscal } = req.body;
  if (!raison_sociale) return res.status(400).json({ error: 'Raison sociale requise' });
  const id = genId();
  db.prepare('INSERT INTO societes (id, raison_sociale, matricule_fiscal) VALUES (?, ?, ?)').run(id, raison_sociale, matricule_fiscal || null);
  const journaux = [['VE','Ventes'],['AC','Achats'],['BQ','Banque'],['CA','Caisse'],['OD','Operations Diverses'],['FISC','Declarations Fiscales']];
  const stmt = db.prepare('INSERT INTO journaux (id, societe_id, code, libelle) VALUES (?, ?, ?, ?)');
  for (const [c, l] of journaux) stmt.run(genId(), id, c, l);
  res.json({ id, raison_sociale, matricule_fiscal });
});

app.delete('/api/societes/:id', (req, res) => {
  db.prepare('DELETE FROM societes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- JOURNAUX ---
app.get('/api/societes/:sid/journaux', (req, res) => {
  res.json(db.prepare('SELECT * FROM journaux WHERE societe_id = ?').all(req.params.sid));
});

// --- DOSSIERS ---
app.get('/api/societes/:sid/dossiers', (req, res) => {
  res.json(db.prepare('SELECT * FROM dossiers WHERE societe_id = ? ORDER BY created_at DESC').all(req.params.sid));
});

app.post('/api/societes/:sid/dossiers', (req, res) => {
  const { nom } = req.body;
  const id = genId();
  db.prepare('INSERT INTO dossiers (id, societe_id, nom) VALUES (?, ?, ?)').run(id, req.params.sid, nom);
  res.json({ id, nom, statut: 'brouillon' });
});

app.get('/api/dossiers/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(req.params.id);
  d ? res.json(d) : res.status(404).json({ error: 'Non trouve' });
});

app.delete('/api/dossiers/:id', (req, res) => {
  db.prepare('DELETE FROM dossiers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- UPLOAD ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${genId()}_${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.post('/api/dossiers/:did/upload', upload.array('files', 50), (req, res) => {
  const did = req.params.did;
  const d = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(did);
  if (!d) return res.status(404).json({ error: 'Dossier non trouve' });
  const stmt = db.prepare('INSERT INTO pieces (id, dossier_id, societe_id, nom_fichier, chemin) VALUES (?, ?, ?, ?, ?)');
  const created = [];
  for (const f of req.files) {
    const id = genId();
    stmt.run(id, did, d.societe_id, f.originalname, f.path);
    created.push({ id, nom_fichier: f.originalname });
  }
  db.prepare('UPDATE dossiers SET nb_pieces = nb_pieces + ? WHERE id = ?').run(created.length, did);
  res.json({ uploaded: created.length, pieces: created });
});

// --- PROCESS: Upload + OCR + Create factures ---
app.post('/api/dossiers/:did/process', upload.array('files', 50), async (req, res) => {
  try {
    const did = req.params.did;
    const d = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(did);
    if (!d) return res.status(404).json({ error: 'Dossier non trouve' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Aucun fichier envoye' });

    const results = [];
    for (const f of req.files) {
      try {
        const text = await extractTextFromPDF(f.path);
        const inv = parseInvoice(text);
        if (!inv.numero) inv.numero = f.originalname.replace(/[^0-9]/g, '');

        const fid = genId();
        db.prepare('INSERT INTO factures (id, dossier_id, societe_id, date_facture, numero_facture, client, total_ht_0, total_ht_19, tva_19, timbre, total_ttc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(fid, did, d.societe_id, inv.date, inv.numero, inv.client, inv.ht0, inv.ht19, inv.tva19, inv.timbre, inv.ttc);

        db.prepare('INSERT INTO pieces (id, dossier_id, societe_id, nom_fichier, chemin) VALUES (?, ?, ?, ?, ?)')
          .run(genId(), did, d.societe_id, f.originalname, f.path);

        results.push({ file: f.originalname, numero: inv.numero, date: inv.date, client: inv.client, ht0: inv.ht0, ht19: inv.ht19, tva19: inv.tva19, ttc: inv.ttc, ok: true });
      } catch (e) {
        results.push({ file: f.originalname, error: e.message, ok: false });
      } finally {
        try { fs.unlinkSync(f.path); } catch {}
      }
    }

    db.prepare('UPDATE dossiers SET nb_pieces = (SELECT COUNT(*) FROM pieces WHERE dossier_id = ?) WHERE id = ?').run(did, did);
    res.json({ processed: results.length, results });
  } catch (e) {
    console.error('Process error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- LIST PIECES ---
app.get('/api/dossiers/:did/pieces', (req, res) => {
  res.json(db.prepare('SELECT * FROM pieces WHERE dossier_id = ? ORDER BY created_at').all(req.params.did));
});

// --- PROCESS VT C PDF (ecritures directes) ---
const DEBIT_ACCOUNTS_VTC = new Set(['411004', '411003', '411005', '709500']);
const CREDIT_ACCOUNTS_VTC = new Set(['707100', '707119', '436710', '437500']);
const ECART_ACCOUNT_VTC = '634500';

function parseVTCLines(text) {
  const entries = [];
  const allAccounts = [...DEBIT_ACCOUNTS_VTC, ...CREDIT_ACCOUNTS_VTC, ECART_ACCOUNT_VTC];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let currentFacNum = null;

  for (const line of lines) {
    const facMatch = line.match(/FAC\s*(?:N[°o]?\s*)?(\d+[-\/]\d+)/i);
    if (facMatch) {
      currentFacNum = facMatch[1].replace('-', '/');
    }

    const dateMatch = line.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (dateMatch) {
      const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
      const amtLine = line;
      for (const acct of allAccounts) {
        const acctRegex = new RegExp('\\b' + acct + '\\b\\s+(.+?)\\s+([\\d][\\d\\s]*[,\\.]\\d{1,3})\\s*$');
        const acctMatch = amtLine.match(acctRegex);
        if (acctMatch) {
          const montant = parseFloat(acctMatch[2].replace(/\s/g, '').replace(',', '.'));
          if (isNaN(montant) || montant === 0) continue;
          const libelle = acctMatch[1].trim();
          entries.push({
            date,
            facNum: currentFacNum ? 'FAC ' + currentFacNum : null,
            compte: acct,
            compteLibelle: acct + ' ' + libelle,
            montant,
            libelle: libelle || 'CLIENTS PASSAGERS',
          });
        }
      }
    }
  }

  for (const e of entries) {
    if (e.compte === ECART_ACCOUNT_VTC) {
      e.sens = 'D';
    } else {
      e.sens = DEBIT_ACCOUNTS_VTC.has(e.compte) ? 'D' : 'C';
    }
  }

  return entries;
}

app.post('/api/dossiers/:did/process-vtc', upload.array('files', 50), async (req, res) => {
  try {
    const did = req.params.did;
    const d = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(did);
    if (!d) return res.status(404).json({ error: 'Dossier non trouve' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Aucun fichier envoye' });

    db.prepare("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = 'VT C'").run(did);

    const insertE = db.prepare('INSERT INTO ecritures (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte, sens, montant, tresorerie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    let totalEntries = 0;
    const results = [];

    for (const f of req.files) {
      try {
        const text = await extractTextFromPDF(f.path);
        const entries = parseVTCLines(text);

        for (const e of entries) {
          insertE.run(genId(), did, d.societe_id, 'VT C', e.date, e.date, e.facNum || f.originalname, e.compteLibelle || e.libelle, e.compte, e.sens, e.montant, null);
        }
        totalEntries += entries.length;
        results.push({ file: f.originalname, entries: entries.length, ok: true });
      } catch (e) {
        results.push({ file: f.originalname, error: e.message, ok: false });
      } finally {
        try { fs.unlinkSync(f.path); } catch {}
      }
    }

    db.prepare('UPDATE dossiers SET nb_ecritures = (SELECT COUNT(*) FROM ecritures WHERE dossier_id = ?) WHERE id = ?').run(did, did);
    res.json({ processed: results.length, totalEntries, results });
  } catch (e) {
    console.error('Process VT C error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- PROCESS FISC (DMI PDF) ---
app.post('/api/dossiers/:did/process-fisc', upload.single('file'), async (req, res) => {
  try {
    const did = req.params.did;
    const d = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(did);
    if (!d) return res.status(404).json({ error: 'Dossier non trouve' });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoye' });

    try {
      const items = await extractTextItemsFromPDF(req.file.path);
      const dmi = parseDMIItems(items);
      console.log('FISC parsed DMI:', JSON.stringify(dmi, null, 2));

      if (!dmi.mois || !dmi.annee) {
        return res.status(400).json({ error: 'Mois/annee non trouves dans le PDF', dmi });
      }

      // Delete existing FISC ecritures
      db.prepare("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = 'FISC'").run(did);

      const result = generateFISCecritures(dmi, did, d.societe_id);
      if (result.error) {
        return res.status(400).json({ error: result.error, dmi, debug: { retenue_salaires: dmi.retenue_salaires, css: dmi.css, retenue_loyers: dmi.retenue_loyers, retenue_marches: dmi.retenue_marches, tfp_du: dmi.tfp_du, foprolos_du: dmi.foprolos_du, timbre_fiscal: dmi.timbre_fiscal, tcl_du: dmi.tcl_du, total_general: dmi.total_general, tva_collectee: dmi.tva_collectee, tva_deductible: dmi.tva_deductible, tva_report_precedent: dmi.tva_report_precedent, tva_resultat: dmi.tva_resultat, tva_signe: dmi.tva_signe } });
      }

      const insertE = db.prepare('INSERT INTO ecritures (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte, sens, montant, tresorerie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const txn = db.transaction(() => {
        for (const e of result.entries) {
          insertE.run(genId(), e.dossier_id, e.societe_id, e.journal_code, e.date_operation, e.date_piece, e.numero_doc, e.libelle, e.compte, e.sens, e.montant, e.tresorerie);
        }
        db.prepare('UPDATE dossiers SET nb_ecritures = (SELECT COUNT(*) FROM ecritures WHERE dossier_id = ?) WHERE id = ?').run(did, did);
      });
      txn();

      res.json({ ok: true, dmi: result.dmi, entriesCount: result.entries.length });
    } finally {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
  } catch (e) {
    console.error('Process FISC error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- DEBUG: DUMP PDF TEXT ITEMS BY PAGE ---
app.post('/api/debug/dump-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    try {
      const items = await extractTextItemsFromPDF(req.file.path);
      const byPage = {};
      for (const item of items) {
        if (!byPage[item.page]) byPage[item.page] = [];
        byPage[item.page].push(item);
      }
      const summary = {};
      for (const [page, pageItems] of Object.entries(byPage)) {
        const nums = pageItems.filter(i => /\d/.test(i.str) && i.str.length < 30)
          .map(i => ({ s: i.str.trim(), x: Math.round(i.x * 100) / 100, y: Math.round(i.y * 100) / 100 }));
        const text = pageItems.filter(i => !/\d/.test(i.str) && i.str.trim().length > 1 && i.str.length < 40)
          .map(i => ({ s: i.str.trim(), x: Math.round(i.x * 100) / 100, y: Math.round(i.y * 100) / 100 }));
        summary[page] = { nums, text: text.slice(0, 30) };
      }
      res.json({ totalPages: Object.keys(byPage).length, pages: summary });
    } finally {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- AI VERIFICATION ---
app.post('/api/dossiers/:did/verify-ai', upload.single('file'), async (req, res) => {
  try {
    const did = req.params.did;
    const d = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(did);
    if (!d) return res.status(404).json({ error: 'Dossier non trouve' });

    // Get ecritures from DB
    const ecritures = db.prepare('SELECT * FROM ecritures WHERE dossier_id = ? AND journal_code = ? ORDER BY numero_doc, compte').all(did, 'FISC');
    if (ecritures.length === 0) return res.status(400).json({ error: 'Aucune ecriture FISC. Generez d\'abord les ecritures.' });

    // Extract PDF text
    let pdfText = '';
    if (req.file) {
      try {
        const items = await extractTextItemsFromPDF(req.file.path);
        // Group by page and format
        const byPage = {};
        for (const item of items) {
          if (!byPage[item.page]) byPage[item.page] = [];
          byPage[item.page].push(item);
        }
        for (const [page, pageItems] of Object.entries(byPage)) {
          pdfText += `\n--- PAGE ${page} ---\n`;
          pageItems.sort((a, b) => b.y - a.y || a.x - b.x);
          for (const it of pageItems) {
            pdfText += it.str + '\n';
          }
        }
      } finally {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
    }

    // Format ecritures for the AI
    const ecrituresText = ecritures.map(e =>
      `${e.numero_doc} | ${e.date_piece} | ${e.journal_code} | ${e.libelle} | ${e.compte} | ${e.tresorerie || ''} | ${e.sens}=${e.montant}`
    ).join('\n');

    // Build the prompt
    const prompt = `Tu es un expert-comptable tunisien. Tu DOIS verifier ces ecritures FISC en detail.

## REGLES EXACTES DU DMI (SCE 1996 Tunisie)

### PIECE A - Constatation globale
- 457100 D = total_general
- Tous les autres comptes: CREDIT
- 432100 C = retenue salaires
- 432101 C = CSS
- 432300 C = retenue loyers
- 437300 C = TFP
- 437200 C = FOPROLOS
- 437500 C = timbre fiscal
- 437400 C = TCL
- 436510 C = TVA resultat
- VERIFIE: D = somme(C) exactement

### PIECE B - TFP: 661100 D = 437300 C
### PIECE C - FOPROLOS: 661200 D = 437200 C
### PIECE D - TCL: 661300 D = 437400 C
- VERIFIE: chaque piece D = C

### PIECE E - RECLASS TVA
- 436710 D = TVA collectee
- 436660 C = TVA deductible
- 436670 C = TVA report precedent
- 436510 C = TVA resultat (si ب)
- VERIFIE: D = C exactement
- VERIFIE: montant 437300 piece A = montant piece B
- VERIFIE: montant 437200 piece A = montant piece C
- VERIFIE: montant 437400 piece A = montant piece D

## ECRITURES A VERIFIER
${ecrituresText}

## VERIFICATION DETAILLEE
Pour CHAQUE piece, donne des checks detailles avec les montants exactes:
- "Piece A: D=5771.764, C=1281.564+32.727+104.413+52.206+67+366.568+3867.286=5771.764 → OK"
- "Piece B: 661100 D=104.413 = 437300 C=104.413 → OK"
etc.

## SORTIE JSON
{
  "verdict": "OK"/"ERREUR"/"ATTENTION",
  "score": 0-100,
  "checks": [{"name": "detail", "status": "ok"/"error", "detail": "montants exactes et verification"}],
  "summary": "resume"
}`;

    // Call Cloudflare Workers AI
    const accountId = process.env.CF_ACCOUNT_ID || '7923ab56e04f76467ba94aa508a8f018';
    const apiToken = process.env.CF_API_TOKEN;
    if (!apiToken) {
      return res.status(500).json({ error: 'CF_API_TOKEN non configure. Ajoutez la variable d\'environnement.' });
    }

    const aiResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Tu es un expert-comptable tunisien. Reponds toujours en JSON valide.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2000,
        temperature: 0.1,
      }),
    });

    const aiResult = await aiResponse.json();
    if (!aiResult.success) {
      return res.status(500).json({ error: 'Erreur AI: ' + JSON.stringify(aiResult.errors) });
    }

    // Parse AI response
    let report;
    try {
      const raw = aiResult.result?.response || aiResult.result;
      
      // Case 1: response is already an object with verdict/score/checks
      if (raw && typeof raw === 'object' && raw.verdict) {
        report = raw;
      }
      // Case 2: response is a string containing JSON
      else if (typeof raw === 'string') {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          report = JSON.parse(jsonMatch[0]);
        } else {
          report = { verdict: 'ATTENTION', score: 0, checks: [], summary: raw };
        }
      }
      // Case 3: try choices[0].message.content
      else if (aiResult.result?.choices?.[0]?.message?.content) {
        const content = aiResult.result.choices[0].message.content;
        if (typeof content === 'object' && content.verdict) {
          report = content;
        } else {
          const jsonMatch = String(content).match(/\{[\s\S]*\}/);
          report = jsonMatch ? JSON.parse(jsonMatch[0]) : { verdict: 'ATTENTION', score: 0, checks: [], summary: String(content) };
        }
      }
      else {
        report = { verdict: 'ATTENTION', score: 0, checks: [], summary: JSON.stringify(aiResult.result) };
      }
    } catch (e) {
      report = { verdict: 'ATTENTION', score: 0, checks: [], summary: 'Parse error: ' + e.message };
    }

    res.json({ ok: true, report, ecrituresCount: ecritures.length });
  } catch (e) {
    console.error('AI Verify error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- ECRITURES ---
app.get('/api/dossiers/:did/ecritures', (req, res) => {
  res.json(db.prepare('SELECT * FROM ecritures WHERE dossier_id = ? ORDER BY date_operation, journal_code').all(req.params.did));
});

app.post('/api/dossiers/:did/ecritures', (req, res) => {
  const b = req.body;
  const id = genId();
  db.prepare('INSERT INTO ecritures (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte, sens, montant, tresorerie, piece_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.did, b.societe_id, b.journal_code, b.date_operation, b.date_piece || null, b.numero_doc || null, b.libelle, b.compte, b.sens, b.montant, b.tresorerie || null, b.piece_id || null);
  db.prepare('UPDATE dossiers SET nb_ecritures = nb_ecritures + 1 WHERE id = ?').run(req.params.did);
  res.json({ id, ...b });
});

app.delete('/api/ecritures/:eid', (req, res) => {
  const e = db.prepare('SELECT * FROM ecritures WHERE id = ?').get(req.params.eid);
  if (e) {
    db.prepare('DELETE FROM ecritures WHERE id = ?').run(e.id);
    db.prepare('UPDATE dossiers SET nb_ecritures = MAX(0, nb_ecritures - 1) WHERE id = ?').run(e.dossier_id);
  }
  res.json({ ok: true });
});

app.delete('/api/dossiers/:did/ecritures', (req, res) => {
  db.prepare("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = 'VT J.C'").run(req.params.did);
  db.prepare('UPDATE dossiers SET nb_ecritures = (SELECT COUNT(*) FROM ecritures WHERE dossier_id = ?) WHERE id = ?').run(req.params.did, req.params.did);
  res.json({ ok: true });
});

// --- EXPORT CSV ---
app.get('/api/dossiers/:did/export', (req, res) => {
  const rows = db.prepare('SELECT * FROM ecritures WHERE dossier_id = ? ORDER BY date_operation, journal_code, compte').all(req.params.did);
  const header = 'Date operation;Date piece;Journal;N doc;Libelle;Compte;Sens;Montant;Tresorerie';
  const anomalies = [];
  const lines = [];
  let totalD = 0, totalC = 0;

  for (const e of rows) {
    const sens = e.sens || 'D';
    const montant = e.montant;

    if (!e.date_operation) { anomalies.push('Ligne ' + e.id + ': date operation vide'); continue; }
    if (montant === 0) continue;

    if (sens === 'D') totalD += montant;
    else totalC += montant;

    lines.push([
      e.date_operation, e.date_piece || '', e.journal_code, e.numero_doc || '',
      e.libelle, e.compte, sens, montant.toFixed(3), e.tresorerie || ''
    ].join(';'));
  }

  const diff = Math.round((totalD - totalC) * 1000) / 1000;
  if (Math.abs(diff) > 0.001) anomalies.push('DESEQUILIBRE: D=' + totalD.toFixed(3) + ' C=' + totalC.toFixed(3) + ' diff=' + diff.toFixed(3));

  const EXPORT_SENS = { '707200': 'C', '707219': 'C', '436711': 'C', '437500': 'C', '709500': 'D' };
  for (const e of rows) {
    if (e.montant === 0) continue;
    const expected = EXPORT_SENS[e.compte];
    if (expected && e.sens !== expected) {
      anomalies.push('MAUVAIS SENS: ' + e.compte + ' a sens=' + e.sens + ' au lieu de ' + expected + ' (ligne ' + e.id + ')');
    }
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ecritures_${req.params.did}.csv"`);
  res.send([header, ...lines].join('\n'));
});

// --- FACTURES ---
app.get('/api/dossiers/:did/factures', (req, res) => {
  res.json(db.prepare('SELECT * FROM factures WHERE dossier_id = ? ORDER BY date_facture, numero_facture').all(req.params.did));
});

app.post('/api/dossiers/:did/factures', (req, res) => {
  const b = req.body;
  const id = genId();
  const d = db.prepare('SELECT societe_id FROM dossiers WHERE id = ?').get(req.params.did);
  if (!d) return res.status(404).json({ error: 'Dossier non trouve' });
  db.prepare('INSERT INTO factures (id, dossier_id, societe_id, date_facture, numero_facture, client, total_ht_0, total_ht_19, tva_19, timbre, total_ttc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.did, d.societe_id, b.date_facture, b.numero_facture, b.client || '', b.total_ht_0 || 0, b.total_ht_19 || 0, b.tva_19 || 0, b.timbre || 1, b.total_ttc || 0);
  res.json({ id, ...b }, 201);
});

app.delete('/api/factures/:fid', (req, res) => {
  db.prepare('DELETE FROM factures WHERE id = ?').run(req.params.fid);
  res.json({ ok: true });
});

app.delete('/api/dossiers/:did/factures', (req, res) => {
  db.prepare('DELETE FROM factures WHERE dossier_id = ?').run(req.params.did);
  db.prepare("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = 'VT J.C'").run(req.params.did);
  db.prepare('UPDATE dossiers SET nb_ecritures = 0 WHERE id = ?').run(req.params.did);
  res.json({ ok: true });
});

// --- RAPPORT MODES (Vente par jour) ---
app.get('/api/dossiers/:did/rapport', (req, res) => {
  res.json(db.prepare('SELECT * FROM rapport_modes WHERE dossier_id = ? ORDER BY date_jour').all(req.params.did));
});

app.delete('/api/dossiers/:did/rapport', (req, res) => {
  db.prepare('DELETE FROM rapport_modes WHERE dossier_id = ?').run(req.params.did);
  res.json({ ok: true });
});

// --- EXCLUDED DAYS MANAGEMENT ---
app.get('/api/dossiers/:did/excluded', (req, res) => {
  const did = req.params.did;
  const factures = db.prepare('SELECT * FROM factures WHERE dossier_id = ? ORDER BY date_facture').all(did);
  const byDay = {};
  for (const f of factures) {
    if (!byDay[f.date_facture]) byDay[f.date_facture] = [];
    byDay[f.date_facture].push(f);
  }
  const results = [];
  for (const [date, dayFactures] of Object.entries(byDay)) {
    const dbRapport = db.prepare('SELECT * FROM rapport_modes WHERE dossier_id = ? AND date_jour = ?').get(did, date);
    const modes = dbRapport || RAPPORT_MODES_JUIN[date] || { especes: 0, tpe: 0, cheques: 0, bonsAchat: 0, avoir: 0, credit: 0 };
    const r = buildDayEcritures(date, dayFactures, modes, 'CLTS PASSAGERS');
    const ht0 = dayFactures.reduce((s, f) => s + (f.total_ht_0 || f.ht0 || 0), 0);
    const ht19 = dayFactures.reduce((s, f) => s + (f.total_ht_19 || f.ht19 || 0), 0);
    const tva = dayFactures.reduce((s, f) => s + (f.tva_19 || f.tva || 0), 0);
    const ttc = dayFactures.reduce((s, f) => s + (f.total_ttc || f.ttc || 0), 0);
    const timbres = dayFactures.reduce((s, f) => s + (f.timbre || 1), 0);
    const totalModes = (modes.especes || 0) + (modes.tpe || 0) + (modes.cheques || 0) + (modes.bonsAchat || 0) + (modes.avoir || 0) + (modes.credit || 0);
    const factureLines = dayFactures.map(f => ({
      num: f.numero_facture, client: f.client, ht0: f.total_ht_0 || f.ht0 || 0,
      ht19: f.total_ht_19 || f.ht19 || 0, tva: f.tva_19 || f.tva || 0, ttc: f.total_ttc || f.ttc || 0
    }));
    const proposedLines = r.excluded ? [] : r.lines.map(l => ({ compte: l.compte, sens: l.sens, montant: l.montant, libelle: l.libelle }));
    const debitSum = (modes.especes || 0) + (modes.tpe || 0) + (modes.cheques || 0) + (modes.bonsAchat || 0) + (modes.avoir || 0);
    const creditSum = tva + timbres + ht0 + ht19;
    const ecart = Math.round((debitSum - creditSum) * 1000) / 1000;
    results.push({
      date, ecart, excluded: EXCLUDED_DAYS.has(date),
      totalFactures: ttc, totalModes: totalModes, nbFactures: dayFactures.length,
      modes: { especes: modes.especes || 0, cheques: modes.cheques || 0, tpe: modes.tpe || 0, bonsAchat: modes.bonsAchat || 0, avoir: modes.avoir || 0, credit: modes.credit || 0 },
      factures: factureLines, proposedEcritures: proposedLines
    });
  }
  res.json(results);
});

app.post('/api/dossiers/:did/rapport/bulk', (req, res) => {
  const did = req.params.did;
  const d = db.prepare('SELECT societe_id FROM dossiers WHERE id = ?').get(did);
  if (!d) return res.status(404).json({ error: 'Dossier non trouve' });
  const rows = req.body.rows || req.body;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows[] requis' });
  const stmt = db.prepare('INSERT OR REPLACE INTO rapport_modes (id, dossier_id, date_jour, especes, cheques, tpe, bonsAchat, avoir, credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const txn = db.transaction(() => {
    for (const r of rows) {
      const date = r.date_jour || r.date;
      stmt.run(genId(), did, date, r.especes || 0, r.cheques || 0, r.tpe || 0, r.bonsAchat || 0, r.avoir || 0, r.credit || 0);
    }
  });
  txn();
  res.json({ ok: true, count: rows.length });
});

const rapportUpload = multer({ dest: uploadDir });
app.post('/api/dossiers/:did/rapport', rapportUpload.single('file'), async (req, res) => {
  const did = req.params.did;
  const d = db.prepare('SELECT societe_id FROM dossiers WHERE id = ?').get(did);
  if (!d) return res.status(404).json({ error: 'Dossier non trouve' });
  if (!req.file) return res.status(400).json({ error: 'Fichier requis' });
  try {
    const text = await extractTextFromPDF(req.file.path);
    const modes = parseRapport(text);
    if (!Object.keys(modes).length) return res.status(400).json({ error: 'Aucune ligne vente par jour detectee. Verifie le PDF.' });
    const stmt = db.prepare('INSERT OR REPLACE INTO rapport_modes (id, dossier_id, date_jour, especes, cheques, tpe, bonsAchat, avoir, credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const txn = db.transaction(() => {
      for (const [date, v] of Object.entries(modes)) stmt.run(genId(), did, date, v.especes, v.cheques, v.tpe, v.bonsAchat, v.avoir, v.credit || 0);
    });
    txn();
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, count: Object.keys(modes).length, modes });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: e.message });
  }
});

// --- GENERATE VT J.C ---
app.post('/api/dossiers/:did/generate-vtjc', (req, res) => {
  const did = req.params.did;
  const d = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(did);
  if (!d) return res.status(404).json({ error: 'Dossier non trouve' });

  const factures = db.prepare('SELECT * FROM factures WHERE dossier_id = ? ORDER BY date_facture, numero_facture').all(did);
  if (!factures.length) return res.status(400).json({ error: 'Aucune facture' });

  const journal = (req.body && req.body.journal === 'VT C') ? 'VT C' : 'VT J.C';
  db.prepare('DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = ?').run(did, journal);

  const byDay = {};
  for (const f of factures) {
    if (!byDay[f.date_facture]) byDay[f.date_facture] = [];
    byDay[f.date_facture].push(f);
  }

  const anomalies = [];
  const insertE = db.prepare('INSERT INTO ecritures (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte, sens, montant, tresorerie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const allEntries = [];

  const txn = db.transaction(() => {
    for (const [date, dayFactures] of Object.entries(byDay)) {
      const nums = dayFactures.map(f => f.numero_facture.replace(/[^0-9]/g, '')).sort((a, b) => a - b);
      const numPiece = nums.length === 1 ? 'FAC N' + nums[0] + '-26' : 'FAC N' + nums.join('-') + '-26';

      const clients = [...new Set(dayFactures.map(f => f.client).filter(Boolean))];
      const defaultLibelle = clients.length > 0 ? 'CLTS PASSAGERS/' + clients.join('/') : 'CLTS PASSAGERS';

      const dbRapport = db.prepare('SELECT especes, cheques, tpe, bonsAchat, avoir, credit FROM rapport_modes WHERE dossier_id = ? AND date_jour = ?').get(did, date);
      const modes = (req.body.modes && req.body.modes[date]) || dbRapport || RAPPORT_MODES_JUIN[date] || { especes: 0, tpe: 0, cheques: 0, bonsAchat: 0, avoir: 0, credit: 0 };

      const result = buildDayEcritures(date, dayFactures, modes, defaultLibelle, journal);
      if (result.excluded) {
        anomalies.push(result.anomaly);
        allEntries.push({ date, numPiece, excluded: true, ecart: 0, anomaly: result.anomaly });
        continue;
      }
      if (result.anomaly) anomalies.push(result.anomaly);

      for (const l of result.lines) {
        const lib = l.libelle || defaultLibelle;
        insertE.run(genId(), did, d.societe_id, journal, date, date, numPiece, lib, l.compte, l.sens, l.montant, null);
      }

      const dayD = result.lines.filter(l => l.sens === 'D').reduce((s, l) => s + l.montant, 0);
      const dayC = result.lines.filter(l => l.sens === 'C').reduce((s, l) => s + l.montant, 0);
      const dayDiff = Math.round((dayD - dayC) * 1000) / 1000;
      if (Math.abs(dayDiff) > 0.001) {
        anomalies.push({ date, numPiece, error: 'DESEQUILIBRE D=' + dayD.toFixed(3) + ' C=' + dayC.toFixed(3) + ' diff=' + dayDiff.toFixed(3) });
      }

      allEntries.push({ date, numPiece, libelle: defaultLibelle, totalHT0: result.totalHT0, totalHT19: result.totalHT19, tva19: result.tva19, timbres: result.timbres, ecart: result.ecart, lignes: result.lines });
    }

    db.prepare('UPDATE dossiers SET nb_ecritures = (SELECT COUNT(*) FROM ecritures WHERE dossier_id = ?) WHERE id = ?').run(did, did);
  });

  txn();
  res.json({ days: allEntries.length, entries: allEntries, anomalies });
});

// --- SEED JUNE 2026 ---
const JUIN_2026_DATA = [["2026/331","2026-06-01","99",3127.906,659.924,125.386,1.0,3914.22],["2026/333","2026-06-02","111",171.0,28.571,5.428,1.0,206.0],["2026/334","2026-06-02","99",3257.868,807.903,153.502,1.0,4220.27],["2026/336","2026-06-03","99",2391.302,698.74,132.761,1.0,3223.8],["2026/338","2026-06-04","99",2895.188,1215.378,230.922,1.0,4342.49],["2026/340","2026-06-05","99",3524.578,1030.509,195.797,1.0,4751.88],["2026/342","2026-06-06","99",3708.984,652.697,124.012,1.0,4486.69],["2026/344","2026-06-07","99",2898.148,1275.973,242.435,1.0,4417.56],["2026/347","2026-06-08","99",2879.048,479.414,91.089,1.0,3450.55],["2026/349","2026-06-09","99",2646.136,652.104,123.9,1.0,3423.14],["2026/351","2026-06-10","99",3536.484,652.523,123.979,1.0,4313.99],["2026/353","2026-06-11","99",2583.887,621.937,118.168,1.0,3324.99],["2026/356","2026-06-12","99",3969.01,801.939,152.368,1.0,4924.32],["2026/358","2026-06-13","99",3811.04,989.921,188.085,1.0,4990.05],["2026/360","2026-06-14","122",319.0,21.429,4.072,1.0,345.5],["2026/361","2026-06-14","99",2814.414,814.878,154.827,1.0,3785.12],["2026/363","2026-06-15","99",2452.36,1254.458,238.347,1.0,3946.17],["2026/364","2026-06-16","99",3485.033,661.094,125.608,1.0,4272.74],["2026/365","2026-06-17","99",4812.914,1037.571,197.138,1.0,6048.62],["2026/366","2026-06-18","102",717.0,0,0,1.0,718.0],["2026/367","2026-06-18","99",3110.988,926.051,175.95,1.0,4213.99],["2026/368","2026-06-19","99",3512.074,980.335,186.264,1.0,4679.67],["2026/369","2026-06-20","99",2989.332,923.702,175.503,1.0,4089.54],["2026/371","2026-06-21","99",3453.156,618.322,117.481,1.0,4189.96],["2026/373","2026-06-22","99",3291.031,863.538,164.072,1.0,4319.64],["2026/375","2026-06-23","99",2200.69,363.362,69.039,1.0,2634.09],["2026/377","2026-06-24","99",2838.909,868.238,164.965,1.0,3873.11],["2026/379","2026-06-25","99",2635.39,781.093,148.408,1.0,3565.89],["2026/381","2026-06-26","99",2447.91,654.201,124.298,1.0,3227.41],["2026/383","2026-06-27","99",3231.183,980.254,186.248,1.0,4398.69],["2026/385","2026-06-28","113",75.0,72.268,13.731,1.0,162.0],["2026/386","2026-06-28","99",3219.566,841.266,159.841,1.0,4221.67],["2026/388","2026-06-29","99",3856.605,688.152,130.749,1.0,4676.51],["2026/390","2026-06-30","99",2678.115,676.558,128.546,1.0,3484.22]];

// --- RAPPORT VENTE PAR JOUR (JDC - fallback hardcoded, DB rapport_modes has priority) ---
const RAPPORT_MODES_JUIN = {
  '2026-05-01': { especes: 1801.25, cheques: 4.00, tpe: 134.25, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-02': { especes: 2028.43, cheques: 3.00, tpe: 631.63, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-03': { especes: 2044.47, cheques: 4.00, tpe: 126.82, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-04': { especes: 2559.16, cheques: 4.00, tpe: 343.01, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-05': { especes: 1642.16, cheques: 3.00, tpe: 849.61, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-06': { especes: 3694.04, cheques: 6.00, tpe: 120.84, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-07': { especes: 2243.37, cheques: 4.00, tpe: 734.36, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-08': { especes: 1649.12, cheques: 3.00, tpe: 664.07, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-09': { especes: 1741.11, cheques: 4.00, tpe: 78.71, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-10': { especes: 1860.50, cheques: 4.00, tpe: 33.60, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-11': { especes: 2795.70, cheques: 4.00, tpe: 501.75, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-12': { especes: 1805.85, cheques: 3.00, tpe: 723.83, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-13': { especes: 1794.70, cheques: 5.00, tpe: 116.10, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-14': { especes: 2738.85, cheques: 5.00, tpe: 31.35, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-15': { especes: 3207.64, cheques: 4.00, tpe: 226.44, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-16': { especes: 1367.16, cheques: 3.00, tpe: 963.86, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-17': { especes: 1728.65, cheques: 4.00, tpe: 449.50, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-18': { especes: 2214.73, cheques: 3.00, tpe: 683.58, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-19': { especes: 2289.50, cheques: 4.00, tpe: 515.32, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-20': { especes: 1108.29, cheques: 2.00, tpe: 939.03, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-21': { especes: 1936.22, cheques: 3.00, tpe: 802.53, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-22': { especes: 2071.12, cheques: 4.00, tpe: 453.12, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-23': { especes: 2513.89, cheques: 4.00, tpe: 855.84, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-24': { especes: 2858.68, cheques: 5.00, tpe: 1.93, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-25': { especes: 3881.40, cheques: 7.00, tpe: 482.00, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-26': { especes: 4136.10, cheques: 7.00, tpe: 659.45, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-28': { especes: 740.80, cheques: 2.00, tpe: 285.40, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-29': { especes: 1732.87, cheques: 4.00, tpe: 15.62, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-30': { especes: 2657.96, cheques: 4.00, tpe: 238.26, bonsAchat: 0, avoir: 0, credit: 0 },
  '2026-05-31': { especes: 2498.30, cheques: 4.00, tpe: 368.89, bonsAchat: 0, avoir: 0, credit: 0 },
            '2026-06-01': { especes: 1463.71, cheques: 0.0, tpe: 1939.0, bonsAchat: 510.5, avoir: 0, credit: 178.50 },
  '2026-06-02': { especes: 2797.17, cheques: 0.0, tpe: 1514.55, bonsAchat: 112.55, avoir: 0, credit: 85.00 },
  '2026-06-03': { especes: 2175.5, cheques: 0.0, tpe: 880.9, bonsAchat: 166.4, avoir: 0, credit: 112.10 },
  '2026-06-04': { especes: 2282.52, cheques: 0.0, tpe: 1854.77, bonsAchat: 204.2, avoir: 0, credit: 128.30 },
  '2026-06-05': { especes: 2760.36, cheques: 0.0, tpe: 1644.15, bonsAchat: 380.35, avoir: 0, credit: 75.50 },
  '2026-06-06': { especes: 2579.34, cheques: 0.0, tpe: 1562.75, bonsAchat: 343.6, avoir: 0, credit: 67.00 },
  '2026-06-07': { especes: 1994.5, cheques: 0.0, tpe: 1974.55, bonsAchat: 423.0, avoir: 0, credit: 49.00 },
  '2026-06-08': { especes: 1689.0, cheques: 0.0, tpe: 1460.55, bonsAchat: 300.0, avoir: 0, credit: 79.00 },
  '2026-06-09': { especes: 1952.44, cheques: 0.0, tpe: 1351.0, bonsAchat: 149.2, avoir: 0, credit: 35.80 },
  '2026-06-10': { especes: 2328.48, cheques: 0.0, tpe: 1428.7, bonsAchat: 555.8, avoir: 0, credit: 211.20 },
  '2026-06-11': { especes: 1400.43, cheques: 0.0, tpe: 1598.55, bonsAchat: 325.0, avoir: 0, credit: 176.40 },
  '2026-06-12': { especes: 2935.52, cheques: 0.0, tpe: 1556.2, bonsAchat: 431.6, avoir: 0, credit: 0 },
  '2026-06-13': { especes: 2240.14, cheques: 25.5, tpe: 2544.6, bonsAchat: 240.8, avoir: 0, credit: 21.00 },
  '2026-06-14': { especes: 1943.91, cheques: 0.0, tpe: 1941.3, bonsAchat: 317.9, avoir: 0, credit: 75.50 },
  '2026-06-15': { especes: 2036.28, cheques: 0.0, tpe: 1471.8, bonsAchat: 437.09, avoir: 0, credit: 36.75 },
  '2026-06-16': { especes: 2473.53, cheques: 0.0, tpe: 1593.6, bonsAchat: 204.6, avoir: 0, credit: 109.80 },
  '2026-06-17': { especes: 3335.51, cheques: 0.0, tpe: 2519.15, bonsAchat: 192.95, avoir: 0, credit: 153.50 },
  '2026-06-18': { especes: 2831.32, cheques: 0.0, tpe: 1646.75, bonsAchat: 451.9, avoir: 0, credit: 47.00 },
  '2026-06-19': { especes: 2088.28, cheques: 5.0, tpe: 2235.9, bonsAchat: 349.5, avoir: 0, credit: 70.70 },
  '2026-06-20': { especes: 2446.43, cheques: 0.0, tpe: 1340.0, bonsAchat: 302.1, avoir: 0, credit: 85.20 },
  '2026-06-21': { especes: 2044.1, cheques: 64.6, tpe: 1933.25, bonsAchat: 147.0, avoir: 0, credit: 141.00 },
  '2026-06-22': { especes: 2086.75, cheques: 0.0, tpe: 1688.89, bonsAchat: 543.0, avoir: 0, credit: 45.10 },
  '2026-06-23': { especes: 1355.39, cheques: 0.0, tpe: 700.9, bonsAchat: 599.8, avoir: 0, credit: 32.60 },
  '2026-06-24': { especes: 2047.21, cheques: 0.0, tpe: 1756.5, bonsAchat: 68.4, avoir: 0, credit: 239.70 },
  '2026-06-25': { especes: 2384.7, cheques: 0.0, tpe: 788.28, bonsAchat: 391.9, avoir: 0, credit: 168.10 },
  '2026-06-26': { especes: 1565.61, cheques: 0.0, tpe: 1541.3, bonsAchat: 119.5, avoir: 0, credit: 279.50 },
  '2026-06-27': { especes: 2651.28, cheques: 0.0, tpe: 1594.1, bonsAchat: 132.5, avoir: 0, credit: 216.40 },
  '2026-06-28': { especes: 1727.16, cheques: 0.0, tpe: 2282.3, bonsAchat: 372.2, avoir: 0, credit: 96.30 },
  '2026-06-29': { especes: 2326.5, cheques: 30.0, tpe: 1999.5, bonsAchat: 319.5, avoir: 0, credit: 22.50 },
  '2026-06-30': { especes: 2008.42, cheques: 42.25, tpe: 1227.65, bonsAchat: 247.15, avoir: 0, credit: 47.20 },
};

app.post('/api/seed-juin-2026', (req, res) => {
  const d = db.prepare('SELECT id, societe_id FROM dossiers WHERE nom = ?').get('ANIMAL');
  if (!d) return res.status(404).json({ error: 'Dossier ANIMAL not found' });

  const existing = db.prepare('SELECT COUNT(*) as c FROM factures WHERE dossier_id = ?').get(d.id);
  if (existing.c > 0) {
    db.prepare('DELETE FROM ecritures WHERE dossier_id = ?').run(d.id);
    db.prepare('DELETE FROM factures WHERE dossier_id = ?').run(d.id);
  }
  db.prepare('DELETE FROM rapport_modes WHERE dossier_id = ?').run(d.id);

  const insertF = db.prepare('INSERT INTO factures (id, dossier_id, societe_id, date_facture, numero_facture, client, total_ht_0, total_ht_19, tva_19, timbre, total_ttc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertE = db.prepare('INSERT INTO ecritures (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte, sens, montant, tresorerie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

  const txn = db.transaction(() => {
    for (const [num, date, client, ht0, ht19, tva, timbre, ttc] of JUIN_2026_DATA) {
      insertF.run(genId(), d.id, d.societe_id, date, num, client, ht0, ht19, tva, timbre, ttc);
    }

    const byDay = {};
    for (const [num, date, client, ht0, ht19, tva, timbre, ttc] of JUIN_2026_DATA) {
      if (!byDay[date]) byDay[date] = [];
      byDay[date].push({ num, client, ht0, ht19, tva, ttc });
    }

    const insertR = db.prepare('INSERT OR REPLACE INTO rapport_modes (id, dossier_id, date_jour, especes, cheques, tpe, bonsAchat, avoir, credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [date, rapport] of Object.entries(RAPPORT_MODES_JUIN)) {
      if (rapport && rapport.especes > 0) {
        insertR.run(genId(), d.id, date, rapport.especes, rapport.cheques, rapport.tpe, rapport.bonsAchat, rapport.avoir, rapport.credit || 0);
      }
    }

    for (const [date, dayF] of Object.entries(byDay)) {
      const nums = dayF.map(f => f.num.split('/')[1]).sort((a, b) => a - b);
      const numPiece = nums.length === 1 ? 'FAC N' + nums[0] + '-26' : 'FAC N' + nums.join('-') + '-26';
      const defaultLibelle = 'CLTS PASSAGERS';
      
      const rapport = RAPPORT_MODES_JUIN[date] || { especes: 0, cheques: 0, tpe: 0, bonsAchat: 0, avoir: 0, credit: 0 };
      const result = buildDayEcritures(date, dayF, rapport, defaultLibelle);
      if (result.excluded) continue;

      for (const l of result.lines) {
        insertE.run(genId(), d.id, d.societe_id, 'VT J.C', date, date, numPiece, l.libelle || defaultLibelle, l.compte, l.sens, l.montant, null);
      }
    }

    db.prepare('UPDATE dossiers SET nb_ecritures = (SELECT COUNT(*) FROM ecritures WHERE dossier_id = ?) WHERE id = ?').run(d.id, d.id);
  });

  txn();
  res.json({ ok: true, factures: JUIN_2026_DATA.length });
});

// --- DASHBOARD ---
app.get('/api/dashboard', (req, res) => {
  const s = db.prepare('SELECT COUNT(*) as c FROM societes').get();
  const d = db.prepare('SELECT COUNT(*) as c FROM dossiers').get();
  const e = db.prepare('SELECT COUNT(*) as c FROM ecritures').get();
  const recent = db.prepare('SELECT d.*, s.raison_sociale FROM dossiers d LEFT JOIN societes s ON d.societe_id = s.id ORDER BY d.created_at DESC LIMIT 10').all();
  const animal = db.prepare('SELECT id FROM dossiers WHERE nom = ?').get('ANIMAL');
  res.json({ stats: { societes: s.c, dossiers: d.c, ecritures: e.c }, recentDossiers: recent, animalDossierId: animal?.id || null });
});

// SPA fallback + error handlers
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Multer error:', err.message);
    return res.status(400).json({ error: 'Upload error: ' + err.message });
  }
  next(err);
});
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'web/dist/index.html'));
  } else {
    next();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`EUREX tourne sur http://localhost:${PORT}`);
  try {
    const d = db.prepare('SELECT id, societe_id FROM dossiers WHERE nom = ?').get('ANIMAL');
    if (d) {
      const existing = db.prepare('SELECT COUNT(*) as c FROM factures WHERE dossier_id = ?').get(d.id);
      if (existing.c === 0) {
        console.log('Auto-seeding June 2026 data...');
        const insertF = db.prepare('INSERT INTO factures (id, dossier_id, societe_id, date_facture, numero_facture, client, total_ht_0, total_ht_19, tva_19, timbre, total_ttc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        const insertE = db.prepare('INSERT INTO ecritures (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte, sens, montant, tresorerie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        const insertR = db.prepare('INSERT OR REPLACE INTO rapport_modes (id, dossier_id, date_jour, especes, cheques, tpe, bonsAchat, avoir, credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        const txn = db.transaction(() => {
          for (const [num, date, client, ht0, ht19, tva, timbre, ttc] of JUIN_2026_DATA) {
            insertF.run(genId(), d.id, d.societe_id, date, num, client, ht0, ht19, tva, timbre, ttc);
          }
          for (const [date, rapport] of Object.entries(RAPPORT_MODES_JUIN)) {
            if (rapport && rapport.especes > 0) {
              insertR.run(genId(), d.id, date, rapport.especes, rapport.cheques, rapport.tpe, rapport.bonsAchat, rapport.avoir, rapport.credit || 0);
            }
          }
          const byDay = {};
          for (const [num, date, client, ht0, ht19, tva, timbre, ttc] of JUIN_2026_DATA) {
            if (!byDay[date]) byDay[date] = [];
            byDay[date].push({ num, client, ht0, ht19, tva, ttc });
          }
          for (const [date, dayF] of Object.entries(byDay)) {
            const nums = dayF.map(f => f.num.split('/')[1]).sort((a, b) => a - b);
            const numPiece = nums.length === 1 ? 'FAC N' + nums[0] + '-26' : 'FAC N' + nums.join('-') + '-26';
            const defaultLibelle = 'CLTS PASSAGERS';
            const rapport = RAPPORT_MODES_JUIN[date] || { especes: 0, cheques: 0, tpe: 0, bonsAchat: 0, avoir: 0, credit: 0 };
            const result = buildDayEcritures(date, dayF, rapport, defaultLibelle);
            if (result.excluded) continue;
            for (const l of result.lines) {
              insertE.run(genId(), d.id, d.societe_id, 'VT J.C', date, date, numPiece, l.libelle || defaultLibelle, l.compte, l.sens, l.montant, null);
            }
          }
          db.prepare('UPDATE dossiers SET nb_ecritures = (SELECT COUNT(*) FROM ecritures WHERE dossier_id = ?) WHERE id = ?').run(d.id, d.id);
        });
        txn();
        console.log('Auto-seed complete: 34 factures + ecritures + rapport_modes');
      } else {
        console.log(`Skipping seed: ${existing.c} factures already exist`);
      }
    }
  } catch (e) {
    console.error('Auto-seed failed:', e.message);
  }
});
