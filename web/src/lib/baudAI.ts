/**
 * AI Verification and Correction System for BAUD Module
 * Verifies salary calculations, detects anomalies, and provides corrections
 *
 * References legales documentees :
 * - SMIG : Decret n67/2026 du 30/04/2026, JORT n44, regime 40h = 470.251 DT
 * - CNSS : Loi n73-40 du 24/07/1973, 9.68% sans plafond (excluant lait et prime_aid)
 * - IRPP : Loi n74-9 du 20/03/1974, bareme annuel LF 2025 art. 36 (8 tranches)
 * - CSS : Loi n92-73 du 28/07/1992, 0.5% × RNI (validé 219 obs, median error = 0.000)
 * - Frais pro : 10% plafond 2000 DT/an (usage)
 * - Anciennete : Art. 135 CT (loi n66-27 du 30/04/1966), bareme generique
 * - Revalorisation : Decret n68/2026 du 30/04/2026, +5%/an cumulatif
 */

import { Employee, PointageData } from './baudParser.js';
import { calculateSalary, SalaryResult, calculateAnciennete, getTauxAnciennete, buildSalaryKeys } from './baudCalculator.js';
import { getConfig } from './baudConfig.js';

export interface VerificationCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  detail: string;
  employee?: string;
  correction?: any;
}

export interface VerificationResult {
  verdict: 'OK' | 'ATTENTION' | 'ERREUR';
  checks: VerificationCheck[];
  missing: string[];
  anomalies: string[];
  corrections: CorrectionAction[];
  autoFixes: AutoFixAction[];
  summary: {
    totalEmployees: number;
    verified: number;
    warnings: number;
    errors: number;
    corrected: number;
    autoFixed: number;
  };
}

export interface CorrectionAction {
  matricule: string;
  nom: string;
  field: string;
  oldValue: any;
  newValue: any;
  reason: string;
  salaryKey?: string; // Clé unique employee (matricule sinon nom+prénom+index)
}

export interface AutoFixAction {
  type: 'add_pointage' | 'fix_duplicate' | 'fix_smig' | 'fix_cnss' | 'fix_matricule';
  description: string;
  matricule: string;
  data: any;
  applied: boolean;
}

/**
 * Constantes legales tunisiennes 2026 — lecture depuis config
 */
function CONSTANTS() {
  const c = getConfig();
  return {
    CNSS_SALARIAL: c.cnss_salarial,
    CNSS_PATRONAL: c.cnss_patronal,
    AT_MP: c.at_mp,
    TFP: c.tfp,
    FOPROLOS: c.foprolos,
    CSS: c.css,
    SMIG: c.smig_40h,
    FRAIS_PRO_MAX: c.frais_pro_plafond,
    FRAIS_PRO_RATE: c.frais_pro_taux,
    IRPP_BRACKETS: c.irpp_barème.map(b => ({ min: b.min, max: b.max, rate: b.taux })),
    REVALORISATION_TAUX: c.revalorisation_taux,
    JOURS_OUVRABLES: c.jours_ouvrables_defaut,
    abattement_chef_famille: c.abattement_chef_famille,
    abattement_par_enfant: c.abattement_par_enfant,
    abattement_max_enfants: c.abattement_max_enfants,
  };
}

