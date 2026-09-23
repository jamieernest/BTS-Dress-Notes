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

7. Every page requires login via Keycloak SSO. Set `SESSION_SECRET` (required - the server won't start without it) and, to enable login, `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID` and `KEYCLOAK_CLIENT_SECRET` (one shared client covers every venue). See `AGENTS.md` for how these are used.

8. Run by running `npm start`

# Timecode modes

The three buttons under the main clock switch every user's display between:

- **MIDI Timecode** - MTC from the computer's MIDI input (step 6). Disabled when no MIDI device is found at startup, in which case the app starts in Real Time.
- **Network Timecode** - the MTC that an ETC Response MIDI gateway re-sends onto the network for Eos. Always selectable.
- **Real Time** - the computer's clock.

MIDI and network timecode are separate sources; each mode shows its own source's timecode.

## Network timecode

The gateway sends each MIDI message it receives (including QLab's MTC) as ACN (ANSI E1.17) multicast on UDP port 5568. The app joins that multicast group and listens; it doesn't take part in the Eos session. The status panel shows which group it is listening on and which gateway it is receiving from, and the server log prints the group at startup and the gateway's IP and CID on the first packet. When no quarter-frame arrives for 250 ms the stream is treated as stopped.

Settings (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `GATEWAY_MCAST` | `239.194.242.66` | Multicast group the gateway sends to |
| `GATEWAY_IP` | _(any)_ | Only accept timecode from this gateway IP, e.g. `10.10.160.188`. Set it if more than one gateway is on the network |
| `GATEWAY_IFACE` | _(system default)_ | Local IP of the network interface to join the group on, for computers with more than one network connection |

Observed on the gateway at 10.10.160.188: the group stayed at `239.194.242.66` after restarting both the Eos console and the gateway, and the gateway keeps sending with the desk off. If the group ever changes, find it with Wireshark (`udp port 5568` from the gateway's IP) and set `GATEWAY_MCAST`.


Have fun and enjoy :)
