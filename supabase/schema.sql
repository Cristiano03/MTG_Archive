-- Schema per Supabase: da incollare UNA volta in Supabase → SQL Editor → New query → Run (su un progetto nuovo).
-- Non c'è un server: il sito parla direttamente con il database.
-- • Account: Supabase Auth (auth.users). Ogni riga di collezione, mazzi e desideri ha user_id = l'utente collegato.
-- • Sicurezza: Row Level Security su ogni tabella, ognuno vede e modifica solo le proprie righe.
-- • Operazioni a più passi (assegnare copie ai mazzi, importare, acquisti dalla lista dei desideri…): funzioni qui sotto,
--   chiamate dal sito con supabase.rpc(). Ogni chiamata è una transazione: o va tutto a buon fine o non cambia nulla.
-- • Errori: codici PTnnn (PostgREST li trasforma nello stato HTTP nnn: 400, 404, 409).

-- ============================================================ TABELLE
-- Catalogo (identità carta, stampe) condiviso fra gli utenti: lo leggono tutti, lo scrivono solo le funzioni catalog_*.
create table cards(oracle_id uuid primary key, name text not null, type_line text not null default '',
  color_identity text[] not null default '{}', oracle_text text not null default '', keywords text[] not null default '{}',
  commander_legality text, cmc numeric, mana_cost text, colors text[], updated_at timestamptz not null default now());
create table printings(id uuid primary key, oracle_id uuid not null references cards, set_code text not null,
  collector_number text not null, rarity text, lang text not null default 'en', image_small text, finishes text[] not null default '{}',
  -- prezzo di riferimento Cardmarket in euro (da Scryfall), normale e foil, con la data dell'aggiornamento
  price_eur numeric(10,2), price_eur_foil numeric(10,2), price_at timestamptz);
create index printings_oracle_idx on printings(oracle_id);

create table collection_items(id bigserial primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  printing_id uuid not null references printings, qty int not null check(qty>=0), lang text not null, finish text not null default 'nonfoil',
  condition text not null default 'NM', note text, created_at timestamptz not null default now(), unique(user_id,printing_id,lang,finish,condition));
