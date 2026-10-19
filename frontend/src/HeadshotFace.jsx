import { useEffect, useState } from "react";
import { espnHeadshotUrl } from "./espnPlayer.js";
import { initialsOf, toneFromHex } from "./studyPhotos.js";

// A round ESPN headshot ringed in the school's colour (a lighter shade of it on dark pages); initials in the same
// ring when there's no ESPN picture for the player, or it doesn't load.
export default function HeadshotFace({ espnId, name, color, size = 44 }) {
  const url = espnHeadshotUrl(espnId);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <span className="study-face study-tc" style={{ ...(toneFromHex(color) || {}), width: size, height: size, fontSize: Math.round(size * 0.3) }} aria-hidden="true">
      {url && !failed ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span>{initialsOf(name)}</span>}
    </span>
  );
}