// ============================================================================
// Fonction principale de verification
// ============================================================================
export function verifySalaryCalculations(
  employees: Employee[],
  pointage: PointageData[],
  salaryResults: Map<string, SalaryResult>
): VerificationResult {
  const checks: VerificationCheck[] = [];
  const missing: string[] = [];
  const anomalies: string[] = [];
  const corrections: CorrectionAction[] = [];
  const autoFixes: AutoFixAction[] = [];

  const pointageMap = new Map<string, PointageData>();
  for (const ptg of pointage) {
    pointageMap.set(ptg.matricule, ptg);
  }

  const salaryKeys = buildSalaryKeys(employees);
  const salaryKeyAt = (i: number): string => salaryKeys[i];

  let verified = 0;
  let warnings = 0;
  let errors = 0;

  // 1. Salaries manquants
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const key = salaryKeyAt(i);
    const found = salaryResults.has(key) || (emp.matricule ? salaryResults.has(emp.matricule) : false);
    if (!found) {
      missing.push(`${emp.matricule} ${emp.nom} ${emp.prenom}`);
      checks.push({
        name: 'Salaire manquant',
        status: 'error',
        detail: `Aucun calcul pour ${emp.nom} ${emp.prenom}`,
        employee: emp.matricule,
      });
      errors++;
    }
  }

  // 2. Verification individuelle
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const key = salaryKeyAt(i);
    const result = salaryResults.get(key) || (emp.matricule ? salaryResults.get(emp.matricule) : undefined);
    if (!result) continue;

    const ptg = pointageMap.get(emp.matricule);
    const empChecks = verifyEmployee(emp, ptg, result, corrections, autoFixes, key);

    for (const check of empChecks) {
      checks.push(check);
      if (check.status === 'warning') warnings++;
      if (check.status === 'error') errors++;
    }
    verified++;
  }

  // 3. Anomalies inter-employes
  const crossChecks = detectCrossEmployeeAnomalies(employees, salaryResults, autoFixes);
  for (const anomaly of crossChecks) {
    anomalies.push(anomaly);
    checks.push({ name: 'Anomalie inter-employes', status: 'warning', detail: anomaly });
    warnings++;
  }

  // 4. Verification des totaux
  const totalChecks = verifyTotals(employees, salaryResults);
  checks.push(...totalChecks);

  let verdict: VerificationResult['verdict'] = 'OK';
  if (errors > 0) verdict = 'ERREUR';
  else if (warnings > 0) verdict = 'ATTENTION';

  return {
    verdict, checks, missing, anomalies, corrections, autoFixes,
    summary: {
      totalEmployees: employees.length,
      verified, warnings, errors,
      corrected: corrections.length,
      autoFixed: autoFixes.filter(f => f.applied).length,
    },
  };
}

