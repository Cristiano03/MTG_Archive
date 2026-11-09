-- Aggiornamento: la collezione sa in quali mazzi è ogni carta (anche virtuali), per il filtro «Nel mazzo / Non nel mazzo / In nessun mazzo».
-- Da eseguire UNA volta nel SQL Editor di Supabase (supabase/schema.sql lo contiene già). Non tocca i dati.

create or replace function collection_list() returns json language sql stable as $$
  select coalesce(json_agg(x order by x.name, x.set_code), '[]') from (
    select i.id,i.printing_id,c.name,p.set_code,p.collector_number,i.lang,i.finish,i.condition,i.note,i.qty,
      coalesce(a.s,0)::int assigned,(i.qty-coalesce(a.s,0))::int free,p.rarity,p.image_small,c.type_line,c.color_identity,coalesce(c.colors,'{}') colors,c.cmc::float cmc,c.mana_cost,i.created_at,
      coalesce((select json_agg(x.deck_id) from deck_assignments x where x.item_id=i.id),'[]'::json) decks,
      -- mazzi che contengono la carta (anche virtuali, anche senza copie riservate)
      coalesce((select json_agg(distinct dc.deck_id) from deck_cards dc join decks d on d.id=dc.deck_id where dc.oracle_id=p.oracle_id and d.user_id=i.user_id),'[]'::json) in_decks
    from collection_items i join printings p on p.id=i.printing_id join cards c on c.oracle_id=p.oracle_id
    left join (select item_id,sum(qty) s from deck_assignments group by item_id) a on a.item_id=i.id where i.user_id=app.uid()) x;
$$;
