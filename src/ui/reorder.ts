import type { DragEvent } from 'react';

// Drag-to-reorder for horizontal lists (pattern tabs, song entries). Dropping on
// the left half of an item puts the dragged one before it, the right half after.

const isBefore = (e: DragEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2;
};

/** Final index for an item dragged from `from` and dropped on the item at `over`. */
export function dropIndex(e: DragEvent<HTMLElement>, from: number, over: number): number {
  const pos = isBefore(e) ? over : over + 1;
  return from < pos ? pos - 1 : pos;
}

/** Props for one draggable item; `type` keeps different lists from accepting each other's items. */
export function reorderProps(type: string, index: number, onMove: (from: number, to: number) => void) {
  const clear = (el: HTMLElement) => el.classList.remove('drop-before', 'drop-after');
  return {
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.setData(type, String(index));
      e.dataTransfer.effectAllowed = 'move';
      e.currentTarget.classList.add('dragging');
    },
    onDragEnd: (e: DragEvent<HTMLElement>) => e.currentTarget.classList.remove('dragging'),
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes(type)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const before = isBefore(e);
      e.currentTarget.classList.toggle('drop-before', before);
      e.currentTarget.classList.toggle('drop-after', !before);
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => clear(e.currentTarget),
    onDrop: (e: DragEvent<HTMLElement>) => {
      clear(e.currentTarget);
      const raw = e.dataTransfer.getData(type);
      if (raw === '') return;
      e.preventDefault();
      const from = Number(raw);
      const to = dropIndex(e, from, index);
      if (to !== from) onMove(from, to);
    },
  };
}
