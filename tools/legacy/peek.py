import pdfplumber, os

uploads_dir = r"C:\Users\ezzin\Downloads\eurex\uploads"
fname = "Edition facture vente331.pdf"
fpath = os.path.join(uploads_dir, fname)
with pdfplumber.open(fpath) as pdf:
    for i, page in enumerate(pdf.pages):
        t = page.extract_text()
        if t:
            print(f"=== Page {i+1} ===")
            print(t)
            print()
