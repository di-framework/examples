import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  clock,
  formatSeriesValue,
  inningLabel,
  metricValue,
  playById,
  playerById,
  plays,
  resultDetail,
  seriesMetaFor,
} from '@/data/game';
import type { PlateAppearance } from '@/data/types';
import { useReport } from '@/state/report-state';
import { palette } from '@/theme/palette';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function PlayerCardScreen() {
  const params = useLocalSearchParams<{ playerId?: string | string[] }>();
  const requestedId = firstParam(params.playerId);
  const { marks, playerNotes, setPlayerNote } = useReport();
  const markedPlayerIds = useMemo(() => {
    const ids: string[] = [];
    for (const mark of marks) {
      if (!ids.includes(mark.playerId)) ids.push(mark.playerId);
    }
    return ids;
  }, [marks]);
  const selectedId =
    requestedId && markedPlayerIds.includes(requestedId) ? requestedId : markedPlayerIds[0];

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={{ flex: 1, backgroundColor: palette.field }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ color: palette.muted, fontSize: 12, fontWeight: '700' }}>PLAYER CARD</Text>
        <Text style={{ color: palette.ink, fontSize: 28, fontWeight: '700', marginTop: 4 }}>
          One athlete
        </Text>
        {markedPlayerIds.length === 0 || !selectedId ? (
          <Text
            testID="player-empty"
            style={{ color: palette.muted, fontSize: 15, marginTop: 12, lineHeight: 22 }}
          >
            Mark a play on the game chart and assign a player. This card shows that player only.
          </Text>
        ) : (
          <>
            {markedPlayerIds.length > 1 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 }}>
                {markedPlayerIds.map((id) => {
                  const choice = playerById(id);
                  const selected = id === selectedId;
                  return (
                    <Pressable
                      key={id}
                      testID={`choose-${id}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => router.setParams({ playerId: id })}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 10,
                        borderRadius: 8,
                        backgroundColor: selected ? palette.mark : palette.chip,
                        marginRight: 8,
                        marginBottom: 8,
                      }}
                    >
                      <Text
                        style={{
                          color: selected ? palette.markInk : palette.ink,
                          fontSize: 13,
                          fontWeight: '700',
                        }}
                      >
                        {choice.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <Card
              playerId={selectedId}
              marks={marks}
              note={playerNotes[selectedId] ?? ''}
              onNote={(note) => setPlayerNote(selectedId, note)}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({
  playerId,
  marks,
  note,
  onNote,
}: {
  playerId: string;
  marks: { playId: string; playerId: string }[];
  note: string;
  onNote: (note: string) => void;
}) {
  const player = playerById(playerId);
  const meta = seriesMetaFor(player.series);
  const theirs = marks.filter((mark) => mark.playerId === player.id);
  const markedPlayIds = new Set(theirs.map((mark) => mark.playId));
  const points = plays.flatMap((play) => {
    const value = metricValue(play, player);
    return value === null ? [] : [{ play, value }];
  });
  const values = points.map((point) => point.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max - min || 1;

  return (
    <View testID="player-card">
      <Text style={{ color: palette.ink, fontSize: 22, fontWeight: '700', marginTop: 16 }}>
        {player.name} #{player.number}
      </Text>
      <Text style={{ color: palette.muted, fontSize: 14, marginTop: 4 }}>
        {player.position} · {meta.title}
      </Text>
      <Text style={{ color: palette.ink, fontSize: 13, fontWeight: '700', marginTop: 16 }}>
        Note
      </Text>
      <TextInput
        testID="player-note"
        value={note}
        onChangeText={onNote}
        multiline
        placeholder="Write the one thing this player should take from these plays."
        placeholderTextColor={palette.faint}
        style={{
          marginTop: 8,
          minHeight: 88,
          borderWidth: 1,
          borderColor: palette.line,
          borderRadius: 8,
          padding: 12,
          color: palette.ink,
          fontSize: 15,
          backgroundColor: palette.card,
          textAlignVertical: 'top',
        }}
      />
      <Text style={{ color: palette.ink, fontSize: 16, fontWeight: '700', marginTop: 18 }}>
        {meta.title} across the game
      </Text>
      <Text style={{ color: palette.muted, fontSize: 13, marginTop: 4, lineHeight: 18 }}>
        {points.length
          ? `${formatSeriesValue(player.series, min)} to ${formatSeriesValue(player.series, max)}. Amber bars are the plays on this card.`
          : 'No samples of this series in the game.'}
      </Text>
      <ScrollView
        horizontal
        testID="series-chart"
        style={{ width: '100%', flexGrow: 0, marginTop: 12 }}
        contentContainerStyle={{ alignItems: 'flex-end', paddingBottom: 4 }}
      >
        {points.map((point) => {
          const marked = markedPlayIds.has(point.play.id);
          const height = 10 + ((point.value - min) / span) * 78;
          return (
            <View
              key={point.play.id}
              testID={`series-${point.play.id}`}
              style={{ width: 36, alignItems: 'center', marginRight: 6 }}
            >
              {marked ? (
                <Text style={{ color: palette.mark, fontSize: 9, marginBottom: 4 }}>
                  {formatSeriesValue(player.series, point.value)}
                </Text>
              ) : (
                <View style={{ height: 14 }} />
              )}
              <View
                style={{
                  width: 14,
                  height,
                  borderRadius: 3,
                  backgroundColor: marked ? palette.mark : palette.bar,
                }}
              />
            </View>
          );
        })}
      </ScrollView>
      <Text style={{ color: palette.ink, fontSize: 16, fontWeight: '700', marginTop: 20 }}>
        Marked plays
      </Text>
      {theirs.map((mark) => (
        <MarkedPlay key={mark.playId} play={playById(mark.playId)} player={player} />
      ))}
    </View>
  );
}

function MarkedPlay({
  play,
  player,
}: {
  play: PlateAppearance;
  player: ReturnType<typeof playerById>;
}) {
  const value = metricValue(play, player);
  const meta = seriesMetaFor(player.series);
  const aboutThem = play.outlier?.playerId === player.id;
  return (
    <View
      testID={`marked-play-${play.id}`}
      style={{
        marginTop: 10,
        backgroundColor: palette.card,
        borderRadius: 8,
        padding: 12,
        borderWidth: 1,
        borderColor: palette.line,
      }}
    >
      <Text style={{ color: palette.ink, fontSize: 15, fontWeight: '700' }}>
        {inningLabel(play.inning, play.half)} · {clock(play.videoStart)}
      </Text>
      <Text style={{ color: palette.muted, fontSize: 14, marginTop: 4 }}>
        {resultDetail(play.result)}
      </Text>
      <Text style={{ color: palette.ink, fontSize: 14, marginTop: 4 }}>
        {aboutThem && play.outlier ? `${play.outlier.title}. ` : ''}
        {value === null
          ? `No ${meta.title.toLowerCase()} sample on this play.`
          : `${meta.title} ${formatSeriesValue(player.series, value)}`}
      </Text>
    </View>
  );
}
