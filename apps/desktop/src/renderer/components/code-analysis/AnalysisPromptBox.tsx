import styles from './CodeAnalysisComponents.module.css';

interface AnalysisPromptBoxProps {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function AnalysisPromptBox({ value, disabled, onChange, onSubmit }: AnalysisPromptBoxProps) {
  return (
    <div className={styles.promptBox}>
      <textarea
        aria-label="Analysis goal"
        value={value}
        disabled={disabled}
        placeholder="Ask the model to analyze this code directory..."
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <button type="button" onClick={onSubmit} disabled={disabled || !value.trim()}>
        Run
      </button>
    </div>
  );
}