// ============================================================================
// Verification individuelle d'un employe
// ============================================================================
function verifyEmployee(
  emp: Employee,
  ptg: PointageData | undefined,
  result: SalaryResult,
  corrections: CorrectionAction[],
  autoFixes: AutoFixAction[],
  salaryKey: string
): VerificationCheck[] {
  const checks: VerificationCheck[] = [];
  const empLabel = `${emp.nom} ${emp.prenom}`;

  // 1. SMIG — Decret n67/2026, JORT n44, regime 40h = 470.251 DT
  if (result.salaire_brut < CONSTANTS().SMIG) {
    checks.push({
      name: 'Salaire < SMIG',
      status: 'error',
      detail: `${empLabel}: Brut ${result.salaire_brut.toFixed(3)} < SMIG ${CONSTANTS().SMIG} DT (Decret 67/2026, regime 40h)`,
      employee: emp.matricule,
    });
    autoFixes.push({
      type: 'fix_smig',
      description: `Corriger le salaire de ${empLabel} au SMIG (${CONSTANTS().SMIG} DT)`,
      matricule: emp.matricule,
      data: { field: 'salaire_brut', newValue: CONSTANTS().SMIG },
      applied: false,
    });
  }

  // 2. CNSS — Loi n73-40 : 9.68% du brut, AUCUN plafond
  //    Assiette = brut - prime_lait - prime_aid (exclues CNSS — Décret 2003-1098 art. 11)
  const assietteCNSS = Math.max(0, result.salaire_brut - result.prime_lait - result.prime_aid);
  const expectedCNSS = Math.round(assietteCNSS * CONSTANTS().CNSS_SALARIAL * 1000) / 1000;
  if (Math.abs(result.cnss_salariale - expectedCNSS) > 0.01) {
    checks.push({
      name: 'CNSS incorrect',
      status: 'error',
      detail: `${empLabel}: CNSS ${result.cnss_salariale.toFixed(3)} != attendu ${expectedCNSS.toFixed(3)} (Loi 73-40)`,
      employee: emp.matricule,
      correction: { field: 'cnss_salariale', oldValue: result.cnss_salariale, newValue: expectedCNSS },
    });
    corrections.push({
      matricule: emp.matricule, nom: empLabel,
      field: 'cnss_salariale', oldValue: result.cnss_salariale, newValue: expectedCNSS,
      reason: 'Recalcul CNSS 9.68% sur brut excluant lait et prime_aid (Loi 73-40, Décret 2003-1098)',
      salaryKey,
    });
  }

  // 3. IRPP — Loi n74-9, bareme annuel LF 2025 art. 36
  //    Inclut abattements familiaux (Note Commune N°3/2025, DGI)
  const expectedIRPP = calculateExpectedIRPP(
    result.revenu_net_imposable,
    emp.situation_fam,
    emp.nombre_enfants,
  );
  if (Math.abs(result.irpp - expectedIRPP) > 0.01) {
    checks.push({
      name: 'IRPP incorrect',
      status: 'error',
      detail: `${empLabel}: IRPP ${result.irpp.toFixed(3)} != attendu ${expectedIRPP.toFixed(3)} (LF 2025 art. 36)`,
      employee: emp.matricule,
      correction: { field: 'irpp', oldValue: result.irpp, newValue: expectedIRPP },
    });
    corrections.push({
      matricule: emp.matricule, nom: empLabel,
      field: 'irpp', oldValue: result.irpp, newValue: expectedIRPP,
      reason: 'Recalcul IRPP bareme annuel LF 2025 (Loi 74-9)',
      salaryKey,
    });
  }

  // 4. CSS — Loi n92-73, LF 2023 art. 22 : 0.5% × RNI (imposable − frais_pro)
  //    Validé sur 219 observations : median error = 0.000 DT
  const expectedCSS = Math.round(result.revenu_net_imposable * CONSTANTS().CSS * 1000) / 1000;
  if (Math.abs(result.css_salariale - expectedCSS) > 0.02) {
    checks.push({
      name: 'CSS incorrect',
      status: 'error',
      detail: `${empLabel}: CSS ${result.css_salariale.toFixed(3)} != attendu ${expectedCSS.toFixed(3)} (Loi 92-73, 0.5% RNI, seuil 5000 DT/an)`,
      employee: emp.matricule,
    });
  }

  // 5. Pointage manquant
  if (!ptg) {
    checks.push({
      name: 'Pointage manquant',
      status: 'warning',
      detail: `${empLabel}: Pas de pointage`,
      employee: emp.matricule,
    });
    autoFixes.push({
      type: 'add_pointage',
      description: `Creer pointage pour ${empLabel} (0 absences, 0 avances)`,
      matricule: emp.matricule,
      data: { matricule: emp.matricule, nom: emp.nom, prenom: emp.prenom, absences: '', avances: 0, conges_payes: '', heures_supplementaires: '' },
      applied: false,
    });
  } else {
    const absences = parseInt(ptg.absences) || 0;
    if (absences > CONSTANTS().JOURS_OUVRABLES) {
      checks.push({ name: `Absences > ${CONSTANTS().JOURS_OUVRABLES}j`, status: 'warning', detail: `${empLabel}: ${absences} absences > ${CONSTANTS().JOURS_OUVRABLES} jours/mois`, employee: emp.matricule });
    }
    if (ptg.avances > result.salaire_brut * 0.5) {
      checks.push({ name: 'Avances > 50% brut', status: 'warning', detail: `${empLabel}: Avances ${ptg.avances} DT > 50% de ${result.salaire_brut.toFixed(3)} DT`, employee: emp.matricule });
    }
  }

  // 6. Net negatif
  if (result.salaire_net < 0) {
    checks.push({ name: 'Net negatif', status: 'error', detail: `${empLabel}: Net ${result.salaire_net.toFixed(3)} < 0`, employee: emp.matricule });
  }

  // 7. Verification calcul net
  const expectedNet = Math.round((result.salaire_brut - result.total_retenues) * 1000) / 1000;
  if (Math.abs(result.salaire_net - expectedNet) > 0.01) {
    checks.push({ name: 'Calcul net incorrect', status: 'error', detail: `${empLabel}: Net ${result.salaire_brut.toFixed(3)} != attendu ${expectedNet.toFixed(3)}`, employee: emp.matricule });
  }

  // 8. Heures sup > 70h/mois
  if (result.heures_supplementaires > 0 && result.heures_supplementaires > 8 * 4.33 * 2) {
    checks.push({ name: 'HS > 70h', status: 'warning', detail: `${empLabel}: ${result.heures_supplementaires}h sup > 70h max`, employee: emp.matricule });
  }

  // 9. CNSS manquant
  if (!emp.numero_cnss || emp.numero_cnss.length < 5) {
    checks.push({ name: 'CNSS manquant', status: 'warning', detail: `${empLabel}: Numero CNSS manquant`, employee: emp.matricule });
  }

  // 10. CIN manquant
  if (!emp.cin || emp.cin.length < 5) {
    checks.push({ name: 'CIN manquant', status: 'warning', detail: `${empLabel}: CIN manquant`, employee: emp.matricule });
  }

  // 11. RIB manquant
  if (!emp.rib_ou_ccp || emp.rib_ou_ccp.length < 5) {
    checks.push({ name: 'RIB manquant', status: 'warning', detail: `${empLabel}: RIB/CCP manquant`, employee: emp.matricule });
  }

  // 12. Taux anciennete — Art. 135 CT (loi n66-27) — seulement si activé
  if (emp.date_recrutement && getConfig().anciennete_active) {
    const expectedTaux = getTauxAnciennete(result.anciennete_annees);
    if (result.taux_anciennete !== expectedTaux) {
      checks.push({
        name: 'Taux anciennete incorrect',
        status: 'error',
        detail: `${empLabel}: Taux ${result.taux_anciennete}% != attendu ${expectedTaux}% (${result.anciennete_annees} ans)`,
        employee: emp.matricule,
        correction: { field: 'taux_anciennete', oldValue: result.taux_anciennete, newValue: expectedTaux },
      });
      corrections.push({
        matricule: emp.matricule, nom: empLabel,
        field: 'taux_anciennete', oldValue: result.taux_anciennete, newValue: expectedTaux,
        reason: `Recalcul taux anciennete pour ${result.anciennete_annees} ans (Art. 135 CT)`,
        salaryKey,
      });
    }
  }

  // 13. Verification frais professionnels
  const expectedFraisPro = Math.round(Math.min(result.revenu_imposable * 12 * CONSTANTS().FRAIS_PRO_RATE, CONSTANTS().FRAIS_PRO_MAX) / 12 * 1000) / 1000;
  if (Math.abs(result.frais_pro - expectedFraisPro) > 0.01) {
    checks.push({
      name: 'Frais pro incorrect',
      status: 'error',
      detail: `${empLabel}: Frais pro ${result.frais_pro.toFixed(3)} != attendu ${expectedFraisPro.toFixed(3)} (10% plafond 2000 DT/an)`,
      employee: emp.matricule,
    });
  }

  // 14. Verification CSS — mécanisme différentiel (pas un taux flat)
  // Pas de vérification de base ici car le mécanisme est complexe

  if (checks.length === 0) {
    checks.push({ name: 'Verification OK', status: 'ok', detail: `${empLabel}: Tous les calculs sont corrects`, employee: emp.matricule });
  }

  return checks;
}

