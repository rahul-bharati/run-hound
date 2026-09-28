import Image from "next/image";
import bookings from "@/assets/runs/0.6.0/kennel/double-submit-bookings.png";
import { home } from "@/content/home";

/**
 * The evidence trio's page (DESIGN.md §3.1 block 2, B3): R1's crop of the double-submit evidence frame from the Kennel
 * 0.6.0 run, Kennel's "Your bookings" rows with both saved copies and their red markers, the crop box recorded in the
 * extract (content/runs/kennel-0.6.0.json "crops"). Shown at the trio's column width, so its text is at least 11 CSS px
 * from 1024 px, and never wider than 2x its 304 px (home.css, .hm-crop-img). The run has no sharper frame of this
 * moment: the crop comes from the finding's GIF, 1200 px wide, a 0.7317 scale of the 1280 px page (the extract's
 * "source" and "pageScale"), so a 2x crop would take a new run captured at a device scale factor of 2. A static
 * import, so it lives apart from the trio, which unit tests render in plain Node.
 */
export function BookingsCrop() {
  return (
    <Image
      src={bookings}
      alt={home.how.proof.page.alt}
      sizes="(min-width: 40rem) 38rem, 100vw"
      quality={90}
      className="hm-crop-img"
    />
  );
}
