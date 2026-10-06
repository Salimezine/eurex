import json
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "comptaflow.db")
JSON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extracted.json")

with open(JSON_PATH) as f:
    factures = json.load(f)

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()

# Get dossier ANIMAL
c.execute("SELECT id, societe_id FROM dossiers WHERE nom = 'ANIMAL'")
row = c.fetchone()
if not row:
    print("ERROR: Dossier ANIMAL not found!")
    exit(1)
dossier_id, societe_id = row
print(f"Dossier ANIMAL: {dossier_id}, societe: {societe_id}")

# Clear old factures and VT J.C ecritures
c.execute("DELETE FROM factures WHERE dossier_id = ?", (dossier_id,))
c.execute("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = 'VT J.C'", (dossier_id,))
print("Cleared old factures and VT J.C ecritures")

# Insert factures
for f in factures:
    c.execute("""INSERT INTO factures 
        (id, dossier_id, societe_id, date_facture, numero_facture, client, 
         total_ht_0, total_ht_19, tva_19, timbre, total_ttc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (os.urandom(8).hex(), dossier_id, societe_id, f['date'], f['numero'],
         f['client'], f['ht0'], f['ht19'], f['tva19'], f['timbre'], f['ttc']))

print(f"Inserted {len(factures)} factures")

# Generate VT J.C entries (group by date)
from collections import defaultdict
by_day = defaultdict(list)
for f in factures:
    by_day[f['date']].append(f)

for date in sorted(by_day.keys()):
    day_f = by_day[date]
    nums = [ff['numero'].split('/')[1] for ff in day_f if '/' in ff['numero']]
    nums.sort(key=int)
    if len(nums) == 1:
        num_piece = f"FAC N{nums[0]}-26"
    else:
        num_piece = f"FAC N{'-'.join(nums)}-26"

    clients = list(set(ff['client'] for ff in day_f if ff['client']))
    has_named = len(clients) > 0
    libelle = "CLTS PASSAGERS/" + "/".join(clients) if has_named else "CLTS PASSAGERS"

    total_ht0 = sum(ff['ht0'] for ff in day_f)
    total_ht19 = sum(ff['ht19'] for ff in day_f)
    tva19 = sum(ff['tva19'] for ff in day_f)
    timbres = len(day_f)
    total_ttc = sum(ff['ttc'] for ff in day_f)

    # All goes to especes (411004) by default
    especes = total_ttc - timbres  # Net without timbres
    debit_sum = especes
    credit_sum = tva19 + timbres + total_ht0 + total_ht19
    ecart = round(debit_sum - credit_sum, 3)

    # Insert main line (411004 <-> 411004 = 0)
    c.execute("""INSERT INTO ecritures 
        (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte_debit, compte_credit, montant, tresorerie)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (os.urandom(8).hex(), dossier_id, societe_id, 'VT J.C', date, date, num_piece, libelle, '411004', '411004', 0, None))

    # Lines
    lines = []
    if especes > 0:
        lines.append(('411004', especes, 'D'))
    if total_ht0 > 0:
        lines.append(('707200', total_ht0, 'C'))
    if total_ht19 > 0:
        lines.append(('707219', total_ht19, 'C'))
    lines.append(('436711', tva19, 'C'))
    lines.append(('437500', timbres, 'C'))
    if ecart != 0:
        lines.append(('634500', abs(ecart), 'C' if ecart > 0 else 'D'))

    for compte, montant, sens in lines:
        if sens == 'D':
            debit, credit = compte, '411004'
        else:
            debit, credit = '411004', compte
        c.execute("""INSERT INTO ecritures 
            (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte_debit, compte_credit, montant, tresorerie)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (os.urandom(8).hex(), dossier_id, societe_id, 'VT J.C', date, date, num_piece, libelle, debit, credit, montant, None))

    print(f"{date}: {len(day_f)} factures | HT0={total_ht0:.3f} HT19={total_ht19:.3f} TVA={tva19:.3f} Timbre={timbres} Especes={especes:.3f} Ecart={ecart:.3f}")

# Update dossier counts
c.execute("UPDATE dossiers SET nb_ecritures = (SELECT COUNT(*) FROM ecritures WHERE dossier_id = ?) WHERE id = ?", (dossier_id, dossier_id))
c.execute("UPDATE dossiers SET nb_pieces = (SELECT COUNT(*) FROM pieces WHERE dossier_id = ?) WHERE id = ?", (dossier_id, dossier_id))

conn.commit()
conn.close()
print("\nDone! Factures and VT J.C ecritures inserted.")
