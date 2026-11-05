# PR54 follow-up UI/UX review — round 1

**Reviewer:** Kimi K3.1 Pro, independently reviewing only the follow-up UI/UX  
**Strict base:** `26ec19fb61bab745490c8b4f9c232652bf8812a4` (PR30 head)  
**Reviewed head:** `9c75eadda2b55af9906e94688976e508ae65d65f`  
**PR:** https://github.com/jamieernest/BTS-Dress-Notes/pull/54  
**Date:** 2026-11-05

## Score and verdict

**9.0/10 — PASS. The scoped follow-up reaches the requested threshold.**

I found **no material first-time-user barrier** in the changed experiences, either in the reproduced browser flows or in the supporting code inspection. The implementation preserves the accepted minimal design and product choices. No implementation round is required to reach 9/10, and I would not recommend inventing changes merely to increase the number.

This is an expert review, not a representative end-user study. The remaining device and validation limits below, plus a dense but still usable small-phone filter state, are why this is not a 10.

## Evidence and method

- Reviewed the exact diff from the strict PR30 base to the reviewed head, including the follow-up UI, shared rendering, interaction helpers, Settings, Past notes, and relevant tests. `AGENTS.md` was read first. The worktree remained clean.
- Used a separate, owned browser tab against the supplied synthetic server at `synthetic development preview on port 3050`. I checked desktop **1280×800**, phone **390×844**, and narrow-phone **320×700/600** layouts. I did not touch the 3052 comparison server or any other tab. My tab was closed after cleanup.
- Real browser interactions included search, person/reference pickers, filter composition and clearing, sticky navigation, reply preview/cancellation/jump, mention completion/undo, agreement-people disclosure, keyboard and pointer chat resizing, chat anchoring, mobile dialog focus, and Settings tooltips. No console errors or failed requests were present in the final main-page check.
- No real note/chat submission, agreement toggle, deletion, reset, import, save, settings mutation, or server restart was performed. The initial and final live note count was 39; there were no pending notes at cleanup. Search, drafts, reply preview, popovers and fixture messages were cleared.
- **Intercepted draft fixture:** I replaced only the Send button's client-side `click()` method temporarily to count send routing without running note submission. Focused Enter and BODY Enter each invoked it once; selecting `#38` with Enter did not. The method was restored and the draft cleared. This verifies keyboard routing, not server acknowledgement.
- **Local renderer fixtures:** I delivered invented messages through the browser's local Socket.IO `onevent` path, never to the server, to exercise unread/mention badges and bottom anchoring. I restored the affected localStorage copy and reloaded the real server log. No fixture messages remained. These checks are identified as fixtures below, not real multi-user traffic.
- Existing `docs/ux-review.md` and supplied screenshots were not treated as independent evidence. No public screenshot is included here, avoiding incidental later user-entered text.

## Reproduced findings by area

### 1. Sticky search, people filters and global references — meets the bar

- Empty search focus stayed closed and quiet. Bare `#` produced **all 39 assigned references**, oldest to newest, in a bounded scroll menu: **320px high at 1280**, **420px at 390**, with the last entry reachable by scrolling.
- `#38` narrowed to one suggestion. Tab and ArrowDown+Enter each produced exactly the `#38` result and left focus in search. Escape cleared the query and restored all 39 notes.
- `@Alex` offered Alex Lighting once; Tab selected **By Alex Lighting** by default. Its compact chip menu contained only **Written by** and **Mentions**, and the integrated X had a specific accessible label. Switching to Mentions found the expected note. Adding a second person preserved the existing filter; removing one chip preserved the other.
- Bare `@` showed **Notes mentioning you** followed by the three known accounts. Selecting the shortcut produced **Mentions you** and the expected synthetic `#38` result.
- Plain filter state survived reload in Past notes, including the saved-show id and author. Adding `#38` afterward composed author+reference in the URL. The saved show contained 38 numbered notes and all referenced tag definitions, including optional Crew; none was missing.
- Sticky positioning worked at **48px on desktop** and below the measured **112px wrapped Past notes header at 390**. Search remained hit-testable after scrolling. No horizontal overflow occurred at 390 or 320.
- Small-phone density is the only polish concern: two person filters plus scene/tag/search/clear controls made the sticky toolbar **280px high at 320**, with the 60px top bar. Every control remained visible and operable, so this is not a material barrier, but it leaves less room for notes.

References: `public/note-view.js:296-513`, `public/note-numbers.js:10-19`, `public/index.js:190-240`, `public/index-style.css:241-267,747-773`, `public/base.css:202-270`, `public/recall.js:181-250`.

