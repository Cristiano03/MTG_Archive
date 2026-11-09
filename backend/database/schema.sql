-- Catalogo (identità carta), stampe, inventario, mazzi, assegnazioni (spec 12.1)
create table cards(oracle_id uuid primary key, name text not null, type_line text not null default '',
  color_identity text[] not null default '{}', oracle_text text not null default '', keywords text[] not null default '{}',
  commander_legality text, cmc numeric, mana_cost text, colors text[], updated_at timestamptz not null default now());
create table printings(id uuid primary key, oracle_id uuid not null references cards, set_code text not null,
  collector_number text not null, rarity text, lang text not null default 'en', image_small text, finishes text[] not null default '{}');
create table collection_items(id bigserial primary key, printing_id uuid not null references printings,
  qty int not null check(qty>=0), lang text not null, finish text not null default 'nonfoil', condition text not null default 'NM',
  note text, created_at timestamptz not null default now(), unique(printing_id,lang,finish,condition));
create table decks(id bigserial primary key, name text not null, mode text not null check(mode in('physical','virtual')),
  description text, archived boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
-- composizione desiderata (può essere incompleta/non valida: la validità si calcola, non si memorizza)
create table deck_cards(deck_id bigint not null references decks on delete cascade, oracle_id uuid not null references cards,
  qty int not null check(qty>0), is_commander boolean not null default false, primary key(deck_id,oracle_id,is_commander));
-- copie fisiche realmente riservate; item in RESTRICT: non si elimina una copia assegnata senza deciderlo
create table deck_assignments(deck_id bigint not null references decks on delete cascade,
  item_id bigint not null references collection_items on delete restrict, qty int not null check(qty>0), primary key(deck_id,item_id));
create table wishlist(id bigserial primary key, oracle_id uuid not null unique references cards, qty_wanted int not null check(qty_wanted>0),
  priority int, note text, price_ref numeric(10,2), price_source text, price_at timestamptz, created_at timestamptz not null default now());
create table transactions(id bigserial primary key, at timestamptz not null default now(), op text not null, payload jsonb not null default '{}');
create table catalog_sync(source text primary key, last_ok timestamptz, last_error text, detail jsonb);

-- Integrità anti-sovrassegnazione, valida anche con richieste simultanee: il lock sulla riga dell'item serializza.
create function chk_assign() returns trigger language plpgsql as $$
declare q int; a int;
begin
  select qty into q from collection_items where id=new.item_id for update;
  select coalesce(sum(qty),0) into a from deck_assignments where item_id=new.item_id and deck_id<>new.deck_id;
  if a+new.qty>q then raise exception 'Sovrassegnazione item %: possedute %, richieste %',new.item_id,q,a+new.qty using errcode='23514'; end if;
  return new;
end $$;
create trigger t_assign before insert or update of qty on deck_assignments for each row execute function chk_assign();
create function chk_item_qty() returns trigger language plpgsql as $$
begin
  if (select coalesce(sum(qty),0) from deck_assignments where item_id=new.id)>new.qty then
    raise exception 'Quantità inferiore alle copie assegnate (item %)',new.id using errcode='23514'; end if;
  return new;
end $$;
create trigger t_item_qty before update of qty on collection_items for each row execute function chk_item_qty();
