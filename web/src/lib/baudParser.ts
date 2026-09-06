/**
 * Parser for "Liste du personnel" Excel format (BAUD)
 * Reads DP sheet (employee list) and Pointage sheet (absences, avances, CP, HS)
 */

export interface Employee {
  matricule: string;
  nom: string;
  prenom: string;
  cin: string;
  date_naissance: string;
  situation_fam: string; // M=Marié, C=Célibataire, D=Divorcé, V=Veuf
  nombre_enfants: number;
  sexe: string; // 'H' ou 'F' — inféré du prénom (préfixe 'F' si féminin connu)
  echelon: string;
  categorie: string;
  badges: string;
  fonction: string;
  adresse: string;
  type_contrat: string; // CDI, CDD, etc.
  duree: string;
  numero_cnss: string;
  bq_ou_poste: string;
  rib_ou_ccp: string;
  salaire_brut: number;
  nouveau_salaire_brut: number; // Depuis Excel col U ("Nouveau Salaire Brut") OU édition manuelle
  // Source de vérité pour la priorité salaire_brut vs nouveau_salaire_brut :
  // - false (défaut) → nouveau_salaire_brut vient de l'import Excel (colonne U)
  // - true → nouveau_salaire_brut a été écrasé par une édition manuelle dans l'outil
  // Règle calculateAll : nouveau_salaire_brut prime sur salaire_brut
  //   UNIQUEMENT si salaire_manually_edited = true (édition manuelle > import Excel).
  //   Sinon on utilise salaire_brut du dernier import Excel tel quel.
  salaire_manually_edited?: boolean;
  date_sortie: string;
  date_recrutement: string;
  transport_plein: number; // Montant plein selon barème (92.800 ou 100.533)
  heures_nuit: number; // Nombre d'heures de nuit par mois (saisie manuelle)
}

export interface PointageData {
  matricule: string;
  nom: string;
  prenom: string;
  absences: string;
  avances: number;
  conges_payes: string;
  heures_supplementaires: string;
}

export interface ParsedFiche {
  employees: Employee[];
  pointage: PointageData[];
  mois: number;
  annee: number;
  source_file: string;
}

// Column indices for "Liste du personnel" DP sheet (0-based, header row at index 3)
const DP_COLUMNS: Record<string, number> = {
  matricule: 0,       // Col A: row number (used as matricule fallback)
  date_recrutement: 2, // Col C
  nom: 3,             // Col D
  prenom: 4,          // Col E
  cin: 5,             // Col F
  date_naissance: 6,  // Col G
  sf: 7,              // Col H: Situation familiale
  ne: 8,              // Col I: Nombre d'enfants
  echelon: 9,         // Col J
  categorie: 10,      // Col K
  badges: 11,         // Col L
  fonction: 12,       // Col M
  adresse: 13,        // Col N
  contrat: 14,        // Col O
  duree: 15,          // Col P
  cnss: 16,           // Col Q
  bq_poste: 17,       // Col R
  rib_ccp: 18,        // Col S
  salaire_brut: 19,   // Col T
  nouveau_brut: 20,   // Col U
  date_sortie: 21,    // Col V
};

const POINTAGE_COLUMNS: Record<string, number> = {
  matricule: 1,      // Col B: Mat
  nom: 2,            // Col C: NOM
  prenom: 3,         // Col D: Prénom
  absences: 4,       // Col E: ABSENCES
  telephone: 5,      // Col F: Telephone à réduire (ignoré)
  avances: 6,        // Col G: AVANCES
  conges_payes: 7,   // Col H: CONGES PAYES
  heures_sup: 8,     // Col I: HEURES SUPPLEMENTAIRES
};

function cleanStr(v: any): string {
  return String(v ?? '').trim();
}

function parseNum(v: any): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function detectDateMonthYear(filename: string): { mois: number; annee: number } | null {
  // Try to extract month/year from filename
  const months: Record<string, number> = {
    'janvier': 1, 'fevrier': 2, 'février': 2, 'mars': 3, 'avril': 4,
    'mai': 5, 'juin': 6, 'juillet': 7, 'aout': 8, 'août': 8,
    'septembre': 9, 'octobre': 10, 'novembre': 11, 'decembre': 12, 'décembre': 12
  };
  const lower = filename.toLowerCase();
  for (const [name, num] of Object.entries(months)) {
    if (lower.includes(name)) {
      const yearMatch = lower.match(/20\d{2}/);
      const annee = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear();
      return { mois: num, annee };
    }
  }
  return null;
}

