# UX review: the studio through a thirteen-year-old's eyes

This review (September 2026, version 2.1) asked one question of every screen: *would a curious thirteen-year-old who likes the animation understand what they see, know what to do next, and want to keep playing?* It records how the review was done, what confused, the design that answers it, and a checklist of every change with its status.

## How the review was done

1. **Screenshots of every main state** at 1440 × 900: the first open, the gallery, a point-cloud animation (Point jellyfish), a shader animation (Vortex) and each of its tabs, a construction, the Help and Export dialogs, the parts palette.
2. **Two independent readings.** One by the developer, and one by a reviewer who saw only the screenshots and role-played the thirteen-year-old: for every screen, the literal questions they would ask and what they would click first, then a prioritized list of problems with fixes.
3. **Measurements** before and after, with the same script: visible controls, the size of the picture, what the panel says first.
4. **Verification** of the new design with screenshots at laptop, desktop, tablet and phone sizes, the workflow suite and the unit tests.

## What a newcomer asked

| Where | The question | What changed |
|---|---|---|
| First open | “What is *Step 2 of 9 · Pinched shell family · S,A*? Did I skip step 1?” | A scene opens on **About this scene**, not on one of its parts. Parts are numbered “Part 3 of 4” and reached from the scene’s list, with **‹ Whole scene** to go back. |
| First open | “*Exact structural port at defaults. Ordered soft first-hit selection produces S…*” | Every description was rewritten; the first thing the panel says is what you are seeing, in plain sentences. |
| First open | “Why is the picture so small? Why are there lines and numbers on it?” | Rulers and grid are off by default; the parts strip is compact and can be folded away; the picture has more than twice the area (see Measurements). |
| Top bar | “*Source-equation port*? Like a USB port?” | A plain line says where the scene comes from: “By Xor · the artist’s own code”, “Our own study”, “Built from parts”. |
| Point jellyfish | “Why is it not moving?” | A scene opened from the gallery plays at once (unless the system asks for reduced motion). |
| Math | “● input ● parameter · drag it ● output ● time — drag what, where?” | A sentence above the math: “Reading the colors: blue letters come in from earlier parts (like where the pixel is), orange ones are settings you can drag, pink t is the time in seconds, and green is what this part makes.” The same colors mean the same thing everywhere. |
| Math | “*a slow second index: 0 to 202 over the 20000 points*” | “y is like a row number: it goes up by 1 every 99 dots, from 0 to about 202.” Every caption is a full sentence. |
| Time bar | “What are 0.0, 0.7, 1.3 under the pictures?” | The frames sit directly under the time bar, with a ruler in whole seconds (0 s, 1 s, 2 s …); the clock reads “2.54 s”. |
| Time bar | “*Source F*? *Linear*? *Exposure*?” | Moved to the **View** menu as Light to color (The artist’s formula, Soft highlights, Plain) and Brightness. |
| Parameters | “What do ◆ ↺ ▦ do? What does *Values* do?” | One line above the sliders explains the three buttons; “Values” is “Show numbers”; “Variations” is “🎲 Surprise me”. |
| Parts strip | “*coordinates feeds Pinched shell family · S,A*?” | Cards show a number, a name and a picture; the scene panel lists each part with one plain line (“Tells every pixel where it is on the picture.”). |
| Code | “Can I change this?” (the hint was under the code) | “How to play” is above the code: drag an orange number, click a name, hover anything. |
| Tabs | “*In & out*, *Stats*, *More*: who is this for?” | Tabs are Math or Code, Look inside, Big ideas, then — quieter, for going deeper — Connections, Measure, More. |
| Look inside | “What are vec4, vec2, float, int?” | Plain kinds: color, 2 numbers, number, count. |
| More | “*Not animated*? It’s spinning!” | “None of its settings has keyframes. It still moves, because its math uses the time t.” |
| Help | “*Think in fields. Build in layers.* Farm fields?” | “How to use Equation Studio”: Look, Play, Take it apart, Read the colors, Make your own, Go deeper. |
| Gallery | “*6.283 s loop*? Which one is easy?” | “6.3 s loop”; an **Easy / Medium / Expert** badge on every card; “Start here · easy ones” first; the gallery opens by itself on the first visit. |
| Footer | “*browser storage unavailable*: is it broken?” | “Not kept automatically here: use Save” (and “Kept in this browser · nothing is uploaded” where storage works). |

