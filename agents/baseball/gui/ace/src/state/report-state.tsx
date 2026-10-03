import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

import type { Mark } from '@/data/types';

type ReportContextValue = {
  marks: Mark[];
  gameNote: string;
  playerNotes: Record<string, string>;
  setGameNote: (note: string) => void;
  setPlayerNote: (playerId: string, note: string) => void;
  markPlay: (playId: string, playerId: string) => void;
  unmarkPlay: (playId: string) => void;
};

const ReportContext = createContext<ReportContextValue | null>(null);

const defaultGameNote =
  'Stop on the marks. Quiet ticks are plate appearances with ordinary timings. Rewrite this before you hand the report to the staff.';

export function ReportProvider({ children }: { children: ReactNode }) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [gameNote, setGameNote] = useState(defaultGameNote);
  const [playerNotes, setPlayerNotes] = useState<Record<string, string>>({});

  const value = useMemo<ReportContextValue>(
    () => ({
      marks,
      gameNote,
      playerNotes,
      setGameNote,
      setPlayerNote: (playerId, note) => {
        setPlayerNotes((current) => ({ ...current, [playerId]: note }));
      },
      markPlay: (playId, playerId) => {
        setMarks((current) => [
          ...current.filter((mark) => mark.playId !== playId),
          { playId, playerId },
        ]);
      },
      unmarkPlay: (playId) => {
        setMarks((current) => current.filter((mark) => mark.playId !== playId));
      },
    }),
    [marks, gameNote, playerNotes],
  );

  return <ReportContext.Provider value={value}>{children}</ReportContext.Provider>;
}

export function useReport(): ReportContextValue {
  const value = useContext(ReportContext);
  if (!value) throw new Error('useReport must be used inside ReportProvider');
  return value;
}
