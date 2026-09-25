# Fernway images

Every image in this folder was generated locally, on one machine, for Fernway (a fictional product in Run Hound's test
fixtures). `src/lib/images.ts` is the only place the app names these files, together with their alt text.

## The people are fictional

The eight portraits (`avatar-1.webp` to `avatar-8.webp`) were generated from text descriptions. They are not photos of
real people, no photo of anyone was used as input, and the names they go with (from `server/seed.mjs`) are made up.

## Model and settings

- **Model:** FLUX.2 [klein] 4B, [`black-forest-labs/FLUX.2-klein-4B`](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)
  (revision `e7b7dc27f91deacad38e78976d1f2b499d76a294`), a 4B rectified flow transformer with a Qwen3 text encoder.
- **License:** [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) (the model card's `license: apache-2.0`
  and the `LICENSE.md` shipped with the weights). The weights are not gated. Apache-2.0 lets us ship the outputs in
  this MIT repository. (The larger FLUX.2 [klein] 9B uses a non-commercial license and was not used.)
- **Software:** diffusers 0.40.0 (`Flux2KleinPipeline`), transformers 5.17.0, accelerate 1.15.0, torch 2.14.0+cu130,
  Python 3.12, Pillow 12.3.0.
- **Hardware:** NVIDIA GeForce RTX 5080 (16 GB), bf16 weights with `enable_model_cpu_offload()`, peak 8.7 GB VRAM,
  about 3 to 10 seconds per image.
- **Sampling:** 4 inference steps and `guidance_scale=1.0` (the settings the model card gives for this distilled
  model), seeded with `torch.Generator(device="cuda").manual_seed(seed)`. Width and height are multiples of 16.
- **Picking:** three seeds (four for a few files) per image. Each candidate was reviewed by eye for extra fingers,
  distorted faces, garbled text, logos and other artifacts, and the best one was kept.
- **Post-processing (Pillow):** Lanczos resize so the image covers the final size, centre crop, then WebP at quality
  80 (`method=6`). Every file is under 150 KB.
- **Reproducible:** regenerating with the prompts and seeds below reproduced every picked image pixel for pixel on the
  machine above, and the WebP files byte for byte. A different GPU, driver or library version may give slightly
  different pixels.

```python
pipe = Flux2KleinPipeline.from_pretrained("black-forest-labs/FLUX.2-klein-4B", dtype=torch.bfloat16)
pipe.enable_model_cpu_offload()
image = pipe(prompt=prompt, width=gen_width, height=gen_height, guidance_scale=1.0, num_inference_steps=4,
             generator=torch.Generator(device="cuda").manual_seed(seed)).images[0]
```

## Files

| File | Used as | Final size | Generated at | Seed | Steps | Size on disk |
| --- | --- | --- | --- | --- | --- | --- |
| `hero-art.webp` | `images.heroArt` | 1600x1000 | 1600x1008 | 3 | 4 | 26.9 KB |
| `auth-art.webp` | `images.authArt` | 900x1200 | 912x1200 | 1 | 4 | 17.4 KB |
| `feature-plan.webp` | `images.features[0]` | 800x600 | 1024x768 | 1 | 4 | 11.4 KB |
| `feature-timeline.webp` | `images.features[1]` | 800x600 | 1024x768 | 1 | 4 | 11.8 KB |
| `feature-insights.webp` | `images.features[2]` | 800x600 | 1024x768 | 1 | 4 | 8.8 KB |
| `onboarding.webp` | `images.onboarding` | 800x800 | 1024x1024 | 2 | 4 | 26.5 KB |
| `empty-state.webp` | `images.emptyState` | 600x400 | 1152x768 | 3 | 4 | 4.2 KB |
| `avatar-1.webp` | `images.avatars[0]` (Alex Rivera) | 256x256 | 768x768 | 2 | 4 | 5.1 KB |
| `avatar-2.webp` | `images.avatars[1]` (Priya Shah) | 256x256 | 768x768 | 2 | 4 | 5.8 KB |
| `avatar-3.webp` | `images.avatars[2]` (Marcus Chen) | 256x256 | 768x768 | 1 | 4 | 4.2 KB |
| `avatar-4.webp` | `images.avatars[3]` (Sofia Alvarez) | 256x256 | 768x768 | 2 | 4 | 7.5 KB |
| `avatar-5.webp` | `images.avatars[4]` (Jonah Okafor) | 256x256 | 768x768 | 3 | 4 | 4.5 KB |
| `avatar-6.webp` | `images.avatars[5]` (Emma Lindqvist) | 256x256 | 768x768 | 1 | 4 | 4.3 KB |
| `avatar-7.webp` | `images.avatars[6]` (Diego Morales) | 256x256 | 768x768 | 3 | 4 | 5.9 KB |
| `avatar-8.webp` | `images.avatars[7]` (Hana Sato) | 256x256 | 768x768 | 2 | 4 | 4.7 KB |
## Prompts

