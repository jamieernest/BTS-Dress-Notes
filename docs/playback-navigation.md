# Getting to playback

Use two complementary entry points:

- **Video** in the top-bar actions on live notes and each opened saved/local show. It uses the existing ghost button style; on phones the video icon keeps the header compact.
- A video icon beside each note's other actions. This carries the show and note into playback and starts three seconds before the moment the author began typing. It uses the existing icon-button styling, hover/focus treatment and touch target.

Playback has an explicit **Back to notes** link at the left of the top bar. Both entry points use the same open-and-return flow. The earlier segmented switch was removed because its position changed between pages and it made a note-specific action feel unrelated to the way back.

When no recording is selected, playback already shows the notes, highlights the requested one, and asks only for the video. Vor's dated file name supplies alignment; Adjust timing handles other recordings. Returning to Notes preserves saved-show filters and highlights the selected note. Local notes files remain available between views in the same browser tab. A missing show, missing local file or unavailable note gives a recovery message rather than silently opening a different show.

The source and selected note live in the URL. A local file URL is specific to the tab that opened it. Live-source playback refreshes when notes change; saved-show playback stays on its saved snapshot.

A recording uploaded on the settings page (**Recordings**) is kept on the server with the live notes or the saved show, so everyone opening them watches it straight away; it goes with the live notes when the show is saved and leaves them on reset. A recording in several parts plays as one timeline: each part sits at its start time, the time between parts shows as hatched blank space with a countdown and **Skip to the next part**, and playback carries on across it. A video chosen from this device (one or several parts) stays on it and is chosen again on each new player page.

## Development examples

From this checkout, with the existing OIDC settings in `.env`:

```sh
npm run dev:playback
```

The default port is 3030 (`PLAYBACK_PORT` overrides it). The launcher uses separate `.playback-dev/` storage, seeds 25 invented live notes only when empty, and adds **Sample dress rehearsal** to Past notes. Both examples automatically open the silent twelve-minute sample recording with 33 LX cues and six scenes. Normal instance data is separate.
