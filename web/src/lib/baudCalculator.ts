/**
 * Calculateur de salaire tunisien — Code du Travail 2026
 * CNSS, IRPP, CSS, Allocations familiales
 * Prime ancienneté (barème configurable) + Revalorisation légale décret 68/2026
 *
 * SYSTÈME UNIFIÉ DE PRORATISATION:
 *   coefficient_presence = jours_effectivement_payés / jours_ouvrables_théoriques
 *   montant_verse = montant_plein × coefficient_presence
 *
 *   Exceptions:
 *   - Transport: transport_plein × revalorisation × coefficient
 *   - Présence: présence_plein × revalorisation × coefficient
 *   - MIT: MIT_PLEIN (5000 DT) × coefficient (montant fixe, PAS un %)
 *   - Augmentation: montant fixe × coefficient (PAS de revalorisation)
 *
 * Ordre de calcul (sans dépendance circulaire):
 *   salaire_de_base
 *   → revalorisation légale (+5%/an sur base pour 2026-2028)
 *   → prime_ancienneté (sur base revalorisée)
 *   → coefficient_presence (jours_payés / jours_ouvrables)
 *   → primes légales (panier, douche, savon, lait, logement) = plein × coefficient
 *   → transport = plein × revalorisation × coefficient
 *   → présence = plein × revalorisation × coefficient
 *   → MIT = 5000 DT × coefficient (montant fixe)
 *   → augmentation = fixe × coefficient (pas de revalorisation)
 *   → nuit = fixe × coefficient
 *   → salaire_brut_total = base_rév + HS + prime_ancienneté + transport + présence + primes_légales + augmentation
 *   → assiettes CNSS (brut - lait - prime_aid) / IRPP / CSS (0.5% RNI, seuil 5000 DT/an)
 */

import { getConfig } from './baudConfig.js';

export interface SalaryInput {
  salaire_brut: number;
  situation_fam: string; // M=Marié, C=Célibataire, D=Divorcé, V=Veuf
  nombre_enfants: number; // Max 4 pour calcul
  sexe?: string; // 'H' ou 'F' — utilisé pour déduction chef famille CSS (hypothèse: seul le mari déclarant)
  absences_jours?: number; // Jours d'absence dans le mois
  heures_supplementaires?: number; // Nombre d'heures sup
  avances?: number; // Avances sur salaire
  // Nouveaux champs pour prime ancienneté et revalorisation
  date_recrutement?: string; // Date d'embauche (Excel serial ou YYYY-MM-DD)
  mois?: number; // Mois du bulletin (1-12)
  annee?: number; // Année du bulletin
  // Coefficient de présence — CLÉ DU SYSTÈME PRORATISATION
  // coefficient = jours_effectivement_payés / jours_ouvrables_théoriques
  // Si non renseigné: calculé depuis absences_jours (jours_ouvrables = 26 par défaut)
  jours_payes?: number; // Jours effectivement payés du mois
  jours_ouvrables?: number; // Jours ouvrables théoriques du mois (défaut: 26)
  // Transport — montant plein par salarié (appliquer revalorisation + coefficient)
  transport_plein?: number; // Montant plein mensuel transport (varie par salarié)
  // Primes légales — montants pleins mensuels (appliquer coefficient uniquement)
  prime_panier_plein?: number; // Panier plein (défaut: 12.320 DT)
  prime_douche_plein?: number; // Douche plein (défaut: 25.000 DT)
  prime_savon_plein?: number; // Savon plein (défaut: 5.400 DT)
  prime_lait_plein?: number; // Lait plein (défaut: 29.700 DT)
  prime_aid_plein?: number; // Prime d'aide (4717) — exclue de l'assiette CNSS si présente
  prime_logement_plein?: number; // Logement plein (défaut: 26.293 DT)
  prime_nuit_plein?: number; // Nuit plein (fixe par salarié, pas de formule horaire)
  mit_applicable?: boolean; // MIT applicable (défaut: true). false pour certains employés (LAZAAR, RHILI, etc.)
  // Heures de nuit — saisie manuelle (calcul: taux_horaire × heures_nuit × 1.25)
  heures_nuit?: number; // Nombre d'heures de nuit travaillées dans le mois
  // Augmentation — montants fixes DT par salarié, SANS revalorisation décret 68
  // Uniquement coefficient_presence appliqué
  augmentation_2025?: number; // Augmentation 2025 (rubrique 4100)
  augmentation_2026?: number; // Augmentation 2026 (rubrique 4101)
  // Champs legacy (compatibilité — les nouveaux champs ont priorité)
  ind_transport?: number; // Indemnité de transport (legacy, utilisée si transport_plein absent)
  prime_presence?: number; // Prime de présence (legacy)
  prime_nuit?: number; // Prime de nuit (legacy)
  prime_logement?: number; // Prime de logement (legacy)
  augmentation?: number; // Augmentation (legacy, combines 2025+2026)
}

export interface SalaryResult {
  // Gains
  salaire_de_base: number;        // Salaire de base (avant HS, primes)
  salaire_brut: number;           // Salaire brut total (base + HS + primes + transport + présence + primes légales)
  heures_supplementaires: number;
  majoration_hs: number;
  prime_anciennete: number;       // Montant de la prime d'ancienneté
  taux_anciennete: number;        // Taux applicable (en %)
  anciennete_annees: number;      // Nombre d'années d'ancienneté
  ind_transport: number;          // Indemnité de transport (après revalorisation × coefficient)
  prime_presence: number;         // Prime de présence (après revalorisation × coefficient)

  // Primes légales (Convention BTP) —统一 proratisées
  prime_panier: number;           // Panier = plein × coefficient
  prime_douche: number;           // Douche = plein × coefficient
  prime_savon: number;            // Savon = plein × coefficient (exclue CNSS)
  prime_nuit: number;             // Nuit = plein × coefficient
  prime_logement: number;         // Logement = plein × coefficient
  prime_lait: number;             // Lait = plein × coefficient (exclue CNSS)
  prime_aid: number;              // Prime d'aide (4717) = plein × coefficient (exclue CNSS)
  mit: number;                    // MIT = 5000 DT × coefficient (montant fixe, PAS un %)
  augmentation: number;           // Augmentation = fixe × coefficient (pas de revalorisation)

