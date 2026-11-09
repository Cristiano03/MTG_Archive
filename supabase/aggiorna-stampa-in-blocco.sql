-- Aggiornamento: cambio di stampa in blocco dalla Collezione; i mazzi seguono la nuova stampa delle copie.
-- Da eseguire UNA volta nel SQL Editor di Supabase (supabase/schema.sql lo contiene già). Non tocca i dati.

-- Cambiata la stampa di una copia: i mazzi che avevano scelto la vecchia stampa passano alla nuova,
-- se non hai più copie della vecchia.
create or replace function app.follow_print(p_user uuid, p_old uuid, p_new uuid) returns void language sql set search_path = public as $$
  update deck_cards dc set printing_id=p_new from decks d
  where p_old is distinct from p_new and d.id=dc.deck_id and d.user_id=p_user and dc.printing_id=p_old
    and not exists(select 1 from collection_items i where i.user_id=p_user and i.printing_id=p_old);
$$;

-- Modifica stampa/lingua/finitura/condizione/nota. Se la combinazione esiste già, le due righe vengono unite (quantità e assegnazioni comprese).
create or replace function collection_edit(p_id bigint, p jsonb) returns json language plpgsql set search_path = public as $$
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
create or replace function collection_set_printings(p jsonb) returns json language plpgsql set search_path = public as $$
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

revoke execute on function app.follow_print(uuid, uuid, uuid) from public, anon;
grant execute on function app.follow_print(uuid, uuid, uuid) to authenticated;
revoke execute on function collection_set_printings(jsonb) from public, anon;
grant execute on function collection_set_printings(jsonb) to authenticated;
