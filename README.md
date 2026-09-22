# BTS-Dress-Notes
Dress Notes App with MTC/Real time and live LX cues from any ETC Eos Console

_Disclaimer: this was mostly AI generated (Deepseek V3-4 and Claude Sonnet 5). It is unethical to use this for commercial purposes and I have decided to use an MIT license as I believe it is not fair to claim this as my own. _

# How to set up:

1. Install [Node.JS](https://nodejs.org/en/download)

2. Clone this project `git clone https://github.com/jamieernest/BTS-Dress-Notes`

3. Connect the computer, Eos Console and MIDI gateway (if needed) to the same local network

4. On the Eos Console go to System => System Settings => Show Control => OSC and set the `OSC TX Port` to `8001` and `OSC TX IP Address` to the computer's IP Address

5. Go into folder and install dependencies

```
cd BTS-Dress-Notes
npm i
```

6. (For MIDI TC) Connect the Computer's MIDI out to the Gateway, and connect <strong>Another Interface's</strong> MIDI in to the MIDI thru port on the gateway

7. Every page requires login via Keycloak SSO. Set `SESSION_SECRET` (required - the server won't start without it) and, to enable login, `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID` and `KEYCLOAK_CLIENT_SECRET` (one shared client covers every venue). See `AGENTS.md` for how these are used.

8. Run by running `npm start`


Have fun and enjoy :)
