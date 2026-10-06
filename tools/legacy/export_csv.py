import sqlite3

db = sqlite3.connect('comptaflow.db')
c = db.cursor()
c.execute("SELECT * FROM ecritures WHERE dossier_id = 'dossier_animal' AND journal_code = 'VT J.C' ORDER BY date_operation, journal_code")
rows = c.fetchall()
cols = [d[0] for d in c.description]

header = 'Date operation;Date piece;Journal;N doc;Libelle;Compte debit;Compte credit;Montant;Sens;Tresorerie'
lines = []
for row in rows:
    d = dict(zip(cols, row))
    montant = "{:.3f}".format(d['montant'])
    sens = 'T' if d['compte_debit'].startswith('5') else 'D'
    line = ';'.join([
        d['date_operation'], d['date_piece'] or '', d['journal_code'],
        d['numero_doc'] or '', d['libelle'], d['compte_debit'],
        d['compte_credit'], montant, sens, d['tresorerie'] or ''
    ])
    lines.append(line)

with open('ecritures_vtjc_juin2026.csv', 'w', encoding='utf-8') as f:
    f.write(header + '\n' + '\n'.join(lines))

print("Exported {} lines to ecritures_vtjc_juin2026.csv".format(len(lines)))
print("\nFirst 5 lines:")
for l in lines[:5]:
    print("  " + l)
print("...")
print("Last 5 lines:")
for l in lines[-5:]:
    print("  " + l)

# Verify balance
total_d = 0
total_c = 0
for row in rows:
    d = dict(zip(cols, row))
    if d['compte_debit'].startswith('4') or d['compte_debit'].startswith('5'):
        total_d += d['montant']
    if d['compte_credit'].startswith('4') or d['compte_credit'].startswith('5'):
        total_c += d['montant']
print("\nBalance: Debit={:.3f} Credit={:.3f} Diff={:.3f}".format(total_d, total_c, total_d - total_c))
db.close()
