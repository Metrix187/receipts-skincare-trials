# Receipts — Devpost submission kit

**Deadline:** November 2, 2026, 11:45 a.m. Eastern Time. Confirm the current deadline and eligibility on the [official rules](https://youcam-api-skin-ai-ecommerce.devpost.com/rules).

## Project description

**Tagline:** Your skincare claims deserve receipts.

Most skincare routines rely on memory: a product promises visible results, but lighting, time, and other changes make it hard to tell whether anything actually happened. Receipts turns that question into a small, pre-registered experiment for one person.

Tell Receipts what product you are trying and what it claims. A Protocol Agent uses tools to choose a suitable design, match the claim to a YouCam skin concern, estimate API cost, and check its own plan. For a product that can stay on one side of the face, the app can propose a randomized split-face design. Otherwise it proposes baseline and treatment periods. Before any measurements, the user locks a protocol and its hash.

Each check-in uses in-browser face detection and quality checks for framing, lighting, and consistency before upload. YouCam AI Skin Analysis asynchronously returns scores and detection masks. The Verdict Agent uses a locked analysis tool and explains the estimated change, approximate uncertainty, and missing data. It cannot choose a different primary measure or override the calculated label. A shareable receipt shows the protocol, chart, and verdict without including the selfie.

The demo includes two clearly labeled synthetic 21-day histories, so judges can inspect a finished split-face example and an interim before/after example without spending API units. We also exercised the real file upload, asynchronous skin-analysis task, polling, scores, and PNG masks with one consented live capture.

**Honest limitations:** This is an early research prototype, not medical advice. Split-face measurements are average YouCam mask intensity in approximate geometric cheek patches, not clinically validated skin-area measurements. Performance across faces, skin tones, facial hair, lighting, products, and repeated days is unvalidated. Model-based intervals are approximate; repeated interim looks are exploratory. The simple anonymous cookie is not production authentication.

## Judge testing instructions

1. Follow the setup instructions in [README.md](README.md): Node 22+, `npm install`, `npm run setup`, then `npm run seed:demo` and `npm run dev`.
2. Leave `MOCK_YOUCAM=1` for a zero-unit test. Without an Anthropic key, deterministic mock agents use the same tool interfaces and show their logs.
3. Open `/demo` for the synthetic split-face trial; open the collagen trial on the home page for a before/after example. Expand the agent logs and use the receipt's PNG export.
4. To try the full capture flow, create and lock a new trial and upload a front-facing image. The browser runs checks before analysis. Mock mode does not call YouCam.
5. With your own YouCam key and `MOCK_YOUCAM=0`, a successful SD analysis with up to four concerns currently costs 9 units. Confirm pricing in the YouCam console first. Live Anthropic calls require an Anthropic key and may incur separate charges.

## Before submitting

- [ ] Register and complete the Devpost entry form; choose the Skin AI topic.
- [ ] Publish a source repository with the MIT license, or share a private repository with the address specified in the official rules. Verify no `.env`, API keys, personal photos, or signed URLs are included.
- [ ] Provide a working project URL, functioning demo, or test build and clear judge instructions; keep it available through the judging period. A production deployment has **not** been created by this project kit.
- [ ] Record the 1–3 minute walkthrough using [DEMO_SCRIPT.md](DEMO_SCRIPT.md); upload publicly to YouTube or Vimeo and paste the link into Devpost. Explain the YouCam API and show the working application on the intended device.
- [ ] Paste the description and testing instructions above, update them to match the actual demo, and verify all claims and links. Do not describe synthetic data as a real clinical outcome.
- [ ] Review permissions and rights for any visible faces, names, music, and third-party marks before publishing. Submit the entry yourself before the deadline.
