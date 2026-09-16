import type { DesktopPreferences } from './desktop-preferences';

export function DesktopPreferencesPanel({
  preferences,
  updatePreferences,
}: {
  preferences: DesktopPreferences;
  updatePreferences(update: Partial<DesktopPreferences>): void;
}) {
  return (
    <div className="pet-chat__settings" role="group" aria-label="桌宠设置">
      <label>
        <input
          type="checkbox"
          checked={preferences.muted}
          onChange={(event) =>
            updatePreferences({ muted: event.currentTarget.checked })
          }
        />
        静音
      </label>
      <label>
        音量
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={Math.round(preferences.volume * 100)}
          disabled={preferences.muted}
          aria-label="语音音量"
          onChange={(event) =>
            updatePreferences({
              volume: Number(event.currentTarget.value) / 100,
            })
          }
        />
      </label>
      <label>
        动画
        <select
          value={preferences.animationIntensity}
          aria-label="动画强度"
          onChange={(event) =>
            updatePreferences({
              animationIntensity: event.currentTarget
                .value as DesktopPreferences['animationIntensity'],
            })
          }
        >
          <option value="system">跟随系统</option>
          <option value="reduced">减少</option>
          <option value="off">关闭</option>
        </select>
      </label>
    </div>
  );
}
