/**
 * Compass's mark, taken apart so the setup flow can build it one confirmed step
 * at a time. The path data is copied from components/icons/compass-mark.tsx
 * rather than imported: that component paints all three paths inside one
 * flipped matrix, and a transform on a child path would be applied in that
 * flipped, 0.1333-scaled user space. Each part gets its own upright <svg> so
 * every transform here is plain CSS pixels.
 */
const VIEW_BOX = "0 0 700 642.88";
const FLIP = "matrix(1,0,0,1,0,0)";

const JIB_D =
  "M313.23,284.67 L386.77,358.21 L205.04,466.4 Z";
const SAIL_D =
  "M494.96,176.48 L386.77,358.21 L313.23,284.67 Z";
const HULL_D =
  "M50,321.44 a300,300 0 1,1 600,0 a300,300 0 1,1 -600,0 Z M88,321.44 a262,262 0 1,0 524,0 a262,262 0 1,0 -524,0 Z M338,73.44 h24 v48 h-24 Z M338,521.44 h24 v48 h-24 Z M102,309.44 h48 v24 h-48 Z M550,309.44 h48 v24 h-48 Z M330,321.44 a20,20 0 1,1 40,0 a20,20 0 1,1 -40,0 Z";

type Part = "hull" | "jib" | "sail";

/** Earned order. A hull is the first thing that exists, sails go up after. */
const BUILD_ORDER: readonly Part[] = ["hull", "jib", "sail"];
/** Paint order. The hull has to sit over the foot of both sails. */
const PAINT_ORDER: readonly Part[] = ["jib", "sail", "hull"];

export const BOAT_PARTS = BUILD_ORDER.length;

const PATH_OF: Record<Part, string> = { hull: HULL_D, jib: JIB_D, sail: SAIL_D };
const HOIST_OF: Record<Part, string> = {
  hull: "setup-hoist-hull",
  jib: "setup-hoist-jib",
  sail: "setup-hoist-sail",
};
const LAG = ["", "setup-lag-1", "setup-lag-2"];

/** How much of the boat a run of steps is worth, so a one-step queue still
    finishes with a whole boat and a skipped step never fakes one. */
export function boatBuilt(confirmed: number, total: number): number {
  if (total <= 0 || confirmed <= 0) return 0;
  return Math.min(BOAT_PARTS, Math.ceil((BOAT_PARTS * confirmed) / total));
}

export function SetupBoat({
  built,
  animate = "none",
  ghost,
  className,
}: {
  built: number;
  animate?: "none" | "latest" | "all";
  /** Draws the parts not yet earned at a whisper, so the shape the viewer is
      filling in is visible from the first screen and each hoist lands into
      something. Off at the finish, where a missing sail would only nag. */
  ghost?: boolean;
  className?: string;
}) {
  return (
    <span className={`setup-boat ${className ?? ""}`} aria-hidden>
      {PAINT_ORDER.map((part) => {
        const step = BUILD_ORDER.indexOf(part);
        const earned = step < built;
        if (!earned && !ghost) return null;
        const hoist = !earned
          ? "opacity-[0.11]"
          : animate === "all"
            ? `${HOIST_OF[part]} ${LAG[step]}`
            : animate === "latest" && step === built - 1
              ? HOIST_OF[part]
              : "";
        return (
          <svg key={part} viewBox={VIEW_BOX} fill="currentColor" className={`setup-boat-part ${hoist}`}>
            <g transform={FLIP}>
              <path d={PATH_OF[part]} />
            </g>
          </svg>
        );
      })}
    </span>
  );
}