  // Coefficient de présence (pour affichage/debug)
  coefficient_presence: number;   // jours_payés / jours_ouvrables (1.0 = mois complet)

  // Assiette CNSS
  assiette_cnss: number;

  // Cotisations salariales
  cnss_salariale: number;     // 9.68% du brut (sans plafond, excluant lait et prime_aid)
  css_salariale: number;      // CSS = 0.5% × RNI (seuil 5000 DT/an, Loi 92-73, LF 2023 art. 22)

  // Revenu imposable
  revenu_imposable: number;   // Brut total - CNSS
  frais_pro: number;          // 10% plafonné à 2000 DT/an (166.67 DT/mois)
  revenu_net_imposable: number;

  // IRPP (barème progressif 8 tranches)
  irpp: number;

  // Charges patronales
  cnss_patronale: number;     // 17.07%
  at_mp: number;              // 0.5% (accidents du travail)
  tfp: number;                // 2% (Taxe Formation Professionnelle — BTP/industriel)
  foprolos: number;           // 1% (Fonds de Promotion des Logements)

  // Calcul final
  total_retenues: number;
  salaire_net: number;
  net_a_payer: number;

  // Détail IRPP par tranche
  irpp_detail: { tranche: string; taux: number; montant: number; impot: number }[];
}

// Barème IRPP annuel — lecture depuis config
// (les constantes hardcoded sont remplacées par getConfig())

// Lecture centralisée de la config — appelé à chaque calculateSalary
function cfg() { return getConfig(); }

/**
 * Calcule le nombre de jours ouvrés (lundi-vendredi) dans un mois donné.
 * NOTE: les jours fériés ne sont PAS soustraits (conformément au bulletin Sage).
 * @returns Nombre de jours ouvrés du mois
 */
export function calculateJoursOuvres(mois: number, annee: number): number {
  const daysInMonth = new Date(annee, mois, 0).getDate();
  let weekdays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(annee, mois - 1, d).getDay(); // 0=Dim, 1=Lun, ..., 6=Sam
    if (dow >= 1 && dow <= 5) weekdays++; // Lun-Ven
  }
  return Math.max(1, weekdays); // Au moins 1 jour
}

/**
 * Convertit une date (Excel serial ou YYYY-MM-DD) en objet Date
 */
function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  // Try YYYY-MM-DD format
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
  }

  // Try Excel serial number
  const serial = parseFloat(dateStr);
  if (!isNaN(serial) && serial > 25000 && serial < 50000) {
    // Excel date serial: days since 1900-01-01 (with leap year bug)
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + serial * 86400000);
  }

  // Try DD/MM/YYYY
  const dmyMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) {
    return new Date(parseInt(dmyMatch[3]), parseInt(dmyMatch[2]) - 1, parseInt(dmyMatch[1]));
  }

  return null;
}

/**
 * Calcule l'ancienneté en années à partir de la date de recrutement
 * @param dateRecrutement Date d'embauche (string)
 * @param mois Mois du bulletin (1-12)
 * @param annee Année du bulletin
 * @returns Nombre d'années d'ancienneté (arrondi au.floor)
 */
export function calculateAnciennete(dateRecrutement: string, mois: number, annee: number): number {
  const dateEmbauche = parseDate(dateRecrutement);
  if (!dateEmbauche) return 0;

  const dateBulletin = new Date(annee, mois - 1, 1);
  let anciennete = dateBulletin.getFullYear() - dateEmbauche.getFullYear();
  const monthDiff = dateBulletin.getMonth() - dateEmbauche.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && dateBulletin.getDate() < dateEmbauche.getDate())) {
    anciennete--;
  }

  return Math.max(0, anciennete);
}

/**
 * Détermine le taux de prime d'ancienneté selon le barème
 * @param ancienneteAnnees Nombre d'années d'ancienneté
 * @param bareme Barème configurable (tableau de {min_years, taux})
 * @returns Taux en pourcentage (ex: 5 pour 5%)
 */
export function getTauxAnciennete(ancienneteAnnees: number, bareme?: { min_years: number; taux: number }[]): number {
  const b = bareme || cfg().anciennete_bareme;
  let taux = 0;
  for (const palier of b) {
    if (ancienneteAnnees >= palier.min_years) {
      taux = palier.taux;
    }
  }
  return taux;
}

/**
 * Applique la revalorisation légale (+5%/an) sur une valeur pour une année donnée
 * Le décret 68/2026 prévoit une revalorisation cumulative: chaque année est calculée
 * sur les montants revalorisés de l'année précédente.
 * @param valeur Montant de base
 * @param anneeAnnée du bulletin
 * @param anneeBase Année de référence (2026 = pas de revalorisation)
 * @returns Montant revalorisé
 */
export function applyRevalorisation(valeur: number, annee: number, anneeBase: number = 2026): number {
  if (annee <= anneeBase) return valeur;
  const nbAnnees = annee - anneeBase;
  // Application cumulative: valeur × (1.05)^n
  return Math.round(valeur * Math.pow(1 + cfg().revalorisation_taux, nbAnnees) * 1000) / 1000;
}

/**
 * Calcule l'IRPP annuel selon le barème progressif 8 tranches (LF 2025 art. 36)
 * @param revenuAnnuelImposable Revenu annuel imposable
 * @param pointSupplementaire Nombre de points supplémentaires à ajouter aux taux (pour CSS: 1)
 * @returns { irpp_annuel, detail } — montant IRPP annuel et détail par tranche
 */