### 2. Draft Escape/Enter behaviour — meets the bar

- A written draft remained intact and focused after Escape; its session draft and open composer remained present.
- With the intercepted Send control, Enter while focused and Enter after deliberately blurring to BODY each invoked the send action exactly once. Enter in the open reference picker selected the reference and did **not** invoke note send. No note or pending row was created.
- The touch/coarse Enter-newline distinction and IME/modifier guards were inspected in code, not exercised on physical mobile hardware.

References: `public/type-to-note.js:13-18,43-58`, `public/index.js:1660-1665,1789-1822`.

### 3. Shitposts replies, mentions, layout and resize — meets the bar

- Own bubbles were flush right with the reply control on their left; received messages used the opposite arrangement. Quote author/snippet was inside the bubble. Message rows were not focusable controls.
- Reply selection showed a named quote preview and moved focus to the composer. Escape cancelled it without sending. Activating a quote jumped to and focused the original reply control; the original was centred within **0.2px** in the measured check.
- Typing `Review @` opened the three-account picker. Tab inserted `@Alex Lighting`, showed the composing highlight, and did not send. Ctrl+Z restored the preceding native textarea state.
- Keyboard resize changed width **420→436→420** with matching `aria-valuenow`, while bottom following remained intact. An actual pointer drag reached the 800px limit, updated its accessible value and preference, and was then restored to 420.
- At mobile widths the divider disappeared and chat filled **390×844**, **320×700**, and **320×600**. Opening focused Close; the page and top bar became inert; Shift+Tab/Tab wrapped correctly between Close and the enabled endpoint. Inputs and Send remained within the viewport with no document overflow.
- After explicitly settling at the bottom, opening the reply preview preserved following (**0.5px from bottom**), as did viewport resizing and a locally appended fixture message. While scrolled back, a second fixture message preserved both the first visible message id and its exact offset instead of pulling the reader to the bottom. An earlier un-settled measurement was rerun properly and was not counted as a defect.
- **Badge fixture:** an ordinary incoming message showed one badge with `1` and accessible name `1 unread message`. A following mention changed the same badge to `@`, with accessible name `1 unseen mention, 2 unread messages`; exactly one visible badge existed. Opening chat cleared both states.

References: `public/index.js:617-713,715-781,1541-1562,1625-1638,1835-1880`, `public/chat-replies.js:7-20`, `public/chat-resize.js:30-119`, `public/chat-scroll.js:7-55`, `public/mentions.js:69-210`, `public/index-style.css:534-746`.

### 4. Note and comment agreements — meets the bar

- On synthetic note `#38`, hovering the synthetic reply's agreement group opened Finn Demo and Alex Lighting in a viewport-contained popover. Count press did the same at 320. No agreement toggle was pressed.
- The active thumb was blue (`rgb(108, 120, 230)`) with `aria-pressed=true`; icon/count positions were fixed. At phone widths both measured **44×44px**.
- Thumb/count/edit/delete lived in one comment-header action group, followed by the body. At 390 the author/time stacked within the heading; at 320 the whole 186px action group wrapped to the next line only because it no longer fit. The body retained the comment-main width. There was no rejected floating reaction treatment.
- In-place update logic and read-only Past notes behaviour were code-inspected; no live mutation was used to retest them.

References: `public/note-view.js:16-77,149-192,234-251`, `public/base.css:202-217`, `public/index-style.css:364-381,436-478`, `public/index.js:808-824,1986-1993`.

### 5. Settings show tags — meets the bar

- All unchanged Save controls were disabled. The used default tags exposed **Used by notes. Change their tags before deleting.** on hover and keyboard focus. Enter on the protected Delete preserved the row and did not emit a deletion result; Escape dismissed the reason.
- At 390 and 320, name fields, colour wells and buttons remained reachable with no horizontal overflow. Colour wells and buttons measured 44px high; the tooltip was repositioned to **x=8, right=268** at both widths and stayed within the viewport.
- Saved-show tag definitions were verified through a read-only show fetch and rendering. Reset-to-six-defaults, final-tag protection, unsaved-edit handling under incoming updates, and server failure recovery were reviewed in code/tests but deliberately not exercised with live mutations.

References: `public/config.html:31-45`, `public/config.js:45-182`, `public/config-style.css:154-184`, `public/recall.js:195-242`.

### 6. Website profile photos — meets the bar within test limits

