/**
 * The only place image URLs are named (CONTRACT.md "Images"). Files live in public/images/ and are served by
 * Fernway itself: WebP images generated locally with FLUX.2 [klein] 4B (Apache-2.0; public/images/README.md has
 * the prompts and seeds). `width`/`height` are each file's intrinsic size, so pages can reserve the space.
 */
export interface ImageAsset {
  src: string;
  /** Meaningful alternative text. Pass alt="" at the call site only where the image is purely decorative. */
  alt: string;
  width: number;
  height: number;
}

const img = (file: string, alt: string, width: number, height: number): ImageAsset => ({
  src: `/images/${file}`,
  alt,
  width,
  height,
});

/** Avatar portraits, in the order of the seeded members (server/seed.mjs: member.avatar is the index). */
const avatarNames = [
  "Alex Rivera",
  "Priya Shah",
  "Marcus Chen",
  "Sofia Alvarez",
  "Jonah Okafor",
  "Emma Lindqvist",
  "Diego Morales",
  "Hana Sato",
] as const;

export const images = {
  heroArt: img(
    "hero-art.webp",
    "Glossy emerald and slate spheres floating among curved ribbons of frosted glass",
    1600,
    1000,
  ),
  authArt: img(
    "auth-art.webp",
    "Layered green hills under a soft morning sky, with fern fronds in the foreground",
    900,
    1200,
  ),
  features: [
    img(
      "feature-plan.webp",
      "Planning board with stacks of task cards, one card lifted into place and check marks on finished work",
      800,
      600,
    ),
    img("feature-timeline.webp", "Project timeline with milestone flags and phase bars of different lengths", 800, 600),
    img("feature-insights.webp", "Analytics with rising bar columns, a trend line and a donut chart", 800, 600),
  ],
  avatars: avatarNames.map((name, i) => img(`avatar-${i + 1}.webp`, `Portrait of ${name}`, 256, 256)),
  onboarding: img(
    "onboarding.webp",
    "A shared studio table set with three laptops, notebooks and coffee, ready for the team",
    800,
    800,
  ),
  emptyState: img("empty-state.webp", "Line drawing of an empty desk with a potted plant and a lamp", 600, 400),
} as const satisfies Record<string, ImageAsset | readonly ImageAsset[]>;
