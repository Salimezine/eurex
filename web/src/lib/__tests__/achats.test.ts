import { describe, expect, it } from 'vitest';
import { fixDate, harmonizeDatesAndFournisseurs, buildBalancedEcritures, normalizeInvoiceData, verifyAndFixTVA, applyTVACorrections, checkRemiseConsistency, findDuplicateGroups, remapUnknownAccounts, dedupeInvoices, autoCleanEcritures, flagClientAsFournisseur, verifyEcrituresLocally } from '../achatsAI';
import { matchAchatCompte, type PlanComptable } from '../achatsPlanComptable';

// Plan minimal façon TEBIB : SANS 606600 ni 436663 (absents du vrai fichier)
function tebibLikePlan(): PlanComptable {
  const mk = (code: string, libelle: string) => ({ code, libelle, nature: 'Comptable' as const, sens: 'D' as const });
  const list = [
    mk('607000', 'Achats de marchandises'),
    mk('601000', 'Matieres premieres'),
    mk('436660', 'TVA DEDUCTIBLE'),
    mk('436670', 'TVA autre taux'),
    mk('401000', 'FOURNISSEURS BIENS ET SERVICES'),
    mk('401999', 'FRS DIVERS'),
  ];
  const comptes = new Map(list.map(c => [c.code, c]));
  const fournisseurs = new Map([['401000', comptes.get('401000')!], ['401999', comptes.get('401999')!]]);
  const allByCode: Record<string, any> = {};
  for (const c of list) allByCode[c.code] = c;
  return { comptes, fournisseurs, achats: [comptes.get('607000')!, comptes.get('601000')!], tva: [comptes.get('436660')!, comptes.get('436670')!], taxes: [], allByCode };
}

