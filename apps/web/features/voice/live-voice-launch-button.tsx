import { useId, type Ref } from 'react';
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
  const reasonId = useId();
  return (
    <>
      <button
        ref={buttonRef}
        data-live-launch
        type="button"
        disabled={disabled}
        onClick={onClick}
        title={title}
        aria-label="Live Voice"
        aria-describedby={disabled ? reasonId : undefined}
        className="live-voice-launch"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M18.8 12.3c.2 3.8-2.7 7-6.5 7.2-3.9.2-7.1-2.5-7.3-6.4-.3-3.8 2.5-7.1 6.3-7.5 3.7-.4 7.2 2.3 7.5 6.1v.6Z" />
          <path d="M8.8 12.7c.6-1.6 1.2-1.6 1.8 0 .7 1.7 1.3 1.7 2 0 .7-1.7 1.4-1.7 2.1 0" />
        </svg>
      </button>
      {disabled ? (
        <span id={reasonId} className="sr-only">
          {title}
        </span>
      ) : null}
    </>
  );
}