export function calculateIRPPAnnuel(
  revenuAnnuelImposable: number,
  pointSupplementaire: number = 0
): { irpp_annuel: number; detail: { tranche: string; taux: number; montant: number; impot: number }[] } {
  let irpp_annuel = 0;
  const detail: { tranche: string; taux: number; montant: number; impot: number }[] = [];
  let remaining = revenuAnnuelImposable;

  for (const bracket of cfg().irpp_barème) {
    if (remaining <= 0) break;
    const tranche_size = bracket.max === Infinity ? remaining : bracket.max - bracket.min;
    const taxable = Math.min(remaining, tranche_size);
    // CSS: +1 point par tranche → le taux augmente de 0.01 par tranche
    const tauxEffectif = Math.min(1, bracket.taux + pointSupplementaire * 0.01);
    const impot = Math.round(taxable * tauxEffectif * 1000) / 1000;
    irpp_annuel += impot;
    detail.push({
      tranche: bracket.max === Infinity ? `>${bracket.min}` : `${bracket.min}-${bracket.max}`,
      taux: tauxEffectif,
      montant: taxable,
      impot,
    });
    remaining -= taxable;
  }

  return { irpp_annuel, detail };
}

export function calculateSalary(input: SalaryInput): SalaryResult {
  const {
    salaire_brut: salaire_de_base_input,
    situation_fam,
    nombre_enfants,
    sexe,
    absences_jours = 0,
    heures_supplementaires = 0,
    avances = 0,
    date_recrutement = '',
    mois = 1,
    annee = 2026,
    // Nouveaux champs proratisation
    jours_payes: jours_payes_input,
    jours_ouvrables: jours_ouvrables_input,
    transport_plein: transport_plein_input,
    prime_panier_plein,
    prime_douche_plein,
    prime_savon_plein,
    prime_lait_plein,
    prime_aid_plein,
    prime_logement_plein,
    prime_nuit_plein: prime_nuit_plein_input,
    mit_applicable = true,
    heures_nuit = 0,
    augmentation_2025 = 0,
    augmentation_2026 = 0,
    // Champs legacy
    ind_transport: ind_transport_legacy,
    prime_presence: prime_presence_legacy,
    prime_nuit: prime_nuit_legacy,
    prime_logement: prime_logement_legacy,
    augmentation: augmentation_legacy = 0,
  } = input;

  // 1. Salaire de base (avant toute prime ou revalorisation)
  const salaire_de_base = Math.max(0, salaire_de_base_input);

  // 2. Application de la revalorisation légale (+5%/an pour 2026-2028)
  //    Décret n68/2026 : +5%/an cumulatif sur salaire de base
  const salaire_base_reval = applyRevalorisation(salaire_de_base, annee);

  // 3. Prime d'ancienneté (sur base REVALORISÉE, pas sur l'origine)
  const ancienneteAnnees = date_recrutement
    ? calculateAnciennete(date_recrutement, mois, annee)
    : 0;
  const tauxAnciennete = cfg().anciennete_active ? getTauxAnciennete(ancienneteAnnees) : 0;
  const prime_anciennete = Math.round(salaire_base_reval * tauxAnciennete / 100 * 1000) / 1000;

  // 4. Heures supplémentaires (Article 90 Code du Travail)
  const heures_par_mois = (40 * 52) / 12; // = 173.33h/mois pour régime 40h
  const taux_horaire = salaire_de_base / heures_par_mois;
  const hs_25 = Math.min(heures_supplementaires, cfg().hs_seuil_25h_sem * 4.33);
  const hs_50 = Math.max(0, heures_supplementaires - hs_25);
  const majoration_hs = Math.round((taux_horaire * hs_25 * cfg().hs_majoration_25 + taux_horaire * hs_50 * cfg().hs_majoration_50) * 1000) / 1000;

  // =====================================================================
  // 5. COEFFICIENT DE PRÉSENCE — Base de la proratisation unifiée
  // =====================================================================
  // coefficient = (jours_ouvrés - absences) / jours_ouvrés
  // jours_ouvrés = weekdays du mois - jours fériés (calculé automatiquement)
  // Source confirmée: bulletin Sage Paie juin 2026 (22 jours ouvrés)
  const jours_ouvrables = jours_ouvrables_input
    ?? (cfg().jours_ouvrables_fixe ? cfg().jours_ouvrables_defaut : (mois && annee ? calculateJoursOuvres(mois, annee) : cfg().jours_ouvrables_defaut));
  let coefficient_presence: number;
  if (jours_payes_input !== undefined && jours_payes_input !== null) {
    // Source fiable: pointage/badgeuse ou bulletin
    coefficient_presence = Math.min(1, Math.max(0, jours_payes_input / jours_ouvrables));
  } else {
    // Fallback: calcul depuis absences (jours_ouvrés - absences)
    const jours_travailles = Math.max(0, jours_ouvrables - absences_jours);
    coefficient_presence = Math.min(1, Math.max(0, jours_travailles / jours_ouvrables));
  }
  coefficient_presence = Math.round(coefficient_presence * 10000) / 10000;

  // =====================================================================
  // 6. TRANSPORT — plein × revalorisation × coefficient
  // =====================================================================
  // Le montant plein varie par salarié (pas de valeur unique entreprise)
  // Revalorisation décret 68/2026: +5%/an cumulatif depuis juin 2026
  // Application: transport_verse = transport_plein × revalorisation × coefficient_presence
  const transport_plein = transport_plein_input ?? ind_transport_legacy ?? 0;
  // Revalorisation transport: +5% à partir du mois/année configurés (décret 68/2026)
  const c = cfg();
  const revalApplique = (annee > c.revalorisation_debut_annee || (annee === c.revalorisation_debut_annee && mois >= c.revalorisation_debut_mois));
  const transport_reval = revalApplique
    ? Math.round(transport_plein * Math.pow(1 + c.revalorisation_taux, annee - (c.revalorisation_debut_annee - 1)) * 1000) / 1000
    : transport_plein;
  const ind_transport = Math.round(transport_reval * coefficient_presence * 1000) / 1000;

  // =====================================================================
  // 7. PRÉSENCE — plein × revalorisation × coefficient
  // =====================================================================
  // Montant plein: avant revalorisation → depuis revalorisation
  const presence_plein_base = revalApplique
    ? c.presence_plein_juin
    : c.presence_plein_avant_juin;
  const presence_plein = prime_presence_legacy ?? presence_plein_base;
  const presence_reval = applyRevalorisation(presence_plein, annee);
  const prime_presence = Math.round(presence_reval * coefficient_presence * 1000) / 1000;

  // =====================================================================
  // 8. PRIMES LÉGALES — plein × coefficient (PAS de revalorisation)
  // =====================================================================
  const prime_panier = Math.round((prime_panier_plein ?? cfg().prime_panier) * coefficient_presence * 1000) / 1000;
  const prime_douche = Math.round((prime_douche_plein ?? cfg().prime_douche) * coefficient_presence * 1000) / 1000;
  const prime_savon = Math.round((prime_savon_plein ?? cfg().prime_savon) * coefficient_presence * 1000) / 1000;
  const prime_lait = Math.round((prime_lait_plein ?? cfg().prime_lait) * coefficient_presence * 1000) / 1000;
  const prime_aid = Math.round((prime_aid_plein ?? 0) * coefficient_presence * 1000) / 1000;
  const prime_logement = Math.round((prime_logement_plein ?? prime_logement_legacy ?? cfg().prime_logement) * coefficient_presence * 1000) / 1000;

  // =====================================================================
  // 9. NUIT — heures_nuit × taux_horaire × 1.25 (majoration légale 25%)
  //     OU fixe × coefficient (fallback si pas d'heures renseignées)
  // =====================================================================
  let prime_nuit: number;
  if (heures_nuit > 0) {
    // Formule horaire : taux_horaire = base / (47.5h × 4 semaines) = base / 190
    const taux_horaire = salaire_de_base / 190;
    prime_nuit = Math.round(taux_horaire * heures_nuit * (1 + cfg().nuit_majoration) * 1000) / 1000;
  } else {
    // Fallback : montant fixe par salarié × coefficient présence
    const prime_nuit_plein = prime_nuit_plein_input ?? prime_nuit_legacy ?? 0;
    prime_nuit = Math.round(prime_nuit_plein * coefficient_presence * 1000) / 1000;
  }

  // =====================================================================
  // 10. AUGMENTATION — fixe × coefficient (PAS de revalorisation décret 68)
  // =====================================================================
  // Montants individuels historiques par salarié (négociation individuelle)
  // Vérifié: montant identique avant/après juin 2026
  const augmentation_2025_val = Math.max(0, augmentation_2025);
  const augmentation_2026_val = Math.max(0, augmentation_2026);
  const augmentation_legacy_val = (augmentation_2025_val + augmentation_2026_val) > 0
    ? augmentation_2025_val + augmentation_2026_val
    : augmentation_legacy;
  const augmentation = Math.round(augmentation_legacy_val * coefficient_presence * 1000) / 1000;

  // =====================================================================
  // 11. MIT — Montant fixe 5000 DT × coefficient_presence (PAS un %)
  // =====================================================================
  // Certains employés ont MIT=0 (LAZAAR, RHILI, SLIMEN, SIRAT) — contrôlé par mit_applicable
  const mit = mit_applicable
    ? Math.round(cfg().mit_plein * coefficient_presence * 1000) / 1000
    : 0;

  // =====================================================================
  // 12. SALAIRE BRUT TOTAL
  // =====================================================================
  // Confirmation bulletin Sage:
  // - Le Total Brut EXCLUT nuit (3802), HS (4113), rappel (5100)
  // - L'augmentation (4100) est INCLUSE dans le Total Brut
  const salaire_brut = Math.round((
    salaire_base_reval + majoration_hs + prime_anciennete
    + ind_transport + prime_presence
    + prime_panier + prime_douche + prime_savon + prime_lait + prime_logement
    + augmentation
  ) * 1000) / 1000;

  // 9. Assiette CNSS = Total Brut - prime_lait - prime_aid (exclues par Décret 2003-1098 art. 11)
  //    Confirmation bulletin Sage (19/19 employés exact):
  //    - Le Total Brut EXCLUT nuit (3802), HS (4113), rappel (5100)
  //    - L'augmentation (4100) est INCLUSE dans l'assiette CNSS
  //    - AUCUN plafond appliqué pour cette entreprise (testé sur AAMRI brut 6261)
  //    - Le savon/douche ne sont PAS exclus (testé empiriquement)
  const assiette_cnss = Math.max(0, salaire_brut - prime_lait - prime_aid);

  // 10. CNSS salarié (9.68% sur assiette, excluant lait — pas de plafond)
  const cnss_salariale = Math.round(assiette_cnss * cfg().cnss_salarial * 1000) / 1000;

  // 9. Revenu imposable (Brut total - CNSS)
  const revenu_imposable = Math.max(0, salaire_brut - cnss_salariale);

  // 10. Frais professionnels (10% plafonné à 2000 DT/an = 166.67 DT/mois)
  const frais_pro_annuel = Math.min(revenu_imposable * 12 * cfg().frais_pro_taux, cfg().frais_pro_plafond);
  const frais_pro = Math.round((frais_pro_annuel / 12) * 1000) / 1000;

  // 11. Revenu net imposable
  const revenu_net_imposable = Math.max(0, revenu_imposable - frais_pro);

  // 12. Calcul IRPP (barème progressif ANNUEL)
  // L'IRPP est calculé sur le revenu annuel imposable, puis divisé par 12
  const revenu_annuel_imposable = revenu_net_imposable * 12;
  const irppResult = calculateIRPPAnnuel(revenu_annuel_imposable);
  const irpp = Math.round((irppResult.irpp_annuel / 12) * 1000) / 1000;

  // 13. CSS — Loi n°92-73, confirmée LF 2023 art. 22 (prolongée 2023-2025)
  //     CSS = 0.5% × RNI (revenu net imposable = imposable − frais_pro)
  //     Validation : 219 observations (jan-août 2026), median error = 0.000 DT
  //     Hypothèse déductions familiales TESTÉE puis REJETTÉE par les données
  //     Sage — aucune déduction n'est appliquée au niveau mensuel.
  //     Seuil 5000 DT/an TESTÉ puis REJETTÉ — Sage applique le taux même
  //     pour les employés à faible revenu (ex-employés janvier).
  //
  //     Résidu documenté (blocker CSS-2) : N/A — formule validée à 100%.
  const css_salariale = Math.round(revenu_net_imposable * cfg().css * 1000) / 1000;

  // 14. Charges patronales (sur brut total incluant heures sup)
  const cnss_patronale = Math.round(salaire_brut * cfg().cnss_patronal * 1000) / 1000;
  const at_mp = Math.round(salaire_brut * cfg().at_mp * 1000) / 1000;
  const tfp = Math.round(salaire_brut * cfg().tfp * 1000) / 1000;
  const foprolos = Math.round(salaire_brut * cfg().foprolos * 1000) / 1000;

  // 15. Allocations familiales (crédit sur bulletin)
  let alloc_familiales = 0;
  if (situation_fam === 'M') {
    alloc_familiales += cfg().alloc_chef_famille;
    alloc_familiales += Math.min(nombre_enfants, cfg().alloc_enfants_max) * cfg().alloc_enfant;
  }
  alloc_familiales = Math.round(alloc_familiales * 1000) / 1000;

  // 16. Total retenues
  const total_retenues = Math.round((cnss_salariale + irpp + css_salariale + avances) * 1000) / 1000;

  // 17. Salaire net
  const salaire_net = Math.round((salaire_brut - total_retenues) * 1000) / 1000;

  // 18. Net à payer (salaire net + allocations familiales)
  const net_a_payer = Math.round((salaire_net + alloc_familiales) * 1000) / 1000;

  return {
    salaire_de_base: salaire_base_reval,
    salaire_brut,
    heures_supplementaires,
    majoration_hs,
    prime_anciennete,
    taux_anciennete: tauxAnciennete,
    anciennete_annees: ancienneteAnnees,
    ind_transport,
    prime_presence,

    // Primes légales
    prime_panier,
    prime_douche,
    prime_savon,
    prime_nuit,
    prime_logement,
    prime_lait,
    prime_aid,
    mit,
    augmentation,

    coefficient_presence,

    assiette_cnss,
    cnss_salariale,
    css_salariale,

    revenu_imposable,
    frais_pro,
    revenu_net_imposable,

    irpp,

    cnss_patronale,
    at_mp,
    tfp,
    foprolos,

    total_retenues,
    salaire_net,
    net_a_payer,

    irpp_detail: irppResult.detail,
  };
}

