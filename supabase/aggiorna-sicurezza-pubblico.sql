-- Aggiornamento: sito pubblico. Il catalogo condiviso (carte, immagini, prezzi) lo scrive solo il database scaricando da Scryfall;
-- limiti per account; freno alle richieste; eliminazione dell'account; permessi più stretti.
-- Da eseguire UNA volta nel SQL Editor di Supabase (supabase/schema.sql lo contiene già). Non tocca i tuoi dati.
-- Se una riga esistente supera un limite (es. una nota più lunga di 500 caratteri) lo script si ferma e dice quale: va accorciata prima.

-- vecchie funzioni che lasciavano al sito scrivere il catalogo condiviso
drop function if exists catalog_upsert(jsonb, jsonb);
drop function if exists catalog_set_prices(jsonb);
drop function if exists catalog_sync_result(int, text);
drop function if exists app_status();
drop function if exists app.catalog_put(jsonb, jsonb, boolean);

create extension if not exists http with schema extensions; -- serve: il database scarica il catalogo da Scryfall
-- freno alle richieste: al massimo p_max chiamate al minuto per utente e per tipo
create table if not exists app.rate(user_id uuid not null, k text not null, minute timestamptz not null, n int not null default 0, primary key(user_id, k, minute));
revoke all on app.rate from public, anon, authenticated;
create or replace function app.rate_limit(p_key text, p_max int) returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into app.rate values(app.uid(), p_key, date_trunc('minute', now()), 1)
    on conflict(user_id, k, minute) do update set n = app.rate.n + 1 returning app.rate.n into n;
  if n > p_max then perform app.fail('PT429', 'Troppe richieste: riprova tra un minuto'); end if;
  if random() < 0.02 then delete from app.rate where minute < now() - interval '1 hour'; end if;
end $$;
-- /cards/collection di Scryfall (fino a 75 identificatori): restituisce le carte trovate
create or replace function app.sf_collection(p_ids jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare st int; body text;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '7000');
  select status, content into st, body from extensions.http(('POST', 'https://api.scryfall.com/cards/collection',
    array[extensions.http_header('User-Agent', 'mtg-commander-manager/1.0'), extensions.http_header('Accept', 'application/json')],
    'application/json', jsonb_build_object('identifiers', p_ids)::text)::extensions.http_request);
  if st = 429 then perform app.fail('PT429', 'Scryfall è sovraccarico: riprova tra un minuto'); end if;
  if st <> 200 then perform app.fail('PT502', 'Scryfall ' || st); end if;
  return coalesce(body::jsonb -> 'data', '[]');
end $$;
-- carte Scryfall -> tabelle cards e printings (per le carte a due facce si usa la faccia frontale); aggiorna anche legalità e prezzi
create or replace function app.catalog_save(p jsonb) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  drop table if exists pg_temp.sf;
  create temp table sf on commit drop as
    select c, coalesce(c->>'oracle_id', c->'card_faces'->0->>'oracle_id')::uuid oid, c->'card_faces'->0 f from jsonb_array_elements(p) c
    where coalesce(c->>'oracle_id', c->'card_faces'->0->>'oracle_id') is not null and c->>'id' is not null;
  insert into cards(oracle_id,name,type_line,color_identity,oracle_text,keywords,commander_legality,cmc,mana_cost,colors,updated_at)
    select distinct on (oid) oid, left(c->>'name', 200), left(coalesce(c->>'type_line', f->>'type_line', ''), 200),
      coalesce((select array_agg(x) from jsonb_array_elements_text(c->'color_identity') x), '{}'),
      left(coalesce(c->>'oracle_text', (select string_agg(y->>'oracle_text', E'\n') from jsonb_array_elements(c->'card_faces') y), ''), 4000),
      coalesce((select array_agg(x) from jsonb_array_elements_text(c->'keywords') x), '{}'), c->'legalities'->>'commander',
      coalesce(c->>'cmc', f->>'cmc')::numeric, coalesce(c->>'mana_cost', f->>'mana_cost'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(c->'colors', f->'colors')) x), '{}'), now()
    from sf
  on conflict(oracle_id) do update set name=excluded.name, type_line=excluded.type_line, color_identity=excluded.color_identity, oracle_text=excluded.oracle_text,
    keywords=excluded.keywords, commander_legality=excluded.commander_legality, cmc=excluded.cmc, mana_cost=excluded.mana_cost, colors=excluded.colors, updated_at=now();
  insert into printings(id,oracle_id,set_code,collector_number,rarity,lang,image_small,finishes,price_eur,price_eur_foil,price_at)
    select distinct on ((c->>'id')::uuid) (c->>'id')::uuid, oid, left(c->>'set', 12), left(c->>'collector_number', 20), c->>'rarity', coalesce(c->>'lang', 'en'),
      coalesce(c->'image_uris'->>'small', f->'image_uris'->>'small'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(c->'finishes') x), '{}'),
      (c->'prices'->>'eur')::numeric, coalesce(c->'prices'->>'eur_foil', c->'prices'->>'eur_etched')::numeric, now()
    from sf
  on conflict(id) do update set image_small=excluded.image_small, finishes=excluded.finishes,
    price_eur=excluded.price_eur, price_eur_foil=excluded.price_eur_foil, price_at=now();
  get diagnostics n = row_count;
  return n;