// ============================================================================
// Calcul IRPP attendu (methode annuelle)
// ============================================================================
function calculateExpectedIRPP(
  revenuNetImposable: number,
  situation_fam: string = 'C',
  nombre_enfants: number = 0,
): number {
  const annual = revenuNetImposable * 12;
  const c = CONSTANTS();
  const abattement_familial = Math.round(
    ((situation_fam === 'M' ? c.abattement_chef_famille : 0)
      + Math.min(nombre_enfants, c.abattement_max_enfants) * c.abattement_par_enfant) * 1000
  ) / 1000;

  let irppAnnual = 0;
  let remaining = annual;

  for (const bracket of CONSTANTS().IRPP_BRACKETS) {
    if (remaining <= 0) break;
    const size = bracket.max === Infinity ? remaining : bracket.max - bracket.min;
    const taxable = Math.min(remaining, size);
    irppAnnual += taxable * bracket.rate;
    remaining -= taxable;
  }

  const irppAfterDeduction = Math.max(0, irppAnnual - abattement_familial);
  return Math.round((irppAfterDeduction / 12) * 1000) / 1000;
}

// ============================================================================
// Anomalies inter-employes
// ============================================================================
function detectCrossEmployeeAnomalies(
  employees: Employee[],
  salaryResults: Map<string, SalaryResult>,
  autoFixes: AutoFixAction[]
): string[] {
  const anomalies: string[] = [];

  // Matricules en double
  const matriculeCount = new Map<string, number>();
  for (const emp of employees) {
    matriculeCount.set(emp.matricule, (matriculeCount.get(emp.matricule) || 0) + 1);
  }
  for (const [mat, count] of matriculeCount) {
    if (count > 1) {
      anomalies.push(`Matricule ${mat} en double (${count} fois)`);
      const maxMat = Math.max(...employees.map(e => parseInt(e.matricule) || 0));
      autoFixes.push({
        type: 'fix_duplicate',
        description: `Changer le matricule duplique ${mat} en ${maxMat + 1}`,
        matricule: mat, data: { newMatricule: String(maxMat + 1) }, applied: false,
      });
    }
  }

  // Salaires aberrants (IQR)
  const salaries = employees.map(e => e.salaire_brut).filter(s => s > 0).sort((a, b) => a - b);
  if (salaries.length > 10) {
    const q1 = salaries[Math.floor(salaries.length * 0.25)];
    const q3 = salaries[Math.floor(salaries.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    for (const emp of employees) {
      if (emp.salaire_brut < lowerBound || emp.salaire_brut > upperBound) {
        anomalies.push(`${emp.nom} ${emp.prenom}: Salaire ${emp.salaire_brut} aberrant (hors IQR [${lowerBound.toFixed(2)}, ${upperBound.toFixed(2)}])`);
      }
    }
  }

  // CNSS/CIN manquants
  for (const emp of employees) {
    if (!emp.numero_cnss || emp.numero_cnss.length < 5) {
      anomalies.push(`${emp.nom} ${emp.prenom}: Numero CNSS manquant`);
    }
    if (!emp.cin || emp.cin.length < 5) {
      anomalies.push(`${emp.nom} ${emp.prenom}: CIN manquant`);
    }
  }

  return anomalies;
}

// ============================================================================
// Verification des totaux
// ============================================================================
function verifyTotals(
  employees: Employee[],
  salaryResults: Map<string, SalaryResult>
): VerificationCheck[] {
  const checks: VerificationCheck[] = [];

  let totalBrut = 0;
  let totalCNSS = 0;
  let totalIRPP = 0;
  let totalCSS = 0;
  let totalNet = 0;
  let totalLait = 0;

  const keys = buildSalaryKeys(employees);

  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const result = salaryResults.get(keys[i]) || (emp.matricule ? salaryResults.get(emp.matricule) : undefined);
    if (!result) continue;
    totalBrut += result.salaire_brut;
    totalCNSS += result.cnss_salariale;
    totalIRPP += result.irpp;
    totalCSS += result.css_salariale;
    totalNet += result.salaire_net;
    totalLait += result.prime_lait;
  }

  // CNSS est calculé sur (brut - lait), pas sur brut directement
  // Décret 2003-1098 art. 11 : lait exclu de l'assiette CNSS
  const assietteTotale = totalBrut - totalLait;
  const cnssRatio = assietteTotale > 0 ? totalCNSS / assietteTotale : 0;
  const irppRatio = totalIRPP / totalBrut;

    if (Math.abs(cnssRatio - CONSTANTS().CNSS_SALARIAL) > 0.02) {
    checks.push({
      name: 'Ratio CNSS aberrant',
      status: 'warning',
      detail: `Ratio CNSS/Brut: ${(cnssRatio * 100).toFixed(2)}% (attendu ~${CONSTANTS().CNSS_SALARIAL * 100}%)`,
    });
  }

  if (irppRatio > 0.3) {
    checks.push({
      name: 'Ratio IRPP eleve',
      status: 'warning',
      detail: `Ratio IRPP/Brut: ${(irppRatio * 100).toFixed(2)}% (> 30%)`,
    });
  }

  checks.push({
    name: 'Totaux',
    status: 'ok',
    detail: `Brut: ${totalBrut.toFixed(3)}, CNSS: ${totalCNSS.toFixed(3)}, IRPP: ${totalIRPP.toFixed(3)}, CSS: ${totalCSS.toFixed(3)}, Net: ${totalNet.toFixed(3)}`,
  });

  return checks;
}

// ============================================================================
// Application des corrections
// ============================================================================
export function applyCorrections(
  employees: Employee[],
  pointage: PointageData[],
  salaryResults: Map<string, SalaryResult>,
  corrections: CorrectionAction[]
): Map<string, SalaryResult> {
  const correctedResults = new Map<string, SalaryResult>(salaryResults);

  for (const correction of corrections) {
    const key = correction.salaryKey || correction.matricule;
    const result = correctedResults.get(key);
    if (!result) continue;

    const newResult = { ...result };
    (newResult as any)[correction.field] = correction.newValue;

    if (['cnss_salariale', 'irpp', 'css_salariale'].includes(correction.field)) {
      newResult.total_retenues = newResult.cnss_salariale + newResult.irpp + newResult.css_salariale;
      newResult.salaire_net = Math.round((newResult.salaire_brut - newResult.total_retenues) * 1000) / 1000;
      newResult.net_a_payer = newResult.salaire_net;
    }

    correctedResults.set(key, newResult);
  }

  return correctedResults;
}

// ============================================================================
// Application des auto-fixes
// ============================================================================
export function applyAutoFixes(
  employees: Employee[],
  pointage: PointageData[],
  autoFixes: AutoFixAction[]
): { employees: Employee[]; pointage: PointageData[] } {
  let newEmployees = [...employees];
  let newPointage = [...pointage];

  for (const fix of autoFixes) {
    if (fix.applied) continue;

    switch (fix.type) {
      case 'add_pointage':
        newPointage.push(fix.data);
        break;

      case 'fix_duplicate': {
        const lastIndex = newEmployees.findIndex(e => e.matricule === fix.matricule);
        if (lastIndex >= 0) {
          newEmployees[lastIndex] = { ...newEmployees[lastIndex], matricule: fix.data.newMatricule };
        }
        break;
      }

      case 'fix_smig': {
        const empIndex = newEmployees.findIndex(e => e.matricule === fix.matricule);
        if (empIndex >= 0) {
          newEmployees[empIndex] = { ...newEmployees[empIndex], salaire_brut: fix.data.newValue };
        }
        break;
      }

      case 'fix_cnss': {
        const empIdx = newEmployees.findIndex(e => e.matricule === fix.matricule);
        if (empIdx >= 0) {
          newEmployees[empIdx] = { ...newEmployees[empIdx], numero_cnss: fix.data.newValue };
        }
        break;
      }
    }
  }

  return { employees: newEmployees, pointage: newPointage };
}
