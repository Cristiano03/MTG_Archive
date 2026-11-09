// Schema del database, idempotente: si può eseguire a ogni avvio (anche su un database già esistente).
// Catalogo (cards, printings) condiviso; collezione, mazzi e desideri appartengono a un utente.
export const SCHEMA = `
create table if not exists users(id bigserial primary key, email text not null unique, password_hash text not null, created_at timestamptz not null default now());
create table if not exists cards(oracle_id uuid primary key, name text not null, type_line text not null default '',
  color_identity text[] not null default '{}', oracle_text text not null default '', keywords text[] not null default '{}',
  commander_legality text, cmc numeric, mana_cost text, colors text[], updated_at timestamptz not null default now());
create table if not exists printings(id uuid primary key, oracle_id uuid not null references cards, set_code text not null,
  collector_number text not null, rarity text, lang text not null default 'en', image_small text, finishes text[] not null default '{}');
create table if not exists collection_items(id bigserial primary key, user_id bigint references users on delete cascade, printing_id uuid not null references printings,
  qty int not null check(qty>=0), lang text not null, finish text not null default 'nonfoil', condition text not null default 'NM',
  note text, created_at timestamptz not null default now());
create table if not exists decks(id bigserial primary key, user_id bigint references users on delete cascade, name text not null, mode text not null check(mode in('physical','virtual')),
  description text, archived boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
-- composizione desiderata (può essere incompleta/non valida: la validità si calcola, non si memorizza)
create table if not exists deck_cards(deck_id bigint not null references decks on delete cascade, oracle_id uuid not null references cards,
  qty int not null check(qty>0), is_commander boolean not null default false, primary key(deck_id,oracle_id,is_commander));
-- copie fisiche realmente riservate; item in RESTRICT: non si elimina una copia assegnata senza deciderlo
create table if not exists deck_assignments(deck_id bigint not null references decks on delete cascade,
  item_id bigint not null references collection_items on delete restrict, qty int not null check(qty>0), primary key(deck_id,item_id));
create table if not exists wishlist(id bigserial primary key, user_id bigint references users on delete cascade, oracle_id uuid not null references cards, qty_wanted int not null check(qty_wanted>0),
  priority int, note text, price_ref numeric(10,2), price_source text, price_at timestamptz, created_at timestamptz not null default now());
create table if not exists transactions(id bigserial primary key, user_id bigint, at timestamptz not null default now(), op text not null, payload jsonb not null default '{}');
create table if not exists catalog_sync(source text primary key, last_ok timestamptz, last_error text, detail jsonb);

-- Integrità anti-sovrassegnazione, valida anche con richieste simultanee: il lock sulla riga dell'item serializza.
-- Inoltre una copia può essere assegnata solo a un mazzo dello stesso utente.
create or replace function chk_assign() returns trigger language plpgsql as $$
declare q int; a int; iu bigint; du bigint;
begin
  select qty,user_id into q,iu from collection_items where id=new.item_id for update;
  select user_id into du from decks where id=new.deck_id;
  if iu is distinct from du then raise exception 'La copia appartiene a un altro utente' using errcode='23514'; end if;
  select coalesce(sum(qty),0) into a from deck_assignments where item_id=new.item_id and deck_id<>new.deck_id;
  if a+new.qty>q then raise exception 'Sovrassegnazione item %: possedute %, richieste %',new.item_id,q,a+new.qty using errcode='23514'; end if;
  return new;
end $$;
drop trigger if exists t_assign on deck_assignments;
create trigger t_assign before insert or update of qty on deck_assignments for each row execute function chk_assign();
create or replace function chk_item_qty() returns trigger language plpgsql as $$
begin
  if (select coalesce(sum(qty),0) from deck_assignments where item_id=new.id)>new.qty then
    raise exception 'Quantità inferiore alle copie assegnate (item %)',new.id using errcode='23514'; end if;
  return new;
end $$;
drop trigger if exists t_item_qty on collection_items;
create trigger t_item_qty before update of qty on collection_items for each row execute function chk_item_qty();
`;
// Aggiornamenti per database creati con versioni precedenti (tutti idempotenti).
export const UPGRADES = [
  `alter table wishlist add column if not exists created_at timestamptz not null default now()`,
  `alter table cards add column if not exists cmc numeric`,
  `alter table cards add column if not exists mana_cost text`,
  `alter table cards add column if not exists colors text[]`,
  `alter table collection_items add column if not exists user_id bigint references users on delete cascade`,
  `alter table decks add column if not exists user_id bigint references users on delete cascade`,
  `alter table wishlist add column if not exists user_id bigint references users on delete cascade`,
  `alter table transactions add column if not exists user_id bigint`,
  // unicità per utente (prima era globale)
  `alter table collection_items drop constraint if exists collection_items_printing_id_lang_finish_condition_key`,
  `create unique index if not exists collection_items_user_uq on collection_items(user_id,printing_id,lang,finish,condition)`,
  `drop index if exists wishlist_oracle_uq`,
  `alter table wishlist drop constraint if exists wishlist_oracle_id_key`,
  `create unique index if not exists wishlist_user_oracle_uq on wishlist(user_id,oracle_id)`,
  `create index if not exists decks_user_idx on decks(user_id)`,
  `create index if not exists printings_oracle_idx on printings(oracle_id)`,
  // Supabase espone le tabelle anche via API pubblica: con la sicurezza a livello di riga attiva e nessuna regola,
  // quell'accesso è chiuso. Il server si collega come proprietario delle tabelle e non ne è limitato.
  ...['users', 'cards', 'printings', 'collection_items', 'decks', 'deck_cards', 'deck_assignments', 'wishlist', 'transactions', 'catalog_sync']
    .map(t => `alter table ${t} enable row level security`),
];
