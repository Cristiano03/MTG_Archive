-- Aggiornamento: il mazzo tiene la stampa scelta (dalla collezione, dalla ricerca o dalla lista con edizione e numero).
-- Da eseguire UNA volta nel SQL Editor di Supabase sui progetti creati prima (supabase/schema.sql lo contiene già). Non tocca i dati.
alter table deck_cards add column if not exists printing_id uuid references printings;
drop function if exists deck_change_card(bigint, uuid, int, boolean);

-- Allinea le copie fisiche assegnate al mazzo a quelle richieste: mazzo fisico attivo = tante quante ne chiede (se libere),
-- virtuale o archiviato = nessuna. Usa prima le copie della stampa scelta per il mazzo; a parità toglie dalle copie
-- aggiunte per ultime e aggiunge dalle più vecchie.
create or replace function app.sync_deck(p_id bigint) returns void language plpgsql set search_path = public as $$
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

-- Dati grezzi di un mazzo: il sito calcola copie assegnate per riga, mancanti e validità.
create or replace function deck_get(p_id bigint) returns json language plpgsql stable set search_path = public as $$
declare d decks; uid uuid := app.uid();
begin
  select * into d from decks where id=p_id and user_id=uid;
  if not found then perform app.fail('PT404','Mazzo non trovato'); end if;
  return json_build_object('deck', row_to_json(d), 'rows', (select coalesce(json_agg(r order by r.is_commander desc, r.name), '[]') from (
    select c.oracle_id,c.name,c.color_identity,coalesce(c.colors,'{}') colors,c.cmc::float cmc,c.mana_cost,c.type_line,c.oracle_text,c.keywords,c.commander_legality,c.updated_at,
      pr.id printing_id,pr.image_small image,pr.set_code,pr.collector_number,dc.is_commander,dc.qty::int need,coalesce(g.q,0)::int got_total,
      coalesce((select sum(i.qty-coalesce((select sum(x.qty) from deck_assignments x where x.item_id=i.id),0)) from collection_items i join printings p on p.id=i.printing_id where p.oracle_id=c.oracle_id and i.user_id=uid),0)::int free_total,
      coalesce((select sum(i.qty) from collection_items i join printings p on p.id=i.printing_id where p.oracle_id=c.oracle_id and i.user_id=uid),0)::int owned
    from deck_cards dc join cards c on c.oracle_id=dc.oracle_id
    left join (select p.oracle_id,sum(a.qty)::int q from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id where a.deck_id=p_id group by 1) g on g.oracle_id=dc.oracle_id
    -- stampa mostrata: quella scelta per il mazzo, altrimenti quella della copia assegnata, poi una che possiedi, poi una qualsiasi
    left join lateral (select p.id,p.image_small,p.set_code,p.collector_number from printings p
      left join collection_items i on i.printing_id=p.id and i.user_id=uid left join deck_assignments a on a.item_id=i.id and a.deck_id=p_id
      where p.oracle_id=dc.oracle_id
      order by coalesce(p.id=dc.printing_id,false) desc,(a.item_id is not null) desc,(i.id is not null) desc,p.set_code limit 1) pr on true
    where dc.deck_id=p_id) r));
end $$;

-- edizione per l'esportazione: quella scelta per il mazzo, altrimenti quella della copia assegnata, poi quella che possiedi, poi una qualsiasi
create or replace function deck_editions(p_id bigint) returns json language sql stable as $$
  select coalesce(json_object_agg(x.oracle_id, x.e), '{}') from (
    select distinct on (p.oracle_id) p.oracle_id,'('||upper(p.set_code)||') '||p.collector_number e
    from printings p left join collection_items i on i.printing_id=p.id and i.user_id=app.uid()
    left join deck_assignments a on a.item_id=i.id and a.deck_id=p_id
    where p.oracle_id in (select dc.oracle_id from deck_cards dc join decks d on d.id=dc.deck_id where dc.deck_id=p_id and d.user_id=app.uid())
    order by p.oracle_id,exists(select 1 from deck_cards dc where dc.deck_id=p_id and dc.printing_id=p.id) desc,(a.item_id is not null) desc,(i.id is not null) desc,p.set_code) x;