/**
 * Inférence du sexe à partir du prénom (hypothèse, à valider avec le client)
 * Liste des prénoms féminins courants en Tunisie.
 * Si le prénom n'est pas reconnu, retourne 'H' par défaut (hypothèse conservative :
 * le chef de famille étant généralement masculin, on préfère déduire par défaut
 * pour ne pas fausser la CSS).
 */
function inferSexe(prenom: string): string {
  const p = prenom.trim().toUpperCase();
  const feminins = new Set([
    'FATMA', 'FATIMA', 'SALWA', 'NADA', 'AMINA', 'OLFA', 'MORTHADHA', 'MOURTADHA',
    'BAHIJA', 'NAJET', 'NABIHA', 'SAMIRA', 'LEILA', 'LAYLA', 'INJES', 'NADIA',
    'HABIBA', 'KAOUther', 'KAOUTHER', 'SANA', 'RIM', 'RIMEL', 'MONIA', 'MONIRA',
    'MAI', 'MAIE', 'FIRAS', 'HALIMA', 'NOUF', 'NOUF', 'MERIEM', 'MERIEME',
    'MARIEM', 'MARIEME', 'SARAH', 'SARA', 'INÈS', 'INES', 'ANIS', 'ANISSE',
    'WAFA', 'WAFAA', 'HEDA', 'HÈDA', 'EL HEDI', 'EL HEDY', 'AMANI', 'AMANIE',
    'SABAH', 'NABIHA', 'NABILA', 'ZOHRA', 'FADHEILA', 'FADHILA', 'MOUNIRA',
    'MOUNIRA', 'ZINEB', 'ZAYNEB', 'ZINEB', 'MAHBOUBA', 'THOURAYA', 'TOURAYA',
    'LAMIA', 'LAMIAA', 'HAYET', 'HAYETE', 'BOUCHRA', 'BOUCHRAA', 'MAISSA',
    'MAÏSSA', 'NDEYE', 'NDIAYE', 'AÏSSA', 'AÏSSATOU', 'HASSIBA', 'MALIKA',
    'MALIKAH', 'ASSIA', 'SIHEM', 'SAIDA', 'MOUSTADHA', 'MOUSTADJBA',
    'FAIZIA', 'FAOUZIA', 'GHAZALA', 'GHIZLANE', 'SOAD', 'SOUEAD', 'SOUIAD',
  ]);
  if (feminins.has(p)) return 'F';
  return 'H';
}

/**
 * Transport plein par défaut selon fonction (barème STE BAUD, juin 2026)
 * Vérifié empiriquement sur 21 employés × bulletin Sage
 * - Ouvrier: 92.800 DT
 * - Chef d'équipe / Conducteur d'engins: 100.533 DT
 */
function getTransportPlein(fonction: string): number {
  const f = fonction.toLowerCase();
  if (f.includes('chef') || f.includes('conducteur') || f.includes('engin')) {
    return 100.533;
  }
  return 92.800; // Default: ouvrier
}

