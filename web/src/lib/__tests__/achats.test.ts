import { describe, expect, it } from 'vitest';
import { fixDate, harmonizeDatesAndFournisseurs, buildBalancedEcritures, normalizeInvoiceData } from '../achatsAI';

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
});