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

7. Every page requires login via Keycloak SSO. Set `SESSION_SECRET` (required - the server won't start without it) and, to enable login, `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID` and `KEYCLOAK_CLIENT_SECRET` (one shared client covers every venue). See `AGENTS.md` for how these are used. Logins last 12 hours and are saved to `local-sessions.json` (git-ignored) so they survive a server restart; changing `SESSION_SECRET` or deleting that file logs everyone out.

8. (Recommended) Choose who may use the Config & Status page. Copy `admins.example.json` to `admins.json` (git-ignored) and list people by Keycloak username, email or `sub`, or set `ADMIN_USERS` to a comma separated list (both are combined). Everyone else loses the page, its link and its controls (time mode, MIDI input, network interface, Eos reconnect, reset). Editing `admins.json` takes effect without a restart. See [Admins](#admins).

9. Run by running `npm start`

# Admins

Only admins may use the Config & Status page (`/config.html`) and the controls on it. Other people never see the link, get a 403 for the page, and the server ignores those controls if they are sent anyway. Everything else on the main page is open to every logged-in user.

Admins are listed in `admins.json` (path overridable with `ADMINS_FILE`) and/or the `ADMIN_USERS` environment variable. An entry is a Keycloak **username**, **email** (ignored if Keycloak marks it unverified) or **`sub`**, case-insensitive; display names are not matched. The file is either an array or `{ "admins": [...] }`; see `admins.example.json`.

- **No `admins.json` and no `ADMIN_USERS`:** the check is off and everyone is an admin, as before this feature. The server log notes this at start, so set a list on any server that matters.
- **A list that exists is always enforced.** An empty list, or a file that is not valid JSON, means nobody is an admin (the server log says why) rather than everybody.
- Logins that were saved before this feature have no username, so a username entry only matches after that person logs in again (an email or `sub` entry works at once).

# Timecode modes

The three buttons on the Config & Status page (`/config.html`, linked from the main page) switch every user's display between:

- **MIDI Timecode** - MTC from the computer's MIDI input (step 6). Disabled when no MIDI input is open, in which case the app uses Real Time.
- **Network Timecode** - the MTC that an ETC Response MIDI gateway re-sends onto the network for Eos. Always selectable.
- **Real Time** - the computer's clock.

MIDI and network timecode are separate sources; each mode shows its own source's timecode.

The Config & Status page also chooses the MIDI input and the network interface for network timecode. Changes apply immediately and are saved to `local-settings.json` (git-ignored) so they survive a restart. Until an input is chosen there, the app opens the second MIDI input if there is more than one, otherwise the first.

The server connects to the Eos console over TCP (`EOS_HOST`, `EOS_PORT`) at start and does not retry on its own. If the console was off or the link dropped, press **Reconnect to Eos** on the Config & Status page; the connection state is shown next to the button.

## Network timecode

The gateway sends each MIDI message it receives (including QLab's MTC) as ACN (ANSI E1.17) multicast on UDP port 5568. The app joins that multicast group and listens; it doesn't take part in the Eos session. The Config & Status page shows which group it is listening on and which gateway it is receiving from, and the server log prints the group at startup and the gateway's IP and CID on the first packet. When no quarter-frame arrives for 250 ms the stream is treated as stopped.

Settings (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `GATEWAY_MCAST` | `239.194.242.66` | Multicast group the gateway sends to |
| `GATEWAY_IP` | _(any)_ | Only accept timecode from this gateway IP, e.g. `10.10.160.188`. Set it if more than one gateway is on the network |
| `GATEWAY_IFACE` | _(automatic)_ | Local IP of the network interface to join the group on. Only the default: an interface chosen on the Config & Status page replaces it. When neither is set, the app joins on the interface whose subnet contains the gateway (`GATEWAY_IP`, or `10.10.160.188` if unset), and falls back to the system default when none does; the page and the server log say which was used |

Observed on the gateway at 10.10.160.188: the group stayed at `239.194.242.66` after restarting both the Eos console and the gateway, and the gateway keeps sending with the desk off. If the group ever changes, find it with Wireshark (`udp port 5568` from the gateway's IP) and set `GATEWAY_MCAST`.


Have fun and enjoy :)

## Notes backup, restart and reset

Notes are kept in server memory and saved to `backups/` every minute and when the server stops or crashes. When the server starts it loads the newest backup under 2 hours old that is intact (valid JSON, well-formed notes, not cut short), trying older ones if the newest is damaged, and starts empty if none qualifies; the log says which. A restart after a dress, hours later, therefore starts clean.

Only the person who sent a note can edit it; backups record who wrote each note (by login), so this survives a restart or an export/import. Notes from a backup or file that has no author record, such as one made before this rule, can be edited by anyone.

To clear the show, open `/config.html` and use **Reset all notes and chat** (it asks for confirmation). This empties notes and chat on the server and in every open browser, and a restart afterwards stays empty. Tags are kept.
