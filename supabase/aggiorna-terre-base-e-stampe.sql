-- Aggiornamento: «Al mazzo» aggiunge tutte le copie selezionate delle terre base (anche di stampe diverse) e, per le carte
-- già nel mazzo, usa la stampa selezionata; il mazzo mostra le stampe delle copie riservate.
-- Da eseguire UNA volta nel SQL Editor di Supabase (supabase/schema.sql lo contiene già). Non tocca i dati.

-- Dati grezzi di un mazzo: il sito calcola copie assegnate per riga, mancanti e validità.
create or replace function deck_get(p_id bigint) returns json language plpgsql stable set search_path = public as $$
declare d decks; uid uuid := app.uid();
begin
  select * into d from decks where id=p_id and user_id=uid;
  if not found then perform app.fail('PT404','Mazzo non trovato'); end if;
  return json_build_object('deck', row_to_json(d), 'rows', (select coalesce(json_agg(r order by r.is_commander desc, r.name), '[]') from (
    select c.oracle_id,c.name,c.color_identity,coalesce(c.colors,'{}') colors,c.cmc::float cmc,c.mana_cost,c.type_line,c.oracle_text,c.keywords,c.commander_legality,c.updated_at,
      pr.id printing_id,pr.image_small image,pr.set_code,pr.collector_number,dc.is_commander,
      -- stampe delle copie riservate al mazzo (per vedere, ad esempio, Isole di edizioni diverse)
      (select json_agg(json_build_object('set_code',p.set_code,'collector_number',p.collector_number,'qty',x.q) order by x.q desc, p.set_code)
        from (select i.printing_id, sum(a.qty)::int q from deck_assignments a join collection_items i on i.id=a.item_id where a.deck_id=p_id group by 1) x
        join printings p on p.id=x.printing_id where p.oracle_id=dc.oracle_id) prints,dc.qty::int need,coalesce(g.q,0)::int got_total,
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

-- Aggiunge al mazzo le carte selezionate nella collezione, tenendo la stampa della copia selezionata.
-- • Carte singole: una copia. Se la carta è già nel mazzo, prende la stampa selezionata (e nei mazzi fisici
--   la copia riservata diventa quella selezionata, se è libera).
-- • Carte che ammettono più copie (terre base, "any number of cards named"): entrano tutte le copie delle righe
--   selezionate, senza contare quelle già riservate a questo mazzo; nei mazzi fisici si riservano proprio quelle copie.
create or replace function deck_add_items(p_id bigint, p_items bigint[]) returns json language plpgsql set search_path = public as $$
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
