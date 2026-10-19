import { useEffect, useState } from "react";

// True on a phone-width screen; follows the screen turning or the window resizing.
export function useIsPhone(maxWidth = 720) {
  const query = `(max-width: ${maxWidth}px)`;
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setPhone(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return phone;
}
