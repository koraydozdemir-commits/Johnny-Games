# Johnny Games Spore — Soundtrack

The music streams from the `spore` R2 bucket (`https://pub-c7061cceb949469685093ccc3a5dd0ba.r2.dev/`,
folder `Spore OST/`), so the MP3s stay out of the repository. Its CORS rule allows
`johnnystudy.online` and `www.johnnystudy.online` (GET/HEAD, `Range`).

## Tracks (`music.js`, `TRACKS`)
| Id | File | Plays |
|---|---|---|
| menu | Main Menu | the galaxy start screen, the galaxy map and the universe list (resumes) |
| cell | Cell Stage | Cell Stage (resumes) |
| land | Entering Land | once on reaching land, then hands over to `creature` |
| creature | Creature Stage Roaming | roaming (resumes) |
| nest | At Your Nest | near the home nest (resumes) |
| mating | Creature Mating | courtship |
| founding | Founding A Tribe | once, from the stick throw (the Creature → Tribal cutscene, about 40 s across both scenes); hands over to `tribe` after 48 s (`maxPlay`) |
| tribe | Tribal Stage Relaxed | Tribal Stage (resumes) |
| tribeWar | Civilisation War | while raiders or a war party are at your village; holds 20 s after |
| civ | Civilisation Stage Relaxed | Civilization Stage (resumes) |
| civWar | Civilisation War | wars in the Civilization Stage; holds 20 s after |
| pedia | Sporepedia | Sporepedia |

To add a track: upload it to `Spore OST/` in the bucket, add a line to `TRACKS` (the unit test lists
the bucket's files, so update it too), and call `audio.setMusic(id)` where it should play.

## How it plays
- Two decks: the next track loads on the idle deck while the current one plays, then they crossfade
  (2.4 s). Looping tracks crossfade into themselves 3.5 s before the end, with no gap at the seam.
- One-shot cues hand over as they end (or after `maxPlay` seconds) to what the game wants now, else their `then` track.
- Only the track meant to be playing loops or hands over, so a track still loading is never cancelled by the old one looping.
- A track that fails to load (slow connection; 20 s timeout) doesn't leave the old music playing as if it were the new one: it is retried after 4 s while still wanted.
- Asking for the track already playing (closing the galaxy before the menu theme loaded) keeps it, without restarting it.
- A Sporepedia page opened from the galaxy gives the galaxy its menu music back when closed, not the stage's.
- Themes marked `resume` pick up where they were left if you return within 4 minutes.
- Requests settle for 0.9 s, so walking in and out of the nest doesn't restart anything.
- Volume goes through Web Audio, so the Music slider works on iPhones. If a track can't be loaded
  with CORS (a local copy, a preview), it's loaded again without CORS and uses element volume instead.
- The first track starts (muted) inside the unlocking tap, and every unused deck is unlocked with a
  tiny built-in silent clip in the same tap, which is what iOS Safari requires. A track iOS refused
  starts on the next tap. (Tapping before the galaxy had loaded used to leave the menu silent.)
- Music pauses while the page is hidden and resumes when it returns.
- The sound-effects toggle doesn't stop the music; the Music slider does.