$$;

-- delta positivo o negativo; i comandanti sono max 2. L'oracle_id deve già essere in catalogo (catalog_upsert).
-- p_printing: stampa scelta nella ricerca; resta quella già scelta se la carta era nel mazzo.
create or replace function deck_change_card(p_id bigint, p_oracle uuid, p_delta int, p_commander boolean default false, p_printing uuid default null) returns void language plpgsql set search_path = public as $$
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

-- Aggiunge alla collezione le copie che mancano al mazzo (tutte, o solo quelle di una carta), con una stampa del catalogo:
-- quella scelta per il mazzo, altrimenti quella che possiedi già, altrimenti la prima disponibile. Le copie vengono subito assegnate al mazzo.
create or replace function deck_collect(p_id bigint, p_oracle uuid default null) returns json language plpgsql set search_path = public as $$
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

-- Aggiunge al mazzo le carte selezionate nella collezione: una copia per carta, saltando quelle già nel mazzo
-- (anche come comandante). La carta tiene la stampa della copia selezionata; nei mazzi fisici attivi viene riservata
-- proprio quella copia, se è libera.
create or replace function deck_add_items(p_id bigint, p_items bigint[]) returns json language plpgsql set search_path = public as $$
declare d decks; r record; added int := 0; skipped int := 0; f int;
begin
  d := app.lock_deck(p_id);
  if coalesce(array_length(p_items,1),0) = 0 then perform app.fail('PT400','Nessuna carta selezionata'); end if;
  -- una riga per carta: tra le copie selezionate della stessa carta si preferisce una con copie libere
  for r in select distinct on (p.oracle_id) p.oracle_id, i.id item_id, i.printing_id
      from collection_items i join printings p on p.id=i.printing_id
      where i.id=any(p_items) and i.user_id=d.user_id
      order by p.oracle_id, (i.qty-coalesce((select sum(x.qty) from deck_assignments x where x.item_id=i.id),0)) > 0 desc, array_position(p_items, i.id) loop
    if exists(select 1 from deck_cards where deck_id=p_id and oracle_id=r.oracle_id) then
      -- già nel mazzo: se non aveva ancora una stampa scelta, prende quella selezionata
      update deck_cards set printing_id=r.printing_id where deck_id=p_id and oracle_id=r.oracle_id and printing_id is null;
      skipped := skipped + 1; continue;
    end if;
    insert into deck_cards(deck_id,oracle_id,qty,is_commander,printing_id) values(p_id, r.oracle_id, 1, false, r.printing_id);
    added := added + 1;
    if d.mode = 'physical' and not d.archived then
      select i.qty-coalesce((select sum(x.qty) from deck_assignments x where x.item_id=i.id),0) into f from collection_items i where i.id=r.item_id for update;
      if f > 0 then insert into deck_assignments values(p_id, r.item_id, 1); end if;
    end if;
  end loop;
  if added > 0 then perform app.sync_deck(p_id); update decks set updated_at=now() where id=p_id; end if;
  perform app.log('deck.add_items', jsonb_build_object('id',p_id,'added',added,'skipped',skipped));
  return json_build_object('added', added, 'skipped', skipped);
end $$;

-- ---------- importazione (tutto o niente)
-- target: 'collection' oppure l'id di un mazzo. Le stampe devono essere già in catalogo (il sito le aggiunge prima).
-- replace (solo mazzi): sostituisce le carte del mazzo con quelle della lista. Se la lista non ha una sezione
--   "Commander", il comandante attuale resta (le liste in testo semplice di solito non lo indicano).
-- add (solo mazzi fisici): 'missing' aggiunge alla collezione le copie che non hai già libere,
--   'all' aggiunge tutte le carte come copie nuove (es. un mazzo appena comprato), 'none' non tocca la collezione.
create or replace function import_commit(p_target text, p_rows jsonb, p_replace boolean default false, p_add text default 'none') returns json
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

revoke execute on function deck_change_card(bigint, uuid, int, boolean, uuid) from public, anon;
grant execute on function deck_change_card(bigint, uuid, int, boolean, uuid) to authenticated;
