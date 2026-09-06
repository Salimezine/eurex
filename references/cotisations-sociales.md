# Cotisations Sociales — BAUD Module

## CSS (Cotisation Sociale de Solidarité)

### Formule validée

```
CSS = 0.5% × RNI
RNI = Salaire_imposable − Frais_professionnels
Salaire_imposable = Salaire_brut_total − CNSS_salarié
Frais_professionnels = min(Salaire_imposable × 12 × 10%, 2000) / 12
```

### Sources légales
- **Loi n°92-73** du 28/07/1992
- **LF 2023, art. 22** (prolongation 2023-2025)
- Taux : **0.5%** du revenu net imposable

### Validation
- **219 observations** (janvier-août 2026, 20+ employés)
- **Median error : 0.000 DT** (correspondance parfaite avec bulletin Sage)
- **100% des lignes dans ±0.01 DT**
- CSV de validation : `D:\base de paie\css_validation_resultats.csv`

### Hypothèses testées puis rejetées

| Hypothèse | Résultat | Décision |
|-----------|----------|----------|
| Déductions familiales (25 DT chef famille + 8.333×enfants) | Erreur médiane +0.167 DT | **Rejeté** — Sage n'applique aucune déduction |
| Seuil d'exonération 5000 DT/an | 43 lignes avec erreur > 0.50 DT | **Rejeté** — Sage applique le taux même pour bas revenus |
| Differential IRPP (IRPP+1pt − IRPP) | Taux effectif ~1% (au lieu de 0.5%) | **Rejeté** — formule mathématiquement incorrecte |

### Notes importantes
- La CSS est calculée **mensuellement** sans lissage annuel
- Aucun plafond d'assiette
- Pas de distinction par situation familiale ou nombre d'enfants
- Le seuil de 5000 DT/an peut s'appliquer au niveau annuel (réconciliation fiscale) mais pas dans le calcul mensuel Sage

---

## CNSS (Caisse Nationale de Sécurité Sociale)

### Salarié
- Taux : **9.68%**
- Assiette : Salaire brut − prime_lait − prime_aid (si présente)
- **Aucun plafond**

### Patronal
- Taux : **17.07%** (depuis janvier 2025, réforme CNSS)
- Assiette : idem salarié

### Sources
- Loi n°73-40 du 24/07/1973
- Réforme CNSS janvier 2025 (16.57% → 17.07%)

---

## AT/MP (Accidents du Travail et Maladies Professionnelles)
- Taux : **0.5%** du salaire brut
- Pas de plafond

---

## TFP (Taxe de Formation Professionnelle)
- Taux : **2%** du salaire brut (secteur BTP/industriel)
- Pas de plafond

---

## FOPROLOS
- Taux : **1%** du salaire brut
- Pas de plafond

---

## IRPP (Impôt sur le Revenu des Personnes Physiques)

### Barème annuel LF 2025 (art. 36)
| Tranche annuelle | Taux |
|------------------|------|
| 0 – 5 000 DT | 0% |
| 5 000 – 10 000 DT | 15% |
| 10 000 – 20 000 DT | 25% |
| 20 000 – 30 000 DT | 30% |
| 30 000 – 40 000 DT | 33% |
| 40 000 – 50 000 DT | 36% |
| 50 000 – 70 000 DT | 38% |
| > 70 000 DT | 40% |

### Calcul
- Base : RNI annuel = (Salaire_imposable − Frais_pro) × 12
- Déductions : 10% fraîcheur (si applicable)
- Décote si impôt annuel < 1 500 DT
- Impôt mensuel = Impôt annuel ÷ 12

---

## SMIG 2026
- **470.251 DT/mois** (régime 40h)
- Décret n°67/2026 du 30/04/2026, JORT n°44

---

## Revalorisation Décret n°68/2026
- +5%/an cumulatif sur 3 ans (2026-2028)
- Appliqué aux primes légales (transport, panier, douche, savon, lait, logement)
- Pas appliqué aux augmentations individuelles