end $$;
-- ============================================================ FUNZIONI PER IL SITO (supabase.rpc)
-- ---------- catalogo
-- mette in catalogo le stampe indicate (fino a 75 per volta), scaricandole da Scryfall; quelle già presenti si saltano
create or replace function catalog_fetch(p_ids uuid[]) returns json language plpgsql security definer set search_path = public as $$
declare todo uuid[]; found jsonb;
begin
  perform app.uid();
  if coalesce(array_length(p_ids, 1), 0) > 75 then perform app.fail('PT400', 'Al massimo 75 stampe per volta'); end if;
  select coalesce(array_agg(distinct x), '{}') into todo from unnest(p_ids) x where x is not null and not exists(select 1 from printings where id=x);
  if array_length(todo, 1) is null then return json_build_object('added', 0, 'missing', '[]'::json); end if;
  perform app.rate_limit('scryfall', 120);
  found := app.sf_collection((select jsonb_agg(jsonb_build_object('id', x)) from unnest(todo) x));
  perform app.catalog_save(found);
  return json_build_object('added', jsonb_array_length(found),
    'missing', (select coalesce(json_agg(x), '[]') from unnest(todo) x where not exists(select 1 from printings where id=x)));
end $$;
-- aggiorna da Scryfall prezzi (stampe) e legalità/dati di mana (carte), fino a 75 identificatori per volta
create or replace function catalog_refresh(p_printings uuid[] default '{}', p_oracles uuid[] default '{}') returns json language plpgsql security definer set search_path = public as $$
declare ids jsonb; found jsonb; n int;
begin
  perform app.uid();
  if coalesce(array_length(p_printings, 1), 0) + coalesce(array_length(p_oracles, 1), 0) > 75 then perform app.fail('PT400', 'Al massimo 75 carte per volta'); end if;
  ids := coalesce((select jsonb_agg(jsonb_build_object('id', x)) from unnest(p_printings) x where exists(select 1 from printings where id=x)), '[]')
      || coalesce((select jsonb_agg(jsonb_build_object('oracle_id', x)) from unnest(p_oracles) x where exists(select 1 from cards where oracle_id=x)), '[]');
  if jsonb_array_length(ids) = 0 then return json_build_object('updated', 0); end if;
  perform app.rate_limit('scryfall', 120);
  found := app.sf_collection(ids);
  n := app.catalog_save(found);
  if coalesce(array_length(p_oracles, 1), 0) > 0 then
    insert into catalog_sync values('scryfall', now(), null, null) on conflict(source) do update set last_ok=now(), last_error=null;
  end if;
  return json_build_object('updated', n);
end $$;
-- le carte che ti riguardano (collezione, mazzi, desideri): sono quelle di cui si aggiorna la legalità
create or replace function my_oracles() returns json language sql stable set search_path = public as $$
  select coalesce(json_agg(distinct o), '[]') from (
    select p.oracle_id o from collection_items i join printings p on p.id=i.printing_id where i.user_id=app.uid()
    union select dc.oracle_id from deck_cards dc join decks d on d.id=dc.deck_id where d.user_id=app.uid()
    union select oracle_id from wishlist where user_id=app.uid()) x;
