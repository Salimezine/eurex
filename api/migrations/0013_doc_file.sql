-- 0013 : métadonnées de fichier joint (PDF/image) aux documents
ALTER TABLE org_expected_documents ADD COLUMN file_name TEXT;
ALTER TABLE org_expected_documents ADD COLUMN file_type TEXT;
ALTER TABLE org_expected_documents ADD COLUMN file_size INTEGER;
