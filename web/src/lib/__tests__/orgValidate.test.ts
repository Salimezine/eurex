import { describe, it, expect } from 'vitest';
import { isValidEmail, isValidPassword } from '../orgValidate';

describe('orgValidate', () => {
  it('emails valides', () => {
    expect(isValidEmail('expert@eurex.tn')).toBe(true);
    expect(isValidEmail(' a.b+tag@sub.domain.co ')).toBe(true);
  });

  it('emails invalides', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('pas-un-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
  });

  it('mot de passe : 12 car. minimum', () => {
    expect(isValidPassword('courant12')).toBe(false);
    expect(isValidPassword('motdepasse12')).toBe(true);
  });
});