### `hero-art.webp`

Seed 3, 4 steps, generated at 1600x1008.

```text
Abstract 3D render of glossy floating shapes: smooth spheres, rounded capsules and gently curving ribbons in emerald green, deep teal and soft slate grey, layered with frosted translucent glass panels that refract the light, soft studio lighting, subtle reflections, smooth pale mint to cool white gradient background, calm and airy composition, premium modern SaaS website hero art, no text, no letters, no numbers, no logos, no watermark
```

### `auth-art.webp`

Seed 1, 4 steps, generated at 912x1200.

```text
Serene abstract landscape, layered rolling green hills receding into soft morning mist, delicate fern fronds in the foreground, soft diffused golden light from a pale sky, emerald, sage and teal palette, calm and minimal, smooth painterly digital illustration with depth through overlapping layers, no people, no buildings, no text, no letters, no numbers, no logos, no watermark
```

### `feature-plan.webp`

Seed 1, 4 steps, generated at 1024x768.

```text
An abstract kanban planning board seen from a three-quarter isometric angle: a rounded white board with three lanes, each lane holding a stack of small blank rounded cards with colored stripes instead of writing, one card lifted and floating above the board, small round checkmark tokens and pins, clean isometric 3D illustration, soft matte clay materials, rounded edges, soft ambient occlusion shadows, white and light slate grey with emerald green and teal accents, pale mint gradient background, minimal modern SaaS feature illustration, generous negative space, no text, no letters, no numbers, no logos, no watermark
```

### `feature-timeline.webp`

Seed 1, 4 steps, generated at 1024x768.

```text
An abstract project timeline: a long rounded track with milestone markers, horizontal colored bars of different lengths stacked like a gantt chart, small flags and diamond shapes on the track, clean isometric 3D illustration, soft matte clay materials, rounded edges, soft ambient occlusion shadows, white and light slate grey with emerald green and teal accents, pale mint gradient background, minimal modern SaaS feature illustration, generous negative space, no text, no letters, no numbers, no logos, no watermark
```

### `feature-insights.webp`

Seed 1, 4 steps, generated at 1024x768.

```text
Abstract analytics on a rounded white platform: rising bar chart columns, a smooth line graph ribbon, a donut chart and floating round data points, clean isometric 3D illustration, soft matte clay materials, rounded edges, soft ambient occlusion shadows, white and light slate grey with emerald green and teal accents, pale mint gradient background, minimal modern SaaS feature illustration, generous negative space, no text, no letters, no numbers, no logos, no watermark
```

### `onboarding.webp`

Seed 2, 4 steps, generated at 1024x1024.

```text
Friendly abstract illustration of a small creative studio team workspace seen from a slight angle: a shared light wooden table with three laptops, open notebooks, coffee mugs, potted plants and a pinboard with blank colorful sticky notes, three empty chairs, big window with soft daylight, emerald, teal, warm sand and slate palette, rounded shapes, modern flat vector illustration style with soft gradients, no people, no text, no letters, no numbers, no logos, no watermark
```

### `empty-state.webp`

Seed 3, 4 steps, generated at 1152x768.

```text
Minimal line art spot illustration of an empty wooden desk with a single potted plant and a small desk lamp, thin dark slate grey outlines with subtle flat emerald green fill accents, plain off-white background, lots of white space, simple, calm, modern, no text, no letters, no numbers, no logos, no watermark
```

