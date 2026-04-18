import type { EntityType } from '@/lib/types';

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

export function chipColorVar(type: EntityType): string {
  const map: Record<EntityType, string> = {
    CONCEPT: 'var(--color-chip-concept)',
    PERSON: 'var(--color-chip-person)',
    TOOL: 'var(--color-chip-tool)',
    ORGANIZATION: 'var(--color-chip-org)',
    PLACE: 'var(--color-chip-place)',
    EVENT: 'var(--color-chip-event)',
    WORK: 'var(--color-chip-work)',
    TECHNIQUE: 'var(--color-chip-technique)',
    JARGON: 'var(--color-chip-jargon)',
  };
  return map[type] ?? 'var(--color-chip-default)';
}

export function chipLabel(type: EntityType): string {
  const map: Record<EntityType, string> = {
    CONCEPT: 'Concept',
    PERSON: 'Person',
    TOOL: 'Tool',
    ORGANIZATION: 'Org',
    PLACE: 'Place',
    EVENT: 'Event',
    WORK: 'Work',
    TECHNIQUE: 'Technique',
    JARGON: 'Jargon',
  };
  return map[type] ?? 'Term';
}
