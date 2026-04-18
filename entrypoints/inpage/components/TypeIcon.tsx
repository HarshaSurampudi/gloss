import type { EntityType } from '@/lib/types';

interface IconProps {
  size?: number;
  className?: string;
  style?: Record<string, string>;
}

const base = (size = 12) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.75,
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
});

const Concept = (p: IconProps) => (
  <svg {...base(p.size)} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
  </svg>
);

const Person = (p: IconProps) => (
  <svg {...base(p.size)} {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

const Tool = (p: IconProps) => (
  <svg {...base(p.size)} {...p}>
    <path d="M14.7 6.3a5 5 0 1 0-4.4 8.4l-6 6 1.4 1.4 6-6a5 5 0 0 0 8.4-4.4l-3 3-2.4-.6-.6-2.4z" />
  </svg>
);

const Org = (p: IconProps) => (
  <svg {...base(p.size)} {...p}>
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <path d="M8 8h2M14 8h2M8 12h2M14 12h2M8 16h2M14 16h2" />
  </svg>
);

const Place = (p: IconProps) => (
  <svg {...base(p.size)} {...p}>
    <path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

const Event = (p: IconProps) => (
  <svg {...base(p.size)} {...p}>
    <rect x="4" y="5" width="16" height="16" rx="1.5" />
    <path d="M4 9h16M9 3v4M15 3v4" />
  </svg>
);

const Work = (p: IconProps) => (
  <svg {...base(p.size)} {...p}>
    <path d="M5 4h12a2 2 0 0 1 2 2v14l-4-3-4 3-4-3-4 3V6a2 2 0 0 1 2-2z" />
  </svg>
);

const Technique = (p: IconProps) => (
  <svg {...base(p.size)} {...p}>
    <path d="M7 17l-4-4 4-4M17 7l4 4-4 4M14 4l-4 16" />
  </svg>
);

const Jargon = (p: IconProps) => (
  <svg {...base(p.size)} {...p}>
    <path d="M4 7h16M4 12h10M4 17h16" />
  </svg>
);

export function TypeIcon({ type, size, className, style }: IconProps & { type: EntityType }) {
  const props = { size, className, style };
  switch (type) {
    case 'PERSON': return <Person {...props} />;
    case 'TOOL': return <Tool {...props} />;
    case 'ORGANIZATION': return <Org {...props} />;
    case 'PLACE': return <Place {...props} />;
    case 'EVENT': return <Event {...props} />;
    case 'WORK': return <Work {...props} />;
    case 'TECHNIQUE': return <Technique {...props} />;
    case 'JARGON': return <Jargon {...props} />;
    case 'CONCEPT':
    default:
      return <Concept {...props} />;
  }
}