$$;
-- cronologia delle operazioni: si tengono le ultime 2000 per utente
create or replace function app.log(op text, payload jsonb) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := app.uid();
begin
  insert into transactions(user_id,op,payload) values(u, op, coalesce(payload,'{}'));
  if random() < 0.05 then
    delete from transactions where user_id=u and id < (select id from transactions where user_id=u order by id desc offset 2000 limit 1);
  end if;
end $$;
-- limiti per account
do $$ begin alter table collection_items add constraint ci_qty_max check (qty <= 10000); exception when duplicate_object then null; end $$;
do $$ begin alter table collection_items add constraint ci_note_len check (length(note) <= 500); exception when duplicate_object then null; end $$;
do $$ begin alter table collection_items add constraint ci_lang_len check (length(lang) <= 8); exception when duplicate_object then null; end $$;
do $$ begin alter table collection_items add constraint ci_cond check (condition in ('M','NM','EX','GD','LP','PL','PO')); exception when duplicate_object then null; end $$;
do $$ begin alter table collection_items add constraint ci_finish check (finish in ('nonfoil','foil','etched')); exception when duplicate_object then null; end $$;
do $$ begin alter table decks add constraint decks_desc_len check (length(description) <= 2000); exception when duplicate_object then null; end $$;
do $$ begin alter table deck_cards add constraint dc_qty_max check (qty <= 250); exception when duplicate_object then null; end $$;
do $$ begin alter table deck_assignments add constraint da_qty_max check (qty <= 10000); exception when duplicate_object then null; end $$;
do $$ begin alter table wishlist add constraint w_qty_max check (qty_wanted <= 1000); exception when duplicate_object then null; end $$;
do $$ begin alter table wishlist add constraint w_note_len check (length(note) <= 500); exception when duplicate_object then null; end $$;
do $$ begin alter table wishlist add constraint w_prio check (priority between 1 and 3); exception when duplicate_object then null; end $$;
do $$ begin alter table wishlist add constraint w_source_len check (length(price_source) <= 120); exception when duplicate_object then null; end $$;
do $$ begin alter table transactions add constraint t_payload_len check (length(payload::text) <= 20000); exception when duplicate_object then null; end $$;
create or replace function app.quota() returns trigger language plpgsql security definer set search_path = public as $$
declare n int; lim int := tg_argv[0]::int;
begin
  if tg_table_name = 'deck_cards' then select count(*) into n from deck_cards where deck_id=new.deck_id;
  else execute format('select count(*) from %I where user_id=$1', tg_table_name) into n using new.user_id; end if;
  if n >= lim then raise exception 'Limite raggiunto: al massimo % righe', lim using errcode='PT400'; end if;
  return new;
end $$;
drop trigger if exists q_items on collection_items;
drop trigger if exists q_decks on decks;
drop trigger if exists q_deck_cards on deck_cards;
drop trigger if exists q_wishlist on wishlist;
create trigger q_items before insert on collection_items for each row execute function app.quota('20000');
create trigger q_decks before insert on decks for each row execute function app.quota('300');
create trigger q_deck_cards before insert on deck_cards for each row execute function app.quota('400');
create trigger q_wishlist before insert on wishlist for each row execute function app.quota('3000');
-- ---------- account
-- elimina l'account e TUTTI i suoi dati (collezione, mazzi, desideri, cronologia). Non si può annullare.
create or replace function account_delete() returns void language plpgsql security definer set search_path = public as $$
declare u uuid := app.uid();
begin
  delete from app.rate where user_id=u;
  delete from deck_assignments where deck_id in (select id from decks where user_id=u);
  delete from auth.users where id=u;
end $$;
-- tabelle condivise e cronologia: in sola lettura per gli utenti (Supabase dà tutti i permessi di default; RLS li bloccherebbe comunque)
revoke insert, update, delete, truncate, references, trigger on cards, printings, catalog_sync from authenticated;
revoke update, delete, truncate, references, trigger on transactions from authenticated;
revoke truncate, references, trigger on collection_items, decks, deck_cards, deck_assignments, wishlist from authenticated;
-- permessi sulle funzioni: solo utenti collegati
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema app to authenticated;