### `avatar-1.webp`

Seed 2, 4 steps, generated at 768x768.

```text
A friendly Latino man in his early thirties with warm medium brown skin, short curly brown hair and a clean-shaven face, wearing a light blue denim shirt, soft sage green backdrop, professional corporate headshot photograph, head and shoulders, centered, looking at the camera, relaxed genuine smile, soft diffused window light, shallow depth of field, 85mm lens, natural skin texture, sharp focus on the eyes, plain seamless studio backdrop, no text, no letters, no numbers, no logos, no watermark
```

### `avatar-2.webp`

Seed 2, 4 steps, generated at 768x768.

```text
A South Asian woman in her mid thirties with long dark hair, wearing a teal blouse, soft blue grey backdrop, professional corporate headshot photograph, head and shoulders, centered, looking at the camera, relaxed genuine smile, soft diffused window light, shallow depth of field, 85mm lens, natural skin texture, sharp focus on the eyes, plain seamless studio backdrop, no text, no letters, no numbers, no logos, no watermark
```

### `avatar-3.webp`

Seed 1, 4 steps, generated at 768x768.

```text
An East Asian man in his mid forties with short neat black hair and thin rectangular glasses, wearing a light grey button-up shirt, light cool grey backdrop, professional corporate headshot photograph, head and shoulders, centered, looking at the camera, relaxed genuine smile, soft diffused window light, shallow depth of field, 85mm lens, natural skin texture, sharp focus on the eyes, plain seamless studio backdrop, no text, no letters, no numbers, no logos, no watermark
```

### `avatar-4.webp`

Seed 2, 4 steps, generated at 768x768.

```text
A Black woman in her late twenties with natural curly hair, small gold stud earrings, wearing a mustard yellow cardigan over a white top, warm beige backdrop, professional corporate headshot photograph, head and shoulders, centered, looking at the camera, relaxed genuine smile, soft diffused window light, shallow depth of field, 85mm lens, natural skin texture, sharp focus on the eyes, plain seamless studio backdrop, no text, no letters, no numbers, no logos, no watermark
```

### `avatar-5.webp`

Seed 3, 4 steps, generated at 768x768.

```text
A Black man in his sixties with short grey hair and a short grey beard, wearing a dark green knit polo shirt, soft taupe backdrop, professional corporate headshot photograph, head and shoulders, centered, looking at the camera, relaxed genuine smile, soft diffused window light, shallow depth of field, 85mm lens, natural skin texture, sharp focus on the eyes, plain seamless studio backdrop, no text, no letters, no numbers, no logos, no watermark
```

### `avatar-6.webp`

Seed 1, 4 steps, generated at 768x768.

```text
A white woman in her late fifties with short silver hair, wearing a charcoal blazer over a black top, muted cream backdrop, professional corporate headshot photograph, head and shoulders, centered, looking at the camera, relaxed genuine smile, soft diffused window light, shallow depth of field, 85mm lens, natural skin texture, sharp focus on the eyes, plain seamless studio backdrop, no text, no letters, no numbers, no logos, no watermark
```

### `avatar-7.webp`

Seed 3, 4 steps, generated at 768x768.

```text
A Latino man in his late forties with tan skin, salt-and-pepper hair and a short neat salt-and-pepper beard, wearing a charcoal henley shirt, pale mint backdrop, professional corporate headshot photograph, head and shoulders, centered, looking at the camera, relaxed genuine smile, soft diffused window light, shallow depth of field, 85mm lens, natural skin texture, sharp focus on the eyes, plain seamless studio backdrop, no text, no letters, no numbers, no logos, no watermark
```

### `avatar-8.webp`

Seed 2, 4 steps, generated at 768x768.

```text
A Southeast Asian woman in her early forties with a shoulder-length black bob haircut, wearing a white linen shirt, dusty rose backdrop, professional corporate headshot photograph, head and shoulders, centered, looking at the camera, relaxed genuine smile, soft diffused window light, shallow depth of field, 85mm lens, natural skin texture, sharp focus on the eyes, plain seamless studio backdrop, no text, no letters, no numbers, no logos, no watermark
```
