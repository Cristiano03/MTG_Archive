-- Aggiornamento: «Aggiungi al mazzo» dalla collezione. Da eseguire UNA volta nel SQL Editor di Supabase
-- (solo sui progetti creati prima di questa funzione; supabase/schema.sql la contiene già).
-- Aggiunge al mazzo le carte selezionate nella collezione: una copia per carta, saltando quelle già nel mazzo
-- (anche come comandante). Nei mazzi fisici attivi viene riservata proprio la copia selezionata, se è libera.
create function deck_add_items(p_id bigint, p_items bigint[]) returns json language plpgsql set search_path = public as $$
declare d decks; r record; added int := 0; skipped int := 0; f int;
begin
  d := app.lock_deck(p_id);
  if coalesce(array_length(p_items,1),0) = 0 then perform app.fail('PT400','Nessuna carta selezionata'); end if;
  -- una riga per carta: tra le copie selezionate della stessa carta si preferisce una con copie libere
  for r in select distinct on (p.oracle_id) p.oracle_id, i.id item_id
      from collection_items i join printings p on p.id=i.printing_id
      where i.id=any(p_items) and i.user_id=d.user_id
      order by p.oracle_id, (i.qty-coalesce((select sum(x.qty) from deck_assignments x where x.item_id=i.id),0)) > 0 desc, array_position(p_items, i.id) loop
    if exists(select 1 from deck_cards where deck_id=p_id and oracle_id=r.oracle_id) then skipped := skipped + 1; continue; end if;
    insert into deck_cards values(p_id, r.oracle_id, 1, false);
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
revoke execute on function deck_add_items(bigint, bigint[]) from public, anon;
grant execute on function deck_add_items(bigint, bigint[]) to authenticated;
