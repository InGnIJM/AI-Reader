import { Fragment } from 'react';
import type { ReactNode } from 'react';

import styles from './AppTitleBar.module.css';

export interface ContextBreadcrumb {
  id: 'workspace' | 'project' | 'session' | 'branch';
  label: string;
  current?: boolean;
  onNavigate?: () => void;
}

interface AppTitleBarProps {
  appName: string;
  tagline: string;
  navigationLabel: string;
  breadcrumbs: ContextBreadcrumb[];
  actions?: ReactNode;
}

export default function AppTitleBar({
  appName,
  tagline,
  navigationLabel,
  breadcrumbs,
  actions,
}: AppTitleBarProps) {
  return (
    <header className={styles.titleBar}>
      <div className={styles.brandStrip}>
        <span className={styles.brandMark} aria-hidden="true">
          <span className="material-symbols-rounded">auto_stories</span>
        </span>
        <strong className={styles.appName}>{appName}</strong>
        <span className={styles.tagline}>{tagline}</span>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      <nav className={styles.contextBar} aria-label={navigationLabel}>
        {breadcrumbs.map((breadcrumb, index) => (
          <Fragment key={breadcrumb.id}>
            {index > 0 ? (
              <span className={`material-symbols-rounded ${styles.separator}`} aria-hidden="true">
                chevron_right
              </span>
            ) : null}
            {breadcrumb.current || !breadcrumb.onNavigate ? (
              <span
                className={styles.contextItem}
                data-current={breadcrumb.current ? 'true' : undefined}
                title={breadcrumb.label}
              >
                {breadcrumb.label}
              </span>
            ) : (
              <button
                className={styles.contextButton}
                type="button"
                onClick={breadcrumb.onNavigate}
                title={breadcrumb.label}
              >
                {breadcrumb.label}
              </button>
            )}
          </Fragment>
        ))}
      </nav>
    </header>
  );
}