describe('ACHATS plan dossier (TEBIB)', () => {
  it('TVA jamais gonflée: HT mal lu, la TVA imprimée est gardée telle quelle', () => {
    // HT lu 95 au lieu de 100, TVA imprimée 19, TTC 119 → TVA=19 (pas max(19, 24)=24)
    const inv: any = { numero: 'F-TVA', date: '2026-09-05', fournisseur: 'TEST', ht0: 0, ht19: 95, tva19: 19, tva7: 0, fodec: 0, timbre: 0, ttc: 119 };
    const es = buildBalancedEcritures(inv, '607000', '401999');
    const tvaLine = es.find(e => e.compte === '436660');
    expect(tvaLine!.montant).toBeCloseTo(19, 3);
    const achat = es.find(e => e.compte === '607000')!;
    expect(achat.montant).toBeCloseTo(100, 3); // écart résiduel dans l'achat, TTC fait foi
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(119, 3);
    expect(totalC).toBeCloseTo(119, 3);
  });

  it('plan sans 436663: la TVA 7% va sur un autre 436xxx du plan', () => {
    const inv: any = { numero: 'F-TVA7', date: '2026-09-05', fournisseur: 'TEST', ht0: 100, ht19: 0, tva19: 0, tva7: 7, fodec: 0, timbre: 0, ttc: 107 };
    const es = buildBalancedEcritures(inv, '607000', '401999', tebibLikePlan());
    expect(es.find(e => e.compte === '436663')).toBeUndefined();
    const tva7 = es.find(e => e.libelle.includes('7%'))!;
    expect(tva7).toBeDefined();
    expect(tva7.compte).toBe('436670');
    expect(tva7.montant).toBeCloseTo(7, 3);
  });

  it('plan sans 436660: la TVA 19% va sur un autre 436xxx du plan', () => {
    const plan = tebibLikePlan();
    plan.comptes.delete('436660');
    const inv: any = { numero: 'F-TVA19', date: '2026-09-05', fournisseur: 'TEST', ht0: 0, ht19: 100, tva19: 19, tva7: 0, fodec: 0, timbre: 0, ttc: 119 };
    const es = buildBalancedEcritures(inv, '607000', '401999', plan);
    const tva = es.find(e => e.libelle.includes('19%'))!;
    expect(tva.compte).toBe('436670');
  });

  it('matchAchatCompte sans 606600: repli sur un 6xxx du plan', () => {
    const c = matchAchatCompte(tebibLikePlan(), 'fournitures diverses inconnues');
    expect(c).not.toBeNull();
    expect(c!.code).toMatch(/^6\d{5}$/);
  });

  it('doublon intra-pièce: triplet identique répété détecté', () => {
    const inv: any = { numero: 'F-DUP', date: '2026-09-05', fournisseur: 'TEST', ht0: 0, ht19: 100, tva19: 19, tva7: 0, fodec: 0, timbre: 0, ttc: 119 };
    const once = buildBalancedEcritures(inv, '607000', '401999');
    const twice = [...once, ...once.map(e => ({ ...e, id: e.id + '-bis' }))];
    const groups = findDuplicateGroups(twice);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('intra');
    expect(groups[0].removeIds).toHaveLength(once.length);
    const cleaned = twice.filter(e => !groups[0].removeIds.includes(e.id));
    expect(cleaned).toHaveLength(once.length);
  });

  it('doublon inter-pièces: même total + même date, n° différents', () => {
    const mk = (num: string): any[] => {
      const inv: any = { numero: num, date: '2026-09-01', fournisseur: 'TEST', ht0: 0, ht19: 100, tva19: 19, tva7: 0, fodec: 0, timbre: 0, ttc: 119 };
      return buildBalancedEcritures(inv, '607000', '401999');
    };
    const all = [...mk('NC-A-2026-09-01-119'), ...mk('NC-B-2026-09-01-119')];
    const groups = findDuplicateGroups(all);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('inter');
    expect(groups[0].numeroDocs).toEqual(['NC-A-2026-09-01-119', 'NC-B-2026-09-01-119']);
  });

  it('pas de faux doublon: totaux différents', () => {
    const mk = (num: string, ttc: number): any[] => {
      const inv: any = { numero: num, date: '2026-09-01', fournisseur: 'TEST', ht0: 0, ht19: 100, tva19: 19, tva7: 0, fodec: 0, timbre: 0, ttc };
      return buildBalancedEcritures(inv, '607000', '401999');
    };
    expect(findDuplicateGroups([...mk('A', 119), ...mk('B', 200)])).toHaveLength(0);
  });

  it('remap: 606600→6xxx, 436663→436xxx, 401xxx inconnu→401999 du plan', () => {    const es: any[] = [
      { id: 'e1', numero_doc: 'F1', date_operation: '2026-09-05', journal_code: 'AC', compte: '606600', libelle: 'ACHAT', sens: 'D', montant: 100 },
      { id: 'e2', numero_doc: 'F1', date_operation: '2026-09-05', journal_code: 'AC', compte: '436663', libelle: 'TVA 7%', sens: 'D', montant: 7 },
      { id: 'e3', numero_doc: 'F1', date_operation: '2026-09-05', journal_code: 'AC', compte: '401123', libelle: 'FRS', sens: 'C', montant: 107 },
      { id: 'e4', numero_doc: 'F1', date_operation: '2026-09-05', journal_code: 'AC', compte: '999999', libelle: 'X', sens: 'D', montant: 1 },
    ];
    const r = remapUnknownAccounts(es, tebibLikePlan());
    const byId: Record<string, string> = {};
    for (const e of r.ecritures) byId[e.id] = e.compte;
    expect(byId['e1']).toBe('607000');
    expect(byId['e2']).toBe('436660');
    expect(byId['e3']).toBe('401999');
    expect(byId['e4']).toBe('999999');
    expect(r.kept).toEqual(['999999']);
    expect(r.mapping).toHaveLength(3);
  });

  it('dedupe: même n° + même TTC réimporté → ignoré', () => {
    const base: any = { id: 'a', numero: 'FAC-1', date: '2026-09-05', fournisseur: 'KSS', ht19: 100, tva19: 19, ttc: 119 };
    const { fresh, skipped } = dedupeInvoices([base], [
      { ...base, id: 'b' },
      { ...base, id: 'c', numero: 'FAC-2' },
    ]);
    expect(skipped).toBe(1);
    expect(fresh.map(f => f.id)).toEqual(['c']);
  });

  it('dedupe: même n° mais TTC différent → gardé (avoir / correction)', () => {
    const base: any = { id: 'a', numero: 'FAC-1', date: '2026-09-05', fournisseur: 'KSS', ttc: 119 };
    const { fresh, skipped } = dedupeInvoices([base], [{ ...base, id: 'b', ttc: 200 }]);
    expect(skipped).toBe(0);
    expect(fresh).toHaveLength(1);
  });

  it('dedupe: sans n°, même fournisseur+date+TTC → ignoré', () => {
    const base: any = { id: 'a', numero: '', date: '2026-09-01', fournisseur: 'LOYER', ttc: 3293.75 };
    const { fresh, skipped } = dedupeInvoices([base], [{ ...base, id: 'b' }]);
    expect(skipped).toBe(1);
    expect(fresh).toHaveLength(0);
  });

  it('dedupe: doublon dans le lot lui-même → un seul gardé', () => {
    const inv: any = { id: 'a', numero: 'FAC-9', date: '2026-09-05', fournisseur: 'X', ttc: 50 };
    const { fresh, skipped } = dedupeInvoices([], [inv, { ...inv, id: 'b' }]);
    expect(skipped).toBe(1);
    expect(fresh).toHaveLength(1);
  });

  it('autoClean: intra supprimé, inter gardé, remap appliqué, notes', () => {
    const inv: any = { numero: 'F-AUTO', date: '2026-09-05', fournisseur: 'TEST', ht0: 0, ht19: 100, tva19: 19, tva7: 0, fodec: 0, timbre: 0, ttc: 119 };
    const once = buildBalancedEcritures(inv, '607000', '401999');
    const withIntra = [...once, ...once.map(e => ({ ...e, id: e.id + '-bis' }))];
    const other = buildBalancedEcritures({ ...inv, numero: 'AUTRE' }, '606600', '401123');
    const r = autoCleanEcritures([...withIntra, ...other], tebibLikePlan());
    // intra retiré (3), inter gardé, total = 3 + 3
    expect(r.ecritures).toHaveLength(once.length + other.length);
    expect(r.ecritures.some(e => e.numero_doc === 'AUTRE')).toBe(true);
    const comptes = new Set(r.ecritures.map(e => e.compte));
    expect(comptes.has('606600')).toBe(false);
    expect(comptes.has('401123')).toBe(false);
    expect(r.notes.join(' ')).toMatch(/doublon/);
    expect(r.notes.join(' ')).toMatch(/606600→607000/);
  });

  it('autoClean: lot propre → notes vides, rien ne change', () => {
    const inv: any = { numero: 'F-OK', date: '2026-09-05', fournisseur: 'TEST', ht0: 0, ht19: 100, tva19: 19, tva7: 0, fodec: 0, timbre: 0, ttc: 119 };
    const once = buildBalancedEcritures(inv, '607000', '401999');
    const r = autoCleanEcritures(once, tebibLikePlan());
    expect(r.notes).toHaveLength(0);
    expect(r.ecritures).toHaveLength(once.length);
  });

  it('flagClientAsFournisseur: client pris pour fournisseur → vidé', () => {
    const invs: any[] = [
      { id: 'a', numero: 'F1', fournisseur: 'TEBIB TUNISIE', ttc: 100 },
      { id: 'b', numero: 'F2', fournisseur: 'tebib tunisie ', ttc: 50 },
      { id: 'c', numero: 'F3', fournisseur: 'VRAI FOURNISSEUR', ttc: 30 },
    ];
    const { count } = flagClientAsFournisseur(invs, ['PROYASH METROPOLI', 'TEBIB TUNISIE']);
    expect(count).toBe(2);
    expect(invs[0].fournisseur).toBe('');
    expect(invs[1].fournisseur).toBe('');
    expect(invs[2].fournisseur).toBe('VRAI FOURNISSEUR');
  });

  it('verifyEcrituresLocally: TTC > 20000 → avertissement montant élevé', () => {
    const inv: any = { numero: 'BIG', date: '2026-09-05', fournisseur: 'X', ht0: 0, ht19: 43554, tva19: 0, tva7: 0, fodec: 0, timbre: 0, ttc: 43554 };
    const es = buildBalancedEcritures(inv, '607000', '401999');
    const v = verifyEcrituresLocally(es, tebibLikePlan());
    expect(v.checks.some(c => c.name.includes('Montant élevé') && c.status === 'warning')).toBe(true);
  });

  it('normalize: HT == TVA (reçu de paiement) → rejeté', () => {
    expect(normalizeInvoiceData({ numero: 'R1', date: '2026-09-05', fournisseur: 'TT', ht0: 0, ht19: 176360, tva19: 176360, tva7: 0, fodec: 0, timbre: 0, ttc: 176360 })).toBeNull();
    // cas normal untouched
    expect(normalizeInvoiceData({ numero: 'F1', date: '2026-09-05', fournisseur: 'X', ht0: 0, ht19: 100, tva19: 19, ttc: 119 })).not.toBeNull();
  });

  it('verifyEcrituresLocally: tag Écart de calcul → avertissement', () => {
    const es: any[] = [
      { id: 'e1', numero_doc: 'F1', date_operation: '2026-09-05', journal_code: 'AC', compte: '607000', libelle: 'ACHAT X [Écart de calcul: sous-totaux (34.130) ≠ TOTAL écrit]', sens: 'D', montant: 30 },
      { id: 'e2', numero_doc: 'F1', date_operation: '2026-09-05', journal_code: 'AC', compte: '401999', libelle: 'FRS X', sens: 'C', montant: 30 },
    ];
    const v = verifyEcrituresLocally(es, tebibLikePlan());
    expect(v.checks.some(c => c.name.includes('Écart arithmétique') && c.status === 'warning')).toBe(true);
    const es2: any[] = [
      { id: 'e1', numero_doc: 'F2', date_operation: '2026-09-05', journal_code: 'AC', compte: '607000', libelle: 'ACHAT Y', sens: 'D', montant: 30 },
      { id: 'e2', numero_doc: 'F2', date_operation: '2026-09-05', journal_code: 'AC', compte: '401999', libelle: 'FRS Y', sens: 'C', montant: 30 },
    ];
    expect(verifyEcrituresLocally(es2, tebibLikePlan()).checks.some(c => c.name.includes('Écart arithmétique'))).toBe(false);
  });
});

