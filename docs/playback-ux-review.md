# Playback timeline UX review

16 October 2026. Review of the local Vor playback proof of concept.

## Current layout after feedback

The user preferred circles over the stems. The player now uses 6 px LX circles centred on the note stems, with no left-hand key or gutter. Circles draw above notes and take priority at an exactly coincident centre; the same note remains selectable on its stem above or below the circle. The larger invisible targets and nearest-centre selection are retained.

Verified the coincident circle and stem independently with real pointer clicks. Desktop and 390 px layouts fit the viewport with the timeline aligned to the video; all seven focused timing/security tests passed again.

The initial review below records the alternatives and findings before that feedback.

## Initial decision

Use one shared event field with coloured note stems and outlined LX circles beneath them. Fill the current LX circle. Keep scene chapters above it and one time axis below it. There is no divider between notes and cues, and cue names appear on demand.

The event field is 80 px high, down from 108 px. The scene strip remains 32 px. The different shapes distinguish event types without depending on colour. The small shape key sits in the existing left gutter.

## Alternatives tried in the real player

| Option | Observation | Decision |
| --- | --- | --- |
| Circles directly over note stems | Compact, but a coincident note masks the cue at the circle centre. The prototype's native pointer target was the note. | Reject this placement. |
| Diamonds directly over note stems | Visually distinct, but the same collision occurred. Changing the shape alone did not fix the interaction. The association with keyframes is also an unverified assumption about these users. | Reject this placement. |
| Circles below stems in the shared field | Both targets remain reachable at the same horizontal position. No dividing rule or separate cue labels are needed. | Implement. |

These are findings about the prototypes and implementation, not measured user preferences. Another overlay design could resolve hits differently, but users would still need a way to choose between coincident event types.

## Review against the ten heuristics

Framework: [Jakob Nielsen's ten usability heuristics, Nielsen Norman Group](https://www.nngroup.com/articles/ten-usability-heuristics/). The judgments below are this project's design assessment, not an NN/G evaluation.

| Heuristic | Assessment and resulting change | Remaining limitation |
| --- | --- | --- |
| 1. Visibility of system status | The playhead, current elapsed time and highlighted scene remain visible; the active LX circle is filled. Scrubbing updates position immediately while video frames catch up. | Play/pause has an accessible label, but its visual state is subtle on a static shot. |
| 2. Match with the real world | Keep the crew's LX terminology, scene names and chronological placement. Cue details identify the recorded cue and clock time. | Whether the symbols and three-second note lead-in match crew expectations needs human testing. |
| 3. User control and freedom | Dragging restores the original playing/paused state. Escape closes details, timing and help; Home/End reach the video bounds. | There is no jump history to return to the previous position after an accidental jump. |
| 4. Consistency and standards | Notes and cues use the same time axis and consistent shape per type. Keyboard seeking uses a focusable slider; buttons retain native keyboard activation. Field height stays stable when cues are absent. | The event symbols are custom, so their compact key remains necessary. |
| 5. Error prevention | Non-overlapping vertical targets prevent cross-type collisions. Overlapping horizontal padding resolves to the nearest centre, rather than DOM stacking order. Clicks and drags have a movement threshold. | Very close or identical timestamps of the same type remain difficult to distinguish. No accessibility target-size compliance claim is made. |
| 6. Recognition rather than recall | A bar/circle key and named scene strip explain the display. Hover or click reveals details; keyboard cue navigation also opens details. Clicked details persist until dismissed or another timeline action. | Cue numbers are deliberately not printed across the field; finding a particular number takes inspection or keyboard stepping. |
| 7. Flexibility and efficiency | Pointer scrubbing, tag filters, five-second arrow seeks, previous/next note and previous/next cue shortcuts are available. Slider value text includes time, scene and cue. | Long shows and dense cue sequences need zoom. Real assistive-technology testing remains outstanding. |
| 8. Aesthetic and minimalist design | Consolidate the fields, remove their divider, reduce event-field height by 28 px and show cue text on demand. Help stays in Playback options. | Minimalism trades some immediate cue identification for a quieter view. |
| 9. Error recognition and recovery | A bad replacement notes file now leaves a visible explanation above the player, retaining the loaded show. Invalid clock input now has a text example and an invalid state, rather than only a red border. | Video codec errors still offer general browser advice rather than a precise codec diagnosis. |
| 10. Help and documentation | Add Timeline help to Playback options, explaining shapes, scrubbing, click-to-play, note lead-in and shortcuts. It has a Close button and Escape support. | Help discovery on first use has not been tested with people. |

## Verification

Browser checks used the real sample player: 25 notes, 33 cues, six scenes, twelve minutes. No live notes were changed.

- Placed a note and cue at the same horizontal position in each prototype. Native hit testing at the circle/diamond centre selected the note in the two overlaid variants and the cue in the lower-circle variant. Temporary probes were removed.
- In the final implementation, positioned two cue centres 5.87 px apart with overlapping 24 px hit boxes. Native targeting selected the later cue; the app correctly resolved the click to the nearest, earlier cue. Clicking the note at that same x position independently selected the note.
- A first-note click sought to 21 s for a note written at 24 s, highlighted the matching list row and opened its details.
- Page Down sought from 21 s to the next cue at 45 s and showed its cue text. Home/End reached 0/720 s; Right Arrow reached 5 s from the start. Escape dismissed details.
- Real pointer drags sought through the video, left a paused video paused and resumed a playing video after release.
- Filtering Lighting reduced the notes to 11 of 25 while retaining all 33 cue markers.
- Help opened with focus on Close help and closed with Escape. Invalid clock input showed an explanatory message and `aria-invalid=true`.
- Opening an invalid replacement notes file kept the existing player visible and showed the error outside the hidden drop area.
- Layouts at 1440×860, 390×844 and 320×568 had no document overflow; notes had their own scroll area. Phone cue symbols reduce to 6 px. At 320 px, clicking a note centre covered by another note's invisible padding still selected the intended note; its detail card stayed within the viewport.
- `node --check public/playback.js` and `git diff --check` passed. `node --test test/playback-timeline.test.js test/security-e2e.test.js`: 7 tests passed, including the no-inline-script check for public HTML.

This was a heuristic inspection and browser interaction testing, not a study with participants. Mobile checks used desktop-browser viewports, not physical touch devices. Screen-reader behaviour, real mobile scrubbing performance, very long recordings and dense real show logs still need validation. Prioritise zoom or a local detail view before treating the whole-show overview as a precise picker for dense cues.

## Try it

On this development host's Tailscale network: [sample playback](http://100.99.42.78:3030/playback.html?demo=1). The sample uses the same player and invented show data.
