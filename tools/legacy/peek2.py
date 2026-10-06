import pdfplumber, os

uploads_dir = r"C:\Users\ezzin\Downloads\eurex\uploads"
for fname in ["Edition facture vente333.pdf", "Edition facture vente366.pdf", "Edition facture vente390.pdf"]:
    fpath = os.path.join(uploads_dir, fname)
    with pdfplumber.open(fpath) as pdf:
        for i, page in enumerate(pdf.pages):
            t = page.extract_text()
            if t:
                print(f"=== {fname} Page {i+1} ===")
                print(t)
                print()
