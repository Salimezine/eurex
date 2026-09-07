import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getConfig, saveConfig, resetConfig, verifyAccessCode, getDefaults, invalidateCache } from '../baudConfig';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k]; }),
};
vi.stubGlobal('localStorage', localStorageMock);

describe('baudConfig', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    invalidateCache();
  });

  it('getConfig returns defaults when no localStorage', () => {
    const cfg = getConfig();
    expect(cfg.cnss_salarial).toBe(0.0968);
    expect(cfg.cnss_patronal).toBe(0.1707);
    expect(cfg.at_mp).toBe(0.005);
    expect(cfg.tfp).toBe(0.02);
    expect(cfg.foprolos).toBe(0.01);
    expect(cfg.css).toBe(0.005);
    expect(cfg.smig_40h).toBe(470.251);
    expect(cfg.mit_plein).toBe(5.000);
    expect(cfg.transport_ouvrier).toBe(92.800);
    expect(cfg.transport_chef).toBe(100.533);
    expect(cfg.irpp_barème).toHaveLength(8);
    expect(cfg.anciennete_bareme).toHaveLength(4);
  });

  it('saveConfig persists and getConfig reads it', () => {
    const cfg = getConfig();
    cfg.css = 0.01;
    saveConfig(cfg);
    invalidateCache();
    const loaded = getConfig();
    expect(loaded.css).toBe(0.01);
    expect(loaded.cnss_salarial).toBe(0.0968);
  });

  it('resetConfig clears localStorage and returns defaults', () => {
    const cfg = getConfig();
    cfg.css = 0.99;
    saveConfig(cfg);
    const reset = resetConfig();
    expect(reset.css).toBe(0.005);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('eurex_baud_config');
  });

  it('verifyAccessCode accepts correct code', () => {
    expect(verifyAccessCode('1919')).toBe(true);
  });

  it('verifyAccessCode rejects wrong code', () => {
    expect(verifyAccessCode('0000')).toBe(false);
    expect(verifyAccessCode('')).toBe(false);
    expect(verifyAccessCode('1920')).toBe(false);
  });

  it('getDefaults returns a copy (not reference)', () => {
    const d1 = getDefaults();
    const d2 = getDefaults();
    d1.css = 0.99;
    expect(d2.css).toBe(0.005);
  });

  it('getConfig returns cached result', () => {
    const c1 = getConfig();
    const c2 = getConfig();
    expect(c1).toBe(c2);
  });

  it('irpp_barème has correct structure', () => {
    const cfg = getConfig();
    const b0 = cfg.irpp_barème[0];
    expect(b0.min).toBe(0);
    expect(b0.max).toBe(5000);
    expect(b0.taux).toBe(0);

    const bLast = cfg.irpp_barème[7];
    expect(bLast.taux).toBe(0.40);
    expect(bLast.max).toBe(Infinity);
  });

  it('anciennete_bareme has correct structure', () => {
    const cfg = getConfig();
    expect(cfg.anciennete_bareme[0].taux).toBe(0);
    expect(cfg.anciennete_bareme[1].min_years).toBe(3);
    expect(cfg.anciennete_bareme[3].taux).toBe(15);
  });
});
