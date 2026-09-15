# Screenshots

The README references four files in this folder. Drop them in with these exact
names and the tables in the README render automatically — no markdown edits
needed.

| Filename | Page | What should be on screen |
|----------|------|--------------------------|
| `draft-room.png` | `/leagues/{id}/draft` | Mid-draft: several rounds of picks on the board, the pick timer running, the bottom value panel open. This is the money shot — lead with it. |
| `rankings.png` | `/rankings` | A custom list open with the source-comparison panel beside it, ideally mid-drag or with a couple of locked players visible. |
| `analytics.png` | `/analytics` | A chart with real data — the weekly trend or boom/bust view comparing two recognizable players. |
| `assistant.png` | `/assistant` | A question asked and answered, with the debug trace expanded so the tool call is visible. That trace is the interesting part. |

## Capturing them

Get a draft into an interesting state first — it takes two minutes:

1. Start the backend and frontend (see [RUNBOOK.md](../../RUNBOOK.md)).
2. Register an account, create a league.
3. Add CPU teams until the league is full ("Add Bot" in the lobby).
4. Randomize the draft order, start the draft.
5. Make a handful of picks and let the CPUs make theirs, so the board has
   several rounds of color on it.

Then capture each page.

## Tips

- Use a **1440×900** viewport or similar. Ultra-wide screenshots shrink to
  illegibility in a README table.
- Capture the **window content only**, not your whole desktop — no taskbar, no
  browser chrome with your bookmarks in it.
- The app is dark-themed; PNG keeps the UI crisp where JPEG would smear the text.
- Crop out anything personal: your email in the navbar, other browser tabs.
- Keep each file under ~500 KB so cloning the repo stays quick. `pngquant` or
  any online PNG optimizer handles this without visible loss.

## Optional: a GIF of the live draft

A 10–15 second loop of picks landing in real time demonstrates the WebSocket
work better than any static image can. ScreenToGif (Windows, free) is the easy
option. Save it as `draft-demo.gif` here and add it near the top of the README:

```markdown
![Live draft](docs/screenshots/draft-demo.gif)
```

Keep it under ~5 MB.
