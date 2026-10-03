import { Pressable, ScrollView, Text, View } from 'react-native';

import { clock, inningLabel, plays, resultAbbrev } from '@/data/game';
import type { HalfInning, PlateAppearance } from '@/data/types';
import { palette } from '@/theme/palette';

type Band = {
  key: string;
  inning: number;
  half: HalfInning;
  plays: PlateAppearance[];
};

type GameTimelineProps = {
  mode: 'home' | 'report';
  markedIds: ReadonlySet<string>;
  selectedId?: string | null;
  onPressMark?: (playId: string) => void;
};

function bands(): Band[] {
  const grouped: Band[] = [];
  for (const play of plays) {
    const key = `${play.inning}-${play.half}`;
    const last = grouped[grouped.length - 1];
    if (last && last.key === key) last.plays.push(play);
    else grouped.push({ key, inning: play.inning, half: play.half, plays: [play] });
  }
  return grouped;
}

export function GameTimeline({ mode, markedIds, selectedId, onPressMark }: GameTimelineProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      testID="game-timeline"
      style={{ width: '100%', flexGrow: 0 }}
      contentContainerStyle={{ paddingRight: 12 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
        {bands().map((band) => (
          <View
            key={band.key}
            style={{
              backgroundColor: band.half === 'top' ? palette.bandTop : palette.bandBottom,
              paddingTop: 8,
              paddingBottom: 10,
              paddingHorizontal: 6,
              borderRightWidth: 1,
              borderRightColor: palette.field,
            }}
          >
            <Text style={{ color: palette.ink, fontSize: 12, fontWeight: '700' }}>
              {inningLabel(band.inning, band.half)}
            </Text>
            <Text style={{ color: palette.muted, fontSize: 10, marginBottom: 8 }}>
              {clock(band.plays[0]?.videoStart ?? 0)}–
              {clock((band.plays[band.plays.length - 1]?.videoStart ?? 0) + 40)}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              {band.plays.map((play) => (
                <Tick
                  key={play.id}
                  play={play}
                  mode={mode}
                  marked={markedIds.has(play.id)}
                  selected={selectedId === play.id}
                  onPressMark={onPressMark}
                />
              ))}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Tick({
  play,
  mode,
  marked,
  selected,
  onPressMark,
}: {
  play: PlateAppearance;
  mode: 'home' | 'report';
  marked: boolean;
  selected: boolean;
  onPressMark?: (playId: string) => void;
}) {
  const outlier = play.outlier;
  const showMark = mode === 'home' ? outlier !== null : marked;
  const dimmed = mode === 'report' && !marked;
  const body = (
    <View
      style={{
        width: 52,
        alignItems: 'center',
        justifyContent: 'flex-end',
        minHeight: 128,
        opacity: dimmed ? 0.28 : 1,
      }}
    >
      {showMark && outlier ? (
        <Text style={{ color: palette.mark, fontSize: 10, fontWeight: '700', marginBottom: 4 }}>
          {outlier.badge}
        </Text>
      ) : (
        <View style={{ height: 14 }} />
      )}
      {showMark ? (
        <View
          style={{
            padding: 2,
            borderRadius: 12,
            backgroundColor: selected ? palette.ink : 'transparent',
            marginBottom: 4,
          }}
        >
          <View
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: palette.mark,
            }}
          />
        </View>
      ) : (
        <View style={{ height: 18, marginBottom: 4 }} />
      )}
      <View
        style={{
          width: 2,
          height: showMark ? 46 : 26,
          backgroundColor: showMark ? palette.mark : palette.tick,
        }}
      />
      <Text
        style={{
          color: showMark ? palette.ink : palette.muted,
          fontSize: 11,
          marginTop: 6,
          fontWeight: showMark ? '700' : '500',
        }}
      >
        {resultAbbrev(play.result)}
      </Text>
      {marked && mode === 'home' ? (
        <Text style={{ color: palette.mark, fontSize: 9, marginTop: 2 }}>On report</Text>
      ) : (
        <View style={{ height: 12 }} />
      )}
    </View>
  );

  if (mode === 'home' && outlier && onPressMark) {
    return (
      <Pressable
        testID={`mark-${play.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${inningLabel(play.inning, play.half)} ${outlier.title} ${outlier.badge}`}
        onPress={() => onPressMark(play.id)}
      >
        {body}
      </Pressable>
    );
  }

  return body;
}
