import { SpeakerHigh } from '@phosphor-icons/react';
import type { Ref } from 'react';
import './live-voice-panel.css';

export function LiveVoiceLaunchButton({
  disabled,
  title,
  buttonRef,
  onClick,
}: {
  readonly disabled: boolean;
  readonly title: string;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly onClick: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      data-live-launch
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className="live-voice-launch"
    >
      <span aria-hidden="true">
        <SpeakerHigh size={15} weight="fill" />
      </span>
      Live Voice
    </button>
  );
}
