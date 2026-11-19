-- Índices sobre llaves foráneas usadas en uniones y borrados en cascada.
create index registrations_participant on registrations (participant_id);
create index registrations_promo on registrations (promo_code_id) where promo_code_id is not null;
create index payment_attempts_registration on payment_attempts (registration_id);
create index payment_attempts_installment on payment_attempts (installment_id);
create index link_tokens_registration on link_tokens (registration_id);
create index promo_redemptions_promo on promo_redemptions (promo_code_id);
create index promo_redemptions_participant on promo_redemptions (participant_id);
create index notifications_outbox_registration on notifications_outbox (registration_id);
create index recovery_codes_participant on recovery_codes (participant_id);
