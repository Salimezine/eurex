import requests, json, os

url = 'http://localhost:3001/api/dossiers/dossier_animal/process'
vte_c_dir = r'D:\ANIMAL  CITY\EXERCICE\2026\VENTE\06-2026\VTE C'

files = []
for fname in sorted(os.listdir(vte_c_dir)):
    if fname.startswith('Edition') and fname.endswith('.pdf'):
        fpath = os.path.join(vte_c_dir, fname)
        files.append(('files', (fname, open(fpath, 'rb'), 'application/pdf')))

print('Uploading {} files...'.format(len(files)))
r = requests.post(url, files=files)
data = r.json()
print('Processed:', data['processed'])
for res in data['results']:
    status = 'OK' if res['ok'] else 'ERR'
    print('  {}: {} -> {} {} TTC={}'.format(status, res['file'], res.get('numero','?'), res.get('date','?'), res.get('ttc','?')))