create table decks(id bigserial primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check(length(name) between 1 and 120), mode text not null check(mode in('physical','virtual')),
  description text, archived boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index decks_user_idx on decks(user_id);
-- composizione desiderata (può essere incompleta/non valida: la validità si calcola, non si memorizza)
-- printing_id: la stampa scelta per il mazzo (quella della collezione o della lista importata); null = nessuna preferenza
create table deck_cards(deck_id bigint not null references decks on delete cascade, oracle_id uuid not null references cards,
  qty int not null check(qty>0), is_commander boolean not null default false, primary key(deck_id,oracle_id,is_commander),
  printing_id uuid references printings);
-- copie fisiche realmente riservate; una copia assegnata non si elimina senza prima liberarla
-- (il controllo avviene a fine istruzione, così l'eliminazione di un account con tutti i suoi dati funziona)
create table deck_assignments(deck_id bigint not null references decks on delete cascade,
  item_id bigint not null references collection_items, qty int not null check(qty>0), primary key(deck_id,item_id));
create index deck_assignments_item_idx on deck_assignments(item_id);
create table wishlist(id bigserial primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  oracle_id uuid not null references cards, qty_wanted int not null check(qty_wanted>0), priority int, note text,
  price_ref numeric(10,2), price_source text, price_at timestamptz, created_at timestamptz not null default now(), unique(user_id,oracle_id),
  -- stampa voluta; null = qualsiasi (il prezzo è quello della stampa più economica)
  printing_id uuid references printings);
create table transactions(id bigserial primary key, user_id uuid default auth.uid() references auth.users on delete cascade,
  at timestamptz not null default now(), op text not null, payload jsonb not null default '{}');
create table catalog_sync(source text primary key, last_ok timestamptz, last_error text, detail jsonb);

-- Integrità anti-sovrassegnazione, valida anche con richieste simultanee: il lock sulla riga dell'item serializza.
-- Inoltre una copia può essere assegnata solo a un mazzo dello stesso utente.
create function chk_assign() returns trigger language plpgsql set search_path = public as $$
declare q int; a int; iu uuid; du uuid;
begin
  select qty,user_id into q,iu from collection_items where id=new.item_id for update;
  select user_id into du from decks where id=new.deck_id;
  if iu is distinct from du then raise exception 'La copia appartiene a un altro utente' using errcode='23514'; end if;
  select coalesce(sum(qty),0) into a from deck_assignments where item_id=new.item_id and deck_id<>new.deck_id;
  if a+new.qty>q then raise exception 'Sovrassegnazione: possedute %, richieste %',q,a+new.qty using errcode='23514'; end if;
  return new;
end $$;
create trigger t_assign before insert or update of qty on deck_assignments for each row execute function chk_assign();
create function chk_item_qty() returns trigger language plpgsql set search_path = public as $$
begin
  if (select coalesce(sum(qty),0) from deck_assignments where item_id=new.id)>new.qty then
    raise exception 'Quantità inferiore alle copie assegnate' using errcode='23514'; end if;
  return new;
end $$;
create trigger t_item_qty before update of qty on collection_items for each row execute function chk_item_qty();

-- funzioni interne (schema app): il sito non può chiamarle direttamente
create schema app;
grant usage on schema app to authenticated;

-- ============================================================ LIMITI PER ACCOUNT (sito pubblico)
-- quantità e testi ragionevoli, e un tetto alle righe per account: nessuno può riempire il database
alter table collection_items add constraint ci_qty_max check (qty <= 10000), add constraint ci_note_len check (length(note) <= 500),
  add constraint ci_lang_len check (length(lang) <= 8), add constraint ci_cond check (condition in ('M','NM','EX','GD','LP','PL','PO')),
  add constraint ci_finish check (finish in ('nonfoil','foil','etched'));
alter table decks add constraint decks_desc_len check (length(description) <= 2000);
alter table deck_cards add constraint dc_qty_max check (qty <= 250);
alter table deck_assignments add constraint da_qty_max check (qty <= 10000);
alter table wishlist add constraint w_qty_max check (qty_wanted <= 1000), add constraint w_note_len check (length(note) <= 500),
  add constraint w_prio check (priority between 1 and 3), add constraint w_source_len check (length(price_source) <= 120);
alter table transactions add constraint t_payload_len check (length(payload::text) <= 20000);
create function app.quota() returns trigger language plpgsql security definer set search_path = public as $$
declare n int; lim int := tg_argv[0]::int;
begin
  if tg_table_name = 'deck_cards' then select count(*) into n from deck_cards where deck_id=new.deck_id;
  else execute format('select count(*) from %I where user_id=$1', tg_table_name) into n using new.user_id; end if;
  if n >= lim then raise exception 'Limite raggiunto: al massimo % righe', lim using errcode='PT400'; end if;
  return new;
end $$;
create trigger q_items before insert on collection_items for each row execute function app.quota('20000');
create trigger q_decks before insert on decks for each row execute function app.quota('300');
create trigger q_deck_cards before insert on deck_cards for each row execute function app.quota('400');
create trigger q_wishlist before insert on wishlist for each row execute function app.quota('3000');

-- ============================================================ SICUREZZA (RLS)
alter table cards enable row level security;
alter table printings enable row level security;
alter table collection_items enable row level security;
alter table decks enable row level security;
alter table deck_cards enable row level security;
alter table deck_assignments enable row level security;
alter table wishlist enable row level security;
alter table transactions enable row level security;
alter table catalog_sync enable row level security;

create policy cards_read on cards for select to authenticated using (true);
create policy printings_read on printings for select to authenticated using (true);
create policy sync_read on catalog_sync for select to authenticated using (true);
create policy own on collection_items for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own on decks for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own on wishlist for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_read on transactions for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on transactions for insert to authenticated with check (user_id = (select auth.uid()));
create policy own on deck_cards for all to authenticated
  using (exists(select 1 from decks d where d.id=deck_id and d.user_id=(select auth.uid())))
  with check (exists(select 1 from decks d where d.id=deck_id and d.user_id=(select auth.uid())));
create policy own on deck_assignments for all to authenticated
  using (exists(select 1 from decks d where d.id=deck_id and d.user_id=(select auth.uid())))
  with check (exists(select 1 from decks d where d.id=deck_id and d.user_id=(select auth.uid())));

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
-- tabelle condivise e cronologia: in sola lettura per gli utenti (Supabase dà tutti i permessi di default; RLS li bloccherebbe comunque)
revoke insert, update, delete, truncate, references, trigger on cards, printings, catalog_sync from authenticated;
revoke update, delete, truncate, references, trigger on transactions from authenticated;
revoke truncate, references, trigger on collection_items, decks, deck_cards, deck_assignments, wishlist from authenticated;
grant select on cards, printings, catalog_sync to authenticated;
grant select, insert, update, delete on collection_items, decks, deck_cards, deck_assignments, wishlist to authenticated;
grant select, insert on transactions to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ============================================================ FUNZIONI INTERNE (schema app: non chiamabili dal sito)

create function app.uid() returns uuid language plpgsql stable as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Accesso richiesto' using errcode='PT401'; end if;
  return u;
end $$;
create function app.fail(code text, msg text, det text default null) returns void language plpgsql as $$
begin raise exception using message=msg, errcode=code, detail=coalesce(det,''); end $$;
-- cronologia delle operazioni: si tengono le ultime 2000 per utente
create function app.log(op text, payload jsonb) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := app.uid();
begin
  insert into transactions(user_id,op,payload) values(u, op, coalesce(payload,'{}'));
  if random() < 0.05 then
    delete from transactions where user_id=u and id < (select id from transactions where user_id=u order by id desc offset 2000 limit 1);
  end if;
end $$;
create function app.int(x jsonb, lo int default 1) returns int language plpgsql immutable as $$
declare n numeric;
begin
  begin n := (x #>> '{}')::numeric; exception when others then n := null; end;
  if n is null or n <> trunc(n) or n < lo or n > 1000000 then raise exception 'Numero intero non valido' using errcode='PT400'; end if;
  return n::int;
end $$;

-- Il mazzo dell'utente, bloccato fino a fine transazione.
create function app.lock_deck(p_id bigint) returns decks language plpgsql set search_path = public as $$
declare d decks;
begin
  select * into d from decks where id=p_id and user_id=app.uid() for update;
  if not found then perform app.fail('PT404','Mazzo non trovato'); end if;
  return d;
end $$;

-- Allinea le copie fisiche assegnate al mazzo a quelle richieste: mazzo fisico attivo = tante quante ne chiede (se libere),
-- virtuale o archiviato = nessuna. Usa prima le copie della stampa scelta per il mazzo; a parità toglie dalle copie
-- aggiunte per ultime e aggiunge dalle più vecchie.
create function app.sync_deck(p_id bigint) returns void language plpgsql set search_path = public as $$
declare d decks; w record; r record; cur int; t int;
begin
  select * into d from decks where id=p_id;
  for w in
    select x.oracle_id, max(x.q)::int q from (
      select oracle_id, sum(qty) q from deck_cards where deck_id=p_id and d.mode='physical' and not d.archived group by 1
      union all
      select p.oracle_id, 0 from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id where a.deck_id=p_id
    ) x group by x.oracle_id order by x.oracle_id
  loop
    perform 1 from collection_items i join printings p on p.id=i.printing_id where p.oracle_id=w.oracle_id and i.user_id=d.user_id order by i.id for update of i;
    select coalesce(sum(a.qty),0) into cur from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id
      where a.deck_id=p_id and p.oracle_id=w.oracle_id;
    if cur > w.q then
      for r in select a.item_id, a.qty from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id
          where a.deck_id=p_id and p.oracle_id=w.oracle_id
          order by exists(select 1 from deck_cards dc where dc.deck_id=p_id and dc.printing_id=i.printing_id), a.item_id desc loop
        exit when cur <= w.q;
        t := least(cur - w.q, r.qty);
        if t = r.qty then delete from deck_assignments where deck_id=p_id and item_id=r.item_id;
        else update deck_assignments set qty=qty-t where deck_id=p_id and item_id=r.item_id; end if;
        cur := cur - t;
      end loop;
    elsif cur < w.q then
      for r in select i.id, (i.qty-coalesce((select sum(x.qty) from deck_assignments x where x.item_id=i.id),0))::int free
          from collection_items i join printings p on p.id=i.printing_id where p.oracle_id=w.oracle_id and i.user_id=d.user_id
          order by exists(select 1 from deck_cards dc where dc.deck_id=p_id and dc.printing_id=i.printing_id) desc, i.id loop
        exit when cur >= w.q;
        t := least(w.q - cur, r.free);
        if t > 0 then
          insert into deck_assignments values(p_id,r.id,t) on conflict(deck_id,item_id) do update set qty=deck_assignments.qty+excluded.qty;
          cur := cur + t;
        end if;
      end loop;
    end if;
  end loop;
end $$;

-- Un comandante fa già parte delle 100 carte: se la stessa carta è anche tra le carte normali, quella copia in più viene tolta.
create function app.dedupe_commanders(p_deck bigint) returns void language plpgsql set search_path = public as $$
declare r record; cnt int := 0;
begin
  for r in select n.oracle_id, n.qty from deck_cards n join deck_cards k on k.deck_id=n.deck_id and k.oracle_id=n.oracle_id and k.is_commander
      where not n.is_commander and n.deck_id=p_deck loop
    if r.qty > 1 then update deck_cards set qty=qty-1 where deck_id=p_deck and oracle_id=r.oracle_id and not is_commander;
    else delete from deck_cards where deck_id=p_deck and oracle_id=r.oracle_id and not is_commander; end if;
    cnt := cnt + 1;
  end loop;
  if cnt > 0 then perform app.sync_deck(p_deck); end if; -- libera eventuali copie fisiche assegnate in più
end $$;

-- ---------- catalogo condiviso: SOLO dati di Scryfall, letti dal database stesso
-- Il sito non scrive mai nomi, immagini o prezzi: chiede soltanto "metti in catalogo / aggiorna queste stampe" (per id),
-- e il database li scarica da Scryfall con l'estensione http. Così nessun utente può falsare il catalogo che vedono tutti.
do $$ begin create extension if not exists http with schema extensions;
exception when others then raise notice 'Estensione http non disponibile: %', sqlerrm; end $$;

-- freno alle richieste: al massimo p_max chiamate al minuto per utente e per tipo
create table app.rate(user_id uuid not null, k text not null, minute timestamptz not null, n int not null default 0, primary key(user_id, k, minute));
revoke all on app.rate from public, anon, authenticated;
create function app.rate_limit(p_key text, p_max int) returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into app.rate values(app.uid(), p_key, date_trunc('minute', now()), 1)
    on conflict(user_id, k, minute) do update set n = app.rate.n + 1 returning app.rate.n into n;
  if n > p_max then perform app.fail('PT429', 'Troppe richieste: riprova tra un minuto'); end if;
  if random() < 0.02 then delete from app.rate where minute < now() - interval '1 hour'; end if;
end $$;

-- /cards/collection di Scryfall (fino a 75 identificatori): restituisce le carte trovate
create function app.sf_collection(p_ids jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
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
create function app.catalog_save(p jsonb) returns int language plpgsql security definer set search_path = public as $$
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
create function catalog_fetch(p_ids uuid[]) returns json language plpgsql security definer set search_path = public as $$
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
create function catalog_refresh(p_printings uuid[] default '{}', p_oracles uuid[] default '{}') returns json language plpgsql security definer set search_path = public as $$
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
create function my_oracles() returns json language sql stable set search_path = public as $$
  select coalesce(json_agg(distinct o), '[]') from (
    select p.oracle_id o from collection_items i join printings p on p.id=i.printing_id where i.user_id=app.uid()
    union select dc.oracle_id from deck_cards dc join decks d on d.id=dc.deck_id where d.user_id=app.uid()
    union select oracle_id from wishlist where user_id=app.uid()) x;
$$;

-- ---------- collezione
create function collection_list() returns json language sql stable as $$
  select coalesce(json_agg(x order by x.name, x.set_code), '[]') from (
    select i.id,i.printing_id,c.name,p.set_code,p.collector_number,i.lang,i.finish,i.condition,i.note,i.qty,
      coalesce(a.s,0)::int assigned,(i.qty-coalesce(a.s,0))::int free,p.rarity,p.image_small,c.type_line,c.color_identity,coalesce(c.colors,'{}') colors,c.cmc::float cmc,c.mana_cost,i.created_at,
      -- prezzo Cardmarket in euro di una copia: normale per le copie normali, foil per foil ed etched
      (case when i.finish='nonfoil' then coalesce(p.price_eur,p.price_eur_foil) else coalesce(p.price_eur_foil,p.price_eur) end)::float price,p.price_at,
      coalesce((select json_agg(x.deck_id) from deck_assignments x where x.item_id=i.id),'[]'::json) decks,
      -- mazzi che contengono la carta (anche virtuali, anche senza copie riservate)
      coalesce((select json_agg(distinct dc.deck_id) from deck_cards dc join decks d on d.id=dc.deck_id where dc.oracle_id=p.oracle_id and d.user_id=i.user_id),'[]'::json) in_decks
    from collection_items i join printings p on p.id=i.printing_id join cards c on c.oracle_id=p.oracle_id
    left join (select item_id,sum(qty) s from deck_assignments group by item_id) a on a.item_id=i.id where i.user_id=app.uid()) x;
$$;

create function collection_add(p_printing uuid, p_qty int, p_lang text default null, p_finish text default 'nonfoil', p_condition text default 'NM')
returns json language plpgsql set search_path = public as $$
declare r collection_items;
begin
  if not exists(select 1 from printings where id=p_printing) then perform app.fail('PT404','Stampa non in catalogo'); end if;
  perform app.int(to_jsonb(p_qty));
  insert into collection_items(user_id,printing_id,qty,lang,finish,condition)
    values(app.uid(),p_printing,p_qty,coalesce(p_lang,(select lang from printings where id=p_printing)),coalesce(p_finish,'nonfoil'),coalesce(p_condition,'NM'))
    on conflict(user_id,printing_id,lang,finish,condition) do update set qty=collection_items.qty+excluded.qty returning * into r;
  perform app.log('collection.add', jsonb_build_object('printing_id',p_printing,'qty',p_qty));
  return row_to_json(r);
end $$;

-- Se la nuova quantità è inferiore alle copie assegnate serve release=true (libera le assegnazioni in eccesso), altrimenti 409.
create function app.set_qty(p_id bigint, p_qty int, p_release boolean) returns void language plpgsql set search_path = public as $$
declare it collection_items; a record; ex int; t int;
begin
  select * into it from collection_items where id=p_id and user_id=app.uid() for update;
  if not found then perform app.fail('PT404','Copia non trovata'); end if;
  select coalesce(sum(qty),0)-p_qty into ex from deck_assignments where item_id=p_id;
  if ex > 0 and not p_release then
    perform app.fail('PT409','Copie assegnate a mazzi: conferma con release=true',
      (select json_build_object('assigned',json_agg(json_build_object('deck_id',deck_id,'qty',qty)))::text from deck_assignments where item_id=p_id)); end if;
  for a in select deck_id, qty from deck_assignments where item_id=p_id order by qty desc for update loop
    exit when ex <= 0;
    t := least(ex, a.qty);
    if t = a.qty then delete from deck_assignments where deck_id=a.deck_id and item_id=p_id;
    else update deck_assignments set qty=qty-t where deck_id=a.deck_id and item_id=p_id; end if;
    ex := ex - t;
  end loop;
  if p_qty = 0 then delete from collection_items where id=p_id; else update collection_items set qty=p_qty where id=p_id; end if;
  perform app.log('collection.qty', jsonb_build_object('id',p_id,'from',it.qty,'to',p_qty,'release',p_release));
end $$;
create function collection_set_qty(p_id bigint, p_qty int, p_release boolean default false) returns void language sql as $$
  select app.set_qty(p_id, app.int(to_jsonb(p_qty), 0), coalesce(p_release,false));
$$;

-- rimozione di più righe insieme (tutte le copie di ogni riga). Se qualcuna è assegnata a un mazzo serve release=true.
create function collection_bulk_delete(p_ids bigint[], p_release boolean default false) returns json language plpgsql set search_path = public as $$
declare ids bigint[]; busy json; v_id bigint; copies int := 0; q int;
begin
  if coalesce(array_length(p_ids,1),0) = 0 then perform app.fail('PT400','Nessuna carta selezionata'); end if;
  select coalesce(array_agg(i.id),'{}') into ids from collection_items i where i.id=any(p_ids) and i.user_id=app.uid();
  if not coalesce(p_release,false) then
    select json_agg(distinct c.name) into busy from deck_assignments a join collection_items i on i.id=a.item_id
      join printings p on p.id=i.printing_id join cards c on c.oracle_id=p.oracle_id where a.item_id=any(ids);
    if busy is not null then perform app.fail('PT409','Alcune carte sono assegnate a un mazzo', json_build_object('assigned',busy)::text); end if;
  end if;
  foreach v_id in array ids loop
    select qty into q from collection_items where id=v_id;
    if found then copies := copies + q; perform app.set_qty(v_id, 0, true); end if;
  end loop;
  return json_build_object('removed', coalesce(array_length(ids,1),0), 'copies', copies);
end $$;

-- Cambiata la stampa di una copia: i mazzi che avevano scelto la vecchia stampa passano alla nuova,
-- se non hai più copie della vecchia.
create function app.follow_print(p_user uuid, p_old uuid, p_new uuid) returns void language sql set search_path = public as $$
  update deck_cards dc set printing_id=p_new from decks d
  where p_old is distinct from p_new and d.id=dc.deck_id and d.user_id=p_user and dc.printing_id=p_old
    and not exists(select 1 from collection_items i where i.user_id=p_user and i.printing_id=p_old);
$$;

-- Modifica stampa/lingua/finitura/condizione/nota. Se la combinazione esiste già, le due righe vengono unite (quantità e assegnazioni comprese).
create function collection_edit(p_id bigint, p jsonb) returns json language plpgsql set search_path = public as $$
declare it collection_items; tg collection_items; a record; pid uuid; lng text; fin text; cond text; nt text; o uuid; np record;
begin
  select * into it from collection_items where id=p_id and user_id=app.uid() for update;
  if not found then perform app.fail('PT404','Copia non trovata'); end if;
  pid := it.printing_id; lng := coalesce(p->>'lang', it.lang);
  if p->>'printing_id' is not null and (p->>'printing_id')::uuid <> it.printing_id then
    select oracle_id into o from printings where id=it.printing_id;
    select oracle_id, lang into np from printings where id=(p->>'printing_id')::uuid;
    if not found then perform app.fail('PT404','Stampa non in catalogo'); end if;
    if np.oracle_id <> o then perform app.fail('PT400','La nuova stampa deve essere la stessa carta'); end if;
    pid := (p->>'printing_id')::uuid; if not p ? 'lang' then lng := np.lang; end if;
  end if;
  fin := coalesce(p->>'finish', it.finish); cond := coalesce(p->>'condition', it.condition);
  nt := case when p ? 'note' then nullif(p->>'note','') else it.note end;
  if fin not in ('nonfoil','foil','etched') or cond not in ('M','NM','EX','GD','LP','PL','PO') or trim(coalesce(lng,'')) = '' then
    perform app.fail('PT400','Lingua, finitura o condizione non valida'); end if;
  select * into tg from collection_items where user_id=it.user_id and printing_id=pid and lang=lng and finish=fin and condition=cond and id<>p_id for update;
  if not found then
    update collection_items set printing_id=pid,lang=lng,finish=fin,condition=cond,note=nt where id=p_id;
    perform app.follow_print(it.user_id, it.printing_id, pid);
    perform app.log('collection.edit', jsonb_build_object('id',p_id) || p);
    return json_build_object('merged', false);
  end if;
  update collection_items set qty=qty+it.qty, note=coalesce(note,nt) where id=tg.id;
  for a in select deck_id, qty from deck_assignments where item_id=p_id for update loop
    delete from deck_assignments where deck_id=a.deck_id and item_id=p_id;
    insert into deck_assignments values(a.deck_id,tg.id,a.qty) on conflict(deck_id,item_id) do update set qty=deck_assignments.qty+excluded.qty;
  end loop;
  delete from collection_items where id=p_id;
  perform app.follow_print(it.user_id, it.printing_id, pid);
  perform app.log('collection.merge', jsonb_build_object('from',p_id,'into',tg.id));
  return json_build_object('merged', true, 'into', tg.id);
end $$;

-- Cambio di stampa in blocco (es. tutte le carte selezionate nella stessa edizione): [{id, printing_id}].
-- Lingua, finitura, condizione e note restano; le righe che diventano uguali a un'altra vengono unite. Tutto o niente.
create function collection_set_printings(p jsonb) returns json language plpgsql set search_path = public as $$
declare x jsonb; r json; n int := 0; merged int := 0;
begin
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 then perform app.fail('PT400','Nessuna carta selezionata'); end if;
  for x in select * from jsonb_array_elements(p) loop
    -- la riga può essere già stata unita a un'altra in questo stesso cambio
    continue when not exists(select 1 from collection_items where id=(x->>'id')::bigint and user_id=app.uid());
    r := collection_edit((x->>'id')::bigint, jsonb_build_object('printing_id', x->>'printing_id', 'lang', null));
    n := n + 1; if (r->>'merged')::boolean then merged := merged + 1; end if;
  end loop;
  perform app.log('collection.set_printings', jsonb_build_object('rows',n,'merged',merged));
  return json_build_object('changed', n, 'merged', merged);
end $$;

-- ---------- mazzi
create function decks_list() returns json language sql stable as $$
  select coalesce(json_agg(x order by x.updated_at desc), '[]') from (
    select d.id,d.name,d.mode,d.archived,d.updated_at,
      (select coalesce(sum(qty),0)::int from deck_cards where deck_id=d.id) cards,(select coalesce(sum(qty),0)::int from deck_assignments where deck_id=d.id) assigned,
      coalesce((select array_agg(distinct x order by x) from deck_cards dc join cards c on c.oracle_id=dc.oracle_id, unnest(c.color_identity) x where dc.deck_id=d.id and dc.is_commander),'{}') ci,
      coalesce((select string_agg(c.name,' + ' order by c.name) from deck_cards dc join cards c on c.oracle_id=dc.oracle_id where dc.deck_id=d.id and dc.is_commander),'') commanders
    from decks d where d.user_id=app.uid()) x;
$$;

-- Dati grezzi di un mazzo: il sito calcola copie assegnate per riga, mancanti e validità.
create function deck_get(p_id bigint) returns json language plpgsql stable set search_path = public as $$
declare d decks; uid uuid := app.uid();
begin
  select * into d from decks where id=p_id and user_id=uid;
  if not found then perform app.fail('PT404','Mazzo non trovato'); end if;
  return json_build_object('deck', row_to_json(d), 'rows', (select coalesce(json_agg(r order by r.is_commander desc, r.name), '[]') from (
    select c.oracle_id,c.name,c.color_identity,coalesce(c.colors,'{}') colors,c.cmc::float cmc,c.mana_cost,c.type_line,c.oracle_text,c.keywords,c.commander_legality,c.updated_at,
      pr.id printing_id,pr.image_small image,pr.set_code,pr.collector_number,pr.price_eur,pr.price_eur_foil,pr.price_at,dc.is_commander,
      -- stampe delle copie riservate al mazzo (per vedere, ad esempio, Isole di edizioni diverse)
      (select json_agg(json_build_object('set_code',p.set_code,'collector_number',p.collector_number,'qty',x.q) order by x.q desc, p.set_code)
        from (select i.printing_id, sum(a.qty)::int q from deck_assignments a join collection_items i on i.id=a.item_id where a.deck_id=p_id group by 1) x
        join printings p on p.id=x.printing_id where p.oracle_id=dc.oracle_id) prints,dc.qty::int need,coalesce(g.q,0)::int got_total,
      coalesce((select sum(i.qty-coalesce((select sum(x.qty) from deck_assignments x where x.item_id=i.id),0)) from collection_items i join printings p on p.id=i.printing_id where p.oracle_id=c.oracle_id and i.user_id=uid),0)::int free_total,
      coalesce((select sum(i.qty) from collection_items i join printings p on p.id=i.printing_id where p.oracle_id=c.oracle_id and i.user_id=uid),0)::int owned
    from deck_cards dc join cards c on c.oracle_id=dc.oracle_id
    left join (select p.oracle_id,sum(a.qty)::int q from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id where a.deck_id=p_id group by 1) g on g.oracle_id=dc.oracle_id
    -- stampa mostrata: quella scelta per il mazzo, altrimenti quella della copia assegnata, poi una che possiedi, poi una qualsiasi
    left join lateral (select p.id,p.image_small,p.set_code,p.collector_number,p.price_eur,p.price_eur_foil,p.price_at from printings p
      left join collection_items i on i.printing_id=p.id and i.user_id=uid left join deck_assignments a on a.item_id=i.id and a.deck_id=p_id
      where p.oracle_id=dc.oracle_id
      order by coalesce(p.id=dc.printing_id,false) desc,(a.item_id is not null) desc,(i.id is not null) desc,p.set_code limit 1) pr on true
    where dc.deck_id=p_id) r));
end $$;

-- edizione per l'esportazione: quella scelta per il mazzo, altrimenti quella della copia assegnata, poi quella che possiedi, poi una qualsiasi
create function deck_editions(p_id bigint) returns json language sql stable as $$
  select coalesce(json_object_agg(x.oracle_id, x.e), '{}') from (
    select distinct on (p.oracle_id) p.oracle_id,'('||upper(p.set_code)||') '||p.collector_number e
    from printings p left join collection_items i on i.printing_id=p.id and i.user_id=app.uid()
    left join deck_assignments a on a.item_id=i.id and a.deck_id=p_id
    where p.oracle_id in (select dc.oracle_id from deck_cards dc join decks d on d.id=dc.deck_id where dc.deck_id=p_id and d.user_id=app.uid())
    order by p.oracle_id,exists(select 1 from deck_cards dc where dc.deck_id=p_id and dc.printing_id=p.id) desc,(a.item_id is not null) desc,(i.id is not null) desc,p.set_code) x;
$$;

-- delta positivo o negativo; i comandanti sono max 2. L'oracle_id deve già essere in catalogo (catalog_fetch).
-- p_printing: stampa scelta nella ricerca; resta quella già scelta se la carta era nel mazzo.
create function deck_change_card(p_id bigint, p_oracle uuid, p_delta int, p_commander boolean default false, p_printing uuid default null) returns void language plpgsql set search_path = public as $$
declare cmd boolean := coalesce(p_commander,false); cur int; nxt int;
begin
  perform app.lock_deck(p_id);
  perform app.int(to_jsonb(p_delta), -999);
  if p_delta = 0 then perform app.fail('PT400','delta non può essere 0'); end if;
  if not exists(select 1 from cards where oracle_id=p_oracle) then perform app.fail('PT404','Carta non in catalogo'); end if;
  if p_printing is not null and not exists(select 1 from printings where id=p_printing and oracle_id=p_oracle) then perform app.fail('PT400','La stampa è di un’altra carta'); end if;
  if not cmd and p_delta > 0 and exists(select 1 from deck_cards where deck_id=p_id and oracle_id=p_oracle and is_commander) then
    perform app.fail('PT400','Questa carta è già il comandante del mazzo: conta già tra le 100 carte'); end if;
  select coalesce((select qty from deck_cards where deck_id=p_id and oracle_id=p_oracle and is_commander=cmd),0) into cur;
  nxt := cur + p_delta;
  if cmd and nxt > 1 then perform app.fail('PT400','Questa carta è già il comandante: un comandante vale una sola copia'); end if;
  if nxt <= 0 then delete from deck_cards where deck_id=p_id and oracle_id=p_oracle and is_commander=cmd;
  else insert into deck_cards(deck_id,oracle_id,qty,is_commander,printing_id) values(p_id,p_oracle,nxt,cmd,p_printing)
    on conflict(deck_id,oracle_id,is_commander) do update set qty=excluded.qty, printing_id=coalesce(deck_cards.printing_id,excluded.printing_id); end if;
  if (select coalesce(sum(qty),0) from deck_cards where deck_id=p_id and is_commander) > 2 then perform app.fail('PT400','Massimo 2 comandanti'); end if;
  if cmd and p_delta > 0 then perform app.dedupe_commanders(p_id); end if; -- se era già tra le carte normali, la copia diventa il comandante
  perform app.sync_deck(p_id); update decks set updated_at=now() where id=p_id;
end $$;

-- toglie più carte dal mazzo insieme (tutte le copie di ogni riga); le copie fisiche tornano libere
create function deck_bulk_remove(p_id bigint, p_items jsonb) returns json language plpgsql set search_path = public as $$
declare n int := 0; k int; it jsonb;
begin
  perform app.lock_deck(p_id);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then perform app.fail('PT400','Nessuna carta selezionata'); end if;
  for it in select * from jsonb_array_elements(p_items) loop
    delete from deck_cards where deck_id=p_id and oracle_id=(it->>'oracle_id')::uuid and is_commander=coalesce((it->>'is_commander')::boolean,false);
    get diagnostics k = row_count; n := n + k;
  end loop;
  perform app.sync_deck(p_id); update decks set updated_at=now() where id=p_id;
  perform app.log('deck.bulk_remove', jsonb_build_object('id',p_id,'rows',n));
  return json_build_object('removed', n);
end $$;

create function deck_delete(p_id bigint) returns void language plpgsql set search_path = public as $$
begin
  perform app.lock_deck(p_id); delete from decks where id=p_id;
  perform app.log('deck.delete', jsonb_build_object('id',p_id));
end $$;

create function deck_archive(p_id bigint, p_archived boolean) returns void language plpgsql set search_path = public as $$
begin
  perform app.lock_deck(p_id);
  update decks set archived=coalesce(p_archived,false),updated_at=now() where id=p_id; perform app.sync_deck(p_id);
end $$;

-- virtuale -> fisico: senza confirm restituisce solo cosa manca; con confirm assegna le copie disponibili
create function deck_convert(p_id bigint, p_confirm boolean default false) returns json language plpgsql set search_path = public as $$
declare d decks; m json;
begin
  d := app.lock_deck(p_id);
  if d.mode = 'physical' then perform app.fail('PT400','Mazzo già fisico'); end if;
  select coalesce(json_agg(json_build_object('name',x.name,'missing',x.need-x.free)),'[]') into m from (
    select c.name,sum(dc.qty)::int need,coalesce(f.f,0)::int free from deck_cards dc join cards c on c.oracle_id=dc.oracle_id
    left join (select p.oracle_id,sum(i.qty-coalesce((select sum(qty) from deck_assignments x where x.item_id=i.id),0)) f
      from collection_items i join printings p on p.id=i.printing_id where i.user_id=d.user_id group by 1) f on f.oracle_id=dc.oracle_id
    where dc.deck_id=p_id group by c.name,f.f) x where x.need > x.free;
  if json_array_length(m) > 0 and not coalesce(p_confirm,false) then return json_build_object('converted',false,'missing',m); end if;
  update decks set mode='physical',updated_at=now() where id=p_id; perform app.sync_deck(p_id);
  perform app.log('deck.convert', jsonb_build_object('id',p_id,'missing',m));
  return json_build_object('converted',true,'missing',m);
end $$;

-- Aggiunge alla collezione le copie che mancano al mazzo (tutte, o solo quelle di una carta), con una stampa del catalogo:
-- quella scelta per il mazzo, altrimenti quella che possiedi già, altrimenti la prima disponibile. Le copie vengono subito assegnate al mazzo.
create function deck_collect(p_id bigint, p_oracle uuid default null) returns json language plpgsql set search_path = public as $$
declare d decks; r record; got int; n int; pr record; added int := 0;
begin
  d := app.lock_deck(p_id);
  if d.mode <> 'physical' or d.archived then perform app.fail('PT400','Solo i mazzi fisici attivi aggiungono carte alla collezione'); end if;
  perform app.sync_deck(p_id); -- prima le copie libere che hai già
  for r in select dc.oracle_id, sum(dc.qty)::int need from deck_cards dc where dc.deck_id=p_id and (p_oracle is null or dc.oracle_id=p_oracle) group by dc.oracle_id loop
    select coalesce(sum(a.qty),0) into got from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id
      where a.deck_id=p_id and p.oracle_id=r.oracle_id;
    n := r.need - got; continue when n <= 0;
    select p.id, p.lang into pr from printings p left join collection_items i on i.printing_id=p.id and i.user_id=d.user_id
      where p.oracle_id=r.oracle_id
      order by exists(select 1 from deck_cards dc where dc.deck_id=p_id and dc.printing_id=p.id) desc, (i.id is not null) desc, p.set_code limit 1;
    continue when not found;
    insert into collection_items(user_id,printing_id,qty,lang,finish,condition) values(d.user_id,pr.id,n,pr.lang,'nonfoil','NM')
      on conflict(user_id,printing_id,lang,finish,condition) do update set qty=collection_items.qty+excluded.qty;
    added := added + n;
  end loop;
  perform app.sync_deck(p_id);
  perform app.log('deck.collect', jsonb_build_object('id',p_id,'oracle_id',p_oracle,'added',added));
  return json_build_object('added', added);
end $$;

-- Aggiunge al mazzo le carte selezionate nella collezione, tenendo la stampa della copia selezionata.
-- • Carte singole: una copia. Se la carta è già nel mazzo, prende la stampa selezionata (e nei mazzi fisici
--   la copia riservata diventa quella selezionata, se è libera).
-- • Carte che ammettono più copie (terre base, "any number of cards named"): entrano tutte le copie delle righe
--   selezionate, senza contare quelle già riservate a questo mazzo; nei mazzi fisici si riservano proprio quelle copie.
create function deck_add_items(p_id bigint, p_items bigint[]) returns json language plpgsql set search_path = public as $$
declare d decks; phys boolean; r record; v_item bigint; pick bigint; pick_pr uuid; f int; n int; other bigint;
  added int := 0; updated int := 0; skipped int := 0;
begin
  d := app.lock_deck(p_id); phys := d.mode = 'physical' and not d.archived;
  if coalesce(array_length(p_items,1),0) = 0 then perform app.fail('PT400','Nessuna carta selezionata'); end if;
  perform 1 from collection_items where id=any(p_items) and user_id=d.user_id order by id for update;
  -- una riga per carta, con le copie selezionate nell'ordine della selezione
  for r in select p.oracle_id, (c.type_line ~ 'Basic Land' or c.oracle_text ~* 'any number of cards named') many,
      array_agg(i.id order by array_position(p_items, i.id)) items,
      sum(i.qty - coalesce((select sum(x.qty) from deck_assignments x where x.item_id=i.id and x.deck_id=p_id),0))::int copies
    from collection_items i join printings p on p.id=i.printing_id join cards c on c.oracle_id=p.oracle_id
    where i.id=any(p_items) and i.user_id=d.user_id group by p.oracle_id, c.type_line, c.oracle_text loop
    -- copia "principale": la prima selezionata con copie libere, altrimenti la prima selezionata
    select i.id, i.printing_id into pick, pick_pr from collection_items i where i.id=any(r.items)
      order by (i.qty-coalesce((select sum(x.qty) from deck_assignments x where x.item_id=i.id),0)) > 0 desc, array_position(r.items, i.id) limit 1;
    if r.many then
      continue when r.copies <= 0;
      insert into deck_cards(deck_id,oracle_id,qty,is_commander,printing_id) values(p_id,r.oracle_id,r.copies,false,pick_pr)
        on conflict(deck_id,oracle_id,is_commander) do update set qty=deck_cards.qty+excluded.qty, printing_id=coalesce(deck_cards.printing_id,excluded.printing_id);
      added := added + r.copies;
      if phys then
        foreach v_item in array r.items loop
          select i.qty-coalesce((select sum(x.qty) from deck_assignments x where x.item_id=i.id),0) into f from collection_items i where i.id=v_item;
          if f > 0 then insert into deck_assignments values(p_id,v_item,f) on conflict(deck_id,item_id) do update set qty=deck_assignments.qty+excluded.qty; end if;
        end loop;
      end if;
    elsif exists(select 1 from deck_cards where deck_id=p_id and oracle_id=r.oracle_id) then
      update deck_cards set printing_id=pick_pr where deck_id=p_id and oracle_id=r.oracle_id and printing_id is distinct from pick_pr;
      if found then updated := updated + 1; else skipped := skipped + 1; end if;
      -- mazzo fisico: la copia riservata diventa quella selezionata (se è libera e non è già riservata qui)
      if phys and not exists(select 1 from deck_assignments where deck_id=p_id and item_id=pick) then
        select i.qty-coalesce((select sum(x.qty) from deck_assignments x where x.item_id=i.id),0) into f from collection_items i where i.id=pick;
        select a.item_id into other from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id
          where a.deck_id=p_id and p.oracle_id=r.oracle_id order by a.item_id desc limit 1;
        if f > 0 and other is not null then
          select qty into n from deck_assignments where deck_id=p_id and item_id=other;
          if n > 1 then update deck_assignments set qty=qty-1 where deck_id=p_id and item_id=other; else delete from deck_assignments where deck_id=p_id and item_id=other; end if;
          insert into deck_assignments values(p_id,pick,1);
        end if;
      end if;
    else
      insert into deck_cards(deck_id,oracle_id,qty,is_commander,printing_id) values(p_id,r.oracle_id,1,false,pick_pr);
      added := added + 1;
      if phys then
        select i.qty-coalesce((select sum(x.qty) from deck_assignments x where x.item_id=i.id),0) into f from collection_items i where i.id=pick;
        if f > 0 then insert into deck_assignments values(p_id,pick,1); end if;
      end if;
    end if;
  end loop;
  perform app.sync_deck(p_id); update decks set updated_at=now() where id=p_id;
  perform app.log('deck.add_items', jsonb_build_object('id',p_id,'added',added,'updated',updated,'skipped',skipped));
  return json_build_object('added', added, 'updated', updated, 'skipped', skipped);
end $$;

-- ---------- importazione (tutto o niente)
-- target: 'collection' oppure l'id di un mazzo. Le stampe devono essere già in catalogo (il sito le aggiunge prima).
-- replace (solo mazzi): sostituisce le carte del mazzo con quelle della lista. Se la lista non ha una sezione
--   "Commander", il comandante attuale resta (le liste in testo semplice di solito non lo indicano).
-- add (solo mazzi fisici): 'missing' aggiunge alla collezione le copie che non hai già libere,
--   'all' aggiunge tutte le carte come copie nuove (es. un mazzo appena comprato), 'none' non tocca la collezione.
create function import_commit(p_target text, p_rows jsonb, p_replace boolean default false, p_add text default 'none') returns json
language plpgsql set search_path = public as $$
declare uid uuid := app.uid(); deck decks; v_deck bigint; r record; total int := 0; added int := 0; m record; pr record;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then perform app.fail('PT400','Nessuna riga da importare'); end if;
  if coalesce(p_add,'none') not in ('none','missing','all') then perform app.fail('PT400','Opzione collezione non valida'); end if;
  if p_target <> 'collection' then v_deck := app.int(to_jsonb(p_target)); deck := app.lock_deck(v_deck); end if;
  -- righe preparate: stampa in catalogo, finitura e condizione valide
  create temp table imp on commit drop as
    select (x->>'printing_id')::uuid printing_id, p.oracle_id, p.lang, app.int(x->'qty') qty,
      coalesce(x->>'finish','nonfoil') finish, coalesce(x->>'condition','NM') cond, coalesce(x->>'section','') = 'cmd' cmd, o.n ord,
      coalesce((x->>'exact')::boolean,false) exact
    from jsonb_array_elements(p_rows) with ordinality o(x,n) left join printings p on p.id=(x->>'printing_id')::uuid;
  if exists(select 1 from imp where oracle_id is null) then perform app.fail('PT404','Stampa non in catalogo'); end if;
  if exists(select 1 from imp where finish not in ('nonfoil','foil','etched') or cond not in ('M','NM','EX','GD','LP','PL','PO')) then
    perform app.fail('PT400','Finitura o condizione non valida'); end if;
  select sum(qty) into total from imp;

  if v_deck is null then
    for r in select * from imp order by ord loop
      insert into collection_items(user_id,printing_id,qty,lang,finish,condition) values(uid,r.printing_id,r.qty,r.lang,r.finish,r.cond)
        on conflict(user_id,printing_id,lang,finish,condition) do update set qty=collection_items.qty+excluded.qty;
    end loop;
    perform app.log('import.commit', jsonb_build_object('target',p_target,'lines',jsonb_array_length(p_rows),'copies',total));
    return json_build_object('imported', total, 'addedToCollection', total);
  end if;

  -- le stampe già scelte restano per le carte che la nuova lista indica solo per nome (es. "Modifica come testo")
  create temp table old_pr on commit drop as select dc.oracle_id, dc.printing_id from deck_cards dc where dc.deck_id=v_deck and dc.printing_id is not null;
  if coalesce(p_replace,false) then
    if exists(select 1 from imp where cmd) then delete from deck_cards dc where dc.deck_id=v_deck;
    else delete from deck_cards dc where dc.deck_id=v_deck and not dc.is_commander; end if;
  end if;
  for r in select * from imp order by ord loop
    -- la stampa della lista diventa quella del mazzo solo se la riga indicava edizione e numero (es. "1 Sol Ring (CMM) 410")
    insert into deck_cards(deck_id,oracle_id,qty,is_commander,printing_id) values(v_deck,r.oracle_id,r.qty,r.cmd,case when r.exact then r.printing_id end)
      on conflict(deck_id,oracle_id,is_commander) do update set qty=deck_cards.qty+excluded.qty, printing_id=coalesce(excluded.printing_id,deck_cards.printing_id);
  end loop;
  update deck_cards dc set printing_id=o.printing_id from old_pr o where dc.deck_id=v_deck and dc.oracle_id=o.oracle_id and dc.printing_id is null;
  if (select coalesce(sum(qty),0) from deck_cards dc where dc.deck_id=v_deck and is_commander) > 2 then
    perform app.fail('PT400','La lista indica più di 2 comandanti'); end if;
  update deck_cards dc set qty=1 where dc.deck_id=v_deck and is_commander and qty>1;
  perform app.dedupe_commanders(v_deck); -- liste che ripetono il comandante anche nel mazzo
  perform app.sync_deck(v_deck); -- prima usa le copie libere che hai già

  if deck.mode = 'physical' and not deck.archived and coalesce(p_add,'none') <> 'none' then
    if p_add = 'all' then
      for r in select * from imp order by ord loop
        insert into collection_items(user_id,printing_id,qty,lang,finish,condition) values(uid,r.printing_id,r.qty,r.lang,'nonfoil','NM')
          on conflict(user_id,printing_id,lang,finish,condition) do update set qty=collection_items.qty+excluded.qty;
        added := added + r.qty;
      end loop;
    else
      -- copie ancora mancanti al mazzo dopo aver usato quelle libere: si aggiungono con la stampa della lista
      for m in select dc.oracle_id, sum(dc.qty)::int need,
          coalesce((select sum(a.qty) from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id
            where a.deck_id=v_deck and p.oracle_id=dc.oracle_id),0)::int got
        from deck_cards dc where dc.deck_id=v_deck group by dc.oracle_id loop
        continue when m.need <= m.got;
        select printing_id, lang into pr from imp where oracle_id=m.oracle_id order by ord limit 1;
        if not found then select id printing_id, lang into pr from printings where oracle_id=m.oracle_id limit 1; end if;
        continue when not found;
        insert into collection_items(user_id,printing_id,qty,lang,finish,condition) values(uid,pr.printing_id,m.need-m.got,pr.lang,'nonfoil','NM')
          on conflict(user_id,printing_id,lang,finish,condition) do update set qty=collection_items.qty+excluded.qty;
        added := added + m.need - m.got;
      end loop;
    end if;
    perform app.sync_deck(v_deck); -- assegna al mazzo le copie appena aggiunte
  end if;
  update decks set updated_at=now() where id=v_deck;
  perform app.log('import.commit', jsonb_build_object('target',p_target,'lines',jsonb_array_length(p_rows),'copies',total,'replace',p_replace,'addToCollection',p_add,'added',added));
  return json_build_object('imported', total, 'addedToCollection', added);
end $$;

-- ---------- lista dei desideri (ragiona per carta, non per stampa)
create function wishlist_list() returns json language sql stable as $$
  with own as (select p.oracle_id,sum(i.qty)::int owned,sum(i.qty-coalesce((select sum(qty) from deck_assignments a where a.item_id=i.id),0))::int free
    from collection_items i join printings p on p.id=i.printing_id where i.user_id=app.uid() group by 1)
  select coalesce(json_agg(x order by x.priority nulls last, x.name), '[]') from (
    select w.id,w.oracle_id,c.name,w.qty_wanted,coalesce(o.owned,0) owned,coalesce(o.free,0) free,greatest(0,w.qty_wanted-coalesce(o.free,0)) to_buy,
      w.priority,w.note,w.price_ref,w.price_source,w.price_at,w.printing_id,sp.set_code,sp.collector_number,
      coalesce(sp.image_small,(select image_small from printings p where p.oracle_id=w.oracle_id limit 1)) image
    from wishlist w join cards c on c.oracle_id=w.oracle_id left join own o on o.oracle_id=w.oracle_id left join printings sp on sp.id=w.printing_id
    where w.user_id=app.uid()) x;
$$;

-- mode 'add': somma alla quantità già desiderata; mode 'atleast': porta la quantità almeno a qty (usato dai mazzi, non raddoppia)
-- p_printing: stampa voluta (null = qualsiasi; se la voce esiste già, resta la stampa che aveva)
create function app.upsert_wish(p_oracle uuid, p_qty int, p_mode text, p_priority int default null, p_note text default null, p_printing uuid default null) returns void
language plpgsql set search_path = public as $$
begin
  if not exists(select 1 from cards where oracle_id=p_oracle) then perform app.fail('PT404','Carta non in catalogo'); end if;
  if p_printing is not null and not exists(select 1 from printings where id=p_printing and oracle_id=p_oracle) then perform app.fail('PT400','La stampa è di un’altra carta'); end if;
  insert into wishlist(user_id,oracle_id,qty_wanted,priority,note,printing_id) values(app.uid(),p_oracle,p_qty,p_priority,p_note,p_printing)
    on conflict(user_id,oracle_id) do update set
      qty_wanted = case when p_mode='add' then wishlist.qty_wanted+excluded.qty_wanted else greatest(wishlist.qty_wanted,excluded.qty_wanted) end,
      priority=coalesce(excluded.priority,wishlist.priority), note=coalesce(excluded.note,wishlist.note),
      printing_id=coalesce(excluded.printing_id,wishlist.printing_id);
end $$;
create function wishlist_add(p_oracle uuid, p_qty int default 1, p_priority int default null, p_note text default null, p_printing uuid default null) returns void language sql as $$
  select app.upsert_wish(p_oracle, app.int(to_jsonb(coalesce(p_qty,1))), 'add', p_priority, p_note, p_printing);
$$;
-- cambia la stampa voluta di una voce (null = qualsiasi)
create function wishlist_set_printing(p_id bigint, p_printing uuid) returns void language plpgsql set search_path = public as $$
begin
  if p_printing is not null and not exists(select 1 from printings p join wishlist w on w.oracle_id=p.oracle_id where p.id=p_printing and w.id=p_id) then
    perform app.fail('PT400','La stampa è di un’altra carta'); end if;
  update wishlist set printing_id=p_printing, price_ref=null, price_source=null, price_at=null where id=p_id and user_id=app.uid();
  if not found then perform app.fail('PT404','Voce non trovata'); end if;
end $$;

-- carte che mancano a un mazzo: fisico = richieste meno assegnate; virtuale = richieste meno copie libere
create function wishlist_from_deck(p_id bigint) returns json language plpgsql set search_path = public as $$
declare d decks; r record; missing int; added int := 0;
begin
  select * into d from decks where id=p_id and user_id=app.uid();
  if not found then perform app.fail('PT404','Mazzo non trovato'); end if;
  for r in select dc.oracle_id,sum(dc.qty)::int need,(array_agg(dc.printing_id) filter (where dc.printing_id is not null))[1] printing_id,
      coalesce((select sum(a.qty) from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id where a.deck_id=p_id and p.oracle_id=dc.oracle_id),0)::int got,
      coalesce((select sum(i.qty-coalesce((select sum(qty) from deck_assignments x where x.item_id=i.id),0)) from collection_items i join printings p on p.id=i.printing_id where p.oracle_id=dc.oracle_id and i.user_id=d.user_id),0)::int free
    from deck_cards dc where dc.deck_id=p_id group by dc.oracle_id loop
    missing := case when d.mode='physical' then r.need - r.got else r.need - r.free end;
    if missing > 0 then perform app.upsert_wish(r.oracle_id, missing, 'atleast', null, null, r.printing_id); added := added + 1; end if;
  end loop;
  perform app.log('wishlist.from_deck', jsonb_build_object('deckId',p_id,'cards',added));
  return json_build_object('cards', added);
end $$;

-- Acquisto guidato: la copia entra nella collezione e la quantità desiderata scende, nella stessa transazione.
-- Le nuove copie vanno ai mazzi fisici che le aspettavano (se assign non è false).
create function wishlist_purchase(p_id bigint, p jsonb) returns json language plpgsql set search_path = public as $$
declare w wishlist; v_qty int; fin text := coalesce(p->>'finish','nonfoil'); cond text := coalesce(p->>'condition','NM'); pr record;
  d record; n0 int; n1 int; assigned text[] := '{}';
begin
  select * into w from wishlist where id=p_id and user_id=app.uid() for update;
  if not found then perform app.fail('PT404','Voce non trovata'); end if;
  v_qty := app.int(p->'qty');
  if fin not in ('nonfoil','foil','etched') or cond not in ('M','NM','EX','GD','LP','PL','PO') then perform app.fail('PT400','Finitura o condizione non valida'); end if;
  select oracle_id, lang into pr from printings where id=(p->>'printing_id')::uuid;
  if not found then perform app.fail('PT404','Stampa non in catalogo'); end if;
  if pr.oracle_id <> w.oracle_id then perform app.fail('PT400','La stampa scelta è di un’altra carta'); end if;
  insert into collection_items(user_id,printing_id,qty,lang,finish,condition) values(w.user_id,(p->>'printing_id')::uuid,v_qty,pr.lang,fin,cond)
    on conflict(user_id,printing_id,lang,finish,condition) do update set qty=collection_items.qty+excluded.qty;
  if w.qty_wanted - v_qty > 0 then update wishlist set qty_wanted=w.qty_wanted-v_qty where id=p_id; else delete from wishlist where id=p_id; end if;
  if coalesce((p->>'assign')::boolean, true) then
    for d in select distinct k.id, k.name from decks k join deck_cards dc on dc.deck_id=k.id
        where dc.oracle_id=w.oracle_id and k.user_id=w.user_id and k.mode='physical' and not k.archived order by k.id loop
      select coalesce(sum(qty),0) into n0 from deck_assignments where deck_id=d.id;
      perform app.sync_deck(d.id);
      select coalesce(sum(qty),0) into n1 from deck_assignments where deck_id=d.id;
      if n1 > n0 then assigned := assigned || d.name; end if;
    end loop;
  end if;
  perform app.log('wishlist.purchase', jsonb_build_object('wishId',p_id,'printing_id',p->>'printing_id','qty',v_qty,'assignedTo',assigned));
  return json_build_object('added', v_qty, 'remaining', greatest(0, w.qty_wanted - v_qty), 'assignedTo', to_json(assigned));
end $$;

-- prezzi di riferimento letti da Scryfall dal sito: [{oracle_id, eur}]
-- prezzi letti da Scryfall dal sito: [{id (voce), eur, source}]; eur null = nessun prezzo per quella stampa
create function wishlist_set_prices(p jsonb) returns json language plpgsql set search_path = public as $$
declare n int;
begin
  update wishlist w set price_ref=(x->>'eur')::numeric, price_source=left(x->>'source',120), price_at=now()
    from jsonb_array_elements(p) x where w.id=(x->>'id')::bigint and w.user_id=app.uid();
  get diagnostics n = row_count;
  return json_build_object('updated', n);
end $$;

-- ---------- riepilogo (Home): la validità dei mazzi la calcola il sito dalle righe vrows
create function stats() returns json language plpgsql stable set search_path = public as $$
declare uid uuid := app.uid();
  dist text := 'select coalesce(json_agg(json_build_object(''k'',k,''n'',n) order by n desc),''[]'') from (select %s k,sum(i.qty)::int n from collection_items i join printings p on p.id=i.printing_id join cards c on c.oracle_id=p.oracle_id where i.user_id=$1 group by 1 order by 2 desc limit 12) t';
  by_c json; by_r json; by_s json; by_t json;
begin
  execute format(dist, $q$coalesce(nullif(array_to_string(c.color_identity,''),''),'C')$q$) into by_c using uid;
  execute format(dist, 'p.rarity') into by_r using uid;
  execute format(dist, 'upper(p.set_code)') into by_s using uid;
  execute format(dist, $q$split_part(c.type_line,' — ',1)$q$) into by_t using uid;
  return json_build_object(
    'tot', (select json_build_object('copies',coalesce(sum(i.qty),0)::int,'prints',count(*)::int,'uniq',count(distinct p.oracle_id)::int)
      from collection_items i join printings p on p.id=i.printing_id where i.user_id=uid),
    'assigned', (select coalesce(sum(a.qty),0)::int from deck_assignments a join decks d on d.id=a.deck_id where d.user_id=uid),
    'decks', (select coalesce(json_agg(x),'[]') from (select d.id,d.name,d.mode,d.archived,
      greatest(0,(select coalesce(sum(qty),0) from deck_cards where deck_id=d.id)-(select coalesce(sum(qty),0) from deck_assignments where deck_id=d.id))::int missing
      from decks d where d.user_id=uid) x),
    'vrows', (select coalesce(json_agg(x),'[]') from (select dc.deck_id,c.oracle_id,c.name,c.type_line,c.color_identity,c.oracle_text,c.keywords,c.commander_legality,c.updated_at,dc.qty,dc.is_commander
      from deck_cards dc join decks d on d.id=dc.deck_id join cards c on c.oracle_id=dc.oracle_id where d.user_id=uid and not d.archived) x),
    'oldest', (select min(c.updated_at) from cards c where exists(select 1 from deck_cards dc join decks d on d.id=dc.deck_id where dc.oracle_id=c.oracle_id and d.user_id=uid)),
    'sync', (select row_to_json(s) from (select last_ok,last_error from catalog_sync where source='scryfall') s),
    -- valore della collezione ai prezzi Cardmarket (foil e etched al prezzo foil); copie senza prezzo contate a parte
    'value', (select json_build_object('eur', coalesce(sum(i.qty * v.price),0), 'unpriced', coalesce(sum(i.qty) filter (where v.price is null),0)::int,
        'oldest', min(p.price_at), 'never', count(*) filter (where p.price_at is null)::int)
      from collection_items i join printings p on p.id=i.printing_id
      cross join lateral (select case when i.finish='nonfoil' then coalesce(p.price_eur,p.price_eur_foil) else coalesce(p.price_eur_foil,p.price_eur) end price) v
      where i.user_id=uid),
    'recent', (select coalesce(json_agg(x),'[]') from (select i.id,c.name,p.set_code,i.qty from collection_items i join printings p on p.id=i.printing_id
      join cards c on c.oracle_id=p.oracle_id where i.user_id=uid order by i.created_at desc,i.id desc limit 5) x),
    'by', json_build_object('colore',by_c,'rarità',by_r,'set',by_s,'tipo',by_t));
end $$;

-- ---------- account
-- elimina l'account e TUTTI i suoi dati (collezione, mazzi, desideri, cronologia). Non si può annullare.
create function account_delete() returns void language plpgsql security definer set search_path = public as $$
declare u uuid := app.uid();
begin
  delete from app.rate where user_id=u;
  delete from deck_assignments where deck_id in (select id from decks where user_id=u);
  delete from auth.users where id=u;
end $$;

-- ---------- permessi sulle funzioni: solo utenti collegati
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema app to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
