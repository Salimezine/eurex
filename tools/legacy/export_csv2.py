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
    
    # Determine sens based on account structure
    debit = d['compte_debit']
    credit = d['compte_credit']
    
    if debit.startswith('5') or credit.startswith('5'):
        sens = 'T'
    elif debit == '411004' and credit == '411004':
        sens = 'D'  # Main line or especes
    elif debit == '411004' and credit != '411004':
        sens = 'C'  # Credit entry
    elif debit != '411004' and credit == '411004':
        sens = 'D'  # Debit entry
    else:
        sens = 'D'
    
    line = ';'.join([
        d['date_operation'], d['date_piece'] or '', d['journal_code'],
        d['numero_doc'] or '', d['libelle'], debit,
        credit, montant, sens, d['tresorerie'] or ''
    ])
    lines.append(line)

with open('ecritures_vtjc_juin2026.csv', 'w', encoding='utf-8') as f:
    f.write(header + '\n' + '\n'.join(lines))

print("Exported {} lines to ecritures_vtjc_juin2026.csv".format(len(lines)))
print("\nSample lines:")
for l in lines[:8]:
    print("  " + l)
print("  ...")
for l in lines[-5:]:
    print("  " + l)

# Verify: for VT J.C, debit lines have Montant > 0 with sens='D', credit lines with sens='C'
# The total of all D lines should equal total of all C lines (for 4xxxx accounts)
total_d = 0
total_c = 0
for row in rows:
    d = dict(zip(cols, row))
    m = d['montant']
    if m == 0:
        continue
    debit = d['compte_debit']
    credit = d['compte_credit']
    if debit == '411004' and credit != '411004':
        total_c += m  # Credit
    elif debit != '411004' and credit == '411004':
        total_d += m  # Debit
    elif debit == '411004' and credit == '411004':
        total_d += m  # Especes debit
print("\nBalance check:")
print("  Debit (especes + debit entries): {:.3f}".format(total_d))
print("  Credit (credit entries): {:.3f}".format(total_c))
print("  Diff: {:.3f}".format(total_d - total_c))
db.close()
