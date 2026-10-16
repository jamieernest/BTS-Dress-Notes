# Getting to playback

Use two complementary entry points:

- **Video** in the top-bar actions on live notes and each opened saved/local show. It uses the existing ghost button style; on phones the video icon keeps the header compact.
- A video icon beside each note's other actions. This carries the show and note into playback and starts three seconds before the moment the author began typing. It uses the existing icon-button styling, hover/focus treatment and touch target.

Playback has an explicit **Back to notes** link at the left of the top bar. Both entry points use the same open-and-return flow. The earlier segmented switch was removed because its position changed between pages and it made a note-specific action feel unrelated to the way back.

When no recording is selected, playback already shows the notes, highlights the requested one, and asks only for the video. Vor's dated file name supplies alignment; Adjust timing handles other recordings. Returning to Notes preserves saved-show filters and highlights the selected note. Local notes files remain available between views in the same browser tab. A missing show, missing local file or unavailable note gives a recovery message rather than silently opening a different show.

The source and selected note live in the URL. A local file URL is specific to the tab that opened it. Recordings remain on the device and are not stored or uploaded, so a new player page needs the recording chosen again; browser Back may retain an existing page. Live-source playback refreshes when notes change; saved-show playback stays on its saved snapshot.

## Development examples

From this checkout, with the existing OIDC settings in `.env`:

```sh
npm run dev:playback
```

The default port is 3030 (`PLAYBACK_PORT` overrides it). The launcher uses separate `.playback-dev/` storage, seeds 25 invented live notes only when empty, and adds **Sample dress rehearsal** to Past notes. Both examples automatically open the silent twelve-minute sample recording with 33 LX cues and six scenes. Normal instance data is separate.

On this development host's Tailscale network:

- [Live example notes](http://100.99.42.78:3030/)
- [Saved example notes](http://100.99.42.78:3030/recall.html?show=2026-10-07T19-00-00-000Z-sample-dress-rehearsal)

## Validation

The full 181-test suite passed. One earlier run timed out starting a chat-restore test server; the isolated chat suite and subsequent full run both passed. Focused tests cover HTTP-compatible local-file keys, URL encoding, safe return destinations, local-file storage failure, authenticated live snapshots, and preservation of typing times and the show log when saving.

Browser checks on the HTTP Tailscale address verified live and saved note shortcuts, the 3-second lead-in, saved filters on return, local-file handoff, pending note selection through the real video picker, return highlighting, and live note updates. Temporary update probes were removed. Desktop and phone layouts were inspected; physical touch devices and screen readers have not been tested.
