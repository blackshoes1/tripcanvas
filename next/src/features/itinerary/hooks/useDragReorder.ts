'use client';
// 드래그 정렬 — 레거시 Sortable 설정(group·delay·filter)을 그대로 옮긴다.
//
// React와 SortableJS를 섞을 때의 함정: Sortable은 DOM 노드를 직접 옮기는데, 그 다음 렌더는
// 상태에서 다시 그린다. 두 사실이 어긋나면 목록이 뒤죽박죽 남는다.
// → 드래그 시작 시 원래 자식 순서를 기억했다가 드롭 순간 **DOM을 원상복구**하고,
//   실제 이동은 상태 갱신(불변 도메인 함수)에만 맡긴다. React가 유일한 진실이 된다.
import { useEffect } from 'react';

import Sortable from 'sortablejs';

export interface SpotDrop {
  from: { di: number; si: number };
  to: { di: number; index: number };
}

export interface DragReorderDeps {
  /** 이 값이 바뀔 때마다 인스턴스를 다시 만든다 (렌더로 DOM이 새로 만들어지므로) */
  deps: unknown;
  enabled?: boolean;
  onSpotDrop: (d: SpotDrop) => void;
  onDayDrop: (from: number, to: number) => void;
}

const OPTS = {
  animation: 150,
  delay: 120,            // 스크롤과 구분 — 살짝 누르고 있어야 드래그가 시작된다
  delayOnTouchOnly: true,
  ghostClass: 'itDragGhost',
  chosenClass: 'itDragChosen',
  preventOnFilter: false
} as const;

/** 드래그가 옮긴 DOM을 되돌린다 — 화면은 상태 갱신으로만 바뀌게 */
function restore(order: Element[], parent: HTMLElement): void {
  order.forEach(el => parent.appendChild(el));   // appendChild는 '옮기기'라 다른 목록에 간 노드도 돌아온다
}

export function useDragReorder({ deps, enabled = true, onSpotDrop, onDayDrop }: DragReorderDeps): void {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    const instances: Sortable[] = [];
    let snapshot: { parent: HTMLElement; order: Element[] } | null = null;
    const remember = (evt: Sortable.SortableEvent) => {
      snapshot = { parent: evt.from, order: Array.from(evt.from.children) };
    };
    const undo = () => {
      if (snapshot) { restore(snapshot.order, snapshot.parent); snapshot = null; }
    };

    document.querySelectorAll<HTMLElement>('.itSpotList').forEach(el => {
      instances.push(Sortable.create(el, {
        ...OPTS,
        group: 'itSpots',           // 일자 간 이동 허용
        filter: '.itSpotActs',      // 조작 버튼을 누른 건 드래그가 아니다
        onStart: remember,
        onEnd: evt => {
          const fromDi = Number(evt.from.dataset.di);
          const toDi = Number(evt.to.dataset.di);
          const { oldIndex, newIndex } = evt;
          undo();
          if (oldIndex == null || newIndex == null) return;
          if (!isFinite(fromDi) || !isFinite(toDi)) return;
          onSpotDrop({ from: { di: fromDi, si: oldIndex }, to: { di: toDi, index: newIndex } });
        }
      }));
    });

    const dayList = document.querySelector<HTMLElement>('.itCards');
    if (dayList) {
      instances.push(Sortable.create(dayList, {
        ...OPTS,
        handle: '.itDayHead',       // 카드 헤더를 잡아야 일자가 움직인다
        onStart: remember,
        onEnd: evt => {
          const { oldIndex, newIndex } = evt;
          undo();
          if (oldIndex == null || newIndex == null) return;
          onDayDrop(oldIndex, newIndex);
        }
      }));
    }

    return () => { instances.forEach(s => { try { s.destroy(); } catch { /* 이미 사라진 DOM */ } }); };
  }, [deps, enabled, onSpotDrop, onDayDrop]);
}
