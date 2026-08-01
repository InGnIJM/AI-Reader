import { useTheme } from '../../contexts/ThemeContext';
import styles from './ThemeToggle.module.css';

/**
 * 主题切换按钮：黑金 ⇄ 白色。
 * 图标表达「点击后切到哪个主题」——当前黑金时显示太阳（切白色）。
 */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isBlackGold = theme === 'black-gold';
  const actionLabel = isBlackGold ? '切换到白色主题' : '切换到黑金主题';

  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={toggleTheme}
      aria-label={actionLabel}
      title={actionLabel}
    >
      <span className="material-symbols-rounded" aria-hidden="true">
        {isBlackGold ? 'light_mode' : 'dark_mode'}
      </span>
    </button>
  );
}
