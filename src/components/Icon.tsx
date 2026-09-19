import React from 'react';

export type IconName =
  | 'arrow-left'
  | 'folder'
  | 'media'
  | 'text'
  | 'subtitle'
  | 'sticker'
  | 'filter'
  | 'transition'
  | 'effect'
  | 'adjust'
  | 'upload'
  | 'search'
  | 'grid'
  | 'play'
  | 'pause'
  | 'previous'
  | 'next'
  | 'fullscreen'
  | 'undo'
  | 'redo'
  | 'split'
  | 'trash'
  | 'crop'
  | 'copy'
  | 'lock'
  | 'unlock'
  | 'eye'
  | 'eye-off'
  | 'volume'
  | 'volume-off'
  | 'zoom-in'
  | 'zoom-out'
  | 'export'
  | 'help'
  | 'alert'
  | 'monitor'
  | 'chevron-down'
  | 'music'
  | 'image'
  | 'plus'
  | 'more-horizontal'
  | 'check'
  | 'close';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 18, className }: IconProps) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as 'round',
    strokeLinejoin: 'round' as 'round',
  };

  const content: Record<IconName, React.ReactNode> = {
    'arrow-left': <><path d="M15 18l-6-6 6-6" /><path d="M9 12h10" /></>,
    folder: <><path d="M3 6h6l2 2h10v10H3z" /><path d="M3 8V5h7l2 3" /></>,
    media: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M10 9l5 3-5 3z" /></>,
    text: <><path d="M5 5h14" /><path d="M12 5v14" /><path d="M8 19h8" /></>,
    subtitle: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 14h4M13 14h4M8 17h8" /></>,
    sticker: <><path d="M5 4h14v10l-5 6H5z" /><path d="M14 20v-6h5" /><circle cx="9" cy="10" r="1" /><circle cx="15" cy="10" r="1" /></>,
    filter: <><circle cx="9" cy="10" r="5" /><circle cx="15" cy="10" r="5" /><circle cx="12" cy="15" r="5" /></>,
    transition: <><rect x="3" y="6" width="7" height="12" rx="1" /><rect x="14" y="6" width="7" height="12" rx="1" /><path d="M9 12h6" /></>,
    effect: <><path d="M12 3l1.5 5 5 1.5-5 1.5-1.5 5-1.5-5-5-1.5 5-1.5z" /><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" /></>,
    adjust: <><path d="M4 7h7M15 7h5M4 17h4M12 17h8" /><circle cx="13" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
    upload: <><path d="M12 16V4" /><path d="M8 8l4-4 4 4" /><path d="M4 15v5h16v-5" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="M15 15l5 5" /></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    play: <path d="M8 5l11 7-11 7z" />,
    pause: <><path d="M9 5v14" /><path d="M15 5v14" /></>,
    previous: <><path d="M7 5v14" /><path d="M18 6l-8 6 8 6z" /></>,
    next: <><path d="M17 5v14" /><path d="M6 6l8 6-8 6z" /></>,
    fullscreen: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></>,
    undo: <><path d="M9 7L4 12l5 5" /><path d="M5 12h8a6 6 0 016 6" /></>,
    redo: <><path d="M15 7l5 5-5 5" /><path d="M19 12h-8a6 6 0 00-6 6" /></>,
    split: <><circle cx="7" cy="7" r="3" /><circle cx="7" cy="17" r="3" /><path d="M9.5 8.5L20 3M9.5 15.5L20 21M14 12h7" /></>,
    trash: <><path d="M4 7h16M9 3h6l1 4H8zM7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
    crop: <><path d="M7 3v14a2 2 0 002 2h12" /><path d="M3 7h14a2 2 0 012 2v12" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></>,
    unlock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 017.5-2" /></>,
    eye: <><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></>,
    'eye-off': <><path d="M3 3l18 18" /><path d="M10.6 6.2A9 9 0 0112 6c6 0 10 6 10 6a16 16 0 01-2.1 2.7M6.6 6.7C3.8 8.5 2 12 2 12s4 6 10 6c1.6 0 3-.4 4.2-1" /><path d="M9.9 9.9a3 3 0 004.2 4.2" /></>,
    volume: <><path d="M4 10h4l5-4v12l-5-4H4z" /><path d="M17 9a4 4 0 010 6M19 6a8 8 0 010 12" /></>,
    'volume-off': <><path d="M4 10h4l5-4v12l-5-4H4z" /><path d="M17 9l4 6M21 9l-4 6" /></>,
    'zoom-in': <><circle cx="10" cy="10" r="6" /><path d="M15 15l5 5M10 7v6M7 10h6" /></>,
    'zoom-out': <><circle cx="10" cy="10" r="6" /><path d="M15 15l5 5M7 10h6" /></>,
    export: <><path d="M12 4v11" /><path d="M8 8l4-4 4 4" /><rect x="4" y="14" width="16" height="7" rx="2" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.7 2.7 0 115 1.4c-.8 1-2.5 1.2-2.5 3.1M12 17h.01" /></>,
    alert: <><path d="M12 3L2.8 20h18.4z" /><path d="M12 9v5M12 17.5h.01" /></>,
    monitor: <><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8M12 18v3" /></>,
    'chevron-down': <path d="M7 10l5 5 5-5" />,
    music: <><path d="M9 18V6l10-2v12" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M4 17l5-5 4 4 2-2 5 4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    'more-horizontal': <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
    close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  };

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      {...common}
    >
      {content[name]}
    </svg>
  );
}
