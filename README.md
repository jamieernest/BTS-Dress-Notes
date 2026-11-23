# BTS-Dress-Notes

A collaborative dress-rehearsal notes app. Crew write notes in a browser; each note is stamped with the show's timecode (MIDI, network or real time) and the live LX cue from any ETC Eos console. Notes can later be searched, exported, and played back against a recording of the show.

_Disclaimer: this was mostly AI generated (Deepseek V3-4 and Claude Sonnet 5). It is unethical to use this for commercial purposes and I have decided to use an MIT license as I believe it is not fair to claim this as my own._

## Contents

- [Setup](#setup)
- [Configuration](#configuration)
- [Running](#running)
- [Features](#features)
  - [Timecode modes](#timecode-modes)
  - [Eos console](#eos-console)
  - [Scene labels](#scene-labels)
  - [Writing notes](#writing-notes)
  - [Shitposts chat](#shitposts-chat)
  - [Past notes](#past-notes)
  - [Notes, backup and reset](#notes-backup-and-reset)
  - [Tags](#tags)
  - [Show recordings and playback](#show-recordings-and-playback)
  - [OBS recording from QLab](#obs-recording-from-qlab)
  - [Camera preset](#camera-preset)
  - [Profile photos](#profile-photos)
  - [OBS overlays](#obs-overlays)
- [Testing](#testing)

## Setup

1. Install [Node.js](https://nodejs.org/en/download).
2. Clone the project: `git clone https://github.com/jamieernest/BTS-Dress-Notes`
3. Connect the computer, the Eos console and the MIDI gateway (if needed) to the same local network.
4. On the Eos console go to System > System Settings > Show Control > OSC. Set `OSC TX Port` to `8001` (or the value of `OSC_PORT` if set) and `OSC TX IP Address` to the computer's IP address.
5. Install the dependencies:

   ```
   cd BTS-Dress-Notes
   npm i
   ```

6. Timecode wiring:
   - **MIDI timecode:** connect the computer's MIDI out to the gateway, and connect **another interface's** MIDI in to the MIDI thru port on the gateway.
   - **Network timecode:** no extra MIDI interface is needed (see [Timecode modes](#timecode-modes)).
7. Set up login and the other settings below, then run the app.

## Configuration

Settings are environment variables, read from `.env` by `npm start` (a git-ignored file). Only `SESSION_SECRET` is required. Copy `.env.example` to `.env` to start, it lists every setting.

### Login (Keycloak)

Every page requires login through Keycloak SSO, except `/overlay.html` and `/overlay-cast.html` (with their assets and socket) when requested from the server's own machine (loopback). The same pages from any other address still need a login.

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | **Required.** The server won't start without it |
| `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` | Enable login. One shared client covers every venue. Without them the server starts, but every page returns 503 at `/login` until they are set and the server is restarted. An `http://` issuer is accepted for a venue-LAN Keycloak without TLS |

In the Keycloak client, "Valid redirect URIs" must cover `http://<host>:<port>/callback`, and "Valid post logout redirect URIs" must cover `http://<host>:<port>/logged-out` (or be `+` with a redirect URI pattern that covers it). Otherwise logging out stops at a Keycloak error page.

A login lasts until it has gone 12 hours without any open page talking to the server (open pages, overlays included, keep it alive). Logins are saved to `local-sessions.json` (git-ignored) so they survive a server restart; changing `SESSION_SECRET` or deleting that file logs everyone out. Someone sent back to log in returns to the page they were on, with any half-written note. See `AGENTS.md` for how authentication works in detail.

### Server and Eos

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `80` | HTTP port of the web app |
| `OSC_PORT` | `8001` | UDP port the app listens on for OSC (scene labels, record cues) |
| `EOS_HOST` | | The Eos console's address; the default until a venue is chosen on the Config & Status page |
| `EOS_PORT` | `3037` | The console's OSC-over-TCP port |

### Network timecode

| Variable | Default | Purpose |
|---|---|---|
| `GATEWAY_MCAST` | `239.194.242.66` | Multicast group the gateway sends to |
| `GATEWAY_IP` | _(any)_ | Only accept timecode from this gateway IP, e.g. `10.10.160.188`. Set it if more than one gateway is on the network |
| `GATEWAY_IFACE` | _(automatic)_ | Local IP of the network interface to join the group on. Only the default: an interface chosen on the Config & Status page replaces it |

### OBS and camera

See [OBS recording from QLab](#obs-recording-from-qlab) and [Camera preset](#camera-preset) for `OBS_*`, `VIDEOS_DIR`, `VIDEO_OFFSET_S` and `CAMERA_*`.

### Storage

Runtime data is kept in git-ignored files and folders next to the server: `backups/`, `saved-shows/`, `reset-notes/`, `recordings/`, `local-settings.json` and `local-sessions.json`. Each has an environment variable to relocate it (`BACKUPS_DIR`, `SAVED_SHOWS_DIR`, `RESETS_DIR`, `RECORDINGS_DIR`, `SETTINGS_FILE`, `SESSIONS_FILE`).

## Running

```
npm start
```

`npm run dev` restarts on file changes (nodemon). `npm run dev:playback` starts a separate sample instance for trying playback: port 3030 (`PLAYBACK_PORT` overrides), the login settings from `.env`, and its own git-ignored `.playback-dev/` storage. With `PLAYBACK_DEMO=1` it seeds 25 invented live notes only when none exist, and adds **Sample dress rehearsal** to Past notes; both open the silent twelve-minute sample recording with 33 LX cues and six scenes. Normal instance data is separate.

The main page is the notes page. The **Config & Status** page (`/config.html`, linked from the main page) holds the controls described below: timecode mode, MIDI input and network interface, Eos connection, tags, saved shows, reset and recordings. Anyone logged in can use them.

## Features

### Timecode modes

Three buttons on the Config & Status page switch every user's display between:

- **MIDI Timecode:** MTC from the computer's MIDI input (setup step 6). Disabled when no MIDI input is open, in which case the app uses Real Time.
- **Network Timecode:** the MTC that an ETC Response MIDI gateway re-sends onto the network for Eos. Always selectable.
- **Real Time:** the computer's clock.

MIDI and network timecode are separate sources; each mode shows its own source's timecode.

The same page chooses the MIDI input and the network interface for network timecode. Changes apply immediately and are saved to `local-settings.json` so they survive a restart. Until an input is chosen, the app opens the second MIDI input if there is more than one, otherwise the first.

#### Network timecode

The gateway sends each MIDI message it receives (including QLab's MTC) as ACN (ANSI E1.17) multicast on UDP port 5568. The app joins that multicast group and listens; it doesn't take part in the Eos session. The Config & Status page shows which group it is listening on and which gateway it is receiving from, and the server log prints the group at startup and the gateway's IP and CID on the first packet. When no quarter-frame arrives for 250 ms the stream is treated as stopped.

**Automatic interface mode.** With no interface chosen (page or `GATEWAY_IFACE`), the app joins the group on every network interface (one that refuses, such as a VPN, is skipped with a single log line). It locks onto the first gateway it hears MIDI from (by IP and ACN CID) and the interface on that gateway's subnet, and leaves the group on the other interfaces. MIDI from any other gateway is then ignored. If the locked gateway sends nothing at all (not even keepalives) for 10 s, the lock is released and the app listens on every interface again. The Config & Status page shows which interface and gateway it locked onto, or that it is still listening on all interfaces. Choose an interface or set `GATEWAY_IP` to pin it down when more than one gateway sends to the group.

Observed on the gateway at 10.10.160.188: the group stayed at `239.194.242.66` after restarting both the Eos console and the gateway, and the gateway keeps sending with the desk off. If the group ever changes, find it with Wireshark (`udp port 5568` from the gateway's IP) and set `GATEWAY_MCAST`.

### Eos console

The server connects to the Eos console over TCP (`EOS_HOST`, `EOS_PORT`) at start and does not retry on its own. If the console was off or the link dropped, press **Reconnect to Eos** on the Config & Status page; the connection state is shown next to the button.

The **Eos console** section of that page keeps a list of venues (a name and an IPv4 address each) and chooses the address to use: a saved venue, a custom address, or the default (`EOS_HOST`, used until something is chosen). Changing the choice, or editing the address of the venue in use, reconnects at once without a restart. The venue list and choice are saved per install in `local-settings.json` (`eosVenues`, `eosChoice`). `EOS_PORT` is unchanged.

### Scene labels

Each note is stamped with the current LX cue (read from the Eos console) and the current scene. The scene is set from QLab, or anything else that can send OSC, with an OSC message to this computer's UDP port `8001` (`OSC_PORT`). In QLab, add a Network cue with the same destination, message type **OSC Message**, and a custom message such as:

```
/bts/Scene "Act 1 Scene 2"
```

The address is any path under `/bts/` (`/bts/Scene` by convention; the last part is not used) and the label is its first argument, quoted when it has spaces. A number is taken as text. A label is cut to 200 characters; an empty one is ignored, as is one equal to the current scene. `/bts/record/...` addresses are not scene labels (see [OBS recording from QLab](#obs-recording-from-qlab)).

The scene starts as `Preshow` each time the server starts and stays until the next label arrives. A new label changes it for everyone at once: it is shown on the Config & Status page and the cast overlay, notes are grouped under it (one heading per visit to a scene, so a scene that returns gets a new group), the scene filter lists it, and, with [Camera preset](#camera-preset) configured, it can recall the camera preset. A note belongs to the scene that was current when its author started typing, so one saved just after a scene change stays in the scene it was written in. Scene changes are also logged with their time, which playback uses to show the scenes on its timeline. An `@username` in a label is highlighted for that person, and the **My scenes** filter keeps only scenes that mention the viewer.

### Writing notes

Start typing anywhere on the main page to begin a note. The note is stamped when you start typing with the timecode, the LX cue and the [scene](#scene-labels) at that moment, and every note takes one or more tags (the composer remembers the ones you last used). Enter sends on a desktop and Shift+Enter adds a line; on a touch device Enter adds a line and the Send button sends. Escape cancels an empty note. A note sent while the connection is down is kept in the browser and sent when it returns.

Notes are numbered in the order the server accepted them. Authors can edit or delete their own notes and reply to any note; replies can be edited or deleted by their author. Anyone can agree (thumbs-up) with a note or reply; hover or focus the count to see who. Typing `@` mentions an online person or an existing author. Notes can be filtered by scene, tag, author, mentioned person and search text, and the filters are kept in the page's URL. The toolbar can show notes newest or oldest first. **Download notes** in the top-bar menu saves them as JSON, and the **Video** button opens [playback](#show-recordings-and-playback).

### Shitposts chat

The chat button opens **Shitposts**, a chat for everyone logged in, kept out of notes, exports and saved shows. Messages can be replies and mentions, and a badge shows unseen mentions. Chat is kept only in server memory; after a restart the browsers offer their copies, and the fullest log that two different people agree on is restored (within 30 minutes of the start, `CHAT_RESTORE_WINDOW_MS`). **Reset all notes and chat** clears it.

### Past notes

**Past notes** (`/recall.html`) opens a saved show, or a notes `.json` file chosen or dropped from your device, with the same search, filters and playback link as live notes. It is read-only; the open show and its filters are in the URL.

### Notes, backup and reset

Notes are kept in server memory and saved to `backups/` about a second after every change (one file per minute at most), every minute, and when the server stops or crashes. A browser also keeps each note it has sent until the server confirms it, and sends it again after a reload or reconnect.

When the server starts it loads the newest backup under 2 hours old that is intact (valid JSON, well-formed notes, not cut short), trying older ones if the newest is damaged, and starts empty if none qualifies; the log says which. A restart after a dress, hours later, therefore starts clean.

Only the person who sent a note can edit it. Backups record who wrote each note (by login), so this survives a restart or an export/import. Notes from a backup or file that has no author record can be edited by anyone.

To clear the show, use **Reset all notes and chat** on `/config.html` (it asks for confirmation). This empties notes and chat on the server and in every open browser, and a restart afterwards stays empty. Tags return to the defaults (see [Tags](#tags)). Before clearing, the notes are written to `reset-notes/` and kept for 3 days (listed on the Config & Status page, where they can be restored); if that write fails nothing is reset.

**Save notes** on the same page keeps a named copy of the notes as a saved show (in `saved-shows/`), optionally resetting afterwards. Saved shows are listed in Past notes and are never aged out. JSON downloads are named `BTS Dress Notes YYYY-MM-DD.json` (the download date in UTC).

### Tags

Show tags can be added, renamed, recoloured and deleted in Settings; the new-tag colour starts on one no tag uses yet. For example, add Crew when the current show needs it. Tags used by current notes cannot be deleted, and every note keeps at least one tag. Reset and Save and reset restore the six tags in `default-tags.json`; saved shows and reset snapshots keep the custom definitions with their notes. Restoring reset notes also restores the definitions they need, keeping conflicting definitions separate so existing notes retain their meaning.

### Show recordings and playback

Under **Video** in Settings, choose **Current notes** or a saved show, then **Add video**. Everyone who opens those notes can watch the shared video. Notes opened from a JSON file in Past notes can instead use **Choose video from this device** in playback; those videos stay on the device and are not uploaded.

A recording can be several parts, uploaded together or one at a time. The parts play as one timeline in start-time order, with blank time (and a **Skip to the next part** button) where the recording stopped. Start times come from Vor's dated file names (`Show.2026-10-07 19-30-00.mp4`) and can be adjusted under **Adjust timing**; parts without one play back to back. Playback's **Add video in Settings** link selects the relevant show automatically.

Uploads are kept in `recordings/` (`RECORDINGS_DIR`), up to 32 GiB a file (`RECORDING_MAX_BYTES`, in bytes). The live notes' recording goes with them when the show is saved, and is removed by **Reset all notes and chat** (the saved show keeps its copy). Anyone logged in can upload or remove a part. Leave room on the disk: a full-length HD recording is several gigabytes.

Playback is reached from the **Video** button in the top bar of live notes and of each opened show, and from the video icon beside each note, which starts three seconds before the author began typing. **Back to notes** returns with the saved-show filters kept and the note highlighted. The source and selected note live in the URL; live playback refreshes when notes change, saved-show playback stays on its snapshot, and a local file belongs to the tab that opened it. A missing show, file or note gives a recovery message rather than opening something else.

The timeline zooms with the **−**, **+** and **Fit** buttons, the `+` `-` `0` keys, Ctrl/⌘ + wheel or trackpad pinch, and a two-finger pinch. A wheel or swipe then moves along it, and a strip of the whole show below it has a window to drag. While playing, the view follows the playhead unless it was moved away on purpose until the next seek. Double-clicking a scene zooms to it. The zoom is not kept in the URL.

### OBS recording from QLab

QLab can start and stop an OBS Studio recording with the same kind of OSC cue that sends [scene labels](#scene-labels), and the recording is added to the live notes' video on its own. OBS must run on the same computer as the server, and be OBS 28 or newer (it has a built-in WebSocket server).

**In OBS**

1. Tools > WebSocket Server Settings: tick **Enable WebSocket server**, keep port `4455`, and tick **Enable Authentication** and set a password (or leave authentication off on a computer nobody else can reach).
2. Settings > Output > Recording: set **Recording Path** to this computer's videos folder (`Movies` on macOS, `Videos` on Windows and Linux; OBS's default) and **Recording Format** to **MP4** (or Fragmented MP4). Leave **Filename Formatting** at its default (`%CCYY-%MM-%DD %hh-%mm-%ss`).

   OBS's own default is **MKV**, which browsers cannot play. The app does not add an MKV: the Config & Status page and the server log say which file was skipped and why. Change the format and record again, or use File > Remux Recordings in OBS to make an MP4 of that file; the MP4 is picked up on the next check of the folder.

**On the server.** With neither of the first two variables set the feature is off and nothing changes.

| Variable | Default | Purpose |
|---|---|---|
| `OBS_WEBSOCKET_URL` | `ws://127.0.0.1:4455` | OBS's WebSocket address. Setting this or the password switches the feature on |
| `OBS_WEBSOCKET_PASSWORD` | _(none)_ | The password set in OBS, if any |
| `OBS_OSC_SECRET` | _(none)_ | If set, a recording cue must carry it as an OSC argument, else it is ignored and logged. If unset, no secret is needed |
| `VIDEOS_DIR` | `~/Movies` on macOS, `~/Videos` elsewhere | The folder OBS records to |
| `VIDEO_OFFSET_S` | `0` | Seconds added to the start of every OBS recording as it is added (see [Video timing](#video-timing)). A number from -60 to 60; anything else is ignored (logged, and shown on the Config & Status page) |

**QLab cues.** Add a Network cue with the same destination as the scene labels (this computer, port `8001` or `OSC_PORT`), message type **OSC Message**, and a custom message:

- `/bts/record/start` starts recording, `/bts/record/stop` stops it. No value is needed.
- With `OBS_OSC_SECRET` set, put the secret after the address: `/bts/record/start my-secret`.
- With `CAMERA_PRESET` set, a plain start cue first moves the camera to that preset (see [Camera preset](#camera-preset)). To use a different preset for one start, add its number: `/bts/record/start 9`, or with a secret `/bts/record/start my-secret 9`. The secret is checked first and used up first, so a numeric secret is never taken for a preset.

Starting while OBS is already recording, or stopping while it is not, does nothing. Any other address under `/bts/record` is ignored; these addresses are never used as scene labels.

**Status.** The Config & Status page has an **OBS recording** row (not recording, recording, or an error such as OBS not reachable or a wrong password), and the notes page shows a small indicator to everyone. Both follow OBS itself, so they stay right when someone presses Record in OBS by hand. The server connects when it starts and reconnects by itself after OBS is restarted. OBS being off or the password wrong never stops scene labels, Eos or anything else, and each trigger and failure is written to the server log.

**Recordings in playback.** When OBS stops recording, it says where it saved the file, and that file is added to the live notes' video (uploaded by "OBS") with the start time and length it was recorded at. A hard link is used where the disk allows, so a long recording is not copied; on another disk the part refers to the file where it is, and keeps working only while that file stays in `VIDEOS_DIR`. Removing it from the notes, or **Reset all notes and chat**, never deletes OBS's file, and saving the show links it into the saved show. A file is added once, even after it is removed.

The server also checks `VIDEOS_DIR` when it connects to OBS and every 30 seconds (`OBS_SCAN_MS`) while OBS is not recording, to find recordings OBS finished while the server was down or not connected. That check is deliberately narrow, since the folder holds everything else you record: only files directly in the folder, named like OBS's default (`2026-11-22 19-30-00.mp4`), finished since the live notes began (10 minutes before their first note or scene, or since the server started if there are none). A recording saved under a custom name is added when OBS reports it stopping, not by this check. Nothing outside `VIDEOS_DIR` is ever read or served; a recording OBS saves elsewhere is reported and skipped (set `VIDEOS_DIR` to the folder OBS records to).

#### Video timing

A note sits in the video at the moment it was started, measured from the recording's start time. OBS says it has started a moment after the file's first frame, so when it does the server asks OBS how long it has been recording (`GetRecordStatus`'s `outputDuration`) and counts back from there; if OBS cannot answer, the time OBS said it started is used. A recording that was already running when the server connected is counted back the same way.

If the notes still fall a little before the start of the video on your rig, set `VIDEO_OFFSET_S` in `.env` and restart: **positive moves the video's start earlier** (so each note lands later in the video), negative moves it later. The Config & Status page shows the **Video offset** in use (and says if the value was refused). It applies only to recordings added after it is set, and changes nothing at its default of `0`. Recordings already added keep their stored start; to correct one, change its start under Video in Settings > **Adjust timing**.

## Chat stickers

The Shitposts picker can upload personal PNG, JPEG, GIF or WebP stickers. Files are kept on the server in `stickers/` (or `STICKERS_DIR` for tests), up to 5 MB each (`STICKER_MAX_BYTES`). SVG is excluded. Each account has its own sticker collection; selecting a sticker sends its server URL as a chat message, and the normal chat restore and reset behavior applies. The picker keeps that account's most recently used stickers first, and selected files upload concurrently. Sticker messages have an Add action beside Reply for adding them to the current account's library. Identical uploaded files are stored once and linked to each account that uploaded or added them.

Pasting a PNG, JPEG, GIF or WebP file into the Shitposts composer uploads it as a personal sticker and sends it in chat. Direct GIF links embed in chat and have an Add action for downloading them into the current account's sticker library; direct PNG, JPEG and WebP links also embed. GIF downloads are stored like uploaded stickers and cannot be added twice to the same account. Other image sources and SVG links are not embedded or uploaded as stickers.  Replying to a message and then choosing a sticker sends that sticker as the reply.

### Camera preset

The app can recall a position preset on a Lumens VC-A61PN camera before OBS starts recording, and optionally on every scene change (VISCA over RS-422 sometimes changes the preset by itself). It uses the camera's web interface, so the server must reach the camera over HTTP. With no `CAMERA_HOST` the feature is off and nothing changes. Set these in `.env` only (the credentials are never shown in the app, logged, or saved elsewhere):

| Variable | Default | Purpose |
|---|---|---|
| `CAMERA_HOST` | _(none)_ | The camera's address, e.g. `192.168.1.50`. Setting it switches the feature on |
| `CAMERA_USERNAME` | _(none)_ | The camera web interface's user name |
| `CAMERA_PASSWORD` | _(none)_ | Its password |
| `CAMERA_PRESET` | _(none)_ | The fixed preset (1 to 255, as people count them: the ninth is `9`) a plain start cue recalls before recording, and scene changes recall when enabled. Replaces `CAMERA_SCENE_PRESET`, which is deprecated: it is read only when `CAMERA_PRESET` is unset, and the server logs a warning at startup |
| `CAMERA_RECALL_ON_SCENE` | off | `on` recalls `CAMERA_PRESET` every time the scene label really changes (a repeated label does nothing). Needs the preset |
| `CAMERA_TIMEOUT_MS` | `2000` | The longest one recall, including a new login, may take |

A plain start cue recalls `CAMERA_PRESET`, then starts OBS; a start cue with a preset number recalls that one instead, for that start only. With no `CAMERA_PRESET` and no number, a start only records. If the recall fails or the camera is down, recording still starts and the server log says so; a preset is not recalled if OBS is already recording. Scene-change recalls never delay the scene update; changes that arrive while one is still running collapse into one more recall. The server logs in once and reuses the login, and logs in again once if the camera restarts or rejects it. The **Camera preset** row on the Config & Status page shows the last recall (recalled, failed with a short reason, or not configured).

### Profile photos

Notes, comments, chat and pickers show each person's photo from the BTS website, at `https://www.bts-crew.com/images/profiles/<username>.jpg` (a 500×500 JPEG the website crops on upload). The username is the OIDC `preferred_username`, not the email prefix, since contact email can change after the account is created; email is never consulted, whatever its domain. Accounts without a valid username, and missing or failed images, show initials. Sessions from before this was added need a fresh login. Stable identity and colours still use the Keycloak `sub`.

The mapping assumes the website and Keycloak usernames stay aligned: the website can link an existing account by email or allow an administrative username change without evident synchronisation, so this is an integration assumption, not an identity guarantee. An authoritative photo claim or API would remove it. The shared wire field `emailPrefix` carries only that username; full addresses are not added to notes, chat, user broadcasts or exports.

The browser loads the image directly: the URL is a fixed HTTPS path on the website (with `referrerpolicy="no-referrer"`), there is no arbitrary URL input, server-side fetch, proxy or upload endpoint, and the CSP allows only that image origin. DOMPurify sanitizes markup, not image bytes, and the website sees the requesting browser's IP and photo path. This covers our side of the integration, not a security audit of the separate website.

### OBS overlays

Two pages for an OBS browser source, linked from the Config & Status page: `/overlay.html` shows the timecode (in the chosen mode) and LX cue, and `/overlay-cast.html` shows the time of day and [scene](#scene-labels). They open without login when loaded from the server's own computer, and are read-only. Adjust them with URL options, e.g. `/overlay.html?layout=left&size=large&theme=dark`:

| Option | Values (default first) |
|---|---|
| `layout` | `center`, `left`, `right`, `spaced` |
| `size` | `normal`, `small`, `large` |
| `theme` | `default`, `dark`, `light`, `minimal` |
| `display` | `/overlay.html`: `all`, `timecode-only`, `lx-only`, `realtime-only`. `/overlay-cast.html`: all, `realtime-only`, `act-only` |

## Testing

```
npm test
```

Runs the unit and end-to-end tests under `test/`, including regression tests built from captured Eos desk traffic and gateway packets. The end-to-end tests start the real server against stub Keycloak, Eos, OBS and camera services.

Have fun and enjoy :)
