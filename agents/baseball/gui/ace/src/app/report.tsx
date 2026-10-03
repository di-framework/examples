import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GameTimeline } from '@/components/game-timeline';
import {
  clock,
  inningLabel,
  outsLabel,
  playById,
  playerById,
  resultDetail,
  themeOrder,
  themeTitle,
} from '@/data/game';
import type { PlateAppearance, ThemeId } from '@/data/types';
import { useReport } from '@/state/report-state';
import { palette } from '@/theme/palette';

export default function ReportScreen() {
  const { marks, gameNote, setGameNote } = useReport();
  const markedIds = useMemo(() => new Set(marks.map((mark) => mark.playId)), [marks]);
  const grouped = useMemo(() => {
    const buckets = new Map<ThemeId, PlateAppearance[]>();
    for (const mark of marks) {
      const play = playById(mark.playId);
      const theme = play.outlier?.theme;
      if (!theme) continue;
      const list = buckets.get(theme) ?? [];
      list.push(play);
      buckets.set(theme, list);
    }
    return themeOrder
      .filter((theme) => (buckets.get(theme)?.length ?? 0) > 0)
      .map((theme) => ({ theme, plays: buckets.get(theme) ?? [] }));
  }, [marks]);

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={{ flex: 1, backgroundColor: palette.field }}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <Text style={{ color: palette.muted, fontSize: 12, fontWeight: '700' }}>
            COACH REPORT
          </Text>
          <Text style={{ color: palette.ink, fontSize: 28, fontWeight: '700', marginTop: 4 }}>
            Where to look
          </Text>
          <Text style={{ color: palette.muted, fontSize: 14, marginTop: 8, lineHeight: 20 }}>
            Quiet ticks stay on the timeline and drop back. Marked plays are grouped by what
            repeated.
          </Text>
          <Text style={{ color: palette.ink, fontSize: 13, fontWeight: '700', marginTop: 16 }}>
            Note
          </Text>
          <TextInput
            testID="game-note"
            value={gameNote}
            onChangeText={setGameNote}
            multiline
            placeholder="Write the note for the staff."
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
        </View>
        <View style={{ marginTop: 16 }}>
          <GameTimeline mode="report" markedIds={markedIds} />
        </View>
        <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
          {grouped.length === 0 ? (
            <Text
              testID="report-empty"
              style={{ color: palette.muted, fontSize: 15, lineHeight: 22 }}
            >
              No plays marked. On the game chart, open an amber mark and assign a player.
            </Text>
          ) : (
            grouped.map((group) => (
              <View key={group.theme} testID={`theme-${group.theme}`} style={{ marginBottom: 18 }}>
                <Text style={{ color: palette.mark, fontSize: 18, fontWeight: '700' }}>
                  {themeTitle(group.theme)} · {group.plays.length}
                </Text>
                {group.plays.map((play) => {
                  const mark = marks.find((item) => item.playId === play.id);
                  const assignee = mark ? playerById(mark.playerId) : null;
                  return (
                    <View
                      key={play.id}
                      testID={`report-play-${play.id}`}
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
                        {resultDetail(play.result)}, {outsLabel(play.outs)}
                      </Text>
                      <Text style={{ color: palette.ink, fontSize: 14, marginTop: 4 }}>
                        {play.outlier?.title} · {play.outlier?.badge}
                      </Text>
                      {assignee ? (
                        <Text style={{ color: palette.muted, fontSize: 13, marginTop: 4 }}>
                          Assigned to {assignee.name} #{assignee.number}
                        </Text>
                      ) : null}
                      {assignee ? (
                        <Pressable
                          testID={`open-card-${play.id}`}
                          accessibilityRole="button"
                          accessibilityLabel={`Open card for ${assignee.name}`}
                          onPress={() =>
                            router.push({ pathname: '/player', params: { playerId: assignee.id } })
                          }
                          style={{ marginTop: 10, alignSelf: 'flex-start' }}
                        >
                          <Text style={{ color: palette.mark, fontSize: 14, fontWeight: '700' }}>
                            Open {assignee.name}&apos;s card
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
