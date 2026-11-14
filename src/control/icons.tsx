/** Small inline SVG icon set for the console chrome (stroke icons, 24×24, currentColor). */
import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  o2: (
    <>
      <circle cx="9" cy="12" r="5" />
      <path d="M16 15.5c0-1.4 3-2.2 3-.4 0 1.2-3 2.6-3 3.4h3.5" />
    </>
  ),
  radiation: (
    <>
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 3a9 9 0 0 1 7.8 4.5L14 11M4.2 7.5A9 9 0 0 1 12 3M10 11 4.2 7.5M12 21a9 9 0 0 1-7.8-4.5L10 13.4M19.8 16.5A9 9 0 0 1 12 21v-6.6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  mast: (
    <>
      <path d="M12 22V9M8 22h8" />
      <path d="M5 3h14l-2 6H7z" />
      <path d="M9.5 3 9 9M14.5 3l.5 6M6 6h12" />
    </>
  ),
  antenna: (
    <>
      <path d="M12 12v10M9 22h6" />
      <path d="M8.5 8.5a5 5 0 0 1 7 0M5.6 5.6a9 9 0 0 1 12.8 0" />
      <circle cx="12" cy="11.5" r="1.3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 21c0-9 6-15 15-16-1 9-6 15-15 16z" />
      <path d="M5 21 13 13" />
    </>
  ),
  radio: (
    <>
      <rect x="3" y="8" width="18" height="13" rx="2" />
      <path d="M7 8 17 3" />
      <circle cx="15.5" cy="14.5" r="3" />
      <path d="M6.5 12.5h4M6.5 16.5h4" />
    </>
  ),
  satellite: (
    <>
      <path d="m13 7 4 4-6 6-4-4z" />
      <path d="m15 5 2-2 4 4-2 2M9 19l-2 2-4-4 2-2" />
      <path d="M16 16a4 4 0 0 1-2 3M19 16a7 7 0 0 1-4 6" />
    </>
  ),
  screen: (
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <path d="m10 8.5 4 2-4 2z" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </>
  ),
  signal: <path d="M4 20v-3M9 20v-7M14 20V9M19 20V4" />,
  user: (
    <>
      <circle cx="12" cy="9" r="5" />
      <path d="M9.5 8.5h5M4 22c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5" />
    </>
  ),
  play: <path d="M7 4v16l13-8z" />,
  next: <path d="M5 4v16l11-8zM19 4v16" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
  restart: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 3v6h6" />
    </>
  ),
  check: <path d="m4 12 5 5L20 6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  alert: (
    <>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4M12 17v.5" />
    </>
  ),
  map: (
    <>
      <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
      <path d="M9 3v15M15 6v15" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.5M3 12h.5M3 18h.5" />,
  camera: (
    <>
      <path d="M3 8h4l2-3h6l2 3h4v12H3z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  star: <path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />,
  lightning: <path d="M11 3 6 13h5l-1 8 7-11h-5l2-7z" />,
  home: (
    <>
      <path d="M3 11 12 4l9 7" />
      <path d="M6 9.5V20h12V9.5" />
    </>
  ),
  shadow: (
    <>
      <path d="M2 20h20" />
      <path d="M4 20 10 8l4 6 2-3 5 9" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3h6M10 3v6L4.5 19a1.4 1.4 0 0 0 1.2 2h12.6a1.4 1.4 0 0 0 1.2-2L14 9V3" />
      <path d="M7 15h10" />
    </>
  ),
  thumb: (
    <>
      <path d="M7 11v10H3V11z" />
      <path d="M7 11 11 3c1.7 0 3 1.3 3 3v3h5.5a2 2 0 0 1 2 2.3l-1.3 7.5a2 2 0 0 1-2 1.7H7" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5M12 17v.5" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <path d="M14 14h3v3M21 14v.5M14 21h.5M17 21h4v-4" />
    </>
  ),
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 20, className, strokeWidth = 1.8 }: { name: string; size?: number | string; className?: string; strokeWidth?: number }) {
  return (
    <svg
      className={className ? `ico ${className}` : 'ico'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {P[name] ?? P.alert}
    </svg>
  );
}
