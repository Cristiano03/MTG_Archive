# Operazioni (ex API del server)

Non c'è più un server HTTP. Le pagine chiamano `api(path, method, body)` con gli stessi indirizzi di prima; `frontend/services/routes.ts` esegue ogni operazione nel browser, su Supabase. Tutte richiedono l'accesso.

| Operazione | Funzione del database / tabella |
|---|---|
| `GET /collection` | `collection_list()` |
| `POST /collection` | `collection_add()` (la stampa entra prima nel catalogo) |
| `PATCH /collection/:id`, `DELETE /collection/:id` | `collection_set_qty()`; con copie assegnate serve `release` (altrimenti 409) |
| `POST /collection/bulk-delete` | `collection_bulk_delete()`; 409 con `assigned` = nomi delle carte nei mazzi |
| `PATCH /collection/:id/attrs` | `collection_edit()` (unisce le righe uguali) |
| `GET /decks`, `GET /decks/:id` | `decks_list()`, `deck_get()` (+ calcoli nel sito) |
| `POST /decks`, `PATCH /decks/:id` | tabella `decks` |
| `DELETE /decks/:id` | `deck_delete()` |
| `POST /decks/:id/cards` | `deck_change_card()` |
| `POST /decks/:id/cards/bulk-remove` | `deck_bulk_remove()` |
| `POST /decks/:id/collect` | `deck_collect()` |
| `POST /decks/:id/convert` | `deck_convert()` |
| `POST /decks/:id/archive` | `deck_archive()` |
| `GET /decks/:id/validation` | `deck_get()` + `services/validate.ts` |
| `GET /decks/:id/export` | testo generato nel sito (`deck_editions()` per il formato con edizioni) |
| `POST /catalog/printings`, `POST /catalog/refresh` | Scryfall + `catalog_upsert()`, `catalog_sync_result()` |
| `POST /import/preview` | Scryfall + `catalog_upsert()` (nessun effetto sull'inventario) |
| `POST /import/commit` | `import_commit()` |
| `GET /stats` | `stats()` + validazione nel sito |
| `GET /export/collection.csv` | `collection_list()` |
| `GET /wishlist`, `POST /wishlist` | `wishlist_list()`, `wishlist_add()` |
| `PATCH /wishlist/:id`, `DELETE /wishlist/:id` | tabella `wishlist` |
| `POST /wishlist/from-deck/:id` | `wishlist_from_deck()` |
| `POST /wishlist/:id/purchase` | `wishlist_purchase()` |
| `POST /wishlist/prices` | Scryfall + `wishlist_set_prices()` |
| `GET /export/wishlist.txt` | `wishlist_list()` |

Account (registrazione, accesso, cambio password, uscita): Supabase Auth, direttamente da `pages/AuthPage.tsx` e `features/account/Account.tsx`.
