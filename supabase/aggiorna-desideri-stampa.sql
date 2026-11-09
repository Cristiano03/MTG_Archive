-- Aggiornamento: la lista dei desideri ricorda la stampa voluta (o «qualsiasi»: prezzo della stampa più economica).
-- Da eseguire UNA volta nel SQL Editor di Supabase (supabase/schema.sql lo contiene già). Non tocca i dati.
alter table wishlist add column if not exists printing_id uuid references printings;
drop function if exists wishlist_add(uuid, int, int, text);
drop function if exists app.upsert_wish(uuid, int, text, int, text);

-- ---------- lista dei desideri (ragiona per carta, non per stampa)
create or replace function wishlist_list() returns json language sql stable as $$
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
create or replace function app.upsert_wish(p_oracle uuid, p_qty int, p_mode text, p_priority int default null, p_note text default null, p_printing uuid default null) returns void
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

create or replace function wishlist_add(p_oracle uuid, p_qty int default 1, p_priority int default null, p_note text default null, p_printing uuid default null) returns void language sql as $$
  select app.upsert_wish(p_oracle, app.int(to_jsonb(coalesce(p_qty,1))), 'add', p_priority, p_note, p_printing);
$$;

-- cambia la stampa voluta di una voce (null = qualsiasi)
create or replace function wishlist_set_printing(p_id bigint, p_printing uuid) returns void language plpgsql set search_path = public as $$
begin
  if p_printing is not null and not exists(select 1 from printings p join wishlist w on w.oracle_id=p.oracle_id where p.id=p_printing and w.id=p_id) then
    perform app.fail('PT400','La stampa è di un’altra carta'); end if;
  update wishlist set printing_id=p_printing, price_ref=null, price_source=null, price_at=null where id=p_id and user_id=app.uid();
  if not found then perform app.fail('PT404','Voce non trovata'); end if;
end $$;

-- carte che mancano a un mazzo: fisico = richieste meno assegnate; virtuale = richieste meno copie libere
create or replace function wishlist_from_deck(p_id bigint) returns json language plpgsql set search_path = public as $$
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

-- prezzi di riferimento letti da Scryfall dal sito: [{oracle_id, eur}]
-- prezzi letti da Scryfall dal sito: [{id (voce), eur, source}]; eur null = nessun prezzo per quella stampa
create or replace function wishlist_set_prices(p jsonb) returns json language plpgsql set search_path = public as $$
declare n int;
begin
  update wishlist w set price_ref=(x->>'eur')::numeric, price_source=left(x->>'source',120), price_at=now()
    from jsonb_array_elements(p) x where w.id=(x->>'id')::bigint and w.user_id=app.uid();
  get diagnostics n = row_count;
  return json_build_object('updated', n);
end $$;

revoke execute on function app.upsert_wish(uuid, int, text, int, text, uuid) from public, anon;
grant execute on function app.upsert_wish(uuid, int, text, int, text, uuid) to authenticated;
revoke execute on function wishlist_add(uuid, int, int, text, uuid) from public, anon;
grant execute on function wishlist_add(uuid, int, int, text, uuid) to authenticated;
revoke execute on function wishlist_set_printing(bigint, uuid) from public, anon;
grant execute on function wishlist_set_printing(bigint, uuid) to authenticated;
