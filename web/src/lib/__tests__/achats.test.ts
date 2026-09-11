import { describe, expect, it } from 'vitest';
import { fixDate, harmonizeDatesAndFournisseurs, buildBalancedEcritures } from '../achatsAI';

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

  it('timbre isolé sur 437003 quand il était fusionné dans la TVA', () => {
    const inv: any = { numero: 'FA2604359', date: '2026-09-05', fournisseur: 'NORD DISTRIBUTION', ht0: 0, ht19: 240.53, tva19: 45.7, tva7: 0, fodec: 0, timbre: 0, ttc: 240.53 + 45.7 + 1 };
    const es = buildBalancedEcritures(inv, '607000', '401010');
    const timbreLine = es.find(e => e.compte === '437003');
    expect(timbreLine).toBeDefined();
    expect(timbreLine!.montant).toBeCloseTo(1, 3);
    const tvaLine = es.find(e => e.compte === '436660');
    expect(tvaLine!.montant).toBeCloseTo(45.7, 2);
    const totalD = es.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = es.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    expect(totalD).toBeCloseTo(totalC, 2);
  });

  it('facture sans n° ou sans date marquée À VÉRIFIER', () => {
    const inv: any = { numero: 'NC-2026-09-05-209_377', date: '', fournisseur: 'FRS SAVEUR DE CARTHAGE', ht0: 0, ht19: 100, tva19: 19, tva7: 0, fodec: 0, timbre: 0, ttc: 119 };
    const es = buildBalancedEcritures(inv, '607000', '401097');
    expect(es.some(e => e.libelle.includes('À VÉRIFIER MANUELLEMENT'))).toBe(true);
  });
});