// ============================================================================
// RUBRIQUES SAGE PAIE 100 — Format d'importation "long" (1 ligne / salarié / rubrique)
// ============================================================================
// Structure de colonnes Excel attendue par Sage Paie 100 :
//   Matricule | Code Rubrique | Libellé | Valeur | Période
//
// ATTENTION : ces codes (1000, 2100, 2200, 4113, 4101) sont des codes standards
// Sage Paie. Vérifier le "format d'importation" configuré dans Sage Paie de
// l'entreprise (Menu Modules → Importation des données → format existant) avant
// toute utilisation en production. Les codes internes peuvent différer d'une
// installation à l'autre.
// ============================================================================

export interface SageRubrique {
  code: string;       // Code rubrique Sage (ex: "1000")
  libelle: string;    // Libellé lisible
  zone: string;       // Zone Sage (1=gain, 3=retenue, 5=crédit)
  type: 'gain' | 'retenue' | 'credit';
}

/**
 * Rubriques Sage Paie 100 confirmées pour l'export BAUD.
 *
 * Base légale de chaque rubrique documentée ci-dessous.
 */
export const SAGE_RUBRIQUES: Record<string, SageRubrique> = {
  // --- GAINS ---
  // Rubrique 1000 : Salaire de base
  // Base légale : contrat de travail individuel
  // Revalorisé selon Décret n°68/2026 (JORT n°44, 30/04/2026) : +5%/an cumulatif
  '1000': { code: '1000', libelle: 'SALAIRE DE BASE', zone: '1', type: 'gain' },

  // Rubrique 1100 : Salaire de base complémentaire (individuel)
  '1100': { code: '1100', libelle: 'SBASE COMPLEMENT', zone: '1', type: 'gain' },

  // Rubrique 2100 : Indemnité de transport
  // Base légale : Convention collective BTP tunisienne
  // Montant de référence 2026 : 95.002 DT/mois (source: paie-tunisie.com, non vérifié JORT)
  // Revalorisé selon Décret n°68/2026 : +5%/an cumulatif
  '2100': { code: '2100', libelle: 'IND TRANSPORT', zone: '1', type: 'gain' },

  // Rubrique 2200 : Indemnité de présence
  // Base légale : Convention collective BTP tunisienne
  // Montant de référence 2026 : 8.248 DT/mois (source: paie-tunisie.com, non vérifié JORT)
  // Revalorisé selon Décret n°68/2026 : +5%/an cumulatif
  '2200': { code: '2200', libelle: 'IND PRESENCE', zone: '1', type: 'gain' },

  // Rubrique 2202 : MIT — Contribution Maladie, Invalidité, Tuberculose
  // Montant fixe 5000 DT/mois × coefficient_presence (PAS un pourcentage)
  // Confirmé par bulletin Sage Paie
  '2202': { code: '2202', libelle: 'MIT', zone: '1', type: 'gain' },

  // Rubrique 2330 : Prime de panier légale
  // Base légale : Convention BTP — 800M/jour (sous condition 7h+ continues, pauses < 1h)
  // Montant bulletin : ~12 DT/mois (variable légèrement par employé)
  '2330': { code: '2330', libelle: 'PRIME PANIER', zone: '1', type: 'gain' },

  // Rubrique 3210 : Prime de douche
  // Base légale : Convention BTP — 600M/semaine (lieux sans douches ou déplacement)
  // Montant bulletin : ~24 DT/mois (variable légèrement)
  '3210': { code: '3210', libelle: 'PRIME DOUCHE', zone: '1', type: 'gain' },

  // Rubrique 3801 : Prime de savon
  // Exclue de l'assiette CNSS — Décret n°2003-1098 du 19/05/2003, Article 11
  // Montant bulletin : ~5.3 DT/mois (variable légèrement)
  '3801': { code: '3801', libelle: 'PRIME SAVON', zone: '1', type: 'gain' },

  // Rubrique 3802 : Prime de nuit
  // Variable par employé (travail de nuit ou déplacement)
  '3802': { code: '3802', libelle: 'PRIME NUIT', zone: '1', type: 'gain' },

  // Rubrique 4100 : Augmentation 2025 (revalorisation 5% — Décret n°68/2026)
  // Appliquée rétroactivement au 01/01/2026
  '4100': { code: '4100', libelle: 'AUGMENTATION 2025', zone: '1', type: 'gain' },

  // Rubrique 4101 : Augmentation individuelle 2026
  // Montant individuel négocié, PAS calculé automatiquement
  // À ne pas confondre avec la prime d'ancienneté
  '4101': { code: '4101', libelle: 'AUGMENTATION 2026', zone: '1', type: 'gain' },

  // Rubrique 4113 : Heures supplémentaires 100%
  // Base légale : Code du travail, article 90
  // Majoration 25% jusqu'à 8h/semaine, 50% au-delà
  '4113': { code: '4113', libelle: 'HEURES SUP 100%', zone: '1', type: 'gain' },

  // Rubrique 4120 : Prime d'ancienneté (DÉSACTIVÉE PAR DÉFAUT)
  // Base légale : Code du travail, article 135 (loi n°66-27 du 30/04/1966)
  // Barème générique (aucun texte BTP spécifique trouvé) :
  //   < 3 ans: 0% | 3-6 ans: 5% | 6-9 ans: 10% | ≥ 9 ans: 15%
  // IMPORTANT : ce barème n'est PAS un texte légal obligatoire pour le BTP.
  // À ajuster si un avenant BTP est trouvé. Désactivé par défaut car représente
  // un nouveau coût absent de la paie actuelle de l'entreprise.
  '4120': { code: '4120', libelle: 'PRIME ANCIENNETE', zone: '1', type: 'gain' },

  // Rubrique 4383 : Prime de logement
  // Variable par employé (montant fixe mensuel)
  '4383': { code: '4383', libelle: 'PRIME LOGEMENT', zone: '1', type: 'gain' },

  // Rubrique 4385 : Prime de lait
  // Exclue de l'assiette CNSS — Décret n°2003-1098 du 19/05/2003, Article 11
  // Montant bulletin : ~29 DT/mois (variable légèrement)
  '4385': { code: '4385', libelle: 'PRIME LAIT', zone: '1', type: 'gain' },

  // --- RETENUES ---
  // Rubrique 3100 : CNSS salarié (part salariale)
  // Base légale : Loi n°73-40 du 24/07/1973 modifiée
  // Taux : 9.68% du salaire brut, sans plafond
  // Assiette = brut - prime_lait - prime_aid (exclues CNSS — Décret 2003-1098 art. 11)
  '3100': { code: '3100', libelle: 'CNSS SALARIALE', zone: '3', type: 'retenue' },

  // Rubrique 3310 : IRPP
  // Base légale : Loi n°74-9 du 20/03/1974 modifiée, barème LF 2025 art. 36
  // Calcul annuel : revenu_net_imposable × 12 → barème 8 tranches → / 12
  '3310': { code: '3310', libelle: 'IRPP', zone: '3', type: 'retenue' },

  // Rubrique 3320 : CSS (Cotisation de Solidarité Sociale)
  // Base légale : Loi n°92-73 du 28/07/1992, confirmée LF 2023 art. 22
  // Taux : 0.5% du revenu net imposable, seuil 5000 DT/an
  '3320': { code: '3320', libelle: 'CSS', zone: '3', type: 'retenue' },

  // --- CRÉDITS ---
  // Rubrique 5100 : Allocations familiales
  // Base légale : Loi n°82-26 du 12/04/1982
  // Chef de famille: 25 DT/mois + 8.333 DT/mois par enfant (max 4)
  '5100': { code: '5100', libelle: 'ALLOC FAMILIALES', zone: '5', type: 'credit' },
};

