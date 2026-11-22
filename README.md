# BTS-Dress-Notes
Dress Notes App with MTC/Real time and live LX cues from any ETC Eos Console

_Disclaimer: this was mostly AI generated (Deepseek V3-4 and Claude Sonnet 5). It is unethical to use this for commercial purposes and I have decided to use an MIT license as I believe it is not fair to claim this as my own. _

# How to set up:

1. Install [Node.JS](https://nodejs.org/en/download)

2. Clone this project `git clone https://github.com/jamieernest/BTS-Dress-Notes`

3. Connect the computer, Eos Console and MIDI gateway (if needed) to the same local network

4. On the Eos Console go to System => System Settings => Show Control => OSC and set the `OSC TX Port` to `8001` (or the value of `OSC_PORT` if set) and `OSC TX IP Address` to the computer's IP Address

5. Go into folder and install dependencies

```
cd BTS-Dress-Notes
npm i
```

6. (For MIDI TC) Connect the Computer's MIDI out to the Gateway, and connect <strong>Another Interface's</strong> MIDI in to the MIDI thru port on the gateway

   (For Network TC) No extra MIDI interface is needed - see [Timecode modes](#timecode-modes) below

7. Every page requires login via Keycloak SSO, except that `/overlay.html` and `/overlay-cast.html` (with their assets and socket) open without login when requested from the server's own machine (loopback); the same pages from any other address still need it. Set `SESSION_SECRET` (required - the server won't start without it) and, to enable login, `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID` and `KEYCLOAK_CLIENT_SECRET` (one shared client covers every venue). See `AGENTS.md` for how these are used. A login lasts until it has gone 12 hours without any open page talking to the server (open pages, overlays included, keep it alive), and is saved to `local-sessions.json` (git-ignored) so it survives a server restart; changing `SESSION_SECRET` or deleting that file logs everyone out. Someone sent back to log in returns to the page they were on, with any half-written note. In the Keycloak client, "Valid redirect URIs" must cover `http://<host>:<port>/callback` and "Valid post logout redirect URIs" must cover `http://<host>:<port>/logged-out` (or be `+` with a redirect URI pattern that covers it), or logging out stops at a Keycloak error page.

8. Run by running `npm start`

# Timecode modes

The three buttons on the Config & Status page (`/config.html`, linked from the main page) switch every user's display between:

- **MIDI Timecode** - MTC from the computer's MIDI input (step 6). Disabled when no MIDI input is open, in which case the app uses Real Time.
- **Network Timecode** - the MTC that an ETC Response MIDI gateway re-sends onto the network for Eos. Always selectable.
- **Real Time** - the computer's clock.

MIDI and network timecode are separate sources; each mode shows its own source's timecode.

The Config & Status page also chooses the MIDI input and the network interface for network timecode. Changes apply immediately and are saved to `local-settings.json` (git-ignored) so they survive a restart. Until an input is chosen there, the app opens the second MIDI input if there is more than one, otherwise the first.

The server connects to the Eos console over TCP (`EOS_HOST`, `EOS_PORT`) at start and does not retry on its own. If the console was off or the link dropped, press **Reconnect to Eos** on the Config & Status page; the connection state is shown next to the button.

The **Eos console** section of the Config page keeps a list of venues (a name and an IPv4 address each) and chooses the address to use: a saved venue, a custom address, or the default (`EOS_HOST`, used until something is chosen). Changing the choice, or editing the address of the venue in use, reconnects at once without a restart. The venue list and choice are saved per install in `local-settings.json` (`eosVenues`, `eosChoice`; `SETTINGS_FILE` overrides the path) and use the same permissions as the other Config page controls. `EOS_PORT` is unchanged.

## Network timecode

The gateway sends each MIDI message it receives (including QLab's MTC) as ACN (ANSI E1.17) multicast on UDP port 5568. The app joins that multicast group and listens; it doesn't take part in the Eos session. The Config & Status page shows which group it is listening on and which gateway it is receiving from, and the server log prints the group at startup and the gateway's IP and CID on the first packet. When no quarter-frame arrives for 250 ms the stream is treated as stopped.

Settings (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `GATEWAY_MCAST` | `239.194.242.66` | Multicast group the gateway sends to |
| `GATEWAY_IP` | _(any)_ | Only accept timecode from this gateway IP, e.g. `10.10.160.188`. Set it if more than one gateway is on the network |
| `GATEWAY_IFACE` | _(automatic)_ | Local IP of the network interface to join the group on. Only the default: an interface chosen on the Config & Status page replaces it. When neither is set, the app uses automatic mode (below) |

**Automatic interface mode.** The app joins the group on every network interface (one that refuses, such as a VPN, is skipped with a single log line), locks onto the first gateway it hears MIDI from (by IP and ACN CID) and the interface on that gateway's subnet, and leaves the group on the other interfaces. MIDI from any other gateway is then ignored. If the locked gateway sends nothing at all (not even keepalives) for 10 s, the lock is released and the app listens on every interface again. The Config & Status page shows which interface and gateway it locked onto, or that it is still listening on all interfaces. Choose an interface or set `GATEWAY_IP` to pin it down when more than one gateway sends to the group.

Observed on the gateway at 10.10.160.188: the group stayed at `239.194.242.66` after restarting both the Eos console and the gateway, and the gateway keeps sending with the desk off. If the group ever changes, find it with Wireshark (`udp port 5568` from the gateway's IP) and set `GATEWAY_MCAST`.


Have fun and enjoy :)

## Notes backup, restart and reset

Notes are kept in server memory and saved to `backups/` about a second after every change (one file per minute at most), every minute, and when the server stops or crashes. A browser also keeps each note it has sent until the server confirms it, and sends it again after a reload or reconnect. When the server starts it loads the newest backup under 2 hours old that is intact (valid JSON, well-formed notes, not cut short), trying older ones if the newest is damaged, and starts empty if none qualifies; the log says which. A restart after a dress, hours later, therefore starts clean.

Only the person who sent a note can edit it; backups record who wrote each note (by login), so this survives a restart or an export/import. Notes from a backup or file that has no author record, such as one made before this rule, can be edited by anyone.

To clear the show, open `/config.html` and use **Reset all notes and chat** (it asks for confirmation). This empties notes and chat on the server and in every open browser, and a restart afterwards stays empty. Tags are kept.

JSON downloads are named `BTS Dress Notes YYYY-MM-DD.json` (the download date in UTC).

## Show recordings

Under **Video** in Settings, choose **Current notes** or a saved show, then **Add video**. Everyone who opens those notes can watch the shared video; live notes and saved shows use that shared video. Notes opened from a JSON file in Past notes can instead use **Choose video from this device** in playback; those videos stay on the device and are not uploaded. A recording in several parts can be uploaded together or one at a time: the parts play as one timeline in start-time order, with blank time where the recording stopped. Start times come from Vor's dated file names (`Show.2026-10-07 19-30-00.mp4`) and can be adjusted under **Adjust timing**; parts without one play back to back. Playback's **Add video in Settings** link selects the relevant show automatically.

Uploads are kept in `recordings/` (`RECORDINGS_DIR`), up to 32 GiB a file (`RECORDING_MAX_BYTES`, in bytes). The live notes' recording goes with them when the show is saved on `/config.html`, and is removed by **Reset all notes and chat** (the saved show keeps its copy). Anyone logged in can upload or remove a part. Leave room on the disk: a full-length HD recording is several gigabytes.


## OBS recording from QLab

QLab can start and stop an OBS Studio recording with the same kind of OSC cue that sends scene labels, and the recording is added to the live notes' video on its own. OBS must run on the same computer as the server (`npm start`); OBS 28 or newer, which has a built-in WebSocket server.

**In OBS**

1. Tools > WebSocket Server Settings: tick **Enable WebSocket server**, keep port `4455`, and tick **Enable Authentication** and set a password (or leave authentication off on a computer nobody else can reach).
2. Settings > Output > Recording: set **Recording Path** to this computer's videos folder (`Movies` on macOS, `Videos` on Windows and Linux; OBS's default) and **Recording Format** to **MP4** (or Fragmented MP4). Leave **Filename Formatting** at its default (`%CCYY-%MM-%DD %hh-%mm-%ss`).

   OBS's own default is **MKV**, which browsers cannot play. The app does not add an MKV: the Config & Status page and the server log say which file was skipped and why. Change the format and record again, or use File > Remux Recordings in OBS to make an MP4 of that file; the MP4 is picked up on the next check of the folder.

**On the server** (environment variables, or `.env`; with neither of the first two set the feature is off and nothing changes)

| Variable | Default | Purpose |
|---|---|---|
| `OBS_WEBSOCKET_URL` | `ws://127.0.0.1:4455` | OBS's WebSocket address. Setting this or the password switches the feature on |
| `OBS_WEBSOCKET_PASSWORD` | _(none)_ | The password set in OBS, if any |
| `OBS_OSC_SECRET` | _(none)_ | If set, a recording cue must carry it as an OSC argument, else it is ignored and logged. If unset, no secret is needed |
| `VIDEOS_DIR` | `~/Movies` on macOS, `~/Videos` elsewhere | The folder OBS records to; see below |
| `VIDEO_OFFSET_S` | `0` | Seconds added to the start of every OBS recording as it is added; see **Video timing** below. A number from -60 to 60; anything else is ignored (logged, and shown on the Config & Status page) |

**QLab cues.** Add a Network cue with the same destination as the scene labels (this computer, port `8001` or `OSC_PORT`), message type **OSC Message**, and a custom message:

- `/bts/record/start` starts recording, `/bts/record/stop` stops it. No value is needed.
- With `OBS_OSC_SECRET` set, put the secret after the address: `/bts/record/start my-secret`.
- To move the camera first, add a preset number to the start cue: `/bts/record/start 9`, or with a secret `/bts/record/start my-secret 9`. See **Camera preset** below. The secret is checked first and used up first, so a numeric secret is never taken for a preset.

Starting while OBS is already recording, or stopping while it is not, does nothing. Any other address under `/bts/record` is ignored; these addresses are never used as scene labels.

**Status.** The Config & Status page has an **OBS recording** row (not recording, recording, or an error such as OBS not reachable, or the password being wrong), and the notes page shows a small indicator to everyone. Both follow OBS itself, so they stay right when someone presses Record in OBS by hand. The server connects when it starts and reconnects by itself after OBS is restarted; OBS being off or the password wrong never stops scene labels, Eos or anything else, and each trigger and failure is written to the server log.

### Camera preset

The app can recall a position preset on a Lumens VC-A61PN camera before OBS starts recording, and optionally on every scene change (VISCA over RS-422 sometimes changes the preset by itself). It uses the camera's web interface, so the server must reach the camera over HTTP. With no `CAMERA_HOST` the feature is off and nothing changes. Set these in `.env` only (the credentials are never shown in the app, logged, or saved elsewhere):

| Variable | Default | Purpose |
|---|---|---|
| `CAMERA_HOST` | _(none)_ | The camera's address, e.g. `192.168.1.50`. Setting it switches the feature on |
| `CAMERA_USERNAME` | _(none)_ | The camera web interface's user name |
| `CAMERA_PASSWORD` | _(none)_ | Its password |
| `CAMERA_SCENE_PRESET` | _(none)_ | A preset number (1 to 255, as people count them: the ninth is `9`) to recall on scene changes |
| `CAMERA_RECALL_ON_SCENE` | off | `on` recalls `CAMERA_SCENE_PRESET` every time the scene label really changes (a repeated label does nothing). Needs the preset |
| `CAMERA_TIMEOUT_MS` | `2000` | The longest one recall, including a new login, may take |

A start cue with a preset number recalls it, then starts OBS. A cue without one only records. If the recall fails or the camera is down, recording still starts and the server log says so; a preset on a cue is not recalled if OBS is already recording. Scene-change recalls never delay the scene update; changes that arrive while one is still running collapse into one more recall. The server logs in once and reuses the login, and logs in again once if the camera restarts or rejects it. The **Camera preset** row on the Config & Status page shows the last recall (recalled, or failed with a short reason, or not configured).

**Recordings in playback.** When OBS stops recording, it says where it saved the file, and that file is added to the live notes' video (under Video in Settings, uploaded by "OBS") with the start time and length it was recorded at. A hard link is used where the disk allows, so a long recording is not copied; on another disk the part refers to the file where it is, and keeps working only while that file stays in `VIDEOS_DIR`. Removing it from the notes, or **Reset all notes and chat**, never deletes OBS's file, and saving the show links it into the saved show. A file is added once, even after it is removed.

**Video timing.** A note sits in the video at the moment it was started, measured from the recording's start time. OBS says it has started a moment after the file's first frame, so when it does the server asks OBS how long it has been recording (`GetRecordStatus`'s `outputDuration`) and counts back from there; if OBS cannot answer, the time OBS said it started is used. A recording that was already running when the server connected is counted back the same way. If the notes still fall a little before the start of the video on your rig, set `VIDEO_OFFSET_S` in `.env` and restart: **positive moves the video's start earlier** (so each note lands later in the video), negative moves it later. The Config & Status page shows the **Video offset** in use (and says if the value was refused). It applies only to recordings added after it is set, and changes nothing at its default of `0`.

To calibrate, record, leave a note once the indicator shows recording, stop, and read the server log's line for the recording (`OBS: recording started; OBS had been recording … ms when it said so` and, once it is added, `OBS: "<file>": start found from obs; recorded for … s by the clock, the file is … s: start is … s later than the file's length implies`). The first is how far STARTED trailed the first frame; the second compares the clock with the file's own length (not shown for a paused or fragmented recording), which is about 0 when the start is right and positive when it was found late. The start is not taken from the stop time less the file's length, since a pause shortens the file and OBS can take a moment to finish writing it; it is only logged as a cross-check.

Recordings already added keep their stored start; nothing rewrites them. To correct one, change its start under Video in Settings > **Adjust timing**.

The server also checks `VIDEOS_DIR` when it connects to OBS and every 30 seconds (`OBS_SCAN_MS`) while OBS is not recording, to find recordings OBS finished while the server was down or not connected. That check is deliberately narrow, since the folder holds everything else you record: only files directly in the folder, named like OBS's default (`2026-11-22 19-30-00.mp4`), finished since the live notes began (10 minutes before their first note or scene, or since the server started if there are none). A recording saved under a custom name is added when OBS reports it stopping, not by this check. Nothing outside `VIDEOS_DIR` is ever read or served; a recording OBS saves elsewhere is reported and skipped (set `VIDEOS_DIR` to the folder OBS records to).


Show tags can be added, renamed, recoloured and deleted in Settings; the new-tag colour starts on one no tag
uses yet. For example, add Crew when the current show needs it. Tags used by current notes cannot be
deleted. Reset and Save and reset restore the six tags in `default-tags.json`;
saved shows and reset snapshots keep the custom definitions with their notes.
Restoring reset notes also restores the definitions they need, keeping conflicting
definitions separate so existing notes retain their meaning.

The tag settings in [PR #41](https://github.com/jamieernest/BTS-Dress-Notes/pull/41)
were assessed for reuse for [#36](https://github.com/jamieernest/BTS-Dress-Notes/issues/36).
Its `config-tags.js` payload helper couples settings to slash commands, and the PR
includes a broader UI/playback overhaul. This implementation uses the existing
tag events and settings layout, without importing that overhaul or adding commands.

### Website profile photos

Profile photos retain Ewan’s work from [PR41](https://github.com/jamieernest/BTS-Dress-Notes/pull/41), source commit `7348f59b76491b935ac29fb38a24cc4ac6a72e45`, cherry-picked with his authorship preserved. His unrelated tag-file changes were excluded; the existing tag editor and six defaults remain.

The website source at `643bec9abcd819107e608d5d9d217fb439360b88` confirms the contract:

- [User creation](https://github.com/backstage-technical-services/website/blob/643bec9abcd819107e608d5d9d217fb439360b88/app/Models/Users/User.php#L146) initially uses `<username>@bath.ac.uk` and provisions that username in Keycloak. Contact email can subsequently change, so we use OIDC `preferred_username`, not the email prefix, as the photo filename.
- [Avatar storage](https://github.com/backstage-technical-services/website/blob/643bec9abcd819107e608d5d9d217fb439360b88/app/Models/Users/User.php#L747) uses `/images/profiles/<username>.jpg`; Intervention Image crops/re-encodes uploads to 500×500. [Its tests](https://github.com/backstage-technical-services/website/blob/643bec9abcd819107e608d5d9d217fb439360b88/tests/Feature/Users/ProfileUpdateTest.php#L163) check the JPEG format and dimensions. A missing custom image falls back to initials in Dress Notes.

Any account with a valid OIDC `preferred_username` receives a photo identifier, whatever its email domain; email is never consulted. Accounts without a valid username keep initials; older sessions need a fresh login. Stable identity and colours still use Keycloak `sub`. Website and Keycloak usernames must align: the website can link an existing account by email or allow an administrative username change without evident synchronisation, so filename mapping is an integration assumption rather than a universal identity guarantee. An authoritative photo claim/API would remove that assumption. The shared field `emailPrefix` contains only the website username for compatibility; full addresses and duplicate usernames are not added to notes, chat, user broadcasts or exports.

Security uses the existing DOMPurify HTML sanitizer, Zod schemas, Helmet CSP and openid-client OIDC validation. Browser image URLs are fixed HTTPS paths on `www.bts-crew.com`, with `referrerpolicy="no-referrer"`, no inline handlers, no arbitrary remote URL input, no server-side fetch/proxy and no new upload endpoint. There is no custom HTML or image sanitizer. The browser decodes the remote image; DOMPurify sanitizes markup, not image bytes. A failed/missing image reveals the normal initials in notes, comments, chat and pickers. The website still sees the requesting browser’s IP and photo path. This verifies our integration contract, not a full security audit of the separate website or its upload dependencies.
