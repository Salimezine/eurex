/** Email syntactiquement valide (même règle que l'API). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Mot de passe acceptable (12 caractères minimum, règle cabinet). */
export function isValidPassword(password: string): boolean {
  return password.length >= 12;
}