export interface SageExportRow {
  matricule: string;
  code_rubrique: string;
  libelle: string;
  valeur: number;
  periode: string; // format "MM/YYYY"
}

export interface ControlReportItem {
  matricule: string;
  nom: string;
  prenom: string;
  type: 'ok' | 'warning' | 'error';
  message: string;
  detail?: string;
}

export interface SageExportResult {
  rows: SageExportRow[];
  controlReport: ControlReportItem[];
  smigViolations: { matricule: string; nom: string; brut: number; smig: number }[];
  summary: {
    totalRows: number;
    totalEmployees: number;
    rubriquesGenerated: string[];
    smigViolations: number;
    warnings: number;
    errors: number;
  };
}

/**
 * Génère le fichier d'importation Sage Paie 100 (format "long").
 *
 * Structure : une ligne par salarié par rubrique.
 * Format de colonnes attendu par Sage :
 *   Matricule | Code Rubrique | Libellé | Valeur | Période
 *
 * Rubriques générées :
 *   - 1000 : Salaire de base (après revalorisation décret 68/2026)
 *   - 2100 : Indemnité de transport (après revalorisation)
 *   - 2200 : Indemnité de présence (après revalorisation)
 *   - 4113 : Heures supplémentaires (si > 0)
 *   - 4120 : Prime d'ancienneté (SEULEMENT si prime_anciennete.enabled = true)
 *   - 3100 : CNSS salarié
 *   - 3310 : IRPP
 *   - 3320 : CSS
 *   - 5100 : Allocations familiales (si marié + enfants)
 *
 * @param employees Liste des employés (depuis le parser Excel)
 * @param pointage Données de pointage
 * @param salaryResults Résultats des calculs de salaire
 * @param mois Mois du bulletin (1-12)
 * @param annee Année du bulletin
 * @param primeAncienneteEnabled Flag global : activer la prime d'ancienneté (default: false)
 * @returns Résultat avec lignes Excel, rapport de contrôle, violations SMIG
 */
