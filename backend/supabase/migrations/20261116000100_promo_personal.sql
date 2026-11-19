-- Códigos personales y lotes.
-- allowed_doc_number: si tiene valor, solo ese documento puede usar el código.
-- batch / note: para agrupar códigos generados en lote y anotar a quién se entregó.
alter table promo_codes add column allowed_doc_number text;
alter table promo_codes add column batch text;
alter table promo_codes add column note text;
create index promo_codes_batch on promo_codes (event_id, batch);
