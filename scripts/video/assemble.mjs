import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve("deliverables");
const work = resolve(root, "video-work");
const scenes = JSON.parse(await readFile("scripts/video/scenes.json", "utf8"));
const run = (cmd, args, cwd = work) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
const seconds = (file) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]).toString().trim());

// Persistent label makes the status of every frame unambiguous.
const label = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect x="1010" y="14" width="252" height="40" rx="20" fill="#171b1a" fill-opacity=".90"/><text x="1136" y="40" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">SYNTHETIC · MOCK DEMO</text></svg>`;
await sharp(Buffer.from(label)).png().toFile(resolve(work, "demo-label.png"));
let offset = 0;
let cue = 0;
const subtitles = [];
const stamp = (value) => {
  const ms = Math.max(0, Math.round(value * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
for (const scene of scenes) {
  const length = seconds(`${scene.id}.mp3`) + 0.55;
  if (!Number.isFinite(length) || length <= 0) throw new Error(`Invalid narration duration for ${scene.id}`);
  // Freeze the last recorded frame if narration is longer than the interaction.
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", `${scene.id}.webm`, "-i", `${scene.id}.mp3`, "-loop", "1", "-i", "demo-label.png", "-filter_complex", "[0:v]scale=1280:720,setsar=1,tpad=stop_mode=clone:stop_duration=180[base];[base][2:v]overlay=0:0:shortest=1,format=yuv420p[v]", "-map", "[v]", "-map", "1:a:0", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,apad", "-t", length.toFixed(3), "-r", "25", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", `${scene.id}.mp4`]);
  // Approximate subtitle timing by text length; each scene is bounded by the
  // measured audio duration. The editable SRT ships alongside the MP4.
  const words = scene.text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += 9) chunks.push(words.slice(i, i + 9).join(" "));
  const weights = chunks.map((x) => x.length);
  const total = weights.reduce((a, b) => a + b, 0);
  let position = offset;
  for (let i = 0; i < chunks.length; i++) {
    const duration = (length - 0.55) * weights[i] / total;
    subtitles.push(`${++cue}\n${stamp(position)} --> ${stamp(position + duration)}\n${chunks[i]}\n`);
    position += duration;
  }
  offset += length;
  console.log(`Assembled ${scene.id}: ${length.toFixed(1)}s.`);
}
await writeFile(resolve(work, "concat.txt"), scenes.map((s) => `file '${s.id}.mp4'`).join("\n"));
await writeFile(resolve(root, "receipts-demo.srt"), subtitles.join("\n"));
run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "joined.mp4"]);
run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", "joined.mp4", "-i", "../receipts-demo.srt", "-map", "0:v", "-map", "0:a", "-map", "1:0", "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", "-movflags", "+faststart", "../receipts-demo.mp4"]);
console.log(`Finished ${resolve(root, "receipts-demo.mp4")} (${offset.toFixed(1)} seconds); captions are approximate.`);