## The design

### 1. The picture first

The picture is why anyone opens the studio, so it gets the room: rulers and grid start off, display options live in one **View ▾** menu (rulers, grid, measuring along a line, brightness, light to color, sharpness, frames, snapshot, compare, copy, expand), the parts strip uses compact cards and folds away with **▾ Hide**, and the time bar puts the frames under the scrubber instead of in a second row.

### 2. A scene tells its story; parts are chapters

The side panel shows either the whole scene or one part. **About this scene** comes first: what you are seeing, who made it and whether it is their own code, how hard it is, **Try this**, **How it works** step by step, the parts it is built from, the big ideas, and the code as posted. A part’s panel always says where you are (“‹ Whole scene · Part 3 of 4”). The canvas label (WHOLE PICTURE, JUST THIS PART, WHAT THIS PART ADDS, WHAT MOVES, VALUE …) says what the picture shows, and the parts strip marks the open part: three location cues that never disagree.

### 3. Colors that mean one thing

| Color | Means | Where you see it |
|---|---|---|
| Orange | something you can change | sliders, the numbers in code, setting letters in math, Try this, the “changed” dot |
| Pink | time | t in math, the play button, the clock and time bar, keyframes that are set, What moves |
| Blue | what comes into a part | input letters (x, y, p), `FC` in code |
| Green | what a part makes | output letters, the final picture’s label, “✓ Made from the artist’s own code”, tried challenges |
| Gray and white | everything else | selection, tabs, menus, buttons |

The kinds of parts (positions, numbers, shape, picture) no longer have their own colors in the panels, so color never means two things. The wiring view keeps them on its sockets, where matching kinds is the point.

### 4. Invite play, make it safe

- **Try this**: three to five challenges per scene, each a single undoable change with one button; the animation starts so the change shows; tried ones are ticked.
- **🎲 Surprise me** next to every part’s settings; **▦** shows a setting’s whole range at once; a mark under each slider shows where it started.
- **How it works** puts a value of the code on the picture or stops a loop early while a step is open, so the explanation is something you watch.
- Every panel and challenge says the same thing about safety: Undo takes back each change and **Start over** brings back the scene.

### 5. Writing

