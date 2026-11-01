import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const dir = resolve(process.argv[2] ?? "deliverables/video-work");
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("Set ELEVENLABS_API_KEY locally before generating narration.");
const scenes = JSON.parse(await readFile("scripts/video/scenes.json", "utf8"));
await mkdir(dir, { recursive: true });
// Bella: ElevenLabs premade voice. Only the scripted, non-personal narration
// goes to ElevenLabs. The key is read from the environment and never logged.
const voice = process.env.ELEVENLABS_VOICE_ID || "hpp4J3VqNfWAUOO0d1Us";
for (const scene of scenes) {
  if (existsSync(resolve(dir, `${scene.id}.mp3`)) && !process.argv.includes("--force")) {
    console.log(`Reusing narration ${scene.id}; pass --force to regenerate.`);
    continue;
  }
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: scene.text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.55, similarity_boost: 0.75 } }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    console.error(`ElevenLabs ${scene.id}: HTTP ${response.status}; ${body?.detail?.status ?? "request failed"}`);
    process.exitCode = 1;
    break;
  }
  await writeFile(resolve(dir, `${scene.id}.mp3`), Buffer.from(await response.arrayBuffer()));
  console.log(`Generated narration ${scene.id} (${scene.text.length} characters).`);
}
