import { describe, it, expect } from 'vitest';
import { rebuildSplitNames, type SplitResult } from '../splitFactures';

const r = (page: number, supplier: string, date: string): SplitResult => ({
  page, name: 'old.pdf', supplier, date, blob: new Blob(),
});

describe('rebuildSplitNames', () => {
  it('renomme selon fournisseur + date edites', () => {
    const [a] = rebuildSplitNames([r(1, 'STE MYTEK INFORMATIQUE', '2026-01-02')]);
    expect(a.name).toBe('001_STE MYTEK INFORMATIQUE_2026-01-02.pdf');
  });

  it('placeholders -> fournisseur-inconnu / sans-date', () => {
    const [a] = rebuildSplitNames([r(7, '(introuvable)', '(pas de date)')]);
    expect(a.name).toBe('007_fournisseur-inconnu_sans-date.pdf');
  });

  it('vide -> fournisseur-inconnu / sans-date', () => {
    const [a] = rebuildSplitNames([r(2, '', '')]);
    expect(a.name).toBe('002_fournisseur-inconnu_sans-date.pdf');
  });

  it('supprime les caracteres interdits au nom de fichier', () => {
    const [a] = rebuildSplitNames([r(4, 'BEN YAGHLANE & COMPAGNIE / "SARL"', '2026-09-04')]);
    expect(a.name).toBe('004_BEN YAGHLANE & COMPAGNIE SARL_2026-09-04.pdf');
  });

  it('evite les doublons (insensible a la casse)', () => {
    const out = rebuildSplitNames([r(3, 'A', '2026-01-01'), r(3, 'a', '2026-01-01')]);
    expect(out[0].name).toBe('003_A_2026-01-01.pdf');
    expect(out[1].name).toBe('003_a_2026-01-01-2.pdf');
  });

  it('est pur : ne modifie pas les entrees', () => {
    const input = [r(1, 'X', '2026-01-01')];
    rebuildSplitNames(input);
    expect(input[0].name).toBe('old.pdf');
  });
});
