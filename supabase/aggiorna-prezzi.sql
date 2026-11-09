-- Aggiornamento: prezzi Cardmarket in euro per stampa, valore della collezione (Home) e del mazzo.
-- Da eseguire UNA volta nel SQL Editor di Supabase (supabase/schema.sql lo contiene già). Non tocca i dati.
alter table printings add column if not exists price_eur numeric(10,2);
alter table printings add column if not exists price_eur_foil numeric(10,2);
alter table printings add column if not exists price_at timestamptz;

-- prezzi Cardmarket in euro delle stampe, letti da Scryfall dal sito: [{id, eur, eur_foil}]
create or replace function catalog_set_prices(p jsonb) returns json language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform app.uid();
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 5000 then perform app.fail('PT400','Prezzi non validi'); end if;
  update printings t set price_eur=(x->>'eur')::numeric, price_eur_foil=(x->>'eur_foil')::numeric, price_at=now()
    from jsonb_array_elements(p) x where t.id=(x->>'id')::uuid;
  get diagnostics n = row_count;
  return json_build_object('updated', n);
end $$;

-- Dati grezzi di un mazzo: il sito calcola copie assegnate per riga, mancanti e validità.
create or replace function deck_get(p_id bigint) returns json language plpgsql stable set search_path = public as $$
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

-- ---------- riepilogo (Home): la validità dei mazzi la calcola il sito dalle righe vrows
create or replace function stats() returns json language plpgsql stable set search_path = public as $$
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

revoke execute on function catalog_set_prices(jsonb) from public, anon;
grant execute on function catalog_set_prices(jsonb) to authenticated;
