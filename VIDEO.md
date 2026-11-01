# Automated hackathon video

The generated deliverables are kept out of Git:

- `deliverables/receipts-demo.mp4` — 1280×720 H.264, ElevenLabs narration, approximately 2:07.
- `deliverables/receipts-demo.srt` — editable English captions. Subtitle timing is approximate; review before publishing.
- `deliverables/demo-receipt.png` — exported synthetic receipt.

All recorded UI footage is from a synthetic-data-only public demo. The title overlay says **SYNTHETIC · MOCK DEMO** throughout; the narration distinguishes the real, consented YouCam integration test from the simulated recording. It contains no personal selfie, API key, or real trial data. No music is included.

## Rebuild

1. Put an ElevenLabs API key in the local `ELEVENLABS_API_KEY` environment variable. Narration sends only `scripts/video/scenes.json` text to ElevenLabs and can consume credits. Run `node scripts/video/generate-audio.mjs`. Existing audio is reused; `--force` regenerates it and consumes credits again.
2. Start a separate Receipts instance with `RECEIPTS_PUBLIC_DEMO=1`, `MOCK_YOUCAM=1`, `MOCK_AGENTS=1`, an isolated database, and seeded synthetic demos; run `node scripts/video/record-demo.mjs http://127.0.0.1:3201`. Never point the recorder at a site containing private data.
3. With FFmpeg and FFprobe on PATH, run `node scripts/video/assemble.mjs`. The editor embeds the captions as an MP4 subtitle track and also writes the `.srt` file.
4. Watch the entire MP4, review the captions, and upload it yourself to YouTube or Vimeo. Check that the video is publicly visible before adding its link to Devpost.
