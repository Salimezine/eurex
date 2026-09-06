/**
 * Configuration BAUD — paramètres modifiables par l'utilisateur
 *
 * Les valeurs par défaut viennent de la législation tunisienne 2026.
 * Les modifications sont sauvegardées dans localStorage et prioritaires
 * sur les defaults.
 *
 * Code d'accès pour modifier : 1919
 */

// ============================================================================
// Types
// ============================================================================

export interface BaudConfig {
  // Taux de cotisations
  cnss_salarial: number;         // 9.68%
  cnss_patronal: number;         // 17.07%
  at_mp: number;                 // 0.5%
  tfp: number;                   // 2%
  foprolos: number;              // 1%
  css: number;                   // 0.5%

  // SMIG
  smig_40h: number;              // 470.251 DT/mois

  // Frais professionnels
  frais_pro_taux: number;        // 10%
  frais_pro_plafond: number;     // 2000 DT/an

  // Primes légales (montants pleins mensuels)
  prime_panier: number;          // 12.320
  prime_douche: number;          // 25.000
  prime_savon: number;           // 5.400
  prime_lait: number;            // 29.700
  prime_logement: number;        // 26.293
  presence_plein_avant_juin: number; // 7.856
  presence_plein_juin: number;   // 8.249
  mit_plein: number;             // 5000

  // Jours ouvrables
  jours_ouvrables_defaut: number; // 26 (fallback)

  // Transport (paliers par fonction)
  transport_ouvrier: number;     // 92.800
  transport_chef: number;        // 100.533

  // Revalorisation
  revalorisation_taux: number;   // 5%

  // Allocations familiales
  alloc_chef_famille: number;    // 25 DT/mois
  alloc_enfant: number;          // 8.333 DT/mois
  alloc_enfants_max: number;     // 4

  // Ancienneté (barème)
  anciennete_bareme: { min_years: number; taux: number }[];

  // IRPP barème annuel
  irpp_barème: { min: number; max: number; taux: number }[];
}

// ============================================================================
// Valeurs par défaut — Législation tunisienne 2026
// ============================================================================

const DEFAULTS: BaudConfig = {
  cnss_salarial: 0.0968,
  cnss_patronal: 0.1707,
  at_mp: 0.005,
  tfp: 0.02,
  foprolos: 0.01,
  css: 0.005,

  smig_40h: 470.251,

  frais_pro_taux: 0.10,
  frais_pro_plafond: 2000,

  prime_panier: 12.320,
  prime_douche: 25.000,
  prime_savon: 5.400,
  prime_lait: 29.700,
  prime_logement: 26.293,
  presence_plein_avant_juin: 7.856,
  presence_plein_juin: 8.249,
  mit_plein: 5000,

  transport_ouvrier: 92.800,
  transport_chef: 100.533,

  jours_ouvrables_defaut: 26,

  revalorisation_taux: 0.05,

  alloc_chef_famille: 25,
  alloc_enfant: 8.333,
  alloc_enfants_max: 4,

  anciennete_bareme: [
    { min_years: 0, taux: 0 },
    { min_years: 3, taux: 5 },
    { min_years: 6, taux: 10 },
    { min_years: 9, taux: 15 },
  ],

  irpp_barème: [
    { min: 0, max: 5000, taux: 0.00 },
    { min: 5000, max: 10000, taux: 0.15 },
    { min: 10000, max: 20000, taux: 0.25 },
    { min: 20000, max: 30000, taux: 0.30 },
    { min: 30000, max: 40000, taux: 0.33 },
    { min: 40000, max: 50000, taux: 0.36 },
    { min: 50000, max: 70000, taux: 0.38 },
    { min: 70000, max: Infinity, taux: 0.40 },
  ],
};

// ============================================================================
// Accès
// ============================================================================

const STORAGE_KEY = 'eurex_baud_config';
const ACCESS_CODE = '1919';

let _cache: BaudConfig | null = null;

/**
 * Charge la config depuis localStorage, fallback sur les defaults.
 */
export function getConfig(): BaudConfig {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      _cache = { ...DEFAULTS, ...saved };
      return _cache!;
    }
  } catch {}
  _cache = { ...DEFAULTS };
  return _cache!;
}

/**
 * Sauvegarde la config dans localStorage.
 * Retourne true si succès, false si echec.
 */
export function saveConfig(config: BaudConfig): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    _cache = config;
    return true;
  } catch {
    return false;
  }
}

/**
 * Réinitialise la config aux valeurs par défaut.
 */
export function resetConfig(): BaudConfig {
  const defaults = { ...DEFAULTS };
  localStorage.removeItem(STORAGE_KEY);
  _cache = defaults;
  return defaults;
}

/**
 * Vérifie le code d'accès.
 */
export function verifyAccessCode(code: string): boolean {
  return code === ACCESS_CODE;
}

/**
 * Invalide le cache (utile après modification).
 */
export function invalidateCache(): void {
  _cache = null;
}

/**
 * Retourne les defaults (pour affichage "valeur d'origine").
 */
export function getDefaults(): BaudConfig {
  return { ...DEFAULTS };
}
