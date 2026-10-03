import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  assignablePlayers,
  clock,
  formatOptionalFeet,
  formatOptionalSeconds,
  inningLabel,
  outsLabel,
  playerById,
  resultDetail,
} from '@/data/game';
import type { PlateAppearance } from '@/data/types';
import { useReport } from '@/state/report-state';
import { palette } from '@/theme/palette';

export function PlayDrawer({ play, onClose }: { play: PlateAppearance; onClose: () => void }) {
  const outlier = play.outlier;
  const { marks, markPlay, unmarkPlay } = useReport();
  const existing = marks.find((mark) => mark.playId === play.id);
  const choices = assignablePlayers(play);
  const [playerId, setPlayerId] = useState(
    existing?.playerId ?? outlier?.playerId ?? choices[0]?.id ?? '',
  );
  const assigned = existing ? playerById(existing.playerId) : null;
  const runner = play.pose.runner;
  const fielder = play.pose.fielder;
  const battery = play.pose.battery;

  return (
    <View
      testID="play-drawer"
      style={{
        maxHeight: '52%',
        backgroundColor: palette.card,
        borderTopWidth: 1,
        borderTopColor: palette.line,
      }}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ color: palette.mark, fontSize: 12, fontWeight: '700' }}>
              {outlier ? `${outlier.title} · ${outlier.badge}` : 'Plate appearance'}
            </Text>
            <Text style={{ color: palette.ink, fontSize: 20, fontWeight: '700', marginTop: 4 }}>
              {resultDetail(play.result)}
            </Text>
            <Text style={{ color: palette.muted, fontSize: 13, marginTop: 4 }}>
              {inningLabel(play.inning, play.half)} · {outsLabel(play.outs)} · video{' '}
              {clock(play.videoStart)}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close play"
            onPress={onClose}
            testID="close-drawer"
          >
            <Text style={{ color: palette.ink, fontSize: 16, fontWeight: '700' }}>Close</Text>
          </Pressable>
        </View>

        <PoseBlock
          testID="pose-runner"
          title="Runner"
          accent={palette.runner}
          lines={
            runner
              ? [
                  `${runner.name} #${runner.number}`,
                  `Lead ${formatOptionalFeet(runner.leadFeet)}`,
                  `Break ${formatOptionalSeconds(runner.breakSeconds)}`,
                  `Home to first ${formatOptionalSeconds(runner.homeToFirstSeconds)}`,
                ]
              : ['No runner on this play.']
          }
        />
        <PoseBlock
          testID="pose-fielder"
          title="Fielder"
          accent={palette.fielder}
          lines={[
            `${fielder.name} #${fielder.number}, ${fielder.position}`,
            `First step ${formatOptionalSeconds(fielder.firstStepSeconds)} after the swing`,
          ]}
        />
        <PoseBlock
          testID="pose-battery"
          title="Battery"
          accent={palette.battery}
          lines={[
            `${battery.pitcherName} #${battery.pitcherNumber} pitching, ${battery.catcherName} #${battery.catcherNumber} catching`,
            `Stride ${formatOptionalFeet(battery.strideFeet)}`,
            `Arm slot ${battery.armSlotDegrees}°`,
            `Exchange ${formatOptionalSeconds(battery.exchangeSeconds)}`,
            `Pop time ${formatOptionalSeconds(battery.popSeconds)}`,
          ]}
        />

        <Text style={{ color: palette.ink, fontSize: 16, fontWeight: '700', marginTop: 18 }}>
          Assign this play
        </Text>
        <Text style={{ color: palette.muted, fontSize: 13, marginTop: 4, marginBottom: 10 }}>
          {assigned
            ? `On the report for ${assigned.name} #${assigned.number}.`
            : 'Choose who this report line is for. The scorebook result stays as logged.'}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {choices.map((choice) => {
            const selected = choice.id === playerId;
            return (
              <Pressable
                key={choice.id}
                testID={`assign-${choice.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setPlayerId(choice.id)}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                  borderRadius: 8,
                  backgroundColor: selected ? palette.mark : palette.chip,
                  borderWidth: 1,
                  borderColor: selected ? palette.mark : palette.line,
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
                  {choice.name} #{choice.number}
                </Text>
                <Text style={{ color: selected ? palette.markInk : palette.muted, fontSize: 11 }}>
                  {choice.duty}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          testID="save-mark"
          accessibilityRole="button"
          disabled={playerId.length === 0}
          onPress={() => markPlay(play.id, playerId)}
          style={{
            marginTop: 8,
            backgroundColor: palette.mark,
            borderRadius: 8,
            paddingVertical: 12,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: palette.markInk, fontSize: 15, fontWeight: '700' }}>
            {existing ? 'Update report assignment' : 'Mark for report'}
          </Text>
        </Pressable>
        {existing ? (
          <Pressable
            testID="clear-mark"
            accessibilityRole="button"
            onPress={() => unmarkPlay(play.id)}
            style={{
              marginTop: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: palette.danger,
              paddingVertical: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: palette.danger, fontSize: 15, fontWeight: '700' }}>
              Remove from report
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

function PoseBlock({
  title,
  accent,
  lines,
  testID,
}: {
  title: string;
  accent: string;
  lines: string[];
  testID: string;
}) {
  return (
    <View
      testID={testID}
      style={{
        marginTop: 14,
        paddingLeft: 10,
        borderLeftWidth: 3,
        borderLeftColor: accent,
      }}
    >
      <Text style={{ color: accent, fontSize: 13, fontWeight: '700' }}>{title}</Text>
      {lines.map((line) => (
        <Text key={line} style={{ color: palette.ink, fontSize: 14, marginTop: 3 }}>
          {line}
        </Text>
      ))}
    </View>
  );
}
