// Portee « comptable effectif » d'un dossier : override au niveau dossier
// (org_dossiers.assigned_comptable_id, migration 0038) sinon comptable du
// client (org_clients.assigned_comptable_id, comportement historique).
// Exporte pour test unitaire : chaque requete de scope doit passer par cette
// expression pour que le transfert de dossier reste coherent partout.
export function dossierComp(d = 'd', c = 'c'): string {
  return `COALESCE(${d}.assigned_comptable_id, ${c}.assigned_comptable_id)`;
}