export function generateSagePaieExport(
  employees: { matricule: string; nom: string; prenom: string; nouveau_salaire_brut: number; salaire_brut: number }[],
  pointage: { matricule: string; avances: number; absences: string; heures_supplementaires: string; conges_payes: string }[],
  salaryResults: Map<string, SalaryResult>,
  mois: number,
  annee: number,
  primeAncienneteEnabled: boolean = false
): SageExportResult {
  const rows: SageExportRow[] = [];
  const controlReport: ControlReportItem[] = [];
  const smigViolations: SageExportResult['smigViolations'] = [];
  const periode = `${String(mois).padStart(2, '0')}/${annee}`;

  // SMIG applicable pour l'année
  const smigApplicable = cfg().smig_40h;

  const rubriquesUsed = new Set<string>();
  let warnings = 0;
  let errors = 0;

  for (const emp of employees) {
    const result = salaryResults.get(emp.matricule);
    if (!result) {
      controlReport.push({
        matricule: emp.matricule, nom: emp.nom, prenom: emp.prenom,
        type: 'error', message: `Aucun calcul de salaire pour ${emp.nom} ${emp.prenom}`,
      });
      errors++;
      continue;
    }

    const ptg = pointage.find(p => p.matricule === emp.matricule);

    // --- CONTRÔLE SMIG ---
    // Décret n°2026-67 du 30/04/2026 : salaire brut ne peut être inférieur au SMIG
    // Régime 40h/semaine : 470,251 DT/mois (2026)
    // Avertissement BLOQUANT : ne pas laisser passer silencieusement
    if (result.salaire_brut < smigApplicable) {
      smigViolations.push({
        matricule: emp.matricule,
        nom: `${emp.nom} ${emp.prenom}`,
        brut: result.salaire_brut,
        smig: smigApplicable,
      });
      controlReport.push({
        matricule: emp.matricule, nom: emp.nom, prenom: emp.prenom,
        type: 'error',
        message: `Salaire brut ${result.salaire_brut.toFixed(3)} DT < SMIG ${smigApplicable} DT (régime 40h)`,
        detail: `Décret n°67/2026, JORT n°44. Corriger le salaire de base avant export.`,
      });
      errors++;
    }

    // --- CONTRÔLE ÉCART BRUT ---
    // Log/rapport de contrôle : écarts entre brut calculé et dernier brut connu
    const brutConnu = emp.nouveau_salaire_brut > 0 ? emp.nouveau_salaire_brut : emp.salaire_brut;
    if (brutConnu > 0) {
      const ecart = Math.abs(result.salaire_brut - brutConnu);
      const ecartPct = (ecart / brutConnu) * 100;
      if (ecartPct > 10) {
        controlReport.push({
          matricule: emp.matricule, nom: emp.nom, prenom: emp.prenom,
          type: 'warning',
          message: `Écart brut calculé vs connu : ${ecart.toFixed(3)} DT (${ecartPct.toFixed(1)}%)`,
          detail: `Brut calculé: ${result.salaire_brut.toFixed(3)} | Brut connu Excel: ${brutConnu.toFixed(3)}`,
        });
        warnings++;
      }
    }

    // --- CONTRÔLE MATRICULE ---
    if (!emp.matricule || emp.matricule.length < 3) {
      controlReport.push({
        matricule: emp.matricule || '(vide)', nom: emp.nom, prenom: emp.prenom,
        type: 'warning',
        message: `Matricule "${emp.matricule}" trop court ou vide — vérifier correspondance Sage`,
      });
      warnings++;
    }

    // --- GÉNÉRATION DES LIGNES RUBRIQUES ---

    // 1000 : Salaire de base (revalorisé)
    // Décret n°68/2026 : +5%/an cumulatif sur salaire de base
    rows.push({
      matricule: emp.matricule,
      code_rubrique: '1000',
      libelle: SAGE_RUBRIQUES['1000'].libelle,
      valeur: result.salaire_de_base,
      periode,
    });
    rubriquesUsed.add('1000');

    // 2100 : Indemnité de transport (revalorisée)
    // Convention BTP + Décret 68/2026
    if (result.ind_transport > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '2100',
        libelle: SAGE_RUBRIQUES['2100'].libelle,
        valeur: result.ind_transport,
        periode,
      });
      rubriquesUsed.add('2100');
    }

    // 2200 : Indemnité de présence (revalorisée)
    // Convention BTP + Décret 68/2026
    if (result.prime_presence > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '2200',
        libelle: SAGE_RUBRIQUES['2200'].libelle,
        valeur: result.prime_presence,
        periode,
      });
      rubriquesUsed.add('2200');
    }

    // 2202 : MIT — Montant fixe 5000 DT × coefficient
    if (result.mit > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '2202',
        libelle: SAGE_RUBRIQUES['2202'].libelle,
        valeur: result.mit,
        periode,
      });
      rubriquesUsed.add('2202');
    }

    // 2330 : Prime de panier légale
    // Convention BTP : 800M/jour (sous condition 7h+ continues)
    if (result.prime_panier > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '2330',
        libelle: SAGE_RUBRIQUES['2330'].libelle,
        valeur: result.prime_panier,
        periode,
      });
      rubriquesUsed.add('2330');
    }

    // 3210 : Prime de douche
    // Convention BTP : 600M/semaine (lieux sans douches ou déplacement)
    if (result.prime_douche > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '3210',
        libelle: SAGE_RUBRIQUES['3210'].libelle,
        valeur: result.prime_douche,
        periode,
      });
      rubriquesUsed.add('3210');
    }

    // 3801 : Prime de savon (exclue CNSS — Décret 2003-1098 art. 11)
    if (result.prime_savon > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '3801',
        libelle: SAGE_RUBRIQUES['3801'].libelle,
        valeur: result.prime_savon,
        periode,
      });
      rubriquesUsed.add('3801');
    }

    // 3802 : Prime de nuit (variable par employé)
    if (result.prime_nuit > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '3802',
        libelle: SAGE_RUBRIQUES['3802'].libelle,
        valeur: result.prime_nuit,
        periode,
      });
      rubriquesUsed.add('3802');
    }

    // 4383 : Prime de logement (variable par employé)
    if (result.prime_logement > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '4383',
        libelle: SAGE_RUBRIQUES['4383'].libelle,
        valeur: result.prime_logement,
        periode,
      });
      rubriquesUsed.add('4383');
    }

    // 4385 : Prime de lait (exclue CNSS — Décret 2003-1098 art. 11)
    if (result.prime_lait > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '4385',
        libelle: SAGE_RUBRIQUES['4385'].libelle,
        valeur: result.prime_lait,
        periode,
      });
      rubriquesUsed.add('4385');
    }

    // 4100 : Augmentation 2025 (revalorisation 5% — Décret n°68/2026)
    // Montant saisi manuellement dans Sage Paie — pas de formule automatique
    // Incluse dans le brut total et l'assiette CNSS (confirmé bulletin Sage)
    if (result.augmentation > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '4100',
        libelle: SAGE_RUBRIQUES['4100'].libelle,
        valeur: result.augmentation,
        periode,
      });
      rubriquesUsed.add('4100');
    }

    // 4113 : Heures supplémentaires
    // Code du travail, article 90 : majoration 25% (≤8h/sem) ou 50% (>8h/sem)
    if (result.heures_supplementaires > 0 && result.majoration_hs > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '4113',
        libelle: SAGE_RUBRIQUES['4113'].libelle,
        valeur: result.majoration_hs,
        periode,
      });
      rubriquesUsed.add('4113');
    }

    // 4120 : Prime d'ancienneté (UNIQUEMENT si activée)
    // Code du travail art. 135 (loi n°66-27 du 30/04/1966)
    // Barème générique : <3ans=0%, 3-6ans=5%, 6-9ans=10%, ≥9ans=15%
    // DÉSACTIVÉE PAR DÉFAUT — nouveau coût absent de la paie actuelle
    if (primeAncienneteEnabled && result.prime_anciennete > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '4120',
        libelle: SAGE_RUBRIQUES['4120'].libelle,
        valeur: result.prime_anciennete,
        periode,
      });
      rubriquesUsed.add('4120');
    }

    // 3100 : CNSS salarié
    // Loi n°73-40 : 9.68% du brut, sans plafond
    // Assiette = brut - prime_lait - prime_aid (exclues CNSS — Décret 2003-1098 art. 11)
    if (result.cnss_salariale > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '3100',
        libelle: SAGE_RUBRIQUES['3100'].libelle,
        valeur: result.cnss_salariale,
        periode,
      });
      rubriquesUsed.add('3100');
    }

    // 3310 : IRPP
    // Loi n°74-9, barème annuel LF 2025 art. 36 (8 tranches)
    if (result.irpp > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '3310',
        libelle: SAGE_RUBRIQUES['3310'].libelle,
        valeur: result.irpp,
        periode,
      });
      rubriquesUsed.add('3310');
    }

    // 3320 : CSS — 0.5% du revenu net imposable (seuil 5000 DT/an)
    // Loi n°92-73, LF 2023 art. 22
    if (result.css_salariale > 0) {
      rows.push({
        matricule: emp.matricule,
        code_rubrique: '3320',
        libelle: SAGE_RUBRIQUES['3320'].libelle,
        valeur: result.css_salariale,
        periode,
      });
      rubriquesUsed.add('3320');
    }

    // 5100 : Allocations familiales
    // Loi n°82-26 : 25 DT/mois chef de famille + 8.333 DT/mois/enfant (max 4)
    if (result.net_a_payer > result.salaire_net) {
      const alloc = Math.round((result.net_a_payer - result.salaire_net) * 1000) / 1000;
      if (alloc > 0) {
        rows.push({
          matricule: emp.matricule,
          code_rubrique: '5100',
          libelle: SAGE_RUBRIQUES['5100'].libelle,
          valeur: alloc,
          periode,
        });
        rubriquesUsed.add('5100');
      }
    }

    // --- LIGNE AVANCES (si présence dans pointage) ---
    // Pas de rubrique Sage standard définie — à configurer dans Sage
    if (ptg && ptg.avances > 0) {
      controlReport.push({
        matricule: emp.matricule, nom: emp.nom, prenom: emp.prenom,
        type: 'warning',
        message: `Avance ${ptg.avances} DT — rubrique non exportée (configurez le code Sage dans config.json)`,
      });
      warnings++;
    }
  }

  return {
    rows,
    controlReport,
    smigViolations,
    summary: {
      totalRows: rows.length,
      totalEmployees: employees.length,
      rubriquesGenerated: Array.from(rubriquesUsed).sort(),
      smigViolations: smigViolations.length,
      warnings,
      errors,
    },
  };
}

