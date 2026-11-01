# Notes API (observées, lecture seule)

Site : Next.js (Turbopack), auth Supabase (`profiles.is_pro`). Endpoints vus depuis les pages :

| Page | Endpoint |
|---|---|
| global | `GET /api/notifications` |
| marché | `GET /api/marketplace?page=1&limit=50&sort=recent[&mine=1]` |
| collection | `GET /api/my-collection?sort=rarity&page=0&stats=0`, `GET /api/my-collection/stats?sort=rarity` |
| échanges | `GET /api/trades?active=1` |

Raretés (images `/rarity/*.webp`) : `legendaire` L, `ultra_rare` UR, `super_rare` SR, `rare` R, `peu_commun` PC, `commun` C.
Paquets : 5 cartes, 1 toutes les 10 min, 10 max en stock.

Les formes de réponse exactes sont collectées automatiquement par l'extension dans `chrome.storage.local.apiShapes`
(voir `src/lib/sniffer.js`) ; les copier ici une fois observées. Endpoints d'ouverture de paquet et de mise en vente : **à découvrir**.
