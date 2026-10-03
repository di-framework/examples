import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GameTimeline } from '@/components/game-timeline';
import { PlayDrawer } from '@/components/play-drawer';
import { gameTitle, playById, plays } from '@/data/game';
import { useReport } from '@/state/report-state';
import { palette } from '@/theme/palette';

export default function HomeScreen() {
  const { marks } = useReport();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const markedIds = useMemo(() => new Set(marks.map((mark) => mark.playId)), [marks]);
  const selected = selectedId ? playById(selectedId) : null;
  const outlierCount = plays.filter((play) => play.outlier).length;

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={{ flex: 1, backgroundColor: palette.field }}
    >
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
            <Text style={{ color: palette.muted, fontSize: 12, fontWeight: '700' }}>
              VIDEO TIMELINE
            </Text>
            <Text style={{ color: palette.ink, fontSize: 28, fontWeight: '700', marginTop: 4 }}>
              {gameTitle}
            </Text>
            <Text style={{ color: palette.muted, fontSize: 14, marginTop: 8, lineHeight: 20 }}>
              {outlierCount} amber marks are timings outside a player&apos;s own range. Every other
              tick is a plate appearance. Open a mark, then assign who the report is for.
            </Text>
          </View>
          <GameTimeline
            mode="home"
            markedIds={markedIds}
            selectedId={selectedId}
            onPressMark={setSelectedId}
          />
        </ScrollView>
        {selected ? (
          <PlayDrawer key={selected.id} play={selected} onClose={() => setSelectedId(null)} />
        ) : null}
      </View>
    </SafeAreaView>
  );
}