/**
 * @deprecated Utiliser generateSagePaieExport() à la place.
 * Conservé pour rétrocompatibilité temporaire.
 */
export function generateSageVariables(
  matricule: string,
  result: SalaryInput,
  calculated: SalaryResult
): { rubrique: string; zone: string; valeur: number }[] {
  const vars: { rubrique: string; zone: string; valeur: number }[] = [];
  vars.push({ rubrique: 'SBASE', zone: '1', valeur: calculated.salaire_de_base });
  if (calculated.prime_anciennete > 0) vars.push({ rubrique: 'P_ANC', zone: '1', valeur: calculated.prime_anciennete });
  if (calculated.ind_transport > 0) vars.push({ rubrique: 'TRANSP', zone: '1', valeur: calculated.ind_transport });
  if (calculated.prime_presence > 0) vars.push({ rubrique: 'PRESENCE', zone: '1', valeur: calculated.prime_presence });
  if (calculated.cnss_salariale > 0) vars.push({ rubrique: 'CSSAL', zone: '3', valeur: calculated.cnss_salariale });
  if (calculated.irpp > 0) vars.push({ rubrique: 'IRPP', zone: '3', valeur: calculated.irpp });
  if (calculated.css_salariale > 0) vars.push({ rubrique: 'CSS', zone: '3', valeur: calculated.css_salariale });
  if (result.avances && result.avances > 0) vars.push({ rubrique: 'AVANCE', zone: '3', valeur: result.avances });
  if (calculated.net_a_payer > calculated.salaire_net) {
    const alloc = calculated.net_a_payer - calculated.salaire_net;
    vars.push({ rubrique: 'ALLOCFAM', zone: '5', valeur: alloc });
  }
  return vars;
}
