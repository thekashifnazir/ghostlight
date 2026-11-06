# Spike 06: ghost voice test (throwaway)

**6 Nov 2026.** Three sample lines (two ghost hints, one room description, 301 characters) generated with ElevenLabs text-to-speech in two candidate voices and two models. Files are in `out/` (gitignored), so listen locally.

| Voice | Model | Files |
|---|---|---|
| Alice, ASMR British Whisper (`nbk2esDn4RRk4cVDdoiE`) | eleven_multilingual_v2 | `out/*-nbk2es-eleven_multilingual_v2.mp3` |
| Alice, ASMR British Whisper | eleven_flash_v2_5 (cheaper, faster) | `out/*-nbk2es-eleven_flash_v2_5.mp3` |
| Callum, Husky Trickster (`N2lVS1w4EtoT3dr4eOWO`) | eleven_multilingual_v2 | `out/*-N2lVS1-eleven_multilingual_v2.mp3` |

**Credits couldn't be measured:** the hackathon key is restricted (no `user_read`), so `/v1/user/subscription` fails. Estimate from ElevenLabs' published rates (check before relying on it): multilingual v2 about 1 credit per character, Flash v2.5 about 0.5. On that basis the whole voice budget (under ~100,000 characters estimated) is under 100,000 credits on v2, or about half on Flash.

**Key:** for now the script reads the hackathon-kit machine-local file (`~/.config/hackathon-kit/env`, written by `kit-setup-elevenlabs`). **To do (Kash, 6 Nov): move to this repo's own `.env` with a new key later.** `.env` is already gitignored.

```bash
python3 -I spikes/06-voice/voice_test.py voices
python3 -I spikes/06-voice/voice_test.py speak <VOICE_ID> [eleven_multilingual_v2|eleven_flash_v2_5]
```

## Decision and model check (6 Nov 2026)

- **Kash: Alice (ASMR British Whisper) is the ghost.** Cost isn't a constraint (plenty of credits).
- Also generated the nudge line with Alice on `eleven_v3` (with a `[whispers]` audio tag), `eleven_v4` and `eleven_turbo_v2_5`. All three model IDs were accepted by the API. The restricted key can't list models or read rates (`/v1/models` returns 401), so relative cost per model is unknown here. Pick the model by ear.

## Prices from ElevenLabs' own pages (read 6 Nov 2026)

elevenlabs.io/pricing/api, API billed in dollars:

| Model | model_id | $ per 1,000 characters |
|---|---|---|
| Eleven v4 | `eleven_v4` | $0.08 |
| Eleven v4 Turbo | `eleven_v4_turbo` | $0.04 |
| Eleven v3 | `eleven_v3` | $0.08 |
| Multilingual v2 | `eleven_multilingual_v2` | $0.08 |
| Flash v2.5 / Turbo v2.5 | `eleven_flash_v2_5` | $0.04 |

**Whole voice budget** (under ~100,000 characters, estimated): about **$8** on v3, v4 or v2, about $4 on v4 Turbo or Flash.

From elevenlabs.io/docs/overview/models: v4 takes up to 10,000 characters per request, v3 up to 5,000. The docs list audio tags (like `[whispers]`) for v4 Turbo and v3 Conversational; they don't say whether plain v3 or v4 honour them. Listen for whether the v3 sample whispers or reads the tag aloud. Turbo v2.5 is deprecated (use Flash v2.5).

Third-party pages (eesel.ai, cartesia.ai) agree on $0.08 / $0.04 and mention a v4 launch discount that ended 12 Oct 2026.

## Decision (6 Nov 2026, Kash)

**Ghost = Alice (ASMR British Whisper, `nbk2esDn4RRk4cVDdoiE`) on `eleven_v4`.** Audio tags (`[laughs]`, `[sighs]`, `[shouts]`, `[whispers]`) worked on both v3 and v4 in the tag test (`out/tags-test-*.mp3`); v4 picked as the newer model at the same price ($0.08 per 1,000 characters).
