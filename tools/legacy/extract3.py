import pdfplumber, os, json, re, sys

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

        # Invoice number: "FACTURE N°: 2026 / 331"
        numero = ""
        m = re.search(r'FACTURE\s*N[°�]?\s*:\s*(\d{4})\s*/\s*(\d+)', text)
        if m:
            numero = m.group(1) + "/" + m.group(2)

        # Date: "LE : 01/06/2026"
        date = ""
        m = re.search(r'LE\s*:\s*(\d{2})/(\d{2})/(\d{4})', text)
        if m:
            date = m.group(3) + "-" + m.group(2) + "-" + m.group(1)

        # Client: "Client : CLIENTS PASSAGERS"
        client = ""
        m = re.search(r'Client\s*:\s*(.+?)(?:\n|$)', text)
        if m:
            c = m.group(1).strip()
            client = "CLIENTS PASSAGERS" if "PASSAGERS" in c.upper() else c

        # HT 0%: "X,XXX 0%"
        ht0 = 0
        m = re.search(r'([\d][\d\s.,]+?)\s+0%', text)
        if m:
            val = m.group(1).strip().replace(' ', '').replace(',', '.')
            try: ht0 = float(val)
            except: pass

        # HT 19% + TVA: "X,XXX 19% X,XXX"
        ht19 = 0
        tva19 = 0
        m = re.search(r'([\d][\d\s.,]+?)\s+19%\s+([\d\s.,]+)', text)
        if m:
            val1 = m.group(1).strip().replace(' ', '').replace(',', '.')
            val2 = m.group(2).strip().replace(' ', '').replace(',', '.')
            try: ht19 = float(val1)
            except: pass
            try: tva19 = float(val2)
            except: pass

        # Timbre
        timbre = 1.0
        m = re.search(r'TIMBRE\s+FIS\.\s*:\s*([\d\s.,]+)', text)
        if m:
            val = m.group(1).strip().replace(' ', '').replace(',', '.')
            try: timbre = float(val)
            except: pass

        # Net TTC
        ttc = 0
        m = re.search(r'NET\s+T\.T\.C\.\s*([\d\s.,]+)', text)
        if m:
            val = m.group(1).strip().replace(' ', '').replace(',', '.')
            try: ttc = float(val)
            except: pass

        if tva19 == 0 and ht19 > 0:
            tva19 = round(ht19 * 0.19, 3)

        results.append({
            "file": fname, "numero": numero, "date": date, "client": client,
            "ht0": ht0, "ht19": ht19, "tva19": tva19, "timbre": timbre, "ttc": ttc
        })
        print(f"OK: {numero:10s} | {date:10s} | {client:25s} | HT0={ht0:10.3f} HT19={ht19:10.3f} TVA={tva19:10.3f} TTC={ttc:10.3f}")
    except Exception as e:
        print(f"ERROR {fname}: {e}", file=sys.stderr)

print(f"\n--- Total: {len(results)} invoices ---")
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "extracted.json"), "w") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)
print("Saved to extracted.json")
