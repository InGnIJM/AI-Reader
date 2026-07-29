import styles from './CodeAnalysisComponents.module.css';

interface AnalysisPromptBoxProps {
  value: string;
  disabled?: boolean;
  labels?: {
    ariaLabel: string;
    placeholder: string;
    submit: string;
  };
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function AnalysisPromptBox({ value, disabled, labels, onChange, onSubmit }: AnalysisPromptBoxProps) {
  const text = labels ?? {
    ariaLabel: 'Analysis goal',
    placeholder: 'Ask the model to analyze this code directory...',
    submit: 'Run',
  };

  return (
    <div className={styles.promptBox}>
      <textarea
        aria-label={text.ariaLabel}
        value={value}
        disabled={disabled}
        placeholder={text.placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <button type="button" onClick={onSubmit} disabled={disabled || !value.trim()}>
        {text.submit}
      </button>
    </div>
  );
}
