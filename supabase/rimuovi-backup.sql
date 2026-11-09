-- Toglie le funzioni di backup e ripristino (non più usate dal sito). Da eseguire una volta nel SQL Editor di Supabase
-- sui progetti creati con la versione precedente di schema.sql. Non tocca i dati.
drop function if exists backup_snapshot();
drop function if exists backup_restore(jsonb);