describe('ACHATS rules', () => {
  it('fixDate rejette une année trop éloignée du lot (2018 → 2026)', () => {
    expect(fixDate('2018-09-08')).toBe('2026-09-08');
    expect(fixDate('2024-09-05')).toBe('2026-09-05');
  });

  it('fixDate convertit DD/MM/YYYY et swap si mois > 12', () => {
    expect(fixDate('09/04/2026')).toBe('2026-04-09');
    expect(fixDate('13/04/2026')).toBe('2026-04-13');
  });

  it('harmonizeDates inversées dans le lot (semaine de septembre)', () => {
    const invs: any[] = [
      { numero: 'FV10-26+107221', date: '2026-04-09', fournisseur: 'BEN YAGHLANE' },
      { numero: 'FV10-26+107270', date: '2026-05-09', fournisseur: 'BEN YAGHLANE' },
      { numero: 'FV10-26+107258', date: '2026-09-04', fournisseur: 'BEN YAGHLANE' },
      { numero: 'FV10-26+107143', date: '2026-09-02', fournisseur: 'BEN YAGHLANE' },
    ];
    harmonizeDatesAndFournisseurs(invs);
    expect(invs[0].date).toBe('2026-09-04');
    expect(invs[1].date).toBe('2026-09-05');
  });

  it('harmonize ramène le dépôt de livraison à l émetteur dominant', () => {
    const invs: any[] = [
      { numero: 'FV10-26+107106', date: '2026-09-01', fournisseur: 'BEN YAGHLANE' },
      { numero: 'FV10-26+107139', date: '2026-09-02', fournisseur: 'FRS JARDINS DE CARTHAGE' },
      { numero: 'FV10-26+107210', date: '2026-09-04', fournisseur: 'BEN YAGHLANE' },
      { numero: 'FV10-26+107214', date: '2026-09-04', fournisseur: 'BEN YAGHLANE' },
    ];
    harmonizeDatesAndFournisseurs(invs);
    expect(invs[1].fournisseur).toBe('BEN YAGHLANE');
  });

  it('pas de TVA fantôme quand le modèle ne voit pas de TVA', () => {
    const inv: any = { numero: 'FV10-26+107070', date: '2026-08-31', fournisseur: 'BEN YAGHLANE', ht0: 0, ht19: 50.53, tva19: 0, tva7: 0, fodec: 0, timbre: 0, ttc: 51.57 };
    const es = buildBalancedEcritures(inv, '607000', '401065');
    expect(es.filter(e => e.compte === '436660')).toHaveLength(0);
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(totalC, 2);
  });

  it('timbre intégré au compte d\'achat (602100), pas sur 437003', () => {
    const inv: any = { numero: 'FA2604359', date: '2026-09-05', fournisseur: 'NORD DISTRIBUTION', ht0: 0, ht19: 240.53, tva19: 45.7, tva7: 0, fodec: 0, timbre: 1, ttc: 240.53 + 45.7 + 1 };
    const es = buildBalancedEcritures(inv, '602100', '401202');
    // Le timbre doit être inclus dans le compte d'achat (602100), pas sur 437003
    const timbreLine = es.find(e => e.compte === '437003');
    expect(timbreLine).toBeUndefined();
    const achatLine = es.find(e => e.compte === '602100');
    expect(achatLine).toBeDefined();
    expect(achatLine!.montant).toBeCloseTo(241.53, 2); // 240.53 HT + 1 timbre
    const tvaLine = es.find(e => e.compte === '436660');
    expect(tvaLine!.montant).toBeCloseTo(45.7, 2);
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(totalC, 2);
  });

  it('facture sans n° ou sans date marquée À VÉRIFIER', () => {
    const inv: any = { numero: '', date: '2026-09-05', fournisseur: '', ht0: 0, ht19: 100, tva19: 19, tva7: 0, fodec: 0, timbre: 0, ttc: 119 };
    const es = buildBalancedEcritures(inv, '607000', '401999');
    expect(es.some(e => e.libelle.includes('À VÉRIFIER MANUELLEMENT'))).toBe(true);
    expect(es.some(e => e.compte === '401999')).toBe(true);
  });

  it('règle 9: écart arithmétique signalé, TOTAL écrit conservé', () => {
    const raw = {
      numero: 'BL-123', date: '2026-09-05', fournisseur: 'FOURNI',
      lignes: [
        { designation: 'A', taux_tva: 19, montant_ht: 50.0 },
        { designation: 'B', taux_tva: 19, montant_ht: 40.0 },
      ],
      tva19: 17.1, tva7: 0, fodec: 0, timbre: 0, ttc: 90.0,
    };
    const inv = normalizeInvoiceData(raw);
    expect(inv.arith_note).toBeDefined();
    const es = buildBalancedEcritures({ id: 'x', ...inv, is_handwritten: true, raw_text: '', ocr_confidence: 60 }, '607000', '401001');
    expect(es.some(e => e.libelle.includes('Écart de calcul'))).toBe(true);
    const frs = es.find(e => e.sens === 'C')!;
    expect(frs.montant).toBeCloseTo(90.0, 3);
  });

  it('règle 9: pas de note si sous-totaux = TOTAL', () => {
    const raw = {
      numero: 'BL-124', date: '2026-09-05', fournisseur: 'FOURNI',
      lignes: [{ designation: 'A', taux_tva: 19, montant_ht: 100.0 }],
      tva19: 19.0, tva7: 0, fodec: 0, timbre: 0, ttc: 119.0,
    };
    const inv = normalizeInvoiceData(raw);
    expect(inv.arith_note).toBeUndefined();
  });

  it('remise lue et déduite du compte d\'achat, TTC constant', () => {
    const raw = {
      numero: 'BL-125', date: '2026-09-05', fournisseur: 'FOURNI',
      lignes: [
        { designation: 'A', taux_tva: 19, montant_ht: 100.0 },
        { designation: 'B', taux_tva: 19, montant_ht: 40.0 },
      ],
      tva19: 26.6, tva7: 0, fodec: 0, timbre: 0, remise: 10.0, ttc: 156.6,
    };
    const inv = normalizeInvoiceData(raw);
    expect(inv.remise).toBeCloseTo(10, 3);
    expect(inv.arith_note).toBeUndefined(); // HT 140 + TVA 26.6 − remise 10 = 156.6 = TTC
    const es = buildBalancedEcritures({ id: 'x', ...inv, is_handwritten: false, raw_text: '', ocr_confidence: 100 }, '607000', '401001');
    const achat = es.find(e => e.compte === '607000')!;
    expect(achat.montant).toBeCloseTo(156.6 - 26.6, 3); // achat = TTC − TVA
    expect(achat.libelle).toContain('REMISE 10.000');
    const tvaLine = es.find(e => e.compte === '436660')!;
    expect(tvaLine.montant).toBeCloseTo(26.6, 3);
    const frs = es.find(e => e.sens === 'C')!;
    expect(frs.montant).toBeCloseTo(156.6, 3);
  });

  // === TESTS DE RÉGRESSION — Audit PROYASH METROPOLI ===
  // Vérifie que totalD = totalC = ttc (TOTAL écrit fait foi)

  it('BEN YAGHLANE FV10-26+107300: total = 58.500', () => {
    const inv: any = { numero: 'FV10-26+107300', date: '2026-09-05', fournisseur: 'BEN YAGHLANE', ht0: 0, ht19: 58.5, tva19: 0, tva7: 0, fodec: 0, timbre: 0, ttc: 58.5 };
    const es = buildBalancedEcritures(inv, '602100', '401065');
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(58.5, 3);
    expect(totalC).toBeCloseTo(58.5, 3);
  });

  it('BEN YAGHLANE FV10-26+107210: total = 124.740', () => {
    const inv: any = { numero: 'FV10-26+107210', date: '2026-09-04', fournisseur: 'BEN YAGHLANE', ht0: 0, ht19: 124.74, tva19: 0, tva7: 0, fodec: 0, timbre: 0, ttc: 124.74 };
    const es = buildBalancedEcritures(inv, '602100', '401065');
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(124.74, 3);
    expect(totalC).toBeCloseTo(124.74, 3);
  });

  it('BEN YAGHLANE FV10-26+107270: total = 183.803', () => {
    const inv: any = { numero: 'FV10-26+107270', date: '2026-09-05', fournisseur: 'BEN YAGHLANE', ht0: 0, ht19: 183.803, tva19: 0, tva7: 0, fodec: 0, timbre: 0, ttc: 183.803 };
    const es = buildBalancedEcritures(inv, '602100', '401065');
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(183.803, 3);
    expect(totalC).toBeCloseTo(183.803, 3);
  });

  it('BEN YAGHLANE FV10-26+107070: total = 134.602', () => {
    const inv: any = { numero: 'FV10-26+107070', date: '2026-08-31', fournisseur: 'BEN YAGHLANE', ht0: 0, ht19: 134.602, tva19: 0, tva7: 0, fodec: 0, timbre: 0, ttc: 134.602 };
    const es = buildBalancedEcritures(inv, '602100', '401065');
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(134.602, 3);
    expect(totalC).toBeCloseTo(134.602, 3);
  });

  it('EJEM FA-31378: total = 620.574 (achat HT 520.650 + TVA 98.924 + timbre inclus)', () => {
    const inv: any = { numero: 'FA-31378', date: '2026-09-01', fournisseur: 'EJEM', ht0: 0, ht19: 520.65, tva19: 98.924, tva7: 0, fodec: 0, timbre: 1, ttc: 620.574 };
    const es = buildBalancedEcritures(inv, '606600', '401063');
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(620.574, 3);
    expect(totalC).toBeCloseTo(620.574, 3);
    const achatLine = es.find(e => e.compte === '606600');
    expect(achatLine!.montant).toBeCloseTo(521.65, 2); // 520.65 HT + 1 timbre
  });

  it('NC-METAYSHIL: total = 46.500', () => {
    const inv: any = { numero: 'NC-METAYSHIL-24-08-26', date: '2026-08-24', fournisseur: 'METAYSHIL', ht0: 0, ht19: 46.5, tva19: 0, tva7: 0, fodec: 0, timbre: 0, ttc: 46.5 };
    const es = buildBalancedEcritures(inv, '602100', '401999');
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(46.5, 3);
    expect(totalC).toBeCloseTo(46.5, 3);
  });

  it('NC-Metropolik: total = 60.000', () => {
    const inv: any = { numero: 'NC-Metropolik-2024-09-01', date: '2026-09-01', fournisseur: 'METROPOLIK', ht0: 0, ht19: 60, tva19: 0, tva7: 0, fodec: 0, timbre: 0, ttc: 60 };
    const es = buildBalancedEcritures(inv, '602100', '401999');
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(60, 3);
    expect(totalC).toBeCloseTo(60, 3);
  });

  it('SAVEURS DE CARTHAGE 2026-09-03: total = 730.879', () => {
    const inv: any = { numero: 'NC-SAVEURS-2026-09-03', date: '2026-09-03', fournisseur: 'SAVEUR DE CARTHAGE', ht0: 0, ht19: 730.879, tva19: 0, tva7: 0, fodec: 0, timbre: 0, ttc: 730.879 };
    const es = buildBalancedEcritures(inv, '602100', '401097');
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(730.879, 3);
    expect(totalC).toBeCloseTo(730.879, 3);
  });

  it('SAVEURS DE CARTHAGE 2026-09-04: total = 261.100', () => {
    const inv: any = { numero: 'NC-SAVEURS-2026-09-04', date: '2026-09-04', fournisseur: 'SAVEUR DE CARTHAGE', ht0: 0, ht19: 261.1, tva19: 0, tva7: 0, fodec: 0, timbre: 0, ttc: 261.1 };
    const es = buildBalancedEcritures(inv, '602100', '401097');
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(261.1, 3);
    expect(totalC).toBeCloseTo(261.1, 3);
  });

  it('MONOPRIX NC-2026-08-31-21.100: total = 22.100 (pas 2101)', () => {
    // Bug: ht=2101 (sous-total OCR) vs ttc=22.100 (TOTAL écrit)
    const inv: any = { numero: 'NC-MONOPRIX-2026-08-31-21.100', date: '2026-08-31', fournisseur: 'MONOPRIX', ht0: 0, ht19: 2101, tva19: 0, tva7: 0, fodec: 0, timbre: 0, ttc: 22.1 };
    const es = buildBalancedEcritures(inv, '602100', '401066');
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    // Le TOTAL écrit (22.100) fait foi, PAS le sous-total (2101)
    expect(totalD).toBeCloseTo(22.1, 3);
    expect(totalC).toBeCloseTo(22.1, 3);
    const achatLine = es.find(e => e.compte === '602100');
    expect(achatLine!.montant).toBeCloseTo(22.1, 3);
  });

  it('TVA disproportionnée détectée: achat + TVA ≤ ttc', () => {
    // Si tva >> ht (ex: achat=57.5 / TVA=563.074), c'est un bug d'échelle
    const inv: any = { numero: 'TEST-TVA', date: '2026-09-01', fournisseur: 'TEST', ht0: 0, ht19: 57.5, tva19: 563.074, tva7: 0, fodec: 0, timbre: 0, ttc: 620.574 };
    const es = buildBalancedEcritures(inv, '602100', '401999');
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    // ttc fait foi: totalD = totalC = 620.574
    expect(totalD).toBeCloseTo(620.574, 3);
    expect(totalC).toBeCloseTo(620.574, 3);
  });

  // === TESTS VÉRIFICATION TVA AUTOMATIQUE ===

  it('TVA 19% cohérente → status OK', () => {
    const r = verifyAndFixTVA({
      numero: 'F001', fournisseur: 'KAM TRADE',
      ht0: 0, ht19: 100, ht7: 0, tva19: 19, tva7: 0, fodec: 0, timbre: 0, ttc: 119,
    });
    expect(r.status).toBe('OK');
    expect(r.tva_corrigee).toBeUndefined();
  });

  it('TVA 19% légèrement faible → auto-correction', () => {
    // 100 * 0.19 = 19.000, mais OCR lit 18.500
    const r = verifyAndFixTVA({
      numero: 'F002', fournisseur: 'KAM TRADE',
      ht0: 0, ht19: 100, ht7: 0, tva19: 18.5, tva7: 0, fodec: 0, timbre: 0, ttc: 118.5,
    });
    expect(r.status).toBe('CORRIGÉ');
    expect(r.tva19_corrigee).toBeCloseTo(19, 3);
  });

  it('TVA 19% très écartée → erreur', () => {
    // 100 * 0.19 = 19, mais OCR lit 25
    const r = verifyAndFixTVA({
      numero: 'F003', fournisseur: 'KAM TRADE',
      ht0: 0, ht19: 100, ht7: 0, tva19: 25, tva7: 0, fodec: 0, timbre: 0, ttc: 125,
    });
    expect(r.status).toBe('ERREUR');
    expect(r.message).toContain('incohérente');
  });

  it('TVA disproportionnée → erreur (> 25% de HT)', () => {
    const r = verifyAndFixTVA({
      numero: 'F004', fournisseur: 'TEST',
      ht0: 0, ht19: 57.5, ht7: 0, tva19: 563, tva7: 0, fodec: 0, timbre: 0, ttc: 620,
    });
    expect(r.status).toBe('ERREUR');
    expect(r.message).toContain('disproportionnée');
  });

  it('BEN YAGHLANE sans TVA → OK', () => {
    const r = verifyAndFixTVA({
      numero: 'FV10-26+107300', fournisseur: 'BEN YAGHLANE',
      ht0: 0, ht19: 58.5, ht7: 0, tva19: 0, tva7: 0, fodec: 0, timbre: 0, ttc: 58.5,
    });
    expect(r.status).toBe('OK');
  });

  it('BEN YAGHLANE avec TVA → avertissement', () => {
    const r = verifyAndFixTVA({
      numero: 'FV10-26+107300', fournisseur: 'BEN YAGHLANE',
      ht0: 0, ht19: 58.5, ht7: 0, tva19: 11.115, tva7: 0, fodec: 0, timbre: 0, ttc: 69.615,
    });
    expect(r.status).toBe('AVERTISSEMENT');
    expect(r.message).toContain('devrait être sans TVA');
  });

  it('KAM TRADE sans TVA → avertissement', () => {
    const r = verifyAndFixTVA({
      numero: 'F005', fournisseur: 'KAM TRADE',
      ht0: 0, ht19: 100, ht7: 0, tva19: 0, tva7: 0, fodec: 0, timbre: 0, ttc: 100,
    });
    expect(r.status).toBe('AVERTISSEMENT');
    expect(r.message).toContain('devrait avoir TVA');
  });

  it('applyTVACorrections applique la correction', () => {
    const inv = { numero: 'F006', fournisseur: 'TEST', ht0: 0, ht19: 100, ht7: 0, tva19: 18.5, tva7: 0, fodec: 0, timbre: 0, ttc: 118.5 };
    const v = verifyAndFixTVA(inv);
    const corrected = applyTVACorrections(inv, v);
    expect(corrected.tva19).toBeCloseTo(19, 3);
    expect(corrected.ttc).toBeCloseTo(119, 3);
  });

  it('Timbre inhabituel → avertissement', () => {
    const r = verifyAndFixTVA({
      numero: 'F007', fournisseur: 'TEST',
      ht0: 0, ht19: 100, ht7: 0, tva19: 19, tva7: 0, fodec: 0, timbre: 5, ttc: 124,
    });
    expect(r.status).toBe('AVERTISSEMENT');
    expect(r.message).toContain('Timbre inhabituel');
  });

  // === TEST FODEC INTÉGRÉ AU COMPTE D'ACHAT ===

  it('FODEC intégré au compte d\'achat, pas sur 436680', () => {
    const inv: any = { numero: 'F-FODEC', date: '2026-08-10', fournisseur: 'TEST FODEC', ht0: 0, ht19: 100, tva19: 19, tva7: 0, fodec: 1, timbre: 0, ttc: 120 };
    const es = buildBalancedEcritures(inv, '602100', '401999');
    // FODEC ne doit JAMAIS être sur 436680
    expect(es.find(e => e.compte === '436680')).toBeUndefined();
    // Le FODEC est inclus dans le compte d'achat
    const achatLine = es.find(e => e.compte === '602100');
    expect(achatLine).toBeDefined();
    expect(achatLine!.montant).toBeCloseTo(101, 2); // 100 HT + 1 FODEC
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(totalC, 2);
    expect(totalC).toBeCloseTo(120, 2); // TTC
  });

  it('FODEC + timbre + TVA tous inclus dans 602100', () => {
    const inv: any = { numero: 'F-FULL', date: '2026-08-10', fournisseur: 'KAM TRADE', ht0: 0, ht19: 100, tva19: 19, tva7: 0, fodec: 1, timbre: 1, ttc: 121 };
    const es = buildBalancedEcritures(inv, '602100', '401801');
    expect(es.find(e => e.compte === '436680')).toBeUndefined();
    expect(es.find(e => e.compte === '437003')).toBeUndefined();
    const achatLine = es.find(e => e.compte === '602100');
    expect(achatLine!.montant).toBeCloseTo(102, 2); // 100 HT + 1 FODEC + 1 timbre
    const tvaLine = es.find(e => e.compte === '436660');
    expect(tvaLine!.montant).toBeCloseTo(19, 2);
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(totalC, 2);
    expect(totalC).toBeCloseTo(121, 2); // TTC
  });

  // === TEST VÉRIFICATION REMISE (checkRemiseConsistency) ===

  const makeEntry = (num: string, compte: string, montant: number, libelle = ''): any => ({
    id: 'e1', numero_doc: num, date_operation: '2026-09-05', journal_code: 'AC',
    compte, libelle: libelle || 'ACHAT TEST', sens: 'D', montant,
  });

  it('remise saine (remise < HT, TTC cohérent)', () => {
    const inv: any = { numero: 'R100', date: '2026-09-05', fournisseur: 'FOURNI', ht0: 0, ht19: 140, tva19: 26.6, tva7: 0, fodec: 0, timbre: 0, remise: 10, ttc: 156.6 };
    const checks = checkRemiseConsistency([makeEntry('R100', '607000', 130, 'ACHAT TEST [REMISE 10.000]')], [inv]);
    expect(checks.some(c => c.status === 'error')).toBe(false);
    expect(checks.some(c => c.name.includes('Remise / TTC'))).toBe(false);
  });

  it('remise ≥ HT → erreur', () => {
    const inv: any = { numero: 'R101', date: '2026-09-05', fournisseur: 'FOURNI', ht0: 0, ht19: 100, tva19: 0, tva7: 0, fodec: 0, timbre: 0, remise: 120, ttc: 0 };
    const checks = checkRemiseConsistency([makeEntry('R101', '607000', 1)], [inv]);
    expect(checks.some(c => c.status === 'error' && c.name.includes('Remise incohérente'))).toBe(true);
  });

  it('remise lue mais libellé sans [REMISE] → avertissement', () => {
    const inv: any = { numero: 'R102', date: '2026-09-05', fournisseur: 'FOURNI', ht0: 0, ht19: 140, tva19: 26.6, tva7: 0, fodec: 0, timbre: 0, remise: 10, ttc: 156.6 };
    const checks = checkRemiseConsistency([makeEntry('R102', '607000', 156.6, 'ACHAT TEST')], [inv]);
    expect(checks.some(c => c.status === 'warning' && c.name.includes('Remise non appliquée'))).toBe(true);
  });

  it('facture importée mais non comptabilisée → avertissement', () => {
    const inv: any = { numero: 'R103', date: '2026-09-05', fournisseur: 'FOURNI', ht0: 0, ht19: 50, tva19: 9.5, tva7: 0, fodec: 0, timbre: 0, remise: 0, ttc: 59.5 };
    const checks = checkRemiseConsistency([makeEntry('R999', '2026-09-05', 100)], [inv]);
    expect(checks.some(c => c.status === 'warning' && c.name.includes('non comptabilisée'))).toBe(true);
  });

  // === ANTI-ÉCHELLE ×1000 (normalizeInvoiceData) ===

  it('échelle ×1000: entiers 4+ chiffres sans TVA lue → rescale (36950 → 36.950)', () => {
    const inv = normalizeInvoiceData({
      numero: 'TICKET-1', date: '2026-09-01', fournisseur: 'MONOPRIX',
      ht0: 0, ht19: 36950, tva19: 0, tva7: 0, fodec: 0, timbre: 0, remise: 0, ttc: 36950,
    });
    expect(inv!.ttc).toBeCloseTo(36.95, 3);
    expect(inv!.ht19).toBeCloseTo(36.95, 3);
  });

  it('TTC seul ×1000, composants en vrais DT → corrige le TTC', () => {
    const inv = normalizeInvoiceData({
      numero: 'TICKET-2', date: '2026-09-01', fournisseur: 'MONOPRIX',
      ht0: 0, ht19: 36.95, tva19: 0, tva7: 0, fodec: 0, timbre: 0, remise: 0, ttc: 36950,
    });
    expect(inv!.ttc).toBeCloseTo(36.95, 3);
    expect(inv!.ht19).toBeCloseTo(36.95, 3);
  });

  it('pas de rescale sur une vraie facture B2B entière (15000)', () => {
    const inv = normalizeInvoiceData({
      numero: 'B2B-1', date: '2026-09-01', fournisseur: 'GROS',
      ht0: 0, ht19: 12605, tva19: 2395, tva7: 0, fodec: 0, timbre: 0, remise: 0, ttc: 15000,
    });
    // 12605 * 0.19 ≈ 2394.95 → ratio TVA cohérent à l'échelle d'origine
    // Ne pas diviser par 1000 si TVA déjà cohérente
    expect(inv!.ttc).toBe(15000);
  });

  it('MONOPRIX ht=2101 ttc=22.1: ne pas massacrer le TTC écrit', () => {
    const inv = normalizeInvoiceData({
      numero: 'NC-MONO', date: '2026-08-31', fournisseur: 'MONOPRIX',
      ht0: 0, ht19: 2101, tva19: 0, tva7: 0, fodec: 0, timbre: 0, remise: 0, ttc: 22.1,
    });
    expect(inv!.ttc).toBeCloseTo(22.1, 3);
  });
});