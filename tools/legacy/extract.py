import pdfplumber
import os
import json
import re
import sys

uploads_dir = r"C:\Users\ezzin\Downloads\eurex\uploads"
results = []

for fname in sorted(os.listdir(uploads_dir)):
    if not fname.startswith("Edition") or not fname.endswith(".pdf"):
        continue
    fpath = os.path.join(uploads_dir, fname)
    try:
        text = ""
        with pdfplumber.open(fpath) as pdf:
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    text += t + "\n"
        
        # Extract invoice number
        numero = ""
        m = re.search(r'(\d{3,4})/202\d', text)
        if m:
            numero = m.group(0)
        else:
            m2 = re.search(r'facture\s+(\d+)', text, re.I)
            if m2:
                numero = m2.group(1) + "/2026"
        
        # Extract date - look for "Tunis, le DD Mois YYYY" pattern
        date = ""
        m = re.search(r'le\s+(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{4})', text, re.I)
        if m:
            months = {"janvier":"01","fevrier":"02","mars":"03","avril":"04","mai":"05","juin":"06",
                      "juillet":"07","aout":"08","septembre":"09","octobre":"10","novembre":"11","decembre":"12"}
            d, mo, y = m.group(1), months.get(m.group(2).lower(), "01"), m.group(3)
            date = f"{y}-{mo}-{d.zfill(2)}"
        
        # Extract amounts - look for HT 0%, HT 19%, TVA 19%, Timbre, Net TTC
        ht0 = 0
        ht19 = 0
        tva19 = 0
        ttc = 0
        timbre = 1.000
        
        # Try to find HT 0% line: "HT 0%=XXX.XXX" or "0%=XXX.XXX"
        m = re.search(r'0%\s*=?\s*([\d\s.,]+)', text)
        if m:
            val = m.group(1).strip().replace(' ', '').replace(',', '.')
            try: ht0 = float(val)
            except: pass
        
        # Try to find HT 19% line: "HT 19%=XXX.XXX" or "19%=XXX.XXX"
        m = re.search(r'19%\s*=?\s*([\d\s.,]+)', text)
        if m:
            val = m.group(1).strip().replace(' ', '').replace(',', '.')
            try: ht19 = float(val)
            except: pass
        
        # TVA 19%
        m = re.search(r'TVA\s+19%\s*=?\s*([\d\s.,]+)', text)
        if m:
            val = m.group(1).strip().replace(' ', '').replace(',', '.')
            try: tva19 = float(val)
            except: pass
        
        # Timbre
        m = re.search(r'Timbre\s*=?\s*([\d\s.,]+)', text)
        if m:
            val = m.group(1).strip().replace(' ', '').replace(',', '.')
            try: timbre = float(val)
            except: pass
        
        # Net TTC
        m = re.search(r'Net\s*(?:à\s*)?payer\s*=?\s*([\d\s.,]+)', text, re.I)
        if m:
            val = m.group(1).strip().replace(' ', '').replace(',', '.')
            try: ttc = float(val)
            except: pass
        
        if ttc == 0:
            m = re.search(r'TTC\s*=?\s*([\d\s.,]+)', text)
            if m:
                val = m.group(1).strip().replace(' ', '').replace(',', '.')
                try: ttc = float(val)
                except: pass
        
        if ttc == 0 and (ht0 + ht19 + tva19) > 0:
            ttc = ht0 + ht19 + tva19 + timbre
        
        # Client
        client = ""
        m = re.search(r'CLIENTS?\s*PASSAGERS?', text, re.I)
        if m:
            client = "CLIENTS PASSAGERS"
        
        results.append({
            "file": fname,
            "numero": numero,
            "date": date,
            "client": client,
            "ht0": ht0,
            "ht19": ht19,
            "tva19": tva19,
            "timbre": timbre,
            "ttc": ttc,
            "text_preview": text[:300].replace('\n', ' ')
        })
        print(f"OK: {numero} | {date} | HT0={ht0} HT19={ht19} TVA={tva19} TTC={ttc}")
    except Exception as e:
        print(f"ERROR {fname}: {e}", file=sys.stderr)

print(f"\n--- Total: {len(results)} invoices ---")
print(json.dumps(results, indent=2, ensure_ascii=False))
