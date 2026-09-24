import Image from "next/image";
import type { CSSProperties } from "react";
import type { Screen } from "@/components/screens";

/** A region of a 1920 x 1080 capture, in CSS px of that window (the master is 2x). */
type Crop = { left: number; top?: number; width: number; height: number };

/**
 * A real Run Hound screenshot in a dark window frame. `sizes` must describe the rendered width so next/image picks
 * the right file from the srcset; `preload` only for the hero. The blur placeholder and the static import's
 * width and height keep the layout from shifting while it loads.
 *
 * `phoneCrop` shows only that region on phones (below 640 px), zoomed to the frame's width, so the UI text stays
 * readable instead of shrinking the whole 1920 px window to 350 px. It is the same image, so the 4K master
 * pays off there: a 3x phone asks for the 3840 px file.
 */
export function Screenshot({
  screen,
  sizes,
  preload = false,
  phoneCrop,
  className = "",
}: {
  screen: Screen;
  sizes: string;
  preload?: boolean;
  phoneCrop?: Crop;
  className?: string;
}) {
  const zoom = phoneCrop ? 1920 / phoneCrop.width : 1;
  const cropStyle = phoneCrop
    ? ({
        "--crop-ar": `${phoneCrop.width} / ${phoneCrop.height}`,
        "--crop-w": `${zoom * 100}%`,
        "--crop-ml": `${(-phoneCrop.left / phoneCrop.width) * 100}%`,
        "--crop-mt": `${(-(phoneCrop.top ?? 0) / phoneCrop.width) * 100}%`,
      } as CSSProperties)
    : undefined;
  // On phones the frame is the viewport minus the 16 px gutters; the image inside it is `zoom` times wider.
  const allSizes = phoneCrop
    ? `(max-width: 639px) calc(${(zoom * 100).toFixed(1)}vw - ${Math.round(32 * zoom)}px), ${sizes}`
    : sizes;

  return (
    <div
      className={`overflow-hidden rounded-[14px] border border-line-strong bg-bg-deep shadow-[0_40px_80px_-24px_rgba(0,0,0,0.75),0_0_0_1px_rgba(94,230,163,0.04)] ${className}`}
    >
      <div aria-hidden="true" className="flex items-center gap-1.5 border-b border-line px-3.5 py-2.5">
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
      </div>
      <div style={cropStyle} className={phoneCrop ? "overflow-hidden max-sm:aspect-(--crop-ar)" : undefined}>
        <Image
          src={screen.src}
          alt={screen.alt}
          sizes={allSizes}
          quality={90}
          placeholder="blur"
          preload={preload}
          className={`block h-auto w-full ${
            phoneCrop ? "max-sm:mt-(--crop-mt) max-sm:ml-(--crop-ml) max-sm:w-(--crop-w) max-sm:max-w-none" : ""
          }`}
        />
      </div>
    </div>
  );
}