- The synthetic session rendered intact initials. The valid remote-photo success path was not exercised.
- Code inspection confirmed the fixed HTTPS BTS website origin, validated username, no-referrer image request, lazy decoding, and removal of a failed image to reveal the existing initials. There is no arbitrary avatar URL or editable-email-prefix guessing.
- Ewan's original authorship is retained: commit `03959cb06efef40f997599d51ec38cf885dad50f` is authored by **Ewan <ewan@omg.lol>**, followed by the separate hardening commit.

References: `public/profile-photos.js:7-12`, `profile-photos.js:4-18`, `public/note-view.js:101-124`, `public/safe-html.js:34-40`.

## Nielsen heuristic assessment

| Heuristic | Assessment of the changed experiences |
| --- | --- |
| 1. Visibility of system status | **Meets.** Active person chips, filtered counts, pressed/blue agreements, reply preview, single notification badge, Settings Save states and chat width values expose state without extra panels. |
| 2. Match with the real world | **Meets.** Plain names, Written by/Mentions, Note #38, a positive thumb, scene clocks and New tag name are understandable rehearsal language; UUIDs and account ids stay internal. |
| 3. User control and freedom | **Meets.** Independent filter X controls, Clear filters, Escape/cancel reply, reversible draft navigation, resizable chat and protected tag deletion provide exits. |
| 4. Consistency and standards | **Meets.** Live and Past notes share templates and filtering; existing tokens/icons are retained; note/comment agreements and chat reply placement are consistent. |
| 5. Error prevention | **Meets.** Tab completes rather than sends, Enter guards respect menus/IME, used/final tags are protected, blank/unchanged Settings saves are disabled, and photos fail to initials. |
| 6. Recognition rather than recall | **Meets.** Names/avatars, bare-@ self shortcut, all-reference browsing with excerpts, and quoted reply context avoid memorising ids or original messages. Plain names and digits also work, so the @/# syntax is not a prerequisite. |
| 7. Flexibility and efficiency | **Meets.** Sticky full navigation, composable filters, pointer/Tab/arrow choices, quote jump, and keyboard/drag resize support both novice and fast paths. The 320 active-filter stack is dense but functional. |
| 8. Aesthetic and minimalist design | **Meets.** Empty search is quiet, headers are compact, per-note timestamps are hidden, one badge is used, and comment actions share one header group. No new guidance panels or keyboard footers appeared. |
| 9. Recognise and recover from errors | **Meets in inspected paths.** No-match clearing, unavailable reply-target treatment, protected-delete explanation, retained edits and failed-photo fallback are scoped and understandable. Offline/server-failure recovery was code-reviewed rather than induced. |
| 10. Help and documentation | **Meets within the accepted scope.** Accessible names, titles and contextual deletion/tooltips provide just-in-time help without redundant instruction panels. |

## Material issues and fixes required to reach 9

**None.** There is no P0/P1/P2 finding to delegate from this round. In particular, I did not reproduce a broken reference/person flow, accidental draft send, reply/mention send, unread-count ambiguity, agreement layout regression, chat anchoring failure, horizontal phone overflow, or protected-tag deletion.

### Optional polish, not a release blocker

- **P3 — small-phone active-filter density:** at 320, the two-person-filter toolbar measured 280px high. If real rehearsal users report too little note space, explore a more compact active-chip layout while preserving the accepted full sticky toolbar and independent controls. Do not hide functionality or add another help panel solely for this theoretical concern.

## Remaining limits

- Phone checks used Chromium viewport emulation, not physical coarse-pointer hardware, a software keyboard, IME, rotation on a device, or a screen reader. Coarse-only target sizing and keyboard/visualViewport behaviour therefore remain partly code-inferred.
- No representative nontechnical rehearsal-user study was performed; learnability conclusions are expert judgements backed by reproduced flows.
- Real multi-user delivery, agreement acknowledgement, offline failures, Settings write failures, reset/default restoration, and deletion were intentionally not induced. Those paths were reviewed in code and the supplied test results only.
- Valid remote website-photo loading and a failed valid image URL were not exercised; initials and the fallback implementation were inspected.

## Repository / PR state at handback

- Worktree: clean; no app code, PR, git history, or test files changed. Only this review artifact was written.
- Supplied validation: **267/267 tests pass** on the complete retry; I did not rerun the suite.
- PR: https://github.com/jamieernest/BTS-Dress-Notes/pull/54
- Head: `9c75eadda2b55af9906e94688976e508ae65d65f`
- PR state: **OPEN, Draft**.
- GitHub checks: none reported in `statusCheckRollup` at review time.
- Reviews: none reported; `reviewDecision` empty.
- Browser tab: my review tab closed; no root/user tabs touched.
