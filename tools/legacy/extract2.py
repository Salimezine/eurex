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

        numero = ""
        m = re.search(r'FACTURE\s*N[°o]?\s*:\s*(\d{4})\s*/\s*(\d+)', text)
        if m:
            numero = m.group(1) + "/" + m.group(2)

        date = ""
        m = re.search(r'LE\s*:\s*(\d{2})/(\d{2})/(\d{4})', text)
        if m:
            date = m.group(3) + "-" + m.group(2) + "-" + m.group(1)

        client = ""
        m = re.search(r'Client\s*:\s*(.+?)(?:\s+Adresse|\s+D)', text)
        if m:
            c = m.group(1).strip()
            client = "CLIENTS PASSAGERS" if "PASSAGERS" in c.upper() else c

        ht0 = ht19 = tva19 = ttc = 0
        timbre = 1.0

        for label, attr in [("0%", "ht0"), ("19%", "ht19")]:
            m = re.search(re.escape(label) + r'\s+([\d\s.,]+)', text)
            if m:
                val = m.group(1).strip().replace(' ', '').replace(',', '.')
                try: locals()[attr] if False else None; exec(attr + " = float('" + val + "')") if False else None
                except: pass
                if attr == "ht0":
                    try: ht0 = float(val)
                    except: pass
                else:
                    try: ht19 = float(val)
                    except: pass

        m = re.search(r'TVA\s*19%\s+([\d\s.,]+)', text)
        if m:
            val = m.group(1).strip().replace(' ', '').replace(',', '.')
            try: tva19 = float(val)
            except: pass

        m = re.search(r'Timbre\s+([\d\s.,]+)', text)
        if m:
            val = m.group(1).strip().replace(' ', '').replace(',', '.')
            try: timbre = float(val)
            except: pass

        m = re.search(r'(?:Net\s+[àa]\s+payer|Net\s*TTC)\s+([\d\s.,]+)', text, re.I)
        if m:
            val = m.group(1).strip().replace(' ', '').replace(',', '.')
            try: ttc = float(val)
            except: pass

        if tva19 == 0 and ht19 > 0:
            tva19 = round(ht19 * 0.19, 3)
        if ttc == 0 and (ht0 + ht19 + tva19) > 0:
            ttc = round(ht0 + ht19 + tva19 + timbre, 3)

        results.append({
            "file": fname, "numero": numero, "date": date, "client": client,
            "ht0": ht0, "ht19": ht19, "tva19": tva19, "timbre": timbre, "ttc": ttc
        })
        print(f"OK: {numero:10s} | {date:10s} | {client:25s} | HT0={ht0:10.3f} HT19={ht19:10.3f} TVA={tva19:10.3f} TTC={ttc:10.3f}")
    except Exception as e:
        print(f"ERROR {fname}: {e}", file=sys.stderr)

print(f"\n--- Total: {len(results)} invoices ---")
with open(os.path.join(os.path.dirname(__file__), "extracted.json"), "w") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)
print("Saved to extracted.json")
