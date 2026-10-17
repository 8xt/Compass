import { Airplay } from "lucide-react";
import type { ReactNode } from "react";
import { isIosApp } from "@/lib/html5-only";
import { showAirPlayPicker } from "@/lib/ios-media";
import { BigButton } from "./big-button";

const IOS = isIosApp();

/**
 * iPad/iPhone overrides for player controls. Returns `undefined` to fall
 * through to the normal control, `null` to hide it, or a replacement.
 *
 * - fullscreen / window-controls / download: desktop window and file features.
 *   The app already fills the screen on iPad.
 * - cast: the desktop cast server (DLNA, Chromecast, Roku) is not in the iOS
 *   build; AirPlay is the system way to send video to a TV.
 */
export function iosControlOverride(id: string, t: (key: string) => string): ReactNode | undefined {
  if (!IOS) return undefined;
  switch (id) {
    case "fullscreen":
    case "window-controls":
    case "download":
    case "dvr":
    case "screenshot":
      return null;
    case "cast":
      return (
        <BigButton onClick={() => void showAirPlayPicker()} ariaLabel={t("AirPlay")} tooltip={t("AirPlay")}>
          <Airplay size={22} strokeWidth={1.9} />
        </BigButton>
      );
    default:
      return undefined;
  }
}