Every explanation was rewritten to one set of rules (in the [Development guide](DEVELOPMENT.md#writing-for-the-app)): full sentences; what you see first, then how the math makes it; every technical word explained where it first appears; everyday comparisons; concrete numbers. The rewrite covered the 18 works (summaries, walk-through steps, the captions of every line of readable code, Try this), the 45 parts (descriptions whose first sentence doubles as a one-line summary, 87 step captions, 119 setting explanations, notes and code comments), the 47 big ideas, the 12 scene guides, 59 code tooltips, and every label, tooltip, message and the Help page of the interface.

## Facts corrected along the way

Rewriting meant re-deriving each explanation from its formula, and some old explanations were wrong:

- **Point jellyfish**: d is smallest (1) in the *middle* of the sheet of dots, which becomes the top of the bell; the old caption said “1 at the top of the bell, growing downward”.
- **Central glow**: the mask W is about 0.7 at the center, 0.37 at a distance of 0.1 and nearly 0 beyond 0.25 (not “about 1 within 0.1”).
- **Aurora**: two ribbon arms, not one, with the purple fringe along one edge of each ribbon.
- **Localized vortex**: its rotation speed turns the whole picture, not only the swirl.
- **Fractal noise**: with a positive flow speed the pattern moves down the screen.
- **Zoom (log R)**: each doubling of distance adds about 0.69 to the natural log, not 1.
- **rotate2D**: `v *= rotate2D(a)` turns v clockwise; **fsnoiseDigits** changes slowly rather than making “larger cells”.
- **Golden spiral**: it does *not* loop seamlessly after 2π seconds (its zoom slides 8.28 pattern cells, not a whole number; renders at 0 and 2π differ), so the claim and its “seamless loop” idea were removed.
- **Underwater reef**: the camera starts at (6, 6, 15), not (6, 15, 15).
- **Rainbow trefoil**: a trefoil knot passes over and under itself, not “through itself”.
- **Jellyfish lattice**: the bend only affects the smaller copies, so the old “the dome becomes a bell” caption was wrong.
- **Lace garden**: w = p/3 makes the background three times bigger, not smaller.
- **Cloud cave**: the glow peaks just outside the surface and subtracts light inside the cloud.
- **Fluffy anemone** (our study): 90 slices, not 80; the sway is sin(0.333 t + 5 R).
- **Blossoming tree**, **Folded jewel box**, **Carved stone kaleidoscope**: captions of loops and early stops corrected to what the code does (checked by rendering).
- Walk-through steps that stop a loop early were re-checked by rendering them; steps whose picture was almost black now stop later (for example the jellyfish lattice at 80 steps instead of 40).

## Measurements (1440 × 900, the same script before and after)

| | 2.0 | 2.1 |
|---|---|---|
| Visible controls, first open | 87 | 69 |
| Visible controls, Vortex open | 77 | 57 |
| Picture, a square animation (px) | 337 × 331 | 485 × 485 (2.1× the area) |
| Picture, the nebula (px) | 562 × 331 | 808 × 485 |
| Share of the window that is picture, square animation | 8.6 % | 18.2 % |
| What the panel says first | “◀ Step 2 of 9 ▶ ⤢ Playground … Exact structural port at defaults.” | “ABOUT THIS SCENE · Point jellyfish · By ア (@yuruyurau) · Easy · ✓ Made from the artist’s own sketch” |

## Checklist

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | A scene opens on its story, not on a part | Done | `ui-scene-view.js`; workflow check “First visit…” |
| 2 | Always say where you are (‹ Whole scene · Part n of m, the canvas label, the marked card) | Done | workflow checks “A click opens a part…” |
| 3 | Colors mean one thing everywhere | Done | `style.css` tokens `--change`, `--time`, `--where`, `--result` |
| 4 | Legend as a sentence above the math | Done | `ui-component-view.js` steps() |
| 5 | Plain labels everywhere (views, tabs, buttons, menus, Help) | Done | `index.html`, UI modules |
| 6 | Frames under the time bar with a ruler in seconds; clock in seconds | Done | `ui-timeline.js`, `ui-filmstrip.js`; workflow check |
| 7 | Bigger picture: rulers/grid off, View menu, compact and foldable parts strip | Done | Measurements above |
| 8 | Try this challenges for all 30 scenes, undoable | Done | `works.js`, `presets.js` guides, `ui-try.js`; workflow check |
| 9 | Autoplay when a scene is opened from the gallery | Done | `openScene()` in `ui-library.js`; workflow check |
| 10 | Gallery: first-visit welcome, easy first, difficulty badges, readable loop lengths | Done | `ui-library.js`; workflow check |
| 11 | Every explanation rewritten to the writing rules | Done | works, catalog, concepts, guides, tooltips |
| 12 | Facts re-derived and corrected while rewriting | Done | list above |
| 13 | Settings before the math; one line explaining ↺ ▦ ◆; Surprise me | Done | `ui-component-view.js` |
| 14 | Click the picture to pin a reading without turning on rulers | Done | `ui-canvas.js` |
| 15 | Phones start on About (the story); tablet and phone without sideways scrolling | Done | `ui-mobile.js`; screenshot suite |
| 16 | High contrast covers the new panels | Done | `style.css` |
| 17 | A guided first-visit tour over the real screen (coach marks) | Not done | The welcome note, the gallery header and Try this cover the first steps; a step-by-step overlay is a possible next step |
| 18 | Tested with actual thirteen-year-olds | Not done | This review is by role-play and heuristics; watching real newcomers is the next check |