export function parseFichePersonnel(workbook: any, filename: string): ParsedFiche {
  const employees: Employee[] = [];
  const pointage: PointageData[] = [];

  // Parse DP sheet
  const dpSheet = workbook.Sheets['DP'];
  if (dpSheet) {
    const data: any[][] = XLSX.utils.sheet_to_json(dpSheet, { header: 1, defval: '' });

    // Find header row (look for "Mat" or "Nom" in first 10 rows)
    let headerRow = 3;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (row && (String(row[1] || '').trim() === 'Mat' || String(row[3] || '').trim() === 'Nom')) {
        headerRow = i;
        break;
      }
    }

    // Parse employees from rows after header
    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const nom = cleanStr(row[DP_COLUMNS.nom]);
      const prenom = cleanStr(row[DP_COLUMNS.prenom]);
      if (!nom && !prenom) continue; // Skip empty rows

      // Skip former employees (date_sortie renseignée = export historique cumulé)
      const dateSortie = cleanStr(row[DP_COLUMNS.date_sortie]);
      if (dateSortie && dateSortie.length > 0) continue;

      // Matricule: use the "Mat" column (index 1) if present, otherwise use row number
      let matricule = cleanStr(row[1]);
      if (!matricule) {
        matricule = String(row[0] || i - headerRow);
      }

      const sf = cleanStr(row[DP_COLUMNS.sf]);
      let situationFam = 'C'; // Default: célibataire
      if (sf === 'M' || sf.toLowerCase().includes('mar')) situationFam = 'M';
      else if (sf === 'C' || sf.toLowerCase().includes('célib') || sf.toLowerCase().includes('celib')) situationFam = 'C';
      else if (sf === 'D' || sf.toLowerCase().includes('div')) situationFam = 'D';
      else if (sf === 'V' || sf.toLowerCase().includes('veuf')) situationFam = 'V';

      employees.push({
        matricule,
        nom: nom.toUpperCase(),
        prenom,
        cin: cleanStr(row[DP_COLUMNS.cin]),
        date_naissance: cleanStr(row[DP_COLUMNS.date_naissance]),
        situation_fam: situationFam,
        nombre_enfants: Math.max(0, Math.floor(parseNum(row[DP_COLUMNS.ne]))),
        sexe: inferSexe(prenom),
        echelon: cleanStr(row[DP_COLUMNS.echelon]),
        categorie: cleanStr(row[DP_COLUMNS.categorie]),
        badges: cleanStr(row[DP_COLUMNS.badges]),
        fonction: cleanStr(row[DP_COLUMNS.fonction]),
        adresse: cleanStr(row[DP_COLUMNS.adresse]),
        type_contrat: cleanStr(row[DP_COLUMNS.contrat]),
        duree: cleanStr(row[DP_COLUMNS.duree]),
        numero_cnss: cleanStr(row[DP_COLUMNS.cnss]),
        bq_ou_poste: cleanStr(row[DP_COLUMNS.bq_poste]),
        rib_ou_ccp: cleanStr(row[DP_COLUMNS.rib_ccp]),
        salaire_brut: parseNum(row[DP_COLUMNS.salaire_brut]),
        nouveau_salaire_brut: parseNum(row[DP_COLUMNS.nouveau_brut]),
        date_sortie: cleanStr(row[DP_COLUMNS.date_sortie]),
        date_recrutement: cleanStr(row[DP_COLUMNS.date_recrutement]),
        // Transport plein par défaut selon fonction (barème STE BAUD)
        transport_plein: getTransportPlein(cleanStr(row[DP_COLUMNS.fonction])),
        // Heures de nuit — saisie manuelle (pas dans le fichier Excel)
        heures_nuit: 0,
      });
    }
  }

  // Parse Pointage sheet
  const ptgSheet = workbook.Sheets['Pointage'];
  if (ptgSheet) {
    const data: any[][] = XLSX.utils.sheet_to_json(ptgSheet, { header: 1, defval: '' });

    let headerRow = 3;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (row && String(row[1] || '').trim() === 'Mat') {
        headerRow = i;
        break;
      }
    }

    // Pointage has alternating rows: data row + detail row
    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;

      const nom = cleanStr(row[POINTAGE_COLUMNS.nom]);
      const prenom = cleanStr(row[POINTAGE_COLUMNS.prenom]);
      if (!nom && !prenom) continue;

      let matricule = cleanStr(row[1]);
      if (!matricule) matricule = String(row[0] || '');

      // Skip detail rows (row after each employee, with phone loans etc.)
      const absences = cleanStr(row[POINTAGE_COLUMNS.absences]);
      const avances = parseNum(row[POINTAGE_COLUMNS.avances]);
      const cp = cleanStr(row[POINTAGE_COLUMNS.conges_payes]);
      const hs = cleanStr(row[POINTAGE_COLUMNS.heures_sup]);

      // Only add if has meaningful data
      if (absences || avances || cp || hs) {
        pointage.push({
          matricule,
          nom: nom.toUpperCase(),
          prenom,
          absences,
          avances,
          conges_payes: cp,
          heures_supplementaires: hs,
        });
      }
    }
  }

  const dateInfo = detectDateMonthYear(filename);

  return {
    employees,
    pointage,
    mois: dateInfo?.mois || new Date().getMonth() + 1,
    annee: dateInfo?.annee || new Date().getFullYear(),
    source_file: filename,
  };
}

// Re-export XLSX for the parser to use
import * as XLSX from 'xlsx';
